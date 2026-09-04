/**
 * Viharasetu admin backend — handles the public enquiry form AND the
 * admin portal (Enquiries / Suppliers / Bookings / Payments / Reports).
 *
 * Setup:
 * 1. Open the Google Sheet you want everything stored in.
 * 2. Extensions -> Apps Script.
 * 3. Delete whatever is in Code.gs and paste this file's contents in its place.
 * 4. Deploy -> Manage deployments -> edit (pencil icon) your existing web app deployment
 *    -> Version: "New version" -> Deploy. Keeping it as the SAME deployment preserves
 *    the /exec URL already used by index.html and admin/.
 * 5. First run will ask you to authorize the script - approve it (it only touches this sheet).
 * 6. Admin login lives in the sheet, not in any HTML/JS. Open the sheet, find (or trigger
 *    the creation of, by loading the portal once) the "Admins" tab, and add one row per
 *    admin: Username, Password, CanDelete (TRUE/FALSE), Mobile, Email. Until at least one
 *    row exists, nobody can log in.
 * 7. Enquiry ID: every new Enquiry gets an auto-generated ID like "VH-20260828-01"
 *    (date + a same-day sequence number). Bookings and Payments carry their own
 *    "Enquiry ID" column, filled in from the portal, so all sheets cross-reference by it.
 *
 * Auth model: login() mints an opaque token stored in Script Properties for 6 hours.
 * Every admin request (GET list reads included) must carry that token. There is no
 * password anywhere in the frontend after login. Expired/unknown tokens come back as
 * { ok:false, error:{ code:'SESSION_EXPIRED' } }, which bounces the user to the login page.
 *
 * These tabs are auto-created on first use if missing: Enquiries, Suppliers, Bookings,
 * Payments, Admins — with the header row shown below.
 */

const SHEETS = {
  enquiries: {
    name: 'Enquiries',
    headers: ['Enquiry ID', 'Timestamp', 'Name', 'Email', 'Phone', 'Destination', 'Travel', 'Status', 'Notes']
  },
  suppliers: {
    name: 'Suppliers',
    headers: ['Timestamp', 'Supplier Company Name', 'States', 'Supplier Name', 'Supplier ID', 'Contact No']
  },
  bookings: {
    name: 'Bookings',
    headers: ['Enquiry ID', 'Timestamp', 'Customer', 'Package', 'Travel Dates', 'Pax', 'Amount', 'Payment Status', 'Notes']
  },
  payments: {
    name: 'Payments',
    // 'Total Amount', 'Pending Amount' and 'Payment ID' were added later, so they
    // sit at the end to stay position-aligned with sheets created before them
    // (see getSheetInfo_). 'Payment ID' is auto-generated (PMT-000001).
    headers: ['Enquiry ID', 'Timestamp', 'Customer', 'Amount Paid', 'Payment Mode', 'Transaction Ref', 'Notes', 'Total Amount', 'Pending Amount', 'Payment ID']
  },
  admins: {
    name: 'Admins',
    headers: ['Username', 'Password', 'CanDelete', 'Mobile', 'Email']
  }
};

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const SESSION_PREFIX = 'SESS_';

/* ------------------------------------------------------------------ *
 *  Sheet helpers
 * ------------------------------------------------------------------ */

function getSheetInfo_(key) {
  const cfg = SHEETS[key];
  if (!cfg) throw new Error('Unknown sheet key: ' + key);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(cfg.name);
  if (!sheet) sheet = ss.insertSheet(cfg.name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(cfg.headers);
  } else {
    // Auto-migrate: if a header was added to cfg.headers since this sheet was
    // created, append it to the end of the existing header row so existing
    // data stays put. (Columns are matched by name on read; new ones must be
    // appended at the end of cfg.headers to stay position-aligned.)
    const width = Math.max(sheet.getLastColumn(), 1);
    const current = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
    const missing = cfg.headers.filter(function (h) { return current.indexOf(h) === -1; });
    if (missing.length) {
      sheet.getRange(1, width + 1, 1, missing.length).setValues([missing]);
    }
  }
  return { sheet: sheet, headers: cfg.headers };
}

/** Reads a whole sheet into [{ rowIndex, <col>: value, ... }], dates as ISO strings. */
function readRows_(key) {
  const info = getSheetInfo_(key);
  const data = info.sheet.getDataRange().getValues();
  const headers = info.headers;
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r.some(function (v) { return v !== '' && v !== null; })) continue;
    const obj = { rowIndex: i + 1 };
    headers.forEach(function (h, idx) {
      let v = r[idx];
      if (v instanceof Date) v = v.toISOString();
      obj[h] = (v === null || v === undefined) ? '' : v;
    });
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sessionExpired_() {
  return jsonOutput_({ ok: false, error: { code: 'SESSION_EXPIRED', message: 'Your session has expired. Please log in again.' } });
}

function isTrue_(v) {
  const s = String(v).trim().toUpperCase();
  return v === true || s === 'TRUE' || s === 'YES';
}

/* ------------------------------------------------------------------ *
 *  Admin accounts + token sessions
 * ------------------------------------------------------------------ */

function findAdmin_(username) {
  const info = getSheetInfo_('admins');
  const data = info.sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(username)) {
      return {
        rowIndex: i + 1,
        username: data[i][0],
        password: data[i][1],
        canDelete: isTrue_(data[i][2]),
        mobile: data[i][3] || '',
        email: data[i][4] || ''
      };
    }
  }
  return null;
}

function verifyAdmin_(username, password) {
  const admin = findAdmin_(username);
  if (!admin || !password || String(admin.password) !== String(password)) return null;
  return admin;
}

/** Public view of an admin row — never includes the password. */
function publicAdmin_(admin) {
  return { username: admin.username, canDelete: admin.canDelete, mobile: admin.mobile, email: admin.email };
}

function createSession_(username) {
  const props = PropertiesService.getScriptProperties();
  purgeExpiredSessions_(props);
  const token = Utilities.getUuid().replace(/-/g, '');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  props.setProperty(SESSION_PREFIX + token, JSON.stringify({ u: username, exp: expiresAt }));
  return { token: token, expiresAt: expiresAt };
}

function sessionUsername_(token) {
  if (!token) return null;
  const raw = PropertiesService.getScriptProperties().getProperty(SESSION_PREFIX + token);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (!s.exp || s.exp < Date.now()) {
      PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token);
      return null;
    }
    return s.u;
  } catch (e) {
    return null;
  }
}

function deleteSession_(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token);
}

function purgeExpiredSessions_(props) {
  const all = props.getProperties();
  const now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(SESSION_PREFIX) !== 0) return;
    try {
      const s = JSON.parse(all[k]);
      if (!s.exp || s.exp < now) props.deleteProperty(k);
    } catch (e) {
      props.deleteProperty(k);
    }
  });
}

/**
 * Resolves the caller to an admin row, or throws SESSION_EXPIRED.
 * Accepts a session token (normal path) or a username/password pair (fallback).
 */
function requireAdmin_(body) {
  const username = sessionUsername_(body.token);
  if (username) {
    const admin = findAdmin_(username);
    if (admin) return admin;
  }
  if (body.username && body.password) {
    const admin = verifyAdmin_(body.username, body.password);
    if (admin) return admin;
  }
  const err = new Error('SESSION_EXPIRED');
  err.sessionExpired = true;
  throw err;
}

/* ------------------------------------------------------------------ *
 *  ID minting
 * ------------------------------------------------------------------ */

function nextEnquiryId_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const tz = Session.getScriptTimeZone() || 'Asia/Kolkata';
    const today = Utilities.formatDate(new Date(), tz, 'yyyyMMdd');
    const props = PropertiesService.getScriptProperties();
    const stored = props.getProperty('ENQ_COUNTER') || '';
    const parts = stored.split(':');
    const seq = (parts[0] === today) ? (parseInt(parts[1], 10) + 1) : 1;
    props.setProperty('ENQ_COUNTER', today + ':' + seq);
    return 'VH-' + today + '-' + String(seq).padStart(2, '0');
  } finally {
    lock.releaseLock();
  }
}

/** Plain running receipt number, e.g. PMT-000001. */
function nextPaymentId_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const seq = (parseInt(props.getProperty('PMT_COUNTER'), 10) || 0) + 1;
    props.setProperty('PMT_COUNTER', String(seq));
    return 'PMT-' + String(seq).padStart(6, '0');
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 *  GET — list reads (token required)
 * ------------------------------------------------------------------ */

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (!params.sheet) {
    return jsonOutput_({ ok: true, message: 'Viharasetu admin API is running.' });
  }
  if (!sessionUsername_(params.token)) return sessionExpired_();

  const key = String(params.sheet).toLowerCase();
  if (!SHEETS[key]) return jsonOutput_({ ok: false, error: { code: 'BAD_SHEET', message: 'Unknown sheet.' } });

  const data = readRows_(key);
  return jsonOutput_({ ok: true, headers: data.headers, rows: data.rows });
}

/* ------------------------------------------------------------------ *
 *  POST — public contact form + all admin actions
 * ------------------------------------------------------------------ */

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (parseErr) {
    return jsonOutput_({ ok: false, error: { code: 'BAD_REQUEST', message: 'Malformed request body.' } });
  }

  // Legacy path: the public contact form in index.html posts {name,email,phone,
  // destination,travel} with no sheet/action. Appends to Enquiries as "New".
  // Built from the header row so it stays aligned if columns are added later.
  if (!body.sheet && !body.action) {
    const info = getSheetInfo_('enquiries');
    const enquiryId = nextEnquiryId_();
    const fields = {
      'Enquiry ID': enquiryId,
      'Timestamp': new Date(),
      'Name': body.name || '',
      'Email': body.email || '',
      'Phone': body.phone || '',
      'Destination': body.destination || '',
      'Travel': body.travel || '',
      'Status': 'New',
      'Notes': body.notes || body.message || ''
    };
    info.sheet.appendRow(info.headers.map(function (h) { return fields.hasOwnProperty(h) ? fields[h] : ''; }));
    return jsonOutput_({ ok: true, enquiryId: enquiryId });
  }

  // Public: username/password -> token.
  if (body.action === 'login') {
    const admin = verifyAdmin_(body.username, body.password);
    if (!admin) return jsonOutput_({ ok: false, error: { code: 'BAD_LOGIN', message: 'Invalid username or password.' } });
    const sess = createSession_(admin.username);
    return jsonOutput_({ ok: true, token: sess.token, expiresAt: sess.expiresAt, user: publicAdmin_(admin) });
  }

  if (body.action === 'logout') {
    deleteSession_(body.token);
    return jsonOutput_({ ok: true });
  }

  // Everything below needs a valid session.
  let admin;
  try {
    admin = requireAdmin_(body);
  } catch (authErr) {
    return sessionExpired_();
  }

  try {
    switch (body.action) {
      case 'bootstrap':      return jsonOutput_({ ok: true, data: bootstrap_() });
      case 'dashboardStats': return jsonOutput_({ ok: true, data: dashboardStats_() });
      case 'reports':        return jsonOutput_({ ok: true, data: reports_(body.data || {}) });
      case 'updateProfile':  return jsonOutput_(updateProfile_(admin, body.values || {}));
      case 'create':         return jsonOutput_(createRow_(body));
      case 'update':         return jsonOutput_(updateRow_(body));
      case 'delete':         return jsonOutput_(deleteRow_(admin, body));
      default:
        return jsonOutput_({ ok: false, error: { code: 'UNKNOWN_ACTION', message: 'Unknown action: ' + body.action } });
    }
  } catch (err) {
    return jsonOutput_({ ok: false, error: { code: 'ERROR', message: String(err && err.message || err) } });
  }
}

/* ------------------------------------------------------------------ *
 *  CRUD
 * ------------------------------------------------------------------ */

function createRow_(body) {
  const key = String(body.sheet || 'enquiries').toLowerCase();
  if (key === 'payments') preparePaymentValues_(body, null);
  const info = getSheetInfo_(key);
  const row = info.headers.map(function (h) {
    if (h === 'Timestamp') return new Date();
    if (h === 'Enquiry ID' && key === 'enquiries') return nextEnquiryId_();
    if (h === 'Payment ID' && key === 'payments') return nextPaymentId_();
    const v = body.values ? body.values[h] : undefined;
    return (v === undefined || v === null) ? '' : v;
  });
  info.sheet.appendRow(row);
  return { ok: true };
}

function updateRow_(body) {
  const key = String(body.sheet || 'enquiries').toLowerCase();
  if (!body.rowIndex) return { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing rowIndex' } };
  if (key === 'payments') preparePaymentValues_(body, body.rowIndex);
  const info = getSheetInfo_(key);
  // Timestamp, (on Enquiries) Enquiry ID, and (on Payments) Payment ID are set
  // once at creation and preserved here regardless of column order.
  const existing = info.sheet.getRange(body.rowIndex, 1, 1, info.headers.length).getValues()[0];
  const values = info.headers.map(function (h, idx) {
    if (h === 'Timestamp') return existing[idx];
    if (h === 'Enquiry ID' && key === 'enquiries') return existing[idx];
    if (h === 'Payment ID' && key === 'payments') return existing[idx];
    const v = body.values ? body.values[h] : undefined;
    return (v === undefined || v === null) ? '' : v;
  });
  info.sheet.getRange(body.rowIndex, 1, 1, values.length).setValues([values]);
  return { ok: true };
}

/**
 * Payments follow the NDR model: multiple payments can share one Enquiry ID
 * (or, if that's blank, one Customer name). "Pending Amount" is derived here —
 *   Pending = Total Amount − SUM(Amount Paid across that group, incl. this row)
 * — and clamped at 0; a payment that would push it below 0 is rejected as an
 * overpayment. Mutates body.values in place: validates the numbers and sets
 * 'Pending Amount' so the generic writer picks it up.
 */
function preparePaymentValues_(body, editingRowIndex) {
  const v = body.values || (body.values = {});
  const total = Number(v['Total Amount']);
  const paid = Number(v['Amount Paid']);
  if (isNaN(total) || total < 0) throw new Error('Total Amount must be a number of 0 or more.');
  if (isNaN(paid) || paid <= 0) throw new Error('Amount Paid must be greater than zero.');

  const groupKey = paymentGroupKey_(v);
  const rows = readRows_('payments').rows;
  let alreadyPaid = 0;
  rows.forEach(function (r) {
    if (editingRowIndex && r.rowIndex === Number(editingRowIndex)) return;
    if (paymentGroupKey_(r) === groupKey) alreadyPaid += Number(r['Amount Paid']) || 0;
  });
  alreadyPaid = round2_(alreadyPaid);

  const pending = round2_(total - (alreadyPaid + paid));
  if (pending < 0) {
    const maxNow = round2_(total - alreadyPaid);
    throw new Error('This exceeds the balance for this enquiry. Already recorded: ₹' + alreadyPaid +
      '. Maximum you can add now: ₹' + (maxNow < 0 ? 0 : maxNow) + '.');
  }
  v['Total Amount'] = total;
  v['Amount Paid'] = paid;
  v['Pending Amount'] = pending;
}

function paymentGroupKey_(row) {
  const eid = String(row['Enquiry ID'] || '').trim();
  if (eid) return 'E:' + eid.toLowerCase();
  return 'C:' + String(row['Customer'] || '').trim().toLowerCase();
}

function deleteRow_(admin, body) {
  if (!admin.canDelete) return { ok: false, error: { code: 'FORBIDDEN', message: 'This account cannot delete entries.' } };
  if (!body.rowIndex) return { ok: false, error: { code: 'BAD_REQUEST', message: 'Missing rowIndex' } };
  const key = String(body.sheet || 'enquiries').toLowerCase();
  getSheetInfo_(key).sheet.deleteRow(body.rowIndex);
  return { ok: true };
}

function updateProfile_(admin, updates) {
  const info = getSheetInfo_('admins');
  if (updates.password) {
    if (String(updates.currentPassword || '') !== String(admin.password)) {
      return { ok: false, error: { code: 'BAD_PASSWORD', message: 'Current password is incorrect.' } };
    }
    info.sheet.getRange(admin.rowIndex, 2).setValue(updates.password);
  }
  if (updates.mobile !== undefined) info.sheet.getRange(admin.rowIndex, 4).setValue(updates.mobile);
  if (updates.email !== undefined) info.sheet.getRange(admin.rowIndex, 5).setValue(updates.email);
  return { ok: true, user: publicAdmin_(findAdmin_(admin.username)) };
}

/* ------------------------------------------------------------------ *
 *  Dashboard + Reports
 * ------------------------------------------------------------------ */

function tz_() { return Session.getScriptTimeZone() || 'Asia/Kolkata'; }

function dateStr_(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}

function last6Months_() {
  const out = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(Utilities.formatDate(d, tz_(), 'yyyy-MM'));
  }
  return out;
}

function monthlySeries_(rows, dateField, sumField) {
  const months = last6Months_();
  const buckets = {};
  months.forEach(function (m) { buckets[m] = 0; });
  rows.forEach(function (r) {
    const key = dateStr_(r[dateField]).slice(0, 7);
    if (!buckets.hasOwnProperty(key)) return;
    buckets[key] += sumField ? (parseFloat(r[sumField]) || 0) : 1;
  });
  return months.map(function (m) { return { month: m, value: Math.round(buckets[m] * 100) / 100 }; });
}

function round2_(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/**
 * One round trip for the whole portal: every sheet's rows + the dashboard
 * stats, computed from the same in-memory read. The frontend calls this once
 * on load and serves every view from the result, instead of a slow Apps
 * Script request per section.
 */
function bootstrap_() {
  const enq = readRows_('enquiries');
  const sup = readRows_('suppliers');
  const book = readRows_('bookings');
  const pay = readRows_('payments');
  return {
    sheets: {
      enquiries: { headers: enq.headers, rows: enq.rows },
      suppliers: { headers: sup.headers, rows: sup.rows },
      bookings: { headers: book.headers, rows: book.rows },
      payments: { headers: pay.headers, rows: pay.rows }
    },
    stats: dashboardStatsFrom_(enq.rows, sup.rows, book.rows, pay.rows)
  };
}

function dashboardStats_() {
  return dashboardStatsFrom_(
    readRows_('enquiries').rows,
    readRows_('suppliers').rows,
    readRows_('bookings').rows,
    readRows_('payments').rows
  );
}

/**
 * Roll up the Payments portal per enquiry (falling back to customer name when a
 * payment has no Enquiry ID). 'Total Amount' is the contracted trip cost —
 * carried forward across a plan's payments, so take the max seen — and
 * 'Amount Paid' is summed. Outstanding is derived per plan and clamped at 0.
 */
function paymentsSummary_(pay) {
  var groups = {};
  pay.forEach(function (r) {
    var eid = String(r['Enquiry ID'] || '').trim();
    var key = eid ? 'E:' + eid.toLowerCase() : 'C:' + String(r['Customer'] || '').trim().toLowerCase();
    var g = groups[key] || (groups[key] = {
      total: 0, paid: 0, enquiryId: eid, customer: r['Customer'] || '', destination: '', last: ''
    });
    g.total = Math.max(g.total, parseFloat(r['Total Amount']) || 0);
    g.paid += parseFloat(r['Amount Paid']) || 0;
    if (r['Destination']) g.destination = r['Destination'];
    var ts = dateStr_(r['Timestamp']);
    if (ts > g.last) g.last = ts;
  });
  var plans = Object.keys(groups).map(function (k) { return groups[k]; });
  var contractedValue = plans.reduce(function (s, g) { return s + g.total; }, 0);
  var collected = plans.reduce(function (s, g) { return s + g.paid; }, 0);
  var outstanding = plans.reduce(function (s, g) { return s + Math.max(0, g.total - g.paid); }, 0);

  var fullyPaid = 0, partPaid = 0, notStarted = 0;
  plans.forEach(function (g) {
    if (g.paid <= 0) notStarted++;
    else if (g.total - g.paid <= 0.01) fullyPaid++;
    else partPaid++;
  });

  var byMode = {};
  pay.forEach(function (r) {
    var m = String(r['Payment Mode'] || '').trim() || 'Other';
    byMode[m] = round2_((byMode[m] || 0) + (parseFloat(r['Amount Paid']) || 0));
  });

  return {
    plans: plans.length,
    transactions: pay.length,
    contractedValue: round2_(contractedValue),
    collected: round2_(collected),
    outstanding: round2_(outstanding),
    collectionRate: contractedValue > 0 ? round2_((collected / contractedValue) * 100) : 0,
    avgPlanValue: plans.length ? round2_(contractedValue / plans.length) : 0,
    fullyPaid: fullyPaid,
    partPaid: partPaid,
    notStarted: notStarted,
    statusBreakdown: { 'Fully paid': fullyPaid, 'Part paid': partPaid, 'Not started': notStarted },
    monthlyCollected: monthlySeries_(pay, 'Timestamp', 'Amount Paid'),
    byMode: byMode,
    due: plans
      .map(function (g) {
        return {
          enquiryId: g.enquiryId,
          customer: g.customer,
          destination: g.destination,
          total: round2_(g.total),
          paid: round2_(g.paid),
          pending: round2_(Math.max(0, g.total - g.paid)),
          last: g.last
        };
      })
      .filter(function (p) { return p.pending > 0.01; })
      .sort(function (a, b) { return b.pending - a.pending; })
      .slice(0, 8)
  };
}

function dashboardStatsFrom_(enq, sup, book, pay) {
  const today = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
  const thisMonth = today.slice(0, 7);

  const bookingsValue = book.reduce(function (s, r) { return s + (parseFloat(r['Amount']) || 0); }, 0);
  const paymentsReceived = pay.reduce(function (s, r) { return s + (parseFloat(r['Amount Paid']) || 0); }, 0);

  const statusBreakdown = { New: 0, Contacted: 0, Booked: 0, Closed: 0 };
  enq.forEach(function (r) { const k = String(r['Status']); if (statusBreakdown.hasOwnProperty(k)) statusBreakdown[k]++; });

  const recent = [];
  enq.forEach(function (r) { recent.push({ icon: '✉', text: 'Enquiry — ' + (r['Name'] || '—') + ' (' + (r['Enquiry ID'] || '') + ')', at: r['Timestamp'] }); });
  book.forEach(function (r) { recent.push({ icon: '🧳', text: 'Booking — ' + (r['Customer'] || '—') + ' · ' + (r['Package'] || ''), at: r['Timestamp'] }); });
  pay.forEach(function (r) { recent.push({ icon: '💳', text: 'Payment — ₹' + (r['Amount Paid'] || 0) + ' from ' + (r['Customer'] || '—'), at: r['Timestamp'] }); });
  recent.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });

  return {
    totalEnquiries: enq.length,
    newEnquiries: enq.filter(function (r) { return String(r['Status']) === 'New'; }).length,
    enquiriesThisMonth: enq.filter(function (r) { return dateStr_(r['Timestamp']).slice(0, 7) === thisMonth; }).length,
    todaysEnquiries: enq.filter(function (r) { return dateStr_(r['Timestamp']) === today; }).length,
    suppliers: sup.length,
    totalBookings: book.length,
    bookingsValue: round2_(bookingsValue),
    paymentsReceived: round2_(paymentsReceived),
    outstanding: Math.max(0, round2_(bookingsValue - paymentsReceived)),
    monthlyEnquiries: monthlySeries_(enq, 'Timestamp', null),
    monthlyPayments: monthlySeries_(pay, 'Timestamp', 'Amount Paid'),
    statusBreakdown: statusBreakdown,
    payments: paymentsSummary_(pay),
    recent: recent.slice(0, 12)
  };
}

function reports_(filters) {
  const enq = readRows_('enquiries').rows;
  const book = readRows_('bookings').rows;
  const pay = readRows_('payments').rows;

  const bookByEnq = {}, payByEnq = {};
  book.forEach(function (r) {
    const k = String(r['Enquiry ID'] || '').trim();
    if (!k) return;
    (bookByEnq[k] = bookByEnq[k] || []).push(r);
  });
  pay.forEach(function (r) {
    const k = String(r['Enquiry ID'] || '').trim();
    if (!k) return;
    (payByEnq[k] = payByEnq[k] || []).push(r);
  });

  let rows = enq.map(function (e) {
    const id = String(e['Enquiry ID'] || '').trim();
    const bk = bookByEnq[id] || [];
    const pmt = payByEnq[id] || [];
    const bookingAmount = bk.reduce(function (s, r) { return s + (parseFloat(r['Amount']) || 0); }, 0);
    const paid = pmt.reduce(function (s, r) { return s + (parseFloat(r['Amount Paid']) || 0); }, 0);
    const outstanding = Math.max(0, bookingAmount - paid);
    let ps = 'No Booking';
    if (bk.length) {
      if (paid <= 0) ps = 'Pending';
      else if (outstanding <= 0) ps = 'Paid';
      else ps = 'Partial';
    } else if (paid > 0) {
      ps = 'Partial';
    }
    return {
      'Enquiry ID': e['Enquiry ID'],
      'Name': e['Name'],
      'Enquiry Date': e['Timestamp'],
      'Destination': e['Destination'],
      'Phone': e['Phone'],
      'Status': e['Status'],
      'Booking Amount': round2_(bookingAmount),
      'Paid': round2_(paid),
      'Outstanding': round2_(outstanding),
      'Payment Status': ps
    };
  });

  if (filters.dateFrom) rows = rows.filter(function (r) { return dateStr_(r['Enquiry Date']) >= filters.dateFrom; });
  if (filters.dateTo) rows = rows.filter(function (r) { return dateStr_(r['Enquiry Date']) <= filters.dateTo; });
  if (filters.destination) {
    const q = String(filters.destination).toLowerCase();
    rows = rows.filter(function (r) { return String(r['Destination'] || '').toLowerCase().indexOf(q) !== -1; });
  }
  if (filters.status) rows = rows.filter(function (r) { return String(r['Status']) === filters.status; });
  if (filters.paymentStatus) rows = rows.filter(function (r) { return r['Payment Status'] === filters.paymentStatus; });

  rows.sort(function (a, b) { return String(b['Enquiry Date']).localeCompare(String(a['Enquiry Date'])); });
  return { rows: rows, total: rows.length };
}

/* ------------------------------------------------------------------ *
 *  Maintenance — NOT exposed via doGet/doPost. Run manually from the
 *  Apps Script editor or `clasp run`. Owner access to the Sheet required.
 * ------------------------------------------------------------------ */

/**
 * Wipes every data row (keeps the header row) from the four operational
 * sheets. Leaves the Admins sheet alone. Also reconciles headers so any
 * newly-added column (e.g. Enquiries "Notes") is present afterwards.
 * Returns a per-sheet count of rows removed.
 */
function resetData() {
  const result = {};
  ['enquiries', 'suppliers', 'bookings', 'payments'].forEach(function (key) {
    const info = getSheetInfo_(key); // also appends any missing headers
    const sheet = info.sheet;
    const last = sheet.getLastRow();
    const removed = Math.max(0, last - 1);
    if (removed > 0) sheet.deleteRows(2, removed);
    // No data left — safe to normalise the header row to the canonical order.
    sheet.getRange(1, 1, 1, info.headers.length).setValues([info.headers]);
    result[key] = removed;
  });
  // Fresh start: next Enquiry ID / Payment ID restart from 1.
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('ENQ_COUNTER');
  props.deleteProperty('PMT_COUNTER');
  Logger.log('resetData: ' + JSON.stringify(result));
  return result;
}
