#!/usr/bin/env node
/**
 * migrate/2026-09-30-add-enquiry-status-confirmed.js
 * Adds 'Confirmed' to the enquiries.status ENUM. Idempotent.
 *
 *   cd backend && node migrate/2026-09-30-add-enquiry-status-confirmed.js
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

  const [cols] = await conn.query("SHOW COLUMNS FROM enquiries LIKE 'status'");
  if (cols.length && !/'Confirmed'/.test(cols[0].Type)) {
    await conn.query(
      "ALTER TABLE enquiries MODIFY COLUMN status ENUM('New','Contacted','Booked','Closed','Confirmed') NOT NULL DEFAULT 'New'",
    );
    console.log("✓ added 'Confirmed' to enquiries.status");
  } else {
    console.log("• enquiries.status already has 'Confirmed'");
  }
  await conn.end();
})().catch((err) => {
  console.error('✗ migration failed:', err.message);
  process.exit(1);
});
