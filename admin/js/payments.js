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

/* ============================ Payment receipt PDF ============================ */
/* Edit these details — they print on the receipt. */
const COMPANY = {
  name: 'Viharasetu',
  tagline: 'Travel & Tourism  |  Domestic • Spiritual Journeys • Adventures • International',
  phone: '+91 98851-80515',
  email: 'viharasetu@gmail.com',
  website: 'viharasetu.co.in',
  instagram: 'instagram.com/viharasetu',   // TODO: confirm the exact handle
  logo: '../images/Logo_hor.png',
};

// "Rs." (not ₹) — the rupee glyph is missing from jsPDF's built-in fonts.
function pdfMoney(n) { return 'Rs. ' + Math.round(Number(n) || 0).toLocaleString('en-IN'); }

function receiptDate(v) {
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v || '');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}

/* Indian-system number to words (up to crores). */
function amountWords(num) {
  num = Math.round(Number(num) || 0);
  if (num === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => x < 20 ? ones[x] : (tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''));
  const three = (x) => {
    const h = Math.floor(x / 100), r = x % 100;
    return (h ? ones[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : '');
  };
  let out = '';
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thou = Math.floor(num / 1000); num %= 1000;
  if (crore) out += three(crore) + ' Crore ';
  if (lakh) out += two(lakh) + ' Lakh ';
  if (thou) out += two(thou) + ' Thousand ';
  if (num) out += three(num);
  return out.trim();
}

function loadReceiptLogo(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Build + save a "PAYMENT RECEIPT" PDF for every payment against one enquiry. */
async function generateReceipt(rows, enquiryId) {
  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) throw new Error('PDF library failed to load.');

  const doc = new jsPDFCtor({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 15;
  let y = 12;
  const contactLine = [COMPANY.phone, COMPANY.email, COMPANY.website, COMPANY.instagram]
    .filter(Boolean).join('  |  ');

  const total = rows.reduce((m, r) => Math.max(m, Number(r['Total Amount']) || 0), 0);
  const paid = rows.reduce((s, r) => s + (Number(r['Amount Paid']) || 0), 0);
  const outstanding = Math.max(0, total - paid);
  const customer = (rows[0] && rows[0]['Customer']) || '';
  const destination = (rows.find(r => r['Destination']) || {})['Destination'] || '';

  /* ---- header: just the logo + a divider (contact details live in the footer) ---- */
  const logo = await loadReceiptLogo(COMPANY.logo);
  if (logo && logo.naturalWidth) {
    const h = 20, w = h * (logo.naturalWidth / logo.naturalHeight);
    try { doc.addImage(logo, 'PNG', M, y, w, h); } catch (e) { /* skip */ }
    y += h + 3;
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(COMPANY.name, M, y + 7);
    y += 12;
  }
  doc.setDrawColor(180); doc.line(M, y, W - M, y); y += 8;

  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('PAYMENT RECEIPT', W / 2, y, { align: 'center' }); y += 9;

  /* ---- key / value ---- */
  doc.setFontSize(10);
  [
    ['Receipt / Booking No.', enquiryId],
    ['Receipt Date', receiptDate(new Date())],
    ['Customer Name', customer || '—'],
    ['Destination', destination || '—'],
  ].forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold'); doc.text(k + ':', M, y);
    doc.setFont('helvetica', 'normal'); doc.text(String(v), M + 48, y);
    y += 6;
  });
  y += 3;

  /* ---- acknowledgement ---- */
  doc.setFont('helvetica', 'bold'); doc.text('Payment Acknowledgement', M, y); y += 5;
  doc.setFont('helvetica', 'normal');
  const inst = rows.length === 1 ? 'a single payment' : `${rows.length} installments`;
  const ack = outstanding <= 0
    ? `This is to acknowledge that we have received the full payment of ${pdfMoney(paid)} (Rupees ${amountWords(paid)} Only) towards the above-mentioned travel booking. The payment has been received in ${inst}, and there is no outstanding balance as of the receipt date.`
    : `This is to acknowledge that we have received a payment of ${pdfMoney(paid)} (Rupees ${amountWords(paid)} Only) towards the above-mentioned travel booking, received in ${inst}. An outstanding balance of ${pdfMoney(outstanding)} (Rupees ${amountWords(outstanding)} Only) remains as of the receipt date.`;
  const ackLines = doc.splitTextToSize(ack, W - 2 * M);
  doc.text(ackLines, M, y);
  y += ackLines.length * 5 + 5;

  /* ---- details table ---- */
  doc.autoTable({
    startY: y,
    head: [['#', 'Payment ID', 'Destination', 'Recorded', 'Amount Paid', 'Pending', 'Mode', 'Txn Ref', 'Notes']],
    body: rows.map((r, i) => [
      i + 1, r['Payment ID'] || '', r['Destination'] || '—', receiptDate(r['Timestamp']),
      pdfMoney(r['Amount Paid']), pdfMoney(r['Pending Amount']),
      r['Payment Mode'] || '', r['Transaction Ref'] || '—', r['Notes'] || '—',
    ]),
    foot: [['', 'Total', '', '', pdfMoney(paid), pdfMoney(outstanding), '', '', '']],
    styles: { fontSize: 8, cellPadding: 1.6 },
    headStyles: { fillColor: [187, 90, 52] },
    footStyles: { fillColor: [242, 236, 230], textColor: 20, fontStyle: 'bold' },
    margin: { left: M, right: M },
  });
  y = doc.lastAutoTable.finalY + 9;

  /* ---- summary ---- */
  if (y > 250) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Payment Summary', M, y); y += 5;
  doc.setFont('helvetica', 'normal');
  [
    ['Total Amount', pdfMoney(total)],
    ['Total Paid', pdfMoney(paid)],
    ['Outstanding Balance', pdfMoney(outstanding)],
  ].forEach(([k, v]) => { doc.text(k + ':', M, y); doc.text(v, M + 48, y); y += 5.5; });
  y += 5;

  doc.text(doc.splitTextToSize(`Thank you for choosing ${COMPANY.name}. We look forward to making your journey memorable.`, W - 2 * M), M, y);
  y += 16;

  if (y > 240) { doc.addPage(); y = 24; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0);
  doc.text('Authorized Signatory', W - M, y, { align: 'right' }); y += 5;
  doc.setFont('helvetica', 'normal'); doc.text(COMPANY.name, W - M, y, { align: 'right' }); y += 5;
  doc.setTextColor(120); doc.setFontSize(8);
  doc.text('Seal & Signature', W - M, y, { align: 'right' });

  /* ---- footer (company block + disclaimer), pinned near the page bottom ---- */
  let fy = H - 24;
  doc.setDrawColor(200); doc.line(M, fy, W - M, fy); fy += 5;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(30);
  doc.text(COMPANY.name, W / 2, fy, { align: 'center' }); fy += 4;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(110);
  doc.text(COMPANY.tagline, W / 2, fy, { align: 'center' }); fy += 3.6;
  doc.text(contactLine, W / 2, fy, { align: 'center' }); fy += 4.2;
  doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); doc.setTextColor(130);
  doc.text('This is a computer-generated receipt and does not require a physical signature unless otherwise specified.', W / 2, fy, { align: 'center' });

  doc.save(`Receipt_${String(enquiryId).replace(/[^\w-]/g, '')}.pdf`);
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
    onReceipt: (rows, id) => generateReceipt(rows, id),
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
