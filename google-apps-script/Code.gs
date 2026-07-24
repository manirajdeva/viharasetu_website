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
 *
 * This automatically creates 3 tabs the first time each is used (if they don't already
 * exist): Enquiries, Suppliers, Bookings — with the header row shown below. If you already
 * have tabs with different names/columns, either rename them to match, or edit SHEETS below
 * to match your actual tab/column names.
 */

const SHEETS = {
  enquiries: {
    name: 'Enquiries',
    headers: ['Timestamp', 'Name', 'Email', 'Phone', 'Destination', 'Travel', 'Status']
  },
  suppliers: {
    name: 'Suppliers',
    headers: ['Timestamp', 'Supplier Company Name', 'States', 'Supplier Name', 'Supplier ID', 'Contact No']
  },
  bookings: {
    name: 'Bookings',
    headers: ['Timestamp', 'Customer', 'Package', 'Travel Dates', 'Pax', 'Amount', 'Payment Status', 'Notes']
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
    sheet.appendRow([
      new Date(),
      body.name || '',
      body.email || '',
      body.phone || '',
      body.destination || '',
      body.travel || '',
      'New'
    ]);
    return jsonOutput_({ ok: true });
  }

  const key = (body.sheet || 'enquiries').toLowerCase();
  const { sheet, headers } = getSheetInfo_(key);

  if (body.action === 'create') {
    const row = headers.map(h => {
      if (h === 'Timestamp') return new Date();
      const v = body.values ? body.values[h] : undefined;
      return (v === undefined || v === null) ? '' : v;
    });
    sheet.appendRow(row);
    return jsonOutput_({ ok: true });
  }

  if (body.action === 'update') {
    if (!body.rowIndex) return jsonOutput_({ ok: false, error: 'Missing rowIndex' });
    const rest = headers.slice(1); // everything except Timestamp
    const values = rest.map(h => {
      const v = body.values ? body.values[h] : undefined;
      return (v === undefined || v === null) ? '' : v;
    });
    sheet.getRange(body.rowIndex, 2, 1, values.length).setValues([values]);
    return jsonOutput_({ ok: true });
  }

  if (body.action === 'delete') {
    if (!body.rowIndex) return jsonOutput_({ ok: false, error: 'Missing rowIndex' });
    sheet.deleteRow(body.rowIndex);
    return jsonOutput_({ ok: true });
  }

  return jsonOutput_({ ok: false, error: 'Unknown action: ' + body.action });
}