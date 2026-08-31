/**
 * payments.js — Payments module.
 * Modelled on the NDR payments portal: several payments can be logged against
 * one enquiry. "Total Amount" is the full trip cost — you enter it on the
 * first payment for an enquiry and it's carried over automatically on every
 * later payment for that same enquiry. "Pending Amount" is derived by Code.gs
 * as Total − (all Amount Paid for that enquiry), clamped at 0, and a payment
 * that would overshoot is rejected server-side. The modal shows a live running
 * balance as you type. Each payment also gets an auto-generated Payment ID
 * (PMT-000001), minted by Code.gs and never editable.
 */

const PAY_MODES = ['Cash', 'UPI', 'Card', 'Bank Transfer'];

function paymentGroupKey(enquiryId, customer) {
  const eid = String(enquiryId || '').trim();
  return eid ? 'E:' + eid.toLowerCase() : 'C:' + String(customer || '').trim().toLowerCase();
}

const Payments = makeSheetModule({
  key: 'payments',
  title: 'Payments',
  singular: 'Payment',
  primaryKey: 'Customer',
  defaultSort: 'Timestamp',
  enquiryPicker: true,
  badgeCol: 'Payment Mode',
  badgeOptions: PAY_MODES,
  // A dedicated Enquiry ID filter (all payments for one enquiry) + a toggle to
  // collapse the list to the most recent payment per enquiry.
  extraFilters: [{ key: 'Enquiry ID', label: 'Enquiry ID', placeholder: 'Filter by Enquiry ID…' }],
  latestPerGroup: { label: 'Latest per enquiry', groupKeys: ['Enquiry ID', 'Customer'], dateKey: 'Timestamp' },
  // Click an Enquiry ID cell -> modal listing every payment for that enquiry.
  detailOn: {
    column: 'Enquiry ID',
    groupBy: 'Enquiry ID',
    title: (id, rows) => `Payments for ${(rows[0] && rows[0]['Customer']) || '—'} — ${id}`,
    summary: (rows) => {
      const paid = rows.reduce((s, r) => s + (Number(r['Amount Paid']) || 0), 0);
      const total = rows.reduce((m, r) => Math.max(m, Number(r['Total Amount']) || 0), 0);
      const pending = Math.max(0, total - paid);
      return `${rows.length} payment${rows.length === 1 ? '' : 's'} · Total ${Utils.formatCurrency(total)} · Paid ${Utils.formatCurrency(paid)} · Pending ${Utils.formatCurrency(pending)}`;
    },
    columns: [
      { key: 'Instalment', label: '#' },
      { key: 'Payment ID', label: 'Payment ID' },
      { key: 'Destination', label: 'Destination' },
      { key: 'Timestamp', label: 'Recorded', type: 'date-dmy' },
      { key: 'Amount Paid', label: 'Paid', type: 'currency' },
      { key: 'Pending Amount', label: 'Pending', type: 'currency' },
      { key: 'Payment Mode', label: 'Mode' },
      { key: 'Transaction Ref', label: 'Txn ref' },
      { key: 'Notes', label: 'Notes' },
    ],
  },
  searchCols: ['Payment ID', 'Enquiry ID', 'Customer', 'Destination', 'Transaction Ref'],
  columns: [
    { key: 'Payment ID', label: 'Payment ID', cls: 'mono' },
    { key: 'Enquiry ID', label: 'Enquiry ID', cls: 'mono' },
    { key: 'Instalment', label: 'Instalment', cls: 'mono' },
    { key: 'Timestamp', label: 'Recorded', type: 'date-dmy' },
    { key: 'Last Updated', label: 'Updated', type: 'datetime' },
    { key: 'Customer', label: 'Customer', primary: true },
    { key: 'Destination', label: 'Destination' },
    { key: 'Total Amount', label: 'Total', type: 'currency' },
    { key: 'Amount Paid', label: 'Paid', type: 'currency' },
    { key: 'Pending Amount', label: 'Pending', type: 'currency-pending' },
    { key: 'Payment Mode', label: 'Mode' },
    { key: 'Transaction Ref', label: 'Txn ref' },
    { key: 'Notes', label: 'Notes' }
  ],
  formFields: [
    { key: 'Enquiry ID', label: 'Enquiry ID', type: 'picker', list: 'enquiryIdList', placeholder: 'Search by enquiry ID, name, phone or destination…', full: true },
    { key: 'Customer', label: 'Customer', required: true },
    { key: 'Destination', label: 'Destination' },
    { key: 'Total Amount', label: 'Total amount (₹)', type: 'number', required: true },
    { key: 'Amount Paid', label: 'Amount paid now (₹)', type: 'number', required: true },
    { key: 'Payment Mode', label: 'Payment mode', type: 'select', options: PAY_MODES, default: 'UPI' },
    { key: 'Transaction Ref', label: 'Transaction reference' },
    { key: 'Notes', label: 'Notes', type: 'textarea' }
  ],
  validate: (v) => {
    if (!v.Customer.trim()) return 'Customer is required.';
    if (!(Number(v['Total Amount']) >= 0)) return 'Total amount must be a number of 0 or more.';
    if (!(Number(v['Amount Paid']) > 0)) return 'Amount paid must be greater than zero.';
    return null;
  },
  // Carries the Total Amount forward from earlier payments on the same enquiry,
  // and shows a live running balance. Code.gs is the authority on save.
  onFormOpen: ({ rows, rowIndex }) => {
    const host = document.getElementById('modalFields');
    const get = (k) => host.querySelector(`[data-field="${k}"]`);
    const eidEl = get('Enquiry ID'), custEl = get('Customer'),
          totalEl = get('Total Amount'), paidEl = get('Amount Paid');
    if (!totalEl || !paidEl) return;
    const money = (n) => '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN');

    const note = document.createElement('div');
    note.className = 'field full';
    note.innerHTML = `<div class="hint" id="pay-balance" style="font-size:12.5px;line-height:1.6;"></div>`;
    host.appendChild(note);
    const out = note.querySelector('#pay-balance');

    // Prior payment rows for whatever enquiry / customer is currently selected.
    const priorRows = () => {
      const key = paymentGroupKey(eidEl ? eidEl.value : '', custEl ? custEl.value : '');
      return rows.filter(r => (!rowIndex || r.rowIndex !== rowIndex)
        && paymentGroupKey(r['Enquiry ID'], r['Customer']) === key);
    };

    // The Total is "carried over" until the user types their own value.
    let totalUserSet = !!totalEl.value; // editing an existing row counts as set
    totalEl.addEventListener('input', () => { totalUserSet = true; });

    let carried = false;
    const autofillTotal = () => {
      const prev = priorRows();
      const seen = prev.map(r => Number(r['Total Amount']) || 0).filter(n => n > 0);
      if (totalUserSet) { carried = false; return; }
      if (seen.length) { totalEl.value = seen[seen.length - 1]; carried = true; }
      else { totalEl.value = ''; carried = false; }
    };

    const recompute = () => {
      autofillTotal();
      const prev = priorRows();
      const already = prev.reduce((s, r) => s + (Number(r['Amount Paid']) || 0), 0);
      const total = Number(totalEl.value) || 0;
      const paidNow = Number(paidEl.value) || 0;
      const pending = total - already - paidNow;
      out.innerHTML =
        (carried ? `Total ${money(total)} carried over from an earlier payment.<br>` : '') +
        `Already recorded for this enquiry: <b>${money(already)}</b><br>` +
        (pending < 0
          ? `<span style="color:var(--red);font-weight:600">Exceeds the total by ${money(-pending)} — reduce the amount before saving.</span>`
          : `Pending after this payment: <b style="color:${pending > 0 ? 'var(--red)' : 'var(--jade)'}">${money(pending)}</b>`);
    };

    [eidEl, custEl, totalEl, paidEl].forEach(el => {
      if (!el) return;
      el.addEventListener('input', recompute);
      el.addEventListener('change', recompute); // picker selection fires 'change'
    });
    recompute();
  }
});

App.onView('payments', () => Payments.load());
