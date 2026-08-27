/**
 * dashboard.js — Dashboard view.
 * Stat cards + Chart.js charts + a recent-activity feed, all computed
 * server-side by Code.gs's `dashboardStats` action across the Enquiries,
 * Suppliers, Bookings and Payments sheets.
 */

const Dashboard = (() => {
  let charts = {};

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

  function shell() {
    document.getElementById('view-dashboard').innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:14px;">
        <button class="btn" id="dash-refresh">↻ Refresh</button>
      </div>
      <div class="stat-grid" id="dash-stats"></div>
      <div class="chart-grid two">
        <div class="card chart-card"><div class="section-title">Enquiries — last 6 months</div><canvas id="chart-enq"></canvas></div>
        <div class="card chart-card"><div class="section-title">Enquiry status</div><canvas id="chart-status"></canvas></div>
      </div>
      <div class="chart-grid two">
        <div class="card chart-card"><div class="section-title">Payments received — last 6 months</div><canvas id="chart-pay"></canvas></div>
        <div class="card"><div class="section-title">Recent activity</div><div class="section-sub">Latest updates across the portal</div><div class="activity-list" id="dash-recent"></div></div>
      </div>`;
    document.getElementById('dash-refresh').addEventListener('click', () => load(true));
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

    statsEl.innerHTML = statCards.map(c => {
      const raw = s[c.key] ?? 0;
      return `<div class="stat-card" style="--sc:${c.color}">
        <span class="ic">${c.ic}</span>
        <div class="num">${c.currency ? Utils.formatCurrency(raw) : raw}</div>
        <div class="label">${c.label}</div>
      </div>`;
    }).join('');

    if (window.Chart) {
      barChart('chart-enq', s.monthlyEnquiries || [], 'Enquiries', '#BB5A34');
      lineChart('chart-pay', s.monthlyPayments || [], 'Received');
      doughnut('chart-status', s.statusBreakdown || {});
    }
    renderRecent(s.recent || []);
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
