#!/usr/bin/env node
/**
 * migrate/2026-08-29-add-payments-installment-no.js
 * Adds the payments.installment_no column and back-fills it: within each group
 * (same Enquiry ID, or same Customer when the ID is blank) payments are ordered
 * by recorded_at and numbered 1, 2, 3 … From then on the API keeps it in sync
 * (see services/payments.js renumberGroup). Idempotent.
 *
 *   cd backend && node migrate/2026-08-29-add-payments-installment-no.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../src/config');

const groupKey = (r) => {
  const e = String(r.enquiry_id || '').trim();
  return e ? `E:${e.toLowerCase()}` : `C:${String(r.customer || '').trim().toLowerCase()}`;
};

(async () => {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ssl: config.db.ssl,
  });

  const [cols] = await conn.query("SHOW COLUMNS FROM payments LIKE 'installment_no'");
  if (!cols.length) {
    await conn.query('ALTER TABLE payments ADD COLUMN installment_no INT NULL AFTER payment_id');
    console.log('✓ added payments.installment_no');
  } else {
    console.log('• payments.installment_no already exists');
  }

  const [rows] = await conn.query('SELECT id, enquiry_id, customer FROM payments ORDER BY recorded_at ASC, id ASC');
  const groups = new Map();
  rows.forEach((r) => {
    const k = groupKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });

  let changed = 0;
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) {
      const [res] = await conn.query(
        'UPDATE payments SET installment_no = ?, updated_at = updated_at WHERE id = ? AND (installment_no IS NULL OR installment_no <> ?)',
        [i + 1, list[i].id, i + 1],
      );
      changed += res.affectedRows;
    }
  }
  console.log(`✓ sequenced ${changed} row(s) across ${groups.size} group(s)`);
  await conn.end();
})().catch((err) => {
  console.error('✗ migration failed:', err.message);
  process.exit(1);
});
