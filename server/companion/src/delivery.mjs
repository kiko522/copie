export const DELIVERY_WINDOW_MS = 24 * 60 * 60_000;
export const DELIVERY_MIN_INTERVAL_MS = 6 * 60 * 60_000;
export const DELIVERY_MAX_PER_WINDOW = 2;

const uniqueTimes = (times) => [...times]
  .filter(Number.isFinite)
  .sort((a, b) => a - b)
  .filter((value, index, rows) => index === 0 || value - rows[index - 1] > 5 * 60_000);

export const evaluateDeliveryEligibility = (snapshot, records = [], now = Date.now()) => {
  const config = snapshot?.deliveryAutonomy;
  if (!config?.enabled || config.paymentReady !== true) return { allowed: false, reason: 'disabled' };
  if (!Array.isArray(config.allowedAddresses) || config.allowedAddresses.length === 0) return { allowed: false, reason: 'no_address' };
  if (!Array.isArray(config.catalog) || config.catalog.length === 0) return { allowed: false, reason: 'no_catalog' };
  if (records.some((row) => row.status === 'pending')) return { allowed: false, reason: 'pending_confirmation' };
  const placedAt = uniqueTimes([
    ...records.filter((row) => row.status === 'placed').map((row) => Number(row.resolvedAt || row.createdAt)),
    ...(Array.isArray(config.recentPlacedAt) ? config.recentPlacedAt.map(Number) : []),
  ]).filter((value) => now - value >= 0 && now - value < DELIVERY_WINDOW_MS);
  if (placedAt.length >= DELIVERY_MAX_PER_WINDOW) return { allowed: false, reason: 'rolling_24h_limit' };
  const latest = placedAt.at(-1);
  if (latest && now - latest < DELIVERY_MIN_INTERVAL_MS) return { allowed: false, reason: 'six_hour_cooldown' };
  return { allowed: true, reason: 'ok', placedInWindow: placedAt.length };
};

export const normalizeDeliveryIntent = (snapshot, raw) => {
  const config = snapshot?.deliveryAutonomy;
  if (!config?.enabled || !raw || typeof raw !== 'object') return null;
  const addressId = String(raw.addressId || '');
  const storeId = String(raw.storeId || '');
  if (!config.allowedAddresses?.some((address) => address.id === addressId)) return null;
  const store = config.catalog?.find((entry) => entry.id === storeId);
  if (!store || !Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 5) return null;
  const quantities = new Map();
  for (const row of raw.items) {
    const productId = String(row?.productId || '');
    const quantity = Number(row?.quantity);
    if (!store.products?.some((product) => product.id === productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 5) return null;
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }
  if ([...quantities.values()].some((quantity) => quantity > 5)) return null;
  const items = [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
  const subtotal = items.reduce((sum, item) => {
    const product = store.products.find((entry) => entry.id === item.productId);
    return sum + Number(product.price) * item.quantity;
  }, 0);
  if (!Number.isFinite(subtotal) || subtotal < Number(store.minimumOrder || 0)) return null;
  return { type: 'delivery_order', addressId, storeId, items };
};

export const buildPendingDeliveryMessage = (snapshot, intent) => {
  const store = snapshot.deliveryAutonomy.catalog.find((entry) => entry.id === intent.storeId);
  const names = intent.items.map((item) => {
    const product = store.products.find((entry) => entry.id === item.productId);
    return `${product.name} × ${item.quantity}`;
  }).join('、');
  return `我刚刚想到可以给你点${names}，先让小手机确认一下银行卡、地址和余额。`;
};
