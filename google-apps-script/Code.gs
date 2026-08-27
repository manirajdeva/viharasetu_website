/**
 * Viharasetu admin backend — handles the public enquiry form AND the
 * admin portal (Enquiries / Suppliers / Bookings).
 *
 * Setup:
 * 1. Open the Google Sheet you want everything stored in.
 * 2. Extensions -> Apps Script.
 * 3. Delete whatever is in Code.gs and paste this file's contents in its place.
 * 4. Deploy -> Manage deployments -> edit (pencil icon) your existing web app deployment
 *    -> Version: "New version" -> Deploy. Keeping it as the SAME deployment preserves
 *    the /exec URL already used by index.html and admin.html.
 * 5. First run will ask you to authorize the script - approve it (it only touches this sheet).
 * 6. Admin login now lives here instead of in admin.html's source. Open the sheet, find (or
 *    trigger the creation of, by loading admin.html once) the new "Admins" tab, and add one
 *    row per admin: Username, Password, CanDelete (TRUE/FALSE), Mobile, Email. Until at least
 *    one row exists, nobody can log into the admin portal.
 * 7. Enquiry ID: every new Enquiry now gets an auto-generated ID like "VH-20260828-01"
 *    (date + a same-day sequence number). If your Enquiries/Bookings tabs already have
 *    data, insert a new first column titled exactly "Enquiry ID" in each of those two
 *    tabs (existing rows can be left blank there — only new rows get one going forward).
 *    Bookings and Payments both carry their own "Enquiry ID" column too, filled in by
 *    hand in the admin portal, so all three sheets can be cross-referenced by that ID.
 *
 * This automatically creates 5 tabs the first time each is used (if they don't already
 * exist): Enquiries, Suppliers, Bookings, Payments, Admins — with the header row shown
 * below. If you already have tabs with different names/columns, either rename them to
 * match, or edit SHEETS below to match your actual tab/column names.
 */

const SHEETS = {
  enquiries: {
    name: 'Enquiries',
    headers: ['Enquiry ID', 'Timestamp', 'Name', 'Email', 'Phone', 'Destination', 'Travel', 'Status']
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
    headers: ['Enquiry ID', 'Timestamp', 'Customer', 'Amount Paid', 'Payment Mode', 'Transaction Ref', 'Notes']
  },
  // Admin accounts live here instead of in admin.html's source, so credentials
  // are never shipped to the browser. After first deploying this version, open
  // this sheet's new "Admins" tab and add one row per admin: Username, Password,
  // CanDelete (TRUE/FALSE), Mobile, Email.
  admins: {
    name: 'Admins',
    headers: ['Username', 'Password', 'CanDelete', 'Mobile', 'Email']
  }
};

function getSheetInfo_(key) {
  const cfg = SHEETS[key];
  if (!cfg) throw new Error('Unknown sheet key: ' + key);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(cfg.name);
  if (!sheet) sheet = ss.insertSheet(cfg.name);
  if (sheet.getLastRow() === 0) sheet.appendRow(cfg.headers);
  return { sheet: sheet, headers: cfg.headers };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function isTrue_(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE' || String(v).trim().toUpperCase() === 'YES';
}

/** Looks up one admin row by username. Returns null if not found. */
function findAdmin_(username) {
  const { sheet, headers } = getSheetInfo_('admins');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === username) {
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

/** Verifies a username/password pair against the Admins sheet. Returns the admin row or null. */
function verifyAdmin_(username, password) {
  const admin = findAdmin_(username);
  if (!admin || !password || admin.password !== password) return null;
  return admin;
}

/** Admin row with the password stripped out, safe to send back to the browser. */
function publicAdmin_(admin) {
  return { username: admin.username, canDelete: admin.canDelete, mobile: admin.mobile, email: admin.email };
}

/**
 * Mints the next Enquiry ID, e.g. "VH-20260828-01" — date-based, with a
 * same-day sequence number that resets at midnight. Uses a script lock so two
 * enquiries submitted at nearly the same instant still get different IDs.
 */
function nextEnquiryId_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const tz = Session.getScriptTimeZone() || 'Etc/UTC';
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

/** GET /exec?sheet=enquiries|suppliers|bookings -> all rows for that sheet as JSON. */
function doGet(e) {
  const key = ((e.parameter && e.parameter.sheet) || 'enquiries').toLowerCase();
  const { sheet, headers } = getSheetInfo_(key);
  const data = sheet.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    const hasData = r.some((v, idx) => idx > 0 && v !== '' && v !== null);
    if (!hasData) continue;
    const obj = { rowIndex: i + 1 };
    headers.forEach((h, idx) => {
      let v = r[idx];
      if (v instanceof Date) v = v.toISOString();
      obj[h] = (v === null || v === undefined) ? '' : v;
    });
    rows.push(obj);
  }
  return jsonOutput_({ ok: true, headers: headers, rows: rows });
}

/**
 * POST /exec ->
 *  - No "sheet"/"action" in the body: legacy path used by the public contact form
 *    in index.html, which posts {name,email,phone,destination,travel}. Appends to
 *    Enquiries with Status "New".
 *  - {sheet, action:'create', values:{...}}: append a new row to that sheet.
 *  - {sheet, action:'update', rowIndex, values:{...}}: overwrite an existing row.
 *  - {sheet, action:'delete', rowIndex}: remove a row.
 */
function doPost(e) {
  const body = JSON.parse(e.postData.contents || '{}');

  if (!body.sheet && !body.action) {
    const { sheet } = getSheetInfo_('enquiries');
    const enquiryId = nextEnquiryId_();
    sheet.appendRow([
      enquiryId,
      new Date(),
      body.name || '',
      body.email || '',
      body.phone || '',
      body.destination || '',
      body.travel || '',
      'New'
    ]);
    return jsonOutput_({ ok: true, enquiryId: enquiryId });
  }

  // Public: checks credentials against the Admins sheet. No prior auth needed to call this.
  if (body.action === 'login') {
    const admin = verifyAdmin_(body.username, body.password);
    if (!admin) return jsonOutput_({ ok: false, error: 'Invalid username or password.' });
    return jsonOutput_({ ok: true, user: publicAdmin_(admin) });
  }

  // Every other admin action must re-prove identity on each request — there are no
  // server-side sessions here, so the client resends username/password each time.
  if (body.action === 'updateProfile' || body.action === 'create' || body.action === 'update' || body.action === 'delete') {
    const admin = verifyAdmin_(body.username, body.password);
    if (!admin) return jsonOutput_({ ok: false, error: 'Not authenticated.' });

    if (body.action === 'updateProfile') {
      const { sheet } = getSheetInfo_('admins');
      const updates = body.values || {};
      if (updates.mobile !== undefined) sheet.getRange(admin.rowIndex, 4).setValue(updates.mobile);
      if (updates.email !== undefined) sheet.getRange(admin.rowIndex, 5).setValue(updates.email);
      if (updates.password) sheet.getRange(admin.rowIndex, 2).setValue(updates.password);
      const updated = findAdmin_(admin.username);
      return jsonOutput_({ ok: true, user: publicAdmin_(updated) });
    }

    const key = (body.sheet || 'enquiries').toLowerCase();
    const { sheet, headers } = getSheetInfo_(key);

    if (body.action === 'create') {
      const row = headers.map(h => {
        if (h === 'Timestamp') return new Date();
        if (h === 'Enquiry ID' && key === 'enquiries') return nextEnquiryId_();
        const v = body.values ? body.values[h] : undefined;
        return (v === undefined || v === null) ? '' : v;
      });
      sheet.appendRow(row);
      return jsonOutput_({ ok: true });
    }

    if (body.action === 'update') {
      if (!body.rowIndex) return jsonOutput_({ ok: false, error: 'Missing rowIndex' });
      // Timestamp and (on Enquiries) Enquiry ID are set once at creation and never
      // touched again — read the existing row so those columns survive untouched
      // no matter where they fall in the header order.
      const existing = sheet.getRange(body.rowIndex, 1, 1, headers.length).getValues()[0];
      const values = headers.map((h, idx) => {
        if (h === 'Timestamp') return existing[idx];
        if (h === 'Enquiry ID' && key === 'enquiries') return existing[idx];
        const v = body.values ? body.values[h] : undefined;
        return (v === undefined || v === null) ? '' : v;
      });
      sheet.getRange(body.rowIndex, 1, 1, values.length).setValues([values]);
      return jsonOutput_({ ok: true });
    }

    if (body.action === 'delete') {
      if (!admin.canDelete) return jsonOutput_({ ok: false, error: 'This account cannot delete entries.' });
      if (!body.rowIndex) return jsonOutput_({ ok: false, error: 'Missing rowIndex' });
      sheet.deleteRow(body.rowIndex);
      return jsonOutput_({ ok: true });
    }
  }

  return jsonOutput_({ ok: false, error: 'Unknown action: ' + body.action });
}