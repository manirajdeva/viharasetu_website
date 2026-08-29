#!/usr/bin/env node
/**
 * migrate/run-schema.js
 * Applies migrate/schema.sql to the database in .env. Idempotent — every
 * statement is CREATE TABLE IF NOT EXISTS, so re-running is safe.
 *
 *   node migrate/run-schema.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ssl: config.db.ssl,
    multipleStatements: true,
  });
  await conn.query(sql);
  await conn.end();
  console.log('✓ schema applied to', `${config.db.host}/${config.db.database}`);
})().catch((err) => {
  console.error('✗ schema failed:', err.message);
  process.exit(1);
});
