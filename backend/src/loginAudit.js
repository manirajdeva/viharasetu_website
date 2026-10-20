/**
 * loginAudit.js
 * Who signed in, when, from where — and who tried and failed.
 *
 * One row in `login_audit` per event:
 *   LOGIN         a successful sign-in
 *   LOGIN_FAILED  a refused attempt (reason: BAD_LOGIN | INACTIVE | RATE_LIMITED)
 *   LOGOUT        an explicit sign-out
 *
 * Each row keeps the username as typed, the client IP, a readable device
 * ("Chrome on Windows") and the raw user-agent. LOGIN and LOGOUT carry the same
 * `session_ref` (a short hash of the session token) so a session's sign-in and
 * sign-out can be paired. The token itself and the password are never stored.
 *
 * Writing an audit row must never stop someone logging in, so record() swallows
 * and logs its own errors.
 */

const crypto = require('crypto');
const pool = require('./db');
const log = require('./logger');

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_audit (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      username    VARCHAR(80)  NOT NULL,
      admin_id    BIGINT UNSIGNED NULL,
      role        VARCHAR(20)      NULL,
      event       ENUM('LOGIN','LOGIN_FAILED','LOGOUT') NOT NULL,
      success     TINYINT(1)   NOT NULL,
      reason      VARCHAR(40)      NULL,
      session_ref CHAR(16)         NULL,
      ip          VARCHAR(64)      NULL,
      device      VARCHAR(80)      NULL,
      user_agent  VARCHAR(255)     NULL,
      logged_at   DATETIME     NOT NULL,
      PRIMARY KEY (id),
      KEY idx_login_user (username, logged_at),
      KEY idx_login_time (logged_at),
      KEY idx_login_session (session_ref)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

/** Short, non-reversible handle for a session token (pairs LOGIN with LOGOUT). */
const sessionRef = (token) => (token ? crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16) : null);

/** "Chrome on Windows" from a user-agent string. Best effort, for humans. */
function describeDevice(ua) {
  const s = String(ua || '');
  if (!s) return null;
  const browser =
    /Edg\//.test(s) ? 'Edge' :
    /OPR\/|Opera/.test(s) ? 'Opera' :
    /Firefox\//.test(s) ? 'Firefox' :
    /Chrome\/|CriOS\//.test(s) ? 'Chrome' :
    /Safari\//.test(s) ? 'Safari' : 'Other browser';
  const os =
    /Windows/.test(s) ? 'Windows' :
    /Android/.test(s) ? 'Android' :
    /iPhone|iPad|iPod/.test(s) ? 'iOS' :
    /Mac OS X|Macintosh/.test(s) ? 'macOS' :
    /Linux/.test(s) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

/**
 * record(req, { event, username, admin?, reason?, token? })
 *   admin  : the admin row, when the account exists (gives admin_id + role)
 *   token  : the session token, for LOGIN / LOGOUT (only a hash is stored)
 */
async function record(req, { event, username, admin, reason, token }) {
  try {
    const ua = req && req.headers ? req.headers['user-agent'] : null;
    await pool.query(
      `INSERT INTO login_audit
         (username, admin_id, role, event, success, reason, session_ref, ip, device, user_agent, logged_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clip(username || (admin && admin.username) || '', 80),
        admin ? admin.id : null,
        admin ? clip(admin.role, 20) : null,
        event,
        event === 'LOGIN_FAILED' ? 0 : 1,
        clip(reason, 40),
        sessionRef(token),
        clip(req && req.ip, 64),
        describeDevice(ua),
        clip(ua, 255),
        new Date(),
      ],
    );
  } catch (err) {
    log.error('login_audit write failed (login itself is unaffected)', err);
  }
}

/** RATE_LIMITED rows: at most one per IP per minute, so a flood cannot fill the table. */
const lastBlocked = new Map();
function recordRateLimited(req) {
  const ip = (req && req.ip) || '?';
  const now = Date.now();
  if (now - (lastBlocked.get(ip) || 0) < 60000) return;
  lastBlocked.set(ip, now);
  if (lastBlocked.size > 5000) lastBlocked.clear();
  const username = req && req.body && typeof req.body.username === 'string' ? req.body.username : '';
  return record(req, { event: 'LOGIN_FAILED', username, reason: 'RATE_LIMITED' });
}

/**
 * History, newest first.
 * filters: username, event, success (0|1), ip, dateFrom, dateTo (yyyy-mm-dd), limit (<=500), offset
 */
async function list(filters = {}) {
  const where = [];
  const args = [];
  const add = (sql, value) => { where.push(sql); args.push(value); };
  if (filters.username) add('username = ?', String(filters.username));
  if (['LOGIN', 'LOGIN_FAILED', 'LOGOUT'].includes(String(filters.event || '').toUpperCase())) {
    add('event = ?', String(filters.event).toUpperCase());
  }
  if (filters.success === 0 || filters.success === 1 || filters.success === '0' || filters.success === '1') {
    add('success = ?', Number(filters.success));
  }
  if (filters.ip) add('ip = ?', String(filters.ip));
  if (filters.dateFrom) add('logged_at >= ?', new Date(`${filters.dateFrom}T00:00:00Z`));
  if (filters.dateTo) add('logged_at < ?', new Date(new Date(`${filters.dateTo}T00:00:00Z`).getTime() + 86400000));

  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM login_audit ${clause}`, args);
  const [rows] = await pool.query(
    `SELECT id, username, role, event, success, reason, session_ref, ip, device, logged_at
       FROM login_audit ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
  return {
    total: Number(total),
    rows: rows.map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role || '',
      event: r.event,
      success: !!r.success,
      reason: r.reason || '',
      sessionRef: r.session_ref || '',
      ip: r.ip || '',
      device: r.device || '',
      at: r.logged_at instanceof Date ? r.logged_at.toISOString() : r.logged_at,
    })),
  };
}

module.exports = { ensureSchema, record, recordRateLimited, list, sessionRef, describeDevice };
