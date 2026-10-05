// Push notifications through Expo's push service (works for Android and iPhone builds).
// The phone app registers an "ExponentPushToken[...]" for the signed-in user; we send to it
// when an order changes. Failures never break an order: they are logged and ignored.
import { all, one, run } from '../db.js';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const enabled = () => process.env.NODE_ENV !== 'test' && process.env.PUSH_DISABLED !== '1';
export const isPushToken = (t) => typeof t === 'string' && /^Expo(nent)?PushToken\[[^\]]{10,200}\]$/.test(t);

const tzs = (n) => `${Math.round(n || 0).toLocaleString('en-US')} TZS`;

/** Send one message to every listed user who has a push token. */
export async function pushToUsers(userIds, title, body, data = {}) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const rows = all(`SELECT id, push_token FROM users WHERE push_token IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`, ...ids);
  const messages = rows.map((r) => ({ to: r.push_token, title, body, data, sound: 'default', channelId: 'orders', priority: 'high' }));
  if (!messages.length || !enabled()) return messages;
  try {
    const res = await fetch(EXPO_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(messages) });
    const out = await res.json().catch(() => ({}));
    // Forget tokens Expo says are no longer valid (app uninstalled, signed out elsewhere).
    (out.data || []).forEach((t, i) => {
      if (t?.details?.error === 'DeviceNotRegistered') run('UPDATE users SET push_token = NULL WHERE push_token = ?', messages[i].to);
    });
  } catch (e) {
    console.warn('Push send failed:', e.message);
  }
  return messages;
}

/** What the client sees for each status. */
export function clientMessage(o, riderName) {
  const first = (riderName || 'Your rider').split(' ')[0];
  return {
    placed: ['Order sent to the station', `${o.code}: ${o.litres} L ${o.product_name} is waiting for the station to accept.`],
    accepted: ['Station accepted your order', 'Finding a rider to bring your fuel.'],
    assigned: [`${first} is collecting your fuel`, 'Track the rider on the map in Wese.'],
    picked_up: ['Your fuel is collected', `${first} is about to leave the station.`],
    on_the_way: [`${first} is on the way`, 'Open Wese to watch them on the map.'],
    arrived: [`${first} has arrived`, 'Give your 4-digit code only after the fuel is in your tank.'],
    delivered: ['Fuel delivered', `Thank you for using Wese. Total paid: ${tzs(o.total)}.`],
    cancelled: ['Order cancelled', o.payment_status === 'refunded' ? 'Your payment has been refunded.' : (o.cancel_reason || 'Your order was cancelled.')],
    rejected: ['The station declined your order', `${o.cancel_reason || 'Declined'}.${o.payment_status === 'refunded' ? ' Your payment has been refunded.' : ''}`],
  }[o.status] || null;
}

/** Called after an order changes; sends each status's messages once. */
export function notifyOrder(o) {
  if (!o || o.notified_status === o.status) return;
  run('UPDATE orders SET notified_status = ? WHERE id = ?', o.status, o.id);
  const rider = o.rider_id ? one('SELECT name FROM users WHERE id = ?', o.rider_id) : null;
  const msg = clientMessage(o, rider?.name);
  const data = { orderId: o.id, status: o.status };
  if (msg) pushToUsers([o.client_id], msg[0], msg[1], data);

  if (o.status === 'accepted') {
    // New job for this station's online riders with the right vehicle.
    const riders = all('SELECT user_id FROM riders WHERE station_id = ? AND vehicle = ? AND active = 1 AND online = 1', o.station_id, o.delivery_method).map((r) => r.user_id);
    pushToUsers(riders, `New job: ${o.litres} L ${o.product_name}`, `${o.landmark || 'Client location'} · ${o.distance_km} km · you earn ${tzs(o.rider_earning)}`, { ...data, kind: 'job' });
  }
  if (['cancelled', 'rejected'].includes(o.status) && o.rider_id) {
    pushToUsers([o.rider_id], 'Job cancelled', `${o.code} was cancelled. Do not deliver it.`, { ...data, kind: 'job' });
  }
}
