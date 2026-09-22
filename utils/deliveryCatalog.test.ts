import { describe, expect, it } from 'vitest';
import { DELIVERY_CATEGORIES, DELIVERY_STORES, findDeliveryStore } from './deliveryCatalog';

describe('delivery catalog', () => {
    it('covers every delivery category with local products', () => {
        const categories = DELIVERY_CATEGORIES.filter(item => item !== '全部');
        expect(new Set(DELIVERY_STORES.map(store => store.category))).toEqual(new Set(categories));
        expect(DELIVERY_STORES.every(store => store.products.length >= 3)).toBe(true);
        expect(DELIVERY_STORES.flatMap(store => store.products).every(product => product.imageKey && product.price > 0)).toBe(true);
    });

    it('keeps store and product ids unique', () => {
        const storeIds = DELIVERY_STORES.map(store => store.id);
        const productIds = DELIVERY_STORES.flatMap(store => store.products.map(product => product.id));
        expect(new Set(storeIds).size).toBe(storeIds.length);
        expect(new Set(productIds).size).toBe(productIds.length);
        expect(findDeliveryStore(storeIds[0])?.id).toBe(storeIds[0]);
    });
});
