/**
 * services/users.js
 * Portal account management (admins only). Roles:
 *   admin    — full access: add / edit / delete + manage users
 *   employee — view + add records; cannot edit or delete
 *
 * `can_delete` is kept in sync with the role so older frontend checks still
 * work. Guards: at least one admin must always remain; you cannot delete your
 * own account.
 */

const bcrypt = require('bcryptjs');
const pool = require('../db');
const config = require('../config');
const { roleOf } = require('../auth');
const { isValidPhone } = require('../phone');

const NAME_RE = /^[A-Za-z0-9._-]{3,80}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const err = (code, message) => Object.assign(new Error(message), { code });
const normRole = (v) => (v === 'admin' ? 'admin' : 'employee');

async function adminCount() {
  const [[row]] = await pool.query("SELECT COUNT(*) AS n FROM admins WHERE role = 'admin'");
  return Number(row.n);
}

async function listUsers() {
  const [rows] = await pool.query(
    'SELECT username, role, can_delete, mobile, email, created_at FROM admins ORDER BY role ASC, username ASC',
  );
  return rows.map((r) => ({
    username: r.username,
    role: roleOf(r),
    mobile: r.mobile || '',
    email: r.email || '',
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : (r.created_at || ''),
  }));
}

function validate(v, { isCreate }) {
  const s = (k) => String(v[k] == null ? '' : v[k]).trim();
  if (isCreate && !NAME_RE.test(s('username'))) {
    return 'Username must be 3–80 characters: letters, digits, dot, dash or underscore.';
  }
  const wantsPassword = isCreate || (v.password !== undefined && v.password !== '');
  if (wantsPassword && String(v.password || '').length < 6) return 'Password must be at least 6 characters.';
  if (v.role !== undefined && !['admin', 'employee'].includes(v.role)) return 'Role must be "admin" or "employee".';
  if (s('mobile') && !isValidPhone(s('mobile'))) return 'Enter a valid mobile number.';
  if (s('email') && !EMAIL_RE.test(s('email'))) return 'Enter a valid email address.';
  return null;
}

async function createUser(values) {
  const v = values || {};
  const bad = validate(v, { isCreate: true });
  if (bad) throw err('VALIDATION', bad);

  const username = String(v.username).trim();
  const [dup] = await pool.query('SELECT username FROM admins WHERE username = ? LIMIT 1', [username]);
  if (dup.length) throw err('DUPLICATE', 'That username already exists.');

  const role = normRole(v.role);
  const hash = await bcrypt.hash(String(v.password), config.bcryptRounds);
  await pool.query(
    'INSERT INTO admins (username, password_hash, role, can_delete, mobile, email) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hash, role, role === 'admin' ? 1 : 0, String(v.mobile || '').trim() || null, String(v.email || '').trim() || null],
  );
  return { ok: true };
}

async function updateUser(targetUsername, values, actingUsername) {
  const v = values || {};
  const bad = validate(v, { isCreate: false });
  if (bad) throw err('VALIDATION', bad);

  const [rows] = await pool.query('SELECT * FROM admins WHERE username = ? LIMIT 1', [String(targetUsername || '')]);
  const target = rows[0];
  if (!target) throw err('NOT_FOUND', 'User not found.');

  const currentRole = roleOf(target);
  const newRole = v.role !== undefined ? normRole(v.role) : currentRole;

  if (currentRole === 'admin' && newRole !== 'admin' && (await adminCount()) <= 1) {
    throw err('LAST_ADMIN', 'At least one admin must remain — promote another account first.');
  }

  const sets = [];
  const args = [];
  if (v.role !== undefined) { sets.push('role = ?', 'can_delete = ?'); args.push(newRole, newRole === 'admin' ? 1 : 0); }
  if (v.mobile !== undefined) { sets.push('mobile = ?'); args.push(String(v.mobile).trim() || null); }
  if (v.email !== undefined) { sets.push('email = ?'); args.push(String(v.email).trim() || null); }
  if (v.password) { sets.push('password_hash = ?'); args.push(await bcrypt.hash(String(v.password), config.bcryptRounds)); }
  if (!sets.length) return { ok: true };
  args.push(target.username);
  await pool.query(`UPDATE admins SET ${sets.join(', ')} WHERE username = ?`, args);
  return { ok: true };
}

async function deleteUser(targetUsername, actingUsername) {
  targetUsername = String(targetUsername || '');
  if (targetUsername === actingUsername) throw err('SELF', 'You cannot delete your own account.');

  const [rows] = await pool.query('SELECT * FROM admins WHERE username = ? LIMIT 1', [targetUsername]);
  const target = rows[0];
  if (!target) return { ok: true };

  if (roleOf(target) === 'admin' && (await adminCount()) <= 1) {
    throw err('LAST_ADMIN', 'At least one admin must remain.');
  }
  await pool.query('DELETE FROM admins WHERE username = ?', [targetUsername]);
  await pool.query('DELETE FROM sessions WHERE username = ?', [targetUsername]);
  return { ok: true };
}

module.exports = { listUsers, createUser, updateUser, deleteUser };
