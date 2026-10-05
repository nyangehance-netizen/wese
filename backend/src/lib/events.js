// Live updates over Server-Sent Events. Each signed-in user can hold open streams;
// we push small "something changed" messages and the app re-fetches what it needs.
import { all } from '../db.js';
import { notifyOrder } from './push.js';

const streams = new Map(); // userId -> Set<res>

export function openStream(req, res, user) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: ready\ndata: {"userId":${user.id}}\n\n`);
  if (!streams.has(user.id)) streams.set(user.id, new Set());
  streams.get(user.id).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    streams.get(user.id)?.delete(res);
  });
}

export function pushTo(userIds, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const id of new Set(userIds)) for (const res of streams.get(id) || []) res.write(msg);
}

/** Tell everyone involved in an order that it changed. */
export function orderChanged(order) {
  notifyOrder(order);
  const staff = all("SELECT id FROM users WHERE role = 'station' AND station_id = ?", order.station_id).map((u) => u.id);
  const riders = all('SELECT user_id AS id FROM riders WHERE station_id = ? AND active = 1', order.station_id).map((u) => u.id);
  pushTo([order.client_id, ...staff, ...riders, order.rider_id].filter(Boolean), 'order', {
    id: order.id, code: order.code, status: order.status, payment_status: order.payment_status,
  });
}

export const streamCount = () => [...streams.values()].reduce((a, s) => a + s.size, 0);
