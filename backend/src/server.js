import { networkInterfaces } from 'node:os';
import { createApp } from './app.js';
import { config } from './config.js';
import { one, run } from './db.js';
import { hashPassword } from './lib/auth.js';
import { phone } from './lib/http.js';

// Create the admin account on first start if ADMIN_PHONE / ADMIN_PASSWORD are set.
if (config.admin.phone && config.admin.password) {
  const p = phone(config.admin.phone);
  if (!one('SELECT id FROM users WHERE phone = ?', p)) {
    run("INSERT INTO users (name, phone, password_hash, role) VALUES ('Wese Admin', ?, ?, 'admin')", p, hashPassword(config.admin.password));
    console.log('Admin account created for', p);
  }
}

createApp().listen(config.port, '0.0.0.0', () => {
  console.log(`Wese is running (payments: ${config.paymentProvider})`);
  console.log(`  Station dashboard on this computer:  http://localhost:${config.port}/`);
  const lan = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  for (const i of lan) console.log(`  Server address for phones on the same Wi-Fi:  http://${i.address}:${config.port}`);
});
