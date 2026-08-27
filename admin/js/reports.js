/**
 * reports.js — Reports view.
 * One row per enquiry, joined with its bookings and payments (matched on
 * Enquiry ID) into booking value / paid / outstanding totals. Filtering
 * and the join happen server-side in Code.gs's `reports` action; this file
 * renders the result and exports it to CSV / Excel / PDF.
 */

const Reports = (() => {
  let rows = [];

  const columns = [
    { key: 'Enquiry ID', label: 'Enquiry ID' },
    { key: 'Name', label: 'Name' },
    { key: 'Enquiry Date', label: 'Enquiry Date' },
    { key: 'Destination', label: 'Destination' },
    { key: 'Phone', label: 'Phone' },
    { key: 'Status', label: 'Enquiry Status' },
    { key: 'Booking Amount', label: 'Booking Amount' },
    { key: 'Paid', label: 'Paid' },
    { key: 'Outstanding', label: 'Outstanding' },
    { key: 'Payment Status', label: 'Payment Status' }
  ];

  function shell() {
    document.getElementById('view-reports').innerHTML = `
      <div class="card">
        <div class="section-title">Filters</div>
        <div class="section-sub">Leave a field blank to ignore it.</div>
        <form id="rpt-form" class="report-form">
          <div class="field"><label>From date</label><input type="date" id="rpt-from" /></div>
          <div class="field"><label>To date</label><input type="date" id="rpt-to" /></div>
          <div class="field"><label>Destination</label><input type="text" id="rpt-dest" placeholder="e.g. Kerala" /></div>
          <div class="field"><label>Enquiry status</label>
            <select id="rpt-status"><option value="">All</option><option>New</option><option>Contacted</option><option>Booked</option><option>Closed</option></select>
          </div>
          <div class="field"><label>Payment status</label>
            <select id="rpt-pay"><option value="">All</option><option>Paid</option><option>Partial</option><option>Pending</option><option>No Booking</option></select>
          </div>
          <div class="field" style="display:flex;gap:8px;">
            <button type="submit" class="btn primary">Generate</button>
            <button type="button" class="btn" id="rpt-reset">Reset</button>
          </div>
        </form>
      </div>

      <div class="card">
        <div class="toolbar">
          <div class="section-title" style="margin:0;">Results <span class="stat-pill" id="rpt-count">0</span></div>
          <div class="grp">
            <button class="btn sm" data-x="csv">CSV</button>
            <button class="btn sm" data-x="xlsx">Excel</button>
            <button class="btn sm" data-x="pdf">PDF</button>
          </div>
        </div>
        <div class="table-wrap" id="rpt-tw"><div class="empty">Set filters and hit Generate.</div></div>
      </div>`;

    document.getElementById('rpt-form').addEventListener('submit', (e) => { e.preventDefault(); generate(); });
    document.getElementById('rpt-reset').addEventListener('click', () => { document.getElementById('rpt-form').reset(); generate(); });
    document.querySelector('#view-reports [data-x="csv"]').addEventListener('click', () => Utils.exportCSV(rows, columns, 'viharasetu_report'));
    document.querySelector('#view-reports [data-x="xlsx"]').addEventListener('click', () => Utils.exportExcel(rows, columns, 'viharasetu_report'));
    document.querySelector('#view-reports [data-x="pdf"]').addEventListener('click', () => Utils.exportPDF(rows, columns, 'viharasetu_report', 'Viharasetu Report'));
  }

  function filters() {
    return {
      dateFrom: document.getElementById('rpt-from').value,
      dateTo: document.getElementById('rpt-to').value,
      destination: document.getElementById('rpt-dest').value.trim(),
      status: document.getElementById('rpt-status').value,
      paymentStatus: document.getElementById('rpt-pay').value
    };
  }

  async function generate() {
    const tw = document.getElementById('rpt-tw');
    tw.innerHTML = '<div class="loading">Generating…</div>';
    try {
      const res = await Api.reports(filters());
      rows = res.rows || [];
      document.getElementById('rpt-count').textContent = res.total ?? rows.length;
      renderTable();
    } catch (err) {
      tw.innerHTML = `<div class="error-msg">${Utils.escapeHtml(err.message || 'Could not generate the report.')}</div>`;
    }
  }

  function renderTable() {
    const tw = document.getElementById('rpt-tw');
    if (!rows.length) { tw.innerHTML = '<div class="empty">No records match those filters.</div>'; return; }
    const head = columns.map(c => `<th>${c.label}</th>`).join('');
    const body = rows.map(r => `
      <tr>
        <td class="mono">${Utils.escapeHtml(r['Enquiry ID'])}</td>
        <td class="primary-col">${Utils.escapeHtml(r['Name'])}</td>
        <td>${Utils.formatDate(r['Enquiry Date'])}</td>
        <td>${Utils.escapeHtml(r['Destination'] || '-')}</td>
        <td>${Utils.escapeHtml(r['Phone'] || '-')}</td>
        <td><span class="badge ${Utils.escapeAttr(String(r['Status']).split(' ')[0])}">${Utils.escapeHtml(r['Status'])}</span></td>
        <td>${Utils.formatCurrency(r['Booking Amount'])}</td>
        <td>${Utils.formatCurrency(r['Paid'])}</td>
        <td>${Utils.formatCurrency(r['Outstanding'])}</td>
        <td>${Utils.escapeHtml(r['Payment Status'])}</td>
      </tr>`).join('');
    tw.innerHTML = `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  function render() {
    if (!document.getElementById('rpt-form')) shell();
  }

  return { render, generate };
})();

App.onView('reports', () => Reports.render());
