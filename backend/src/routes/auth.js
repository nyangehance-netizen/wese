import { one, run } from '../db.js';
import { hashPassword, verifyPassword, signToken, requireUser, checkLoginRate, clearLoginRate } from '../lib/auth.js';
import { HttpError, bad, conflict, str, phone, oneOf } from '../lib/http.js';
import { isPushToken } from '../lib/push.js';

export function profile(userId) {
  const user = one('SELECT id, name, phone, role, station_id, created_at FROM users WHERE id = ?', userId);
  if (!user) return null;
  if (user.station_id) user.station = one('SELECT id, name, status, is_open FROM stations WHERE id = ?', user.station_id) || null;
  if (user.role === 'rider') user.rider = one('SELECT vehicle, plate, online, active FROM riders WHERE user_id = ?', user.id);
  return user;
}

export default (r) => {
  r.post('/api/auth/register', ({ body }) => {
    const name = str(body.name, 'Name', { min: 2, max: 80 });
    const ph = phone(body.phone);
    const password = str(body.password, 'Password', { min: 6, max: 100 });
    const role = oneOf(body.role || 'client', 'Account type', ['client', 'station']);
    if (one('SELECT id FROM users WHERE phone = ?', ph)) throw conflict('An account with this phone number already exists. Sign in instead.');
    const { lastInsertRowid: id } = run('INSERT INTO users (name, phone, password_hash, role) VALUES (?,?,?,?)', name, ph, hashPassword(password), role);
    return { token: signToken({ sub: Number(id), role }), user: profile(id) };
  });

  r.post('/api/auth/login', ({ body }) => {
    const ph = phone(body.phone);
    if (!body.password) throw bad('Password is required.');
    checkLoginRate(ph);
    const u = one('SELECT * FROM users WHERE phone = ?', ph);
    if (!u || !verifyPassword(String(body.password), u.password_hash)) throw new HttpError(401, 'Phone number or password is wrong.');
    if (u.role === 'rider' && !one('SELECT active FROM riders WHERE user_id = ?', u.id)?.active) throw new HttpError(403, 'This rider account is switched off. Contact your station.');
    clearLoginRate(ph);
    return { token: signToken({ sub: u.id, role: u.role }), user: profile(u.id) };
  });

  r.get('/api/me', requireUser(), ({ user }) => profile(user.id));

  // The phone app sends its Expo push token after sign-in; null clears it (sign-out).
  r.put('/api/me/push-token', requireUser(), ({ user, body }) => {
    const token = body.token ?? null;
    if (token !== null && !isPushToken(token)) throw bad('That is not an Expo push token.');
    if (token) run('UPDATE users SET push_token = NULL WHERE push_token = ? AND id != ?', token, user.id); // one phone, one account
    run('UPDATE users SET push_token = ? WHERE id = ?', token, user.id);
    return { ok: true };
  });

  r.patch('/api/me', requireUser(), ({ user, body }) => {
    if (body.name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', str(body.name, 'Name', { min: 2, max: 80 }), user.id);
    if (body.password !== undefined) {
      const u = one('SELECT password_hash FROM users WHERE id = ?', user.id);
      if (!verifyPassword(String(body.currentPassword || ''), u.password_hash)) throw bad('Current password is wrong.');
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(str(body.password, 'New password', { min: 6, max: 100 })), user.id);
    }
    return profile(user.id);
  });
};
