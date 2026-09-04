/**
 * services/dashboard.js
 * Dashboard aggregates, ported from Code.gs.dashboardStatsFrom_ (and identical
 * to mock-server/server.js). Pure function over the four entities' display
 * rows, so `bootstrap` can reuse rows it already fetched.
 */

const { listRows } = require('./sheets');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function dateStr(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
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
  months.forEach((m) => { buckets[m] = 0; });
  rows.forEach((r) => {
    const k = dateStr(r[dateField]).slice(0, 7);
    if (!(k in buckets)) return;
    buckets[k] += sumField ? (parseFloat(r[sumField]) || 0) : 1;
  });
  return months.map((m) => ({ month: m, value: round2(buckets[m]) }));
}

/**
 * Roll up the Payments portal per enquiry (falling back to customer name when a
 * payment has no Enquiry ID). `Total Amount` is the contracted trip cost — it's
 * carried forward across a plan's payments, so we take the max seen — and
 * `Amount Paid` is summed. Outstanding is derived per plan and clamped at 0.
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

  let fullyPaid = 0;
  let partPaid = 0;
  let notStarted = 0;
  plans.forEach((g) => {
    if (g.paid <= 0) notStarted += 1;
    else if (g.total - g.paid <= 0.01) fullyPaid += 1;
    else partPaid += 1;
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

/** @param rows { enquiries, suppliers, bookings, payments } arrays of display rows. */
function computeStats({ enquiries: enq, suppliers: sup, bookings: book, payments: pay }) {
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
    recent: recent.slice(0, 12),
  };
}

/** Fetch all four entities and compute the stats. */
async function load() {
  const [enquiries, suppliers, bookings, payments] = await Promise.all(
    ['enquiries', 'suppliers', 'bookings', 'payments'].map((k) => listRows(k)),
  );
  return computeStats({
    enquiries: enquiries.rows,
    suppliers: suppliers.rows,
    bookings: bookings.rows,
    payments: payments.rows,
  });
}

module.exports = { computeStats, load };
