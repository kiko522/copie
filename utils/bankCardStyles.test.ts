import { describe, expect, it } from 'vitest';
import { BANK_CARD_STYLES, DEFAULT_BANK_CARD_STYLE_ID, XIA_YIZHOU_CALEB_CARD_STYLE_ID, XIA_YIZHOU_CARD_STYLE_ID } from './bankCardStyles';

describe('bank card styles', () => {
    it('keeps style ids unique and the default resolvable', () => {
        const ids = BANK_CARD_STYLES.map(style => style.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain(DEFAULT_BANK_CARD_STYLE_ID);
    });

    it('uses bundled local assets for the Xia Yizhou card', () => {
        for (const styleId of [XIA_YIZHOU_CALEB_CARD_STYLE_ID, XIA_YIZHOU_CARD_STYLE_ID]) {
            const style = BANK_CARD_STYLES.find(item => item.id === styleId);
            expect(style?.artwork).toBeDefined();
            const assetPaths = Object.values(style?.artwork || {})
                .filter((value): value is string => typeof value === 'string' && value.endsWith('.png'));
            expect(assetPaths).toHaveLength(4);
            expect(assetPaths.every(path => path.startsWith('/bank-cards/xia-yizhou/'))).toBe(true);
        }
    });
});
