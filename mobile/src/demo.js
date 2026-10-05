// Demo mode: a small copy of the Wese server that runs inside the app with sample data.
// It answers the same API paths as the real backend, so every screen works unchanged.
// The fuel station and the other side of each delivery are simulated on timers.

import { clientMessage } from './messages';

const PAY = {
  mpesa: { label: 'M-Pesa', kind: 'mobile' }, mixx: { label: 'Mixx by Yas', kind: 'mobile' },
  airtel: { label: 'Airtel Money', kind: 'mobile' }, halopesa: { label: 'HaloPesa', kind: 'mobile' },
  card: { label: 'Visa / Mastercard', kind: 'card' }, bank: { label: 'Bank transfer', kind: 'bank' },
};
const DELIVERY = {
  boda: { label: 'Boda (motorbike)', minLitres: 5, maxLitres: 20, baseFee: 3000, perKm: 500, kmh: 28 },
  tanker: { label: 'Mini tanker', minLitres: 30, maxLitres: 1000, baseFee: 15000, perKm: 1500, kmh: 20 },
};
const LABELS = {
  awaiting_payment: 'Waiting for payment', placed: 'Waiting for station', accepted: 'Finding a rider',
  assigned: 'Rider heading to station', picked_up: 'Fuel collected', on_the_way: 'On the way', arrived: 'Rider arrived',
  delivered: 'Delivered', cancelled: 'Cancelled', rejected: 'Declined by station',
};
const MAX_KM = 20;
const HOME = [-6.765, 39.248]; // Mikocheni: sample stations are placed around here
const STATIONS = [
  { id: 1, name: 'Mwenge Energies', address: 'Sam Nujoma Rd, Mwenge', phone: '255713000001', at: [-6.768, 39.226], boda: 1, tanker: 1,
    products: { petrol: [11, 'Petrol', 3796], diesel: [12, 'Diesel', 3877] }, pay: ['mpesa', 'mixx', 'airtel', 'card', 'bank'], bank: 'CRDB 0150 3381 2200' },
  { id: 2, name: 'Bahari Fuel Point', address: 'Chole Rd, Msasani', phone: '255713000002', at: [-6.758, 39.27], boda: 1, tanker: 0,
    products: { petrol: [21, 'Petrol', 3790], diesel: [22, 'Diesel', 3870] }, pay: ['mpesa', 'airtel', 'card'] },
  { id: 3, name: 'Ubungo Petro Hub', address: 'Morogoro Rd, Ubungo', phone: '255713000003', at: [-6.79, 39.205], boda: 1, tanker: 1,
    products: { petrol: [31, 'Petrol', 3780], diesel: [32, 'Diesel', 3860] }, pay: ['mpesa', 'mixx', 'halopesa', 'bank'], bank: 'NMB 2210 4477 901' },
];
const RIDERS = [
  { id: 101, name: 'Juma Mrisho', phone: '255754000011', vehicle: 'boda', plate: 'MC 712 CVB' },
  { id: 102, name: 'Neema Kweka', phone: '255754000012', vehicle: 'tanker', plate: 'T 905 EAZ' },
];
const JOB_CLIENTS = [
  ['Halima A.', '255713440201', 'T 119 DSR', 'Car', 'Opposite Lion Hotel, Sinza', -6.778, 39.219, 10, 'petrol'],
  ['Peter M.', '255688210555', 'T 771 DGA', 'SUV / Pickup', 'Near TMJ Hospital, Mikocheni', -6.763, 39.244, 20, 'diesel'],
  ['Asha K.', '255752330870', 'T 302 DNB', 'Car', 'Rose Garden Rd, Mikocheni', -6.770, 39.252, 15, 'petrol'],
  ['Baraka S.', '255767900112', 'MC 455 CYX', 'Motorcycle', 'Shoppers Plaza parking, Mikocheni', -6.761, 39.249, 5, 'petrol'],
];

class DemoError extends Error {}
const fail = (msg) => { throw new DemoError(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function roadKm(a, b) {
  const R = 6371, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return Math.max(0.5, Math.round(2 * R * Math.asin(Math.sqrt(h)) * 1.35 * 10) / 10);
}
function priceOrder(pricePerLitre, litres, method, km) {
  const d = DELIVERY[method];
  const fuelCost = Math.round(pricePerLitre * litres);
  const deliveryFee = Math.round((d.baseFee + d.perKm * km) / 50) * 50;
  const serviceFee = Math.round(fuelCost * 0.02);
  return { fuelCost, deliveryFee, serviceFee, total: fuelCost + deliveryFee + serviceFee, riderEarning: Math.round(deliveryFee * 0.8), etaMinutes: Math.round(12 + (km / d.kmh) * 60) };
}

// ---------- state ----------
let S = null;
const timers = new Set();
function later(ms, fn) { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); }

export function resetDemo(role) {
  for (const t of timers) clearTimeout(t);
  timers.clear();
  S = {
    role,
    shift: [0, 0], // moves sample stations near you if you are far from Dar es Salaam
    client: { id: 1, name: 'Demo Client', phone: '255754123456', role: 'client', station_id: null, created_at: nowSql() },
    rider: { ...RIDERS[0], role: 'rider', station_id: 1, online: 1, lat: -6.768, lng: 39.226, created_at: nowSql() },
    orders: [], seq: 1, jobN: 0,
  };
}
const me = () => (S.role === 'rider' ? S.rider : S.client);
const stationAt = (s) => [s.at[0] + S.shift[0], s.at[1] + S.shift[1]];
const station = (id) => STATIONS.find((s) => s.id === id);

function nearHere(lat, lng) {
  const base = [HOME[0] + S.shift[0], HOME[1] + S.shift[1]];
  if (roadKm([lat, lng], base) > 15) S.shift = [lat - HOME[0], lng - HOME[1]];
}

function view(o) {
  const s = station(o.station_id);
  const r = o.rider_id ? RIDERS.find((x) => x.id === o.rider_id) : null;
  const v = {
    ...o, status_label: LABELS[o.status], payment_label: PAY[o.payment_method].label,
    station: { id: s.id, name: s.name, phone: s.phone, address: s.address, lat: stationAt(s)[0], lng: stationAt(s)[1] },
    rider: r ? { ...r, lat: o.rider_lat ?? null, lng: o.rider_lng ?? null } : null,
    events: [],
  };
  if (S.role === 'client') {
    v.otp = ['delivered', 'cancelled', 'rejected'].includes(o.status) ? null : o.otp;
    v.payment = { reference: o.code + '-PAY', provider: 'demo', method: o.payment_method, status: o.payment_status === 'paid' ? 'paid' : 'pending', test_mode: true };
    if (o.payment_method === 'bank' && o.payment_status === 'pending') v.bank_account = s.bank;
    delete v.contact_phone;
  } else {
    v.demo_otp = o.otp; // only in demo: there is no real client to ask
  }
  return v;
}
const findOrder = (id) => S.orders.find((o) => o.id === Number(id)) || fail('Order not found.');
// Demo alerts: the app plugs in a function that shows a phone notification.
let notifier = null;
export const setDemoNotifier = (fn) => { notifier = fn; };
const set = (o, status, extra = {}) => {
  const changed = o.status !== status;
  Object.assign(o, extra, { status, updated_at: nowSql() });
  if (changed && notifier && S.role === 'client' && o.client_id === S.client.id) {
    const r = o.rider_id ? RIDERS.find((x) => x.id === o.rider_id) : null;
    const m = clientMessage(o, r?.name);
    if (m) Promise.resolve(notifier(m[0], m[1])).catch(() => {});
  }
};

// ---------- simulated movement ----------
// A street-like route: go along one axis, then the other, so the rider turns a corner.
const streetPath = (a, b) => [a, [a[0], b[1]], b];
/** Move along `points` over `ms`, calling apply([lat, lng]) once a second. Stops if alive() turns false. */
function animate(points, ms, alive, apply, done) {
  const legs = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  const total = legs.reduce((a, b) => a + b, 0) || 1;
  const at = (f) => {
    let d = f * total;
    for (let i = 0; i < legs.length; i++) {
      if (d <= legs[i] || i === legs.length - 1) {
        const t = legs[i] ? Math.min(1, d / legs[i]) : 1;
        return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
      }
      d -= legs[i];
    }
    return points[points.length - 1];
  };
  const steps = Math.max(1, Math.round(ms / 1000));
  for (let i = 1; i <= steps; i++) {
    later(i * 1000, () => {
      if (!alive()) return;
      apply(at(i / steps));
      if (i === steps && done) done();
    });
  }
}

// ---------- simulated station and rider for client orders ----------
function simulateDelivery(o) {
  const st = stationAt(station(o.station_id));
  const you = [o.lat, o.lng];
  const rider = RIDERS.find((r) => r.vehicle === o.delivery_method);
  const put = ([lat, lng]) => Object.assign(o, { rider_lat: lat, rider_lng: lng });
  later(4000, () => {
    if (o.status !== 'placed') return;
    set(o, 'accepted');
    later(4000, () => {
      if (o.status !== 'accepted') return;
      // Rider starts a short ride away and heads to the station.
      const start = [st[0] + 0.006, st[1] - 0.005];
      set(o, 'assigned', { rider_id: rider.id, rider_lat: start[0], rider_lng: start[1] });
      animate(streetPath(start, st), 8000, () => o.status === 'assigned', put, () => {
        set(o, 'picked_up');
        later(4000, () => {
          if (o.status !== 'picked_up') return;
          set(o, 'on_the_way');
          animate(streetPath(st, you), 24000, () => o.status === 'on_the_way', put, () => {
            set(o, 'arrived');
            later(10000, () => { if (o.status === 'arrived') set(o, 'delivered', { cancel_reason: null }); });
          });
        });
      });
    });
  });
}

// In the rider demo, move "you" (the rider) along the route after each step.
function driveRider(o, to, ms) {
  const run = {}; // unique per drive, so an older drive can never move the rider again
  S.riderDriving = run;
  animate(streetPath([S.rider.lat, S.rider.lng], to), ms, () => S.riderDriving === run,
    ([lat, lng]) => Object.assign(S.rider, { lat, lng }), () => { if (S.riderDriving === run) S.riderDriving = null; });
}

function payOrder(o, ok) {
  if (o.status !== 'awaiting_payment') return;
  if (ok) { set(o, 'placed', { payment_status: 'paid' }); simulateDelivery(o); }
  else set(o, 'cancelled', { payment_status: 'failed', cancel_reason: 'Payment failed' });
}

// ---------- jobs for the rider demo ----------
function makeJob() {
  const [name, phone, plate, vtype, landmark, lat, lng, litres, fuel] = JOB_CLIENTS[S.jobN++ % JOB_CLIENTS.length];
  const s = station(1);
  const [pid, pname, ppl] = s.products[fuel];
  const where = [lat + S.shift[0], lng + S.shift[1]];
  const km = roadKm(where, stationAt(s));
  const p = priceOrder(ppl, litres, 'boda', km);
  const id = S.seq++;
  S.orders.push({
    id, code: 'WS-' + String(id).padStart(6, '0'), client_id: 900 + id, client_name: name, contact_phone: phone,
    station_id: 1, product_id: pid, product_name: pname, fuel_type: fuel, litres, price_per_litre: ppl,
    fuel_cost: p.fuelCost, delivery_fee: p.deliveryFee, service_fee: p.serviceFee, total: p.total, rider_earning: p.riderEarning,
    delivery_method: 'boda', distance_km: km, lat: where[0], lng: where[1], address: '', landmark, plate, vehicle_type: vtype,
    payment_method: 'mpesa', payment_status: 'paid', status: 'accepted', otp: String(1000 + Math.floor(Math.random() * 9000)),
    rider_id: null, cancel_reason: null, created_at: nowSql(), updated_at: nowSql(),
  });
  // The first two jobs are waiting when the demo opens; alert for the ones that arrive later.
  if (notifier && S.role === 'rider' && S.jobN > 2) {
    Promise.resolve(notifier(`New job: ${litres} L ${pname}`, `${landmark} \u00b7 ${km} km \u00b7 you earn ${p.riderEarning.toLocaleString('en-US')} TZS`)).catch(() => {});
  }
}
const riderCurrent = () => S.orders.find((o) => o.rider_id === S.rider.id && ['assigned', 'picked_up', 'on_the_way', 'arrived'].includes(o.status));

// ---------- API ----------
export async function demoApi(method, path, body = {}) {
  if (!S) resetDemo('client');
  await wait(250); // feel like a network call
  // Parse by hand: React Native's URL support differs between versions.
  const [p, qs = ''] = path.split('?');
  const q = Object.fromEntries(qs.split('&').filter(Boolean).map((kv) => kv.split('=').map(decodeURIComponent)));
  const route = (m, re) => method === m && p.match(re);
  let m;

  if (route('GET', /^\/api\/me$/)) return me();
  if (route('GET', /^\/api\/config$/)) return { delivery: DELIVERY, serviceFeeRate: 0.02, maxDeliveryKm: MAX_KM, paymentMethods: PAY, paymentProvider: 'demo' };
  if (route('GET', /^\/api\/health$/)) return { ok: true, demo: true };

  // Client
  if (route('GET', /^\/api\/stations\/nearby$/)) {
    const lat = Number(q.lat), lng = Number(q.lng), litres = Number(q.litres), fuel = q.fuel, method = q.delivery;
    nearHere(lat, lng);
    const out = STATIONS.map((s) => {
      const [pid, pname, ppl] = s.products[fuel];
      const km = roadKm([lat, lng], stationAt(s));
      const reason = km > MAX_KM ? 'Too far' : !s[method] ? `No ${DELIVERY[method].label.toLowerCase()}` : null;
      return {
        station_id: s.id, name: s.name, address: s.address, distance_km: km, product_id: pid, product_name: pname, price_per_litre: ppl,
        payment_methods: s.pay.map((k) => ({ method: k, ...PAY[k] })), available: !reason, unavailable_reason: reason,
        quote: priceOrder(ppl, litres, method, km),
      };
    }).sort((a, b) => b.available - a.available || a.distance_km - b.distance_km);
    return { delivery: method, litres, limits: DELIVERY[method], stations: out };
  }
  if (route('POST', /^\/api\/orders$/)) {
    const s = station(body.station_id) || fail('That station is not taking orders right now.');
    const prod = Object.values(s.products).find((x) => x[0] === body.product_id) || fail('That fuel is not available.');
    const d = DELIVERY[body.delivery_method];
    if (body.litres < d.minLitres || body.litres > d.maxLitres) fail(`${d.label} carries ${d.minLitres}–${d.maxLitres} L.`);
    if (!body.plate?.trim()) fail('Plate number is required.');
    if (S.orders.some((o) => o.client_id === S.client.id && !['delivered', 'cancelled', 'rejected'].includes(o.status))) fail('You already have an active order.');
    const km = roadKm([body.lat, body.lng], stationAt(s));
    const pr = priceOrder(prod[2], body.litres, body.delivery_method, km);
    const kind = PAY[body.payment_method].kind;
    const id = S.seq++;
    const o = {
      id, code: 'WS-' + String(id).padStart(6, '0'), client_id: S.client.id, client_name: S.client.name, contact_phone: S.client.phone,
      station_id: s.id, product_id: prod[0], product_name: prod[1], fuel_type: prod[1].toLowerCase(), litres: body.litres, price_per_litre: prod[2],
      fuel_cost: pr.fuelCost, delivery_fee: pr.deliveryFee, service_fee: pr.serviceFee, total: pr.total, rider_earning: pr.riderEarning,
      delivery_method: body.delivery_method, distance_km: km, lat: body.lat, lng: body.lng, address: body.address || '', landmark: body.landmark || '',
      plate: body.plate.toUpperCase(), vehicle_type: body.vehicle_type || 'Car', payment_method: body.payment_method,
      payment_status: kind === 'bank' ? 'pending' : 'unpaid', status: kind === 'bank' ? 'placed' : 'awaiting_payment',
      otp: String(1000 + Math.floor(Math.random() * 9000)), rider_id: null, cancel_reason: null, created_at: nowSql(), updated_at: nowSql(),
    };
    S.orders.push(o);
    if (kind === 'bank') later(5000, () => { if (o.status === 'placed') { o.payment_status = 'paid'; simulateDelivery(o); } });
    else later(6000, () => payOrder(o, true)); // demo: payment approves itself
    const instructions = kind === 'mobile'
      ? `Demo: a ${PAY[o.payment_method].label} PIN prompt would appear on your phone now. It approves by itself in a few seconds, or tap Approve.`
      : kind === 'card' ? 'Demo: the card checkout would open here. It approves by itself in a few seconds, or tap Approve.'
      : 'Demo: the station confirms your transfer in a few seconds.';
    return { order: view(o), payment: { reference: o.code + '-PAY', status: 'pending', kind, instructions, testMode: true } };
  }
  if (route('GET', /^\/api\/orders$/)) return S.orders.filter((o) => o.client_id === S.client.id).slice().reverse().map(view);
  if ((m = route('GET', /^\/api\/orders\/(\d+)$/))) return view(findOrder(m[1]));
  if ((m = route('POST', /^\/api\/orders\/(\d+)\/cancel$/))) {
    const o = findOrder(m[1]);
    if (!['awaiting_payment', 'placed'].includes(o.status)) fail(`This order is already "${LABELS[o.status]}".`);
    set(o, 'cancelled', { cancel_reason: 'Cancelled by client', payment_status: o.payment_status === 'paid' ? 'refunded' : o.payment_status });
    return view(o);
  }
  if ((m = route('POST', /^\/api\/payments\/test\/(.+)-PAY\/(approve|decline)$/))) {
    const o = S.orders.find((x) => x.code === m[1]) || fail('Payment not found.');
    payOrder(o, m[2] === 'approve');
    return { ok: true };
  }

  // Rider
  if (route('GET', /^\/api\/rider$/)) {
    const r = S.rider, s = station(1);
    const done = S.orders.filter((o) => o.rider_id === r.id && o.status === 'delivered');
    const cur = riderCurrent();
    return {
      name: r.name, phone: r.phone, vehicle: r.vehicle, plate: r.plate, online: r.online, lat: r.lat, lng: r.lng, station_id: 1,
      station: { id: s.id, name: s.name, address: s.address, phone: s.phone, lat: stationAt(s)[0], lng: stationAt(s)[1] },
      current: cur ? view(cur) : null,
      today: { trips: done.length, earned: done.reduce((a, o) => a + o.rider_earning, 0) },
    };
  }
  if (route('POST', /^\/api\/rider\/status$/)) {
    if (body.online !== undefined) S.rider.online = body.online ? 1 : 0;
    // While the demo is driving the rider along a route, ignore real GPS so the movement shows.
    if (body.lat !== undefined && !S.riderDriving) { S.rider.lat = body.lat; S.rider.lng = body.lng; nearHere(body.lat, body.lng); }
    return { online: S.rider.online, lat: S.rider.lat, lng: S.rider.lng };
  }
  if (route('GET', /^\/api\/rider\/jobs$/)) {
    if (!S.rider.online) return [];
    const open = () => S.orders.filter((o) => o.status === 'accepted' && o.station_id === 1 && !o.rider_id);
    while (open().length < 2) makeJob();
    return open().map(view);
  }
  if (route('GET', /^\/api\/rider\/history$/)) return S.orders.filter((o) => o.rider_id === S.rider.id && o.status === 'delivered').map(view);
  if ((m = route('POST', /^\/api\/orders\/(\d+)\/take$/))) {
    const o = findOrder(m[1]);
    if (!S.rider.online) fail('Go online before taking jobs.');
    if (riderCurrent()) fail('Finish your current job first.');
    if (o.status !== 'accepted') fail('Someone else already took this job.');
    set(o, 'assigned', { rider_id: S.rider.id });
    driveRider(o, stationAt(station(o.station_id)), 8000);
    return view(o);
  }
  if ((m = route('POST', /^\/api\/orders\/(\d+)\/advance$/))) {
    const o = findOrder(m[1]);
    const next = { assigned: 'picked_up', picked_up: 'on_the_way', on_the_way: 'arrived' }[o.status] || fail("Enter the client's code to finish this delivery.");
    set(o, next);
    if (next === 'picked_up') { S.riderDriving = null; [S.rider.lat, S.rider.lng] = stationAt(station(o.station_id)); }
    if (next === 'on_the_way') driveRider(o, [o.lat, o.lng], 20000);
    if (next === 'arrived') { S.riderDriving = null; Object.assign(S.rider, { lat: o.lat, lng: o.lng }); }
    return view(o);
  }
  if ((m = route('POST', /^\/api\/orders\/(\d+)\/deliver$/))) {
    const o = findOrder(m[1]);
    if (o.status !== 'arrived') fail('Mark yourself as arrived first.');
    if (String(body.otp ?? '').trim() !== o.otp) fail("That code doesn't match. In the demo, the code is shown on the job card.");
    set(o, 'delivered');
    return view(o);
  }

  fail('This part of Wese is not available in the demo.');
}
