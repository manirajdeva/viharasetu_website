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

// Portal accounts. role: 'admin' (full access) | 'employee' (view + add only).
const users = [
  { username: 'admin', password: 'admin123', role: 'admin', mobile: '9876543210', email: 'admin@viharasetu.co.in' },
];
const findUser = (name) => users.find((u) => u.username === String(name || ''));
const publicUser = (u) => ({
  username: u.username,
  role: u.role,
  canManageUsers: u.role === 'admin',
  canEdit: u.role === 'admin',
  canDelete: u.role === 'admin',
  mobile: u.mobile || '',
  email: u.email || '',
});

const HEADERS = {
  enquiries: ['Enquiry ID', 'Timestamp', 'Name', 'Email', 'Phone', 'Destination', 'Travel', 'Status', 'Notes'],
  suppliers: ['Timestamp', 'Supplier Company Name', 'States', 'Supplier Name', 'Supplier ID', 'Contact No'],
  bookings: ['Enquiry ID', 'Timestamp', 'Customer', 'Destination', 'Travel Dates', 'Pax', 'Amount', 'Payment Status', 'Notes'],
  payments: ['Enquiry ID', 'Timestamp', 'Customer', 'Destination', 'Amount Paid', 'Payment Mode', 'Transaction Ref', 'Notes', 'Total Amount', 'Pending Amount', 'Payment ID', 'Last Updated']
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
  const u = findUser(String(p.username || '').trim());
  if (!u || String(p.password || '') !== u.password) {
    throw new AppError('BAD_LOGIN', 'Invalid username or password.');
  }
  const token = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { exp: expiresAt, username: u.username });
  return { ok: true, token, expiresAt, user: publicUser(u) };
}
/** Returns the acting user, or throws SESSION_EXPIRED. */
function requireSession(token) {
  const s = sessions.get(token);
  if (!s || s.exp < Date.now()) { sessions.delete(token); throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please log in again.'); }
  const u = findUser(s.username);
  if (!u) { sessions.delete(token); throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please log in again.'); }
  return u;
}

/* ---------------- users (admin only) ---------------- */

const NAME_RE = /^[A-Za-z0-9._-]{3,80}$/;
const adminCount = () => users.filter((u) => u.role === 'admin').length;

function listUsers() {
  return { ok: true, users: users.map((u) => ({ username: u.username, role: u.role, mobile: u.mobile || '', email: u.email || '' })) };
}
function createUser(p) {
  const v = p.values || {};
  const name = String(v.username || '').trim();
  if (!NAME_RE.test(name)) return { ok: false, error: { code: 'VALIDATION', message: 'Username must be 3–80 chars: letters, digits, dot, dash or underscore.' } };
  if (String(v.password || '').length < 6) return { ok: false, error: { code: 'VALIDATION', message: 'Password must be at least 6 characters.' } };
  if (findUser(name)) return { ok: false, error: { code: 'DUPLICATE', message: 'That username already exists.' } };
  users.push({ username: name, password: String(v.password), role: v.role === 'admin' ? 'admin' : 'employee', mobile: v.mobile || '', email: v.email || '' });
  return { ok: true };
}
function updateUser(p) {
  const v = p.values || {};
  const target = findUser(p.username);
  if (!target) return { ok: false, error: { code: 'NOT_FOUND', message: 'User not found.' } };
  const newRole = v.role === undefined ? target.role : (v.role === 'admin' ? 'admin' : 'employee');
  if (v.password && String(v.password).length < 6) return { ok: false, error: { code: 'VALIDATION', message: 'Password must be at least 6 characters.' } };
  if (target.role === 'admin' && newRole !== 'admin' && adminCount() <= 1) return { ok: false, error: { code: 'LAST_ADMIN', message: 'At least one admin must remain.' } };
  target.role = newRole;
  if (v.password) target.password = String(v.password);
  if (v.mobile !== undefined) target.mobile = v.mobile;
  if (v.email !== undefined) target.email = v.email;
  return { ok: true };
}
function deleteUser(p, actor) {
  if (p.username === actor.username) return { ok: false, error: { code: 'SELF', message: 'You cannot delete your own account.' } };
  const target = findUser(p.username);
  if (!target) return { ok: true };
  if (target.role === 'admin' && adminCount() <= 1) return { ok: false, error: { code: 'LAST_ADMIN', message: 'At least one admin must remain.' } };
  users.splice(users.indexOf(target), 1);
  for (const [tok, s] of sessions) if (s.username === p.username) sessions.delete(tok);
  return { ok: true };
}

/* ---------------- CRUD ---------------- */

// Computed "Instalment" number per payment group (mirrors backend sheets.js).
function paymentsView() {
  const groups = {};
  db.payments.forEach((r) => { (groups[paymentGroupKey(r)] = groups[paymentGroupKey(r)] || []).push(r); });
  Object.values(groups).forEach((list) => {
    list.sort((a, b) => String(a['Timestamp']).localeCompare(String(b['Timestamp'])) || (a.rowIndex - b.rowIndex));
    list.forEach((r, i) => { r['Instalment'] = i + 1; });
  });
  return { headers: [...HEADERS.payments, 'Instalment'], rows: db.payments };
}

function listRows(key) {
  if (key === 'payments') return Object.assign({ ok: true }, paymentsView());
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
    if (h === 'Timestamp' || h === 'Last Updated') row[h] = nowIso();
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
    if (h === 'Last Updated') { existing[h] = nowIso(); return; }
    if (h === 'Enquiry ID' && key === 'enquiries') return;
    if (h === 'Payment ID' && key === 'payments') return;
    existing[h] = values[h] == null ? '' : values[h];
  });
  return { ok: true };
}

function deleteRow(p, actor) {
  if (!actor || actor.role !== 'admin') return { ok: false, error: { code: 'FORBIDDEN', message: 'Employee accounts cannot delete entries.' } };
  const key = String(p.sheet || 'enquiries').toLowerCase();
  const idx = db[key].findIndex((r) => r.rowIndex === Number(p.rowIndex));
  if (idx !== -1) db[key].splice(idx, 1);
  return { ok: true };
}

function updateProfile(p, actor) {
  const v = p.values || {};
  if (v.password) {
    if (String(v.currentPassword || '') !== actor.password) return { ok: false, error: { code: 'BAD_PASSWORD', message: 'Current password is incorrect.' } };
    actor.password = v.password;
  }
  if (v.mobile !== undefined) actor.mobile = v.mobile;
  if (v.email !== undefined) actor.email = v.email;
  return { ok: true, user: publicUser(actor) };
}

/* ---------------- dashboard + reports (mirror Code.gs) ---------------- */

/**
 * Roll up the Payments portal per enquiry (falling back to customer name when a
 * payment has no Enquiry ID). "Total Amount" is the contracted trip cost —
 * carried forward across a plan's payments, so take the max seen — and
 * "Amount Paid" is summed. Outstanding is derived per plan and clamped at 0.
 */
function paymentsSummary(pay) {
  const groups = {};
  pay.forEach((r) => {
    const eid = String(r['Enquiry ID'] || '').trim();
    const key = eid ? `E:${eid.toLowerCase()}` : `C:${String(r['Customer'] || '').trim().toLowerCase()}`;
    const g = groups[key] || (groups[key] = {
      total: 0, paid: 0, enquiryId: eid, customer: r['Customer'] || '', destination: '', last: '',
    });
    g.total = Math.max(g.total, parseFloat(r['Total Amount']) || 0);
    g.paid += parseFloat(r['Amount Paid']) || 0;
    if (r['Destination']) g.destination = r['Destination'];
    const ts = dateStr(r['Timestamp']);
    if (ts > g.last) g.last = ts;
  });
  const plans = Object.values(groups);
  const contractedValue = plans.reduce((s, g) => s + g.total, 0);
  const collected = plans.reduce((s, g) => s + g.paid, 0);
  const outstanding = plans.reduce((s, g) => s + Math.max(0, g.total - g.paid), 0);

  let fullyPaid = 0, partPaid = 0, notStarted = 0;
  plans.forEach((g) => {
    if (g.paid <= 0) notStarted++;
    else if (g.total - g.paid <= 0.01) fullyPaid++;
    else partPaid++;
  });

  const byMode = {};
  pay.forEach((r) => {
    const m = String(r['Payment Mode'] || '').trim() || 'Other';
    byMode[m] = round2((byMode[m] || 0) + (parseFloat(r['Amount Paid']) || 0));
  });

  return {
    plans: plans.length,
    transactions: pay.length,
    contractedValue: round2(contractedValue),
    collected: round2(collected),
    outstanding: round2(outstanding),
    collectionRate: contractedValue > 0 ? round2((collected / contractedValue) * 100) : 0,
    avgPlanValue: plans.length ? round2(contractedValue / plans.length) : 0,
    fullyPaid,
    partPaid,
    notStarted,
    statusBreakdown: { 'Fully paid': fullyPaid, 'Part paid': partPaid, 'Not started': notStarted },
    monthlyCollected: monthlySeries(pay, 'Timestamp', 'Amount Paid'),
    byMode,
    due: plans
      .map((g) => ({
        enquiryId: g.enquiryId,
        customer: g.customer,
        destination: g.destination,
        total: round2(g.total),
        paid: round2(g.paid),
        pending: round2(Math.max(0, g.total - g.paid)),
        last: g.last,
      }))
      .filter((p) => p.pending > 0.01)
      .sort((a, b) => b.pending - a.pending)
      .slice(0, 8),
  };
}

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
  book.forEach((r) => recent.push({ icon: '🧳', text: `Booking — ${r['Customer'] || '—'} · ${r['Destination'] || ''}`, at: r['Timestamp'] }));
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
      payments: paymentsSummary(pay),
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
      'Destination': b.pkg, 'Travel Dates': enq['Travel'], 'Pax': b.pax, 'Amount': b.amt,
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
      'Enquiry ID': enq['Enquiry ID'], 'Timestamp': daysAgoIso(30 - i * 4), 'Customer': enq['Name'], 'Destination': enq['Destination'],
      'Amount Paid': x.paid, 'Payment Mode': x.mode, 'Transaction Ref': 'TXN' + (1001 + i), 'Notes': '',
      'Total Amount': x.total, 'Pending Amount': round2(x.total - already - x.paid), 'Payment ID': nextPaymentId(),
      'Last Updated': daysAgoIso(30 - i * 4)
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

    const actor = requireSession(p.token);
    const adminsOnly = () => ({ ok: false, error: { code: 'FORBIDDEN', message: 'Only admins can manage users.' } });
    switch (p.action) {
      case 'bootstrap': return send(res, {
        ok: true,
        data: {
          sheets: {
            enquiries: { headers: HEADERS.enquiries, rows: db.enquiries },
            suppliers: { headers: HEADERS.suppliers, rows: db.suppliers },
            bookings: { headers: HEADERS.bookings, rows: db.bookings },
            payments: paymentsView()
          },
          stats: dashboardStats().data
        }
      });
      case 'dashboardStats': return send(res, dashboardStats());
      case 'reports': return send(res, reports(p.data || {}));
      case 'updateProfile': return send(res, updateProfile(p, actor));
      case 'listUsers': return send(res, actor.role === 'admin' ? listUsers() : adminsOnly());
      case 'createUser': return send(res, actor.role === 'admin' ? createUser(p) : adminsOnly());
      case 'updateUser': return send(res, actor.role === 'admin' ? updateUser(p) : adminsOnly());
      case 'deleteUser': return send(res, actor.role === 'admin' ? deleteUser(p, actor) : adminsOnly());
      case 'create': return send(res, createRow(p));
      case 'update': return send(res, actor.role === 'admin' ? updateRow(p) : { ok: false, error: { code: 'FORBIDDEN', message: 'Employee accounts cannot edit entries.' } });
      case 'delete': return send(res, deleteRow(p, actor));
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
  console.log(`Login:  username "${users[0].username}"   password "${users[0].password}"`);
  console.log(`Seeded: ${db.enquiries.length} enquiries, ${db.suppliers.length} suppliers, ${db.bookings.length} bookings, ${db.payments.length} payments. Restart to reset.`);
});
