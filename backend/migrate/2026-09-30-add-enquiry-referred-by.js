#!/usr/bin/env node
/**
 * migrate/2026-09-30-add-enquiry-referred-by.js
 * Adds enquiries.referred_by (who referred the customer), right after
 * special_req. Idempotent.
 *
 *   cd backend && node migrate/2026-09-30-add-enquiry-referred-by.js
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

  const [cols] = await conn.query("SHOW COLUMNS FROM enquiries LIKE 'referred_by'");
  if (!cols.length) {
    await conn.query('ALTER TABLE enquiries ADD COLUMN referred_by VARCHAR(160) NULL AFTER special_req');
    console.log('✓ added enquiries.referred_by');
  } else {
    console.log('• enquiries.referred_by already exists');
  }
  await conn.end();
})().catch((err) => {
  console.error('✗ migration failed:', err.message);
  process.exit(1);
});
