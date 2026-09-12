#!/usr/bin/env node
/**
 * migrate/2026-09-12-create-site-enquirys.js
 * Creates the site_enquirys table: a log of every enquiry submitted on the
 * public website, with its submission timestamp. Idempotent.
 *
 *   cd backend && node migrate/2026-09-12-create-site-enquirys.js
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

  const [tables] = await conn.query("SHOW TABLES LIKE 'site_enquirys'");
  if (!tables.length) {
    await conn.query(`
      CREATE TABLE site_enquirys (
        id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        enquiry_id   VARCHAR(20)      NULL,
        submitted_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        source       VARCHAR(40)      NULL,
        name         VARCHAR(160) NOT NULL,
        email        VARCHAR(190) NOT NULL,
        phone        VARCHAR(20)      NULL,
        destination  VARCHAR(160)     NULL,
        travel       VARCHAR(120)     NULL,
        notes        TEXT             NULL,
        PRIMARY KEY (id),
        KEY idx_site_enquirys_submitted_at (submitted_at),
        KEY idx_site_enquirys_enquiry_id (enquiry_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    console.log('✓ created site_enquirys');
  } else {
    console.log('• site_enquirys already exists');
  }
  await conn.end();
})().catch((err) => {
  console.error('✗ migration failed:', err.message);
  process.exit(1);
});
