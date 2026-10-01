/**
 * account.js — Account Statement page.
 * A ledger computed from other sheets — no balance is ever typed in:
 *   credit  Profit        from Supplier Payments, once the enquiry is fully paid
 *                         (Payments for that Enquiry ID add up to its Total Amount)
 *   credit  Investment    partner_transactions, type Investment
 *   debit   Expense       Expenses
 *   debit   Withdrawal    partner_transactions, type Withdrawal
 * Balance = credits − debits. Profit on trips that are not fully paid yet is
 * shown as "Pending profit" and kept out of the balance. Investments and
 * withdrawals are added here; expenses live on the Expenses page.
 */

const Account = (() => {
  const root = () => document.getElementById('view-account');
  const esc = (v) => Utils.escapeHtml(v);
  const money = (n) => Utils.formatCurrency(n);
  const round2 = (n) => Math.round(n * 100) / 100;
  const state = { from: '', to: '', partner: '', ledger: [], partners: [], summary: null };

  const COLS = [
    { key: 'dateText', label: 'Date' },
    { key: 'kind', label: 'Type' },
    { key: 'desc', label: 'Description' },
    { key: 'creditText', label: 'Credit' },
    { key: 'debitText', label: 'Debit' },
    { key: 'balanceText', label: 'Balance' }
  ];

  function shell() {
    root().innerHTML = `
      <div class="stat-grid" id="acc-stats"></div>
      <div class="card">
        <div class="toolbar">
          <div class="grp">
            <label class="muted" style="font-size:13px">From <input type="date" id="acc-from" /></label>
            <label class="muted" style="font-size:13px">To <input type="date" id="acc-to" /></label>
            <select id="acc-partner"><option value="">All partners</option></select>
            <button class="btn sm" id="acc-reset">Reset</button>
          </div>
          <div class="grp">
            <button class="btn sm" data-x="csv">CSV</button>
            <button class="btn sm" data-x="xlsx">Excel</button>
            <button class="btn sm" data-x="pdf">PDF</button>
            <button class="btn primary" id="acc-invest">+ Add Investment</button>
            <button class="btn" id="acc-withdraw">+ Add Withdrawal</button>
          </div>
        </div>
        <div class="table-wrap" id="acc-tw"><div class="loading">Loading…</div></div>
      </div>
      <div class="card">
        <div class="section-title">By partner</div>
        <div class="section-sub">Net contribution = invested + expenses paid out of pocket − withdrawn.</div>
        <div class="table-wrap" id="acc-partners"></div>
      </div>`;

    root().querySelector('#acc-from').addEventListener('change', (e) => { state.from = e.target.value; draw(); });
    root().querySelector('#acc-to').addEventListener('change', (e) => { state.to = e.target.value; draw(); });
    root().querySelector('#acc-partner').addEventListener('change', (e) => { state.partner = e.target.value; draw(); });
    root().querySelector('#acc-reset').addEventListener('click', () => {
      state.from = state.to = state.partner = '';
      root().querySelector('#acc-from').value = '';
      root().querySelector('#acc-to').value = '';
      draw();
    });
    root().querySelector('#acc-invest').addEventListener('click', () => openTxn('Investment'));
    root().querySelector('#acc-withdraw').addEventListener('click', () => openTxn('Withdrawal'));
    root().querySelector('[data-x="csv"]').addEventListener('click', () => Utils.exportCSV(visibleRows(), COLS, 'account-statement'));
    root().querySelector('[data-x="xlsx"]').addEventListener('click', () => Utils.exportExcel(visibleRows(), COLS, 'account-statement'));
    root().querySelector('[data-x="pdf"]').addEventListener('click', () => Utils.exportPDF(visibleRows(), COLS, 'account-statement', 'Account Statement'));
  }

  async function load() {
    if (!root().firstElementChild) shell();
    try {
      const get = async (k) => (await Data.fetch(k, true)).rows;
      const [sup, pay, exp, ptx] = await Promise.all(['supplier_ments', 'payments', 'expenses', 'partner_transactions'].map(get));
      build(sup, pay, exp, ptx);
      draw();
    } catch (err) {
      root().querySelector('#acc-tw').innerHTML = `<div class="empty">${esc(err.message || 'Could not load the statement.')}</div>`;
    }
  }

  function build(sup, pay, exp, ptx) {
    const paid = {}, lastPaid = {};
    pay.forEach((p) => {
      const id = String(p['Enquiry ID'] || '').trim();
      if (!id) return;
      paid[id] = (paid[id] || 0) + (Number(p['Amount Paid']) || 0);
      const d = String(p['Timestamp'] || '').slice(0, 10);
      if (d > (lastPaid[id] || '')) lastPaid[id] = d;
    });

    const ledger = [];
    let pending = 0;
    sup.forEach((r) => {
      const id = String(r['Enquiry ID'] || '').trim();
      const profit = Number(r['Profit']) || 0;
      const total = Number(r['Total Amount']) || 0;
      const settled = total > 0 && (paid[id] || 0) >= total - 0.005;
      if (!settled) { pending += profit; return; }
      const label = `Profit — ${r['Customer Name'] || id} (${id})`;
      const date = lastPaid[id] || String(r['Created Date'] || '').slice(0, 10);
      ledger.push(profit >= 0
        ? { date, kind: 'Profit', desc: label, credit: profit, debit: 0 }
        : { date, kind: 'Loss', desc: label, credit: 0, debit: -profit });
    });
    ptx.forEach((r) => {
      const amt = Number(r['Amount']) || 0;
      const inv = r['Type'] === 'Investment';
      ledger.push({
        date: r['Date'], kind: r['Type'], partner: r['Partner'], rowIndex: r.rowIndex, txn: true, raw: r,
        desc: `${inv ? 'Investment by' : 'Withdrawal by'} ${r['Partner']}${r['Notes'] ? ' — ' + r['Notes'] : ''}`,
        credit: inv ? amt : 0, debit: inv ? 0 : amt
      });
    });
    exp.forEach((r) => {
      ledger.push({
        date: r['Expense Date'], kind: 'Expense', partner: r['Paid By'],
        desc: `${r['Category'] ? r['Category'] + ': ' : ''}${r['Description']}${r['Paid By'] ? ' (paid by ' + r['Paid By'] + ')' : ''}`,
        credit: 0, debit: Number(r['Amount']) || 0
      });
    });

    const order = { Investment: 0, Profit: 1, Loss: 2, Expense: 3, Withdrawal: 4 };
    ledger.sort((a, b) => String(a.date).localeCompare(String(b.date)) || (order[a.kind] - order[b.kind]));
    let bal = 0;
    ledger.forEach((e) => { bal = round2(bal + e.credit - e.debit); e.balance = bal; });

    const sum = (kind) => round2(ledger.filter((e) => e.kind === kind).reduce((s, e) => s + e.credit + e.debit, 0));
    const partners = {};
    const who = (n) => String(n || '').trim();
    const P = (n) => (partners[who(n).toLowerCase()] = partners[who(n).toLowerCase()] || { name: who(n), inv: 0, wd: 0, exp: 0 });
    ptx.forEach((r) => {
      const p = P(r['Partner']);
      const a = Number(r['Amount']) || 0;
      if (r['Type'] === 'Investment') p.inv += a; else p.wd += a;
    });
    exp.forEach((r) => {
      const n = who(r['Paid By']);
      if (n && n.toLowerCase() !== 'business') P(n).exp += Number(r['Amount']) || 0;
    });

    state.ledger = ledger;
    state.partners = Object.values(partners).filter((p) => p.name);
    state.summary = {
      balance: bal,
      profit: round2(sum('Profit') - sum('Loss')),
      invested: sum('Investment'),
      expenses: sum('Expense'),
      withdrawn: sum('Withdrawal'),
      pending: round2(pending)
    };
  }

  function visibleRows() {
    return state.ledger.filter((e) => {
      if (state.from && String(e.date) < state.from) return false;
      if (state.to && String(e.date) > state.to) return false;
      if (state.partner && String(e.partner || '').trim().toLowerCase() !== state.partner.toLowerCase()) return false;
      return true;
    }).map((e) => Object.assign({}, e, {
      dateText: Utils.formatDateDMY(e.date),
      creditText: e.credit ? money(e.credit) : '',
      debitText: e.debit ? money(e.debit) : '',
      balanceText: money(e.balance)
    }));
  }

  function draw() {
    if (App.currentView() !== 'account' || !state.summary) return;
    const s = state.summary;
    const cards = [
      ['🏦', 'My balance', s.balance, '#2A5C45'],
      ['📈', 'Profit earned', s.profit, '#B8913F'],
      ['💰', 'Invested', s.invested, '#2A6F97'],
      ['🧾', 'Expenses', s.expenses, '#B5532F'],
      ['↗', 'Withdrawn', s.withdrawn, '#8b8478'],
      ['⏳', 'Pending profit', s.pending, '#8b8478']
    ];
    root().querySelector('#acc-stats').innerHTML = cards.map(([ic, label, v, color]) =>
      `<div class="stat-card" style="--sc:${color}"><span class="ic">${ic}</span><div class="num">${money(v)}</div><div class="label">${label}</div></div>`).join('');

    const sel = root().querySelector('#acc-partner');
    sel.innerHTML = '<option value="">All partners</option>' +
      state.partners.map((p) => `<option ${p.name === state.partner ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

    const me = Auth.getUser() || {};
    const rows = visibleRows();
    const tw = root().querySelector('#acc-tw');
    if (!rows.length) {
      tw.innerHTML = '<div class="empty">No entries yet. Add an investment, or record expenses and supplier payments.</div>';
    } else {
      const showActions = !!me.canEdit || !!me.canDelete;
      tw.innerHTML = `<table class="data-table"><thead><tr>${COLS.map((c) => `<th>${c.label}</th>`).join('')}${showActions ? '<th>Actions</th>' : ''}</tr></thead><tbody>${
        rows.slice().reverse().map((e) => `<tr>
          <td>${esc(e.dateText)}</td>
          <td><span class="badge ${e.credit ? 'Paid' : 'Closed'}">${esc(e.kind)}</span></td>
          <td>${esc(e.desc)}</td>
          <td style="color:var(--jade);font-weight:600">${esc(e.creditText)}</td>
          <td style="color:var(--red);font-weight:600">${esc(e.debitText)}</td>
          <td><b>${esc(e.balanceText)}</b></td>
          ${showActions ? `<td class="actions">${e.txn
            ? `${me.canEdit ? `<button class="btn sm" data-edit="${e.rowIndex}">Edit</button>` : ''}${me.canDelete ? `<button class="btn sm danger" data-del="${e.rowIndex}">Delete</button>` : ''}`
            : ''}</td>` : ''}
        </tr>`).join('')}</tbody></table>`;
      tw.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openTxn(null, Number(b.dataset.edit))));
      tw.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => del(Number(b.dataset.del))));
    }

    root().querySelector('#acc-partners').innerHTML = state.partners.length
      ? `<table class="data-table"><thead><tr><th>Partner</th><th>Invested</th><th>Expenses paid</th><th>Withdrawn</th><th>Net contribution</th></tr></thead><tbody>${
        state.partners.map((p) => `<tr><td class="primary-col">${esc(p.name)}</td><td>${money(p.inv)}</td><td>${money(p.exp)}</td><td>${money(p.wd)}</td><td><b>${money(p.inv + p.exp - p.wd)}</b></td></tr>`).join('')
      }</tbody></table>`
      : '<div class="empty">No partner activity yet.</div>';
  }

  function openTxn(type, rowIndex) {
    const row = rowIndex ? state.ledger.find((e) => e.txn && e.rowIndex === rowIndex) : null;
    const cur = row ? row.raw : {};
    const kind = type || cur['Type'];
    Form.open({
      title: (row ? 'Edit ' : 'Add ') + kind,
      fields: [
        { key: 'Date', label: 'Date', type: 'date', required: true },
        { key: 'Partner', label: 'Partner', type: 'select', options: PARTNERS, required: true },
        { key: 'Amount', label: 'Amount (₹)', type: 'number', required: true },
        { key: 'Notes', label: 'Notes', type: 'textarea' }
      ],
      values: { 'Date': cur['Date'] || Utils.todayISO(), 'Partner': cur['Partner'] || state.partner || '', 'Amount': cur['Amount'] || '', 'Notes': cur['Notes'] || '' },
      save: async (v) => {
        if (!v['Date']) throw new Error('Date is required.');
        if (!String(v['Partner']).trim()) throw new Error('Partner is required.');
        if (!(Number(v['Amount']) > 0)) throw new Error('Amount must be greater than zero.');
        const vals = Object.assign({}, v, { 'Type': kind });
        if (row) await Api.update('partner_transactions', rowIndex, vals);
        else await Api.create('partner_transactions', vals);
        Utils.success(kind + (row ? ' updated.' : ' added.'));
        await load();
      }
    });
  }

  async function del(rowIndex) {
    const ok = await Utils.confirmDialog({ title: 'Delete entry?', text: 'Delete this entry? This cannot be undone.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try { await Api.remove('partner_transactions', rowIndex); Utils.success('Deleted.'); await load(); }
    catch (err) { Utils.error(err.message); }
  }

  return { load };
})();

App.onView('account', () => Account.load());
