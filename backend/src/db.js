// SQLite database (Node's built-in driver). Schema is created on first start.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('client','station','rider','admin')),
  station_id INTEGER REFERENCES stations(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  license_no TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  is_open INTEGER NOT NULL DEFAULT 1,
  offers_boda INTEGER NOT NULL DEFAULT 1,
  offers_tanker INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  station_id INTEGER NOT NULL REFERENCES stations(id),
  name TEXT NOT NULL,
  fuel_type TEXT NOT NULL CHECK (fuel_type IN ('petrol','diesel','other')),
  price_per_litre INTEGER NOT NULL CHECK (price_per_litre > 0),
  stock_litres REAL NOT NULL DEFAULT 0 CHECK (stock_litres >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS station_payment_methods (
  station_id INTEGER NOT NULL REFERENCES stations(id),
  method TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  account TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (station_id, method)
);

CREATE TABLE IF NOT EXISTS riders (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  station_id INTEGER NOT NULL REFERENCES stations(id),
  vehicle TEXT NOT NULL CHECK (vehicle IN ('boda','tanker')),
  plate TEXT NOT NULL,
  online INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  lat REAL, lng REAL, last_seen TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE,
  client_id INTEGER NOT NULL REFERENCES users(id),
  station_id INTEGER NOT NULL REFERENCES stations(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  fuel_type TEXT NOT NULL,
  litres REAL NOT NULL,
  price_per_litre INTEGER NOT NULL,
  fuel_cost INTEGER NOT NULL,
  delivery_method TEXT NOT NULL,
  delivery_fee INTEGER NOT NULL,
  service_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  rider_earning INTEGER NOT NULL,
  distance_km REAL NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  landmark TEXT NOT NULL DEFAULT '',
  plate TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded')),
  status TEXT NOT NULL,
  otp TEXT NOT NULL,
  otp_attempts INTEGER NOT NULL DEFAULT 0,
  rider_id INTEGER REFERENCES users(id),
  stock_deducted INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS orders_station ON orders(station_id, status);
CREATE INDEX IF NOT EXISTS orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS orders_rider ON orders(rider_id);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  status TEXT NOT NULL,
  actor_id INTEGER,
  note TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL,
  method TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE,
  provider_ref TEXT,
  amount INTEGER NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  raw TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Columns added after the first release; added in place on existing databases.
function migrate(db) {
  const has = (table, col) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  if (!has('users', 'push_token')) db.exec('ALTER TABLE users ADD COLUMN push_token TEXT');
  if (!has('orders', 'notified_status')) db.exec('ALTER TABLE orders ADD COLUMN notified_status TEXT');
}

export function openDb(file = config.dbFile) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export const db = openDb(process.env.NODE_ENV === 'test' ? ':memory:' : config.dbFile);

export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

/** Run fn inside a transaction; rolls back if it throws. */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
