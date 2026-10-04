// All settings come from environment variables, with safe defaults for local use.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load backend/.env if present (KEY=value lines), without overriding real env vars.
const envFile = path.join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const config = {
  root,
  port: num(env.PORT, 4000),
  dbFile: env.DB_FILE || path.join(root, 'data', 'wese.db'),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  isProd: env.NODE_ENV === 'production',
  corsOrigin: env.CORS_ORIGIN || '*',
  dashboardDir: path.resolve(root, '..', 'dashboard'),

  // Pricing (TZS)
  serviceFeeRate: num(env.SERVICE_FEE_RATE, 0.02),
  riderShare: num(env.RIDER_SHARE, 0.8),
  maxDeliveryKm: num(env.MAX_DELIVERY_KM, 20),
  roadFactor: 1.35, // straight-line distance × this ≈ road distance in Dar
  delivery: {
    boda: { label: 'Boda (motorbike)', minLitres: 5, maxLitres: 20, baseFee: num(env.BODA_BASE_FEE, 3000), perKm: num(env.BODA_PER_KM, 500), kmh: 28 },
    tanker: { label: 'Mini tanker', minLitres: 30, maxLitres: 1000, baseFee: num(env.TANKER_BASE_FEE, 15000), perKm: num(env.TANKER_PER_KM, 1500), kmh: 20 },
  },
  // Optional regulator price caps per litre (set to EWURA's published cap for your zone).
  priceCaps: {
    petrol: num(env.PRICE_CAP_PETROL, 0),
    diesel: num(env.PRICE_CAP_DIESEL, 0),
  },

  // Payments
  paymentProvider: env.PAYMENT_PROVIDER || 'test',
  testAutoApproveMs: num(env.TEST_AUTO_APPROVE_MS, 5000), // 0 = approve manually only
  paymentWebhookSecret: env.PAYMENT_WEBHOOK_SECRET || '',

  otpMaxAttempts: 5,
  admin: { phone: env.ADMIN_PHONE || '', password: env.ADMIN_PASSWORD || '' },
};

export const PAYMENT_METHODS = {
  mpesa: { label: 'M-Pesa', kind: 'mobile' },
  mixx: { label: 'Mixx by Yas', kind: 'mobile' },
  airtel: { label: 'Airtel Money', kind: 'mobile' },
  halopesa: { label: 'HaloPesa', kind: 'mobile' },
  card: { label: 'Visa / Mastercard', kind: 'card' },
  bank: { label: 'Bank transfer', kind: 'bank' },
};

if (config.isProd && config.jwtSecret === 'dev-only-secret-change-me') {
  throw new Error('Set JWT_SECRET before running in production.');
}
