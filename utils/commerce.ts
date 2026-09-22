import type { CommerceOrder, CommerceOrderDraft } from '../types';
import { roundMoney, sumMoney } from './format';

export type CommerceErrorCode =
    | 'INVALID_ORDER'
    | 'DUPLICATE_ORDER'
    | 'CARD_NOT_FOUND'
    | 'CARD_OWNER_MISMATCH'
    | 'INSUFFICIENT_BALANCE'
    | 'ORDER_NOT_FOUND'
    | 'ORDER_NOT_REFUNDABLE';

export class CommerceError extends Error {
    constructor(public readonly code: CommerceErrorCode, message: string) {
        super(message);
        this.name = 'CommerceError';
    }
}

const positiveMoney = (value: number | undefined): number => Math.max(0, roundMoney(Number(value) || 0));

/** 结账前重新计算价格，调用方传不进自相矛盾的 subtotal / total。 */
export const prepareCommerceOrder = (draft: CommerceOrderDraft): CommerceOrder => {
    if (!draft.id || !draft.payerOwnerId || !draft.recipientOwnerId || !draft.merchantId || !draft.merchantName || !draft.cardId) {
        throw new CommerceError('INVALID_ORDER', '订单缺少付款人、收货人、商家或银行卡');
    }
    if (!Array.isArray(draft.items) || draft.items.length === 0) {
        throw new CommerceError('INVALID_ORDER', '购物车是空的');
    }

    const items = draft.items.map(item => {
        const quantity = Math.floor(Number(item.quantity));
        const unitPrice = positiveMoney(item.unitPrice);
        if (!item.productId || !item.name || quantity <= 0 || unitPrice <= 0) {
            throw new CommerceError('INVALID_ORDER', '商品数量或价格无效');
        }
        return { ...item, quantity, unitPrice };
    });
    const subtotal = sumMoney(items.map(item => item.unitPrice * item.quantity));
    const deliveryFee = positiveMoney(draft.deliveryFee);
    const serviceFee = positiveMoney(draft.serviceFee);
    const discount = Math.min(positiveMoney(draft.discount), roundMoney(subtotal + deliveryFee + serviceFee));
    const total = roundMoney(subtotal + deliveryFee + serviceFee - discount);
    if (total <= 0) throw new CommerceError('INVALID_ORDER', '订单实付金额必须大于 0');

    const createdAt = Number.isFinite(Number(draft.createdAt)) ? Number(draft.createdAt) : Date.now();
    return {
        ...draft,
        items,
        subtotal,
        deliveryFee,
        serviceFee,
        discount,
        total,
        paymentStatus: 'paid',
        createdAt,
        updatedAt: createdAt,
    };
};

export type DeliveryProgress = 'placed' | 'accepted' | 'delivering' | 'delivered' | 'cancelled' | 'refunded';

/**
 * 配送完全由创建时间推导：8 分钟接单、32 分钟进入配送、约 40 分钟送达。
 * 页面关闭期间不需要后台任务，重新打开仍能得到正确状态。
 */
export const getDeliveryProgress = (order: CommerceOrder, now = Date.now()): DeliveryProgress => {
    if (order.paymentStatus === 'cancelled') return 'cancelled';
    if (order.paymentStatus === 'refunded') return 'refunded';
    const elapsedMinutes = Math.max(0, now - order.createdAt) / 60_000;
    if (elapsedMinutes < 8) return 'placed';
    if (elapsedMinutes < 32) return 'accepted';
    if (elapsedMinutes < 40) return 'delivering';
    return 'delivered';
};

/** 订单历史保留完整数据，列表层只取每家店最新一单。 */
export const latestOrderPerMerchant = (orders: CommerceOrder[]): CommerceOrder[] => {
    const latest = new Map<string, CommerceOrder>();
    for (const order of orders) {
        const current = latest.get(order.merchantId);
        if (!current || order.createdAt > current.createdAt) latest.set(order.merchantId, order);
    }
    return [...latest.values()].sort((a, b) => b.createdAt - a.createdAt);
};
