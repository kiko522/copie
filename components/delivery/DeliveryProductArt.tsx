import React from 'react';

const paletteFor = (key: string): [string, string, string] => {
    if (key.includes('tea') || key === 'coffee') return ['#fef3c7', '#0f766e', '#fdba74'];
    if (key.includes('cake') || key === 'tiramisu' || key === 'pudding') return ['#fff1f2', '#db2777', '#fbbf24'];
    if (key.includes('flower') || key === 'plant') return ['#f5f3ff', '#7e22ce', '#22c55e'];
    if (key === 'fruit' || key === 'vegetable' || key === 'egg') return ['#f0fdf4', '#16a34a', '#fb923c'];
    if (key === 'bandage' || key === 'thermometer' || key === 'heat') return ['#ecfeff', '#0891b2', '#fb7185'];
    if (key === 'soda' || key === 'chips' || key === 'tissue') return ['#eff6ff', '#2563eb', '#facc15'];
    return ['#fff7ed', '#ea580c', '#ef4444'];
};

const FoodGlyph: React.FC<{ kind: string; accent: string; detail: string }> = ({ kind, accent, detail }) => {
    if (kind.includes('tea') || kind === 'coffee' || kind === 'soda') return <>
        <path d="M34 26h32l-3 48H37z" fill="white" stroke={accent} strokeWidth="4" />
        <path d="M39 51h24l-1.5 20h-21z" fill={detail} opacity=".75" />
        <path d="M46 24l12-12" stroke={accent} strokeWidth="4" strokeLinecap="round" />
        <circle cx="45" cy="43" r="4" fill={detail} /><circle cx="56" cy="48" r="3" fill={accent} />
    </>;
    if (kind.includes('cake') || kind === 'tiramisu' || kind === 'pudding') return <>
        <path d="M24 61h54l-8 18H31z" fill={accent} opacity=".24" />
        <path d="M30 39h40v27H30z" fill="white" stroke={accent} strokeWidth="4" />
        <path d="M30 48h40" stroke={detail} strokeWidth="7" />
        <circle cx="50" cy="32" r="8" fill={detail} /><path d="M50 24c3-7 8-8 12-6" stroke={accent} strokeWidth="3" fill="none" />
    </>;
    if (kind.includes('flower') || kind === 'plant') return <>
        <path d="M38 55h25l-4 26H42z" fill="white" stroke={accent} strokeWidth="4" />
        <path d="M50 57V29M49 45L36 34M51 42l14-13" stroke="#15803d" strokeWidth="4" strokeLinecap="round" />
        <circle cx="34" cy="29" r="11" fill={detail} /><circle cx="67" cy="25" r="12" fill={accent} /><circle cx="51" cy="24" r="11" fill="#fbbf24" />
    </>;
    if (kind === 'fruit' || kind === 'vegetable' || kind === 'egg') return <>
        <path d="M22 46h56l-7 33H29z" fill="white" stroke={accent} strokeWidth="4" />
        <path d="M32 48c2-15 14-25 18-25 7 0 17 11 18 25" fill={detail} opacity=".82" />
        <circle cx="39" cy="46" r="12" fill="#ef4444" /><circle cx="59" cy="43" r="12" fill="#facc15" />
    </>;
    if (kind === 'bandage' || kind === 'thermometer' || kind === 'heat') return <>
        <rect x="19" y="38" width="62" height="25" rx="12" fill="white" stroke={accent} strokeWidth="4" transform="rotate(-18 50 50)" />
        <rect x="40" y="39" width="20" height="22" rx="5" fill={detail} transform="rotate(-18 50 50)" />
        <circle cx="47" cy="46" r="2" fill="white" /><circle cx="53" cy="53" r="2" fill="white" />
    </>;
    if (kind === 'chips' || kind === 'tissue') return <>
        <path d="M30 19h40l5 62H25z" fill="white" stroke={accent} strokeWidth="4" />
        <circle cx="50" cy="49" r="15" fill={detail} /><path d="M42 49h16M50 41v16" stroke="white" strokeWidth="4" strokeLinecap="round" />
    </>;
    return <>
        <ellipse cx="50" cy="61" rx="32" ry="20" fill="white" stroke={accent} strokeWidth="4" />
        <path d="M25 54c9-20 41-20 50 0" fill={detail} opacity=".86" />
        <circle cx="42" cy="49" r="6" fill="#fef3c7" /><circle cx="58" cy="45" r="5" fill="#22c55e" />
        <path d="M24 64h52" stroke={accent} strokeWidth="3" opacity=".5" />
    </>;
};

const DeliveryProductArt: React.FC<{ imageKey: string; className?: string }> = ({ imageKey, className = '' }) => {
    const [background, accent, detail] = paletteFor(imageKey);
    return (
        <svg viewBox="0 0 100 100" role="img" aria-label="" className={className} style={{ background }}>
            <circle cx="83" cy="17" r="16" fill={detail} opacity=".16" />
            <circle cx="15" cy="82" r="21" fill={accent} opacity=".10" />
            <FoodGlyph kind={imageKey} accent={accent} detail={detail} />
        </svg>
    );
};

export default DeliveryProductArt;
