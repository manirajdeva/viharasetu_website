/**
 * utils.js
 * Shared helpers: brand-styled toasts + confirm dialog, a loading overlay,
 * formatting/validation, a pagination bar renderer, sortable-header wiring,
 * date-range helpers, and CSV / Excel / PDF export (via the xlsx and jsPDF
 * CDN libraries loaded in portal.html).
 */

const Utils = (() => {

  /* ---------------- Toasts ---------------- */
  function toast(kind, message) {
    let host = document.getElementById('toastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastHost';
      host.className = 'toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s ease';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }
  const success = (m) => toast('success', m);
  const error = (m) => toast('error', m || 'Something went wrong.');
  const info = (m) => toast('info', m);

  /* ---------------- Confirm dialog ---------------- */
  function confirmDialog({ title, text, confirmText = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop visible';
      backdrop.innerHTML = `
        <div class="modal" style="max-width:420px;">
          <h2>${escapeHtml(title)}</h2>
          <p style="color:var(--ink-soft);font-size:14px;margin:0 0 4px;">${escapeHtml(text)}</p>
          <div class="modal-actions">
            <button class="btn" data-act="cancel">Cancel</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${escapeHtml(confirmText)}</button>
          </div>
        </div>`;
      document.body.appendChild(backdrop);
      const done = (val) => { backdrop.remove(); resolve(val); };
      backdrop.querySelector('[data-act="cancel"]').onclick = () => done(false);
      backdrop.querySelector('[data-act="ok"]').onclick = () => done(true);
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(false); });
    });
  }

  /* ---------------- Loading overlay ---------------- */
  function showLoading() {
    let o = document.getElementById('loadingOverlay');
    if (!o) {
      o = document.createElement('div');
      o.id = 'loadingOverlay';
      o.className = 'loading-overlay';
      o.innerHTML = '<div class="spinner"></div>';
      document.body.appendChild(o);
    }
    o.style.display = 'flex';
  }
  function hideLoading() {
    const o = document.getElementById('loadingOverlay');
    if (o) o.style.display = 'none';
  }

  /* ---------------- Formatting ---------------- */
  function todayISO() { return new Date().toISOString().slice(0, 10); }

  function formatDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  // Numeric dd-mm-yyyy (no time), used by columns declared type:'date-dmy'.
  function formatDateDMY(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
  }
  function formatDateTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
  function formatCurrency(value) {
    const n = Number(value) || 0;
    return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function timeAgo(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    const s = Math.floor((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
    return formatDate(value);
  }

  function debounce(fn, delay = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  }

  /* ---------------- Validation ---------------- */
  const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());

  // Accepts a bare 10-digit Indian mobile (legacy rows) or a "+<country
  // code> <local number>" value from the phone field below. Mirrored
  // server-side in backend/src/phone.js.
  function isValidMobile(m) {
    const s = String(m || '').trim();
    const cc = /^\+(\d{1,4})\s*(.*)$/.exec(s);
    if (cc) {
      const local = cc[2].replace(/\s+/g, '');
      return cc[1] === '91' ? /^[6-9]\d{9}$/.test(local) : /^\d{6,14}$/.test(local);
    }
    return /^[6-9]\d{9}$/.test(s.replace(/\s+/g, ''));
  }

  /* ---------------- Phone field (country code + local number) ---------------- */
  const COUNTRY_CODES = [
    { code: '+91', label: 'India (+91)' },
    { code: '+1', label: 'USA/Canada (+1)' },
    { code: '+44', label: 'UK (+44)' },
    { code: '+61', label: 'Australia (+61)' },
    { code: '+65', label: 'Singapore (+65)' },
    { code: '+971', label: 'UAE (+971)' },
    { code: '+49', label: 'Germany (+49)' },
    { code: '+33', label: 'France (+33)' },
    { code: '+81', label: 'Japan (+81)' },
    { code: '+86', label: 'China (+86)' },
  ];

  /** Splits a stored phone value ("+91 8142980110" or a bare legacy number) into { cc, num }. */
  function splitPhone(value, defaultCc) {
    const s = String(value == null ? '' : value).trim();
    const m = /^\+(\d{1,4})\s*(.*)$/.exec(s);
    if (m) return { cc: '+' + m[1], num: m[2] };
    return { cc: defaultCc || '+91', num: s };
  }

  function countryCodeOptions(selectedCc) {
    return COUNTRY_CODES.map(c => `<option value="${c.code}" ${c.code === selectedCc ? 'selected' : ''}>${escapeHtml(c.label)}</option>`).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  const escapeAttr = (s) => escapeHtml(s).replace(/'/g, '&#39;');

  /* ---------------- Pagination bar ---------------- */
  function renderPagination(container, { page, totalPages, total, pageSize }, onPage) {
    if (!container) return;
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(total, page * pageSize);

    const maxBtns = 5;
    let from = Math.max(1, page - Math.floor(maxBtns / 2));
    let to = Math.min(totalPages, from + maxBtns - 1);
    from = Math.max(1, to - maxBtns + 1);

    let btns = `<button data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>`;
    for (let p = from; p <= to; p++) {
      btns += `<button data-p="${p}" class="${p === page ? 'active' : ''}">${p}</button>`;
    }
    btns += `<button data-p="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>›</button>`;

    container.innerHTML = `
      <div>Showing <b>${start}-${end}</b> of <b>${total}</b></div>
      <div class="pages">${btns}</div>`;
    container.querySelectorAll('button[data-p]').forEach(b => {
      b.addEventListener('click', () => {
        const p = Number(b.dataset.p);
        if (p >= 1 && p <= totalPages) onPage(p);
      });
    });
  }

  /**
   * Slices a filtered/sorted array into the current page and returns
   * { pageRows, meta } — meta being the shape renderPagination() expects.
   */
  function paginate(rows, page, pageSize) {
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const startIdx = (safePage - 1) * pageSize;
    return {
      pageRows: rows.slice(startIdx, startIdx + pageSize),
      meta: { page: safePage, totalPages, total, pageSize }
    };
  }

  /** Wires clickable <th data-sort="Col"> headers; calls onSort(field, dir). */
  function wireSortableHeaders(table, current, onSort) {
    table.querySelectorAll('th[data-sort]').forEach(th => {
      th.classList.add('sortable');
      const field = th.dataset.sort;
      const sorted = field === current.sortBy;
      th.classList.toggle('sorted', sorted);
      let arw = th.querySelector('.arw');
      if (!arw) { arw = document.createElement('span'); arw.className = 'arw'; th.appendChild(arw); }
      arw.textContent = sorted ? (current.sortDir === 'asc' ? '▲' : '▼') : '↕';
      th.onclick = () => {
        const dir = (field === current.sortBy && current.sortDir === 'asc') ? 'desc' : 'asc';
        onSort(field, dir);
      };
    });
  }

  /** Generic comparator: numeric when both look numeric, date when both parse, else string. */
  function compareValues(a, b) {
    if (a == null) a = '';
    if (b == null) b = '';
    const na = Number(String(a).replace(/[₹,\s]/g, '')), nb = Number(String(b).replace(/[₹,\s]/g, ''));
    if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
    const da = Date.parse(a), db = Date.parse(b);
    if (!isNaN(da) && !isNaN(db)) return da - db;
    return String(a).localeCompare(String(b));
  }

  /* ---------------- Date range (Travel Dates style) ---------------- */
  function formatDateInput(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function parseDateRange(text) {
    if (!text) return [null, null];
    const toIso = (s) => {
      const d = new Date(s.trim());
      return isNaN(d.getTime()) ? null
        : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };
    const parts = text.split(/\s*[–—-]\s*/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) return [toIso(parts[0]), toIso(parts[parts.length - 1])];
    if (parts.length === 1) return [toIso(parts[0]), null];
    return [null, null];
  }

  /* ---------------- Export ---------------- */
  function exportCSV(rows, columns, filename) {
    const head = columns.map(c => `"${c.label}"`).join(',');
    const body = rows.map(r => columns.map(c => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','));
    downloadBlob([head, ...body].join('\r\n'), filename + '.csv', 'text/csv;charset=utf-8;');
  }
  function exportExcel(rows, columns, filename) {
    if (!window.XLSX) return error('Excel export library failed to load.');
    const data = rows.map(r => {
      const o = {};
      columns.forEach(c => { o[c.label] = r[c.key] ?? ''; });
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, filename + '.xlsx');
  }
  function exportPDF(rows, columns, filename, title) {
    const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFCtor) return error('PDF export library failed to load.');
    const doc = new jsPDFCtor({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });
    doc.setFontSize(14);
    doc.text(title || filename, 14, 16);
    doc.autoTable({
      startY: 22,
      head: [columns.map(c => c.label)],
      body: rows.map(r => columns.map(c => String(r[c.key] ?? ''))),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [187, 90, 52] }
    });
    doc.save(filename + '.pdf');
  }
  function downloadBlob(content, filename, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return {
    toast, success, error, info, confirmDialog, showLoading, hideLoading,
    todayISO, formatDate, formatDateDMY, formatDateTime, formatCurrency, timeAgo, debounce,
    isValidEmail, isValidMobile, escapeHtml, escapeAttr,
    COUNTRY_CODES, splitPhone, countryCodeOptions,
    renderPagination, paginate, wireSortableHeaders, compareValues,
    formatDateInput, parseDateRange,
    exportCSV, exportExcel, exportPDF
  };
})();
