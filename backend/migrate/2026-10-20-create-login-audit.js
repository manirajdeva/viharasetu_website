#!/usr/bin/env node
/**
 * migrate/2026-10-20-create-login-audit.js
 * Creates the login_audit table (sign-in history). The API also does this on
 * start-up, so running it by hand is optional. Idempotent.
 *
 *   cd backend && node migrate/2026-10-20-create-login-audit.js
 */

require('dotenv').config();
const loginAudit = require('../src/loginAudit');
const pool = require('../src/db');

loginAudit.ensureSchema()
  .then(() => { console.log('login_audit ready'); return pool.end(); })
  .catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
