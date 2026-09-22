import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bank, CreditCard, Palette, Plus, Trash } from '@phosphor-icons/react';
import type { BankCard, BankCardStyle, CharacterProfile, UserProfile } from '../../types';
import { DB } from '../../utils/db';
import { BANK_CARD_STYLES, DEFAULT_BANK_CARD_STYLE_ID, isXiaYizhouCardStyle } from '../../utils/bankCardStyles';
import { formatMoney } from '../../utils/format';
import Modal from '../os/Modal';

const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const CardArtwork: React.FC<{ style: BankCardStyle; preview?: boolean }> = ({ style, preview = false }) => {
    if (!style.artwork) return null;
    const { artwork } = style;
    const isCalebReference = artwork.layout === 'caleb-reference';

    if (isCalebReference) {
        const outlineStyle = { WebkitTextStroke: preview ? '0.7px #fff' : '1.25px #fff', color: 'transparent' };
        return (
            <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
                <img src={artwork.backgroundImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
                {artwork.portraitImage && <img src={artwork.portraitImage} alt="" className={`absolute object-contain object-bottom ${preview ? 'bottom-[-15%] right-[-8%] h-[156%] w-[91%]' : 'bottom-[-17%] right-[-9%] h-[168%] w-[94%]'}`} />}
                <div className={`absolute left-[24%] top-[6%] flex items-baseline leading-none text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.16)] ${preview ? 'text-[19px]' : 'text-[36px]'}`}>
                    <span className="font-serif font-normal" style={outlineStyle}>C</span>
                    <span className="ml-[1px] font-sans font-black">a</span>
                    <span className="ml-[1px] font-mono font-light" style={outlineStyle}>l</span>
                    <span className="ml-[1px] font-serif font-black italic">e</span>
                    <span className="ml-[1px] font-sans font-black" style={outlineStyle}>b</span>
                </div>
                {artwork.primarySignatureImage && <img src={artwork.primarySignatureImage} alt="" className={`absolute left-[5%] top-[32%] object-contain brightness-0 invert ${preview ? 'w-[29%]' : 'w-[32%]'}`} />}
                {artwork.secondarySignatureImage && <img src={artwork.secondarySignatureImage} alt="" className={`absolute left-[7%] top-[58%] object-contain brightness-0 invert ${preview ? 'w-[25%]' : 'w-[28%]'}`} />}
            </div>
        );
    }

    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <img src={artwork.backgroundImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0" style={{ background: artwork.overlay }} />
            {artwork.portraitImage && (
                <img
                    src={artwork.portraitImage}
                    alt=""
                    className={`absolute object-contain object-bottom ${preview ? 'bottom-[-7%] right-[-7%] h-[136%] w-[82%]' : 'bottom-[-9%] right-[-9%] h-[146%] w-[88%]'}`}
                />
            )}
            {artwork.primarySignatureImage && (
                <img
                    src={artwork.primarySignatureImage}
                    alt=""
                    className={`absolute left-[5%] object-contain ${preview ? 'top-[38%] w-[30%]' : 'top-[35%] w-[34%]'}`}
                />
            )}
            {artwork.secondarySignatureImage && (
                <img
                    src={artwork.secondarySignatureImage}
                    alt=""
                    className={`absolute left-[7%] object-contain opacity-90 ${preview ? 'top-[69%] w-[25%]' : 'top-[68%] w-[27%]'}`}
                />
            )}
        </div>
    );
};

interface Props {
    characters: CharacterProfile[];
    userProfile: UserProfile;
    addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const BankCardWallet: React.FC<Props> = ({ characters, userProfile, addToast }) => {
    const owners = useMemo(() => [
        { id: 'user', name: userProfile.name || '我' },
        ...characters.map(char => ({ id: char.id, name: char.name })),
    ], [characters, userProfile.name]);
    const [ownerId, setOwnerId] = useState('user');
    const [cards, setCards] = useState<BankCard[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [nickname, setNickname] = useState('日常卡');
    const [issuerName, setIssuerName] = useState('城市生活银行');
    const [last4, setLast4] = useState('0613');
    const [balance, setBalance] = useState('500');
    const [styleId, setStyleId] = useState(DEFAULT_BANK_CARD_STYLE_ID);
    const [stylingCard, setStylingCard] = useState<BankCard | null>(null);

    const loadCards = useCallback(async () => setCards(await DB.getBankCards(ownerId)), [ownerId]);
    useEffect(() => { void loadCards(); }, [loadCards]);

    const saveCard = async () => {
        const value = Number(balance);
        if (!nickname.trim() || !issuerName.trim() || !/^\d{4}$/.test(last4) || !Number.isFinite(value) || value < 0) {
            addToast('请把卡名、机构、四位尾号和余额填写完整', 'error');
            return;
        }
        const now = Date.now();
        await DB.saveBankCard({
            id: makeId('card'), ownerId, nickname: nickname.trim(), issuerName: issuerName.trim(),
            network: isXiaYizhouCardStyle(styleId) ? 'visa' : 'unionpay', last4, styleId, balance: value, currency: 'CNY',
            isDefault: cards.length === 0, createdAt: now, updatedAt: now,
        });
        await loadCards();
        setShowForm(false);
        addToast('银行卡已加入卡包', 'success');
    };

    const setDefault = async (card: BankCard) => {
        await DB.saveBankCard({ ...card, isDefault: true, updatedAt: Date.now() });
        await loadCards();
    };

    const deleteCard = async (card: BankCard) => {
        if (!window.confirm(`删除“${card.nickname}”？已有订单的退款将无法自动退回这张卡。`)) return;
        await DB.deleteBankCard(card.id);
        await loadCards();
        addToast('银行卡已删除', 'success');
    };

    const changeCardStyle = async (nextStyleId: string) => {
        if (!stylingCard) return;
        await DB.saveBankCard({
            ...stylingCard,
            styleId: nextStyleId,
            network: isXiaYizhouCardStyle(nextStyleId) ? 'visa' : stylingCard.network,
            last4: isXiaYizhouCardStyle(nextStyleId) ? '0613' : stylingCard.last4,
            updatedAt: Date.now(),
        });
        await loadCards();
        setStylingCard(null);
        addToast('卡面已更换，余额和流水保持不变', 'success');
    };

    return (
        <section className="mb-4 rounded-2xl border border-[#E8DCC8] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 font-bold text-[#5D4037]"><CreditCard size={18} weight="fill" /> 卡包</div>
                    <div className="mt-0.5 text-[10px] text-[#A1887F]">每个人的卡和流水分别保存</div>
                </div>
                <button onClick={() => setShowForm(true)} className="flex items-center gap-1 rounded-xl bg-[#6D4C41] px-3 py-2 text-xs font-bold text-white active:scale-95">
                    <Plus size={14} weight="bold" /> 开卡
                </button>
            </div>

            <div className="mb-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {owners.map(owner => (
                    <button key={owner.id} onClick={() => setOwnerId(owner.id)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${ownerId === owner.id ? 'bg-[#6D4C41] text-white' : 'bg-[#F5EFE6] text-[#8D6E63]'}`}>
                        {owner.name}
                    </button>
                ))}
            </div>

            {cards.length === 0 ? (
                <button onClick={() => setShowForm(true)} className="flex w-full flex-col items-center rounded-2xl border-2 border-dashed border-[#D7CCC8] py-7 text-[#A1887F]">
                    <Bank size={28} /><span className="mt-2 text-xs font-bold">还没有银行卡，点这里开一张</span>
                </button>
            ) : (
                <div className="space-y-3">
                    {cards.map(card => {
                        const style = BANK_CARD_STYLES.find(item => item.id === card.styleId) || BANK_CARD_STYLES[0];
                        const isCalebReference = style.artwork?.layout === 'caleb-reference';
                        return <div key={card.id} className="relative aspect-[1.586/1] overflow-hidden rounded-2xl p-4 shadow-md" style={{ background: style.background, color: style.foreground }}>
                            <CardArtwork style={style} />
                            {style.artwork && !isCalebReference && <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#020817]/70 via-transparent to-[#020817]/20" aria-hidden="true" />}
                            <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20" aria-hidden="true" />
                            <div className="relative z-10 flex h-full flex-col justify-between">
                            <div className="flex items-start justify-between gap-3">
                                {isCalebReference ? <div /> : style.artwork ? (
                                    <div className="drop-shadow-[0_2px_5px_rgba(0,0,0,.7)]">
                                        <div className="select-none text-[26px] font-black italic leading-none tracking-[-0.1em]" aria-label="Visa">VISA</div>
                                        <div className="mt-2 inline-flex items-baseline gap-1.5 rounded-lg bg-black/15 px-2 py-1 backdrop-blur-[2px]"><span className="text-[8px] opacity-70">余额</span><span className="text-sm font-black">¥{formatMoney(card.balance)}</span></div>
                                    </div>
                                ) : (
                                    <div><div className="text-[10px] font-bold uppercase tracking-widest opacity-70">{card.issuerName}</div><div className="mt-1 text-base font-black">{card.nickname}</div></div>
                                )}
                                <div className="flex gap-1">
                                    <button onClick={() => setStylingCard(card)} aria-label="更换卡面" className="rounded-full bg-black/25 p-1.5 backdrop-blur-sm"><Palette size={12} /></button>
                                    {!card.isDefault && <button onClick={() => void setDefault(card)} className="rounded-full bg-black/25 px-2 py-1 text-[9px] font-bold backdrop-blur-sm">设为默认</button>}
                                    {card.isDefault && <span className="rounded-full bg-black/25 px-2 py-1 text-[9px] font-bold backdrop-blur-sm">默认</span>}
                                    <button onClick={() => void deleteCard(card)} aria-label="删除银行卡" className="rounded-full bg-black/25 p-1.5 backdrop-blur-sm"><Trash size={12} /></button>
                                </div>
                            </div>
                            {isCalebReference ? (
                                <div className="flex items-end justify-between text-white drop-shadow-[0_1px_2px_rgba(0,0,0,.28)]">
                                    <div className="text-[8px] font-bold uppercase tracking-[0.28em]"><div>VISA</div><div className="mt-1">•••• {card.last4}</div></div>
                                    <div className="rounded-lg bg-[#1789c4]/55 px-2 py-1 text-right backdrop-blur-[2px]"><div className="text-[7px] opacity-80">可用余额</div><div className="text-sm font-black">¥{formatMoney(card.balance)}</div></div>
                                </div>
                            ) : (
                                <div className={`flex items-end drop-shadow-[0_1px_3px_rgba(0,0,0,.85)] ${style.artwork ? 'justify-start' : 'justify-between'}`}><div className="font-mono text-sm tracking-[0.22em]">•••• {card.last4}</div>{!style.artwork && <div className="rounded-xl bg-black/20 px-2.5 py-1.5 text-right backdrop-blur-[2px]"><div className="text-[9px] opacity-70">可用余额</div><div className="text-xl font-black">¥{formatMoney(card.balance)}</div></div>}</div>
                            )}
                            </div>
                        </div>;
                    })}
                </div>
            )}

            <Modal isOpen={showForm} title={`给${owners.find(owner => owner.id === ownerId)?.name || '我'}开卡`} onClose={() => setShowForm(false)} footer={
                <button onClick={() => void saveCard()} className="w-full rounded-2xl bg-[#6D4C41] py-3.5 font-bold text-white">保存银行卡</button>
            }>
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs font-bold text-[#8D6E63]">卡片昵称<input value={nickname} onChange={event => setNickname(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#E8DCC8] bg-[#FDF6E3] px-3 py-3 outline-none" /></label>
                        <label className="text-xs font-bold text-[#8D6E63]">卡号尾号<input inputMode="numeric" maxLength={4} value={last4} onChange={event => setLast4(event.target.value.replace(/\D/g, '').slice(0, 4))} className="mt-1.5 w-full rounded-xl border border-[#E8DCC8] bg-[#FDF6E3] px-3 py-3 outline-none" /></label>
                    </div>
                    <label className="block text-xs font-bold text-[#8D6E63]">发卡机构<input value={issuerName} onChange={event => setIssuerName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#E8DCC8] bg-[#FDF6E3] px-3 py-3 outline-none" /></label>
                    <label className="block text-xs font-bold text-[#8D6E63]">初始余额<input type="number" min="0" step="0.01" value={balance} onChange={event => setBalance(event.target.value)} className="mt-1.5 w-full rounded-xl border border-[#E8DCC8] bg-[#FDF6E3] px-3 py-3 text-lg font-black outline-none" /></label>
                    <div><div className="mb-2 text-xs font-bold text-[#8D6E63]">卡面</div><div className="grid grid-cols-2 gap-2">{BANK_CARD_STYLES.map(style => <button key={style.id} onClick={() => setStyleId(style.id)} className={`relative min-h-[76px] overflow-hidden rounded-xl p-3 text-left text-xs font-bold ${styleId === style.id ? 'ring-2 ring-[#6D4C41] ring-offset-2' : ''}`} style={{ background: style.background, color: style.foreground }}><CardArtwork style={style} preview /><span className="relative z-10 inline-block max-w-[72%] rounded-lg bg-black/20 px-2 py-1 drop-shadow-[0_1px_2px_rgba(0,0,0,.8)] backdrop-blur-[1px]">{style.name}</span></button>)}</div></div>
                </div>
            </Modal>

            <Modal isOpen={Boolean(stylingCard)} title={`给“${stylingCard?.nickname || '银行卡'}”换卡面`} onClose={() => setStylingCard(null)}>
                <div className="grid grid-cols-2 gap-3">
                    {BANK_CARD_STYLES.map(style => (
                        <button
                            key={style.id}
                            onClick={() => void changeCardStyle(style.id)}
                            className={`relative min-h-[92px] overflow-hidden rounded-2xl p-3 text-left text-xs font-bold ${stylingCard?.styleId === style.id ? 'ring-2 ring-[#6D4C41] ring-offset-2' : ''}`}
                            style={{ background: style.background, color: style.foreground }}
                        >
                            <CardArtwork style={style} preview />
                            <span className="relative z-10 inline-block max-w-[72%] rounded-lg bg-black/20 px-2 py-1 drop-shadow-[0_1px_2px_rgba(0,0,0,.8)] backdrop-blur-[1px]">{style.name}</span>
                        </button>
                    ))}
                </div>
            </Modal>
        </section>
    );
};

export default BankCardWallet;
