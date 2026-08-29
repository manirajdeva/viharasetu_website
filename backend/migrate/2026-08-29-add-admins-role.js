#!/usr/bin/env node
/**
 * migrate/2026-08-29-add-admins-role.js
 * Adds admins.role ('admin' | 'employee') and back-fills it from can_delete
 * (accounts that could delete become admins, the rest employees). Idempotent.
 *
 *   cd backend && node migrate/2026-08-29-add-admins-role.js
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

  const [cols] = await conn.query("SHOW COLUMNS FROM admins LIKE 'role'");
  if (!cols.length) {
    await conn.query(
      "ALTER TABLE admins ADD COLUMN role ENUM('admin','employee') NOT NULL DEFAULT 'employee' AFTER password_hash",
    );
    console.log('✓ added admins.role');
  } else {
    console.log('• admins.role already exists');
  }

  const [res] = await conn.query("UPDATE admins SET role = IF(can_delete = 1, 'admin', 'employee')");
  const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM admins WHERE role = 'admin'");
  console.log(`✓ set role on ${res.affectedRows} account(s); ${n} admin(s) total`);

  if (Number(n) === 0) {
    console.warn('⚠ no admins — promote one with:  node migrate/seed-admin.js <username> <password> --role admin');
  }
  await conn.end();
})().catch((err) => {
  console.error('✗ migration failed:', err.message);
  process.exit(1);
});
