import * as SecureStore from 'expo-secure-store';
import { demoApi, resetDemo } from './demo';

// Default server address. It can also be changed inside the app (Server settings on the
// sign-in screen), so one installed preview build works with any backend.
const DEFAULT_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

let apiUrl = null;
export async function getApiUrl() {
  if (apiUrl) return apiUrl;
  apiUrl = (await SecureStore.getItemAsync('wese_api_url')) || DEFAULT_URL;
  return apiUrl;
}
export async function setApiUrl(url) {
  let u = String(url || '').trim().replace(/\/$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = 'http://' + u;
  apiUrl = u || DEFAULT_URL;
  if (u) await SecureStore.setItemAsync('wese_api_url', u);
  else await SecureStore.deleteItemAsync('wese_api_url');
  return apiUrl;
}

/** Check a server address answers like a Wese backend. */
export async function checkServer(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url.replace(/\/$/, '') + '/api/health', { signal: ctrl.signal });
    const data = await res.json();
    return !!data.ok;
  } catch {
    return false;
  } finally { clearTimeout(t); }
}

// ---- Demo mode: the app answers with sample data instead of calling a server ----
let demoRole; // undefined = not loaded yet, null = off, 'client' | 'rider' = on
async function loadDemo() {
  if (demoRole === undefined) {
    demoRole = (await SecureStore.getItemAsync('wese_demo')) || null;
    if (demoRole) resetDemo(demoRole);
  }
  return demoRole;
}
export const isDemo = () => !!demoRole;
export async function enterDemo(role) {
  resetDemo(role);
  demoRole = role;
  await SecureStore.setItemAsync('wese_demo', role);
  await setToken('demo-' + role);
  return demoApi('GET', '/api/me');
}

let token = null;
export const getToken = async () => { await loadDemo(); return (token ??= await SecureStore.getItemAsync('wese_token')); };
export async function setToken(t) {
  token = t;
  if (t) await SecureStore.setItemAsync('wese_token', t);
  else {
    await SecureStore.deleteItemAsync('wese_token');
    // Signing out also leaves demo mode.
    demoRole = null;
    await SecureStore.deleteItemAsync('wese_demo');
  }
}

let onUnauthorized = () => {};
export const setOnUnauthorized = (fn) => (onUnauthorized = fn);

export async function api(method, path, body) {
  if (await loadDemo()) return demoApi(method, path, body || {});
  const [t, base] = await Promise.all([getToken(), getApiUrl()]);
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Cannot reach the Wese server at ${base}. Check your internet connection or the server address.`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && t) { await setToken(null); onUnauthorized(); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

export const tzs = (n) => `${Math.round(n || 0).toLocaleString('en-US')} TZS`;
export const phoneFmt = (p) => (p || '').replace(/^255(\d{3})(\d{3})(\d{3})$/, '0$1 $2 $3');
