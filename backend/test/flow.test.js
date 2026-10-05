// End-to-end test of the whole order flow against a real server and in-memory database.
process.env.NODE_ENV = 'test';
process.env.TEST_AUTO_APPROVE_MS = '0';
process.env.PORT = '0';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { createApp } = await import('../src/app.js');
const { run } = await import('../src/db.js');
const { hashPassword } = await import('../src/lib/auth.js');
const { clearPaymentTimers } = await import('../src/payments/index.js');

let server, base;
before(async () => {
  run("INSERT INTO users (name, phone, password_hash, role) VALUES ('Admin','255700000000',?,'admin')", hashPassword('admin123'));
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { clearPaymentTimers(); server.close(); });

async function api(method, path, body, token) {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}
const ok = async (...a) => { const r = await api(...a); assert.ok(r.status < 300, `${a[0]} ${a[1]} → ${r.status} ${JSON.stringify(r.data)}`); return r.data; };

test('client orders fuel, station accepts, rider delivers with the code', async () => {
  // Station signs up and registers
  const st = await ok('POST', '/api/auth/register', { name: 'Rehema', phone: '0713 000 001', password: 'secret1', role: 'station' });
  const T = st.token;
  let s = await ok('POST', '/api/stations', { name: 'Mwenge Energies', license_no: 'EWURA/1', phone: '0713000001', address: 'Mwenge', lat: -6.768, lng: 39.226, offers_tanker: true }, T);
  assert.equal(s.status, 'pending');

  // Admin approves
  const admin = await ok('POST', '/api/auth/login', { phone: '0700000000', password: 'admin123' });
  await ok('POST', `/api/admin/stations/${s.id}/status`, { status: 'approved' }, admin.token);

  // Station sets up products, payments and a rider
  s = await ok('POST', '/api/station/products', { name: 'Petrol', fuel_type: 'petrol', price_per_litre: 2900, stock_litres: 1000 }, T);
  const petrol = s.products[0];
  await ok('PUT', '/api/station/payment-methods/mpesa', { enabled: true, account: 'Lipa 551204' }, T);
  assert.equal((await api('PUT', '/api/station/payment-methods/bank', { enabled: true }, T)).status, 400, 'bank needs an account');
  await ok('PUT', '/api/station/payment-methods/bank', { enabled: true, account: 'CRDB 0150' }, T);
  await ok('POST', '/api/station/riders', { name: 'Juma', phone: '0754000011', password: 'rider123', vehicle: 'boda', plate: 'mc 712 cvb' }, T);

  // Rider signs in and goes online
  const rider = await ok('POST', '/api/auth/login', { phone: '0754000011', password: 'rider123' });
  const R = rider.token;
  await ok('POST', '/api/rider/status', { online: true, lat: -6.768, lng: 39.226 }, R);

  // Client finds stations
  const c = await ok('POST', '/api/auth/register', { name: 'Asha', phone: '0754123456', password: 'client1' });
  const C = c.token;
  const near = await ok('GET', '/api/stations/nearby?lat=-6.765&lng=39.248&fuel=petrol&litres=15&delivery=boda', null, C);
  const opt = near.stations[0];
  assert.ok(opt.available, JSON.stringify(opt));
  assert.equal(opt.quote.fuelCost, 2900 * 15);

  // Client orders and pays (test mode, approved manually)
  const placed = await ok('POST', '/api/orders', {
    station_id: opt.station_id, product_id: opt.product_id, litres: 15, delivery_method: 'boda',
    lat: -6.765, lng: 39.248, landmark: 'Shoppers Plaza', plate: 't 482 dkp', vehicle_type: 'Car', payment_method: 'mpesa',
  }, C);
  const o = placed.order;
  assert.equal(o.status, 'awaiting_payment');
  assert.match(o.otp, /^\d{4}$/);
  assert.equal((await api('POST', `/api/orders/${o.id}/accept`, {}, T)).status, 409, 'cannot accept unpaid');
  await ok('POST', `/api/payments/test/${placed.payment.reference}/approve`, {}, C);
  assert.equal((await ok('GET', `/api/orders/${o.id}`, null, C)).status, 'placed');

  // A second active order is refused
  assert.equal((await api('POST', '/api/orders', { station_id: opt.station_id, product_id: opt.product_id, litres: 10, delivery_method: 'boda', lat: -6.765, lng: 39.248, plate: 'T1', payment_method: 'mpesa' }, C)).status, 409);

  // Station sees it without the code, accepts, stock drops
  const stOrders = await ok('GET', '/api/station/orders', null, T);
  assert.equal(stOrders[0].otp, undefined);
  await ok('POST', `/api/orders/${o.id}/accept`, {}, T);
  assert.equal((await ok('GET', '/api/station', null, T)).products[0].stock_litres, 985);

  // Rider takes it and moves through the steps
  const jobs = await ok('GET', '/api/rider/jobs', null, R);
  assert.equal(jobs.length, 1);
  await ok('POST', `/api/orders/${o.id}/take`, {}, R);
  for (const expected of ['picked_up', 'on_the_way', 'arrived']) assert.equal((await ok('POST', `/api/orders/${o.id}/advance`, {}, R)).status, expected);

  // Wrong code is refused, right code delivers
  assert.equal((await api('POST', `/api/orders/${o.id}/deliver`, { otp: '0000' }, R)).status, 400);
  const delivered = await ok('POST', `/api/orders/${o.id}/deliver`, { otp: o.otp }, R);
  assert.equal(delivered.status, 'delivered');

  const me = await ok('GET', '/api/rider', null, R);
  assert.equal(me.today.trips, 1);
  assert.ok(me.today.earned > 0);
  const stats = await ok('GET', '/api/station/stats', null, T);
  assert.equal(stats.litres, 15);

  // Bank transfer order: station must confirm, then declines → refunded
  const bank = await ok('POST', '/api/orders', {
    station_id: opt.station_id, product_id: opt.product_id, litres: 10, delivery_method: 'boda',
    lat: -6.765, lng: 39.248, plate: 'T 482 DKP', payment_method: 'bank',
  }, C);
  assert.equal(bank.order.status, 'placed');
  assert.equal(bank.order.payment_status, 'pending');
  await ok('POST', `/api/orders/${bank.order.id}/confirm-transfer`, {}, T);
  const rej = await ok('POST', `/api/orders/${bank.order.id}/reject`, { reason: 'Pump maintenance' }, T);
  assert.equal(rej.status, 'rejected');
  assert.equal(rej.payment_status, 'refunded');

  // Other clients cannot see someone else's order
  const other = await ok('POST', '/api/auth/register', { name: 'Peter', phone: '0688210555', password: 'peter12' });
  assert.equal((await api('GET', `/api/orders/${o.id}`, null, other.token)).status, 403);
});

test('rejects bad input clearly', async () => {
  const r = await api('POST', '/api/auth/register', { name: 'X', phone: '123', password: 'abcdef' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Name|phone/i);
  assert.equal((await api('GET', '/api/me')).status, 401);
});

test('locked delivery code: station finishes the order; admin finds, cancels and refunds orders', async () => {
  const T = (await ok('POST', '/api/auth/login', { phone: '0713000001', password: 'secret1' })).token;
  const R = (await ok('POST', '/api/auth/login', { phone: '0754000011', password: 'rider123' })).token;
  const A = (await ok('POST', '/api/auth/login', { phone: '0700000000', password: 'admin123' })).token;
  const C = (await ok('POST', '/api/auth/register', { name: 'Halima Abdallah', phone: '0713440201', password: 'halima1' })).token;
  const st = await ok('GET', '/api/station', null, T);
  const p = st.products[0];
  const mk = async () => {
    const r = await ok('POST', '/api/orders', { station_id: st.id, product_id: p.id, litres: 10, delivery_method: 'boda', lat: -6.778, lng: 39.219, plate: 'T 119 DSR', payment_method: 'mpesa' }, C);
    await ok('POST', `/api/payments/test/${r.payment.reference}/approve`, {}, C);
    return r.order;
  };

  // Lock the code with 5 wrong tries
  const o = await mk();
  await ok('POST', `/api/orders/${o.id}/accept`, {}, T);
  await ok('POST', `/api/orders/${o.id}/take`, {}, R);
  for (let i = 0; i < 3; i++) await ok('POST', `/api/orders/${o.id}/advance`, {}, R);
  assert.equal((await api('POST', `/api/orders/${o.id}/complete-locked`, { note: 'client said ok' }, T)).status, 409, 'not locked yet');
  for (let i = 0; i < 4; i++) assert.equal((await api('POST', `/api/orders/${o.id}/deliver`, { otp: '0000' }, R)).status, 400);
  assert.equal((await api('POST', `/api/orders/${o.id}/deliver`, { otp: '0000' }, R)).status, 429, '5th wrong code locks');
  assert.equal((await api('POST', `/api/orders/${o.id}/deliver`, { otp: o.otp }, R)).status, 429, 'stays locked even with the right code');
  const seen = (await ok('GET', '/api/station/orders', null, T)).find((x) => x.id === o.id);
  assert.equal(seen.code_locked, true);
  assert.equal((await api('POST', `/api/orders/${o.id}/complete-locked`, { note: '' }, T)).status, 400, 'needs a note');
  const fin = await ok('POST', `/api/orders/${o.id}/complete-locked`, { note: 'Client confirmed by phone at 14:20' }, T);
  assert.equal(fin.status, 'delivered');
  assert.match(fin.events.at(-1).note, /Finished by station/);

  // Admin search by code and by local phone number
  assert.equal((await ok('GET', `/api/admin/orders?q=${o.code}`, null, A))[0].id, o.id);
  assert.ok((await ok('GET', '/api/admin/orders?q=0713%20440%20201', null, A)).some((x) => x.id === o.id));
  assert.equal((await api('GET', '/api/admin/orders', null, T)).status, 403, 'stations cannot use admin search');

  // Admin refunds the delivered order (complaint)
  assert.equal((await api('POST', `/api/admin/orders/${o.id}/refund`, { reason: '' }, A)).status, 400);
  const ref = await ok('POST', `/api/admin/orders/${o.id}/refund`, { reason: 'Complaint: short fill' }, A);
  assert.equal(ref.payment_status, 'refunded');
  assert.equal((await api('POST', `/api/admin/orders/${o.id}/refund`, { reason: 'again' }, A)).status, 409, 'no double refund');

  // Admin cancels an accepted order: refund + stock back
  const o2 = await mk();
  await ok('POST', `/api/orders/${o2.id}/accept`, {}, T);
  const before = (await ok('GET', '/api/station', null, T)).products[0].stock_litres;
  const c2 = await ok('POST', `/api/admin/orders/${o2.id}/cancel`, { reason: 'Station reported pump fault' }, A);
  assert.equal(c2.status, 'cancelled');
  assert.equal(c2.payment_status, 'refunded');
  assert.equal((await ok('GET', '/api/station', null, T)).products[0].stock_litres, before + 10);
  assert.ok((await ok('GET', '/api/admin/orders?status=open', null, A)).every((x) => !['delivered', 'cancelled', 'rejected'].includes(x.status)));
});

test('push tokens are stored and order messages are prepared', async () => {
  const { pushToUsers, clientMessage } = await import('../src/lib/push.js');
  const { one: get } = await import('../src/db.js');
  const reg = await ok('POST', '/api/auth/register', { name: 'Push Tester', phone: '0716000001', password: 'push123' });
  assert.equal((await api('PUT', '/api/me/push-token', { token: 'not-a-token' }, reg.token)).status, 400);
  await ok('PUT', '/api/me/push-token', { token: 'ExponentPushToken[abcdefghijklmnop]' }, reg.token);
  const msgs = await pushToUsers([reg.user.id], 'Hello', 'World');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].to, 'ExponentPushToken[abcdefghijklmnop]');
  await ok('PUT', '/api/me/push-token', { token: null }, reg.token);
  assert.equal(get('SELECT push_token FROM users WHERE id = ?', reg.user.id).push_token, null);
  assert.match(clientMessage({ status: 'arrived', code: 'WS-1', total: 1 }, 'Juma Mrisho')[0], /Juma has arrived/);
  // Every order that reached a status was marked as notified once
  assert.equal(get("SELECT COUNT(*) AS n FROM orders WHERE status != notified_status").n, 0);
});
