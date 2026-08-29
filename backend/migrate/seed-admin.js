#!/usr/bin/env node
/**
 * migrate/seed-admin.js
 * Create (or reset) a portal login. Passwords are bcrypt-hashed here; the
 * plaintext is only ever passed on the command line for this one-off.
 *
 *   node migrate/seed-admin.js <username> <password> [--role admin|employee] \
 *        [--mobile 98XXXXXXXX] [--email name@viharasetu.co.in]
 *
 * Defaults to --role admin (this is the bootstrap-admin tool). --can-delete is
 * accepted as a legacy alias for --role admin. Re-running with an existing
 * username RESETS that account's password / role. After seeding, log in and
 * change the password via the portal's Profile page.
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const config = require('../src/config');

function flagValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

(async () => {
  const args = process.argv.slice(2);
  const username = args[0];
  const password = args[1];

  if (!username || !password || username.startsWith('--')) {
    console.error('Usage: node migrate/seed-admin.js <username> <password> [--role admin|employee] [--mobile 98XXXXXXXX] [--email a@b.c]');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('✗ password must be at least 6 characters.');
    process.exit(1);
  }

  const roleArg = (flagValue(args, '--role') || '').toLowerCase();
  const role = roleArg === 'employee' ? 'employee' : 'admin'; // default admin; --can-delete = admin
  const canDelete = role === 'admin' ? 1 : 0;
  const mobile = flagValue(args, '--mobile');
  const email = flagValue(args, '--email');
  const hash = await bcrypt.hash(password, config.bcryptRounds);

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ssl: config.db.ssl,
  });

  await conn.query(
    `INSERT INTO admins (username, password_hash, role, can_delete, mobile, email)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       password_hash = VALUES(password_hash),
       role          = VALUES(role),
       can_delete    = VALUES(can_delete),
       mobile        = VALUES(mobile),
       email         = VALUES(email)`,
    [username, hash, role, canDelete, mobile, email],
  );
  await conn.end();

  console.log(`✓ "${username}" ready  (role=${role}${mobile ? `, mobile=${mobile}` : ''}${email ? `, email=${email}` : ''})`);
  console.log('  Ask them to log in and change this password from the Profile page.');
})().catch((err) => {
  console.error('✗ seed-admin failed:', err.message);
  process.exit(1);
});
