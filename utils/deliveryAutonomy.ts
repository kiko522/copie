import type {
  CharacterDeliveryAutonomyConfig,
  CharacterProfile,
  CommerceOrder,
  DeliveryAddress,
  Message,
} from '../types';
import { DB } from './db';
import { CommerceError } from './commerce';
import { DELIVERY_STORES, findDeliveryStore } from './deliveryCatalog';
import { formatMoney, sumMoney } from './format';

export const DELIVERY_ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DELIVERY_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DELIVERY_MAX_ORDERS_PER_WINDOW = 2;

export interface CharacterDeliveryIntent {
  type: 'delivery_order';
  /** worker 根据 taskId + occurrenceMs 补上的稳定键；模型不负责生成。 */
  intentId: string;
  addressId: string;
  storeId: string;
  items: Array<{ productId: string; quantity: number }>;
}

export type CharacterDeliveryResult =
  | { status: 'placed'; order: CommerceOrder; duplicate: boolean }
  | { status: 'rejected'; reason: string };

const FOOD_WISH_RE = /(想吃|想喝|好想吃|好想喝|有点饿|饿了|馋|夜宵|早餐|早饭|午饭|晚饭|奶茶|咖啡|吃什么|喝什么)/i;

const messageText = (message: Message): string => {
  if (typeof message.content === 'string') return message.content;
  return '';
};

/** 只摘最近 90 分钟里用户明确表达过的饮食愿望，不把整段聊天再复制一遍。 */
export const collectRecentFoodWishes = (
  messages: Message[],
  now = Date.now(),
): string[] => messages
  .filter((message) => message.role === 'user'
    && now - Number(message.timestamp || 0) >= 0
    && now - Number(message.timestamp || 0) <= 90 * 60_000)
  .map(messageText)
  .map((text) => text.replace(/\s+/g, ' ').trim())
  .filter((text) => text.length > 0 && FOOD_WISH_RE.test(text))
  .slice(-4)
  .map((text) => text.slice(0, 180));

const frequencyCopy = (frequency: CharacterDeliveryAutonomyConfig['frequency']): string => {
  if (frequency === 'rare') return '非常偶尔；没有强动机就不要点。';
  if (frequency === 'often') return '可以相对主动，但仍必须像真实生活里的偶发决定，绝不是每日任务。';
  return '自然、克制地偶尔发生；没有合适契机就不要点。';
};

/**
 * 随 fire_pack 烤进去的授权说明。它只给云端「可选什么」，不带银行卡、余额或详细地址；
 * 那些敏感且会变化的事实只在客户端结账闸门里读取。
 */
export const buildDeliveryAutonomyPrompt = (input: {
  config: CharacterDeliveryAutonomyConfig | undefined;
  addresses: DeliveryAddress[];
  recentWishes: string[];
}): string => {
  const config = input.config;
  if (!config?.enabled || !config.cardId || !config.allowedAddressIds?.length) return '';
  const allowed = input.addresses
    .filter((address) => config.allowedAddressIds.includes(address.id))
    .map((address) => ({ id: address.id, recipient: address.ownerId === 'user' ? 'user' : 'character', label: address.label }));
  if (allowed.length === 0) return '';

  const catalog = DELIVERY_STORES.map((store) => ({
    id: store.id,
    name: store.name,
    category: store.category,
    minimumOrder: store.minimumOrder,
    deliveryFee: store.deliveryFee,
    products: store.products.map((product) => ({ id: product.id, name: product.name, price: product.price })),
  }));
  const wishes = input.recentWishes.length > 0 ? input.recentWishes : ['（最近 90 分钟没有明确说想吃或想喝什么）'];

  return [
    '',
    '【可选能力：自主点外卖】',
    `使用倾向：${frequencyCopy(config.frequency)}`,
    '这是一项可选的生活动作，不是每天必须完成的任务，也不是提醒用户按点吃饭。综合你当前的生活轨迹、日程、正在做的事、人设和最近对话，只有真的自然时才使用。',
    '早餐场景的主动倾向要低于夜宵；不要机械催早餐、午饭或晚饭。用户最近 90 分钟明确说过想吃/想喝，是重要但非强制的信号。',
    `最近 90 分钟饮食表达：${JSON.stringify(wishes)}`,
    `本次可选地址（只有匿名 ID/归属/标签）：${JSON.stringify(allowed)}`,
    `本地稳定菜单：${JSON.stringify(catalog)}`,
    '若你决定点单：必须从上面的 ID 中选 1 个地址、1 家店和商品，满足该店起送价，并在正文末尾额外输出：',
    '[[DELIVERY_ORDER|地址ID|店铺ID|商品ID*数量,商品ID*数量]]',
    '一次最多输出一个点单意图。不要自行编 ID、价格、优惠、地址或银行卡信息。',
    '这条标签只是提交意图，客户端还会检查授权、地址、角色银行卡、余额、24 小时上限、6 小时间隔和商品目录。',
    '因此正文只能说“想给你点/我试着下单/等客户端确认”之类的未完成语气；绝不能在标签旁宣称已经下单、已付款、商家已接单或正在配送。客户端确认成功后会另发订单卡片。',
    '如果不点单，完全不要提这项能力，也不要输出标签。',
  ].join('\n');
};

const reject = (reason: string): CharacterDeliveryResult => ({ status: 'rejected', reason });

const stableOrderId = (charId: string, intentId: string): string => {
  const safeChar = charId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
  const safeIntent = intentId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
  return `delivery-auto-${safeChar}-${safeIntent}`;
};

/** 客户端最终闸门：所有会扣款的事实都在这里重新读取和校验。 */
export const executeCharacterDeliveryIntent = async (
  char: CharacterProfile,
  intent: CharacterDeliveryIntent,
  now = Date.now(),
): Promise<CharacterDeliveryResult> => {
  const config = char.activeMsg2Config?.deliveryAutonomy;
  if (!config?.enabled) return reject('这个角色没有开启自主点外卖');
  if (!intent.intentId || !intent.addressId || !intent.storeId || !Array.isArray(intent.items)) {
    return reject('点单意图缺少必要字段');
  }

  const orderId = stableOrderId(char.id, intent.intentId);
  const existing = await DB.getCommerceOrder(orderId);
  if (existing) {
    return existing.payerOwnerId === char.id && existing.source === 'llm'
      ? { status: 'placed', order: existing, duplicate: true }
      : reject('稳定订单编号已被其他记录占用');
  }

  if (!config.cardId) return reject('没有为这个角色指定付款银行卡');
  const card = (await DB.getBankCards(char.id)).find((item) => item.id === config.cardId);
  if (!card || card.ownerId !== char.id) return reject('指定的银行卡不存在或不属于这个角色');

  if (!(config.allowedAddressIds || []).includes(intent.addressId)) return reject('这个地址没有授权给该角色');
  const address = (await DB.getDeliveryAddresses()).find((item) => item.id === intent.addressId);
  if (!address) return reject('授权地址已经不存在');
  if (address.ownerId !== 'user' && address.ownerId !== char.id) return reject('这个地址属于其他角色');

  const recentOrders = (await DB.getCommerceOrders({ payerOwnerId: char.id, type: 'delivery' }))
    .filter((order) => order.source === 'llm' && order.paymentStatus === 'paid')
    .sort((a, b) => b.createdAt - a.createdAt);
  const inWindow = recentOrders.filter((order) => now - order.createdAt >= 0 && now - order.createdAt < DELIVERY_ROLLING_WINDOW_MS);
  if (inWindow.length >= DELIVERY_MAX_ORDERS_PER_WINDOW) return reject('该角色滚动 24 小时内已经点过 2 单');
  if (recentOrders[0] && now - recentOrders[0].createdAt < DELIVERY_MIN_INTERVAL_MS) {
    return reject('距离该角色上一单还不到 6 小时');
  }

  const store = findDeliveryStore(intent.storeId);
  if (!store) return reject('店铺不在当前本地菜单中');
  if (intent.items.length === 0 || intent.items.length > 5) return reject('商品种类数量无效');
  const quantities = new Map<string, number>();
  for (const requested of intent.items) {
    const quantity = Number(requested.quantity);
    if (!requested.productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 5) {
      return reject('商品数量无效');
    }
    if (!store.products.some((product) => product.id === requested.productId)) return reject('商品不属于所选店铺');
    quantities.set(requested.productId, (quantities.get(requested.productId) || 0) + quantity);
  }
  if ([...quantities.values()].some((quantity) => quantity > 5)) return reject('同一商品数量超过上限');
  const items = [...quantities.entries()].map(([productId, quantity]) => {
    const product = store.products.find((entry) => entry.id === productId)!;
    return { productId, name: product.name, quantity, unitPrice: product.price, imageKey: product.imageKey };
  });
  const subtotal = sumMoney(items.map((item) => item.unitPrice * item.quantity));
  if (subtotal < store.minimumOrder) return reject(`商品金额未达到 ${store.name} 的起送价`);

  try {
    const result = await DB.checkoutCommerceOrder({
      id: orderId,
      type: 'delivery',
      payerOwnerId: char.id,
      recipientOwnerId: address.ownerId,
      merchantId: store.id,
      merchantName: store.name,
      items,
      deliveryFee: store.deliveryFee,
      serviceFee: 0,
      discount: 0,
      cardId: card.id,
      deliveryAddress: {
        id: address.id,
        ownerId: address.ownerId,
        label: address.label,
        recipientName: address.recipientName,
        phone: address.phone,
        addressLine: address.addressLine,
        latitude: address.latitude,
        longitude: address.longitude,
      },
      source: 'llm',
      createdAt: now,
    });
    return { status: 'placed', order: result.order, duplicate: false };
  } catch (error) {
    if (error instanceof CommerceError && error.code === 'DUPLICATE_ORDER') {
      const duplicate = await DB.getCommerceOrder(orderId);
      if (duplicate?.payerOwnerId === char.id && duplicate.source === 'llm') {
        return { status: 'placed', order: duplicate, duplicate: true };
      }
    }
    return reject(error instanceof Error ? error.message : '客户端结账失败');
  }
};

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

/** 纯展示卡片；唯一交互是 HtmlCard 识别的 sully://delivery/order/... 窄白名单。 */
export const buildDeliveryConfirmationCard = (order: CommerceOrder): { html: string; preview: string } => {
  const names = order.items.map((item) => `${item.name} × ${item.quantity}`).join('、');
  const href = `sully://delivery/order/${encodeURIComponent(order.id)}`;
  return {
    preview: `${order.merchantName} · ${names} · ¥${formatMoney(order.total)}`,
    html: `<div style="width:260px;padding:16px;border-radius:16px;background:linear-gradient(145deg,#fff7ed,#ffffff);font-family:system-ui;color:#334155;border:1px solid #fed7aa"><div style="font-size:11px;color:#f97316;font-weight:800;letter-spacing:1px">ORDER CONFIRMED</div><div style="font-size:18px;font-weight:800;margin-top:5px">${escapeHtml(order.merchantName)}</div><div style="font-size:12px;line-height:1.6;margin-top:9px;color:#64748b">${escapeHtml(names)}</div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px"><strong style="font-size:18px;color:#ea580c">¥${formatMoney(order.total)}</strong><a href="${href}" style="font-size:12px;font-weight:800;color:#fff;background:#f97316;text-decoration:none;padding:8px 12px;border-radius:999px">查看订单</a></div></div>`,
  };
};
