#!/usr/bin/env node
/**
 * migrate/2026-10-20-add-ist-time-columns.js
 * Adds an India Standard Time copy of the timestamp to the two history tables
 * (audit_log.changed_at_ist, login_audit.logged_at_ist) and fills it in for
 * existing rows. The API also does this on start-up, so running it by hand is
 * optional. Idempotent.
 *
 *   cd backend && node migrate/2026-10-20-add-ist-time-columns.js
 */

require('dotenv').config();
const audit = require('../src/audit');
const loginAudit = require('../src/loginAudit');
const pool = require('../src/db');

(async () => {
  await audit.ensureSchema();
  await loginAudit.ensureSchema();
  console.log('IST columns ready on audit_log and login_audit');
  await pool.end();
})().catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
