import { state }                                      from './state.js';
import { fmt }                                         from './utils.js';
import { saveSnapshotIfNeeded, fetchSnapshots }        from './snapshots.js';

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
  // Fall back to invested value (not 0) when price API hasn't loaded yet
  return price > 0 ? (g.weight || 0) * price : (g.totalInvested || 0);
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

  // NPS — invested = totalContributed; current = live NAV (from API) → manual currentNav → fallback to invested
  const npsInvested = state.nps.reduce((s, n) => s + (n.totalContributed != null ? n.totalContributed : (n.units || 0) * (n.avgBuyNav || 0)), 0);
  const npsCurrent  = state.nps.reduce((s, n) => {
    const inv     = n.totalContributed != null ? n.totalContributed : (n.units || 0) * (n.avgBuyNav || 0);
    const liveNav = state.npsNavs?.[`${n.fundManager}|${n.tier}|${n.assetClass}`]?.nav;
    const nav     = liveNav || n.currentNav || null;
    return s + (nav ? (n.units || 0) * nav : inv);
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
   Full set = "All" selected. Removing a label excludes it.
   ───────────────────────────────────────────────────────────────── */
// null = not yet initialised (will be filled with all labels on first render)
let _activeFilters = null;

function renderFilterBar(allAssets) {
  const el = document.getElementById('overview-filter-bar');
  if (!el) return;

  // Lazy-init: start with everything selected
  if (_activeFilters === null) {
    _activeFilters = new Set(allAssets.map(a => a.label));
  }

  const allSelected = _activeFilters.size === allAssets.length;

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
        // Select all chips
        _activeFilters = new Set(allAssets.map(a => a.label));
      } else {
        if (_activeFilters.has(f)) {
          // Deselect this chip (and implicitly deselects "All")
          _activeFilters.delete(f);
          // Keep at least one chip selected
          if (_activeFilters.size === 0) {
            _activeFilters.add(f);
            return; // nothing to change
          }
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
   PORTFOLIO HISTORY LINE CHART
   ───────────────────────────────────────────────────────────────── */
let _historyChart    = null;
let _historyPeriod   = '1M';
let _chartInitialised = false;

function periodToSinceDate(period) {
  if (period === 'ALL') return null;
  const d = new Date();
  const n = parseInt(period);
  if (period.endsWith('M')) d.setMonth(d.getMonth() - n);
  else if (period.endsWith('Y')) d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
}

function fmtSnapshotLabel(iso, period) {
  const [y, m, d] = iso.split('-');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1];
  return period === '1M' ? `${+d} ${mo}` : `${mo} '${y.slice(2)}`;
}

async function renderPortfolioHistoryChart(period) {
  _historyPeriod = period || _historyPeriod;
  const uid = state.currentUser?.uid;
  const canvas  = document.getElementById('portfolio-history-chart');
  const emptyEl = document.getElementById('history-chart-empty');
  const wrapEl  = document.getElementById('history-chart-wrap');
  if (!canvas || !uid) return;

  // Update active period button
  document.querySelectorAll('#historyPeriodBtns .period-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.period === _historyPeriod));

  const snapshots = await fetchSnapshots(uid, periodToSinceDate(_historyPeriod));

  if (!snapshots.length) {
    wrapEl.style.display = 'none';
    emptyEl.style.display = '';
    return;
  }
  wrapEl.style.display = '';
  emptyEl.style.display = 'none';

  const labels   = snapshots.map(s => fmtSnapshotLabel(s.date, _historyPeriod));
  const values   = snapshots.map(s => s.totalValue   ?? 0);
  const invested = snapshots.map(s => s.totalInvested ?? 0);

  const latest    = values[values.length - 1];
  const latestInv = invested[invested.length - 1];
  const isGain    = latest >= latestInv;
  const lineCol   = isGain ? '#059669' : '#ef4444';
  const fillCol   = isGain ? 'rgba(5,150,105,0.08)' : 'rgba(239,68,68,0.08)';
  const showDots  = snapshots.length <= 60;

  if (_historyChart) { _historyChart.destroy(); _historyChart = null; }

  _historyChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Portfolio Value',
          data: values,
          borderColor: lineCol,
          backgroundColor: fillCol,
          borderWidth: 2.5,
          pointRadius: showDots ? 3 : 0,
          pointHoverRadius: 5,
          fill: 'origin',
          tension: 0.35,
        },
        {
          label: 'Invested',
          data: invested,
          borderColor: '#94a3b8',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.35,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top', align: 'end',
          labels: { font: { size: 11, weight: '600' }, usePointStyle: true, pointStyleWidth: 8, padding: 16, boxHeight: 8 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 }, color: '#94a3b8', maxTicksLimit: 8 },
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: {
            font: { size: 11 }, color: '#94a3b8',
            callback: v => v >= 1e7 ? '₹' + (v / 1e7).toFixed(1) + 'Cr'
                        : v >= 1e5 ? '₹' + (v / 1e5).toFixed(1) + 'L'
                        : v >= 1e3 ? '₹' + (v / 1e3).toFixed(0) + 'K'
                        : '₹' + v,
          },
        },
      },
    },
  });
}

/* ─────────────────────────────────────────────────────────────────
   PIE / DOUGHNUT CHART
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

// Debounced snapshot save — fires 2 s after the last renderOverview() call
let _snapshotTimer   = null;
let _pendingSnapshot = null;

// Previous-day snapshot for 1D change KPI
let _prevSnapshot        = null;   // { date, totalValue, totalInvested }
let _prevSnapshotFetched = false;

function _getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function _fmtShortDate(iso) {
  const [, m, d] = iso.split('-');
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1];
  return `${+d} ${mo}`;
}

async function loadPrevSnapshot(uid) {
  if (_prevSnapshotFetched) return;
  _prevSnapshotFetched = true;

  const today = new Date().toISOString().slice(0, 10);
  // Look back up to 30 days for the most recent snapshot strictly before today
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().slice(0, 10);

  const snapshots = await fetchSnapshots(uid, sinceStr);
  const prev = [...snapshots].reverse().find(s => s.date < today);
  if (prev) {
    _prevSnapshot = prev;
    // Re-render KPIs now that we have yesterday's data
    if (state.activeTab === 'overview') renderOverview();
  }
}

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

  // All assets (unfiltered) — used for filter bar chips + snapshotting
  const allAssets = computeAssets();

  // Queue a snapshot save 2 s after the last render (prices will have settled by then).
  // Each new renderOverview() call resets the timer — only the final one fires.
  const snapTotal    = allAssets.reduce((s, a) => s + a.current,  0);
  const snapInvested = allAssets.reduce((s, a) => s + a.invested, 0);
  if (snapTotal > 0 && state.currentUser?.uid) {
    const breakdown = {};
    allAssets.forEach(a => { breakdown[a.label] = Math.round(a.current); });
    _pendingSnapshot = { uid: state.currentUser.uid, snapTotal, snapInvested, breakdown };
    clearTimeout(_snapshotTimer);
    _snapshotTimer = setTimeout(async () => {
      const p = _pendingSnapshot;
      _pendingSnapshot = null;
      if (!p) return;
      const saved = await saveSnapshotIfNeeded(p.uid, p.snapTotal, p.snapInvested, p.breakdown);
      if (saved && _chartInitialised) renderPortfolioHistoryChart();
    }, 2000);
  }

  // Filtered view for KPIs / table / pie chart
  // null check: _activeFilters may not be initialised yet (renderFilterBar does that)
  const assets = _lastAssets = (!_activeFilters || _activeFilters.size === allAssets.length)
    ? allAssets
    : allAssets.filter(a => _activeFilters.has(a.label));

  // Initialise the history line chart once (async, non-blocking)
  if (!_chartInitialised && state.currentUser?.uid) {
    _chartInitialised = true;
    // Attach period button listeners
    document.getElementById('historyPeriodBtns')?.querySelectorAll('.period-btn')
      .forEach(btn => btn.addEventListener('click', () => renderPortfolioHistoryChart(btn.dataset.period)));
    renderPortfolioHistoryChart(_historyPeriod);
    // Load yesterday's snapshot for 1D change KPI (non-blocking)
    loadPrevSnapshot(state.currentUser.uid);
  }

  // Render filter chips (always based on full asset list)
  renderFilterBar(allAssets);

  const totalInvested = assets.reduce((s, a) => s + a.invested, 0);
  const totalCurrent  = assets.reduce((s, a) => s + a.current,  0);
  const totalGain     = totalCurrent - totalInvested;
  const totalRetPct   = totalInvested > 0 ? (totalGain / totalInvested) * 100 : 0;

  const gainColor = totalGain >= 0 ? '#059669' : '#dc2626';
  const gainSign  = totalGain >= 0 ? '+' : '';

  const allSelected = !_activeFilters || _activeFilters.size === allAssets.length;
  const kpiSubLabel = allSelected
    ? 'Across all assets'
    : `${_activeFilters.size} of ${allAssets.length} categories selected`;

  // 1D Change — compare full portfolio value vs most recent previous snapshot
  let oneDayCard = '';
  if (_prevSnapshot) {
    const prevVal   = _prevSnapshot.totalValue;
    const dayChange = snapTotal - prevVal;
    const dayPct    = prevVal > 0 ? (dayChange / prevVal) * 100 : 0;
    const daySign   = dayChange >= 0 ? '+' : '';
    const dayColor  = dayChange >= 0 ? '#059669' : '#dc2626';
    const isYday    = _prevSnapshot.date === _getYesterday();
    const dayLabel  = isYday ? '1D Change' : `Since ${_fmtShortDate(_prevSnapshot.date)}`;
    oneDayCard = `
      <div class="kpi-card">
        <div class="kpi-label">${dayLabel}</div>
        <div class="kpi-value" style="color:${dayColor}">${daySign}${fmt(Math.round(Math.abs(dayChange)))}</div>
        <div class="kpi-sub">${daySign}${dayPct.toFixed(2)}% from ${fmt(Math.round(prevVal))}</div>
      </div>`;
  }

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
      ${oneDayCard}
      <div class="kpi-card">
        <div class="kpi-label">Total Gain / Loss</div>
        <div class="kpi-value" style="color:${gainColor}">${gainSign}${fmt(Math.round(Math.abs(totalGain)))}</div>
        <div class="kpi-sub">${gainSign}${totalRetPct.toFixed(2)}%</div>
      </div>
    </div>`;

  // Update summary table
  const hasPrev     = !!_prevSnapshot;
  const prevBD      = hasPrev ? (_prevSnapshot.breakdown || {}) : {};
  const isYday      = hasPrev && _prevSnapshot.date === _getYesterday();
  const dayColLabel = hasPrev ? (isYday ? '1D Change' : `Since ${_fmtShortDate(_prevSnapshot.date)}`) : '';

  // Total 1D values — use full portfolio (unfiltered snapTotal vs prevSnapshot)
  const totDayChange  = hasPrev ? snapTotal - _prevSnapshot.totalValue : 0;
  const totDayPct     = hasPrev && _prevSnapshot.totalValue > 0 ? (totDayChange / _prevSnapshot.totalValue) * 100 : 0;
  const totDaySign    = totDayChange >= 0 ? '+' : '';
  const totDayColor   = totDayChange >= 0 ? '#059669' : '#dc2626';

  tableEl.innerHTML = `
    <div class="card-title">Asset Summary</div>
    <div class="table-wrap">
      <table class="overview-table">
        <thead>
          <tr>
            <th>Instrument</th>
            <th class="num">Invested</th>
            <th class="num">Current Value</th>
            ${hasPrev ? `<th class="num">${dayColLabel}</th>` : ''}
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

            // 1D change per asset
            let dayCell = '';
            if (hasPrev) {
              const prevVal = prevBD[a.label];
              if (prevVal != null && hasData) {
                const dc   = a.current - prevVal;
                const dpct = prevVal > 0 ? (dc / prevVal) * 100 : 0;
                const ds   = dc >= 0 ? '+' : '';
                const dc_  = dc >= 0 ? '#059669' : '#dc2626';
                dayCell = `<td class="num" style="color:${dc_}">${ds}${fmt(Math.round(Math.abs(dc)))}<br><span style="font-size:10.5px;opacity:0.8">${ds}${dpct.toFixed(2)}%</span></td>`;
              } else {
                dayCell = `<td class="num" style="color:#94a3b8">—</td>`;
              }
            }

            return `<tr>
              <td><span class="overview-dot" style="background:${a.color}"></span>${a.label}</td>
              <td class="num">${hasData ? fmt(Math.round(a.invested)) : '—'}</td>
              <td class="num">${hasData ? fmt(Math.round(a.current))  : '—'}</td>
              ${dayCell}
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
            ${hasPrev ? `<td class="num" style="color:${totDayColor}"><strong>${totDaySign}${fmt(Math.round(Math.abs(totDayChange)))}</strong><br><span style="font-size:10.5px;opacity:0.8">${totDaySign}${totDayPct.toFixed(2)}%</span></td>` : ''}
            <td class="num" style="color:${gainColor}"><strong>${gainSign}${fmt(Math.round(Math.abs(totalGain)))}</strong></td>
            <td class="num" style="color:${gainColor}"><strong>${gainSign}${totalRetPct.toFixed(2)}%</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}
