import { state } from './state.js';
import { fmt }   from './utils.js';

/* ─────────────────────────────────────────────────────────────────
   HELPERS — inline the same formulas used per-tab so we don't need
   to export internals from each module.
   ───────────────────────────────────────────────────────────────── */

function monthDiff(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start), e = new Date(end);
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
}

// FD: principal + interest accrued up to today (capped at maturity date)
function fdAccruedValue(principal, rate, startDate, maturityDate) {
  if (!principal || !rate || !startDate || !maturityDate) return principal || 0;
  const start  = new Date(startDate);
  const end    = new Date(Math.min(new Date(), new Date(maturityDate))); // don't go past maturity
  const years  = Math.max(0, (end - start) / (365.25 * 24 * 3600 * 1000));
  return principal * Math.pow(1 + rate / 400, years * 4);
}

// RD: accumulated value of installments paid so far (capped at maturity date)
function rdAccruedValue(monthlyAmount, rate, startDate, maturityDate) {
  if (!monthlyAmount || !rate || !startDate || !maturityDate) return 0;
  const today   = new Date();
  const mat     = new Date(maturityDate);
  // Use whichever is earlier — today or maturity — as the reference end date
  const endDate = today < mat
    ? today.toISOString().split('T')[0]
    : maturityDate;
  const n = monthDiff(startDate, endDate);
  if (n <= 0) return 0;
  const i = Math.pow(1 + rate / 400, 1 / 3) - 1;
  if (i <= 0) return monthlyAmount * n;
  return monthlyAmount * (Math.pow(1 + i, n) - 1) * (1 + i) / i;
}

function rdInstallmentsPaid(startDate) {
  if (!startDate) return 0;
  const s = new Date(startDate), t = new Date();
  const m = (t.getFullYear() - s.getFullYear()) * 12 + (t.getMonth() - s.getMonth());
  return Math.max(0, m);
}

function goldCurrentValue(g) {
  const price = g.type === '24K' ? state.goldPrices.price24k : state.goldPrices.price22k;
  return price > 0 ? (g.weight || 0) * price : 0;
}

/* ─────────────────────────────────────────────────────────────────
   COMPUTE TOTALS PER ASSET CLASS
   ───────────────────────────────────────────────────────────────── */
function computeAssets() {
  // Bonds — active bonds only (excludes matured/withdrawn), matching the Bonds tab
  const activeBonds   = state.bonds.filter(b => !b.matured);
  const bondsInvested = activeBonds.reduce((s, b) => s + (b.faceValue || 0), 0);

  // Gold — exclude gifted items, matching what the Gold tab shows
  const ownedGold    = state.goldItems.filter(g => !g.gifted);
  const goldInvested = ownedGold
    .filter(g => (g.totalInvested || 0) > 0)
    .reduce((s, g) => s + (g.totalInvested || 0), 0);
  const goldCurrent  = ownedGold.reduce((s, g) => s + goldCurrentValue(g), 0);

  // FD — invested = principal, current = accrued value up to today
  const fdInvested = state.fds.reduce((s, f) => s + (f.principal || 0), 0);
  const fdCurrent  = state.fds.reduce((s, f) =>
    s + fdAccruedValue(f.principal, f.interestRate, f.startDate, f.maturityDate), 0);

  // RD — invested = instalments paid so far, current = accumulated value of those instalments
  const rdInvested = state.rds.reduce((s, r) => {
    const total = monthDiff(r.startDate, r.maturityDate);
    const paid  = Math.min(rdInstallmentsPaid(r.startDate), total);
    return s + paid * (r.monthlyAmount || 0);
  }, 0);
  const rdCurrent = state.rds.reduce((s, r) =>
    s + rdAccruedValue(r.monthlyAmount, r.interestRate, r.startDate, r.maturityDate), 0);

  // Mutual Funds
  const mfInvested = state.mfs.reduce((s, m) => s + (m.units || 0) * (m.avgBuyNav || 0), 0);
  const mfCurrent  = state.mfs.reduce((s, m) => {
    const nav = state.mfNavs[m.schemeCode];
    return s + (nav ? (m.units || 0) * nav.nav : (m.units || 0) * (m.avgBuyNav || 0));
  }, 0);

  // Stocks — US stocks converted to INR using live USD/INR rate
  const stInvested = state.stocks.reduce((s, s2) => {
    const isUS = s2.market === 'US';
    const fx   = isUS ? (state.usdInrRate || 0) : 1;
    return s + (s2.shares || 0) * (s2.avgBuyPrice || 0) * fx;
  }, 0);
  const stCurrent  = state.stocks.reduce((s, s2) => {
    const isUS   = s2.market === 'US';
    const fx     = isUS ? (state.usdInrRate || 0) : 1;
    const sym    = (s2.symbol || '').toUpperCase();
    const ticker = isUS ? sym : `${sym}.NS`;
    const p      = state.stockPrices[ticker];
    const inv    = (s2.shares || 0) * (s2.avgBuyPrice || 0) * fx;
    return s + (p?.price ? (s2.shares || 0) * p.price * fx : inv);
  }, 0);

  // NPS — invested = totalContributed (explicit field), current = units × currentNav (fallback to invested)
  const npsInvested = state.nps.reduce((s, n) => s + (n.totalContributed != null ? n.totalContributed : (n.units || 0) * (n.avgBuyNav || 0)), 0);
  const npsCurrent  = state.nps.reduce((s, n) => {
    const inv = n.totalContributed != null ? n.totalContributed : (n.units || 0) * (n.avgBuyNav || 0);
    return s + (n.currentNav ? (n.units || 0) * n.currentNav : inv);
  }, 0);

  // EPF — balance = opening + Σ(employee + employer + interest); invested = balance − interest
  const epfBalance  = state.epf.reduce((s, acc) => {
    const opening = acc.openingBalance || 0;
    const rows    = acc.yearlyData || [];
    return s + opening + rows.reduce((rs, r) =>
      rs + (r.employeeContribution || 0) + (r.employerContribution || 0) + (r.interest || 0), 0);
  }, 0);
  const epfInvested = state.epf.reduce((s, acc) => {
    const opening = acc.openingBalance || 0;
    const rows    = acc.yearlyData || [];
    return s + opening + rows.reduce((rs, r) =>
      rs + (r.employeeContribution || 0) + (r.employerContribution || 0), 0);
  }, 0);

  return [
    { label: 'Bonds',         invested: bondsInvested,             current: bondsInvested,           color: '#3b82f6' },
    { label: 'Gold',          invested: goldInvested,              current: goldCurrent,              color: '#f59e0b' },
    { label: 'Deposits',      invested: fdInvested + rdInvested,   current: fdCurrent + rdCurrent,   color: '#8b5cf6' },
    { label: 'Mutual Funds',  invested: mfInvested,                current: mfCurrent,               color: '#10b981' },
    { label: 'Stocks',        invested: stInvested,                current: stCurrent,               color: '#ef4444' },
    { label: 'NPS',           invested: npsInvested,               current: npsCurrent,              color: '#6366f1' },
    { label: 'EPF',           invested: epfInvested,               current: epfBalance,              color: '#0ea5e9' },
  ];
}

/* ─────────────────────────────────────────────────────────────────
   FILTER STATE
   ───────────────────────────────────────────────────────────────── */
// Empty set = "All" (no filter active). Non-empty = only show these labels.
let _activeFilters = new Set();

function renderFilterBar(allAssets) {
  const el = document.getElementById('overview-filter-bar');
  if (!el) return;

  const allSelected = _activeFilters.size === 0;

  el.innerHTML = `
    <button class="overview-chip${allSelected ? ' active' : ''}" data-filter="__all__">All</button>
    ${allAssets.map(a => {
      const on = _activeFilters.has(a.label);
      return `<button class="overview-chip${on ? ' active' : ''}" data-filter="${a.label}">
        <span class="overview-chip-dot" style="background:${a.color}"></span>${a.label}
      </button>`;
    }).join('')}`;

  el.querySelectorAll('.overview-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      if (f === '__all__') {
        _activeFilters.clear();
      } else {
        if (_activeFilters.has(f)) {
          _activeFilters.delete(f);
        } else {
          _activeFilters.add(f);
        }
      }
      // Re-render (filter bar + KPIs + table + chart)
      renderOverview();
      requestAnimationFrame(() => renderPieChart(_lastAssets));
    });
  });
}

/* ─────────────────────────────────────────────────────────────────
   CHART
   ───────────────────────────────────────────────────────────────── */
let overviewChart = null;

function renderPieChart(assets) {
  const canvas = document.getElementById('overview-pie');
  if (!canvas) return;

  if (overviewChart) { overviewChart.destroy(); overviewChart = null; }

  const active = assets.filter(a => a.current > 0);
  if (!active.length) return;

  overviewChart = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels:   active.map(a => a.label),
      datasets: [{
        data:            active.map(a => Math.round(a.current)),
        backgroundColor: active.map(a => a.color),
        borderColor:     '#fff',
        borderWidth:     3,
        hoverOffset:     6,
      }],
    },
    options: {
      responsive:        true,
      maintainAspectRatio: true,
      cutout:            '62%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 12, weight: '600' }, padding: 16, usePointStyle: true, pointStyleWidth: 10 },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct   = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return ` ${ctx.label}: ${fmt(ctx.parsed)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

/* ─────────────────────────────────────────────────────────────────
   RENDER
   ───────────────────────────────────────────────────────────────── */
// Last computed (filtered) assets — stored so renderOverviewChart() can redraw without recomputing
let _lastAssets = [];

// Exported: redraws only the chart on the permanent canvas (call via requestAnimationFrame)
export function renderOverviewChart() {
  renderPieChart(_lastAssets);
}

// Register globally so other modules can trigger a re-render without circular imports
window.__renderOverview = () => {
  if (state.activeTab === 'overview') {
    renderOverview();
    requestAnimationFrame(() => renderOverviewChart());
  }
};

export function renderOverview() {
  // Swap skeleton → real content on first data arrival
  const loadingEl = document.getElementById('overview-loading');
  const contentEl = document.getElementById('overview-content');
  if (loadingEl && loadingEl.style.display !== 'none') {
    loadingEl.style.display = 'none';
    contentEl.style.display = '';
  }

  const kpisEl  = document.getElementById('overview-kpis');
  const tableEl = document.getElementById('overview-table');
  if (!kpisEl || !tableEl) return;

  // All assets (unfiltered) — used for filter bar chips
  const allAssets = computeAssets();

  // Filtered view for KPIs / table / chart
  const assets = _lastAssets = _activeFilters.size === 0
    ? allAssets
    : allAssets.filter(a => _activeFilters.has(a.label));

  // Render filter chips (always based on full asset list)
  renderFilterBar(allAssets);

  const totalInvested = assets.reduce((s, a) => s + a.invested, 0);
  const totalCurrent  = assets.reduce((s, a) => s + a.current,  0);
  const totalGain     = totalCurrent - totalInvested;
  const totalRetPct   = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

  const gainColor = totalGain >= 0 ? '#059669' : '#dc2626';
  const gainSign  = totalGain >= 0 ? '+' : '';

  const kpiSubLabel = _activeFilters.size === 0
    ? 'Across all assets'
    : `${_activeFilters.size} instrument${_activeFilters.size > 1 ? 's' : ''} selected`;

  // Update KPI cards
  kpisEl.innerHTML = `
    <div class="overview-kpi-grid">
      <div class="kpi-card primary">
        <div class="kpi-label">Total Invested</div>
        <div class="kpi-value">${fmt(Math.round(totalInvested))}</div>
        <div class="kpi-sub">${kpiSubLabel}</div>
      </div>
      <div class="kpi-card ${totalGain >= 0 ? 'success' : 'danger'}">
        <div class="kpi-label">Current Value</div>
        <div class="kpi-value">${fmt(Math.round(totalCurrent))}</div>
        <div class="kpi-sub">${gainSign}${totalRetPct.toFixed(2)}% overall return</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Total Gain / Loss</div>
        <div class="kpi-value" style="color:${gainColor}">${gainSign}${fmt(Math.round(Math.abs(totalGain)))}</div>
        <div class="kpi-sub">${gainSign}${totalRetPct.toFixed(2)}%</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Asset Classes</div>
        <div class="kpi-value">${assets.filter(a => a.invested > 0).length}</div>
        <div class="kpi-sub">Active categories</div>
      </div>
    </div>`;

  // Update summary table
  tableEl.innerHTML = `
    <div class="card-title">Asset Summary</div>
    <div class="table-wrap">
      <table class="overview-table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th class="num">Invested</th>
            <th class="num">Current Value</th>
            <th class="num">Gain / Loss</th>
            <th class="num">Return %</th>
          </tr>
        </thead>
        <tbody>
          ${assets.map(a => {
            const gain    = a.current - a.invested;
            const retPct  = a.invested > 0 ? (gain / a.invested) * 100 : 0;
            const col     = gain >= 0 ? '#059669' : '#dc2626';
            const sign    = gain >= 0 ? '+' : '';
            const hasData = a.invested > 0;
            return `<tr>
              <td><span class="overview-dot" style="background:${a.color}"></span>${a.label}</td>
              <td class="num">${hasData ? fmt(Math.round(a.invested)) : '—'}</td>
              <td class="num">${hasData ? fmt(Math.round(a.current))  : '—'}</td>
              <td class="num" style="color:${hasData ? col : 'inherit'}">${hasData ? sign + fmt(Math.round(Math.abs(gain))) : '—'}</td>
              <td class="num" style="color:${hasData ? col : 'inherit'}">${hasData ? sign + retPct.toFixed(2) + '%' : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr class="overview-total-row">
            <td><strong>Total</strong></td>
            <td class="num"><strong>${fmt(Math.round(totalInvested))}</strong></td>
            <td class="num"><strong>${fmt(Math.round(totalCurrent))}</strong></td>
            <td class="num" style="color:${gainColor}"><strong>${gainSign}${fmt(Math.round(Math.abs(totalGain)))}</strong></td>
            <td class="num" style="color:${gainColor}"><strong>${gainSign}${totalRetPct.toFixed(2)}%</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}
