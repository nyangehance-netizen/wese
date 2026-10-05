// Orders: the life of a fuel request from client → station → rider → delivered.
//
//   awaiting_payment ──paid──▶ placed ──station accepts──▶ accepted ──rider takes──▶ assigned
//        │                       │  └─station declines─▶ rejected (refund)
//        └─payment fails─▶ cancelled   └─client cancels──▶ cancelled (refund)
//   assigned ▶ picked_up ▶ on_the_way ▶ arrived ──rider enters client's code──▶ delivered
//
// Bank-transfer orders start at "placed" with payment pending; the station confirms the
// transfer before it can accept.
import { randomInt } from 'node:crypto';
import { one, all, run, tx } from '../db.js';
import { config, PAYMENT_METHODS } from '../config.js';
import { requireUser } from '../lib/auth.js';
import { bad, conflict, forbidden, notFound, HttpError, str, numIn, oneOf, phone } from '../lib/http.js';
import { roadKm, priceOrder } from '../lib/geo.js';
import { orderChanged } from '../lib/events.js';
import { startPayment, settle, refundOrder } from '../payments/index.js';

export const STATUS_LABELS = {
  awaiting_payment: 'Waiting for payment', placed: 'Waiting for station', accepted: 'Finding a rider',
  assigned: 'Rider heading to station', picked_up: 'Fuel collected', on_the_way: 'On the way', arrived: 'Rider arrived',
  delivered: 'Delivered', cancelled: 'Cancelled', rejected: 'Declined by station',
};
const RIDER_STEPS = { assigned: 'picked_up', picked_up: 'on_the_way', on_the_way: 'arrived' };

/** What a given user is allowed to see of an order. */
export function orderView(o, viewer) {
  const s = one('SELECT id, name, phone, address, lat, lng FROM stations WHERE id = ?', o.station_id);
  const rider = o.rider_id ? one(`SELECT u.id, u.name, u.phone, r.vehicle, r.plate, r.lat, r.lng, r.last_seen
                                  FROM users u JOIN riders r ON r.user_id = u.id WHERE u.id = ?`, o.rider_id) : null;
  const client = one('SELECT name FROM users WHERE id = ?', o.client_id);
  const v = {
    id: o.id, code: o.code, status: o.status, status_label: STATUS_LABELS[o.status],
    product_name: o.product_name, fuel_type: o.fuel_type, litres: o.litres, price_per_litre: o.price_per_litre,
    fuel_cost: o.fuel_cost, delivery_method: o.delivery_method, delivery_fee: o.delivery_fee, service_fee: o.service_fee, total: o.total,
    distance_km: o.distance_km, lat: o.lat, lng: o.lng, address: o.address, landmark: o.landmark,
    plate: o.plate, vehicle_type: o.vehicle_type, payment_method: o.payment_method,
    payment_label: PAYMENT_METHODS[o.payment_method]?.label, payment_status: o.payment_status,
    cancel_reason: o.cancel_reason, created_at: o.created_at, updated_at: o.updated_at,
    station: s, rider, client_name: client?.name,
    events: all('SELECT status, note, at FROM order_events WHERE order_id = ? ORDER BY id', o.id),
  };
  if (viewer.role === 'client') {
    v.otp = ['delivered', 'cancelled', 'rejected'].includes(o.status) ? null : o.otp;
    const pay = one('SELECT reference, provider, method, status FROM payments WHERE order_id = ? ORDER BY id DESC', o.id);
    if (pay) v.payment = { ...pay, test_mode: pay.provider === 'test' };
    if (o.payment_method === 'bank' && o.payment_status === 'pending') {
      v.bank_account = one("SELECT account FROM station_payment_methods WHERE station_id = ? AND method = 'bank'", o.station_id)?.account;
    }
  }
  else v.contact_phone = o.contact_phone;
  if (viewer.role === 'station' || viewer.role === 'admin') {
    v.otp_attempts = o.otp_attempts;
    v.code_locked = o.status === 'arrived' && o.otp_attempts >= config.otpMaxAttempts;
  }
  if (viewer.role === 'admin') {
    v.client_phone = one('SELECT phone FROM users WHERE id = ?', o.client_id)?.phone;
    v.payments = all('SELECT reference, provider, method, amount, status, created_at FROM payments WHERE order_id = ? ORDER BY id', o.id);
  }
  if (viewer.role === 'rider') {
    v.rider_earning = o.rider_earning;
    // Riders see trip details, not the client's money breakdown.
    delete v.service_fee;
  }
  return v;
}

function loadFor(user, id) {
  const o = one('SELECT * FROM orders WHERE id = ?', id);
  if (!o) throw notFound('Order not found.');
  const ok = (user.role === 'client' && o.client_id === user.id)
    || (user.role === 'station' && o.station_id === user.station_id)
    || (user.role === 'rider' && (o.rider_id === user.id || (o.station_id === user.station_id && o.status === 'accepted')))
    || user.role === 'admin';
  if (!ok) throw forbidden();
  return o;
}

/** Move an order to a new status if it is currently in one of `from`. */
function move(o, from, to, actorId, note, extra = {}) {
  const cur = one('SELECT status FROM orders WHERE id = ?', o.id).status;
  if (!from.includes(cur)) throw conflict(`This order is already "${STATUS_LABELS[cur]}".`);
  const keys = Object.keys(extra);
  run(`UPDATE orders SET status = ?, ${keys.map((k) => `${k} = ?, `).join('')}updated_at = datetime('now') WHERE id = ?`, to, ...Object.values(extra), o.id);
  run('INSERT INTO order_events (order_id, status, actor_id, note) VALUES (?,?,?,?)', o.id, to, actorId, note || null);
  return one('SELECT * FROM orders WHERE id = ?', o.id);
}

function restock(o) {
  if (o.stock_deducted) {
    run('UPDATE products SET stock_litres = stock_litres + ? WHERE id = ?', o.litres, o.product_id);
    run('UPDATE orders SET stock_deducted = 0 WHERE id = ?', o.id);
  }
}

const done = (o, user) => { orderChanged(o); return orderView(o, user); };

export default (r) => {
  // ---------- Client ----------
  r.post('/api/orders', requireUser('client'), async ({ user, body }) => {
    const station = one("SELECT * FROM stations WHERE id = ? AND status = 'approved' AND is_open = 1", body.station_id);
    if (!station) throw bad('That station is not taking orders right now.');
    const product = one('SELECT * FROM products WHERE id = ? AND station_id = ? AND active = 1 AND deleted = 0', body.product_id, station.id);
    if (!product) throw bad('That fuel is not available at this station.');
    const method = oneOf(body.delivery_method, 'Delivery method', Object.keys(config.delivery));
    const d = config.delivery[method];
    if (!station[`offers_${method}`]) throw bad(`This station does not deliver by ${d.label.toLowerCase()}.`);
    const litres = numIn(body.litres, 'Litres', { min: d.minLitres, max: d.maxLitres });
    if (product.stock_litres < litres) throw bad('The station does not have enough fuel in stock for this order.');
    const lat = numIn(body.lat, 'Latitude', { min: -90, max: 90 });
    const lng = numIn(body.lng, 'Longitude', { min: -180, max: 180 });
    const km = roadKm(lat, lng, station.lat, station.lng);
    if (km > config.maxDeliveryKm) throw bad(`You are ${km} km away. This station delivers up to ${config.maxDeliveryKm} km.`);
    const payMethod = oneOf(body.payment_method, 'Payment method', Object.keys(PAYMENT_METHODS));
    if (!one('SELECT 1 FROM station_payment_methods WHERE station_id = ? AND method = ? AND enabled = 1', station.id, payMethod)) {
      throw bad(`This station does not accept ${PAYMENT_METHODS[payMethod].label}.`);
    }
    const active = one("SELECT code FROM orders WHERE client_id = ? AND status IN ('awaiting_payment','placed','accepted','assigned','picked_up','on_the_way','arrived')", user.id);
    if (active) throw conflict(`You already have an active order (${active.code}).`);

    const contact = phone(body.contact_phone || user.phone, 'Contact phone');
    const payPhone = PAYMENT_METHODS[payMethod].kind === 'mobile' ? phone(body.payment_phone || contact, 'Payment phone') : contact;
    const price = priceOrder({ pricePerLitre: product.price_per_litre, litres, method, km });
    const isBank = PAYMENT_METHODS[payMethod].kind === 'bank';

    const order = tx(() => {
      const { lastInsertRowid: id } = run(`INSERT INTO orders (client_id, station_id, product_id, product_name, fuel_type, litres, price_per_litre,
          fuel_cost, delivery_method, delivery_fee, service_fee, total, rider_earning, distance_km, lat, lng, address, landmark,
          plate, vehicle_type, contact_phone, payment_method, payment_status, status, otp)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        user.id, station.id, product.id, product.name, product.fuel_type, litres, product.price_per_litre,
        price.fuelCost, method, price.deliveryFee, price.serviceFee, price.total, price.riderEarning, km, lat, lng,
        str(body.address ?? '', 'Address', { min: 0, max: 200, optional: true }),
        str(body.landmark ?? '', 'Landmark', { min: 0, max: 200, optional: true }),
        str(body.plate, 'Plate number', { max: 20 }).toUpperCase(),
        str(body.vehicle_type || 'Car', 'Vehicle type', { max: 30 }),
        contact, payMethod, isBank ? 'pending' : 'unpaid', isBank ? 'placed' : 'awaiting_payment',
        String(randomInt(1000, 10000)));
      run('UPDATE orders SET code = ? WHERE id = ?', 'WS-' + String(id).padStart(6, '0'), id);
      run('INSERT INTO order_events (order_id, status, actor_id, note) VALUES (?,?,?,?)', id, isBank ? 'placed' : 'awaiting_payment', user.id, 'Order created');
      return one('SELECT * FROM orders WHERE id = ?', id);
    });

    const payment = await startPayment(order, payPhone);
    const fresh = one('SELECT * FROM orders WHERE id = ?', order.id);
    orderChanged(fresh);
    return { order: orderView(fresh, user), payment };
  });

  r.get('/api/orders', requireUser('client'), ({ user }) =>
    all('SELECT * FROM orders WHERE client_id = ? ORDER BY id DESC LIMIT 50', user.id).map((o) => orderView(o, user)));

  r.get('/api/orders/:id', requireUser(), ({ user, params }) => orderView(loadFor(user, params.id), user));

  r.post('/api/orders/:id/cancel', requireUser('client', 'station'), async ({ user, params, body }) => {
    const o = loadFor(user, params.id);
    const from = user.role === 'client' ? ['awaiting_payment', 'placed'] : ['placed', 'accepted', 'assigned'];
    const reason = str(body.reason || (user.role === 'client' ? 'Cancelled by client' : 'Cancelled by station'), 'Reason', { max: 200 });
    const out = tx(() => { const n = move(o, from, 'cancelled', user.id, reason, { cancel_reason: reason }); restock(n); return n; });
    if (out.payment_status === 'paid') await refundOrder(out);
    else if (out.payment_status === 'pending' || out.payment_status === 'unpaid') {
      run("UPDATE payments SET status = 'failed', updated_at = datetime('now') WHERE order_id = ? AND status = 'pending'", o.id);
    }
    return done(one('SELECT * FROM orders WHERE id = ?', o.id), user);
  });

  // ---------- Station ----------
  r.post('/api/orders/:id/confirm-transfer', requireUser('station'), ({ user, params }) => {
    const o = loadFor(user, params.id);
    if (o.payment_method !== 'bank' || o.payment_status !== 'pending') throw conflict('There is no bank transfer waiting to be confirmed on this order.');
    const pay = one("SELECT reference FROM payments WHERE order_id = ? AND status = 'pending'", o.id);
    settle(pay.reference, 'paid', { confirmedBy: user.id });
    return orderView(one('SELECT * FROM orders WHERE id = ?', o.id), user);
  });

  r.post('/api/orders/:id/accept', requireUser('station'), ({ user, params }) => {
    const o = loadFor(user, params.id);
    if (o.payment_status !== 'paid') throw conflict('Confirm the payment before accepting this order.');
    const out = tx(() => {
      const p = one('SELECT stock_litres FROM products WHERE id = ?', o.product_id);
      if (p.stock_litres < o.litres) throw conflict('Not enough stock. Update your stock or decline the order.');
      const n = move(o, ['placed'], 'accepted', user.id, 'Station accepted', { stock_deducted: 1 });
      run('UPDATE products SET stock_litres = stock_litres - ? WHERE id = ?', o.litres, o.product_id);
      return n;
    });
    return done(out, user);
  });

  r.post('/api/orders/:id/reject', requireUser('station'), async ({ user, params, body }) => {
    const o = loadFor(user, params.id);
    const reason = str(body.reason || 'Declined by station', 'Reason', { max: 200 });
    const out = tx(() => move(o, ['placed'], 'rejected', user.id, reason, { cancel_reason: reason }));
    if (out.payment_status === 'paid') await refundOrder(out);
    else run("UPDATE payments SET status = 'failed', updated_at = datetime('now') WHERE order_id = ? AND status = 'pending'", o.id);
    return done(one('SELECT * FROM orders WHERE id = ?', o.id), user);
  });

  // ---------- Rider ----------
  r.get('/api/rider', requireUser('rider'), ({ user }) => {
    const rd = one('SELECT * FROM riders WHERE user_id = ?', user.id);
    const station = one('SELECT id, name, address, lat, lng, phone FROM stations WHERE id = ?', rd.station_id);
    const current = one("SELECT * FROM orders WHERE rider_id = ? AND status IN ('assigned','picked_up','on_the_way','arrived')", user.id);
    const today = one(`SELECT COUNT(*) AS trips, COALESCE(SUM(rider_earning),0) AS earned FROM orders
                       WHERE rider_id = ? AND status = 'delivered' AND date(updated_at, '+3 hours') = date('now', '+3 hours')`, user.id);
    return { name: user.name, phone: user.phone, ...rd, station, current: current ? orderView(current, user) : null, today };
  });

  r.post('/api/rider/status', requireUser('rider'), ({ user, body }) => {
    const rd = one('SELECT * FROM riders WHERE user_id = ?', user.id);
    if (!rd.active) throw forbidden('Your station has switched off this account.');
    const f = { last_seen: new Date().toISOString() };
    if (body.online !== undefined) f.online = body.online ? 1 : 0;
    if (body.lat !== undefined) { f.lat = numIn(body.lat, 'Latitude', { min: -90, max: 90 }); f.lng = numIn(body.lng, 'Longitude', { min: -180, max: 180 }); }
    const keys = Object.keys(f);
    run(`UPDATE riders SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE user_id = ?`, ...Object.values(f), user.id);
    const cur = one("SELECT * FROM orders WHERE rider_id = ? AND status IN ('assigned','picked_up','on_the_way','arrived')", user.id);
    if (cur && f.lat !== undefined) orderChanged(cur); // lets the client see the rider move
    return one('SELECT online, lat, lng, last_seen FROM riders WHERE user_id = ?', user.id);
  });

  r.get('/api/rider/jobs', requireUser('rider'), ({ user }) => {
    const rd = one('SELECT * FROM riders WHERE user_id = ?', user.id);
    if (!rd.online) return [];
    return all("SELECT * FROM orders WHERE station_id = ? AND status = 'accepted' AND delivery_method = ? ORDER BY id", rd.station_id, rd.vehicle)
      .map((o) => orderView(o, user));
  });

  r.get('/api/rider/history', requireUser('rider'), ({ user }) =>
    all("SELECT * FROM orders WHERE rider_id = ? AND status = 'delivered' ORDER BY id DESC LIMIT 50", user.id).map((o) => orderView(o, user)));

  r.post('/api/orders/:id/take', requireUser('rider'), ({ user, params }) => {
    const o = loadFor(user, params.id);
    const rd = one('SELECT * FROM riders WHERE user_id = ?', user.id);
    if (!rd.online) throw conflict('Go online before taking jobs.');
    if (rd.vehicle !== o.delivery_method) throw conflict('This job needs a different vehicle.');
    const out = tx(() => {
      if (one("SELECT 1 FROM orders WHERE rider_id = ? AND status IN ('assigned','picked_up','on_the_way','arrived')", user.id)) {
        throw conflict('Finish your current job first.');
      }
      return move(o, ['accepted'], 'assigned', user.id, `Taken by ${user.name}`, { rider_id: user.id });
    });
    return done(out, user);
  });

  r.post('/api/orders/:id/advance', requireUser('rider'), ({ user, params }) => {
    const o = loadFor(user, params.id);
    if (o.rider_id !== user.id) throw forbidden();
    const next = RIDER_STEPS[o.status];
    if (!next) throw conflict(o.status === 'arrived' ? 'Enter the client\'s code to finish this delivery.' : 'This job cannot move forward.');
    return done(tx(() => move(o, [o.status], next, user.id)), user);
  });

  // ---------- Station or admin: finish an order whose delivery code locked ----------
  r.post('/api/orders/:id/complete-locked', requireUser('station', 'admin'), ({ user, params, body }) => {
    const o = loadFor(user, params.id);
    if (o.status !== 'arrived') throw conflict('Only an order whose rider has arrived can be finished this way.');
    if (o.otp_attempts < config.otpMaxAttempts) throw conflict("The rider can still enter the client's code.");
    const note = str(body.note, 'How delivery was confirmed', { min: 5, max: 200 });
    const who = user.role === 'admin' ? 'Wese admin' : 'station';
    return done(tx(() => move(o, ['arrived'], 'delivered', user.id, `Finished by ${who} after the code locked: ${note}`)), user);
  });

  // ---------- Admin: find any order, cancel it, refund it ----------
  r.get('/api/admin/orders', requireUser('admin'), ({ user, query }) => {
    const where = [], args = [];
    const q = String(query.q || '').trim();
    if (q) {
      const digits = q.replace(/\D/g, '');
      const ph = /^0[67]\d+$/.test(digits) ? '255' + digits.slice(1) : digits;
      const like = `%${q.toUpperCase()}%`;
      where.push('(UPPER(o.code) LIKE ? OR UPPER(o.plate) LIKE ? OR UPPER(u.name) LIKE ?' + (ph.length >= 4 ? ' OR o.contact_phone LIKE ? OR u.phone LIKE ?' : '') + ')');
      args.push(like, like, like);
      if (ph.length >= 4) args.push(`%${ph}%`, `%${ph}%`);
    }
    if (query.status === 'open') where.push("o.status IN ('awaiting_payment','placed','accepted','assigned','picked_up','on_the_way','arrived')");
    else if (query.status) { where.push('o.status = ?'); args.push(oneOf(query.status, 'Status', Object.keys(STATUS_LABELS))); }
    const rows = all(`SELECT o.* FROM orders o JOIN users u ON u.id = o.client_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 100`, ...args);
    return rows.map((o) => orderView(o, user));
  });

  r.post('/api/admin/orders/:id/cancel', requireUser('admin'), async ({ user, params, body }) => {
    const o = loadFor(user, params.id);
    const reason = str(body.reason, 'Reason', { min: 3, max: 200 });
    const open = ['awaiting_payment', 'placed', 'accepted', 'assigned', 'picked_up', 'on_the_way', 'arrived'];
    const out = tx(() => {
      const n = move(o, open, 'cancelled', user.id, `Cancelled by Wese admin: ${reason}`, { cancel_reason: reason });
      if (['accepted', 'assigned'].includes(o.status)) restock(n); // fuel not collected yet
      return n;
    });
    if (out.payment_status === 'paid') await refundOrder(out);
    else run("UPDATE payments SET status = 'failed', updated_at = datetime('now') WHERE order_id = ? AND status = 'pending'", o.id);
    return done(one('SELECT * FROM orders WHERE id = ?', o.id), user);
  });

  r.post('/api/admin/orders/:id/refund', requireUser('admin'), async ({ user, params, body }) => {
    const o = loadFor(user, params.id);
    const reason = str(body.reason, 'Reason', { min: 3, max: 200 });
    if (o.payment_status !== 'paid') throw conflict('There is no completed payment on this order to refund.');
    await refundOrder(o);
    run('INSERT INTO order_events (order_id, status, actor_id, note) VALUES (?,?,?,?)', o.id, o.status, user.id, `Refunded by Wese admin: ${reason}`);
    return done(one('SELECT * FROM orders WHERE id = ?', o.id), user);
  });

  r.post('/api/orders/:id/deliver', requireUser('rider'), ({ user, params, body }) => {
    const o = loadFor(user, params.id);
    if (o.rider_id !== user.id) throw forbidden();
    if (o.status !== 'arrived') throw conflict('Mark yourself as arrived first.');
    const locked = 'Too many wrong codes. Call the client to confirm the fuel is in, then ask your station to finish the order from its dashboard.';
    if (o.otp_attempts >= config.otpMaxAttempts) throw new HttpError(429, locked);
    if (String(body.otp ?? '').trim() !== o.otp) {
      run('UPDATE orders SET otp_attempts = otp_attempts + 1 WHERE id = ?', o.id);
      const left = config.otpMaxAttempts - o.otp_attempts - 1;
      if (left <= 0) {
        run("INSERT INTO order_events (order_id, status, actor_id, note) VALUES (?, 'arrived', ?, 'Delivery code locked after too many wrong tries')", o.id, user.id);
        orderChanged(one('SELECT * FROM orders WHERE id = ?', o.id)); // alerts the station dashboard
        throw new HttpError(429, locked);
      }
      throw bad(`That code doesn't match. ${left} ${left === 1 ? 'try' : 'tries'} left.`);
    }
    return done(tx(() => move(o, ['arrived'], 'delivered', user.id, 'Client confirmed with code')), user);
  });
};
