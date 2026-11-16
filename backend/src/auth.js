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
const mfa = require('./mfa');

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

/** Accounts can be switched off (admins.active = 0); rows from before the column count as active. */
const isActive = (a) => !(a && (a.active === 0 || a.active === false || a.active === '0'));

/** Adds admins.active when the database predates it. Safe to run on every start. */
async function ensureSchema() {
  const [cols] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admins' AND COLUMN_NAME = 'active'",
  );
  if (!cols.length) {
    await pool.query('ALTER TABLE admins ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1 AFTER email');
  }
  const [mfaCols] = await pool.query(
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'admins' AND COLUMN_NAME = 'totp_enabled'",
  );
  if (!mfaCols.length) {
    await pool.query('ALTER TABLE admins ADD COLUMN totp_secret VARCHAR(255) NULL, ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0, ADD COLUMN totp_last_step BIGINT NULL');
  }
}

/** Public view of an admin row — never includes the hash. */
const publicAdmin = (a) => {
  const role = roleOf(a);
  return {
    username: a.username,
    role,
    canManageUsers: role === 'admin',   // Users page: admins only
    canEdit: true,                      // admin and employee both edit / delete records
    canDelete: true,
    mobile: a.mobile || '',
    email: a.email || '',
    mfaEnabled: mfaEnrolled(a),
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

/* ------------------------------ MFA (TOTP) ------------------------------ */

const mfaEnrolled = (a) => !!(a && (a.totp_enabled === 1 || a.totp_enabled === true || a.totp_enabled === '1') && a.totp_secret);

/** Resolve a challenge token (issued after the password check) to an active admin, or throw. */
async function adminFromChallenge(challenge) {
  const username = mfa.readChallenge(challenge);
  const admin = username && (await findAdmin(username));
  if (!admin || !isActive(admin)) throw new AuthError('MFA_EXPIRED', 'Your sign-in timed out. Please enter your password again.');
  return admin;
}

/** First-time setup: (re)generate a pending secret and return what the QR code needs. Refused once enrolled. */
async function startMfaSetup(challenge) {
  const admin = await adminFromChallenge(challenge);
  if (mfaEnrolled(admin)) throw new AuthError('MFA_ALREADY_SET', 'Authenticator is already set up for this account.');
  const secret = mfa.generateSecret();
  await pool.query('UPDATE admins SET totp_secret = ?, totp_enabled = 0, totp_last_step = NULL WHERE id = ?', [mfa.encryptSecret(secret), admin.id]);
  return { secret, otpauthUri: mfa.otpauthUri(admin.username, secret) };
}

/** Check a code for the challenge's user (confirming enrolment on first success). Returns the admin row. */
async function verifyMfaCode(challenge, code) {
  const admin = await adminFromChallenge(challenge);
  const wait = mfa.lockedFor(admin.username);
  if (wait) throw new AuthError('MFA_LOCKED', `Too many wrong codes. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`);
  if (!admin.totp_secret) throw new AuthError('MFA_NOT_SETUP', 'Authenticator setup was not started. Please sign in again.');
  const step = mfa.verifyCode(mfa.decryptSecret(admin.totp_secret), code, mfaEnrolled(admin) ? admin.totp_last_step : null);
  if (step === null) {
    mfa.recordFailure(admin.username);
    throw new AuthError('MFA_BAD_CODE', 'That code is not correct or has expired. Check the latest code in your authenticator app.');
  }
  mfa.clearFailures(admin.username);
  await pool.query('UPDATE admins SET totp_enabled = 1, totp_last_step = ? WHERE id = ?', [step, admin.id]);
  return admin;
}

async function resetMfa(username) {
  await pool.query('UPDATE admins SET totp_secret = NULL, totp_enabled = 0, totp_last_step = NULL WHERE username = ?', [String(username)]);
  await pool.query('DELETE FROM sessions WHERE username = ?', [String(username)]);   // force re-login
}

async function createSession(username) {
  // Expired rows are purged on startup and every 30 min (server.js), not on each login.
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
    if (admin && isActive(admin)) return admin;
  }
  if (body && body.username && body.password) {
    const admin = await verifyAdmin(body.username, body.password);
    if (admin && isActive(admin)) return admin;
  }
  throw new AuthError('SESSION_EXPIRED', 'Your session has expired. Please log in again.');
}

module.exports = {
  AuthError,
  roleOf,
  isActive,
  ensureSchema,
  publicAdmin,
  findAdmin,
  verifyAdmin,
  createSession,
  mfaEnrolled,
  startMfaSetup,
  verifyMfaCode,
  resetMfa,
  sessionUsername,
  deleteSession,
  purgeExpiredSessions,
  requireAdmin,
};
