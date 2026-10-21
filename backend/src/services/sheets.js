/**
 * services/sheets.js
 * Config-driven CRUD for the four data entities (enquiries / suppliers /
 * bookings / payments), the MySQL equivalent of Code.gs's createRow_ /
 * updateRow_ / deleteRow_ / readRows_.
 *
 * Table and column names come only from the ENTITIES map in mappers.js — never
 * from the request — and every value is bound with a `?` placeholder.
 */

const pool = require('../db');
const { ENTITIES, headersFor, toDisplayRow, toDbValues } = require('../mappers');
const { nextEnquiryId, nextPaymentId } = require('../ids');
const { preparePaymentValues, paymentGroupKey, renumberGroup } = require('./payments');
const audit = require('../audit');
const { userTracked, actorName, decorateRow, headersWithUsers } = require('../userColumns');

const num = (x) => Number(String(x == null ? '' : x).replace(/[₹,\s]/g, '')) || 0;

/** supplier_ments: Profit is always Total Amount - Package Cost, never client-supplied. */
async function prepareSupplierValues(conn, vals, cur) {
  const has = (k) => Object.prototype.hasOwnProperty.call(vals, k);
  const total = has('Total Amount') ? num(vals['Total Amount']) : num(cur && cur.total_amount);
  const cost = has('Package Cost') ? num(vals['Package Cost']) : num(cur && cur.package_cost);
  vals['Profit'] = Math.round((total - cost) * 100) / 100;

  const eid = has('Enquiry ID') ? String(vals['Enquiry ID']).trim() : (cur && cur.enquiry_id);
  if (has('Enquiry ID') || !cur) {
    const [dup] = await conn.query('SELECT id FROM supplier_ments WHERE enquiry_id = ? AND id <> ? LIMIT 1', [eid, cur ? cur.id : 0]);
    if (dup.length) {
      const e = new Error(`A supplier payment already exists for ${eid}. Edit that row instead.`);
      e.code = 'DUPLICATE';
      throw e;
    }
  }
}

const q = (name) => `\`${name}\``; // identifiers are from our own map, but quote them anyway

/** Column headers for an entity, including Created By / Updated By where tracked. */
const headersOf = (key) => headersWithUsers(ENTITIES[key].table, headersFor(key));

/** All rows for one entity, in insertion order, as display rows. */
async function listRows(key) {
  const { table } = ENTITIES[key];
  const [rows] = await pool.query(`SELECT * FROM ${q(table)} ORDER BY id ASC`);
  return { headers: headersOf(key), rows: rows.map((r) => decorateRow(table, toDisplayRow(key, r), r)) };
}

async function getRow(key, rowIndex) {
  const [rows] = await pool.query(`SELECT * FROM ${q(ENTITIES[key].table)} WHERE id = ? LIMIT 1`, [Number(rowIndex)]);
  return rows.length ? decorateRow(ENTITIES[key].table, toDisplayRow(key, rows[0]), rows[0]) : null;
}

/**
 * Insert a row. Timestamp is stamped now; Enquiry ID / Payment ID are minted;
 * Pending Amount is derived for payments. Returns { ok:true } plus the minted
 * id(s) so the public contact form can echo the Enquiry ID back.
 *
 * opts.afterInsert(conn, generated), if given, runs inside the same
 * transaction after the insert, for extra writes that must commit or roll
 * back together with this row (e.g. the site_enquirys log).
 * opts.actor / opts.source say who made the change, for the audit_log entry.
 */
async function createRow(key, values, { afterInsert, actor, source } = {}) {
  const spec = ENTITIES[key];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const vals = Object.assign({}, values);
    if (key === 'payments') await preparePaymentValues(conn, vals, null);
    if (key === 'supplier_ments') await prepareSupplierValues(conn, vals, null);

    const db = toDbValues(key, vals, { skip: Object.keys(spec.generated) });
    db[spec.tsColumn] = new Date();
    if (userTracked(spec.table)) db.created_id = actorName(actor);   // who added it

    const generatedOut = {};
    if (key === 'enquiries') {
      db.enquiry_id = await nextEnquiryId(conn);
      generatedOut.enquiryId = db.enquiry_id;
    }
    if (key === 'payments') {
      db.payment_id = await nextPaymentId(conn);
      generatedOut.paymentId = db.payment_id;
    }

    const cols = Object.keys(db);
    const [ins] = await conn.query(
      `INSERT INTO ${q(spec.table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => db[c]),
    );

    if (key === 'payments') await renumberGroup(conn, paymentGroupKey(vals));
    const [[created]] = await conn.query(`SELECT * FROM ${q(spec.table)} WHERE id = ?`, [ins.insertId]);
    await audit.record(conn, { table: spec.table, action: 'INSERT', actor, source, after: created });
    if (afterInsert) await afterInsert(conn, generatedOut);

    await conn.commit();
    return Object.assign({ ok: true }, generatedOut);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * Update a row by rowIndex (= id). Timestamp and the generated id columns are
 * preserved (never written), exactly like Code.gs.updateRow_.
 */
async function updateRow(key, rowIndex, values, { actor, source } = {}) {
  const spec = ENTITIES[key];
  if (!rowIndex) {
    const e = new Error('Missing rowIndex');
    e.code = 'BAD_REQUEST';
    throw e;
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [cur] = await conn.query(`SELECT * FROM ${q(spec.table)} WHERE id = ? LIMIT 1 FOR UPDATE`, [Number(rowIndex)]);
    if (!cur.length) {
      const e = new Error('Row not found.');
      e.code = 'NOT_FOUND';
      throw e;
    }

    const vals = Object.assign({}, values);
    if (key === 'payments') await preparePaymentValues(conn, vals, rowIndex);
    if (key === 'supplier_ments') await prepareSupplierValues(conn, vals, cur[0]);

    const skip = [spec.tsColumn, ...Object.keys(spec.generated)];
    const db = toDbValues(key, vals, { skip });

    if (Object.keys(db).length) {
      await conn.query(
        `UPDATE ${q(spec.table)} SET ${Object.keys(db).map((c) => `${q(c)} = ?`).join(', ')} WHERE id = ?`,
        [...Object.values(db), Number(rowIndex)],
      );
    }

    // Keep instalment numbers gapless. If the payment moved to a different
    // enquiry/customer, renumber both the old group and the new one.
    if (key === 'payments') {
      const newKey = paymentGroupKey(vals);
      await renumberGroup(conn, newKey);
      const oldKey = paymentGroupKey(cur[0]);
      if (oldKey !== newKey) await renumberGroup(conn, oldKey);
    }

    const [[updated]] = await conn.query(`SELECT * FROM ${q(spec.table)} WHERE id = ?`, [Number(rowIndex)]);
    // who last changed it - only when something really changed, so a Save with no edits does not take over the row
    if (userTracked(spec.table) && audit.hasChanges(cur[0], updated)) {
      await conn.query(`UPDATE ${q(spec.table)} SET updated_id = ? WHERE id = ?`, [actorName(actor), Number(rowIndex)]);
    }
    await audit.record(conn, { table: spec.table, action: 'UPDATE', actor, source, before: cur[0], after: updated });

    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteRow(key, admin, rowIndex, { source } = {}) {
  if (!admin) {
    const e = new Error('Not signed in.');
    e.code = 'FORBIDDEN';
    throw e;
  }
  if (!rowIndex) {
    const e = new Error('Missing rowIndex');
    e.code = 'BAD_REQUEST';
    throw e;
  }

  const spec = ENTITIES[key];
  await audit.inTransaction(async (conn) => {
    const [[victim]] = await conn.query(`SELECT * FROM ${q(spec.table)} WHERE id = ? LIMIT 1 FOR UPDATE`, [Number(rowIndex)]);
    if (!victim) return; // already gone
    await conn.query(`DELETE FROM ${q(spec.table)} WHERE id = ?`, [Number(rowIndex)]);
    // Payments: renumber the affected group so instalments stay 1..N.
    if (key === 'payments') await renumberGroup(conn, paymentGroupKey(victim));
    await audit.record(conn, { table: spec.table, action: 'DELETE', actor: admin.username, source, before: victim });
  });
  return { ok: true };
}

module.exports = { listRows, getRow, createRow, updateRow, deleteRow, headersOf };
