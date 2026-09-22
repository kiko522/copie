import { describe, expect, it } from 'vitest';
import {
    USER_BANK_OWNER_ID,
    formatSignedTransactionAmount,
    normalizeBankTransaction,
    sumTransactionExpenses,
    sumTransactionIncome,
} from './bankLedger';

describe('银行流水兼容与统计', () => {
    it('旧流水自动迁移成用户支出，不改变原金额和内容', () => {
        const tx = normalizeBankTransaction({
            id: 'legacy-1',
            amount: 12.345,
            category: 'general',
            note: '旧奶茶',
            timestamp: 123,
            dateStr: '2026-09-22',
        });

        expect(tx).toMatchObject({
            ownerId: USER_BANK_OWNER_ID,
            amount: 12.35,
            direction: 'expense',
            kind: 'manual',
            source: 'migration',
            note: '旧奶茶',
        });
    });

    it('支出与收入分开统计，退款按收入显示', () => {
        const rows = [
            normalizeBankTransaction({ id: 'expense', amount: 25, direction: 'expense', kind: 'manual', source: 'manual' }),
            normalizeBankTransaction({ id: 'income', amount: 100, direction: 'income', kind: 'manual', source: 'manual' }),
            normalizeBankTransaction({ id: 'refund', amount: 8.8, direction: 'income', kind: 'refund', source: 'shopping' }),
        ];

        expect(sumTransactionExpenses(rows)).toBe(25);
        expect(sumTransactionIncome(rows)).toBe(108.8);
        expect(formatSignedTransactionAmount(rows[0])).toBe('-¥25.00');
        expect(formatSignedTransactionAmount(rows[2])).toBe('+¥8.80');
    });

    it('旧版负数流水保留为退款收入，不会被翻成正向支出', () => {
        const tx = normalizeBankTransaction({ id: 'legacy-refund', amount: -19.9, note: '旧退款' });
        expect(tx).toMatchObject({ amount: 19.9, direction: 'income', kind: 'refund', source: 'migration' });
        expect(formatSignedTransactionAmount(tx)).toBe('+¥19.90');
    });
});
