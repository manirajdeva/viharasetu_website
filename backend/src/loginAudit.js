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
 * ("Chrome on Windows"), the computer name the client reported (system_name), a
 * per-browser device_id, and the raw user-agent. Times are kept twice: logged_at
 * in UTC (canonical) and logged_at_ist in India Standard Time (easy to read). LOGIN and LOGOUT carry the same
 * `session_ref` (a short hash of the session token) so a session's sign-in and
 * sign-out can be paired. The token itself and the password are never stored.
 *
 * Writing an audit row must never stop someone logging in, so record() swallows
 * and logs its own errors.
 */

const crypto = require('crypto');
const pool = require('./db');
const log = require('./logger');
const { istString, ensureIstColumn } = require('./time');
const { ensureConsecutiveIds } = require('./tidb');

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
      system_name VARCHAR(80)      NULL,
      device_id   VARCHAR(40)      NULL,
      user_agent  VARCHAR(255)     NULL,
      logged_at   DATETIME     NOT NULL,
      logged_at_ist DATETIME       NULL,
      PRIMARY KEY (id),
      KEY idx_login_user (username, logged_at),
      KEY idx_login_time (logged_at),
      KEY idx_login_session (session_ref),
      KEY idx_login_device (device_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    /*T![auto_id_cache] AUTO_ID_CACHE=1 */`);

  // ... and added to a table created before they existed
  const [cols] = await pool.query(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_audit' AND COLUMN_NAME IN ('system_name', 'device_id')",
  );
  const have = new Set(cols.map((c) => c.COLUMN_NAME));
  if (!have.has('system_name')) await pool.query('ALTER TABLE login_audit ADD COLUMN system_name VARCHAR(80) NULL AFTER device');
  if (!have.has('device_id')) {
    await pool.query('ALTER TABLE login_audit ADD COLUMN device_id VARCHAR(40) NULL AFTER system_name');
    await pool.query('ALTER TABLE login_audit ADD KEY idx_login_device (device_id)');
  }

  await ensureIstColumn(pool, 'login_audit', 'logged_at_ist', 'logged_at', 'logged_at');
  await ensureConsecutiveIds(pool, 'login_audit');
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
 * The computer name is SELF-REPORTED by the client (the desktop app reads the real
 * hostname; a browser sends whatever was typed on the login page), so treat it as
 * a label, not proof. Control characters are stripped; empty becomes null.
 */
const cleanName = (v) => {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 80) : '';
  return s || null;
};
/** Random per-browser id (kept in the browser's localStorage) so one machine can be recognised across logins. */
const cleanDeviceId = (v) => (typeof v === 'string' && /^[A-Za-z0-9-]{8,40}$/.test(v) ? v : null);

/**
 * record(req, { event, username, admin?, reason?, token? })
 *   admin  : the admin row, when the account exists (gives admin_id + role)
 *   token  : the session token, for LOGIN / LOGOUT (only a hash is stored)
 */
async function record(req, { event, username, admin, reason, token }) {
  try {
    const ua = req && req.headers ? req.headers['user-agent'] : null;
    const body = req && req.body && typeof req.body === 'object' ? req.body : {};
    const loggedAt = new Date(Math.floor(Date.now() / 1000) * 1000); // whole seconds: UTC and IST columns then always agree
    await pool.query(
      `INSERT INTO login_audit
         (username, admin_id, role, event, success, reason, session_ref, ip, device, system_name, device_id, user_agent, logged_at, logged_at_ist)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        cleanName(body.systemName),
        cleanDeviceId(body.deviceId),
        clip(ua, 255),
        loggedAt,
        istString(loggedAt),
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
  if (filters.systemName) add('system_name = ?', String(filters.systemName));
  if (filters.deviceId) add('device_id = ?', String(filters.deviceId));
  if (filters.dateFrom) add('logged_at >= ?', new Date(`${filters.dateFrom}T00:00:00Z`));
  if (filters.dateTo) add('logged_at < ?', new Date(new Date(`${filters.dateTo}T00:00:00Z`).getTime() + 86400000));

  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM login_audit ${clause}`, args);
  const [rows] = await pool.query(
    `SELECT id, username, role, event, success, reason, session_ref, ip, device, system_name, device_id, logged_at, logged_at_ist
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
      systemName: r.system_name || '',
      deviceId: r.device_id || '',
      at: r.logged_at instanceof Date ? r.logged_at.toISOString() : r.logged_at,      // UTC instant
      atIst: r.logged_at_ist instanceof Date ? r.logged_at_ist.toISOString().slice(0, 19).replace('T', ' ') : (r.logged_at_ist || ''), // IST wall clock
    })),
  };
}

module.exports = { ensureSchema, record, recordRateLimited, list, sessionRef, describeDevice };
