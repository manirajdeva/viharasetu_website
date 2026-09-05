#!/usr/bin/env node
/**
 * migrate/2026-09-05-backfill-phone-country-code.js
 * Prefixes existing bare 10-digit Indian mobile numbers with "+91 " so they
 * match the "+<code> <number>" format the admin portal's phone fields now
 * write (see 2026-09-05 "Admin: add country code to phone fields"). Only
 * touches values matching the legacy bare format — anything already
 * prefixed with "+" is left untouched, so this is safe to re-run.
 *
 *   cd backend && node migrate/2026-09-05-backfill-phone-country-code.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../src/config');

const TARGETS = [
  { table: 'enquiries', column: 'phone' },
  { table: 'suppliers', column: 'contact_no' },
  { table: 'admins', column: 'mobile' },
];

(async () => {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ssl: config.db.ssl,
  });

  for (const { table, column } of TARGETS) {
    const [res] = await conn.query(
      `UPDATE \`${table}\`
       SET \`${column}\` = CONCAT('+91 ', TRIM(\`${column}\`))
       WHERE TRIM(\`${column}\`) REGEXP '^[6-9][0-9]{9}$'`,
    );
    console.log(`✓ ${table}.${column}: backfilled ${res.affectedRows} row(s)`);
  }

  await conn.end();
})().catch((err) => {
  console.error('✗ migration failed:', err.message);
  process.exit(1);
});
