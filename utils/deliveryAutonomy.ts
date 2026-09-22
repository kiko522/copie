import type { CharacterDeliveryAutonomyConfig, CharacterProfile, CommerceOrder, Message } from '../types';
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
const FOOD_WISH_CANCEL_RE = /(算了|不用点|别点|不要点|不想吃|不想喝|刚吃过|吃过了|喝过了|不饿|不用买|不要了)/i;

const messageText = (message: Message): string => {
  if (typeof message.content === 'string') return message.content;
  return '';
};

export interface RecentFoodWishSignal { id: string; text: string; timestamp: number }

/**
 * 只摘最近 90 分钟里用户明确表达过、且没有被后续取消的饮食愿望。
 * VPS 只会拿到这些短信号，不会因此获得完整聊天记录以外的敏感资料。
 */
export const collectRecentFoodWishSignals = (
  messages: Message[],
  now = Date.now(),
): RecentFoodWishSignal[] => {
  const recent = messages
    .filter((message) => message.role === 'user'
    && now - Number(message.timestamp || 0) >= 0
    && now - Number(message.timestamp || 0) <= 90 * 60_000)
    .map((message, index) => ({
      id: String((message as Message & { id?: string | number }).id ?? `${message.timestamp}-${index}`),
      text: messageText(message).replace(/\s+/g, ' ').trim(),
      timestamp: Number(message.timestamp || 0),
    }));
  const lastCancellation = recent.reduce((latest, row) => FOOD_WISH_CANCEL_RE.test(row.text) ? Math.max(latest, row.timestamp) : latest, -1);
  return recent
    .filter((row) => row.timestamp > lastCancellation && row.text.length > 0 && FOOD_WISH_RE.test(row.text) && !FOOD_WISH_CANCEL_RE.test(row.text))
    .slice(-4)
    .map((row) => ({ ...row, text: row.text.slice(0, 180) }));
};

export const collectRecentFoodWishes = (messages: Message[], now = Date.now()): string[] =>
  collectRecentFoodWishSignals(messages, now).map((row) => row.text);

/** 兼容极短暂的旧版嵌套存储；新写入一律落在角色顶层，与主动消息 2.0 解耦。 */
export const getCharacterDeliveryAutonomy = (char: CharacterProfile): CharacterDeliveryAutonomyConfig | undefined =>
  char.deliveryAutonomy
  ?? (char.activeMsg2Config as (typeof char.activeMsg2Config & { deliveryAutonomy?: CharacterDeliveryAutonomyConfig }) | undefined)?.deliveryAutonomy;

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
  const config = getCharacterDeliveryAutonomy(char);
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
