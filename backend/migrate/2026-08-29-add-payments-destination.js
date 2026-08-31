#!/usr/bin/env node
/**
 * migrate/2026-08-29-add-payments-destination.js
 * Adds payments.destination and back-fills it from the linked enquiry's
 * destination where the payment has an Enquiry ID. Idempotent.
 *
 *   cd backend && node migrate/2026-08-29-add-payments-destination.js
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

  const [cols] = await conn.query("SHOW COLUMNS FROM payments LIKE 'destination'");
  if (!cols.length) {
    await conn.query('ALTER TABLE payments ADD COLUMN destination VARCHAR(200) NULL AFTER customer');
    console.log('✓ added payments.destination');
  } else {
    console.log('• payments.destination already exists');
  }

  const [res] = await conn.query(
    `UPDATE payments p
       JOIN enquiries e ON e.enquiry_id = p.enquiry_id
        SET p.destination = e.destination, p.updated_at = p.updated_at
      WHERE (p.destination IS NULL OR p.destination = '')
        AND e.destination IS NOT NULL AND e.destination <> ''`,
  );
  console.log(`✓ back-filled destination on ${res.affectedRows} payment(s) from their enquiry`);
  await conn.end();
})().catch((err) => {
  console.error('✗ migration failed:', err.message);
  process.exit(1);
});
