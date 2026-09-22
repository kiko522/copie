import { describe, expect, it } from 'vitest';
import type { BankCard, BankTransaction } from '../types';
import { DB } from './db';

describe('银行 owner 隔离与银行卡持久化', () => {
    it('按 ownerId 读取时不会把角色流水混进用户账本', async () => {
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const userTx: BankTransaction = {
            id: `owner-user-${stamp}`, ownerId: 'user', amount: 20,
            direction: 'expense', kind: 'manual', source: 'manual',
            category: 'general', note: `用户-${stamp}`, timestamp: Date.now(), dateStr: '2026-09-22',
        };
        const charTx: BankTransaction = {
            id: `owner-char-${stamp}`, ownerId: `char-${stamp}`, amount: 30,
            direction: 'expense', kind: 'purchase', source: 'shopping',
            category: 'shopping', note: `角色-${stamp}`, timestamp: Date.now(), dateStr: '2026-09-22',
        };

        await DB.saveTransaction(userTx);
        await DB.saveTransaction(charTx);
        const userRows = await DB.getAllTransactions('user');
        const charRows = await DB.getAllTransactions(charTx.ownerId);

        expect(userRows.some(tx => tx.id === userTx.id)).toBe(true);
        expect(userRows.some(tx => tx.id === charTx.id)).toBe(false);
        expect(charRows.some(tx => tx.id === charTx.id)).toBe(true);

        await DB.deleteTransaction(userTx.id);
        await DB.deleteTransaction(charTx.id);
    });

    it('银行卡按 ownerId 保存、读取并进入完整备份', async () => {
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const card: BankCard = {
            id: `card-${stamp}`, ownerId: `char-${stamp}`, nickname: '日常卡', issuerName: '糯米银行',
            network: 'unionpay', last4: '0522', styleId: 'crimson-gold', balance: 888.888,
            currency: 'CNY', isDefault: true, createdAt: Date.now(), updatedAt: Date.now(),
        };

        await DB.saveBankCard(card);
        const cards = await DB.getBankCards(card.ownerId);
        expect(cards.find(item => item.id === card.id)?.balance).toBe(888.89);

        const backup = await DB.exportFullData();
        expect(backup.bankCards?.some(item => item.id === card.id)).toBe(true);

        await DB.deleteBankCard(card.id);
        expect((await DB.getBankCards(card.ownerId)).some(item => item.id === card.id)).toBe(false);
    });

    it('同一个人只能有一张默认卡', async () => {
        const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const ownerId = `owner-default-${stamp}`;
        const now = Date.now();
        const first: BankCard = {
            id: `card-first-${stamp}`, ownerId, nickname: '一号卡', issuerName: '测试银行',
            network: 'generic', last4: '1001', styleId: 'crimson-gold', balance: 100,
            currency: 'CNY', isDefault: true, createdAt: now, updatedAt: now,
        };
        const second: BankCard = { ...first, id: `card-second-${stamp}`, nickname: '二号卡', last4: '1002', updatedAt: now + 1 };
        await DB.saveBankCard(first);
        await DB.saveBankCard(second);
        const cards = await DB.getBankCards(ownerId);
        expect(cards.filter(card => card.isDefault).map(card => card.id)).toEqual([second.id]);
        await DB.deleteBankCard(first.id);
        await DB.deleteBankCard(second.id);
    });
});
