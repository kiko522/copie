import { describe, expect, it } from 'vitest';
import type { CommerceOrder, CommerceOrderDraft } from '../types';
import { CommerceError, getDeliveryProgress, latestOrderPerMerchant, prepareCommerceOrder } from './commerce';

const draft = (patch: Partial<CommerceOrderDraft> = {}): CommerceOrderDraft => ({
    id: 'order-1', type: 'delivery', payerOwnerId: 'user', recipientOwnerId: 'user',
    merchantId: 'shop-1', merchantName: '春日食堂', cardId: 'card-1', source: 'user',
    items: [
        { productId: 'rice', name: '招牌饭', quantity: 2, unitPrice: 12.345 },
        { productId: 'tea', name: '乌龙茶', quantity: 1, unitPrice: 6 },
    ],
    deliveryFee: 3, serviceFee: 1, discount: 2,
    ...patch,
});

describe('统一订单领域规则', () => {
    it('结账前统一重算商品小计和实付金额', () => {
        const order = prepareCommerceOrder(draft());
        expect(order.items[0].unitPrice).toBe(12.35);
        expect(order.subtotal).toBe(30.7);
        expect(order.total).toBe(32.7);
        expect(order.paymentStatus).toBe('paid');
    });

    it('空购物车或无效商品会在扣款前拒绝', () => {
        expect(() => prepareCommerceOrder(draft({ items: [] }))).toThrowError(CommerceError);
        expect(() => prepareCommerceOrder(draft({ items: [{ productId: 'x', name: '坏商品', quantity: 0, unitPrice: 1 }] }))).toThrowError(CommerceError);
    });

    it('配送状态只按下单时间推进，不需要后台任务', () => {
        const createdAt = 1_000_000;
        const order = prepareCommerceOrder(draft({ createdAt }));
        expect(getDeliveryProgress(order, createdAt + 7 * 60_000)).toBe('placed');
        expect(getDeliveryProgress(order, createdAt + 8 * 60_000)).toBe('accepted');
        expect(getDeliveryProgress(order, createdAt + 32 * 60_000)).toBe('delivering');
        expect(getDeliveryProgress(order, createdAt + 40 * 60_000)).toBe('delivered');
    });

    it('按店去重只影响列表展示，保留每家店的最新订单', () => {
        const a1 = prepareCommerceOrder(draft({ id: 'a1', merchantId: 'a', createdAt: 100 }));
        const a2 = prepareCommerceOrder(draft({ id: 'a2', merchantId: 'a', createdAt: 300 }));
        const b1 = prepareCommerceOrder(draft({ id: 'b1', merchantId: 'b', createdAt: 200 }));
        expect(latestOrderPerMerchant([a1, b1, a2]).map(order => order.id)).toEqual(['a2', 'b1']);
    });

    it('退款和取消状态优先于时间推导', () => {
        const order = prepareCommerceOrder(draft({ createdAt: 0 }));
        expect(getDeliveryProgress({ ...order, paymentStatus: 'refunded' } as CommerceOrder, 99_999_999)).toBe('refunded');
        expect(getDeliveryProgress({ ...order, paymentStatus: 'cancelled' } as CommerceOrder, 99_999_999)).toBe('cancelled');
    });
});
