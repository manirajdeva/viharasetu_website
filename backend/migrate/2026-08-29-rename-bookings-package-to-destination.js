#!/usr/bin/env node
/**
 * migrate/2026-08-29-rename-bookings-package-to-destination.js
 * One-off: rename bookings.package -> bookings.destination, so the Bookings
 * form/table uses the same "Destination" label as the Enquiry form.
 * Idempotent — does nothing if the column is already renamed.
 *
 *   cd backend && node migrate/2026-08-29-rename-bookings-package-to-destination.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../src/config');

(async () => {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ssl: config.db.ssl,
  });

  const [pkg] = await conn.query("SHOW COLUMNS FROM bookings LIKE 'package'");
  const [dest] = await conn.query("SHOW COLUMNS FROM bookings LIKE 'destination'");

  if (dest.length) {
    console.log('• bookings.destination already exists — nothing to do');
  } else if (pkg.length) {
    await conn.query('ALTER TABLE bookings CHANGE COLUMN `package` `destination` VARCHAR(200) NULL');
    console.log('✓ renamed bookings.package -> bookings.destination');
  } else {
    console.log('• neither column found — check the schema');
  }

  await conn.end();
})().catch((err) => {
  console.error('✗ migration failed:', err.message);
  process.exit(1);
});
