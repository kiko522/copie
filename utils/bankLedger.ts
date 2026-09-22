import {
    BankTransaction,
    BankTransactionDirection,
    BankTransactionKind,
    BankTransactionSource,
} from '../types';
import { formatMoney, roundMoney, sumMoney } from './format';

export const USER_BANK_OWNER_ID = 'user';

/**
 * 老存档只有 amount/category/note 等字段，且所有正数都代表用户支出。
 * 所有读写统一经过这里，保证导入旧备份或绕过 v73 升级时仍能安全读取。
 */
export const normalizeBankTransaction = (raw: Partial<BankTransaction> & Pick<BankTransaction, 'id'>): BankTransaction => {
    const rawAmount = Number(raw.amount);
    const amount = Math.abs(roundMoney(Number.isFinite(rawAmount) ? rawAmount : 0));
    // 旧 UI 没有收入类型，但曾允许直接输入负数；这类记录按退款收入保留原本的经济含义。
    const isLegacyNegative = raw.direction === undefined && rawAmount < 0;
    const direction: BankTransactionDirection = raw.direction === 'income' || isLegacyNegative ? 'income' : 'expense';
    const allowedKinds: BankTransactionKind[] = ['manual', 'purchase', 'refund', 'llm_purchase', 'adjustment'];
    const allowedSources: BankTransactionSource[] = ['manual', 'life_record', 'delivery', 'shopping', 'llm', 'migration'];

    return {
        id: raw.id,
        ownerId: typeof raw.ownerId === 'string' && raw.ownerId.trim() ? raw.ownerId : USER_BANK_OWNER_ID,
        amount,
        direction,
        kind: allowedKinds.includes(raw.kind as BankTransactionKind) ? raw.kind as BankTransactionKind : isLegacyNegative ? 'refund' : 'manual',
        source: allowedSources.includes(raw.source as BankTransactionSource) ? raw.source as BankTransactionSource : 'migration',
        ...(raw.cardId ? { cardId: raw.cardId } : {}),
        ...(raw.sourceRef ? { sourceRef: raw.sourceRef } : {}),
        category: typeof raw.category === 'string' && raw.category ? raw.category : 'general',
        note: typeof raw.note === 'string' ? raw.note : '',
        timestamp: Number.isFinite(Number(raw.timestamp)) ? Number(raw.timestamp) : Date.now(),
        dateStr: typeof raw.dateStr === 'string' ? raw.dateStr : '',
    };
};

export const isExpenseTransaction = (tx: Pick<BankTransaction, 'direction'>): boolean =>
    tx.direction === 'expense';

export const isIncomeTransaction = (tx: Pick<BankTransaction, 'direction'>): boolean =>
    tx.direction === 'income';

export const sumTransactionExpenses = (transactions: BankTransaction[]): number =>
    sumMoney(transactions.filter(isExpenseTransaction).map(tx => tx.amount));

export const sumTransactionIncome = (transactions: BankTransaction[]): number =>
    sumMoney(transactions.filter(isIncomeTransaction).map(tx => tx.amount));

export const formatSignedTransactionAmount = (
    tx: Pick<BankTransaction, 'amount' | 'direction'>,
    currency = '¥',
): string => `${tx.direction === 'expense' ? '-' : '+'}${currency}${formatMoney(tx.amount)}`;
