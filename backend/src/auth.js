/**
 * auth.js
 * Admin accounts + token sessions, replacing the Apps Script equivalents.
 *
 *  - login  : bcrypt-verify username/password -> mint a 32-hex token row in
 *             `sessions`, valid for SESSION_TTL_HOURS (default 6h).
 *  - every subsequent request carries that token; an unknown/expired token
 *             resolves to SESSION_EXPIRED, which bounces the user to login.
 *  - passwords are bcrypt hashes; the plaintext never leaves the client and
 *             is never logged.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const config = require('./config');

class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** 'admin' | 'employee', tolerating rows written before the role column existed. */
function roleOf(a) {
  if (a.role === 'admin' || a.role === 'employee') return a.role;
  return a.can_delete ? 'admin' : 'employee';
}

/** Public view of an admin row — never includes the hash. */
const publicAdmin = (a) => {
  const role = roleOf(a);
  return {
    username: a.username,
    role,
    canManageUsers: role === 'admin',
    canEdit: role === 'admin',
    canDelete: role === 'admin',
    mobile: a.mobile || '',
    email: a.email || '',
  };
};

async function findAdmin(username) {
  const [rows] = await pool.query('SELECT * FROM admins WHERE username = ? LIMIT 1', [String(username || '')]);
  return rows[0] || null;
}

async function verifyAdmin(username, password) {
  const admin = await findAdmin(username);
  if (!admin || !password) return null;
  const ok = await bcrypt.compare(String(password), admin.password_hash);
  return ok ? admin : null;
}

async function createSession(username) {
  await purgeExpiredSessions();
  const token = crypto.randomBytes(16).toString('hex'); // 32 hex chars
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);
  await pool.query('INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)', [token, username, expiresAt]);
  return { token, expiresAt: expiresAt.getTime() };
}

/** Returns the username for a live token, or null (deleting it if expired). */
async function sessionUsername(token) {
  if (!token) return null;
  const [rows] = await pool.query('SELECT username, expires_at FROM sessions WHERE token = ? LIMIT 1', [String(token)]);
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await pool.query('DELETE FROM sessions WHERE token = ?', [String(token)]);
    return null;
  }
  return row.username;
}

async function deleteSession(token) {
  if (token) await pool.query('DELETE FROM sessions WHERE token = ?', [String(token)]);
}

async function purgeExpiredSessions() {
  await pool.query('DELETE FROM sessions WHERE expires_at < NOW()');
}

/**
 * Resolve the caller to an admin row, or throw SESSION_EXPIRED.
 * Accepts a session token (normal path) or a username/password pair (fallback,
 * kept for parity with the old backend).
 */
async function requireAdmin(body) {
  const username = await sessionUsername(body && body.token);
  if (username) {
    const admin = await findAdmin(username);
    if (admin) return admin;
  }
  if (body && body.username && body.password) {
    const admin = await verifyAdmin(body.username, body.password);
    if (admin) return admin;
  }
  throw new AuthError('SESSION_EXPIRED', 'Your session has expired. Please log in again.');
}

module.exports = {
  AuthError,
  roleOf,
  publicAdmin,
  findAdmin,
  verifyAdmin,
  createSession,
  sessionUsername,
  deleteSession,
  purgeExpiredSessions,
  requireAdmin,
};
