/**
 * mappers.js
 * The compatibility layer. The admin portal addresses rows by `rowIndex` and
 * columns by their display header ("Enquiry ID", "Amount Paid", ...). MySQL
 * uses `id` and snake_case columns. Everything crossing that boundary goes
 * through here, so the JSON envelope the frontend sees is byte-for-byte what
 * the old Apps Script backend produced.
 *
 *   ENTITIES        per-sheet spec: table, timestamp column, generated-id
 *                   columns, and the ordered [header, column, type] list.
 *   headersFor(k)   the ordered header array (matches Code.gs SHEETS[k].headers)
 *   toDisplayRow    DB row  ->  { rowIndex, "Header": value, ... }  (dates as ISO)
 *   toDbValues      { "Header": value }  ->  { column: coerced-value }
 */

const ENTITIES = {
  enquiries: {
    table: 'enquiries',
    tsColumn: 'received_at',              // "Timestamp" — set once at creation, never updated
    generated: { enquiry_id: 'enquiryId' }, // minted on create, preserved on update
    fields: [
      ['Enquiry ID', 'enquiry_id', 'string'],
      ['Timestamp', 'received_at', 'datetime'],
      ['Name', 'name', 'string'],
      ['Email', 'email', 'string'],
      ['Phone', 'phone', 'string'],
      ['Destination', 'destination', 'string'],
      ['Travel', 'travel', 'string'],
      ['Status', 'status', 'string'],
      ['Notes', 'notes', 'string'],
    ],
  },

  suppliers: {
    table: 'suppliers',
    tsColumn: 'added_at',
    generated: {},
    fields: [
      ['Timestamp', 'added_at', 'datetime'],
      ['Supplier Company Name', 'company_name', 'string'],
      ['States', 'states', 'string'],
      ['Supplier Name', 'contact_person', 'string'],
      ['Supplier ID', 'supplier_code', 'string'],
      ['Contact No', 'contact_no', 'string'],
    ],
  },

  bookings: {
    table: 'bookings',
    tsColumn: 'booked_at',
    generated: {},
    fields: [
      ['Enquiry ID', 'enquiry_id', 'string'],
      ['Timestamp', 'booked_at', 'datetime'],
      ['Customer', 'customer', 'string'],
      ['Destination', 'destination', 'string'],
      ['Travel Dates', 'travel_dates', 'string'],
      ['Pax', 'pax', 'int'],
      ['Amount', 'amount', 'decimal'],
      ['Payment Status', 'payment_status', 'string'],
      ['Notes', 'notes', 'string'],
    ],
  },

  payments: {
    table: 'payments',
    tsColumn: 'recorded_at',
    generated: { payment_id: 'paymentId', installment_no: 'installmentNo' }, // app-set, never from the client
    fields: [
      ['Enquiry ID', 'enquiry_id', 'string'],
      ['Timestamp', 'recorded_at', 'datetime'],
      ['Customer', 'customer', 'string'],
      ['Destination', 'destination', 'string'],
      ['Amount Paid', 'amount_paid', 'decimal'],
      ['Payment Mode', 'payment_mode', 'string'],
      ['Transaction Ref', 'transaction_ref', 'string'],
      ['Notes', 'notes', 'string'],
      ['Total Amount', 'total_amount', 'decimal'],
      ['Pending Amount', 'pending_amount', 'decimal'],
      ['Payment ID', 'payment_id', 'string'],
      ['Instalment', 'installment_no', 'int'],      // maintained by renumberGroup on create/update/delete
      ['Last Updated', 'updated_at', 'datetime'],   // read-only; DB ON UPDATE CURRENT_TIMESTAMP
    ],
  },
};

const ENTITY_KEYS = Object.keys(ENTITIES);

// Columns where an empty submitted value must become SQL NULL rather than ''.
// enquiry_id feeds a foreign key, so '' would break the constraint.
const EMPTY_TO_NULL = new Set(['enquiry_id', 'supplier_code', 'transaction_ref']);

function headersFor(key) {
  return ENTITIES[key].fields.map((f) => f[0]);
}

/** DB row -> display row. Nulls become '', Dates become ISO strings. */
function toDisplayRow(key, row) {
  const out = { rowIndex: row.id };
  for (const [header, col, type] of ENTITIES[key].fields) {
    let v = row[col];
    if (v === null || v === undefined) v = '';
    else if (type === 'datetime') v = v instanceof Date ? v.toISOString() : String(v);
    else if (type === 'decimal') v = typeof v === 'number' ? v : Number(v);
    out[header] = v;
  }
  return out;
}

/**
 * { "Header": value } -> { column: value } with per-type coercion.
 * Only headers actually present in `values` are included (so PATCH-style
 * partial updates touch just the supplied fields). `skip` is a list of
 * column names to leave out (timestamp + generated ids on update).
 */
function toDbValues(key, values, { skip = [] } = {}) {
  values = values || {};
  const skipSet = new Set(skip);
  const res = {};
  for (const [header, col, type] of ENTITIES[key].fields) {
    // datetime columns are never client-writable: the "Timestamp" column is
    // stamped in createRow and frozen on update; "Last Updated" is DB-managed.
    if (type === 'datetime' || skipSet.has(col) || !Object.prototype.hasOwnProperty.call(values, header)) continue;
    let v = values[header];
    if (v === undefined) continue;

    if (v === '' || v === null) {
      if (type === 'decimal') v = 0;
      else if (type === 'int') v = null;
      else v = EMPTY_TO_NULL.has(col) ? null : '';
    } else if (type === 'int') {
      const n = parseInt(v, 10);
      v = Number.isNaN(n) ? null : n;
    } else if (type === 'decimal') {
      const n = Number(String(v).replace(/[₹,\s]/g, ''));
      v = Number.isNaN(n) ? 0 : n;
    } else {
      v = String(v);
    }
    res[col] = v;
  }
  return res;
}

module.exports = { ENTITIES, ENTITY_KEYS, headersFor, toDisplayRow, toDbValues };
