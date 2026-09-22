import { describe, expect, it } from 'vitest';
import { parseEmojiImportLine } from './emojiImport';

describe('parseEmojiImportLine', () => {
    it('parses the preferred full-width colon format', () => {
        expect(parseEmojiImportLine(' 开心 ： https://img.example.com/happy.png ')).toEqual({
            name: '开心',
            url: 'https://img.example.com/happy.png',
        });
    });

    it('keeps URL punctuation intact', () => {
        expect(parseEmojiImportLine('偷看：https://img.example.com/a--b.gif?v=2')).toEqual({
            name: '偷看',
            url: 'https://img.example.com/a--b.gif?v=2',
        });
    });

    it('keeps the legacy double-hyphen format compatible', () => {
        expect(parseEmojiImportLine('委屈--https://img.example.com/sad.webp')).toEqual({
            name: '委屈',
            url: 'https://img.example.com/sad.webp',
        });
    });

    it('rejects incomplete lines', () => {
        expect(parseEmojiImportLine('https://img.example.com/no-name.png')).toBeNull();
        expect(parseEmojiImportLine('没有链接：')).toBeNull();
    });
});
