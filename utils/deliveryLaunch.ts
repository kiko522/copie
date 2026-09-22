let pendingOrderId: string | null = null;

/** HTML 卡片唯一获准触发的应用内跳转。 */
export const requestDeliveryOrderOpen = (orderId: string): void => {
  const safe = String(orderId || '').trim();
  if (!safe || safe.length > 220 || !/^[-_a-zA-Z0-9]+$/.test(safe)) return;
  pendingOrderId = safe;
  window.dispatchEvent(new CustomEvent('delivery-order-open', { detail: { orderId: safe } }));
};

export const consumeDeliveryOrderOpen = (): string | null => {
  const value = pendingOrderId;
  pendingOrderId = null;
  return value;
};
