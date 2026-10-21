#!/usr/bin/env node
/**
 * migrate/2026-10-21-add-created-updated-id.js
 * Adds created_id / updated_id (the user name that added / last changed the row) to
 * enquiries, suppliers, bookings, payments and supplier_ments, and labels
 * website-origin enquiries 'website'. The API also does this on start-up, so
 * running it by hand is optional. Idempotent.
 *
 *   cd backend && node migrate/2026-10-21-add-created-updated-id.js
 */

require('dotenv').config();
const pool = require('../src/db');
const userColumns = require('../src/userColumns');

userColumns.ensureSchema(pool)
  .then(() => { console.log('created_id / updated_id ready on', userColumns.USER_TRACKED.join(', ')); return pool.end(); })
  .catch((err) => { console.error('Migration failed:', err.message); process.exit(1); });
