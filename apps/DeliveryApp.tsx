import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft, CaretRight, Check, Clock, ForkKnife, House, MagnifyingGlass,
    MapPin, Minus, Package, Plus, Receipt, ShoppingCart, UserCircle, Wallet,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import type { BankCard, CommerceOrder, DeliveryAddress } from '../types';
import { AppID } from '../types';
import { DB } from '../utils/db';
import { CommerceError, getDeliveryProgress, latestOrderPerMerchant, type DeliveryProgress } from '../utils/commerce';
import { DELIVERY_CATEGORIES, DELIVERY_STORES, findDeliveryStore, type DeliveryCatalogStore } from '../utils/deliveryCatalog';
import { formatMoney, sumMoney } from '../utils/format';
import DeliveryProductArt from '../components/delivery/DeliveryProductArt';
import Modal from '../components/os/Modal';
import TokenImg from '../components/os/TokenImg';

type View = 'home' | 'store' | 'checkout' | 'orders' | 'order';
type CartState = Record<string, Record<string, number>>;

const makeId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const statusCopy: Record<DeliveryProgress, { title: string; subtitle: string }> = {
    placed: { title: '商家确认中', subtitle: '预计下单后 8 分钟接单' },
    accepted: { title: '商家备餐中', subtitle: '餐品正在准备，请稍等' },
    delivering: { title: '骑手配送中', subtitle: '订单正在送往收货地址' },
    delivered: { title: '已送达', subtitle: '餐品已经送到，记得及时取餐' },
    cancelled: { title: '订单已取消', subtitle: '本单已停止配送' },
    refunded: { title: '退款完成', subtitle: '款项已退回原付款卡' },
};

const progressSteps = ['已下单', '已接单', '配送中', '已送达'];
const progressIndex: Record<DeliveryProgress, number> = { placed: 0, accepted: 1, delivering: 2, delivered: 3, cancelled: 0, refunded: 0 };

const DeliveryApp: React.FC = () => {
    const { closeApp, openApp, characters, userProfile, addToast } = useOS();
    const owners = useMemo(() => [
        { id: 'user', name: userProfile.name || '我', avatar: userProfile.avatar },
        ...characters.map(char => ({ id: char.id, name: char.name, avatar: char.avatar })),
    ], [characters, userProfile.avatar, userProfile.name]);

    const [view, setView] = useState<View>('home');
    const [category, setCategory] = useState<(typeof DELIVERY_CATEGORIES)[number]>('全部');
    const [query, setQuery] = useState('');
    const [storeId, setStoreId] = useState<string | null>(null);
    const [cart, setCart] = useState<CartState>({});
    const [recipientOwnerId, setRecipientOwnerId] = useState('user');
    const [addresses, setAddresses] = useState<DeliveryAddress[]>([]);
    const [cards, setCards] = useState<BankCard[]>([]);
    const [orders, setOrders] = useState<CommerceOrder[]>([]);
    const [selectedAddressId, setSelectedAddressId] = useState('');
    const [selectedCardId, setSelectedCardId] = useState('');
    const [selectedOrderId, setSelectedOrderId] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [now, setNow] = useState(Date.now());

    const [showRecipient, setShowRecipient] = useState(false);
    const [showAddress, setShowAddress] = useState(false);
    const [addressOwnerId, setAddressOwnerId] = useState('user');
    const [addressLabel, setAddressLabel] = useState('家');
    const [recipientName, setRecipientName] = useState(userProfile.name || '我');
    const [phone, setPhone] = useState('');
    const [addressLine, setAddressLine] = useState('');

    const loadCommerce = useCallback(async () => {
        const [nextAddresses, nextCards, nextOrders] = await Promise.all([
            DB.getDeliveryAddresses(), DB.getBankCards('user'), DB.getCommerceOrders({ type: 'delivery' }),
        ]);
        setAddresses(nextAddresses);
        setCards(nextCards);
        setOrders(nextOrders);
    }, []);

    useEffect(() => { void loadCommerce(); }, [loadCommerce]);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(timer);
    }, []);

    const currentStore = storeId ? findDeliveryStore(storeId) || null : null;
    const currentCart = currentStore ? (cart[currentStore.id] || {}) : {};
    const cartItems = currentStore ? currentStore.products
        .filter(product => (currentCart[product.id] || 0) > 0)
        .map(product => ({ product, quantity: currentCart[product.id] })) : [];
    const subtotal = sumMoney(cartItems.map(item => item.product.price * item.quantity));
    const total = currentStore ? sumMoney([subtotal, currentStore.deliveryFee]) : 0;
    const recipientAddresses = addresses.filter(address => address.ownerId === recipientOwnerId);
    const selectedAddress = recipientAddresses.find(address => address.id === selectedAddressId)
        || recipientAddresses.find(address => address.isDefault)
        || recipientAddresses[0];
    const selectedCard = cards.find(card => card.id === selectedCardId)
        || cards.find(card => card.isDefault)
        || cards[0];
    const selectedOrder = orders.find(order => order.id === selectedOrderId) || null;

    useEffect(() => {
        if (selectedAddress && selectedAddress.id !== selectedAddressId) setSelectedAddressId(selectedAddress.id);
        if (!selectedAddress && selectedAddressId) setSelectedAddressId('');
    }, [selectedAddress, selectedAddressId]);
    useEffect(() => {
        if (selectedCard && selectedCard.id !== selectedCardId) setSelectedCardId(selectedCard.id);
        if (!selectedCard && selectedCardId) setSelectedCardId('');
    }, [selectedCard, selectedCardId]);

    const visibleStores = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return DELIVERY_STORES.filter(store =>
            (category === '全部' || store.category === category)
            && (!needle || store.name.toLowerCase().includes(needle) || store.subtitle.toLowerCase().includes(needle)
                || store.products.some(product => product.name.toLowerCase().includes(needle)))
        );
    }, [category, query]);

    const changeQuantity = (targetStore: DeliveryCatalogStore, productId: string, delta: number) => {
        setCart(previous => {
            const storeCart = previous[targetStore.id] || {};
            const quantity = Math.max(0, (storeCart[productId] || 0) + delta);
            const nextStore = { ...storeCart };
            if (quantity) nextStore[productId] = quantity;
            else delete nextStore[productId];
            return { ...previous, [targetStore.id]: nextStore };
        });
    };

    const openStore = (store: DeliveryCatalogStore) => {
        setStoreId(store.id);
        setView('store');
    };

    const chooseRecipient = (ownerId: string) => {
        const ownerAddresses = addresses.filter(address => address.ownerId === ownerId);
        if (ownerId !== 'user' && ownerAddresses.length === 0) return;
        setRecipientOwnerId(ownerId);
        setSelectedAddressId(ownerAddresses.find(address => address.isDefault)?.id || ownerAddresses[0]?.id || '');
        setShowRecipient(false);
    };

    const beginAddress = (ownerId = recipientOwnerId) => {
        const owner = owners.find(item => item.id === ownerId);
        setAddressOwnerId(ownerId);
        setRecipientName(owner?.name || '收货人');
        setAddressLabel('家');
        setPhone('');
        setAddressLine('');
        setShowRecipient(false);
        setShowAddress(true);
    };

    const saveAddress = async () => {
        if (!recipientName.trim() || !addressLine.trim()) {
            addToast('请填写收货人和详细地址', 'error');
            return;
        }
        const nowAtSave = Date.now();
        const address: DeliveryAddress = {
            id: makeId('address'), ownerId: addressOwnerId, label: addressLabel.trim() || '地址',
            recipientName: recipientName.trim(), phone: phone.trim() || undefined,
            addressLine: addressLine.trim(), isDefault: true, createdAt: nowAtSave, updatedAt: nowAtSave,
        };
        await DB.saveDeliveryAddress(address);
        await loadCommerce();
        setRecipientOwnerId(addressOwnerId);
        setSelectedAddressId(address.id);
        setShowAddress(false);
        addToast('收货地址已保存', 'success');
    };

    const goCheckout = () => {
        if (!currentStore || cartItems.length === 0) return;
        if (subtotal < currentStore.minimumOrder) {
            addToast(`还差 ¥${formatMoney(currentStore.minimumOrder - subtotal)} 起送`, 'info');
            return;
        }
        setView('checkout');
    };

    const submitOrder = async () => {
        if (!currentStore || cartItems.length === 0 || !selectedAddress || !selectedCard || submitting) return;
        setSubmitting(true);
        try {
            const result = await DB.checkoutCommerceOrder({
                id: makeId('delivery'), type: 'delivery', payerOwnerId: 'user', recipientOwnerId,
                merchantId: currentStore.id, merchantName: currentStore.name,
                items: cartItems.map(({ product, quantity }) => ({
                    productId: product.id, name: product.name, quantity, unitPrice: product.price, imageKey: product.imageKey,
                })),
                deliveryFee: currentStore.deliveryFee, serviceFee: 0, discount: 0,
                cardId: selectedCard.id,
                deliveryAddress: {
                    id: selectedAddress.id, ownerId: selectedAddress.ownerId, label: selectedAddress.label,
                    recipientName: selectedAddress.recipientName, phone: selectedAddress.phone,
                    addressLine: selectedAddress.addressLine, latitude: selectedAddress.latitude, longitude: selectedAddress.longitude,
                },
                source: 'user',
            });
            setCart(previous => ({ ...previous, [currentStore.id]: {} }));
            await loadCommerce();
            setSelectedOrderId(result.order.id);
            setView('order');
            addToast('下单成功，商家正在确认', 'success');
        } catch (error) {
            const message = error instanceof CommerceError ? error.message : '下单失败，请稍后重试';
            addToast(message, 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const refundOrder = async (order: CommerceOrder) => {
        if (!window.confirm('确认申请退款？款项会立即退回原付款卡。')) return;
        try {
            await DB.refundCommerceOrder(order.id);
            await loadCommerce();
            addToast('退款已退回原付款卡', 'success');
        } catch (error) {
            addToast(error instanceof Error ? error.message : '退款失败', 'error');
        }
    };

    const goBack = () => {
        if (view === 'home') closeApp();
        else if (view === 'store') setView('home');
        else if (view === 'checkout') setView('store');
        else if (view === 'order') setView('orders');
        else setView('home');
    };

    const Header = ({ title, subtitle }: { title: string; subtitle?: string }) => (
        <div className="shrink-0 bg-gradient-to-b from-[#ff7a18] to-[#ff9a3d] px-4 pb-4 pt-[calc(var(--safe-top)+0.75rem)] text-white shadow-sm">
            <div className="flex items-center gap-3">
                <button onClick={goBack} className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/18 active:scale-95"><ArrowLeft size={19} weight="bold" /></button>
                <div className="min-w-0 flex-1"><h1 className="truncate text-lg font-black">{title}</h1>{subtitle && <p className="truncate text-[10px] text-white/75">{subtitle}</p>}</div>
                {(view === 'home' || view === 'store') && <button onClick={() => setShowRecipient(true)} className="flex max-w-[42%] items-center gap-1.5 rounded-full bg-white/18 px-3 py-2 text-xs font-bold">
                    <UserCircle size={15} weight="fill" /><span className="truncate">给 {owners.find(owner => owner.id === recipientOwnerId)?.name || '我'}</span>
                </button>}
            </div>
        </div>
    );

    const renderHome = () => <>
        <Header title="外卖" subtitle="今天想吃点什么？" />
        <div className="flex-1 overflow-y-auto bg-[#f7f7f7] pb-24 no-scrollbar">
            <div className="sticky top-0 z-20 bg-[#f7f7f7]/95 px-4 pb-3 pt-4 backdrop-blur">
                <div className="flex items-center gap-2 rounded-2xl bg-white px-4 py-3 shadow-sm"><MagnifyingGlass size={17} className="text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索店铺或商品" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">{DELIVERY_CATEGORIES.map(item => <button key={item} onClick={() => setCategory(item)} className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-bold ${category === item ? 'bg-[#ff7a18] text-white shadow-sm' : 'bg-white text-slate-600'}`}>{item}</button>)}</div>
            </div>
            <div className="space-y-3 px-4">
                {visibleStores.map(store => <button key={store.id} onClick={() => openStore(store)} className="flex w-full gap-3 rounded-2xl bg-white p-3 text-left shadow-sm active:scale-[0.99]">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl" style={{ background: `${store.accent}18`, color: store.accent }}><ForkKnife size={34} weight="fill" /></div>
                    <div className="min-w-0 flex-1 py-0.5"><div className="flex items-start justify-between gap-2"><h2 className="truncate text-[15px] font-black text-slate-800">{store.name}</h2><span className="shrink-0 text-[10px] text-slate-400">{store.distanceKm.toFixed(1)}km</span></div><p className="mt-1 truncate text-[11px] text-slate-500">{store.subtitle}</p><div className="mt-3 flex items-center gap-2 text-[10px]"><span className="font-bold text-[#ff7a18]">★ {store.rating}</span><span className="text-slate-400">约 {store.etaMinutes} 分钟</span><span className="text-slate-400">配送 ¥{formatMoney(store.deliveryFee)}</span></div></div>
                </button>)}
                {visibleStores.length === 0 && <div className="py-20 text-center text-sm text-slate-400">没有找到相关店铺</div>}
            </div>
        </div>
    </>;

    const renderStore = () => currentStore && <>
        <Header title={currentStore.name} subtitle={`${currentStore.rating} 分 · 约 ${currentStore.etaMinutes} 分钟送达`} />
        <div className="flex-1 overflow-y-auto bg-[#f7f7f7] pb-28 no-scrollbar">
            <div className="m-4 rounded-2xl bg-white p-4 shadow-sm"><div className="text-sm font-black text-slate-800">{currentStore.subtitle}</div><div className="mt-1 text-[11px] text-slate-500">起送 ¥{formatMoney(currentStore.minimumOrder)} · 配送 ¥{formatMoney(currentStore.deliveryFee)}</div></div>
            <div className="space-y-3 px-4">{currentStore.products.map(product => {
                const quantity = currentCart[product.id] || 0;
                return <div key={product.id} className="flex gap-3 rounded-2xl bg-white p-3 shadow-sm">
                    <DeliveryProductArt imageKey={product.imageKey} className="h-24 w-24 shrink-0 rounded-2xl" />
                    <div className="min-w-0 flex-1"><h3 className="text-sm font-black text-slate-800">{product.name}</h3><p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-400">{product.description}</p><p className="mt-1 text-[9px] text-slate-400">月售 {product.monthlySales}</p><div className="mt-2 flex items-center justify-between"><span className="text-base font-black text-[#ff5a1f]">¥{formatMoney(product.price)}</span><div className="flex items-center gap-2">{quantity > 0 && <><button onClick={() => changeQuantity(currentStore, product.id, -1)} className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white"><Minus size={13} weight="bold" /></button><span className="w-4 text-center text-xs font-bold">{quantity}</span></>}<button onClick={() => changeQuantity(currentStore, product.id, 1)} className="flex h-7 w-7 items-center justify-center rounded-full bg-[#ff7a18] text-white"><Plus size={14} weight="bold" /></button></div></div></div>
                </div>;
            })}</div>
        </div>
        {cartItems.length > 0 && <div className="absolute bottom-[calc(var(--safe-bottom)+0.75rem)] left-4 right-4 z-30 flex items-center gap-3 rounded-2xl bg-slate-900 p-2 pl-4 text-white shadow-xl"><ShoppingCart size={21} weight="fill" /><div className="min-w-0 flex-1"><div className="font-black">¥{formatMoney(total)}</div><div className="text-[9px] text-white/55">已选 {cartItems.reduce((sum, item) => sum + item.quantity, 0)} 件 · 含配送费</div></div><button onClick={goCheckout} className="rounded-xl bg-[#ff7a18] px-5 py-3 text-sm font-black">去结算</button></div>}
    </>;

    const renderCheckout = () => currentStore && <>
        <Header title="确认订单" subtitle={currentStore.name} />
        <div className="flex-1 overflow-y-auto bg-[#f7f7f7] p-4 pb-28 no-scrollbar">
            <section className="rounded-2xl bg-white p-4 shadow-sm"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-black text-slate-800"><MapPin size={18} weight="fill" className="text-[#ff7a18]" />送到哪里</div><button onClick={() => beginAddress()} className="text-xs font-bold text-[#ff7a18]">新增地址</button></div>
                {recipientAddresses.length ? <div className="space-y-2">{recipientAddresses.map(address => <button key={address.id} onClick={() => setSelectedAddressId(address.id)} className={`w-full rounded-xl border p-3 text-left ${selectedAddress?.id === address.id ? 'border-[#ff7a18] bg-orange-50' : 'border-slate-100'}`}><div className="flex items-center justify-between"><span className="text-xs font-black text-slate-800">{address.label} · {address.recipientName}</span>{selectedAddress?.id === address.id && <Check size={15} weight="bold" className="text-[#ff7a18]" />}</div><p className="mt-1 text-[11px] leading-relaxed text-slate-500">{address.addressLine}</p></button>)}</div> : <button onClick={() => beginAddress()} className="w-full rounded-xl border-2 border-dashed border-orange-200 py-5 text-xs font-bold text-[#ff7a18]">先添加一个收货地址</button>}
            </section>

            <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm"><div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-800"><Wallet size={18} weight="fill" className="text-[#ff7a18]" />付款方式</div>
                {cards.length ? <div className="space-y-2">{cards.map(card => <button key={card.id} onClick={() => setSelectedCardId(card.id)} className={`flex w-full items-center justify-between rounded-xl border p-3 text-left ${selectedCard?.id === card.id ? 'border-[#ff7a18] bg-orange-50' : 'border-slate-100'}`}><div><div className="text-xs font-black text-slate-800">{card.nickname} · {card.last4}</div><div className="mt-1 text-[10px] text-slate-400">余额 ¥{formatMoney(card.balance)}</div></div>{selectedCard?.id === card.id && <Check size={15} weight="bold" className="text-[#ff7a18]" />}</button>)}</div> : <button onClick={() => openApp(AppID.Bank)} className="w-full rounded-xl border-2 border-dashed border-orange-200 py-5 text-xs font-bold text-[#ff7a18]">还没有银行卡，去存钱罐开卡</button>}
            </section>

            <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm"><h3 className="mb-3 text-sm font-black text-slate-800">商品明细</h3>{cartItems.map(({ product, quantity }) => <div key={product.id} className="flex items-center justify-between py-2 text-xs"><span className="min-w-0 flex-1 truncate text-slate-600">{product.name} × {quantity}</span><span className="font-bold text-slate-800">¥{formatMoney(product.price * quantity)}</span></div>)}<div className="mt-2 border-t border-dashed border-slate-200 pt-3 text-xs"><div className="flex justify-between py-1 text-slate-500"><span>商品小计</span><span>¥{formatMoney(subtotal)}</span></div><div className="flex justify-between py-1 text-slate-500"><span>配送费</span><span>¥{formatMoney(currentStore.deliveryFee)}</span></div><div className="mt-2 flex items-end justify-between"><span className="font-bold text-slate-800">合计</span><span className="text-xl font-black text-[#ff5a1f]">¥{formatMoney(total)}</span></div></div></section>
        </div>
        <div className="absolute bottom-0 left-0 right-0 z-30 flex items-center gap-3 border-t border-slate-100 bg-white px-4 pb-[calc(var(--safe-bottom)+0.75rem)] pt-3"><div className="flex-1"><span className="text-xs text-slate-400">实付 </span><span className="text-xl font-black text-[#ff5a1f]">¥{formatMoney(total)}</span></div><button disabled={!selectedAddress || !selectedCard || submitting} onClick={() => void submitOrder()} className="rounded-2xl bg-[#ff7a18] px-7 py-3.5 text-sm font-black text-white disabled:bg-slate-300">{submitting ? '提交中…' : '提交订单'}</button></div>
    </>;

    const latestOrders = latestOrderPerMerchant(orders);
    const renderOrders = () => <>
        <Header title="我的订单" subtitle="每家店显示最近一单" />
        <div className="flex-1 overflow-y-auto bg-[#f7f7f7] p-4 pb-24 no-scrollbar">{latestOrders.length ? <div className="space-y-3">{latestOrders.map(order => {
            const progress = getDeliveryProgress(order, now);
            return <button key={order.id} onClick={() => { setSelectedOrderId(order.id); setView('order'); }} className="w-full rounded-2xl bg-white p-4 text-left shadow-sm"><div className="flex items-center justify-between gap-3"><h3 className="truncate text-sm font-black text-slate-800">{order.merchantName}</h3><span className="shrink-0 text-xs font-bold text-[#ff7a18]">{statusCopy[progress].title}</span></div><p className="mt-2 truncate text-[11px] text-slate-500">{order.items.map(item => `${item.name} × ${item.quantity}`).join('、')}</p><div className="mt-3 flex items-center justify-between"><span className="text-[10px] text-slate-400">{new Date(order.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><span className="text-sm font-black text-slate-800">¥{formatMoney(order.total)}</span></div></button>;
        })}</div> : <div className="flex h-full flex-col items-center justify-center text-slate-400"><Receipt size={46} weight="light" /><p className="mt-3 text-sm font-bold">还没有外卖订单</p><button onClick={() => setView('home')} className="mt-4 rounded-full bg-[#ff7a18] px-5 py-2.5 text-xs font-bold text-white">去逛逛</button></div>}</div>
    </>;

    const renderOrder = () => {
        if (!selectedOrder) return renderOrders();
        const progress = getDeliveryProgress(selectedOrder, now);
        const activeStep = progressIndex[progress];
        return <>
            <Header title="订单详情" subtitle={selectedOrder.merchantName} />
            <div className="flex-1 overflow-y-auto bg-[#f7f7f7] p-4 pb-10 no-scrollbar">
                <section className="rounded-2xl bg-gradient-to-br from-[#ff7a18] to-[#ff9f43] p-5 text-white shadow-sm"><div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/18">{progress === 'delivered' ? <House size={25} weight="fill" /> : progress === 'refunded' || progress === 'cancelled' ? <Receipt size={25} weight="fill" /> : <Package size={25} weight="fill" />}</div><div><h2 className="text-lg font-black">{statusCopy[progress].title}</h2><p className="mt-1 text-[11px] text-white/75">{statusCopy[progress].subtitle}</p></div></div>
                    {!['refunded', 'cancelled'].includes(progress) && <div className="mt-6 flex items-start">{progressSteps.map((step, index) => <React.Fragment key={step}><div className="flex w-14 shrink-0 flex-col items-center"><div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-black ${index <= activeStep ? 'bg-white text-[#ff7a18]' : 'bg-white/25 text-white/70'}`}>{index < activeStep ? <Check size={12} weight="bold" /> : index + 1}</div><span className="mt-1.5 text-[9px] font-bold">{step}</span></div>{index < progressSteps.length - 1 && <div className={`mt-3 h-0.5 flex-1 ${index < activeStep ? 'bg-white' : 'bg-white/25'}`} />}</React.Fragment>)}</div>}
                </section>
                <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm"><div className="flex items-start gap-2"><MapPin size={17} weight="fill" className="mt-0.5 shrink-0 text-[#ff7a18]" /><div><div className="text-xs font-black text-slate-800">{selectedOrder.deliveryAddress?.recipientName || '收货人'}</div><div className="mt-1 text-[11px] leading-relaxed text-slate-500">{selectedOrder.deliveryAddress?.addressLine || '未保存地址'}</div></div></div></section>
                <section className="mt-3 rounded-2xl bg-white p-4 shadow-sm"><h3 className="text-sm font-black text-slate-800">{selectedOrder.merchantName}</h3><div className="mt-3 space-y-3">{selectedOrder.items.map(item => <div key={`${item.productId}-${item.skuId || ''}`} className="flex items-center gap-3">{item.imageKey && <DeliveryProductArt imageKey={item.imageKey} className="h-12 w-12 rounded-xl" />}<div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-slate-700">{item.name}</div><div className="mt-0.5 text-[10px] text-slate-400">× {item.quantity}</div></div><span className="text-xs font-bold">¥{formatMoney(item.unitPrice * item.quantity)}</span></div>)}</div><div className="mt-4 border-t border-dashed border-slate-200 pt-3"><div className="flex justify-between text-xs text-slate-500"><span>配送费</span><span>¥{formatMoney(selectedOrder.deliveryFee)}</span></div><div className="mt-2 flex justify-between"><span className="text-sm font-black">实付</span><span className="text-lg font-black text-[#ff5a1f]">¥{formatMoney(selectedOrder.total)}</span></div></div></section>
                <section className="mt-3 rounded-2xl bg-white p-4 text-[11px] text-slate-500 shadow-sm"><div className="flex justify-between py-1"><span>订单编号</span><span className="max-w-[62%] truncate font-mono">{selectedOrder.id}</span></div><div className="flex justify-between py-1"><span>下单时间</span><span>{new Date(selectedOrder.createdAt).toLocaleString('zh-CN')}</span></div><div className="flex justify-between py-1"><span>付款卡</span><span>尾号 {cards.find(card => card.id === selectedOrder.cardId)?.last4 || '已移除'}</span></div></section>
                {selectedOrder.paymentStatus === 'paid' && <button onClick={() => void refundOrder(selectedOrder)} className="mt-4 w-full rounded-2xl border border-slate-200 bg-white py-3 text-xs font-bold text-slate-500">申请退款</button>}
            </div>
        </>;
    };

    return (
        <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#f7f7f7] font-sans text-slate-900">
            {view === 'home' && renderHome()}
            {view === 'store' && renderStore()}
            {view === 'checkout' && renderCheckout()}
            {view === 'orders' && renderOrders()}
            {view === 'order' && renderOrder()}

            {(view === 'home' || view === 'orders') && <nav className="absolute bottom-0 left-0 right-0 z-30 grid grid-cols-2 border-t border-slate-100 bg-white/95 px-8 pb-[calc(var(--safe-bottom)+0.5rem)] pt-2 backdrop-blur"><button onClick={() => setView('home')} className={`flex flex-col items-center gap-1 py-1 text-[10px] font-bold ${view === 'home' ? 'text-[#ff7a18]' : 'text-slate-400'}`}><ForkKnife size={21} weight={view === 'home' ? 'fill' : 'regular'} />外卖</button><button onClick={() => setView('orders')} className={`flex flex-col items-center gap-1 py-1 text-[10px] font-bold ${view === 'orders' ? 'text-[#ff7a18]' : 'text-slate-400'}`}><Receipt size={21} weight={view === 'orders' ? 'fill' : 'regular'} />订单</button></nav>}

            <Modal isOpen={showRecipient} title="给谁点" onClose={() => setShowRecipient(false)}>
                <div className="space-y-2">{owners.map(owner => {
                    const hasAddress = addresses.some(address => address.ownerId === owner.id);
                    const disabled = owner.id !== 'user' && !hasAddress;
                    return <div key={owner.id} className={`flex items-center gap-3 rounded-2xl border p-3 ${disabled ? 'border-slate-100 bg-slate-50 opacity-55' : recipientOwnerId === owner.id ? 'border-orange-300 bg-orange-50' : 'border-slate-100'}`}><button disabled={disabled} onClick={() => chooseRecipient(owner.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><div className="h-10 w-10 overflow-hidden rounded-full bg-slate-100">{owner.avatar ? <TokenImg value={owner.avatar} className="h-full w-full object-cover" /> : <UserCircle size={40} className="text-slate-300" />}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-black text-slate-800">{owner.name}</div><div className="mt-0.5 text-[10px] text-slate-400">{hasAddress ? '已有收货地址' : owner.id === 'user' ? '添加地址后即可下单' : '未填写收货地址'}</div></div>{recipientOwnerId === owner.id && !disabled && <Check size={17} weight="bold" className="text-[#ff7a18]" />}</button>{!hasAddress && <button onClick={() => beginAddress(owner.id)} className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[10px] font-bold text-[#ff7a18] shadow-sm">添加</button>}</div>;
                })}</div>
            </Modal>

            <Modal isOpen={showAddress} title="新增收货地址" onClose={() => setShowAddress(false)} footer={<button onClick={() => void saveAddress()} className="w-full rounded-2xl bg-[#ff7a18] py-3.5 font-black text-white">保存地址</button>}>
                <div className="space-y-4"><label className="block text-xs font-bold text-slate-600">地址标签<input value={addressLabel} onChange={event => setAddressLabel(event.target.value)} placeholder="家 / 公司 / 学校" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 outline-none focus:border-orange-300" /></label><label className="block text-xs font-bold text-slate-600">收货人<input value={recipientName} onChange={event => setRecipientName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 outline-none focus:border-orange-300" /></label><label className="block text-xs font-bold text-slate-600">联系电话（选填）<input inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 outline-none focus:border-orange-300" /></label><label className="block text-xs font-bold text-slate-600">详细地址<textarea value={addressLine} onChange={event => setAddressLine(event.target.value)} rows={3} placeholder="街道、小区、楼栋和门牌号" className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 outline-none focus:border-orange-300" /></label></div>
            </Modal>
        </div>
    );
};

export default DeliveryApp;
