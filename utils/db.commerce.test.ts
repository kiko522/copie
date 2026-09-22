import { describe, expect, it } from 'vitest';
import type { BankCard, CommerceOrderDraft, DeliveryAddress } from '../types';
import { DB } from './db';

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cardFor = (id: string, ownerId: string, balance: number): BankCard => ({
    id, ownerId, nickname: '测试卡', issuerName: '糯米银行', network: 'unionpay', last4: '0522',
    styleId: 'crimson-gold', balance, currency: 'CNY', isDefault: true,
    createdAt: Date.now(), updatedAt: Date.now(),
});

const orderFor = (id: string, cardId: string, payerOwnerId = 'user'): CommerceOrderDraft => ({
    id, type: 'delivery', payerOwnerId, recipientOwnerId: payerOwnerId,
    merchantId: 'merchant-test', merchantName: '春日食堂', cardId, source: 'user',
    items: [{ productId: 'meal', name: '招牌套餐', quantity: 2, unitPrice: 15 }],
    deliveryFee: 3,
});

describe('统一结账事务', () => {
    it('一次结账同时写订单、扣卡和支出流水；退款再原子恢复', async () => {
        const key = stamp();
        const card = cardFor(`card-${key}`, 'user', 100);
        const draft = orderFor(`order-${key}`, card.id);
        await DB.saveBankCard(card);

        const paid = await DB.checkoutCommerceOrder(draft);
        expect(paid.order.total).toBe(33);
        expect(paid.card.balance).toBe(67);
        expect(paid.transaction).toMatchObject({
            ownerId: 'user', cardId: card.id, amount: 33, direction: 'expense',
            kind: 'purchase', source: 'delivery', sourceRef: `order:${draft.id}`,
        });
        expect((await DB.getCommerceOrder(draft.id))?.paymentStatus).toBe('paid');

        await expect(DB.checkoutCommerceOrder(draft)).rejects.toMatchObject({ code: 'DUPLICATE_ORDER' });
        expect((await DB.getBankCards('user')).find(item => item.id === card.id)?.balance).toBe(67);

        const refunded = await DB.refundCommerceOrder(draft.id);
        expect(refunded.order.paymentStatus).toBe('refunded');
        expect(refunded.card.balance).toBe(100);
        expect(refunded.transaction).toMatchObject({ direction: 'income', kind: 'refund', sourceRef: `refund:${draft.id}` });
        await expect(DB.refundCommerceOrder(draft.id)).rejects.toMatchObject({ code: 'ORDER_NOT_REFUNDABLE' });

        const rows = await DB.getAllTransactions('user');
        expect(rows.filter(tx => tx.sourceRef === `order:${draft.id}`)).toHaveLength(1);
        expect(rows.filter(tx => tx.sourceRef === `refund:${draft.id}`)).toHaveLength(1);
    });

    it('余额不足或卡片归属错误时，订单和流水都不会落库', async () => {
        const key = stamp();
        const card = cardFor(`card-${key}`, `char-${key}`, 10);
        await DB.saveBankCard(card);

        const insufficient = orderFor(`order-poor-${key}`, card.id, card.ownerId);
        await expect(DB.checkoutCommerceOrder(insufficient)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
        expect(await DB.getCommerceOrder(insufficient.id)).toBeNull();

        const wrongOwner = orderFor(`order-owner-${key}`, card.id, 'user');
        await expect(DB.checkoutCommerceOrder(wrongOwner)).rejects.toMatchObject({ code: 'CARD_OWNER_MISMATCH' });
        expect(await DB.getCommerceOrder(wrongOwner.id)).toBeNull();
        expect((await DB.getBankCards(card.ownerId)).find(item => item.id === card.id)?.balance).toBe(10);
    });

    it('每个 owner 只有一个默认地址，并随完整备份导出', async () => {
        const key = stamp();
        const ownerId = `char-address-${key}`;
        const base = { ownerId, recipientName: '小夏', addressLine: '青禾路 8 号', isDefault: true, createdAt: Date.now(), updatedAt: Date.now() };
        const first: DeliveryAddress = { ...base, id: `address-a-${key}`, label: '家' };
        const second: DeliveryAddress = { ...base, id: `address-b-${key}`, label: '公司', updatedAt: Date.now() + 1 };
        await DB.saveDeliveryAddress(first);
        await DB.saveDeliveryAddress(second);

        const addresses = await DB.getDeliveryAddresses(ownerId);
        expect(addresses.filter(address => address.isDefault).map(address => address.id)).toEqual([second.id]);
        const backup = await DB.exportFullData();
        expect(backup.deliveryAddresses?.some(address => address.id === second.id)).toBe(true);

        await DB.deleteDeliveryAddress(first.id);
        await DB.deleteDeliveryAddress(second.id);
    });
});
