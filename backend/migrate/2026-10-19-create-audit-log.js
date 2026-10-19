#!/usr/bin/env node
/**
 * migrate/2026-10-19-create-audit-log.js
 * Creates the audit_log table (change history). The API also does this on
 * start-up, so running it by hand is optional. Idempotent.
 *
 *   cd backend && node migrate/2026-10-19-create-audit-log.js
 */

require('dotenv').config();
const audit = require('../src/audit');
const pool = require('../src/db');

audit.ensureSchema()
  .then(() => { console.log('✓ audit_log ready'); return pool.end(); })
  .catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
