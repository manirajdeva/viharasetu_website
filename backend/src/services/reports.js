/**
 * services/reports.js
 * The Reports join, ported from Code.gs.reports_ (identical to
 * mock-server/server.js): one row per enquiry, LEFT-joined to its bookings and
 * payments (matched on Enquiry ID) into booking value / paid / outstanding /
 * payment status, with the same optional filters.
 */

const { listRows } = require('./sheets');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function dateStr(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

async function run(filters) {
  filters = filters || {};
  const [enqData, bookData, payData] = await Promise.all([
    listRows('enquiries'), listRows('bookings'), listRows('payments'),
  ]);

  const bookByEnq = {};
  const payByEnq = {};
  bookData.rows.forEach((r) => {
    const k = String(r['Enquiry ID'] || '').trim();
    if (k) (bookByEnq[k] = bookByEnq[k] || []).push(r);
  });
  payData.rows.forEach((r) => {
    const k = String(r['Enquiry ID'] || '').trim();
    if (k) (payByEnq[k] = payByEnq[k] || []).push(r);
  });

  let rows = enqData.rows.map((e) => {
    const id = String(e['Enquiry ID'] || '').trim();
    const bk = bookByEnq[id] || [];
    const pmt = payByEnq[id] || [];
    const bookingAmount = bk.reduce((s, r) => s + (parseFloat(r['Amount']) || 0), 0);
    const paid = pmt.reduce((s, r) => s + (parseFloat(r['Amount Paid']) || 0), 0);
    const outstanding = Math.max(0, bookingAmount - paid);
    let ps = 'No Booking';
    if (bk.length) ps = paid <= 0 ? 'Pending' : outstanding <= 0 ? 'Paid' : 'Partial';
    else if (paid > 0) ps = 'Partial';
    return {
      'Enquiry ID': e['Enquiry ID'],
      'Name': e['Name'],
      'Enquiry Date': e['Timestamp'],
      'Destination': e['Destination'],
      'Phone': e['Phone'],
      'Status': e['Status'],
      'Booking Amount': round2(bookingAmount),
      'Paid': round2(paid),
      'Outstanding': round2(outstanding),
      'Payment Status': ps,
    };
  });

  if (filters.dateFrom) rows = rows.filter((r) => dateStr(r['Enquiry Date']) >= filters.dateFrom);
  if (filters.dateTo) rows = rows.filter((r) => dateStr(r['Enquiry Date']) <= filters.dateTo);
  if (filters.destination) {
    const query = String(filters.destination).toLowerCase();
    rows = rows.filter((r) => String(r['Destination'] || '').toLowerCase().includes(query));
  }
  if (filters.status) rows = rows.filter((r) => r['Status'] === filters.status);
  if (filters.paymentStatus) rows = rows.filter((r) => r['Payment Status'] === filters.paymentStatus);

  rows.sort((a, b) => String(b['Enquiry Date']).localeCompare(String(a['Enquiry Date'])));
  return { rows, total: rows.length };
}

module.exports = { run };
