#!/usr/bin/env node
/**
 * migrate/2026-09-12-add-enquiry-trip-details.js
 * Adds the trip details the website enquiry forms now collect — no_of_people,
 * hotel_preference (3 / 4 / 5 Star) and special_req — to both `enquiries` and
 * the `site_enquirys` log, right after `travel`. Idempotent. Run it after
 * 2026-09-12-create-site-enquirys.js.
 *
 *   cd backend && node migrate/2026-09-12-add-enquiry-trip-details.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../src/config');

// [column, definition, the column it goes after]
const COLUMNS = [
  ['no_of_people', 'INT NULL', 'travel'],
  ['hotel_preference', "ENUM('3 Star','4 Star','5 Star') NULL", 'no_of_people'],
  ['special_req', 'TEXT NULL', 'hotel_preference'],
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

  for (const table of ['enquiries', 'site_enquirys']) {
    const [tables] = await conn.query('SHOW TABLES LIKE ?', [table]);
    if (!tables.length) {
      console.log(`• ${table} does not exist — skipped (run 2026-09-12-create-site-enquirys.js first)`);
      continue;
    }
    for (const [col, def, after] of COLUMNS) {
      const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [col]);
      if (cols.length) {
        console.log(`• ${table}.${col} already exists`);
        continue;
      }
      await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${def} AFTER \`${after}\``);
      console.log(`✓ added ${table}.${col}`);
    }
  }
  await conn.end();
})().catch((err) => {
  console.error('✗ migration failed:', err.message);
  process.exit(1);
});
