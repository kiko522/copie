import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDeliveryEligibility, normalizeDeliveryIntent } from '../src/delivery.mjs';

const snapshot = {
  deliveryAutonomy: {
    enabled: true,
    paymentReady: true,
    allowedAddresses: [{ id: 'home', recipient: 'user', label: '家' }],
    recentPlacedAt: [],
    catalog: [{
      id: 'tea', name: '茶店', minimumOrder: 15, deliveryFee: 2,
      products: [{ id: 'milk-tea', name: '奶茶', price: 16 }],
    }],
  },
};

test('delivery eligibility is isolated per character history and enforces pending/cooldowns', () => {
  const now = 2_000_000_000_000;
  assert.equal(evaluateDeliveryEligibility(snapshot, [], now).allowed, true);
  assert.equal(evaluateDeliveryEligibility(snapshot, [{ status: 'pending', createdAt: now - 1_000 }], now).reason, 'pending_confirmation');
  assert.equal(evaluateDeliveryEligibility(snapshot, [{ status: 'placed', createdAt: now - 60_000, resolvedAt: now - 60_000 }], now).reason, 'six_hour_cooldown');
  assert.equal(evaluateDeliveryEligibility(snapshot, [
    { status: 'placed', createdAt: now - 20 * 60 * 60_000 },
    { status: 'placed', createdAt: now - 8 * 60 * 60_000 },
  ], now).reason, 'rolling_24h_limit');
});

test('delivery intent only accepts whitelisted address, store and catalog items', () => {
  assert.deepEqual(normalizeDeliveryIntent(snapshot, {
    addressId: 'home', storeId: 'tea', items: [{ productId: 'milk-tea', quantity: 1 }],
  }), {
    type: 'delivery_order', addressId: 'home', storeId: 'tea', items: [{ productId: 'milk-tea', quantity: 1 }],
  });
  assert.equal(normalizeDeliveryIntent(snapshot, { addressId: 'other', storeId: 'tea', items: [{ productId: 'milk-tea', quantity: 1 }] }), null);
  assert.equal(normalizeDeliveryIntent(snapshot, { addressId: 'home', storeId: 'tea', items: [{ productId: 'invented', quantity: 1 }] }), null);
});
