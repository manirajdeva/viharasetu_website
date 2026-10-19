/**
 * services/profile.js
 * "Update your own contact details / password" — the MySQL equivalent of
 * Code.gs.updateProfile_. Changing the password requires the current one.
 */

const bcrypt = require('bcryptjs');
const pool = require('../db');
const config = require('../config');
const auth = require('../auth');
const audit = require('../audit');

async function updateProfile(admin, updates) {
  updates = updates || {};

  if (updates.password) {
    const ok = await bcrypt.compare(String(updates.currentPassword || ''), admin.password_hash);
    if (!ok) return { ok: false, error: { code: 'BAD_PASSWORD', message: 'Current password is incorrect.' } };
    if (String(updates.password).length < 6) {
      return { ok: false, error: { code: 'WEAK_PASSWORD', message: 'New password must be at least 6 characters.' } };
    }
  }

  const sets = [];
  const args = [];
  if (updates.password) { sets.push('password_hash = ?'); args.push(await bcrypt.hash(String(updates.password), config.bcryptRounds)); }
  if (updates.mobile !== undefined) { sets.push('mobile = ?'); args.push(String(updates.mobile || '')); }
  if (updates.email !== undefined) { sets.push('email = ?'); args.push(String(updates.email || '')); }
  if (sets.length) {
    await audit.inTransaction(async (conn) => {
      await conn.query(`UPDATE admins SET ${sets.join(', ')} WHERE id = ?`, [...args, admin.id]);
      const [[updated]] = await conn.query('SELECT * FROM admins WHERE id = ?', [admin.id]);
      await audit.record(conn, { table: 'admins', action: 'UPDATE', actor: admin.username, before: admin, after: updated });
    });
  }

  const fresh = await auth.findAdmin(admin.username);
  return { ok: true, user: auth.publicAdmin(fresh) };
}

module.exports = { updateProfile };
