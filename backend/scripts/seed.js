// Fills the database with demo accounts and stations in Dar es Salaam.
// Run once: npm run seed   (safe to re-run; skips accounts that already exist)
import { one, run, tx } from '../src/db.js';
import { hashPassword } from '../src/lib/auth.js';
import { PAYMENT_METHODS } from '../src/config.js';

const PW = 'wese1234';
const user = (name, phone, role, stationId = null) => {
  const ex = one('SELECT id FROM users WHERE phone = ?', phone);
  if (ex) return ex.id;
  return Number(run('INSERT INTO users (name, phone, password_hash, role, station_id) VALUES (?,?,?,?,?)', name, phone, hashPassword(PW), role, stationId).lastInsertRowid);
};

const stations = [
  { name: 'Mwenge Energies', owner: ['Rehema Mushi', '255713000001'], phone: '255713000001', license: 'EWURA/RT/2025/0412', address: 'Sam Nujoma Rd, Mwenge', lat: -6.768, lng: 39.226, boda: 1, tanker: 1,
    products: [['Petrol', 'petrol', 2915, 8200], ['Diesel', 'diesel', 2832, 11400]],
    pay: { mpesa: 'Lipa 551204', mixx: 'Lipa 551204', airtel: 'Lipa 551204', card: 'Card checkout', bank: 'CRDB 0150 3381 2200' },
    riders: [['Juma Mrisho', '255754000011', 'boda', 'MC 712 CVB'], ['Neema Kweka', '255754000012', 'tanker', 'T 905 EAZ']] },
  { name: 'Bahari Fuel Point', owner: ['Ali Hassan', '255713000002'], phone: '255713000002', license: 'EWURA/RT/2024/1188', address: 'Chole Rd, Msasani', lat: -6.758, lng: 39.270, boda: 1, tanker: 0,
    products: [['Petrol', 'petrol', 2940, 5100], ['Diesel', 'diesel', 2850, 3900]],
    pay: { mpesa: 'Lipa 820017', airtel: 'Lipa 820017', card: 'Card checkout' },
    riders: [['Baraka Shija', '255754000013', 'boda', 'MC 330 DXA']] },
  { name: 'Ubungo Petro Hub', owner: ['Grace Mollel', '255713000003'], phone: '255713000003', license: 'EWURA/RT/2023/0907', address: 'Morogoro Rd, Ubungo', lat: -6.790, lng: 39.205, boda: 1, tanker: 1,
    products: [['Petrol', 'petrol', 2899, 2400], ['Diesel', 'diesel', 2815, 16000]],
    pay: { mpesa: 'Lipa 330981', mixx: 'Lipa 330981', halopesa: 'Lipa 330981', bank: 'NMB 2210 4477 901' },
    riders: [['Said Omari', '255754000014', 'tanker', 'T 218 DHN'], ['Musa Kileo', '255754000015', 'boda', 'MC 118 EBC']] },
];

tx(() => {
  user('Wese Admin', '255700000000', 'admin');
  user('Demo Client', '255754123456', 'client');
  for (const s of stations) {
    const ownerId = user(s.owner[0], s.owner[1], 'station');
    let st = one('SELECT id FROM stations WHERE owner_id = ?', ownerId);
    if (st) continue;
    const id = Number(run(`INSERT INTO stations (owner_id, name, license_no, phone, address, lat, lng, status, offers_boda, offers_tanker, is_open)
                           VALUES (?,?,?,?,?,?,?,'approved',?,?,1)`, ownerId, s.name, s.license, s.phone, s.address, s.lat, s.lng, s.boda, s.tanker).lastInsertRowid);
    run('UPDATE users SET station_id = ? WHERE id = ?', id, ownerId);
    for (const [name, type, price, stock] of s.products) run('INSERT INTO products (station_id, name, fuel_type, price_per_litre, stock_litres) VALUES (?,?,?,?,?)', id, name, type, price, stock);
    for (const m of Object.keys(PAYMENT_METHODS)) run('INSERT INTO station_payment_methods (station_id, method, enabled, account) VALUES (?,?,?,?)', id, m, s.pay[m] ? 1 : 0, s.pay[m] || '');
    for (const [name, phone, vehicle, plate] of s.riders) {
      const rid = user(name, phone, 'rider', id);
      run('INSERT OR IGNORE INTO riders (user_id, station_id, vehicle, plate, online) VALUES (?,?,?,?,1)', rid, id, vehicle, plate);
    }
  }
});

console.log(`Demo data ready. Every demo password is "${PW}".
  Admin            0700 000 000
  Client           0754 123 456
  Station (Mwenge) 0713 000 001   Bahari 0713 000 002   Ubungo 0713 000 003
  Riders (Mwenge)  0754 000 011 (boda)   0754 000 012 (tanker)`);
