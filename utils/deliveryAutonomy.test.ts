import { describe, expect, it } from 'vitest';
import type { BankCard, CharacterProfile, DeliveryAddress, Message } from '../types';
import { DB } from './db';
import {
  collectRecentFoodWishes,
  executeCharacterDeliveryIntent,
  type CharacterDeliveryIntent,
} from './deliveryAutonomy';

const key = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const setup = async (balance = 500) => {
  const suffix = key();
  const charId = `char-delivery-${suffix}`;
  const card: BankCard = {
    id: `card-${suffix}`, ownerId: charId, nickname: '角色卡', issuerName: '测试银行',
    network: 'unionpay', last4: '0522', styleId: 'crimson-gold', balance, currency: 'CNY',
    isDefault: true, createdAt: Date.now(), updatedAt: Date.now(),
  };
  const address: DeliveryAddress = {
    id: `address-${suffix}`, ownerId: 'user', label: '家', recipientName: '小明',
    addressLine: '测试路 1 号', isDefault: true, createdAt: Date.now(), updatedAt: Date.now(),
  };
  const char = {
    id: charId,
    name: '小夏',
    activeMsg2Config: {
      enabled: true,
      deliveryAutonomy: { enabled: true, cardId: card.id, allowedAddressIds: [address.id] },
    },
  } as CharacterProfile;
  await DB.saveBankCard(card);
  await DB.saveDeliveryAddress(address);
  return { char, card, address };
};

const intent = (id: string, addressId: string, productId = 'tomato-beef-rice'): CharacterDeliveryIntent => ({
  type: 'delivery_order', intentId: id, addressId, storeId: 'warm-kitchen',
  items: [{ productId, quantity: 1 }],
});

describe('角色自主点外卖客户端闸门', () => {
  it('稳定 intent 重放只结账一次', async () => {
    const { char, card, address } = await setup();
    const now = 1_900_000_000_000;
    const first = await executeCharacterDeliveryIntent(char, intent('same-task-1', address.id), now);
    const second = await executeCharacterDeliveryIntent(char, intent('same-task-1', address.id), now + 1_000);
    expect(first.status).toBe('placed');
    expect(second).toMatchObject({ status: 'placed', duplicate: true });
    const current = (await DB.getBankCards(char.id)).find((item) => item.id === card.id)!;
    expect(current.balance).toBe(468.2);
    expect((await DB.getCommerceOrders({ payerOwnerId: char.id })).filter((order) => order.source === 'llm')).toHaveLength(1);
  });

  it('每个角色独立执行 6 小时冷却与滚动 24 小时最多两单', async () => {
    const a = await setup();
    const b = await setup();
    const now = 1_900_100_000_000;
    expect((await executeCharacterDeliveryIntent(a.char, intent('a-1', a.address.id), now)).status).toBe('placed');
    expect(await executeCharacterDeliveryIntent(a.char, intent('a-too-soon', a.address.id), now + 60 * 60_000))
      .toMatchObject({ status: 'rejected', reason: expect.stringContaining('6 小时') });
    expect((await executeCharacterDeliveryIntent(b.char, intent('b-1', b.address.id), now + 60 * 60_000)).status).toBe('placed');
    expect((await executeCharacterDeliveryIntent(a.char, intent('a-2', a.address.id), now + 6 * 60 * 60_000)).status).toBe('placed');
    expect(await executeCharacterDeliveryIntent(a.char, intent('a-3', a.address.id), now + 12 * 60 * 60_000))
      .toMatchObject({ status: 'rejected', reason: expect.stringContaining('24 小时') });
  });

  it('未授权地址、他人卡和目录外商品都不能扣款', async () => {
    const { char, card, address } = await setup();
    const now = 1_900_200_000_000;
    expect(await executeCharacterDeliveryIntent(char, intent('bad-address', 'unknown-address'), now))
      .toMatchObject({ status: 'rejected', reason: expect.stringContaining('没有授权') });
    expect(await executeCharacterDeliveryIntent(char, intent('bad-product', address.id, 'made-up-product'), now))
      .toMatchObject({ status: 'rejected', reason: expect.stringContaining('不属于') });
    const stolen = { ...char, activeMsg2Config: { ...char.activeMsg2Config!, deliveryAutonomy: { ...char.activeMsg2Config!.deliveryAutonomy!, cardId: 'not-owned' } } };
    expect(await executeCharacterDeliveryIntent(stolen as CharacterProfile, intent('bad-card', address.id), now))
      .toMatchObject({ status: 'rejected', reason: expect.stringContaining('不属于') });
    expect((await DB.getBankCards(char.id)).find((item) => item.id === card.id)?.balance).toBe(500);
  });

  it('即使误入白名单，也拒绝使用其他角色的地址', async () => {
    const { char, card } = await setup();
    const suffix = key();
    const foreignAddress: DeliveryAddress = {
      id: `foreign-address-${suffix}`, ownerId: `another-char-${suffix}`, label: '别人家', recipientName: '别人',
      addressLine: '隔壁角色的地址', isDefault: false, createdAt: Date.now(), updatedAt: Date.now(),
    };
    await DB.saveDeliveryAddress(foreignAddress);
    const misconfigured = {
      ...char,
      activeMsg2Config: {
        ...char.activeMsg2Config!,
        deliveryAutonomy: {
          ...char.activeMsg2Config!.deliveryAutonomy!,
          allowedAddressIds: [foreignAddress.id],
        },
      },
    } as CharacterProfile;
    expect(await executeCharacterDeliveryIntent(misconfigured, intent('foreign-address', foreignAddress.id), 1_900_300_000_000))
      .toMatchObject({ status: 'rejected', reason: expect.stringContaining('其他角色') });
    expect((await DB.getBankCards(char.id)).find((item) => item.id === card.id)?.balance).toBe(500);
  });
});

describe('最近 90 分钟饮食表达', () => {
  it('只保留时间窗内的用户愿望', () => {
    const now = 2_000_000;
    const rows = [
      { role: 'user', content: '我想喝奶茶', timestamp: now - 10_000 },
      { role: 'assistant', content: '那要不要点？', timestamp: now - 9_000 },
      { role: 'user', content: '今天天气不错', timestamp: now - 8_000 },
      { role: 'user', content: '我想吃蛋糕', timestamp: now - 91 * 60_000 },
    ] as Message[];
    expect(collectRecentFoodWishes(rows, now)).toEqual(['我想喝奶茶']);
  });
});
