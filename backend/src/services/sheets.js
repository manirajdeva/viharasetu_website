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
const { preparePaymentValues } = require('./payments');

const q = (name) => `\`${name}\``; // identifiers are from our own map, but quote them anyway

/** All rows for one entity, in insertion order, as display rows. */
async function listRows(key) {
  const { table } = ENTITIES[key];
  const [rows] = await pool.query(`SELECT * FROM ${q(table)} ORDER BY id ASC`);
  return { headers: headersFor(key), rows: rows.map((r) => toDisplayRow(key, r)) };
}

async function getRow(key, rowIndex) {
  const [rows] = await pool.query(`SELECT * FROM ${q(ENTITIES[key].table)} WHERE id = ? LIMIT 1`, [Number(rowIndex)]);
  return rows.length ? toDisplayRow(key, rows[0]) : null;
}

/**
 * Insert a row. Timestamp is stamped now; Enquiry ID / Payment ID are minted;
 * Pending Amount is derived for payments. Returns { ok:true } plus the minted
 * id(s) so the public contact form can echo the Enquiry ID back.
 */
async function createRow(key, values) {
  const spec = ENTITIES[key];
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const vals = Object.assign({}, values);
    if (key === 'payments') await preparePaymentValues(conn, vals, null);

    const db = toDbValues(key, vals, { skip: Object.keys(spec.generated) });
    db[spec.tsColumn] = new Date();

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
    await conn.query(
      `INSERT INTO ${q(spec.table)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => db[c]),
    );

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
async function updateRow(key, rowIndex, values) {
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

    const skip = [spec.tsColumn, ...Object.keys(spec.generated)];
    const db = toDbValues(key, vals, { skip });

    if (Object.keys(db).length) {
      await conn.query(
        `UPDATE ${q(spec.table)} SET ${Object.keys(db).map((c) => `${q(c)} = ?`).join(', ')} WHERE id = ?`,
        [...Object.values(db), Number(rowIndex)],
      );
    }

    await conn.commit();
    return { ok: true };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function deleteRow(key, admin, rowIndex) {
  if (!admin || !admin.can_delete) {
    const e = new Error('This account cannot delete entries.');
    e.code = 'FORBIDDEN';
    throw e;
  }
  if (!rowIndex) {
    const e = new Error('Missing rowIndex');
    e.code = 'BAD_REQUEST';
    throw e;
  }
  await pool.query(`DELETE FROM ${q(ENTITIES[key].table)} WHERE id = ?`, [Number(rowIndex)]);
  return { ok: true };
}

module.exports = { listRows, getRow, createRow, updateRow, deleteRow };
