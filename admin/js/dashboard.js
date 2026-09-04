/**
 * dashboard.js — Dashboard view.
 * A dropdown switches between two dashboards:
 *   • Bookings  — enquiry/supplier/booking stat cards, enquiries-by-month,
 *     enquiry status, recent activity.
 *   • Payments  — contracted value / collected / outstanding rolled up per
 *     enquiry from the Payments portal, collections-by-month, plans by status,
 *     collections by mode, and the plans still carrying a balance.
 * All figures come from the backend `dashboardStats` action (`stats.payments`
 * holds the payments block); the selected dashboard is remembered in
 * localStorage. Chart.js can't size a canvas in a hidden box, so each
 * dashboard's charts are (re)drawn when it becomes visible.
 */

const Dashboard = (() => {
  let charts = {};
  let lastStats = null;   // most recent stats payload, for redraws on view switch

  const BRAND = ['#BB5A34', '#B8913F', '#2A5C45', '#2A6F97', '#8b8478', '#9C4826'];

  const statCards = [
    { key: 'totalEnquiries', label: 'Total Enquiries', ic: '✉', color: '#BB5A34' },
    { key: 'newEnquiries', label: 'New Enquiries', ic: '🆕', color: '#9C4826' },
    { key: 'enquiriesThisMonth', label: 'This Month', ic: '📅', color: '#B8913F' },
    { key: 'suppliers', label: 'Suppliers', ic: '🤝', color: '#2A5C45' },
    { key: 'totalBookings', label: 'Bookings', ic: '🧳', color: '#B8913F' },
    { key: 'bookingsValue', label: 'Booking Value', ic: '₹', color: '#2A5C45', currency: true },
    { key: 'paymentsReceived', label: 'Payments Received', ic: '💳', color: '#2A6F97', currency: true },
    { key: 'outstanding', label: 'Outstanding', ic: '⏳', color: '#b3261e', currency: true }
  ];

  // Payments section — every figure is rolled up from the Payments portal,
  // grouped per enquiry (Total Amount is the contracted trip cost, Amount Paid
  // is what's collected against it).
  const payCards = [
    { key: 'contractedValue', label: 'Contracted Value', ic: '📄', color: '#2A5C45', currency: true },
    { key: 'collected', label: 'Collected', ic: '💳', color: '#2A6F97', currency: true },
    { key: 'outstanding', label: 'Outstanding', ic: '⏳', color: '#b3261e', currency: true },
    { key: 'collectionRate', label: 'Collection Rate', ic: '📈', color: '#B8913F', pct: true },
    { key: 'plans', label: 'Payment Plans', ic: '🧾', color: '#8b8478' },
    { key: 'fullyPaid', label: 'Fully Paid', ic: '✅', color: '#2A5C45' },
    { key: 'partPaid', label: 'Part Paid', ic: '◐', color: '#9C4826' },
    { key: 'avgPlanValue', label: 'Avg Plan Value', ic: '∑', color: '#2A6F97', currency: true }
  ];

  const DASHES = ['bookings', 'payments'];

  function shell() {
    document.getElementById('view-dashboard').innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <select id="dash-switch" style="padding:9px 16px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-family:inherit;font-size:13.5px;font-weight:600;cursor:pointer;">
          <option value="bookings">Bookings dashboard</option>
          <option value="payments">Payments dashboard</option>
        </select>
        <button class="btn" id="dash-refresh">↻ Refresh</button>
      </div>

      <div id="dash-view-bookings">
        <div class="stat-grid" id="dash-stats"></div>
        <div class="chart-grid two">
          <div class="card chart-card"><div class="section-title">Enquiries — last 6 months</div><canvas id="chart-enq"></canvas></div>
          <div class="card chart-card"><div class="section-title">Enquiry status</div><canvas id="chart-status"></canvas></div>
        </div>
        <div class="card"><div class="section-title">Recent activity</div><div class="section-sub">Latest updates across the portal</div><div class="activity-list" id="dash-recent"></div></div>
      </div>

      <div id="dash-view-payments" hidden>
        <div class="section-sub" style="margin-bottom:16px;">From the payments portal — contracted trip value, what's collected and what's still due</div>
        <div class="stat-grid" id="dash-pay-stats"></div>
        <div class="chart-grid two">
          <div class="card chart-card"><div class="section-title">Collections — last 6 months</div><canvas id="chart-pay"></canvas></div>
          <div class="card chart-card"><div class="section-title">Payment plans by status</div><canvas id="chart-payplan"></canvas></div>
        </div>
        <div class="chart-grid two">
          <div class="card chart-card"><div class="section-title">Collected by payment mode</div><canvas id="chart-paymode"></canvas></div>
          <div class="card"><div class="section-title">Not-yet-collected</div><div class="section-sub">Payment plans with a balance still due</div><div class="activity-list" id="dash-pay-due"></div></div>
        </div>
      </div>`;

    let cur = 'bookings';
    try { const v = localStorage.getItem('dash.view'); if (DASHES.includes(v)) cur = v; } catch (e) { /* ignore */ }
    const sw = document.getElementById('dash-switch');
    sw.value = cur;
    sw.addEventListener('change', () => switchTo(sw.value));
    document.getElementById('dash-refresh').addEventListener('click', () => load(true));
    switchTo(cur, true);
  }

  function switchTo(view, skipRender) {
    if (!DASHES.includes(view)) view = 'bookings';
    DASHES.forEach((v) => {
      const el = document.getElementById('dash-view-' + v);
      if (el) el.hidden = v !== view;
    });
    try { localStorage.setItem('dash.view', view); } catch (e) { /* ignore */ }
    // Chart.js can't size a canvas inside a hidden box — (re)draw on show.
    if (!skipRender && lastStats) renderCharts(view, lastStats);
  }

  async function load(force) {
    if (!document.getElementById('dash-stats')) shell();
    const statsEl = document.getElementById('dash-stats');

    let s = force ? null : Data.stats();   // reuse the bootstrap payload when we have it
    if (!s) {
      if (force) Data.invalidate();
      statsEl.innerHTML = statCards.map(() => `<div class="stat-card"><span class="ic">…</span><div class="num">–</div><div class="label">Loading</div></div>`).join('');
      try {
        // A forced refresh re-bootstraps so the tables refresh too, not just the dashboard.
        s = force ? (await Data.bootstrap()).stats : await Api.dashboardStats();
      } catch (err) {
        document.getElementById('view-dashboard').innerHTML =
          `<div class="error-msg">Couldn't load the dashboard.<br>${Utils.escapeHtml(err.message || '')}</div>`;
        return;
      }
    }
    if (App.currentView() !== 'dashboard') return;
    lastStats = s;

    // Bookings-dashboard stat cards.
    statsEl.innerHTML = statCards.map(c => {
      const raw = s[c.key] ?? 0;
      return `<div class="stat-card" style="--sc:${c.color}">
        <span class="ic">${c.ic}</span>
        <div class="num">${c.currency ? Utils.formatCurrency(raw) : raw}</div>
        <div class="label">${c.label}</div>
      </div>`;
    }).join('');

    // Payments-dashboard stat cards + due list (offered only when the backend sends them).
    const pay = s.payments || null;
    const sw = document.getElementById('dash-switch');
    const swOpt = sw && sw.querySelector('option[value="payments"]');
    if (swOpt) swOpt.disabled = !pay;
    if (pay) { renderPayStats(pay); renderDue(pay.due || []); }
    else if (sw && sw.value === 'payments') { sw.value = 'bookings'; switchTo('bookings', true); }

    renderRecent(s.recent || []);
    renderCharts((sw && sw.value) || 'bookings', s);
  }

  function renderCharts(view, s) {
    if (!window.Chart) return;
    if (view === 'payments') {
      const pay = s.payments || {};
      lineChart('chart-pay', pay.monthlyCollected || s.monthlyPayments || [], 'Collected');
      doughnut('chart-payplan', pay.statusBreakdown || {});
      objBar('chart-paymode', pay.byMode || {}, '#2A6F97');
    } else {
      barChart('chart-enq', s.monthlyEnquiries || [], 'Enquiries', '#BB5A34');
      doughnut('chart-status', s.statusBreakdown || {});
    }
  }

  function renderDue(list) {
    const el = document.getElementById('dash-pay-due');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<div class="activity-row">Nothing outstanding — every plan is fully paid.</div>'; return; }
    el.innerHTML = list.map(p => `
      <div class="activity-row">
        <div><div class="who">${Utils.escapeHtml(p.customer || '—')}${p.destination ? ' · ' + Utils.escapeHtml(p.destination) : ''}</div>
        <div class="section-sub" style="margin:2px 0 0">${Utils.escapeHtml(p.enquiryId || '')}</div></div>
        <div class="when" style="color:var(--red);font-weight:600">${Utils.formatCurrency(p.pending)}</div>
      </div>`).join('');
  }

  function renderPayStats(p) {
    const el = document.getElementById('dash-pay-stats');
    if (!el) return;
    el.innerHTML = payCards.map(c => {
      const raw = p[c.key] ?? 0;
      const val = c.currency ? Utils.formatCurrency(raw) : c.pct ? raw + '%' : raw;
      return `<div class="stat-card" style="--sc:${c.color}">
        <span class="ic">${c.ic}</span>
        <div class="num">${val}</div>
        <div class="label">${c.label}</div>
      </div>`;
    }).join('');
  }

  function monthLabel(ym) {
    const [y, m] = String(ym).split('-');
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  }

  function barChart(id, series, label, color) {
    const ctx = document.getElementById(id);
    charts[id]?.destroy();
    charts[id] = new Chart(ctx, {
      type: 'bar',
      data: { labels: series.map(p => monthLabel(p.month)), datasets: [{ label, data: series.map(p => p.value), backgroundColor: color, borderRadius: 6 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }

  function lineChart(id, series, label) {
    const ctx = document.getElementById(id);
    charts[id]?.destroy();
    charts[id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: series.map(p => monthLabel(p.month)),
        datasets: [{ label, data: series.map(p => p.value), borderColor: '#2A6F97', backgroundColor: 'rgba(42,111,151,0.15)', fill: true, tension: 0.35 }]
      },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  /** Bar chart over a { label: amount } map, tooltips formatted as currency. */
  function objBar(id, obj, color) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    const labels = Object.keys(obj);
    charts[id]?.destroy();
    charts[id] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ data: labels.map(l => obj[l]), backgroundColor: color, borderRadius: 6 }] },
      options: {
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => Utils.formatCurrency(c.parsed.y) } } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  function doughnut(id, counts) {
    const ctx = document.getElementById(id);
    const labels = Object.keys(counts);
    charts[id]?.destroy();
    charts[id] = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: labels.map(l => counts[l]), backgroundColor: BRAND }] },
      options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });
  }

  function renderRecent(items) {
    const el = document.getElementById('dash-recent');
    if (!items.length) { el.innerHTML = '<div class="activity-row">No recent activity yet.</div>'; return; }
    el.innerHTML = items.map(a => `
      <div class="activity-row">
        <div><div class="who">${a.icon || '•'} ${Utils.escapeHtml(a.text)}</div></div>
        <div class="when">${Utils.timeAgo(a.at)}</div>
      </div>`).join('');
  }

  return { load };
})();

App.onView('dashboard', () => Dashboard.load());
