#!/usr/bin/env node
/**
 * migrate/2026-10-16-add-admins-active.js
 * Adds admins.active (1 = can log in, 0 = inactive). The API also does this on
 * start-up, so running it by hand is optional. Idempotent.
 *
 *   cd backend && node migrate/2026-10-16-add-admins-active.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../src/config');

(async () => {
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: config.db.database, ssl: config.db.ssl,
  });
  const [cols] = await conn.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admins' AND COLUMN_NAME = 'active'",
  );
  if (cols.length) console.log('admins.active already exists — nothing to do.');
  else {
    await conn.query('ALTER TABLE admins ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1 AFTER email');
    console.log('✓ added admins.active (all existing accounts stay active)');
  }
  await conn.end();
})().catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
