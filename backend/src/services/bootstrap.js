/**
 * services/bootstrap.js
 * One round trip for the whole portal: every entity's rows + the dashboard
 * stats, computed from the same in-memory read. Mirrors Code.gs.bootstrap_.
 */

const { listRows } = require('./sheets');
const dashboard = require('./dashboard');

async function build() {
  const [enquiries, suppliers, bookings, payments] = await Promise.all(
    ['enquiries', 'suppliers', 'bookings', 'payments'].map((k) => listRows(k)),
  );
  return {
    sheets: { enquiries, suppliers, bookings, payments },
    stats: dashboard.computeStats({
      enquiries: enquiries.rows,
      suppliers: suppliers.rows,
      bookings: bookings.rows,
      payments: payments.rows,
    }),
  };
}

module.exports = { build };
