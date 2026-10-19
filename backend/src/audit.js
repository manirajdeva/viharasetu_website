/**
 * audit.js
 * Change history for every insert / update / delete made through the API.
 *
 * One generic `audit_log` table (not one log table per entity):
 *   INSERT -> changes = the full new row
 *   UPDATE -> changes = { column: { old, new } } for the columns that really changed
 *   DELETE -> changes = the full row as it was before deletion
 *
 * record() takes the caller's transaction connection, so a change and its log
 * entry commit or roll back together. Secrets (password_hash) are never stored.
 * There is deliberately no foreign key: history must outlive the rows it describes.
 */

const pool = require('./db');

const IGNORED_COLUMNS = new Set(['updated_at']); // bookkeeping, changes on every write
const REDACTED_COLUMNS = new Set(['password_hash']);

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      table_name  VARCHAR(40)  NOT NULL,
      record_id   BIGINT UNSIGNED NOT NULL,
      record_ref  VARCHAR(80)      NULL,
      action      ENUM('INSERT','UPDATE','DELETE') NOT NULL,
      changed_by  VARCHAR(80)  NOT NULL,
      source      VARCHAR(20)  NOT NULL DEFAULT 'portal',
      changed_at  DATETIME     NOT NULL,
      changes     JSON         NOT NULL,
      PRIMARY KEY (id),
      KEY idx_audit_record (table_name, record_id, id),
      KEY idx_audit_ref (record_ref),
      KEY idx_audit_changed_at (changed_at),
      KEY idx_audit_user (changed_by, changed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

function plain(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return value === undefined ? null : value;
}

/** A row as stored in the log: no ignored columns, secrets masked, dates as ISO strings. */
function snapshot(row) {
  const out = {};
  for (const [col, value] of Object.entries(row || {})) {
    if (IGNORED_COLUMNS.has(col)) continue;
    out[col] = REDACTED_COLUMNS.has(col) ? '[hidden]' : plain(value);
  }
  return out;
}

/** { column: { old, new } } for every column whose value differs. */
function diff(before, after) {
  const changes = {};
  for (const col of Object.keys(after || {})) {
    if (IGNORED_COLUMNS.has(col)) continue;
    const oldRaw = plain(before[col]);
    const newRaw = plain(after[col]);
    if (String(oldRaw == null ? '' : oldRaw) === String(newRaw == null ? '' : newRaw)) continue;
    changes[col] = REDACTED_COLUMNS.has(col)
      ? { old: '[hidden]', new: '[changed]' }
      : { old: oldRaw, new: newRaw };
  }
  return changes;
}

/** The human-facing id of a row, so history can be searched by "ENQ-…" / "PMT-…" / username. */
const refOf = (row) => String(row.enquiry_id || row.payment_id || row.username || '') || null;

/**
 * Write one audit row on `conn` (use the open transaction's connection).
 *   action : 'INSERT' | 'UPDATE' | 'DELETE'
 *   before : row before the change (UPDATE, DELETE)     after : row after it (INSERT, UPDATE)
 * An UPDATE that changed nothing writes nothing.
 */
async function record(conn, { table, action, actor, source = 'portal', before, after }) {
  let changes;
  if (action === 'INSERT') changes = snapshot(after);
  else if (action === 'DELETE') changes = snapshot(before);
  else {
    changes = diff(before, after);
    if (!Object.keys(changes).length) return;
  }
  const row = action === 'DELETE' ? before : after;
  await conn.query(
    `INSERT INTO audit_log (table_name, record_id, record_ref, action, changed_by, source, changed_at, changes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [table, row.id, refOf(row), action, String(actor || 'system'), source, new Date(), JSON.stringify(changes)],
  );
}

/** Runs fn(conn) in a transaction; commits on success, rolls back on any throw. */
async function inTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * History lookup, newest first.
 * filters: table, recordId, ref, user, action, dateFrom, dateTo (yyyy-mm-dd), limit (<=500), offset
 */
async function list(filters = {}) {
  const where = [];
  const args = [];
  const add = (sql, value) => { where.push(sql); args.push(value); };
  if (filters.table) add('table_name = ?', String(filters.table));
  if (filters.recordId) add('record_id = ?', Number(filters.recordId));
  if (filters.ref) add('record_ref = ?', String(filters.ref));
  if (filters.user) add('changed_by = ?', String(filters.user));
  if (['INSERT', 'UPDATE', 'DELETE'].includes(String(filters.action || '').toUpperCase())) {
    add('action = ?', String(filters.action).toUpperCase());
  }
  if (filters.dateFrom) add('changed_at >= ?', new Date(`${filters.dateFrom}T00:00:00Z`));
  if (filters.dateTo) add('changed_at < ?', new Date(new Date(`${filters.dateTo}T00:00:00Z`).getTime() + 86400000));

  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 100, 1), 500);
  const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_log ${clause}`, args);
  const [rows] = await pool.query(
    `SELECT id, table_name, record_id, record_ref, action, changed_by, source, changed_at, changes
       FROM audit_log ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...args, limit, offset],
  );
  return {
    total: Number(total),
    rows: rows.map((r) => ({
      id: r.id,
      table: r.table_name,
      recordId: r.record_id,
      ref: r.record_ref || '',
      action: r.action,
      by: r.changed_by,
      source: r.source,
      at: r.changed_at instanceof Date ? r.changed_at.toISOString() : r.changed_at,
      changes: typeof r.changes === 'string' ? JSON.parse(r.changes) : r.changes,
    })),
  };
}

module.exports = { ensureSchema, record, inTransaction, list };
