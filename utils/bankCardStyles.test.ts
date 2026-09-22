import { describe, expect, it } from 'vitest';
import { BANK_CARD_STYLES, DEFAULT_BANK_CARD_STYLE_ID, USER_CALEB_BLUE_CARD_STYLE_ID, USER_CALEB_CARD_STYLE_ID, XIA_YIZHOU_CALEB_CARD_STYLE_ID, XIA_YIZHOU_CARD_STYLE_ID } from './bankCardStyles';

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

    it('uses the dedicated bundled assets for the user Caleb card', () => {
        const style = BANK_CARD_STYLES.find(item => item.id === USER_CALEB_CARD_STYLE_ID);
        expect(style?.artwork?.layout).toBe('user-suica-reference');
        const assetPaths = Object.values(style?.artwork || {})
            .filter((value): value is string => typeof value === 'string' && value.endsWith('.png'));
        expect(assetPaths).toHaveLength(3);
        expect(assetPaths.every(path => path.startsWith('/bank-cards/user/'))).toBe(true);
    });

    it('exposes the blue Caleb export as a selectable bundled card face', () => {
        const style = BANK_CARD_STYLES.find(item => item.id === USER_CALEB_BLUE_CARD_STYLE_ID);
        expect(style?.artwork?.layout).toBe('user-suica-flat');
        expect(style?.artwork?.backgroundImage).toBe('/bank-cards/user/caleb-suica-blue-card.png');
    });
});
