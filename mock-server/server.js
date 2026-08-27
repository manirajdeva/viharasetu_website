/**
 * mock-server/server.js
 * Zero-dependency local stand-in for the Viharasetu Google Apps Script
 * backend (google-apps-script/Code.gs). Same request/response envelope, same
 * action names, same sheet headers, same payments math (Pending Amount +
 * overpayment guard) and the same auto IDs (VH-… enquiry, PMT-000001 payment)
 * — but backed by an in-memory store, so the admin portal loads instantly on
 * localhost with no round trip to Google.
 *
 *   node mock-server/server.js        # API on http://localhost:3001/exec
 *
 * admin/js/api.js points here automatically whenever an admin page is served
 * from localhost / 127.0.0.1. Data lives only in this process — restart to
 * reset to the seeded sample set. Login: admin / admin123
 *
 * Local development only. NOT part of the deployment.
 */

const http = require('http');
const crypto = require('crypto');

const PORT = 3001;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

const ADMIN = { username: 'admin', password: 'admin123', canDelete: true, mobile: '9876543210', email: 'admin@viharasetu.co.in' };

const HEADERS = {
  enquiries: ['Enquiry ID', 'Timestamp', 'Name', 'Email', 'Phone', 'Destination', 'Travel', 'Status', 'Notes'],
  suppliers: ['Timestamp', 'Supplier Company Name', 'States', 'Supplier Name', 'Supplier ID', 'Contact No'],
  bookings: ['Enquiry ID', 'Timestamp', 'Customer', 'Package', 'Travel Dates', 'Pax', 'Amount', 'Payment Status', 'Notes'],
  payments: ['Enquiry ID', 'Timestamp', 'Customer', 'Amount Paid', 'Payment Mode', 'Transaction Ref', 'Notes', 'Total Amount', 'Pending Amount', 'Payment ID']
};

/* ---------------- in-memory store ---------------- */

const db = { enquiries: [], suppliers: [], bookings: [], payments: [] };
const rowSeq = { enquiries: 1, suppliers: 1, bookings: 1, payments: 1 }; // next rowIndex is ++seq (starts at 2)
const counters = { enq: {}, pmt: 0 };
const sessions = new Map();

/* ---------------- helpers (mirror Code.gs) ---------------- */

const nowIso = () => new Date().toISOString();
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function dateStr(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
function last6Months() {
  const out = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
function monthlySeries(rows, dateField, sumField) {
  const months = last6Months();
  const buckets = {};
  months.forEach((m) => (buckets[m] = 0));
  rows.forEach((r) => {
    const k = dateStr(r[dateField]).slice(0, 7);
    if (!(k in buckets)) return;
    buckets[k] += sumField ? (parseFloat(r[sumField]) || 0) : 1;
  });
  return months.map((m) => ({ month: m, value: round2(buckets[m]) }));
}

function nextEnquiryId() {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  counters.enq[ymd] = (counters.enq[ymd] || 0) + 1;
  return `VH-${ymd}-${String(counters.enq[ymd]).padStart(2, '0')}`;
}
function nextPaymentId() {
  return 'PMT-' + String(++counters.pmt).padStart(6, '0');
}
function paymentGroupKey(row) {
  const eid = String(row['Enquiry ID'] || '').trim();
  return eid ? 'E:' + eid.toLowerCase() : 'C:' + String(row['Customer'] || '').trim().toLowerCase();
}

class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/* ---------------- auth ---------------- */

function login(p) {
  if (String(p.username || '').trim() !== ADMIN.username || String(p.password || '') !== ADMIN.password) {
    throw new AppError('BAD_LOGIN', 'Invalid username or password.');
  }
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, expiresAt);
  return { ok: true, token, expiresAt, user: { username: ADMIN.username, canDelete: ADMIN.canDelete, mobile: ADMIN.mobile, email: ADMIN.email } };
}
function requireSession(token) {
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) { sessions.delete(token); throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please log in again.'); }
}

/* ---------------- CRUD ---------------- */

function listRows(key) {
  return { ok: true, headers: HEADERS[key], rows: db[key] };
}

function preparePaymentValues(values, editingRowIndex) {
  const total = Number(values['Total Amount']);
  const paid = Number(values['Amount Paid']);
  if (isNaN(total) || total < 0) throw new AppError('ERROR', 'Total Amount must be a number of 0 or more.');
  if (isNaN(paid) || paid <= 0) throw new AppError('ERROR', 'Amount Paid must be greater than zero.');
  const key = paymentGroupKey(values);
  let already = 0;
  db.payments.forEach((r) => {
    if (editingRowIndex && r.rowIndex === Number(editingRowIndex)) return;
    if (paymentGroupKey(r) === key) already += Number(r['Amount Paid']) || 0;
  });
  already = round2(already);
  const pending = round2(total - (already + paid));
  if (pending < 0) {
    const maxNow = round2(total - already);
    throw new AppError('ERROR', `This exceeds the balance for this enquiry. Already recorded: ₹${already}. Maximum you can add now: ₹${maxNow < 0 ? 0 : maxNow}.`);
  }
  values['Total Amount'] = total;
  values['Amount Paid'] = paid;
  values['Pending Amount'] = pending;
}

function createRow(p) {
  const key = String(p.sheet || 'enquiries').toLowerCase();
  if (!HEADERS[key]) throw new AppError('BAD_SHEET', 'Unknown sheet.');
  const values = p.values || {};
  if (key === 'payments') preparePaymentValues(values, null);

  const row = { rowIndex: ++rowSeq[key] };
  HEADERS[key].forEach((h) => {
    if (h === 'Timestamp') row[h] = nowIso();
    else if (h === 'Enquiry ID' && key === 'enquiries') row[h] = nextEnquiryId();
    else if (h === 'Payment ID' && key === 'payments') row[h] = nextPaymentId();
    else row[h] = values[h] == null ? '' : values[h];
  });
  db[key].push(row);
  return { ok: true };
}

function updateRow(p) {
  const key = String(p.sheet || 'enquiries').toLowerCase();
  if (!HEADERS[key]) throw new AppError('BAD_SHEET', 'Unknown sheet.');
  if (!p.rowIndex) throw new AppError('BAD_REQUEST', 'Missing rowIndex');
  const existing = db[key].find((r) => r.rowIndex === Number(p.rowIndex));
  if (!existing) throw new AppError('NOT_FOUND', 'Row not found.');
  const values = p.values || {};
  if (key === 'payments') preparePaymentValues(values, p.rowIndex);

  HEADERS[key].forEach((h) => {
    if (h === 'Timestamp') return;
    if (h === 'Enquiry ID' && key === 'enquiries') return;
    if (h === 'Payment ID' && key === 'payments') return;
    existing[h] = values[h] == null ? '' : values[h];
  });
  return { ok: true };
}

function deleteRow(p) {
  if (!ADMIN.canDelete) return { ok: false, error: { code: 'FORBIDDEN', message: 'This account cannot delete entries.' } };
  const key = String(p.sheet || 'enquiries').toLowerCase();
  const idx = db[key].findIndex((r) => r.rowIndex === Number(p.rowIndex));
  if (idx !== -1) db[key].splice(idx, 1);
  return { ok: true };
}

function updateProfile(p) {
  const u = p.values || {};
  if (u.password) {
    if (String(u.currentPassword || '') !== ADMIN.password) return { ok: false, error: { code: 'BAD_PASSWORD', message: 'Current password is incorrect.' } };
    ADMIN.password = u.password;
  }
  if (u.mobile !== undefined) ADMIN.mobile = u.mobile;
  if (u.email !== undefined) ADMIN.email = u.email;
  return { ok: true, user: { username: ADMIN.username, canDelete: ADMIN.canDelete, mobile: ADMIN.mobile, email: ADMIN.email } };
}

/* ---------------- dashboard + reports (mirror Code.gs) ---------------- */

function dashboardStats() {
  const enq = db.enquiries, sup = db.suppliers, book = db.bookings, pay = db.payments;
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const bookingsValue = book.reduce((s, r) => s + (parseFloat(r['Amount']) || 0), 0);
  const paymentsReceived = pay.reduce((s, r) => s + (parseFloat(r['Amount Paid']) || 0), 0);

  const statusBreakdown = { New: 0, Contacted: 0, Booked: 0, Closed: 0 };
  enq.forEach((r) => { if (r['Status'] in statusBreakdown) statusBreakdown[r['Status']]++; });

  const recent = [];
  enq.forEach((r) => recent.push({ icon: '✉', text: `Enquiry — ${r['Name'] || '—'} (${r['Enquiry ID'] || ''})`, at: r['Timestamp'] }));
  book.forEach((r) => recent.push({ icon: '🧳', text: `Booking — ${r['Customer'] || '—'} · ${r['Package'] || ''}`, at: r['Timestamp'] }));
  pay.forEach((r) => recent.push({ icon: '💳', text: `Payment — ₹${r['Amount Paid'] || 0} from ${r['Customer'] || '—'}`, at: r['Timestamp'] }));
  recent.sort((a, b) => String(b.at).localeCompare(String(a.at)));

  return {
    ok: true,
    data: {
      totalEnquiries: enq.length,
      newEnquiries: enq.filter((r) => r['Status'] === 'New').length,
      enquiriesThisMonth: enq.filter((r) => dateStr(r['Timestamp']).slice(0, 7) === thisMonth).length,
      todaysEnquiries: enq.filter((r) => dateStr(r['Timestamp']) === today).length,
      suppliers: sup.length,
      totalBookings: book.length,
      bookingsValue: round2(bookingsValue),
      paymentsReceived: round2(paymentsReceived),
      outstanding: Math.max(0, round2(bookingsValue - paymentsReceived)),
      monthlyEnquiries: monthlySeries(enq, 'Timestamp', null),
      monthlyPayments: monthlySeries(pay, 'Timestamp', 'Amount Paid'),
      statusBreakdown,
      recent: recent.slice(0, 12)
    }
  };
}

function reports(filters) {
  filters = filters || {};
  const byEnq = {}, payByEnq = {};
  db.bookings.forEach((r) => { const k = String(r['Enquiry ID'] || '').trim(); if (k) (byEnq[k] = byEnq[k] || []).push(r); });
  db.payments.forEach((r) => { const k = String(r['Enquiry ID'] || '').trim(); if (k) (payByEnq[k] = payByEnq[k] || []).push(r); });

  let rows = db.enquiries.map((e) => {
    const id = String(e['Enquiry ID'] || '').trim();
    const bk = byEnq[id] || [], pmt = payByEnq[id] || [];
    const bookingAmount = bk.reduce((s, r) => s + (parseFloat(r['Amount']) || 0), 0);
    const paid = pmt.reduce((s, r) => s + (parseFloat(r['Amount Paid']) || 0), 0);
    const outstanding = Math.max(0, bookingAmount - paid);
    let ps = 'No Booking';
    if (bk.length) ps = paid <= 0 ? 'Pending' : outstanding <= 0 ? 'Paid' : 'Partial';
    else if (paid > 0) ps = 'Partial';
    return {
      'Enquiry ID': e['Enquiry ID'], 'Name': e['Name'], 'Enquiry Date': e['Timestamp'],
      'Destination': e['Destination'], 'Phone': e['Phone'], 'Status': e['Status'],
      'Booking Amount': round2(bookingAmount), 'Paid': round2(paid),
      'Outstanding': round2(outstanding), 'Payment Status': ps
    };
  });

  if (filters.dateFrom) rows = rows.filter((r) => dateStr(r['Enquiry Date']) >= filters.dateFrom);
  if (filters.dateTo) rows = rows.filter((r) => dateStr(r['Enquiry Date']) <= filters.dateTo);
  if (filters.destination) { const q = filters.destination.toLowerCase(); rows = rows.filter((r) => String(r['Destination'] || '').toLowerCase().includes(q)); }
  if (filters.status) rows = rows.filter((r) => r['Status'] === filters.status);
  if (filters.paymentStatus) rows = rows.filter((r) => r['Payment Status'] === filters.paymentStatus);
  rows.sort((a, b) => String(b['Enquiry Date']).localeCompare(String(a['Enquiry Date'])));
  return { ok: true, data: { rows, total: rows.length } };
}

/* ---------------- seed ---------------- */

function push(key, obj) {
  db[key].push(Object.assign({ rowIndex: ++rowSeq[key] }, obj));
}
function daysAgoIso(d) { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString(); }

function seed() {
  const dest = ['Kerala', 'Ladakh', 'Rajasthan', 'Goa', 'Varanasi', 'Rishikesh', 'Coorg', 'Andaman', 'Spiti Valley', 'Hampi'];
  const names = ['Asha Rao', 'Vikram Shetty', 'Meera Nair', 'Rahul Dubey', 'Sneha Kulkarni', 'Imran Khan', 'Priya Menon', 'Arjun Das', 'Kavya Reddy', 'Nikhil Jain'];
  const statuses = ['New', 'New', 'Contacted', 'Booked', 'Closed', 'New', 'Contacted', 'Booked', 'New', 'Contacted'];

  names.forEach((name, i) => {
    const ts = daysAgoIso((i * 9) % 160);
    const ymd = ts.slice(0, 10).replace(/-/g, '');
    counters.enq[ymd] = (counters.enq[ymd] || 0) + 1;
    push('enquiries', {
      'Enquiry ID': `VH-${ymd}-${String(counters.enq[ymd]).padStart(2, '0')}`,
      'Timestamp': ts, 'Name': name, 'Email': name.toLowerCase().replace(/\s+/g, '.') + '@example.com',
      'Phone': '9' + String(800000000 + i * 7654321).slice(0, 9),
      'Destination': dest[i], 'Travel': ts.slice(0, 10), 'Status': statuses[i],
      'Notes': i % 3 === 0 ? 'Called; will confirm dates.' : ''
    });
  });

  ['Backwater DMC', 'Himalaya Rides', 'Desert Camps Co', 'Coastal Getaways', 'Kashi Yatra Services'].forEach((co, i) => {
    push('suppliers', {
      'Timestamp': daysAgoIso(120 - i * 10), 'Supplier Company Name': co,
      'States': ['Kerala', 'Ladakh, Himachal', 'Rajasthan', 'Goa', 'Uttar Pradesh'][i],
      'Supplier Name': ['Rajeev', 'Tenzin', 'Bhanwar', 'Maria', 'Suresh'][i],
      'Supplier ID': `SUP-${['KL', 'LA', 'RJ', 'GA', 'UP'][i]}-0${i + 1}`,
      'Contact No': '9' + String(700000000 + i * 1234567).slice(0, 9)
    });
  });

  const bk = [
    { eIdx: 3, pkg: 'Rajasthan Heritage', amt: 185000, pax: 4, ps: 'Partial' },
    { eIdx: 7, pkg: 'Goa Beach Break', amt: 96000, pax: 2, ps: 'Paid' },
    { eIdx: 0, pkg: 'Kerala Signature', amt: 132000, pax: 2, ps: 'Partial' },
    { eIdx: 1, pkg: 'Leh–Ladakh Explorer', amt: 240000, pax: 3, ps: 'Pending' }
  ];
  bk.forEach((b, i) => {
    const enq = db.enquiries[b.eIdx];
    push('bookings', {
      'Enquiry ID': enq['Enquiry ID'], 'Timestamp': daysAgoIso(40 - i * 6), 'Customer': enq['Name'],
      'Package': b.pkg, 'Travel Dates': enq['Travel'], 'Pax': b.pax, 'Amount': b.amt,
      'Payment Status': b.ps, 'Notes': ''
    });
  });

  // payments — note two rows against the same enquiry to exercise carry-over
  const pm = [
    { eIdx: 3, total: 185000, paid: 60000, mode: 'Bank Transfer' },
    { eIdx: 3, total: 185000, paid: 40000, mode: 'UPI' },
    { eIdx: 7, total: 96000, paid: 96000, mode: 'Card' },
    { eIdx: 0, total: 132000, paid: 50000, mode: 'UPI' },
    { eIdx: 0, total: 132000, paid: 20000, mode: 'Cash' }
  ];
  pm.forEach((x, i) => {
    const enq = db.enquiries[x.eIdx];
    const key = 'E:' + enq['Enquiry ID'].toLowerCase();
    const already = db.payments.filter((r) => paymentGroupKey(r) === key).reduce((s, r) => s + Number(r['Amount Paid']), 0);
    push('payments', {
      'Enquiry ID': enq['Enquiry ID'], 'Timestamp': daysAgoIso(30 - i * 4), 'Customer': enq['Name'],
      'Amount Paid': x.paid, 'Payment Mode': x.mode, 'Transaction Ref': 'TXN' + (1001 + i), 'Notes': '',
      'Total Amount': x.total, 'Pending Amount': round2(x.total - already - x.paid), 'Payment ID': nextPaymentId()
    });
  });
}
seed();

/* ---------------- HTTP ---------------- */

function send(res, obj) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(obj));
}

function handlePost(body, res) {
  let p = {};
  try { p = body ? JSON.parse(body) : {}; } catch { return send(res, { ok: false, error: { code: 'BAD_REQUEST', message: 'Malformed body.' } }); }

  try {
    if (!p.sheet && !p.action) { // legacy public contact form
      const id = nextEnquiryId();
      push('enquiries', {
        'Enquiry ID': id, 'Timestamp': nowIso(), 'Name': p.name || '', 'Email': p.email || '',
        'Phone': p.phone || '', 'Destination': p.destination || '', 'Travel': p.travel || '',
        'Status': 'New', 'Notes': p.notes || p.message || ''
      });
      return send(res, { ok: true, enquiryId: id });
    }
    if (p.action === 'login') return send(res, login(p));
    if (p.action === 'logout') { sessions.delete(p.token); return send(res, { ok: true }); }

    requireSession(p.token);
    switch (p.action) {
      case 'bootstrap': return send(res, {
        ok: true,
        data: {
          sheets: {
            enquiries: { headers: HEADERS.enquiries, rows: db.enquiries },
            suppliers: { headers: HEADERS.suppliers, rows: db.suppliers },
            bookings: { headers: HEADERS.bookings, rows: db.bookings },
            payments: { headers: HEADERS.payments, rows: db.payments }
          },
          stats: dashboardStats().data
        }
      });
      case 'dashboardStats': return send(res, dashboardStats());
      case 'reports': return send(res, reports(p.data || {}));
      case 'updateProfile': return send(res, updateProfile(p));
      case 'create': return send(res, createRow(p));
      case 'update': return send(res, updateRow(p));
      case 'delete': return send(res, deleteRow(p));
      default: return send(res, { ok: false, error: { code: 'UNKNOWN_ACTION', message: 'Unknown action: ' + p.action } });
    }
  } catch (err) {
    return send(res, { ok: false, error: { code: err.code || 'ERROR', message: err.message || 'Something went wrong.' } });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, {});

  if (req.method === 'GET') {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const sheet = u.searchParams.get('sheet');
    if (!sheet) return send(res, { ok: true, message: 'Viharasetu mock admin API is running.' });
    try {
      requireSession(u.searchParams.get('token'));
      if (!HEADERS[sheet.toLowerCase()]) return send(res, { ok: false, error: { code: 'BAD_SHEET', message: 'Unknown sheet.' } });
      return send(res, listRows(sheet.toLowerCase()));
    } catch (err) {
      return send(res, { ok: false, error: { code: err.code || 'ERROR', message: err.message } });
    }
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => handlePost(body, res));
});

server.listen(PORT, () => {
  console.log(`Viharasetu mock admin API  →  http://localhost:${PORT}/exec`);
  console.log(`Login:  username "${ADMIN.username}"   password "${ADMIN.password}"`);
  console.log(`Seeded: ${db.enquiries.length} enquiries, ${db.suppliers.length} suppliers, ${db.bookings.length} bookings, ${db.payments.length} payments. Restart to reset.`);
});
