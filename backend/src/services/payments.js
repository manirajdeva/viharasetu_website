/**
 * services/payments.js
 * The NDR-style payments rule, ported verbatim from Code.gs.preparePaymentValues_:
 *
 *   Several payments can share one Enquiry ID (or, if that's blank, one
 *   Customer name). Pending Amount is derived here —
 *     Pending = Total Amount − SUM(Amount Paid across that group, incl. this row)
 *   — and clamped at 0; a payment that would push it below 0 is rejected as an
 *   overpayment.
 *
 * Mutates the display-header-keyed `values` in place: validates the numbers and
 * sets values['Pending Amount'] so the generic writer picks it up. Runs on the
 * same transaction connection as the insert/update.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function paymentGroupKey(row) {
  const eid = String(row['Enquiry ID'] ?? row.enquiry_id ?? '').trim();
  if (eid) return `E:${eid.toLowerCase()}`;
  return `C:${String(row['Customer'] ?? row.customer ?? '').trim().toLowerCase()}`;
}

class PaymentError extends Error {
  constructor(message) {
    super(message);
    this.code = 'ERROR';
  }
}

async function preparePaymentValues(conn, values, editingRowIndex) {
  const total = Number(values['Total Amount']);
  const paid = Number(values['Amount Paid']);
  if (Number.isNaN(total) || total < 0) throw new PaymentError('Total Amount must be a number of 0 or more.');
  if (Number.isNaN(paid) || paid <= 0) throw new PaymentError('Amount Paid must be greater than zero.');

  const groupKey = paymentGroupKey(values);
  const [rows] = await conn.query('SELECT id, enquiry_id, customer, amount_paid FROM payments');

  let alreadyPaid = 0;
  for (const r of rows) {
    if (editingRowIndex && Number(r.id) === Number(editingRowIndex)) continue;
    if (paymentGroupKey(r) === groupKey) alreadyPaid += Number(r.amount_paid) || 0;
  }
  alreadyPaid = round2(alreadyPaid);

  const pending = round2(total - (alreadyPaid + paid));
  if (pending < 0) {
    const maxNow = round2(total - alreadyPaid);
    throw new PaymentError(
      `This exceeds the balance for this enquiry. Already recorded: ₹${alreadyPaid}. ` +
      `Maximum you can add now: ₹${maxNow < 0 ? 0 : maxNow}.`,
    );
  }

  values['Total Amount'] = total;
  values['Amount Paid'] = paid;
  values['Pending Amount'] = pending;
}

module.exports = { preparePaymentValues, paymentGroupKey, round2 };
