import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db }    from './firebase-init.js';
import { state } from './state.js';
import { fmt }   from './utils.js';
import { toast } from './ui.js';

const MFAPI = 'https://api.mfapi.in/mf';

/* ─────────────────────────────────────────────────────────────────
   FIRESTORE REFS
   ───────────────────────────────────────────────────────────────── */
const mfColRef = uid => collection(db, 'users', uid, 'mfs');
const mfDocRef = (uid, id) => doc(db, 'users', uid, 'mfs', id);

/* ─────────────────────────────────────────────────────────────────
   LISTENER
   ───────────────────────────────────────────────────────────────── */
export function startListeningMF(uid) {
  if (state.mfUnsub) { state.mfUnsub(); state.mfUnsub = null; }
  state.mfUnsub = onSnapshot(mfColRef(uid), snap => {
    state.mfs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderMFSection();
    fetchAllNavs();
  }, () => toast('Could not load MF data. Check Firestore rules.', 'error'));
}

/* ─────────────────────────────────────────────────────────────────
   CRUD
   ───────────────────────────────────────────────────────────────── */
export const addMF    = data => addDoc(mfColRef(state.currentUser.uid), { ...data, createdAt: serverTimestamp() });
export const updateMF = (id, data) => updateDoc(mfDocRef(state.currentUser.uid, id), { ...data, updatedAt: serverTimestamp() });
export const deleteMF = id => deleteDoc(mfDocRef(state.currentUser.uid, id));

/* ─────────────────────────────────────────────────────────────────
   NAV FETCH
   ───────────────────────────────────────────────────────────────── */
async function fetchNav(schemeCode) {
  try {
    // Use the full scheme endpoint (not /latest) — it returns history newest-first,
    // so data[0] = today's NAV and data[1] = previous trading day's NAV.
    const res  = await fetch(`${MFAPI}/${schemeCode}`);
    const json = await res.json();
    const data = json.data;
    if (!data?.length) return null;
    return {
      nav:     parseFloat(data[0].nav),
      date:    data[0].date,
      prevNav: data[1] ? parseFloat(data[1].nav) : null,
    };
  } catch { return null; }
}

export async function fetchAllNavs() {
  if (!state.mfs.length) return;
  state.mfNavLoading = true;
  updateRefreshBtn(true);
  const codes = [...new Set(state.mfs.map(m => m.schemeCode).filter(Boolean))];
  await Promise.all(codes.map(async code => {
    const nav = await fetchNav(code);
    if (nav) state.mfNavs[code] = nav;
  }));
  state.mfNavLoading = false;
  state.lastMFNavFetch = Date.now();
  updateRefreshBtn(false);
  renderMFSection();
  window.__renderOverview?.();
}

function updateRefreshBtn(loading) {
  const btn = document.getElementById('btn-refresh-mf');
  if (!btn) return;
  btn.disabled  = loading;
  btn.title     = loading ? 'Fetching NAVs…' : 'Refresh NAVs';
  btn.innerHTML = loading
    ? `<svg viewBox="0 0 24 24" class="spin-icon"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="M21 12a9 9 0 11-2.2-5.8"/></svg> Refreshing…`
    : `<svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M1 4v6h6M23 20v-6h-6"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg> Refresh NAVs`;
}

/* ─────────────────────────────────────────────────────────────────
   CATEGORY HELPERS
   ───────────────────────────────────────────────────────────────── */
function detectCategory(schemeCategory = '') {
  const s = schemeCategory.toLowerCase();
  if (s.includes('elss') || s.includes('tax saver')) return 'ELSS';
  if (s.includes('equity'))   return 'Equity';
  if (s.includes('debt') || s.includes('liquid') || s.includes('overnight') || s.includes('money market')) return 'Debt';
  if (s.includes('hybrid'))   return 'Hybrid';
  if (s.includes('gold') || s.includes('commodity')) return 'Commodity';
  return 'Other';
}

function catBadge(cat) {
  const cls = {
    'Equity':    'badge-mf-equity',
    'Debt':      'badge-mf-debt',
    'Hybrid':    'badge-mf-hybrid',
    'ELSS':      'badge-mf-elss',
    'Commodity': 'badge-mf-commodity',
  }[cat] || 'badge-mf-other';
  return `<span class="badge ${cls}">${cat}</span>`;
}

/* ─────────────────────────────────────────────────────────────────
   KPI CARDS
   ───────────────────────────────────────────────────────────────── */
function renderMFKpis() {
  let totalInvested = 0, totalCurrent = 0, totalDayChange = 0, fundsWithNav = 0, fundsWithPrevNav = 0;
  state.mfs.forEach(m => {
    const inv = (m.units || 0) * (m.avgBuyNav || 0);
    totalInvested += inv;
    const nav = state.mfNavs[m.schemeCode];
    if (nav) {
      totalCurrent += (m.units || 0) * nav.nav;
      fundsWithNav++;
      if (nav.prevNav) {
        totalDayChange += (m.units || 0) * (nav.nav - nav.prevNav);
        fundsWithPrevNav++;
      }
    } else {
      totalCurrent += inv;
    }
  });
  const gain        = totalCurrent - totalInvested;
  const retPct      = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;
  const dayCol      = totalDayChange >= 0 ? '#059669' : '#ef4444';
  const daySign     = totalDayChange >= 0 ? '+' : '';
  const dayNavPct   = totalCurrent > 0 && fundsWithPrevNav > 0
    ? (totalDayChange / (totalCurrent - totalDayChange)) * 100 : null;

  const KSVG = (d, s = '#fff') =>
    `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:none;stroke:${s};stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${d}</svg>`;

  document.getElementById('mfKpiGrid').innerHTML = [
    {
      icon:  KSVG('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>'),
      label: 'Total Invested', cls: 'primary',
      value: fmt(Math.round(totalInvested)),
      sub:   `${state.mfs.length} fund${state.mfs.length !== 1 ? 's' : ''}`,
    },
    {
      icon:  KSVG('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
      label: 'Current Value', cls: gain >= 0 ? 'success' : '',
      value: fmt(Math.round(totalCurrent)),
      sub:   fundsWithNav < state.mfs.length && state.mfs.length > 0
        ? `NAV for ${fundsWithNav}/${state.mfs.length} funds` : 'Live NAV',
    },
    {
      icon:  KSVG('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
      label: 'Total Gain / Loss', cls: gain >= 0 ? 'success' : '',
      value: (gain >= 0 ? '+' : '') + fmt(Math.round(gain)),
      sub:   totalInvested > 0 ? `${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}% return` : '—',
    },
    {
      icon:  KSVG(totalDayChange >= 0
        ? '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'
        : '<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/>',
        totalDayChange >= 0 ? '#059669' : '#ef4444'),
      label: "Last 1 Day Change", cls: '',
      value: `<span style="color:${dayCol}">${daySign}${fmt(Math.round(totalDayChange))}</span>`,
      sub:   dayNavPct != null
        ? `${daySign}${dayNavPct.toFixed(2)}% across ${fundsWithPrevNav} fund${fundsWithPrevNav !== 1 ? 's' : ''}`
        : fundsWithNav > 0 ? 'No prev NAV available' : '—',
    },
  ].map(k => `<div class="kpi-card ${k.cls}">
    <div class="kpi-label">${k.label}</div>
    <div class="kpi-value">${k.value}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`).join('');
}

/* ─────────────────────────────────────────────────────────────────
   MF TABLE
   ───────────────────────────────────────────────────────────────── */
export function renderMFSection() {
  renderMFKpis();
  const tbody = document.getElementById('mfTableBody');

  // Rebuild investor filter options
  const sel  = document.getElementById('mfInvestorFilter');
  if (sel) {
    const prev  = sel.value;
    const names = [...new Set(state.mfs.map(m => m.investedBy).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">All Investors</option>' +
      names.map(n => `<option value="${n}">${n}</option>`).join('');
    if (names.includes(prev)) sel.value = prev;
  }

  const inv = sel?.value || '';

  if (!state.mfs.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:32px;color:#94a3b8;font-size:14px">No mutual funds added yet</td></tr>`;
    document.getElementById('mfTableCount').textContent = '';
    return;
  }

  // Filter + sort
  let sorted = [...state.mfs].filter(m => !inv || m.investedBy === inv);
  if (state.mfSortCol) {
    sorted.sort((a, b) => {
      let va, vb;
      const na = state.mfNavs[a.schemeCode];
      const nb = state.mfNavs[b.schemeCode];
      if (state.mfSortCol === 'lastNav') {
        va = na?.nav ?? 0;
        vb = nb?.nav ?? 0;
      } else if (state.mfSortCol === 'dayChange') {
        va = (na?.prevNav) ? (a.units || 0) * (na.nav - na.prevNav) : 0;
        vb = (nb?.prevNav) ? (b.units || 0) * (nb.nav - nb.prevNav) : 0;
      } else if (state.mfSortCol === 'invested') {
        va = (a.units || 0) * (a.avgBuyNav || 0);
        vb = (b.units || 0) * (b.avgBuyNav || 0);
      } else if (state.mfSortCol === 'currentValue') {
        va = na ? (a.units || 0) * na.nav : (a.units || 0) * (a.avgBuyNav || 0);
        vb = nb ? (b.units || 0) * nb.nav : (b.units || 0) * (b.avgBuyNav || 0);
      } else if (state.mfSortCol === 'gain') {
        const invA = (a.units || 0) * (a.avgBuyNav || 0);
        const invB = (b.units || 0) * (b.avgBuyNav || 0);
        va = (na ? (a.units || 0) * na.nav : invA) - invA;
        vb = (nb ? (b.units || 0) * nb.nav : invB) - invB;
      } else if (state.mfSortCol === 'returnPct') {
        const invA = (a.units || 0) * (a.avgBuyNav || 0);
        const invB = (b.units || 0) * (b.avgBuyNav || 0);
        const cvA  = na ? (a.units || 0) * na.nav : invA;
        const cvB  = nb ? (b.units || 0) * nb.nav : invB;
        va = invA > 0 ? (cvA - invA) / invA : 0;
        vb = invB > 0 ? (cvB - invB) / invB : 0;
      } else {
        va = a[state.mfSortCol] ?? '';
        vb = b[state.mfSortCol] ?? '';
      }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return state.mfSortDir === 'asc' ? -1 : 1;
      if (va > vb) return state.mfSortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  // Update sort indicators
  document.querySelectorAll('[data-mfsort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.mfsort === state.mfSortCol)
      th.classList.add(state.mfSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });

  tbody.innerHTML = sorted.map((m, i) => {
    const nav      = state.mfNavs[m.schemeCode];
    const invested = (m.units || 0) * (m.avgBuyNav || 0);
    const cv       = nav ? (m.units || 0) * nav.nav : null;
    const gain     = cv != null ? cv - invested : null;
    const retPct   = invested > 0 && gain != null ? (gain / invested) * 100 : null;
    const gainCol  = gain != null ? (gain >= 0 ? '#059669' : '#ef4444') : '#94a3b8';

    // 1D change in portfolio value (units × NAV move)
    let dayChangeCell = '<span style="color:#94a3b8;font-size:11px">—</span>';
    if (nav?.prevNav) {
      const navDiff  = nav.nav - nav.prevNav;
      const valDiff  = (m.units || 0) * navDiff;
      const pct      = (navDiff / nav.prevNav) * 100;
      const col      = valDiff >= 0 ? '#059669' : '#ef4444';
      const sign     = valDiff >= 0 ? '+' : '';
      dayChangeCell  = `<span style="font-weight:700;color:${col}">${sign}${fmt(Math.round(valDiff))}</span>
        <div style="font-size:10px;color:${col};margin-top:2px">${sign}${pct.toFixed(2)}%</div>`;
    } else if (nav) {
      dayChangeCell = '<span style="color:#94a3b8;font-size:11px">No prev NAV</span>';
    } else {
      dayChangeCell = '<span style="color:#94a3b8;font-size:11px">Loading…</span>';
    }

    return `<tr>
      <td style="color:#94a3b8;font-size:11px">${i + 1}</td>
      <td>
        <div class="bond-name" style="max-width:190px;white-space:normal;line-height:1.3">${m.name || '—'}</div>
        <div style="margin-top:4px">${catBadge(m.category || 'Other')}</div>
      </td>
      <td class="num">${(m.units || 0).toFixed(3)}</td>
      <td class="num">${m.avgBuyNav ? Number(m.avgBuyNav).toFixed(3) : '—'}</td>
      <td class="num">${nav ? Number(nav.nav).toFixed(3) : '<span style="color:#94a3b8;font-size:11px">—</span>'}</td>
      <td class="num">${dayChangeCell}</td>
      <td class="num">${invested > 0 ? fmt(Math.round(invested)) : '—'}</td>
      <td class="num" style="font-weight:700">${cv != null ? fmt(Math.round(cv)) : '—'}</td>
      <td class="num" style="font-weight:600;color:${gainCol}">${gain != null ? (gain >= 0 ? '+' : '') + fmt(Math.round(gain)) : '—'}</td>
      <td class="num" style="font-weight:600;color:${gainCol}">${retPct != null ? (retPct >= 0 ? '+' : '') + retPct.toFixed(2) + '%' : '—'}</td>
      <td>${m.investedBy || '—'}</td>
      ${!state.isViewMode ? `<td>
        <div class="actions">
          <button class="btn-icon bi-edit" data-mfaction="edit"   data-mfid="${m.id}" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon bi-del"  data-mfaction="delete" data-mfid="${m.id}" title="Delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </td>` : ''}
    </tr>`;
  }).join('');

  // Totals row for visible (filtered) funds
  const tfoot = document.getElementById('mfTableFoot');
  if (tfoot) {
    const totInv = sorted.reduce((s, m) => s + (m.units || 0) * (m.avgBuyNav || 0), 0);
    const totCV  = sorted.reduce((s, m) => {
      const nav = state.mfNavs[m.schemeCode];
      return s + (nav ? (m.units || 0) * nav.nav : (m.units || 0) * (m.avgBuyNav || 0));
    }, 0);
    const totDay = sorted.reduce((s, m) => {
      const nav = state.mfNavs[m.schemeCode];
      return s + (nav?.prevNav ? (m.units || 0) * (nav.nav - nav.prevNav) : 0);
    }, 0);
    const totGain    = totCV - totInv;
    const totRetPct  = totInv > 0 ? (totGain / totInv) * 100 : 0;
    const gainCol    = totGain >= 0 ? '#059669' : '#ef4444';
    const gainSign   = totGain >= 0 ? '+' : '';
    const dayCol     = totDay >= 0 ? '#059669' : '#ef4444';
    const daySign    = totDay >= 0 ? '+' : '';
    tfoot.innerHTML = `<tr class="overview-total-row">
      <td colspan="5"><strong>Total (${sorted.length} fund${sorted.length !== 1 ? 's' : ''})</strong></td>
      <td class="num" style="color:${dayCol}"><strong>${daySign}${fmt(Math.round(totDay))}</strong></td>
      <td class="num"><strong>${fmt(Math.round(totInv))}</strong></td>
      <td class="num"><strong>${fmt(Math.round(totCV))}</strong></td>
      <td class="num" style="color:${gainCol}"><strong>${gainSign}${fmt(Math.round(Math.abs(totGain)))}</strong></td>
      <td class="num" style="color:${gainCol}"><strong>${gainSign}${totRetPct.toFixed(2)}%</strong></td>
      <td></td>
      ${!state.isViewMode ? '<td></td>' : ''}
    </tr>`;
  }

  const shown = sorted.length;
  const total = state.mfs.length;
  document.getElementById('mfTableCount').textContent = inv
    ? `${shown} of ${total} fund${total !== 1 ? 's' : ''}`
    : `${total} fund${total !== 1 ? 's' : ''}`;
}

/* ─────────────────────────────────────────────────────────────────
   FUND SEARCH (typeahead)
   ───────────────────────────────────────────────────────────────── */
let searchTimer = null;

async function searchFunds(q) {
  if (!q || q.length < 2) { hideFundDropdown(); return; }
  try {
    const res  = await fetch(`${MFAPI}/search?q=${encodeURIComponent(q)}`);
    const list = await res.json();
    showFundDropdown(Array.isArray(list) ? list.slice(0, 9) : []);
  } catch { hideFundDropdown(); }
}

function showFundDropdown(results) {
  let dd = document.getElementById('mf-fund-dropdown');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'mf-fund-dropdown';
    dd.className = 'fund-dropdown';
    document.getElementById('mf-fund-search-wrap').appendChild(dd);
  }
  if (!results.length) {
    dd.innerHTML = `<div class="fund-dd-empty">No funds found</div>`;
  } else {
    dd.innerHTML = results.map(r =>
      `<div class="fund-dd-item" data-code="${r.schemeCode}" data-name="${(r.schemeName || '').replace(/"/g, '&quot;')}">${r.schemeName}</div>`
    ).join('');
    dd.querySelectorAll('.fund-dd-item').forEach(item => {
      item.addEventListener('mousedown', e => {
        e.preventDefault(); // prevent blur before click
        selectFund(item.dataset.code, item.dataset.name);
      });
    });
  }
  dd.style.display = 'block';
}

function hideFundDropdown() {
  const dd = document.getElementById('mf-fund-dropdown');
  if (dd) dd.style.display = 'none';
}

async function selectFund(code, name) {
  document.getElementById('mf-fund-search').value = name;
  document.getElementById('mff-schemeCode').value  = code;
  hideFundDropdown();
  await fetchAndFillMeta(code);
}

async function fetchAndFillMeta(code) {
  const status = document.getElementById('mff-scheme-status');
  if (!code) { status.textContent = ''; return; }
  status.style.color = '#94a3b8';
  status.textContent = 'Verifying scheme code…';
  try {
    const res  = await fetch(`${MFAPI}/${code}/latest`);
    const json = await res.json();
    if (!json.meta?.scheme_name) {
      status.style.color = '#ef4444';
      status.textContent = 'Scheme code not found. Check and retry.';
      return;
    }
    const cat = detectCategory(json.meta?.scheme_category || '');
    document.getElementById('mff-category').value = cat;
    // Fill fund name from meta if search box is empty
    if (!document.getElementById('mf-fund-search').value.trim()) {
      document.getElementById('mf-fund-search').value = json.meta.scheme_name;
    }
    // Pre-fill current NAV into avg buy NAV only if empty
    const curNav = parseFloat(json.data?.[0]?.nav);
    if (curNav && !document.getElementById('mff-avgBuyNav').value) {
      document.getElementById('mff-avgBuyNav').value = curNav.toFixed(3);
    }
    status.style.color = '#059669';
    status.textContent = `✓ ${json.meta.scheme_name}`;
  } catch {
    status.style.color = '#ef4444';
    status.textContent = 'Could not verify scheme code.';
  }
}

/* ─────────────────────────────────────────────────────────────────
   MF MODAL
   ───────────────────────────────────────────────────────────────── */
export function openMFModal(mfId = null) {
  state.editingMFId = mfId;
  const m = mfId ? state.mfs.find(x => x.id === mfId) : null;
  document.getElementById('mf-modal-title').textContent = m ? 'Edit Fund' : 'Add Mutual Fund';
  document.getElementById('mf-save-btn').textContent    = m ? 'Save Changes' : 'Add Fund';
  document.getElementById('mf-fund-search').value  = m?.name        || '';
  document.getElementById('mff-schemeCode').value   = m?.schemeCode  || '';
  document.getElementById('mff-category').value     = m?.category    || '';
  document.getElementById('mff-units').value        = m?.units       || '';
  document.getElementById('mff-avgBuyNav').value    = m?.avgBuyNav   || '';
  document.getElementById('mff-investedBy').value   = m?.investedBy  || '';
  hideFundDropdown();
  document.getElementById('mf-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('mf-fund-search').focus(), 50);
}

function closeMFModal() {
  document.getElementById('mf-modal').classList.add('hidden');
  document.getElementById('mf-form').reset();
  document.getElementById('mff-scheme-status').textContent = '';
  hideFundDropdown();
  state.editingMFId = null;
}

/* ─────────────────────────────────────────────────────────────────
   EVENT LISTENERS
   ───────────────────────────────────────────────────────────────── */
export function initMFListeners() {
  // Investor filter
  document.getElementById('mfInvestorFilter').addEventListener('change', renderMFSection);

  // Table sort
  document.getElementById('mfTableBody').closest('table').querySelector('thead').addEventListener('click', e => {
    const th = e.target.closest('[data-mfsort]');
    if (!th) return;
    const col = th.dataset.mfsort;
    if (state.mfSortCol === col) {
      state.mfSortDir = state.mfSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.mfSortCol = col;
      state.mfSortDir = 'asc';
    }
    renderMFSection();
  });

  // Table row actions
  document.getElementById('mfTableBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-mfaction]');
    if (!btn) return;
    const { mfaction, mfid } = btn.dataset;
    if (mfaction === 'edit')   { openMFModal(mfid); return; }
    if (mfaction === 'delete') {
      if (!confirm('Remove this fund from tracking? This cannot be undone.')) return;
      try {
        await deleteMF(mfid);
        state.mfs = state.mfs.filter(m => m.id !== mfid);
        renderMFSection();
        toast('Fund removed', 'info');
      }
      catch (err) { toast('Delete failed: ' + err.message, 'error'); }
    }
  });

  // Refresh NAVs button
  document.getElementById('btn-refresh-mf').addEventListener('click', fetchAllNavs);

  // Modal open / close
  document.getElementById('btn-add-mf').addEventListener('click', () => openMFModal());
  document.getElementById('mf-modal-close').addEventListener('click', closeMFModal);
  document.getElementById('mf-cancel-btn').addEventListener('click', closeMFModal);
  document.getElementById('mf-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeMFModal(); });

  // Fund search typeahead
  document.getElementById('mf-fund-search').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchFunds(e.target.value.trim()), 300);
  });
  document.getElementById('mf-fund-search').addEventListener('blur', () => {
    setTimeout(hideFundDropdown, 150);
  });

  // Manual scheme code entry — verify when user finishes typing
  let schemeTimer = null;
  document.getElementById('mff-schemeCode').addEventListener('input', e => {
    const code = e.target.value.trim();
    clearTimeout(schemeTimer);
    document.getElementById('mff-scheme-status').textContent = '';
    if (code.length >= 4) {
      schemeTimer = setTimeout(() => fetchAndFillMeta(code), 600);
    }
  });

  // Lookup link — opens MFAPI search in new tab
  document.getElementById('mff-lookup-hint').addEventListener('click', () => {
    const q = document.getElementById('mf-fund-search').value.trim();
    const url = q
      ? `https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`
      : 'https://api.mfapi.in/mf/search?q=';
    window.open(url, '_blank');
  });

  // Form submit
  document.getElementById('mf-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('mf-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    const data = {
      name:        document.getElementById('mf-fund-search').value.trim(),
      schemeCode:  document.getElementById('mff-schemeCode').value.trim(),
      category:    document.getElementById('mff-category').value.trim() || 'Other',
      units:       parseFloat(document.getElementById('mff-units').value)     || 0,
      avgBuyNav:   parseFloat(document.getElementById('mff-avgBuyNav').value) || 0,
      investedBy:  document.getElementById('mff-investedBy').value.trim(),
    };
    if (!data.name || !data.schemeCode) {
      toast('Please select a fund from the search results', 'error');
      btn.disabled = false; btn.textContent = state.editingMFId ? 'Save Changes' : 'Add Fund';
      return;
    }
    try {
      if (state.editingMFId) {
        await updateMF(state.editingMFId, data);
        // Optimistic update — patch state immediately
        state.mfs = state.mfs.map(m => m.id === state.editingMFId ? { ...m, ...data } : m);
        toast('Fund updated ✓', 'success');
      } else {
        const ref = await addMF(data);
        // Optimistic update — push new item immediately
        state.mfs = [...state.mfs, { id: ref.id, ...data }];
        toast('Fund added ✓', 'success');
      }
      renderMFSection();
      closeMFModal();
    } catch (err) { toast('Error: ' + err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = state.editingMFId ? 'Save Changes' : 'Add Fund'; }
  });
}
