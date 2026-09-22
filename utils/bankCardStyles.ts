import { BankCardStyle } from '../types';

export const XIA_YIZHOU_CARD_STYLE_ID = 'xia-yizhou-flightline';

/**
 * 原创虚拟卡面种子。只借用常见金融配色，不复制任何真实银行卡版式或商标。
 * 后续增加卡面只需追加 style，不需要迁移用户已创建的银行卡。
 */
export const BANK_CARD_STYLES: BankCardStyle[] = [
    {
        id: XIA_YIZHOU_CARD_STYLE_ID,
        name: '夏以昼 · 破晓航线',
        background: 'linear-gradient(135deg,#06152f,#0b3f9d 58%,#f28a22)',
        foreground: '#f8fbff',
        muted: '#bfdbfe',
        artwork: {
            backgroundImage: '/bank-cards/xia-yizhou/flightline-background.png',
            portraitImage: '/bank-cards/xia-yizhou/portrait-cutout.png',
            primarySignatureImage: '/bank-cards/xia-yizhou/signature-zh.png',
            secondarySignatureImage: '/bank-cards/xia-yizhou/signature-en.png',
            overlay: 'linear-gradient(90deg,rgba(2,9,25,.42) 0%,rgba(2,9,25,.08) 48%,rgba(2,9,25,.18) 100%)',
        },
    },
    { id: 'crimson-gold', name: '绛红鎏金', background: 'linear-gradient(135deg,#7f1d1d,#dc2626 56%,#f59e0b)', foreground: '#fff7ed', muted: '#fed7aa' },
    { id: 'ocean-business', name: '深海商务', background: 'linear-gradient(135deg,#0f172a,#1d4ed8 58%,#38bdf8)', foreground: '#f8fafc', muted: '#bae6fd' },
    { id: 'obsidian-gold', name: '曜石黑金', background: 'linear-gradient(135deg,#09090b,#27272a 58%,#a16207)', foreground: '#fef3c7', muted: '#d6d3d1' },
    { id: 'silver-mist', name: '银雾', background: 'linear-gradient(135deg,#475569,#cbd5e1 60%,#f8fafc)', foreground: '#0f172a', muted: '#334155' },
    { id: 'forest-life', name: '森屿生活', background: 'linear-gradient(135deg,#064e3b,#059669 58%,#a7f3d0)', foreground: '#ecfdf5', muted: '#d1fae5' },
    { id: 'violet-digital', name: '紫电数字', background: 'linear-gradient(135deg,#312e81,#7c3aed 58%,#e879f9)', foreground: '#faf5ff', muted: '#e9d5ff' },
    { id: 'rose-link', name: '蔷薇联名', background: 'linear-gradient(135deg,#9d174d,#f472b6 58%,#fbcfe8)', foreground: '#fff1f2', muted: '#fce7f3' },
    { id: 'midnight-blue', name: '午夜蓝', background: 'linear-gradient(135deg,#020617,#0f3b74 58%,#94a3b8)', foreground: '#f8fafc', muted: '#cbd5e1' },
];

export const DEFAULT_BANK_CARD_STYLE_ID = BANK_CARD_STYLES[0].id;
