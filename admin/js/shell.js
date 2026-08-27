/**
 * shell.js
 * The app shell for portal.html:
 *   - App     : auth guard, sidebar + routing, per-view activate hooks, topbar
 *   - Data    : a tiny per-sheet cache shared by every module
 *   - Form    : the shared add/edit modal (#modalBackdrop) driver
 *   - Profile : the Profile view (mobile / email / password)
 *   - makeSheetModule() : builds a config-driven "table + search + sort +
 *     pagination + export + add/edit/delete" module. Enquiries, Suppliers,
 *     Bookings and Payments are all thin wrappers over this factory.
 */

/* ============================ App ============================ */
const App = (() => {
  const titles = {
    dashboard: ['Dashboard', 'Overview across every sheet'],
    enquiries: ['Enquiries', 'Traveller enquiries from the website and phone'],
    suppliers: ['Suppliers', 'Local partners, DMCs and vendors by region'],
    bookings: ['Bookings', 'Confirmed trips and their payment status'],
    payments: ['Payments', 'Money received against each booking'],
    reports: ['Reports', 'Filter and export across enquiries, bookings & payments'],
    profile: ['Profile', 'Your contact details and password']
  };
  const hooks = {};
  let current = 'dashboard';

  const onView = (name, fn) => { hooks[name] = fn; };
  const currentView = () => current;

  function show(name) {
    current = name;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + name)?.classList.add('active');
    document.querySelectorAll('.nav-item[data-view]').forEach(el =>
      el.classList.toggle('active', el.dataset.view === name));
    const [t, s] = titles[name] || ['', ''];
    document.getElementById('pageTitle').textContent = t;
    document.getElementById('pageSubtitle').textContent = s;
    closeSidebar();
    if (hooks[name]) hooks[name]();
  }

  const sidebar = () => document.getElementById('sidebar');
  const scrim = () => document.getElementById('sidebarScrim');
  function closeSidebar() { sidebar().classList.remove('open'); scrim().classList.remove('open'); }

  function wireShell() {
    document.querySelectorAll('.nav-item[data-view]').forEach(el =>
      el.addEventListener('click', () => show(el.dataset.view)));

    document.getElementById('sidebarToggle').addEventListener('click', () => {
      sidebar().classList.add('open'); scrim().classList.add('open');
    });
    scrim().addEventListener('click', closeSidebar);

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      const ok = await Utils.confirmDialog({ title: 'Log out?', text: 'You will need to log in again to reach the portal.', confirmText: 'Log out', danger: true });
      if (ok) Auth.logout();
    });

    const user = Auth.getUser();
    document.getElementById('userName').textContent = user?.username || '';
    document.getElementById('userAvatar').textContent = (user?.username || 'A').charAt(0).toUpperCase();

    // Bounce back to the login page if this page is restored from the bfcache
    // (e.g. user hit "Home page" then pressed Back) with no live session.
    window.addEventListener('pageshow', (e) => {
      if (e.persisted && !Auth.isLoggedIn()) location.replace('index.html');
    });
  }

  return { onView, currentView, show, wireShell };
})();

/* ============================ Data cache ============================ */
const Data = (() => {
  const cache = {};
  let bootStats = null;           // dashboard stats from the last bootstrap
  const SWR_KEY = 'vih_admin_boot';

  async function fetch(key, force) {
    if (cache[key] && !force) return cache[key];
    cache[key] = await Api.getSheet(key);
    bootStats = null; // a targeted refetch means the dashboard snapshot is now stale
    return cache[key];
  }

  /** Fill every sheet's cache (+ stats) from one bootstrap payload. */
  function prime(payload) {
    if (!payload || !payload.sheets) return;
    Object.keys(payload.sheets).forEach(k => { cache[k] = payload.sheets[k]; });
    bootStats = payload.stats || null;
  }

  /** One round trip: prime all sheets + stats. Persists a copy for instant next load. */
  async function bootstrap() {
    const payload = await Api.bootstrap();
    prime(payload);
    try { sessionStorage.setItem(SWR_KEY, JSON.stringify(payload)); } catch {}
    return payload;
  }

  /** Last bootstrap payload from this tab session, if any (for stale-while-revalidate). */
  function cachedBootstrap() {
    try {
      const raw = sessionStorage.getItem(SWR_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  const invalidate = (...keys) => {
    (keys.length ? keys : Object.keys(cache)).forEach(k => delete cache[k]);
    if (!keys.length) { bootStats = null; try { sessionStorage.removeItem(SWR_KEY); } catch {} }
  };
  const peek = (key) => cache[key];
  const stats = () => bootStats;

  return { fetch, prime, bootstrap, cachedBootstrap, invalidate, peek, stats };
})();

/* ============================ Shared form modal ============================ */
const Form = (() => {
  const backdrop = () => document.getElementById('modalBackdrop');
  let onSave = null;

  function close() { backdrop().classList.remove('visible'); onSave = null; }

  /**
   * fields: [{ key, label, type?, options?, required?, readonly?, hint?, placeholder? }]
   *   type: text | email | tel | number | date | daterange | select | textarea
   * values: current values keyed by field key
   * save(values) may return a promise; the Save button shows "Saving…" until it settles.
   */
  function open({ title, fields, values = {}, save }) {
    document.getElementById('modalTitle').textContent = title;
    const host = document.getElementById('modalFields');
    host.innerHTML = fields.map(f => fieldHtml(f, values[f.key])).join('');
    wireDateRanges(host);
    onSave = save;
    backdrop().classList.add('visible');
    const first = host.querySelector('input:not([readonly]),select,textarea');
    if (first) first.focus();
  }

  function fieldHtml(f, val) {
    val = val == null ? '' : val;
    const full = ['textarea', 'daterange'].includes(f.type) || f.full ? ' full' : '';
    const req = f.required ? ' <span class="req">*</span>' : '';
    const hint = f.hint ? `<div class="hint">${Utils.escapeHtml(f.hint)}</div>` : '';
    let control;
    if (f.type === 'select') {
      control = `<select data-field="${Utils.escapeAttr(f.key)}" ${f.readonly ? 'disabled' : ''}>
        ${(f.options || []).map(o => `<option ${String(o) === String(val) ? 'selected' : ''}>${Utils.escapeHtml(o)}</option>`).join('')}
      </select>`;
    } else if (f.type === 'textarea') {
      control = `<textarea data-field="${Utils.escapeAttr(f.key)}" ${f.readonly ? 'readonly' : ''}>${Utils.escapeHtml(val)}</textarea>`;
    } else if (f.type === 'daterange') {
      const [s, e] = Utils.parseDateRange(val);
      control = `
        <div class="date-range-labels"><span>Start</span><span>End</span></div>
        <div class="date-range-wrap">
          <input type="date" class="dr-start" value="${s || ''}" />
          <span class="date-range-sep">–</span>
          <input type="date" class="dr-end" value="${e || ''}" />
        </div>
        <input type="hidden" data-field="${Utils.escapeAttr(f.key)}" value="${Utils.escapeAttr(val)}" />`;
    } else if (f.type === 'picker') {
      control = `<input type="text" list="${f.list || ''}" data-field="${Utils.escapeAttr(f.key)}"
        value="${Utils.escapeAttr(val)}" placeholder="${Utils.escapeAttr(f.placeholder || '')}" autocomplete="off" />`;
    } else {
      control = `<input type="${f.type || 'text'}" data-field="${Utils.escapeAttr(f.key)}"
        value="${Utils.escapeAttr(val)}" placeholder="${Utils.escapeAttr(f.placeholder || '')}"
        ${f.readonly ? 'readonly' : ''} ${f.type === 'number' ? 'step="0.01"' : ''} />`;
    }
    return `<div class="field${full}"><label>${Utils.escapeHtml(f.label)}${req}</label>${control}${hint}</div>`;
  }

  function wireDateRanges(host) {
    host.querySelectorAll('.date-range-wrap').forEach(wrap => {
      const start = wrap.querySelector('.dr-start');
      const end = wrap.querySelector('.dr-end');
      const hidden = wrap.parentElement.querySelector('input[type="hidden"][data-field]');
      const sync = () => {
        if (start.value && end.value && end.value < start.value) {
          const t = start.value; start.value = end.value; end.value = t;
        }
        const s = start.value ? Utils.formatDateInput(start.value) : '';
        const e = end.value ? Utils.formatDateInput(end.value) : '';
        hidden.value = s && e ? `${s} – ${e}` : (s || e || '');
      };
      start.addEventListener('change', sync);
      end.addEventListener('change', sync);
    });
  }

  function readValues() {
    const out = {};
    document.querySelectorAll('#modalFields [data-field]').forEach(el => { out[el.dataset.field] = el.value; });
    return out;
  }

  function wire() {
    document.getElementById('modalCancel').addEventListener('click', close);
    backdrop().addEventListener('click', (e) => { if (e.target === backdrop()) close(); });
    document.getElementById('modalSave').addEventListener('click', async () => {
      if (!onSave) return;
      const btn = document.getElementById('modalSave');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        await onSave(readValues());
        close();
      } catch (err) {
        Utils.error(err.message || 'Could not save.');
      } finally {
        btn.disabled = false; btn.textContent = 'Save';
      }
    });
  }

  return { open, close, wire, fieldHtml };
})();

/* ============================ Config-driven sheet module ============================ */
function makeSheetModule(cfg) {
  const state = { page: 1, pageSize: 10, search: '', sortBy: cfg.defaultSort || 'Timestamp', sortDir: 'desc', badge: '' };
  const root = () => document.getElementById('view-' + cfg.key);

  const exportColumns = cfg.columns.map(c => ({ key: c.key, label: c.label }));

  function shell() {
    root().innerHTML = `
      <div class="card">
        <div class="toolbar">
          <div class="grp">
            <input type="search" id="${cfg.key}-search" placeholder="Search ${cfg.searchCols.join(', ').toLowerCase()}…" />
            ${cfg.badgeCol ? `<select id="${cfg.key}-badge"><option value="">All ${cfg.badgeCol.toLowerCase()}</option>${cfg.badgeOptions.map(o => `<option>${o}</option>`).join('')}</select>` : ''}
          </div>
          <div class="grp">
            <button class="btn sm" data-x="csv">CSV</button>
            <button class="btn sm" data-x="xlsx">Excel</button>
            <button class="btn sm" data-x="pdf">PDF</button>
            <button class="btn primary" data-x="add">+ Add ${cfg.singular}</button>
          </div>
        </div>
        ${cfg.badgeCol ? `<div class="stat-pills" id="${cfg.key}-pills"></div>` : ''}
        <div class="table-wrap" id="${cfg.key}-tw"><div class="loading">Loading…</div></div>
        <div class="pagination-bar" id="${cfg.key}-pg"></div>
      </div>`;

    root().querySelector('[data-x="add"]').addEventListener('click', () => openForm(null));
    root().querySelector('[data-x="csv"]').addEventListener('click', () => Utils.exportCSV(filtered(), exportColumns, cfg.key));
    root().querySelector('[data-x="xlsx"]').addEventListener('click', () => Utils.exportExcel(filtered(), exportColumns, cfg.key));
    root().querySelector('[data-x="pdf"]').addEventListener('click', () => Utils.exportPDF(filtered(), exportColumns, cfg.key, cfg.title));
    root().querySelector('#' + cfg.key + '-search').addEventListener('input', Utils.debounce((e) => {
      state.search = e.target.value; state.page = 1; render();
    }));
    const badge = root().querySelector('#' + cfg.key + '-badge');
    if (badge) badge.addEventListener('change', (e) => { state.badge = e.target.value; state.page = 1; render(); });
  }

  let rows = [];

  async function load(force) {
    if (!root().querySelector('.toolbar')) shell();
    const tw = root().querySelector('#' + cfg.key + '-tw');
    tw.innerHTML = '<div class="loading">Loading…</div>';
    try {
      const data = await Data.fetch(cfg.key, force);
      rows = data.rows || [];
      render();
    } catch (err) {
      tw.innerHTML = `<div class="error-msg">Couldn't load ${cfg.title}. ${Utils.escapeHtml(err.message || '')}</div>`;
    }
  }

  function filtered() {
    let out = rows.slice();
    if (cfg.badgeCol && state.badge) out = out.filter(r => r[cfg.badgeCol] === state.badge);
    const q = state.search.trim().toLowerCase();
    if (q) out = out.filter(r => cfg.searchCols.map(c => String(r[c] || '')).join(' ').toLowerCase().includes(q));
    out.sort((a, b) => {
      const cmp = Utils.compareValues(a[state.sortBy], b[state.sortBy]);
      return state.sortDir === 'asc' ? cmp : -cmp;
    });
    return out;
  }

  function render() {
    if (App.currentView() !== cfg.key) return;
    const all = filtered();
    const tw = root().querySelector('#' + cfg.key + '-tw');

    if (cfg.badgeCol) {
      const pills = root().querySelector('#' + cfg.key + '-pills');
      const counts = {};
      cfg.badgeOptions.forEach(o => counts[o] = 0);
      rows.forEach(r => { if (counts[r[cfg.badgeCol]] != null) counts[r[cfg.badgeCol]]++; });
      pills.innerHTML = `<div class="stat-pill"><b>${rows.length}</b> total</div>` +
        cfg.badgeOptions.map(o => `<div class="stat-pill"><b>${counts[o]}</b> ${o.toLowerCase()}</div>`).join('');
    }

    if (!all.length) {
      tw.innerHTML = '<div class="empty">No entries match.</div>';
      root().querySelector('#' + cfg.key + '-pg').innerHTML = '';
      return;
    }

    const { pageRows, meta } = Utils.paginate(all, state.page, state.pageSize);
    state.page = meta.page;

    const thead = cfg.columns.map(c => `<th data-sort="${Utils.escapeAttr(c.key)}">${Utils.escapeHtml(c.label)}</th>`).join('') + '<th>Actions</th>';
    const body = pageRows.map(r => {
      const tds = cfg.columns.map(c => {
        let v = r[c.key];
        if (c.type === 'date') v = Utils.formatDate(v);
        else if (c.type === 'date-dmy') v = Utils.formatDateDMY(v);
        else if (c.type === 'datetime') v = Utils.formatDateTime(v);
        else if (c.type === 'currency') v = Utils.formatCurrency(v);
        else if (c.type === 'currency-pending') {
          const n = Number(r[c.key]) || 0;
          v = `<span style="color:${n > 0 ? 'var(--red)' : 'var(--jade)'};font-weight:600">${Utils.formatCurrency(n)}</span>`;
        }
        else v = Utils.escapeHtml(v);
        if (c.key === cfg.badgeCol) v = `<span class="badge ${Utils.escapeAttr(String(r[c.key]).split(' ')[0])}">${Utils.escapeHtml(r[c.key])}</span>`;
        const cls = [c.primary ? 'primary-col' : '', c.cls || ''].filter(Boolean).join(' ');
        return `<td${cls ? ` class="${cls}"` : ''}>${v}</td>`;
      }).join('');
      return `<tr>
        ${tds}
        <td class="actions">
          <button class="btn sm" data-edit="${r.rowIndex}">Edit</button>
          ${Auth.getUser()?.canDelete ? `<button class="btn sm danger" data-del="${r.rowIndex}">Delete</button>` : ''}
        </td>
      </tr>`;
    }).join('');

    tw.innerHTML = `<table class="data-table"><thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table>`;

    Utils.wireSortableHeaders(tw.querySelector('table'), state, (field, dir) => {
      state.sortBy = field; state.sortDir = dir; render();
    });
    Utils.renderPagination(root().querySelector('#' + cfg.key + '-pg'), meta, (p) => { state.page = p; render(); });

    tw.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openForm(Number(b.dataset.edit))));
    tw.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => del(Number(b.dataset.del))));
  }

  function openForm(rowIndex) {
    const row = rowIndex ? rows.find(r => r.rowIndex === rowIndex) : null;
    const values = {};
    (cfg.formFields).forEach(f => { values[f.key] = row ? (row[f.key] || '') : (f.default || ''); });

    if (cfg.enquiryPicker) ensureEnquiryIds();

    Form.open({
      title: (row ? 'Edit ' : 'Add ') + cfg.singular,
      fields: cfg.formFields,
      values,
      save: async (vals) => {
        if (cfg.validate) {
          const msg = cfg.validate(vals);
          if (msg) throw new Error(msg);
        }
        if (row) await Api.update(cfg.key, rowIndex, vals);
        else await Api.create(cfg.key, vals);
        Utils.success(cfg.singular + (row ? ' updated.' : ' added.'));
        await load(true);
      }
    });

    if (cfg.enquiryPicker) wireEnquiryPicker();
    if (cfg.onFormOpen) cfg.onFormOpen({ rows, row, rowIndex });
  }

  async function del(rowIndex) {
    if (!Auth.getUser()?.canDelete) return;
    const row = rows.find(r => r.rowIndex === rowIndex);
    const label = (row && (row[cfg.primaryKey] || row[cfg.columns[0].key])) || 'this entry';
    const ok = await Utils.confirmDialog({ title: 'Delete entry?', text: `Delete "${label}"? This cannot be undone.`, confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await Api.remove(cfg.key, rowIndex);
      Utils.success('Deleted.');
      await load(true);
    } catch (err) { Utils.error(err.message); }
  }

  return { load, get state() { return state; } };
}

/* Fills #enquiryIdList so Bookings / Payments can pick an existing Enquiry ID. */
async function ensureEnquiryIds() {
  try {
    const { rows } = await Data.fetch('enquiries');
    document.getElementById('enquiryIdList').innerHTML = rows
      .map(r => r['Enquiry ID']).filter(Boolean)
      .map(id => `<option value="${Utils.escapeAttr(id)}"></option>`).join('');
  } catch { /* the field still works as a plain input */ }
}

/* Live search-select for the Enquiry ID field in the Bookings / Payments modal. */
function wireEnquiryPicker() {
  const input = document.querySelector('#modalFields [data-field="Enquiry ID"]');
  if (!input) return;
  const customerInput = document.querySelector('#modalFields [data-field="Customer"]');
  const wrap = input.closest('.field');
  wrap.classList.add('picker-wrap');

  const show = Utils.debounce(async () => {
    const q = input.value.trim().toLowerCase();
    wrap.querySelector('.picker-results')?.remove();
    if (!q) return;
    let rows = [];
    try { rows = (await Data.fetch('enquiries')).rows; } catch { return; }
    const matches = rows.filter(r =>
      ['Enquiry ID', 'Name', 'Phone', 'Email', 'Destination'].some(k => String(r[k] || '').toLowerCase().includes(q))
    ).slice(0, 8);
    const box = document.createElement('div');
    box.className = 'picker-results';
    box.innerHTML = matches.length
      ? matches.map(r => `<button type="button" data-id="${Utils.escapeAttr(r['Enquiry ID'])}" data-name="${Utils.escapeAttr(r['Name'] || '')}">
          <b>${Utils.escapeHtml(r['Enquiry ID'])}</b> — ${Utils.escapeHtml(r['Name'] || '')} <span style="color:var(--ink-soft)">${Utils.escapeHtml(r['Destination'] || '')}</span>
        </button>`).join('')
      : '<div class="muted">No matching enquiry</div>';
    wrap.appendChild(box);
    box.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () => {
      input.value = b.dataset.id;
      // 'change' (not 'input') so this doesn't retrigger the search dropdown,
      // but downstream listeners (e.g. Payments' running-balance) still react.
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (customerInput && !customerInput.value) {
        customerInput.value = b.dataset.name;
        customerInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      box.remove();
    }));
  });

  input.addEventListener('input', show);
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) wrap.querySelector('.picker-results')?.remove();
  }, { capture: true });
}

/* ============================ Profile ============================ */
const Profile = (() => {
  function render() {
    const u = Auth.getUser();
    const root = document.getElementById('view-profile');
    root.innerHTML = `
      <div class="card" style="max-width:520px;">
        <div class="section-title">Account</div>
        <div class="section-sub">Update your contact details or change your password.</div>
        <div class="form-grid">
          <div class="field"><label>Username</label><input type="text" value="${Utils.escapeAttr(u.username)}" readonly /></div>
          <div class="field"><label>Mobile</label><input type="tel" id="pf-mobile" value="${Utils.escapeAttr(u.mobile || '')}" placeholder="98765 43210" /></div>
          <div class="field full"><label>Email</label><input type="email" id="pf-email" value="${Utils.escapeAttr(u.email || '')}" placeholder="you@example.com" /></div>
        </div>
        <div class="section-title" style="margin-top:22px;">Change password</div>
        <div class="form-grid">
          <div class="field full"><label>Current password</label><input type="password" id="pf-cur" autocomplete="off" /></div>
          <div class="field"><label>New password</label><input type="password" id="pf-new" autocomplete="off" /></div>
          <div class="field"><label>Confirm new</label><input type="password" id="pf-cnf" autocomplete="off" /></div>
        </div>
        <div id="pf-msg" style="font-size:13px;margin-top:10px;min-height:18px;"></div>
        <div class="modal-actions" style="justify-content:flex-start;">
          <button class="btn primary" id="pf-save">Save changes</button>
        </div>
      </div>`;
    document.getElementById('pf-save').addEventListener('click', save);
  }

  async function save() {
    const msg = document.getElementById('pf-msg');
    const btn = document.getElementById('pf-save');
    const mobile = document.getElementById('pf-mobile').value.trim();
    const email = document.getElementById('pf-email').value.trim();
    const cur = document.getElementById('pf-cur').value;
    const nw = document.getElementById('pf-new').value;
    const cnf = document.getElementById('pf-cnf').value;
    const set = (t, ok) => { msg.style.color = ok ? 'var(--jade)' : 'var(--red)'; msg.textContent = t; };

    if (email && !Utils.isValidEmail(email)) return set('Enter a valid email address.');
    const values = { mobile, email };
    if (cur || nw || cnf) {
      if (!nw || nw.length < 6) return set('New password must be at least 6 characters.');
      if (nw !== cnf) return set('New password and confirmation do not match.');
      values.currentPassword = cur;
      values.password = nw;
    }

    btn.disabled = true;
    try {
      const res = await Api.updateProfile(values);
      const user = res.user || res;
      Auth.patchSession({ mobile: user.mobile || mobile, email: user.email || email });
      set('Saved.', true);
      ['pf-cur', 'pf-new', 'pf-cnf'].forEach(id => document.getElementById(id).value = '');
    } catch (err) {
      set(err.message || 'Could not save.');
    } finally {
      btn.disabled = false;
    }
  }

  return { render };
})();

/* ============================ boot ============================ */
document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.guardPage()) return;
  Auth.watchExpiry();
  App.wireShell();
  Form.wire();
  App.onView('profile', Profile.render);

  // Stale-while-revalidate: if this tab already bootstrapped once, paint the
  // dashboard from that snapshot immediately, then refresh in the background.
  const cached = Data.cachedBootstrap();
  if (cached) {
    Data.prime(cached);
    App.show('dashboard');
    // Refresh in the background, then repaint whichever view is open.
    Data.bootstrap().then(() => App.show(App.currentView())).catch(() => {});
    return;
  }

  // First load: one round trip for everything, behind a spinner.
  Utils.showLoading();
  try {
    await Data.bootstrap();
  } catch (err) {
    Utils.error(err.message || 'Could not load the portal.');
  } finally {
    Utils.hideLoading();
  }
  App.show('dashboard');
});
