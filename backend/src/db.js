/**
 * db.js
 * One shared mysql2 connection pool, built from environment variables.
 *
 *  - timezone 'Z'      : DATETIME columns are read/written as UTC, so
 *                        mapper `.toISOString()` produces a correct instant
 *                        (the old Apps Script backend also returned ISO UTC).
 *  - decimalNumbers    : DECIMAL columns come back as JS numbers, matching
 *                        how the portal and the old mock server treat amounts.
 *
 * Every query in the app goes through this pool and uses `?` placeholders —
 * there is no string interpolation of user input anywhere.
 */

const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  ssl: config.db.ssl,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  maxIdle: config.db.connectionLimit,
  enableKeepAlive: true,
  timezone: 'Z',
  dateStrings: false,
  decimalNumbers: true,
  charset: 'utf8mb4',
});

module.exports = pool;
