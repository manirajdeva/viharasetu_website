#!/usr/bin/env node
/**
 * migrate/import-from-sheets.js
 * One-off importer: Google Sheets CSV export  ->  MySQL.
 *
 * PREP — in the Google Sheet, File > Download > "Comma-separated values" for
 * each tab, and drop them here:
 *
 *   backend/sheets-export/enquiries.csv
 *   backend/sheets-export/suppliers.csv
 *   backend/sheets-export/bookings.csv
 *   backend/sheets-export/payments.csv
 *
 * The header row of each CSV must be the sheet's own headers, e.g.
 *   Enquiry ID,Timestamp,Name,Email,Phone,Destination,Travel,Status,Notes
 *
 * RUN
 *   node migrate/import-from-sheets.js --dry-run          # report only, writes nothing
 *   node migrate/import-from-sheets.js                    # import into empty tables
 *   node migrate/import-from-sheets.js --fresh            # TRUNCATE the 4 data tables first, then import
 *   node migrate/import-from-sheets.js --dir=/path/to/csvs
 *   node migrate/import-from-sheets.js --collapse-supplier-dupes
 *
 * SAFETY
 *   - Admins are NOT imported. Create them with migrate/seed-admin.js.
 *   - Refuses to run if a target table already has rows, unless --fresh.
 *   - No row is ever dropped. A booking/payment whose Enquiry ID is not found
 *     is imported with the link cleared (NULL) and a warning is printed.
 *   - Enquiries / Payments upsert on their natural key (enquiry_id / payment_id)
 *     so a re-run updates in place instead of duplicating.
 *   - Pending Amount is RECOMPUTED per enquiry/customer group, not trusted from
 *     the sheet, so the invariant holds after import.
 *   - The `counters` table is seeded from the highest IDs seen, so newly
 *     created enquiries/payments continue the sequence without collision.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const FRESH = args.includes('--fresh');
const COLLAPSE_SUP = args.includes('--collapse-supplier-dupes');
const DIR = (args.find((a) => a.startsWith('--dir=')) || '').slice(6) || path.join(__dirname, '..', 'sheets-export');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const strOrNull = (v) => { const s = String(v ?? '').trim(); return s || null; };
const intOrNull = (v) => { const s = String(v ?? '').trim(); if (!s) return null; const n = parseInt(s, 10); return Number.isNaN(n) ? null : n; };
const num = (v) => { const n = Number(String(v ?? '').replace(/[₹,\s]/g, '')); return Number.isNaN(n) ? 0 : n; };
const enumOr = (v, allowed, dflt) => { const s = String(v ?? '').trim(); return allowed.includes(s) ? s : dflt; };
const yesNo = (v) => (/^(true|yes|1)$/i.test(String(v ?? '').trim()) ? 1 : 0);

function readCsv(name) {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) {
    console.warn(`  - ${name}: not found in ${DIR} — skipping`);
    return [];
  }
  return parse(fs.readFileSync(p), { columns: true, skip_empty_lines: true, trim: true, bom: true });
}

/** Parse a Sheets cell into a JS Date: ISO/locale strings and Google serials. */
function toDateTime(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  const n = Number(s);
  if (!Number.isNaN(n) && n > 20000 && n < 90000) {
    // Google Sheets serial date: days since 1899-12-30 (UTC).
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  }
  return null;
}

function ymdKolkata(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return `${o.year}${o.month}${o.day}`;
}

(async () => {
  console.log(`\nViharasetu Sheets → MySQL import`);
  console.log(`  source : ${DIR}`);
  console.log(`  target : ${config.db.host}/${config.db.database}`);
  console.log(`  mode   : ${DRY ? 'DRY RUN (no writes)' : FRESH ? 'FRESH (truncate first)' : 'append into empty tables'}\n`);

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    ssl: config.db.ssl,
  });

  const summary = {};
  const warnings = [];

  // ---------- guard / fresh ----------
  for (const t of ['payments', 'bookings', 'enquiries', 'suppliers']) {
    const [[{ c }]] = await conn.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
    if (c > 0 && !FRESH && !DRY) {
      console.error(`✗ table "${t}" already has ${c} rows. Re-run with --fresh to truncate first, or clear it manually.`);
      await conn.end();
      process.exit(1);
    }
  }
  if (FRESH && !DRY) {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['payments', 'bookings', 'enquiries', 'suppliers', 'counters']) {
      await conn.query(`TRUNCATE TABLE \`${t}\``);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('  (truncated payments, bookings, enquiries, suppliers, counters)\n');
  }

  // ---------- enquiries ----------
  const enqRows = readCsv('enquiries.csv');
  const knownEnquiryIds = new Set();
  const enqCounter = {}; // yyyymmdd -> highest seq
  let eIns = 0;
  let eDup = 0;

  for (const r of enqRows) {
    const ts = toDateTime(r['Timestamp']) || new Date();
    let id = strOrNull(r['Enquiry ID']);
    if (id) {
      const m = /^VH-(\d{8})-(\d+)$/.exec(id);
      if (m) enqCounter[m[1]] = Math.max(enqCounter[m[1]] || 0, parseInt(m[2], 10));
    } else {
      const ymd = ymdKolkata(ts);
      enqCounter[ymd] = (enqCounter[ymd] || 0) + 1;
      id = `VH-${ymd}-${String(enqCounter[ymd]).padStart(2, '0')}`;
    }
    if (knownEnquiryIds.has(id)) { eDup++; continue; }
    knownEnquiryIds.add(id);

    if (!DRY) {
      await conn.query(
        `INSERT INTO enquiries (enquiry_id, received_at, name, email, phone, destination, travel, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           received_at = VALUES(received_at), name = VALUES(name), email = VALUES(email),
           phone = VALUES(phone), destination = VALUES(destination), travel = VALUES(travel),
           status = VALUES(status), notes = VALUES(notes)`,
        [
          id, ts, String(r['Name'] ?? ''), String(r['Email'] ?? ''), strOrNull(r['Phone']),
          strOrNull(r['Destination']), strOrNull(r['Travel']),
          enumOr(r['Status'], ['New', 'Contacted', 'Booked', 'Closed'], 'New'), strOrNull(r['Notes']),
        ],
      );
    }
    eIns++;
  }
  summary.enquiries = { rows: enqRows.length, imported: eIns, duplicateIdsSkipped: eDup };

  // ---------- suppliers ----------
  const supRows = readCsv('suppliers.csv');
  const supSeen = new Set();
  let sIns = 0;
  let sDup = 0;
  for (const r of supRows) {
    const dedupeKey = [r['Supplier Company Name'], r['Contact No'], r['Supplier ID']]
      .map((x) => String(x ?? '').trim().toLowerCase()).join('|');
    if (COLLAPSE_SUP && supSeen.has(dedupeKey)) { sDup++; continue; }
    supSeen.add(dedupeKey);

    if (!DRY) {
      await conn.query(
        `INSERT INTO suppliers (added_at, company_name, states, contact_person, supplier_code, contact_no)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          toDateTime(r['Timestamp']) || new Date(), String(r['Supplier Company Name'] ?? ''),
          strOrNull(r['States']), strOrNull(r['Supplier Name']),
          strOrNull(r['Supplier ID']), strOrNull(r['Contact No']),
        ],
      );
    }
    sIns++;
  }
  summary.suppliers = { rows: supRows.length, imported: sIns, duplicatesCollapsed: sDup };

  // ---------- bookings ----------
  const bookRows = readCsv('bookings.csv');
  let bIns = 0;
  for (const r of bookRows) {
    // The old Bookings sheet called this column "Package"; it's now "Destination".
    const destination = strOrNull(r['Destination'] ?? r['Package']);
    let eid = strOrNull(r['Enquiry ID']);
    if (eid && !knownEnquiryIds.has(eid)) {
      warnings.push(`booking "${r['Customer'] || '?'}" (${destination || ''}): enquiry ${eid} not found → link cleared`);
      eid = null;
    }
    if (!DRY) {
      await conn.query(
        `INSERT INTO bookings (enquiry_id, booked_at, customer, destination, travel_dates, pax, amount, payment_status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eid, toDateTime(r['Timestamp']) || new Date(), String(r['Customer'] ?? ''),
          destination, strOrNull(r['Travel Dates']), intOrNull(r['Pax']), num(r['Amount']),
          enumOr(r['Payment Status'], ['Pending', 'Partial', 'Paid'], 'Pending'), strOrNull(r['Notes']),
        ],
      );
    }
    bIns++;
  }
  summary.bookings = { rows: bookRows.length, imported: bIns };

  // ---------- payments (recompute Pending Amount per group, in time order) ----------
  const payRows = readCsv('payments.csv');
  payRows.sort((a, b) => {
    const da = toDateTime(a['Timestamp']);
    const db = toDateTime(b['Timestamp']);
    return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
  });
  const groupPaid = {}; // groupKey -> running sum of amount_paid
  let pIns = 0;
  let pmtMax = 0;
  for (const r of payRows) {
    let eid = strOrNull(r['Enquiry ID']);
    if (eid && !knownEnquiryIds.has(eid)) {
      warnings.push(`payment "${r['Customer'] || '?'}": enquiry ${eid} not found → link cleared`);
      eid = null;
    }
    const groupKey = eid ? `E:${eid.toLowerCase()}` : `C:${String(r['Customer'] ?? '').trim().toLowerCase()}`;
    const total = num(r['Total Amount']);
    const paid = num(r['Amount Paid']);
    const already = groupPaid[groupKey] || 0;
    const pending = round2(total - already - paid);
    groupPaid[groupKey] = already + paid;

    let pid = strOrNull(r['Payment ID']);
    const m = pid && /^PMT-(\d+)$/i.exec(pid);
    if (m) pmtMax = Math.max(pmtMax, parseInt(m[1], 10));
    if (!pid) { pmtMax += 1; pid = `PMT-${String(pmtMax).padStart(6, '0')}`; }

    if (!DRY) {
      await conn.query(
        `INSERT INTO payments
           (payment_id, enquiry_id, recorded_at, customer, total_amount, amount_paid, pending_amount, payment_mode, transaction_ref, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           enquiry_id = VALUES(enquiry_id), recorded_at = VALUES(recorded_at), customer = VALUES(customer),
           total_amount = VALUES(total_amount), amount_paid = VALUES(amount_paid), pending_amount = VALUES(pending_amount),
           payment_mode = VALUES(payment_mode), transaction_ref = VALUES(transaction_ref), notes = VALUES(notes)`,
        [
          pid, eid, toDateTime(r['Timestamp']) || new Date(), String(r['Customer'] ?? ''),
          total, paid, pending < 0 ? 0 : pending,
          enumOr(r['Payment Mode'], ['Cash', 'UPI', 'Card', 'Bank Transfer'], 'UPI'),
          strOrNull(r['Transaction Ref']), strOrNull(r['Notes']),
        ],
      );
    }
    pIns++;
  }
  summary.payments = { rows: payRows.length, imported: pIns };

  // ---------- counters ----------
  if (!DRY) {
    for (const [ymd, seq] of Object.entries(enqCounter)) {
      await conn.query(
        'INSERT INTO counters (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = GREATEST(value, VALUES(value))',
        [`ENQ:${ymd}`, seq],
      );
    }
    await conn.query(
      'INSERT INTO counters (name, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = GREATEST(value, VALUES(value))',
      ['PMT', pmtMax],
    );
  }

  await conn.end();

  console.log(DRY ? '=== DRY RUN COMPLETE (nothing written) ===\n' : '=== IMPORT COMPLETE ===\n');
  console.table(summary);
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    warnings.forEach((w) => console.log('  -', w));
  }
  console.log('\nNext: create admin logins →  node migrate/seed-admin.js <username> <password> --can-delete\n');
})().catch((err) => {
  console.error('\n✗ import failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
