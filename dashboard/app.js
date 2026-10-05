// Wese station dashboard: one-file app, talks to the Wese API on the same server.
const API = window.WESE_API || '';
const S = { token: localStorage.getItem('wese_token') || '', user: null, station: null, orders: [], history: [], stats: null, tab: 'orders', admin: [], adminTab: 'pending', adminSection: 'stations', adminOrders: [], adminQuery: '', adminStatus: 'open', live: false };

const $ = (s) => document.querySelector(s);
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tzs = (n) => Math.round(n || 0).toLocaleString('en-US') + ' TZS';
const phoneFmt = (p) => (p || '').replace(/^255(\d{3})(\d{3})(\d{3})$/, '0$1 $2 $3');
const time = (t) => t ? new Date(t.replace(' ', 'T') + (t.includes('Z') ? '' : 'Z')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
const VEH = { boda: 'Boda (motorbike)', tanker: 'Mini tanker' };

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3000);
}

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method, headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.token) { signOut(); throw new Error('Your session ended. Please sign in again.'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

/** Run an action; show its error as a toast. */
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message); }
}

function signOut() {
  localStorage.removeItem('wese_token');
  S.token = ''; S.user = null; S.station = null;
  S.es?.close(); S.es = null; S.live = false;
  render();
}

// ---------- boot & data ----------
async function boot() {
  if (!S.token) return render();
  try {
    S.user = await api('GET', '/api/me');
    if (S.user.role === 'station' && S.user.station_id) await loadStation();
    if (S.user.role === 'admin') await loadAdmin();
    connectLive();
  } catch (e) { toast(e.message); }
  render();
}

async function loadStation() {
  const [station, orders, stats] = await Promise.all([api('GET', '/api/station'), api('GET', '/api/station/orders'), api('GET', '/api/station/stats')]);
  Object.assign(S, { station, orders, stats });
  if (S.tab === 'history') S.history = await api('GET', '/api/station/orders?scope=history');
}
async function loadAdmin() {
  if (S.adminSection === 'orders') {
    S.adminOrders = await api('GET', `/api/admin/orders?status=${encodeURIComponent(S.adminStatus)}&q=${encodeURIComponent(S.adminQuery)}`);
  } else S.admin = await api('GET', '/api/admin/stations?status=' + S.adminTab);
}
const reload = () => (S.user?.role === 'admin' ? loadAdmin() : loadStation());

function connectLive() {
  if (S.es || !S.token) return;
  S.es = new EventSource(`${API}/api/events?token=${encodeURIComponent(S.token)}`);
  S.es.addEventListener('ready', () => { S.live = true; renderBar(); });
  S.es.onerror = () => { S.live = false; renderBar(); };
  S.es.addEventListener('order', async (e) => {
    const d = JSON.parse(e.data);
    if (S.user?.role === 'admin') { if (S.adminSection === 'orders') { await loadAdmin().catch(() => {}); render(); } return; }
    if (S.user?.role !== 'station' || !S.station) return;
    const known = S.orders.find((o) => o.id === d.id);
    await loadStation().catch(() => {});
    if (d.status === 'placed' && (!known || known.status !== 'placed')) { beep(); toast(`New order ${d.code}`); }
    render();
  });
}

let audio;
function beep() {
  try {
    audio ||= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; g.gain.value = 0.15; o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.25);
  } catch {}
}

// ---------- rendering ----------
function renderBar() {
  const u = S.user;
  $('#barSub').textContent = u?.role === 'admin' ? 'Admin' : S.station ? S.station.name : 'Station dashboard';
  $('#barRight').innerHTML = u ? `
    ${S.station ? `<label class="check"><span class="switch"><input type="checkbox" data-act="toggleOpen" ${S.station.is_open ? 'checked' : ''} aria-label="Station open for orders"><span></span></span>${S.station.is_open ? 'Open for orders' : 'Closed'}</label>` : ''}
    <span class="live ${S.live ? 'on' : ''}"><i></i>${S.live ? 'Live' : 'Reconnecting'}</span>
    <button class="btn ghost" data-act="signOut">Sign out</button>` : '';
}

function render() {
  renderBar();
  const u = S.user;
  if (!u) return (app.innerHTML = authView(S.authMode || 'login'));
  if (u.role === 'admin') return (app.innerHTML = adminView());
  if (u.role !== 'station') return (app.innerHTML = `<div class="panel narrow"><h2>Use the Wese mobile app</h2><p class="muted">This dashboard is for fuel stations. Clients and riders use the Wese mobile app.</p><button class="btn" data-act="signOut">Sign out</button></div>`);
  if (!S.station) return (app.innerHTML = registerStationView());
  app.innerHTML = (S.station.status !== 'approved' ? pendingView() : '') + stationView();
}

function authView(mode) {
  const reg = mode === 'register';
  return `<form class="panel narrow" id="authForm" data-mode="${mode}">
    <div><h1>${reg ? 'Put your station on Wese' : 'Sign in to your station'}</h1>
    <p class="muted">${reg ? 'Create the owner account first. You add your station details next.' : 'Manage orders, prices, payments and riders.'}</p></div>
    <div class="fields">
      ${reg ? '<div class="field full"><label for="aName">Your full name</label><input id="aName" required autocomplete="name"></div>' : ''}
      <div class="field full"><label for="aPhone">Phone number</label><input id="aPhone" type="tel" placeholder="0713 000 001" required autocomplete="tel"></div>
      <div class="field full"><label for="aPw">Password</label><input id="aPw" type="password" minlength="6" required autocomplete="${reg ? 'new-password' : 'current-password'}"></div>
    </div>
    <p class="err" id="aErr"></p>
    <button class="btn primary" type="submit">${reg ? 'Create account' : 'Sign in'}</button>
    <p class="small muted">${reg ? 'Already registered?' : 'New station?'} <button type="button" class="link" data-act="authMode" data-mode="${reg ? 'login' : 'register'}">${reg ? 'Sign in' : 'Create an account'}</button></p>
  </form>`;
}

function registerStationView() {
  return `<form class="panel narrow" id="stationForm">
    <div><h1>Your station</h1><p class="muted">Wese checks your EWURA licence before your station goes live.</p></div>
    <div class="fields">
      <div class="field full"><label for="sName">Station name</label><input id="sName" required></div>
      <div class="field"><label for="sLic">EWURA licence number</label><input id="sLic" required></div>
      <div class="field"><label for="sPhone">Station phone</label><input id="sPhone" type="tel" required value="${esc(phoneFmt(S.user.phone))}"></div>
      <div class="field full"><label for="sAddr">Address</label><input id="sAddr" required placeholder="Street and area"></div>
      <div class="field"><label for="sLat">Latitude</label><input id="sLat" inputmode="decimal" required placeholder="-6.7680"></div>
      <div class="field"><label for="sLng">Longitude</label><input id="sLng" inputmode="decimal" required placeholder="39.2260"></div>
      <div class="field full"><button type="button" class="btn" data-act="locate">Use my current location</button><span class="small muted">Do this while standing at the station, or copy the coordinates from Google Maps.</span></div>
      <label class="check"><input type="checkbox" id="sBoda" checked> We deliver by boda</label>
      <label class="check"><input type="checkbox" id="sTanker"> We deliver by mini tanker</label>
    </div>
    <p class="err" id="sErr"></p>
    <button class="btn primary" type="submit">Submit for approval</button>
  </form>`;
}

function pendingView() {
  const s = S.station;
  return `<div class="panel" style="margin-bottom:16px;border-color:var(--${s.status === 'suspended' ? 'bad' : 'accent'})">
    <div class="panel-head"><h2>${s.status === 'suspended' ? 'Your station is suspended' : 'Waiting for approval'}</h2><span class="pill ${s.status === 'suspended' ? 'bad' : 'warn'}">${s.status}</span></div>
    <p class="muted">${s.status === 'suspended' ? 'Clients cannot see your station. Contact Wese support.' : `We are checking your EWURA licence (${esc(s.license_no)}). Clients will see your station once it is approved. Meanwhile, add your products, payment methods and riders so you are ready on day one.`}</p></div>`;
}

const statusPill = (o) => ({
  placed: '<span class="pill warn">New</span>', delivered: '<span class="pill ok">Delivered</span>',
  rejected: '<span class="pill bad">Declined</span>', cancelled: '<span class="pill bad">Cancelled</span>',
}[o.status] || `<span class="pill brand">${esc(o.status_label)}</span>`);
const payPill = (o) => ({ paid: '<span class="pill ok">Paid</span>', pending: '<span class="pill warn">Transfer to confirm</span>', refunded: '<span class="pill">Refunded</span>', unpaid: '<span class="pill">Unpaid</span>', failed: '<span class="pill bad">Payment failed</span>' }[o.payment_status]);

function lockBox(o) {
  return `<div class="lockbox"><p><b>Delivery code locked</b> after ${o.otp_attempts} wrong tries. Call the client on <b class="num">${esc(phoneFmt(o.contact_phone))}</b> and confirm the fuel is in the tank, then record how you confirmed it.</p>
    <div class="btn-row"><input id="lock-${o.id}" placeholder="e.g. Client confirmed by phone at 14:20" aria-label="How delivery was confirmed"><button class="btn primary" data-act="completeLocked" data-id="${o.id}">Mark delivered</button></div></div>`;
}

function orderCard(o, admin = false) {
  let actions = '';
  if (admin) {
    const open = !['delivered', 'cancelled', 'rejected'].includes(o.status);
    if (open) actions += `<button class="btn danger" data-act="adminAsk" data-kind="cancel" data-id="${o.id}">Cancel${o.payment_status === 'paid' ? ' &amp; refund' : ''}</button>`;
    if (!open && o.payment_status === 'paid') actions += `<button class="btn" data-act="adminAsk" data-kind="refund" data-id="${o.id}">Refund</button>`;
  } else if (o.status === 'placed') {
    actions = o.payment_status === 'pending'
      ? `<button class="btn brand" data-act="confirmTransfer" data-id="${o.id}">Confirm transfer received</button>`
      : `<button class="btn primary" data-act="accept" data-id="${o.id}">Accept &amp; send to riders</button>`;
    actions += `<button class="btn danger" data-act="reject" data-id="${o.id}">Decline</button>`;
  } else if (['accepted', 'assigned'].includes(o.status)) {
    actions = `<button class="btn danger" data-act="cancelOrder" data-id="${o.id}">Cancel &amp; refund</button>`;
  }
  const maps = `https://www.google.com/maps?q=${o.lat},${o.lng}`;
  return `<article class="order ${o.status === 'placed' || o.code_locked ? 'attn' : ''}">
    <div class="order-top"><strong class="num">${esc(o.code)} · ${o.litres} L ${esc(o.product_name)}</strong><span class="btn-row">${o.code_locked ? '<span class="pill bad">Code locked</span>' : ''}${payPill(o)}${statusPill(o)}</span></div>
    ${admin ? `<div class="meta"><span>Station <b>${esc(o.station.name)}</b></span><span>Client account <span class="num">${esc(phoneFmt(o.client_phone))}</span></span><span class="num">${o.created_at ? new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span></div>` : ''}
    <div class="meta"><span><b>${esc(o.client_name)}</b> <span class="num">${esc(phoneFmt(o.contact_phone))}</span></span><span>${esc(o.vehicle_type)} <b class="num">${esc(o.plate)}</b></span><span class="num">${time(o.created_at)}</span></div>
    <div class="meta"><span>${esc(o.landmark || o.address || 'Pinned location')} · <a href="${maps}" target="_blank" rel="noopener">map</a></span><span class="num">${o.distance_km} km</span><span>${VEH[o.delivery_method]}</span><span>${esc(o.payment_label)}</span></div>
    <div class="meta"><span>Fuel <b class="num">${tzs(o.fuel_cost)}</b></span><span>Client pays <b class="num">${tzs(o.total)}</b></span>${o.rider ? `<span>Rider <b>${esc(o.rider.name)}</b> <span class="num">${esc(o.rider.plate)}</span></span>` : o.status === 'accepted' ? '<span>Waiting for a rider to take it</span>' : ''}${o.cancel_reason ? `<span>Reason: ${esc(o.cancel_reason)}</span>` : ''}</div>
    ${o.code_locked ? lockBox(o) : ''}
    ${actions ? `<div class="btn-row">${actions}</div>` : ''}</article>`;
}

function stationView() {
  const s = S.station, st = S.stats || {};
  const newCount = S.orders.filter((o) => o.status === 'placed').length;
  const tabs = [['orders', 'Live orders', newCount], ['history', 'History'], ['products', 'Products & prices'], ['payments', 'Payment methods'], ['riders', 'Delivery & riders'], ['settings', 'Station details']];
  let body = '';
  if (S.tab === 'orders') body = `
    <div class="kpis">
      ${[['Waiting for you', st.waiting ?? 0], ['Out for delivery', st.out_for_delivery ?? 0], ['Litres delivered today', (st.litres ?? 0).toLocaleString()], ['Fuel sales today', tzs(st.fuel_sales)]]
        .map(([l, v]) => `<div class="kpi"><span class="label">${l}</span><div class="v">${v}</div></div>`).join('')}
    </div>
    <div class="panel"><div class="panel-head"><h2>Live orders</h2><span class="small muted">New orders appear here with a sound</span></div>
    <div class="orders">${S.orders.length ? S.orders.map(orderCard).join('') : '<div class="empty">No open orders. Keep this page open — new requests arrive instantly.</div>'}</div></div>`;
  if (S.tab === 'history') body = `<div class="panel"><h2>Last 100 finished orders</h2><div class="orders">${S.history.length ? S.history.map(orderCard).join('') : '<div class="empty">Finished orders show here.</div>'}</div></div>`;
  if (S.tab === 'products') body = `<div class="panel">
    <div class="panel-head"><h2>Products &amp; prices</h2><span class="small muted">Prices in TZS per litre. Changes apply to new orders immediately.</span></div>
    <div class="tw"><table><thead><tr><th>Product</th><th>Type</th><th>Price / L</th><th>Stock (L)</th><th>Selling</th><th></th></tr></thead><tbody>
    ${s.products.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.stock_litres < 500 ? ' <span class="pill warn">Low stock</span>' : ''}</td><td>${p.fuel_type}</td>
      <td><input class="num" type="number" min="1" value="${p.price_per_litre}" data-prod="${p.id}" data-f="price_per_litre" aria-label="${esc(p.name)} price"></td>
      <td><input class="num" type="number" min="0" value="${p.stock_litres}" data-prod="${p.id}" data-f="stock_litres" aria-label="${esc(p.name)} stock"></td>
      <td><span class="switch"><input type="checkbox" ${p.active ? 'checked' : ''} data-prod="${p.id}" data-f="active" aria-label="Selling ${esc(p.name)}"><span></span></span></td>
      <td><button class="btn danger" data-act="delProd" data-id="${p.id}">Remove</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Add your first product below.</td></tr>'}
    </tbody></table></div>
    <form id="prodForm" class="fields">
      <div class="field"><label for="pName">New product</label><input id="pName" required placeholder="Petrol"></div>
      <div class="field"><label for="pType">Type</label><select id="pType"><option value="petrol">Petrol</option><option value="diesel">Diesel</option><option value="other">Other</option></select></div>
      <div class="field"><label for="pPrice">Price / L</label><input id="pPrice" type="number" min="1" required></div>
      <div class="field"><label for="pStock">Stock (L)</label><input id="pStock" type="number" min="0" required></div>
      <div class="field" style="justify-content:flex-end"><button class="btn brand" type="submit">Add product</button></div>
    </form></div>`;
  if (S.tab === 'payments') {
    const groups = [['mobile', 'Mobile money', 'Lipa number or till'], ['card', 'Card', 'Card gateway or terminal ID'], ['bank', 'Bank transfer', 'Bank name and account number']];
    body = `<div class="panel"><div class="panel-head"><h2>Payment methods</h2></div><p class="small muted">Clients only see the methods you switch on. Add the account money is paid into so clients can check it.</p>
      ${groups.map(([k, title, ph]) => `<div><span class="label">${title}</span>${s.payment_methods.filter((m) => m.kind === k).map((m) => `
        <div class="row"><span class="switch"><input type="checkbox" ${m.enabled ? 'checked' : ''} data-pay="${m.method}" aria-label="Accept ${m.label}"><span></span></span>
        <span class="n">${m.label}</span><input type="text" id="acc-${m.method}" value="${esc(m.account)}" placeholder="${ph}" data-payacc="${m.method}" aria-label="${m.label} account"></div>`).join('')}</div>`).join('')}</div>`;
  }
  if (S.tab === 'riders') body = `<div class="grid2"><div class="panel"><h2>Your riders</h2>
      <div class="tw"><table><thead><tr><th>Name</th><th>Phone</th><th>Vehicle</th><th>Plate</th><th>Status</th><th>Account</th></tr></thead><tbody>
      ${s.riders.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td class="num">${phoneFmt(r.phone)}</td><td>${VEH[r.vehicle]}</td><td class="num">${esc(r.plate)}</td>
        <td>${r.online ? '<span class="pill ok">Online</span>' : '<span class="pill">Offline</span>'}</td>
        <td><span class="switch"><input type="checkbox" ${r.active ? 'checked' : ''} data-rider="${r.id}" aria-label="${esc(r.name)} account active"><span></span></span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Add riders so they can sign in to the Wese app and take your deliveries.</td></tr>'}
      </tbody></table></div></div>
      <div class="stack">
      <div class="panel"><h2>Delivery options</h2>
        <label class="row"><span class="switch"><input type="checkbox" data-deliv="offers_boda" ${s.offers_boda ? 'checked' : ''}><span></span></span><span class="n">Boda (motorbike)</span><span class="small muted">5–20 L in sealed jerrycans</span></label>
        <label class="row"><span class="switch"><input type="checkbox" data-deliv="offers_tanker" ${s.offers_tanker ? 'checked' : ''}><span></span></span><span class="n">Mini tanker</span><span class="small muted">30–1,000 L, metered pump</span></label>
      </div>
      <form class="panel" id="riderForm"><h2>Add a rider</h2>
        <div class="fields">
          <div class="field full"><label for="rName">Full name</label><input id="rName" required></div>
          <div class="field"><label for="rPhone">Phone</label><input id="rPhone" type="tel" required></div>
          <div class="field"><label for="rPw">Temporary password</label><input id="rPw" minlength="6" required></div>
          <div class="field"><label for="rVeh">Vehicle</label><select id="rVeh"><option value="boda">Boda (motorbike)</option><option value="tanker">Mini tanker</option></select></div>
          <div class="field"><label for="rPlate">Plate number</label><input id="rPlate" required></div>
        </div>
        <button class="btn brand" type="submit">Add rider</button>
        <p class="small muted">Give the rider their phone number and temporary password to sign in to the app.</p>
      </form></div></div>`;
  if (S.tab === 'settings') body = `<form class="panel" id="settingsForm" style="max-width:640px"><h2>Station details</h2>
    <div class="fields">
      <div class="field full"><label for="eName">Station name</label><input id="eName" value="${esc(s.name)}" required></div>
      <div class="field"><label for="eLic">EWURA licence number</label><input id="eLic" value="${esc(s.license_no)}" required></div>
      <div class="field"><label for="ePhone">Station phone</label><input id="ePhone" value="${esc(phoneFmt(s.phone))}" required></div>
      <div class="field full"><label for="eAddr">Address</label><input id="eAddr" value="${esc(s.address)}" required></div>
      <div class="field"><label for="eLat">Latitude</label><input id="eLat" value="${s.lat}" required></div>
      <div class="field"><label for="eLng">Longitude</label><input id="eLng" value="${s.lng}" required></div>
    </div>
    <div class="btn-row"><button class="btn brand" type="submit">Save details</button><span class="pill ${s.status === 'approved' ? 'ok' : 'warn'}">${s.status}</span></div></form>`;

  return `<nav class="tabs" role="tablist">${tabs.map(([k, l, n]) => `<button role="tab" data-act="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}${n ? ` <i class="dot">${n}</i>` : ''}</button>`).join('')}</nav>${body}`;
}

function adminView() {
  const nav = `<nav class="tabs" role="tablist">${[['stations', 'Station approvals'], ['orders', 'Orders']].map(([k, l]) => `<button role="tab" data-act="adminSection" data-tab="${k}" aria-selected="${S.adminSection === k}">${l}</button>`).join('')}</nav>`;
  if (S.adminSection === 'orders') return nav + adminOrdersView();
  return nav + `<div class="panel-head" style="margin-bottom:12px"><h1>Station approvals</h1>
    <div class="btn-row">${['pending', 'approved', 'suspended'].map((k) => `<button class="btn ${S.adminTab === k ? 'brand' : ''}" data-act="adminTab" data-tab="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>
    <div class="orders">${S.admin.length ? S.admin.map((s) => `<article class="order">
      <div class="order-top"><strong>${esc(s.name)}</strong><span class="pill">${s.status}</span></div>
      <div class="meta"><span>Licence <b>${esc(s.license_no)}</b></span><span>${esc(s.address)}</span><span>Owner <b>${esc(s.owner_name)}</b> <span class="num">${phoneFmt(s.owner_phone)}</span></span><a href="https://www.google.com/maps?q=${s.lat},${s.lng}" target="_blank" rel="noopener">map</a></div>
      <div class="btn-row">${s.status !== 'approved' ? `<button class="btn primary" data-act="setStatus" data-id="${s.id}" data-status="approved">Approve</button>` : ''}${s.status !== 'suspended' ? `<button class="btn danger" data-act="setStatus" data-id="${s.id}" data-status="suspended">Suspend</button>` : ''}</div>
    </article>`).join('') : '<div class="empty">Nothing here.</div>'}</div>`;
}

function adminOrdersView() {
  const statuses = [['open', 'Open'], ['', 'All'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['rejected', 'Declined']];
  return `<form id="adminSearch" class="panel" style="margin-bottom:16px">
      <div class="fields">
        <div class="field" style="grid-column:span 2"><label for="aq">Find an order</label><input id="aq" value="${esc(S.adminQuery)}" placeholder="Order code (WS-000012), client phone, plate or name"></div>
        <div class="field"><label for="ast">Status</label><select id="ast">${statuses.map(([v, l]) => `<option value="${v}" ${S.adminStatus === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field" style="justify-content:flex-end"><button class="btn brand" type="submit">Search</button></div>
      </div></form>
    <div class="orders">${S.adminOrders.length ? S.adminOrders.map((o) => orderCard(o, true)).join('') : '<div class="empty">No orders match. Try another code, phone number or status.</div>'}</div>`;
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.type === 'checkbox') return;
  const id = b.dataset.id;
  switch (b.dataset.act) {
    case 'signOut': return signOut();
    case 'authMode': S.authMode = b.dataset.mode; return render();
    case 'tab':
      S.tab = b.dataset.tab;
      if (S.tab === 'history') await act(async () => (S.history = await api('GET', '/api/station/orders?scope=history')));
      return render();
    case 'locate':
      if (!navigator.geolocation) return toast('This browser cannot read your location.');
      navigator.geolocation.getCurrentPosition((p) => { $('#sLat').value = p.coords.latitude.toFixed(6); $('#sLng').value = p.coords.longitude.toFixed(6); },
        () => toast('Could not read your location. Type the coordinates instead.'), { enableHighAccuracy: true });
      return;
    case 'accept': b.disabled = true; await act(() => api('POST', `/api/orders/${id}/accept`), 'Accepted. Your riders can see it now'); break;
    case 'confirmTransfer': b.disabled = true; await act(() => api('POST', `/api/orders/${id}/confirm-transfer`), 'Transfer confirmed'); break;
    case 'reject': {
      const card = b.closest('.order');
      if (!card.querySelector('.reason')) {
        card.insertAdjacentHTML('beforeend', `<div class="btn-row reason"><select aria-label="Reason"><option>Out of stock</option><option>Too far for our riders</option><option>No rider available</option><option>Station closing</option></select><button class="btn danger" data-act="rejectGo" data-id="${id}">Decline and refund</button></div>`);
        return;
      }
      return;
    }
    case 'rejectGo': await act(() => api('POST', `/api/orders/${id}/reject`, { reason: b.previousElementSibling.value }), 'Declined. Client refunded'); break;
    case 'cancelOrder': {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to cancel and refund'; return; }
      await act(() => api('POST', `/api/orders/${id}/cancel`, { reason: 'Cancelled by station' }), 'Order cancelled and refunded'); break;
    }
    case 'delProd':
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to remove'; return; }
      await act(async () => (S.station = await api('DELETE', `/api/station/products/${id}`)), 'Product removed'); return render();
    case 'adminTab': S.adminTab = b.dataset.tab; await act(loadAdmin); return render();
    case 'adminSection': S.adminSection = b.dataset.tab; await act(loadAdmin); return render();
    case 'completeLocked': {
      const note = $(`#lock-${id}`).value.trim();
      if (note.length < 5) return toast('Write how the client confirmed delivery first.');
      b.disabled = true;
      await act(() => api('POST', `/api/orders/${id}/complete-locked`, { note }), 'Marked delivered'); break;
    }
    case 'adminAsk': {
      const card = b.closest('.order');
      if (card.querySelector('.reason')) return;
      const kind = b.dataset.kind;
      card.insertAdjacentHTML('beforeend', `<div class="btn-row reason"><input aria-label="Reason" placeholder="Reason, e.g. client complaint #123"><button class="btn danger" data-act="adminGo" data-kind="${kind}" data-id="${id}">${kind === 'refund' ? 'Refund now' : 'Cancel now'}</button></div>`);
      card.querySelector('.reason input').focus();
      return;
    }
    case 'adminGo': {
      const reason = b.previousElementSibling.value.trim();
      if (reason.length < 3) return toast('Give a reason; it is saved on the order.');
      const kind = b.dataset.kind;
      b.disabled = true;
      await act(() => api('POST', `/api/admin/orders/${id}/${kind}`, { reason }), kind === 'refund' ? 'Refunded' : 'Order cancelled'); break;
    }
    case 'setStatus': await act(() => api('POST', `/api/admin/stations/${id}/status`, { status: b.dataset.status }), 'Station updated'); await act(loadAdmin); return render();
    default: return;
  }
  await act(reload); render();
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.act === 'toggleOpen') { await act(async () => (S.station = await api('PATCH', '/api/station', { is_open: t.checked })), t.checked ? 'Open for orders' : 'Closed. Clients cannot order'); return render(); }
  if (t.dataset.prod) {
    const val = t.dataset.f === 'active' ? t.checked : Number(t.value);
    await act(async () => (S.station = await api('PATCH', `/api/station/products/${t.dataset.prod}`, { [t.dataset.f]: val })), 'Saved');
    return render();
  }
  if (t.dataset.pay || t.dataset.payacc) {
    const m = t.dataset.pay || t.dataset.payacc;
    const enabled = document.querySelector(`[data-pay="${m}"]`).checked;
    const account = document.querySelector(`#acc-${m}`).value;
    // On failure S.station is unchanged, so re-rendering restores the saved state.
    await act(async () => (S.station = await api('PUT', `/api/station/payment-methods/${m}`, { enabled, account })), 'Saved');
    return render();
  }
  if (t.dataset.deliv) { await act(async () => (S.station = await api('PATCH', '/api/station', { [t.dataset.deliv]: t.checked })), 'Saved'); return render(); }
  if (t.dataset.rider) { await act(async () => (S.station = await api('PATCH', `/api/station/riders/${t.dataset.rider}`, { active: t.checked })), t.checked ? 'Rider can sign in' : 'Rider switched off'); return render(); }
});

document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('[type=submit]'); if (btn) btn.disabled = true;
  try {
    if (f.id === 'authForm') {
      const reg = f.dataset.mode === 'register';
      const r = await api('POST', `/api/auth/${reg ? 'register' : 'login'}`, { name: $('#aName')?.value, phone: $('#aPhone').value, password: $('#aPw').value, role: 'station' });
      S.token = r.token; localStorage.setItem('wese_token', r.token);
      return boot();
    }
    if (f.id === 'stationForm') {
      S.station = await api('POST', '/api/stations', {
        name: $('#sName').value, license_no: $('#sLic').value, phone: $('#sPhone').value, address: $('#sAddr').value,
        lat: $('#sLat').value, lng: $('#sLng').value, offers_boda: $('#sBoda').checked, offers_tanker: $('#sTanker').checked,
      });
      S.user = await api('GET', '/api/me');
      return render();
    }
    if (f.id === 'adminSearch') {
      S.adminQuery = $('#aq').value.trim(); S.adminStatus = $('#ast').value;
      await loadAdmin(); return render();
    }
    if (f.id === 'prodForm') {
      S.station = await api('POST', '/api/station/products', { name: $('#pName').value, fuel_type: $('#pType').value, price_per_litre: Number($('#pPrice').value), stock_litres: Number($('#pStock').value) });
      toast('Product added'); return render();
    }
    if (f.id === 'riderForm') {
      S.station = await api('POST', '/api/station/riders', { name: $('#rName').value, phone: $('#rPhone').value, password: $('#rPw').value, vehicle: $('#rVeh').value, plate: $('#rPlate').value });
      toast('Rider added'); return render();
    }
    if (f.id === 'settingsForm') {
      S.station = await api('PATCH', '/api/station', { name: $('#eName').value, license_no: $('#eLic').value, phone: $('#ePhone').value, address: $('#eAddr').value, lat: $('#eLat').value, lng: $('#eLng').value });
      toast('Details saved'); return render();
    }
  } catch (err) {
    const box = f.querySelector('.err');
    if (box) box.textContent = err.message; else toast(err.message);
  } finally { if (btn) btn.disabled = false; }
});

// Refresh every minute as a safety net in case the live connection drops.
setInterval(() => { if (S.station &&document.visibilityState === 'visible') loadStation().then(render).catch(() => {}); }, 60_000);
boot();
