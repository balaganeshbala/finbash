import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db }    from './firebase-init.js';
import { state } from './state.js';
import { fmt }   from './utils.js';
import { toast } from './ui.js';

/* ─────────────────────────────────────────────────────────────────
   STOCK PRICE PROXY
   ───────────────────────────────────────────────────────────────── */
const OWN_PROXY_BASE = 'https://stock-price-proxy.vercel.app';

async function fetchPriceForTicker(sym) {
  try {
    const res  = await fetch(`${OWN_PROXY_BASE}/api/stock-price?symbol=${encodeURIComponent(sym)}`);
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (meta?.regularMarketPrice != null) return {
      price:     meta.regularMarketPrice,
      prevClose: meta.previousClose ?? meta.chartPreviousClose ?? null,
      name:      meta.shortName || meta.longName || '',
    };
  } catch { /* network / parse error */ }
  return null;
}

/* ─────────────────────────────────────────────────────────────────
   FIRESTORE REFS
   ───────────────────────────────────────────────────────────────── */
const stColRef = uid => collection(db, 'users', uid, 'stocks');
const stDocRef = (uid, id) => doc(db, 'users', uid, 'stocks', id);

/* ─────────────────────────────────────────────────────────────────
   LISTENER
   ───────────────────────────────────────────────────────────────── */
export function startListeningStocks(uid) {
  if (state.stockUnsub) { state.stockUnsub(); state.stockUnsub = null; }
  state.stockUnsub = onSnapshot(
    stColRef(uid),
    snap => {
      state.stocks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderStocksSection();
      fetchAllPrices();
    },
    () => toast('Could not load stock data. Check Firestore rules.', 'error'),
  );
}

/* ─────────────────────────────────────────────────────────────────
   CRUD
   ───────────────────────────────────────────────────────────────── */
export const addStock    = data => addDoc(stColRef(state.currentUser.uid), { ...data, createdAt: serverTimestamp() });
export const updateStock = (id, data) => updateDoc(stDocRef(state.currentUser.uid, id), { ...data, updatedAt: serverTimestamp() });
export const deleteStock = id => deleteDoc(stDocRef(state.currentUser.uid, id));

/* ─────────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────────── */
export function tickerSym(stock) {
  const sym = (stock.symbol || '').toUpperCase();
  if (stock.market === 'US') {
    // Yahoo Finance uses hyphens for share-class separators (BRK.B → BRK-B)
    return sym.replace(/\./g, '-');
  }
  return `${sym}.NS`;
}

// Convert a US-stock value (in USD) to INR using live rate, falling back to 0
export function usdToInr(usd) {
  return state.usdInrRate ? usd * state.usdInrRate : 0;
}

// Market badge HTML
function marketBadge(market) {
  return market === 'US'
    ? `<span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:10px">🇺🇸 US</span>`
    : `<span class="badge" style="background:#dcfce7;color:#166534;font-size:10px">🇮🇳 NSE</span>`;
}

function isMarketOpen() {
  const ist  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day  = ist.getDay();
  if (day === 0 || day === 6) return false;
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return mins >= 555 && mins <= 930;
}

/* ─────────────────────────────────────────────────────────────────
   PRICE FETCH
   ───────────────────────────────────────────────────────────────── */
export async function fetchAllPrices() {
  if (!state.stocks.length) return;
  state.stockPriceLoading = true;
  updateRefreshBtn(true);

  const tickers = [...new Set(state.stocks.map(tickerSym))];
  const hasUS   = state.stocks.some(s => s.market === 'US');

  // Fetch all stock prices + USD/INR rate if needed
  const allSymbols = hasUS ? [...tickers, 'USDINR=X'] : tickers;
  const results    = await Promise.all(allSymbols.map(async t => ({ t, data: await fetchPriceForTicker(t) })));

  const failed = [];
  results.forEach(({ t, data }) => {
    if (t === 'USDINR=X') {
      if (data?.price) state.usdInrRate = data.price;
    } else if (data) {
      state.stockPrices[t] = data;
    } else {
      failed.push(t);
    }
  });

  if (failed.length) {
    // Strip only the .NS suffix added for NSE stocks; US tickers (e.g. BRK-B) are shown as-is
    const syms = failed.map(t => t.endsWith('.NS') ? t.slice(0, -3) : t).join(', ');
    toast(`Could not fetch prices for: ${syms}. Check the symbols.`, 'error');
  }

  state.stockPriceLoading = false;
  state.lastStockPriceFetch = Date.now();
  updateRefreshBtn(false);
  renderStocksSection();
  window.__renderOverview?.();
}

function updateRefreshBtn(loading) {
  const btn = document.getElementById('btn-refresh-stocks');
  if (!btn) return;
  btn.disabled  = loading;
  btn.innerHTML = loading
    ? `<svg viewBox="0 0 24 24" class="spin-icon"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="M21 12a9 9 0 11-2.2-5.8"/></svg> Refreshing…`
    : `<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M1 4v6h6M23 20v-6h-6"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg> Refresh Prices`;
}

/* ─────────────────────────────────────────────────────────────────
   KPI CARDS
   ───────────────────────────────────────────────────────────────── */
function renderStocksKpis() {
  let totalInvested = 0, totalCurrent = 0, withPrice = 0, dayGain = 0;
  state.stocks.forEach(s => {
    const isUS = s.market === 'US';
    const fx   = isUS ? (state.usdInrRate || 0) : 1;
    const inv  = (s.shares || 0) * (s.avgBuyPrice || 0) * fx;
    totalInvested += inv;
    const p = state.stockPrices[tickerSym(s)];
    if (p?.price) {
      const cv = (s.shares || 0) * p.price * fx;
      totalCurrent += cv;
      withPrice++;
      if (p.prevClose) dayGain += (s.shares || 0) * (p.price - p.prevClose) * fx;
    } else {
      totalCurrent += inv;
    }
  });
  const gain   = totalCurrent - totalInvested;
  const retPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;
  const dayPct = (totalCurrent - dayGain) > 0 ? (dayGain / (totalCurrent - dayGain)) * 100 : 0;
  const open   = isMarketOpen();

  const KSVG = (d, s = '#fff') =>
    `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:none;stroke:${s};stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${d}</svg>`;

  document.getElementById('stockKpiGrid').innerHTML = [
    {
      icon:  KSVG('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>'),
      label: 'Total Invested', cls: 'primary',
      value: fmt(Math.round(totalInvested)),
      sub:   state.usdInrRate
        ? `${state.stocks.length} holding${state.stocks.length !== 1 ? 's' : ''} · $1 = ₹${state.usdInrRate.toFixed(2)}`
        : `${state.stocks.length} holding${state.stocks.length !== 1 ? 's' : ''}`,
    },
    {
      icon:  KSVG('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
      label: 'Current Value', cls: 'success',
      value: fmt(Math.round(totalCurrent)),
      sub:   withPrice < state.stocks.length && state.stocks.length > 0
        ? `Price for ${withPrice}/${state.stocks.length} holdings` : 'Live price',
    },
    {
      icon:  KSVG('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
      label: 'Total Gain / Loss', cls: gain >= 0 ? 'success' : '',
      value: (gain >= 0 ? '+' : '') + fmt(Math.round(gain)),
      sub:   totalInvested > 0 ? `${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}% overall` : '—',
    },
    {
      icon:  KSVG('<polyline points="22 7 13.5 15.5 8.5 10.5 1 18"/>'),
      label: "Today's Change", cls: withPrice > 0 ? (dayGain >= 0 ? 'success' : '') : '',
      value: withPrice > 0 ? (dayGain >= 0 ? '+' : '') + fmt(Math.round(dayGain)) : '—',
      sub:   withPrice > 0
        ? `${dayPct >= 0 ? '+' : ''}${dayPct.toFixed(2)}% · Market ${open ? 'Open 🟢' : 'Closed 🔴'}`
        : `Market ${open ? 'Open 🟢' : 'Closed 🔴'}`,
    },
  ].map(k => `<div class="kpi-card ${k.cls}">
    <div class="kpi-label">${k.label}</div>
    <div class="kpi-value">${k.value}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`).join('');
}

/* ─────────────────────────────────────────────────────────────────
   RENDER  (dispatches to By-Holding or By-Stock view)
   ───────────────────────────────────────────────────────────────── */
export function renderStocksSection() {
  renderStocksKpis();

  // Rebuild demat account filter
  const sel = document.getElementById('stockDematFilter');
  if (sel) {
    const prev     = sel.value;
    const accounts = [...new Set(state.stocks.map(s => s.dematAccount).filter(Boolean))].sort();
    sel.innerHTML  = '<option value="">All Accounts</option>' +
      accounts.map(a => `<option value="${a}"${a === prev ? ' selected' : ''}>${a}</option>`).join('');
  }

  // Sync view-mode toggle buttons
  const btnHolding = document.getElementById('btn-view-holding');
  const btnStock   = document.getElementById('btn-view-stock');
  if (btnHolding && btnStock) {
    const vm = state.stockViewMode || 'holding';
    btnHolding.classList.toggle('active', vm === 'holding');
    btnStock.classList.toggle('active',   vm === 'stock');
  }

  if (state.stockViewMode === 'stock') {
    renderByStockView();
  } else {
    renderByHoldingView();
  }
}

/* ── BY HOLDING ── individual rows, one per demat account entry ── */
function renderByHoldingView() {
  const tbody  = document.getElementById('stockTableBody');
  const demat  = document.getElementById('stockDematFilter')?.value || '';
  const market = document.getElementById('stockMarketFilter')?.value || '';

  if (!state.stocks.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:32px;color:#94a3b8;font-size:14px">No stocks added yet. Click "+ Add Stock" to get started.</td></tr>`;
    document.getElementById('stockTableCount').textContent = '';
    return;
  }

  let rows = [...state.stocks].filter(s =>
    (!demat  || s.dematAccount === demat) &&
    (!market || (s.market || 'NSE') === market)
  );

  if (state.stockSortCol) {
    rows.sort((a, b) => {
      let va, vb;
      const pa = state.stockPrices[tickerSym(a)];
      const pb = state.stockPrices[tickerSym(b)];
      if      (state.stockSortCol === 'invested')     { va = (a.shares||0)*(a.avgBuyPrice||0); vb = (b.shares||0)*(b.avgBuyPrice||0); }
      else if (state.stockSortCol === 'currentValue') {
        va = pa?.price ? (a.shares||0)*pa.price : (a.shares||0)*(a.avgBuyPrice||0);
        vb = pb?.price ? (b.shares||0)*pb.price : (b.shares||0)*(b.avgBuyPrice||0);
      }
      else if (state.stockSortCol === 'gain') {
        const iA = (a.shares||0)*(a.avgBuyPrice||0), iB = (b.shares||0)*(b.avgBuyPrice||0);
        va = (pa?.price ? (a.shares||0)*pa.price : iA) - iA;
        vb = (pb?.price ? (b.shares||0)*pb.price : iB) - iB;
      }
      else if (state.stockSortCol === 'returnPct') {
        const iA = (a.shares||0)*(a.avgBuyPrice||0), iB = (b.shares||0)*(b.avgBuyPrice||0);
        const cA = pa?.price ? (a.shares||0)*pa.price : iA;
        const cB = pb?.price ? (b.shares||0)*pb.price : iB;
        va = iA > 0 ? (cA-iA)/iA : 0; vb = iB > 0 ? (cB-iB)/iB : 0;
      }
      else if (state.stockSortCol === 'dayChange') {
        va = pa?.price && pa.prevClose ? (pa.price - pa.prevClose) / pa.prevClose : -Infinity;
        vb = pb?.price && pb.prevClose ? (pb.price - pb.prevClose) / pb.prevClose : -Infinity;
      }
      else { va = a[state.stockSortCol] ?? ''; vb = b[state.stockSortCol] ?? ''; }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return state.stockSortDir === 'asc' ? -1 : 1;
      if (va > vb) return state.stockSortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  syncSortIndicators();

  tbody.innerHTML = rows.map((s, i) => {
    const ticker   = tickerSym(s);
    const isUS     = s.market === 'US';
    const fx       = isUS ? (state.usdInrRate || 0) : 1;
    const cur      = isUS ? '$' : '₹';
    const p        = state.stockPrices[ticker];
    const invested = (s.shares || 0) * (s.avgBuyPrice || 0) * fx;
    const cv       = p?.price ? (s.shares || 0) * p.price * fx : null;
    const gain     = cv != null ? cv - invested : null;
    const retPct   = invested > 0 && gain != null ? (gain / invested) * 100 : null;
    const gainCol  = gain != null ? (gain >= 0 ? '#059669' : '#ef4444') : '#94a3b8';

    let dayChangeTd = `<td class="num"><span style="color:#94a3b8;font-size:11px">—</span></td>`;
    if (p?.price && p.prevClose) {
      const diff      = p.price - p.prevClose;              // native currency ($ or ₹)
      const pct       = (diff / p.prevClose) * 100;
      const totalDiff = (s.shares || 0) * diff;             // native currency total (no FX)
      const col       = diff >= 0 ? '#059669' : '#ef4444';
      const diffStr   = isUS
        ? `${totalDiff >= 0 ? '+' : ''}${cur}${Math.abs(totalDiff).toFixed(2)}`
        : `${totalDiff >= 0 ? '+' : ''}${fmt(Math.round(totalDiff))}`;
      dayChangeTd = `<td class="num" style="color:${col};font-weight:600">${diffStr}
        <div style="font-size:10px">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</div>
      </td>`;
    }

    return `<tr>
      <td style="color:#94a3b8;font-size:11px">${i + 1}</td>
      <td>
        <div class="bond-name">${s.name || s.symbol || '—'}</div>
        <div style="font-size:11px;color:#64748b;font-weight:600;margin-top:2px">${ticker} ${marketBadge(s.market)}</div>
      </td>
      <td style="font-size:12px;color:#475569">${s.dematAccount || '—'}</td>
      <td class="num">${(s.shares || 0).toLocaleString('en-IN')}</td>
      <td class="num">${cur}${(s.avgBuyPrice || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
      <td class="num">
        ${p?.price
          ? `<span style="font-weight:600">${cur}${p.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>`
          : `<span style="color:#94a3b8;font-size:11px">—</span>`}
      </td>
      ${dayChangeTd}
      <td class="num">${invested > 0 ? fmt(Math.round(invested)) : '—'}</td>
      <td class="num" style="font-weight:700">${cv != null ? fmt(Math.round(cv)) : (isUS && !state.usdInrRate ? '<span style="font-size:10px;color:#94a3b8">No FX rate</span>' : '—')}</td>
      <td class="num" style="font-weight:600;color:${gainCol}">${gain != null ? (gain >= 0 ? '+' : '') + fmt(Math.round(gain)) : '—'}</td>
      <td class="num" style="font-weight:600;color:${gainCol}">${retPct != null ? (retPct >= 0 ? '+' : '') + retPct.toFixed(2) + '%' : '—'}</td>
      ${!state.isViewMode ? `<td>
        <div class="actions">
          <button class="btn-icon bi-edit" data-staction="edit"   data-stid="${s.id}" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon bi-del"  data-staction="delete" data-stid="${s.id}" title="Delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </td>` : ''}
    </tr>`;
  }).join('');

  const shown = rows.length, total = state.stocks.length;
  document.getElementById('stockTableCount').textContent = demat
    ? `${shown} of ${total} holding${total !== 1 ? 's' : ''}`
    : `${total} holding${total !== 1 ? 's' : ''}`;

  renderStocksTotals(rows);
}

/* ── BY STOCK ── one row per unique symbol, combined stats ──────── */
function renderByStockView() {
  const tbody    = document.getElementById('stockTableBody');
  const demat    = document.getElementById('stockDematFilter')?.value || '';
  const market   = document.getElementById('stockMarketFilter')?.value || '';
  const filtered = state.stocks.filter(s =>
    (!demat  || s.dematAccount === demat) &&
    (!market || (s.market || 'NSE') === market)
  );

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#94a3b8;font-size:14px">No stocks found.</td></tr>`;
    document.getElementById('stockTableCount').textContent = '';
    return;
  }

  // Group by normalised symbol
  const groups = {};
  filtered.forEach(s => {
    const key = (s.symbol || '?').toUpperCase();
    if (!groups[key]) groups[key] = { symbol: key, name: s.name || key, market: s.market || 'NSE', holdings: [] };
    if (s.name) groups[key].name = s.name;
    groups[key].holdings.push(s);
  });

  syncSortIndicators();

  const rows = Object.values(groups).map(g => {
    const isUS      = g.market === 'US';
    const fx        = isUS ? (state.usdInrRate || 0) : 1;
    const cur       = isUS ? '$' : '₹';
    const ticker    = tickerSym({ symbol: g.symbol, market: g.market });
    const totalShares   = g.holdings.reduce((sum, h) => sum + (h.shares || 0), 0);
    const totalInvested = g.holdings.reduce((sum, h) => sum + (h.shares || 0) * (h.avgBuyPrice || 0), 0) * fx;
    const weightedAvgNative = totalShares > 0
      ? g.holdings.reduce((sum, h) => sum + (h.shares || 0) * (h.avgBuyPrice || 0), 0) / totalShares : 0;
    const dematList = [...new Set(g.holdings.map(h => h.dematAccount).filter(Boolean))].join(', ');

    const p      = state.stockPrices[ticker];
    const cv     = p?.price ? totalShares * p.price * fx : null;
    const gain   = cv != null ? cv - totalInvested : null;
    const retPct = totalInvested > 0 && gain != null ? (gain / totalInvested) * 100 : null;
    const gainCol = gain != null ? (gain >= 0 ? '#059669' : '#ef4444') : '#94a3b8';

    let dayChangeTd = `<td class="num"><span style="color:#94a3b8;font-size:11px">—</span></td>`;
    if (p?.price && p.prevClose) {
      const diff      = p.price - p.prevClose;              // native currency ($ or ₹)
      const pct       = (diff / p.prevClose) * 100;
      const totalDiff = totalShares * diff;                  // native currency total (no FX)
      const col       = diff >= 0 ? '#059669' : '#ef4444';
      const diffStr   = isUS
        ? `${totalDiff >= 0 ? '+' : ''}${cur}${Math.abs(totalDiff).toFixed(2)}`
        : `${totalDiff >= 0 ? '+' : ''}${fmt(Math.round(totalDiff))}`;
      dayChangeTd = `<td class="num" style="color:${col};font-weight:600">${diffStr}
        <div style="font-size:10px">${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%</div>
      </td>`;
    }

    // Sub-rows per holding (indented)
    const subRows = g.holdings.map(h => {
      const hInv    = (h.shares || 0) * (h.avgBuyPrice || 0) * fx;
      const hCv     = p?.price ? (h.shares || 0) * p.price * fx : null;
      const hGain   = hCv != null ? hCv - hInv : null;
      const hRetPct = hInv > 0 && hGain != null ? (hGain / hInv) * 100 : null;
      const hCol    = hGain != null ? (hGain >= 0 ? '#059669' : '#ef4444') : '#94a3b8';
      return `<tr class="stock-sub-row">
        <td></td>
        <td style="padding-left:24px;font-size:11.5px;color:#64748b">${h.dematAccount || '—'}</td>
        <td class="num" style="font-size:11.5px">${(h.shares || 0).toLocaleString('en-IN')}</td>
        <td class="num" style="font-size:11.5px">${cur}${(h.avgBuyPrice || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
        <td></td>
        <td></td>
        <td class="num" style="font-size:11.5px">${hInv > 0 ? fmt(Math.round(hInv)) : '—'}</td>
        <td class="num" style="font-size:11.5px;font-weight:600">${hCv != null ? fmt(Math.round(hCv)) : '—'}</td>
        <td class="num" style="font-size:11.5px;font-weight:600;color:${hCol}">
          ${hGain != null ? (hGain >= 0 ? '+' : '') + fmt(Math.round(hGain)) : '—'}
          ${hRetPct != null ? `<div style="font-size:10px">${hRetPct >= 0 ? '+' : ''}${hRetPct.toFixed(2)}%</div>` : ''}
        </td>
      </tr>`;
    }).join('');

    return `<tr class="stock-group-header">
        <td></td>
        <td>
          <div class="bond-name">${g.name}</div>
          <div style="font-size:11px;color:#64748b;font-weight:600;margin-top:2px">${ticker} ${marketBadge(g.market)}${dematList ? ` · ${dematList}` : ''}</div>
        </td>
        <td class="num" style="font-weight:700">${totalShares.toLocaleString('en-IN')}</td>
        <td class="num" style="font-weight:700">${cur}${weightedAvgNative.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          <div style="font-size:10px;color:#94a3b8;margin-top:1px">${g.holdings.length} account${g.holdings.length > 1 ? 's' : ''}</div>
        </td>
        <td class="num">
          ${p?.price
            ? `<span style="font-weight:600">${cur}${p.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>`
            : `<span style="color:#94a3b8;font-size:11px">—</span>`}
        </td>
        ${dayChangeTd}
        <td class="num">${totalInvested > 0 ? fmt(Math.round(totalInvested)) : '—'}</td>
        <td class="num" style="font-weight:700">${cv != null ? fmt(Math.round(cv)) : '—'}</td>
        <td class="num" style="font-weight:600;color:${gainCol}">
          ${gain != null ? (gain >= 0 ? '+' : '') + fmt(Math.round(gain)) : '—'}
          ${retPct != null ? `<div style="font-size:10px">${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%</div>` : ''}
        </td>
      </tr>
      ${subRows}`;
  });

  tbody.innerHTML = rows.join('');

  const symCount = Object.keys(groups).length;
  document.getElementById('stockTableCount').textContent =
    `${symCount} stock${symCount !== 1 ? 's' : ''} · ${filtered.length} holding${filtered.length !== 1 ? 's' : ''}`;

  renderStocksTotals(filtered);
}

/* ── TOTALS FOOTER ─────────────────────────────────────────────── */
function renderStocksTotals(holdings) {
  const tfoot = document.getElementById('stockTableFoot');
  if (!tfoot) return;

  if (!holdings.length) { tfoot.innerHTML = ''; return; }

  let totalInvested = 0, totalCurrent = 0, totalDayPL = 0, hasDayPL = false;
  holdings.forEach(s => {
    const isUS = s.market === 'US';
    const fx   = isUS ? (state.usdInrRate || 0) : 1;
    const inv  = (s.shares || 0) * (s.avgBuyPrice || 0) * fx;
    totalInvested += inv;
    const p = state.stockPrices[tickerSym(s)];
    totalCurrent += p?.price ? (s.shares || 0) * p.price * fx : inv;
    if (p?.price && p.prevClose) {
      totalDayPL += (s.shares || 0) * (p.price - p.prevClose) * fx;
      hasDayPL = true;
    }
  });

  const gain   = totalCurrent - totalInvested;
  const retPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;
  const col    = gain >= 0 ? '#059669' : '#ef4444';
  const dayCol = totalDayPL >= 0 ? '#059669' : '#ef4444';
  const isVM   = state.isViewMode;
  const viewMode = state.stockViewMode || 'holding';

  // leadCols covers everything up to (but not including) Today's P&L
  const leadCols  = viewMode === 'stock' ? 5 : 6;
  const trailCols = viewMode === 'stock' ? 0 : (isVM ? 0 : 1);

  const dayPLCell = hasDayPL
    ? `<td class="num" style="padding:10px 12px;color:${dayCol}">${totalDayPL >= 0 ? '+' : ''}${fmt(Math.round(totalDayPL))}</td>`
    : `<td class="num" style="padding:10px 12px;color:#94a3b8">—</td>`;

  tfoot.innerHTML = `<tr style="font-weight:700;border-top:1px solid #909090;">
    <td colspan="${leadCols}" style="padding:10px 12px;font-size:12px;color:#94a3b8;text-align:right">Total</td>
    ${dayPLCell}
    <td class="num" style="padding:10px 12px">${fmt(Math.round(totalInvested))}</td>
    <td class="num" style="padding:10px 12px">${fmt(Math.round(totalCurrent))}</td>
    <td class="num" style="padding:10px 12px;color:${col}">${gain >= 0 ? '+' : ''}${fmt(Math.round(gain))}</td>
    <td class="num" style="padding:10px 12px;color:${col}">${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%</td>
    ${trailCols > 0 ? `<td></td>` : ''}
  </tr>`;
}

function syncSortIndicators() {
  document.querySelectorAll('[data-stsort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.stsort === state.stockSortCol)
      th.classList.add(state.stockSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
}

/* ─────────────────────────────────────────────────────────────────
   STOCK MODAL
   ───────────────────────────────────────────────────────────────── */

// Updates symbol hint, placeholder, and price currency label to match chosen market
function updateModalForMarket(market) {
  const isUS = market === 'US';
  document.getElementById('stf-symbol').placeholder     = isUS ? 'e.g. AAPL'      : 'e.g. RELIANCE';
  document.getElementById('stf-symbol-hint').textContent = isUS
    ? 'NYSE / NASDAQ ticker (e.g. AAPL, MSFT, TSLA)'
    : 'NSE ticker (e.g. HDFCBANK, TCS, INFY)';
  document.getElementById('stf-price-label').textContent = isUS
    ? 'Avg Buy Price ($) *'
    : 'Avg Buy Price (₹) *';
}

export function openStockModal(stockId = null) {
  state.editingStockId = stockId;
  const s = stockId ? state.stocks.find(x => x.id === stockId) : null;
  document.getElementById('st-modal-title').textContent = s ? 'Edit Stock' : 'Add Stock';
  document.getElementById('st-save-btn').textContent    = s ? 'Save Changes' : 'Add Stock';
  document.getElementById('stf-name').value         = s?.name         || '';
  document.getElementById('stf-symbol').value       = s?.symbol       || '';
  document.getElementById('stf-market').value       = s?.market       || 'NSE';
  document.getElementById('stf-shares').value       = s?.shares       || '';
  document.getElementById('stf-avgBuyPrice').value  = s?.avgBuyPrice  || '';
  document.getElementById('stf-dematAccount').value = s?.dematAccount || '';
  updateModalForMarket(s?.market || 'NSE');
  document.getElementById('st-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('stf-name').focus(), 50);
}

function closeStockModal() {
  document.getElementById('st-modal').classList.add('hidden');
  document.getElementById('st-form').reset();
  state.editingStockId = null;
}

/* ─────────────────────────────────────────────────────────────────
   EVENT LISTENERS
   ───────────────────────────────────────────────────────────────── */
export function initStockListeners() {
  // Market filter
  document.getElementById('stockMarketFilter').addEventListener('change', renderStocksSection);
  // Demat account filter
  document.getElementById('stockDematFilter').addEventListener('change', renderStocksSection);

  // Market dropdown — update symbol hint and price currency label live
  document.getElementById('stf-market').addEventListener('change', e => {
    updateModalForMarket(e.target.value);
  });

  // View toggle: By Holding / By Stock
  document.getElementById('btn-view-holding').addEventListener('click', () => {
    state.stockViewMode = 'holding';
    updateViewHeaders();
    renderStocksSection();
  });
  document.getElementById('btn-view-stock').addEventListener('click', () => {
    state.stockViewMode = 'stock';
    updateViewHeaders();
    renderStocksSection();
  });

  // Table sort
  document.getElementById('stockTableBody').closest('table').querySelector('thead')
    .addEventListener('click', e => {
      const th = e.target.closest('[data-stsort]');
      if (!th) return;
      const col = th.dataset.stsort;
      if (state.stockSortCol === col) {
        state.stockSortDir = state.stockSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.stockSortCol = col;
        state.stockSortDir = 'asc';
      }
      renderStocksSection();
    });

  // Table row actions (By Holding view only)
  document.getElementById('stockTableBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-staction]');
    if (!btn) return;
    const { staction, stid } = btn.dataset;
    if (staction === 'edit') { openStockModal(stid); return; }
    if (staction === 'delete') {
      if (!confirm('Remove this holding? This cannot be undone.')) return;
      try {
        await deleteStock(stid);
        state.stocks = state.stocks.filter(s => s.id !== stid);
        renderStocksSection();
        toast('Holding removed', 'info');
      } catch (err) { toast('Delete failed: ' + err.message, 'error'); }
    }
  });

  // Refresh prices
  document.getElementById('btn-refresh-stocks').addEventListener('click', fetchAllPrices);

  // Modal open / close
  document.getElementById('btn-add-stock').addEventListener('click', () => openStockModal());
  document.getElementById('st-modal-close').addEventListener('click', closeStockModal);
  document.getElementById('st-cancel-btn').addEventListener('click', closeStockModal);
  document.getElementById('st-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeStockModal();
  });

  // Form submit
  document.getElementById('st-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('st-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    const data = {
      name:         document.getElementById('stf-name').value.trim(),
      symbol:       document.getElementById('stf-symbol').value.trim().toUpperCase(),
      market:       document.getElementById('stf-market').value || 'NSE',
      shares:       parseFloat(document.getElementById('stf-shares').value)      || 0,
      avgBuyPrice:  parseFloat(document.getElementById('stf-avgBuyPrice').value) || 0,
      dematAccount: document.getElementById('stf-dematAccount').value.trim(),
    };
    if (!data.symbol) {
      const symHint = data.market === 'US' ? 'NYSE/NASDAQ symbol (e.g. AAPL)' : 'NSE symbol (e.g. RELIANCE)';
      toast(`Please enter the ${symHint}`, 'error');
      btn.disabled = false;
      btn.textContent = state.editingStockId ? 'Save Changes' : 'Add Stock';
      return;
    }
    try {
      if (state.editingStockId) {
        await updateStock(state.editingStockId, data);
        state.stocks = state.stocks.map(s => s.id === state.editingStockId ? { ...s, ...data } : s);
        toast('Holding updated ✓', 'success');
      } else {
        const ref = await addStock(data);
        state.stocks = [...state.stocks, { id: ref.id, ...data }];
        toast('Holding added ✓', 'success');
      }
      renderStocksSection();
      fetchAllPrices();
      closeStockModal();
    } catch (err) { toast('Error: ' + err.message, 'error'); }
    finally {
      btn.disabled = false;
      btn.textContent = state.editingStockId ? 'Save Changes' : 'Add Stock';
    }
  });
}

/* ─────────────────────────────────────────────────────────────────
   TABLE HEADER SWAP  (different columns for each view)
   ───────────────────────────────────────────────────────────────── */
function updateViewHeaders() {
  const thead = document.getElementById('stockTableHead');
  if (!thead) return;
  const isStock = state.stockViewMode === 'stock';
  const actions = !state.isViewMode ? '<th id="stth-actions"></th>' : '';
  if (isStock) {
    thead.innerHTML = `<tr>
      <th>#</th>
      <th data-stsort="name">Company</th>
      <th class="num" data-stsort="shares">Total Shares</th>
      <th class="num">Wtd Avg Price</th>
      <th class="num">LTP</th>
      <th class="num" data-stsort="dayChange">Today's P&amp;L</th>
      <th class="num" data-stsort="invested">Invested</th>
      <th class="num" data-stsort="currentValue">Current Value</th>
      <th class="num" data-stsort="gain">Gain / Loss</th>
    </tr>`;
  } else {
    thead.innerHTML = `<tr>
      <th>#</th>
      <th data-stsort="name">Company</th>
      <th>Demat Account</th>
      <th class="num" data-stsort="shares">Shares</th>
      <th class="num" data-stsort="avgBuyPrice">Avg Buy</th>
      <th class="num">LTP</th>
      <th class="num" data-stsort="dayChange">Today's P&amp;L</th>
      <th class="num" data-stsort="invested">Invested</th>
      <th class="num" data-stsort="currentValue">Current Value</th>
      <th class="num" data-stsort="gain">Gain / Loss</th>
      <th class="num" data-stsort="returnPct">Return %</th>
      ${actions}
    </tr>`;
  }
}
