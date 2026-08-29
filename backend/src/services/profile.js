/**
 * services/profile.js
 * "Update your own contact details / password" — the MySQL equivalent of
 * Code.gs.updateProfile_. Changing the password requires the current one.
 */

const bcrypt = require('bcryptjs');
const pool = require('../db');
const config = require('../config');
const auth = require('../auth');

async function updateProfile(admin, updates) {
  updates = updates || {};

  if (updates.password) {
    const ok = await bcrypt.compare(String(updates.currentPassword || ''), admin.password_hash);
    if (!ok) return { ok: false, error: { code: 'BAD_PASSWORD', message: 'Current password is incorrect.' } };
    if (String(updates.password).length < 6) {
      return { ok: false, error: { code: 'WEAK_PASSWORD', message: 'New password must be at least 6 characters.' } };
    }
    const hash = await bcrypt.hash(String(updates.password), config.bcryptRounds);
    await pool.query('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, admin.id]);
  }

  if (updates.mobile !== undefined) {
    await pool.query('UPDATE admins SET mobile = ? WHERE id = ?', [String(updates.mobile || ''), admin.id]);
  }
  if (updates.email !== undefined) {
    await pool.query('UPDATE admins SET email = ? WHERE id = ?', [String(updates.email || ''), admin.id]);
  }

  const fresh = await auth.findAdmin(admin.username);
  return { ok: true, user: auth.publicAdmin(fresh) };
}

module.exports = { updateProfile };
