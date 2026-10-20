#!/usr/bin/env node
/**
 * migrate/2026-10-20-add-login-audit-system-name.js
 * Adds login_audit.system_name and login_audit.device_id to an existing table.
 * The API also does this on start-up, so running it by hand is optional. Idempotent.
 *
 *   cd backend && node migrate/2026-10-20-add-login-audit-system-name.js
 */

require('dotenv').config();
const loginAudit = require('../src/loginAudit');
const pool = require('../src/db');

loginAudit.ensureSchema()
  .then(() => { console.log('login_audit has system_name + device_id'); return pool.end(); })
  .catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
