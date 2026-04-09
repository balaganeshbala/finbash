import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db }    from './firebase-init.js';
import { state } from './state.js';
import { fmt }   from './utils.js';
import { toast } from './ui.js';

/* ─────────────────────────────────────────────────────────────────
   CONSTANTS
   ───────────────────────────────────────────────────────────────── */
export const FUND_MANAGERS = [
  'SBI Pension Funds',
  'LIC Pension Fund',
  'HDFC Pension Management',
  'Kotak Pension Fund',
  'UTI Retirement Solutions',
  'Aditya Birla Sun Life Pension',
  'Max Life Pension Fund',
  'Tata Pension Management',
  'Axis Pension Fund',
];

const ASSET_CLASSES = {
  E: 'Equity',
  C: 'Corporate Bonds',
  G: 'Govt Securities',
  A: 'Alternate Assets',
};

/* ─────────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────────── */
function schemeBadge(cls) {
  const colors = {
    E: { bg: '#dbeafe', color: '#1d4ed8' },
    C: { bg: '#fef3c7', color: '#92400e' },
    G: { bg: '#d1fae5', color: '#065f46' },
    A: { bg: '#ede9fe', color: '#5b21b6' },
  };
  const c = colors[cls] || { bg: '#f1f5f9', color: '#475569' };
  return `<span class="badge" style="background:${c.bg};color:${c.color};font-size:10px">Scheme ${cls}</span>`;
}

function tierBadge(tier) {
  return tier === 'II'
    ? `<span class="badge" style="background:#fce7f3;color:#9d174d;font-size:10px">Tier II</span>`
    : `<span class="badge" style="background:#e0f2fe;color:#0369a1;font-size:10px">Tier I</span>`;
}

/* ─────────────────────────────────────────────────────────────────
   FIRESTORE
   ───────────────────────────────────────────────────────────────── */
const npsColRef = uid => collection(db, 'users', uid, 'nps');
const npsDocRef = (uid, id) => doc(db, 'users', uid, 'nps', id);

export function startListeningNPS(uid) {
  if (state.npsUnsub) { state.npsUnsub(); state.npsUnsub = null; }
  state.npsUnsub = onSnapshot(
    npsColRef(uid),
    snap => {
      state.nps = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderNPSSection();
      fetchAllNPSNavs();
    },
    () => toast('Could not load NPS data. Check Firestore rules.', 'error'),
  );
}

/* ─────────────────────────────────────────────────────────────────
   LIVE NAV FETCH  (via Vercel proxy → npsnav.in / Protean NSDL)
   The proxy lives in stock-price-proxy/api/nps-nav.ts and avoids
   browser CORS restrictions when calling npsnav.in directly.
   ───────────────────────────────────────────────────────────────── */
const NPS_PROXY = 'https://stock-price-proxy.vercel.app/api/nps-nav';

// ── Scheme-code lookup table ─────────────────────────────────────────────────
// Key: "fundManager|tier|assetClass"  →  npsnav.in scheme code (SM________)
// Confirmed codes are marked; inferred ones follow the sequential numbering
// pattern observed on npsnav.in. Users can always override in the modal.
export const NPS_SCHEME_CODES = {
  // SBI Pension Funds (SM001 — has Central/State Govt at 001/002)
  'SBI Pension Funds|I|E':              'SM001003',
  'SBI Pension Funds|I|C':             'SM001004',
  'SBI Pension Funds|I|G':             'SM001005',
  'SBI Pension Funds|I|A':             'SM001012',
  'SBI Pension Funds|II|E':            'SM001006',
  'SBI Pension Funds|II|C':            'SM001007',
  'SBI Pension Funds|II|G':            'SM001008',

  // UTI Retirement Solutions (SM002 — has Central/State Govt at 001/002)
  'UTI Retirement Solutions|I|E':      'SM002003',
  'UTI Retirement Solutions|I|C':      'SM002004',
  'UTI Retirement Solutions|I|G':      'SM002005',
  'UTI Retirement Solutions|I|A':      'SM002012',
  'UTI Retirement Solutions|II|E':     'SM002006',
  'UTI Retirement Solutions|II|C':     'SM002007',
  'UTI Retirement Solutions|II|G':     'SM002008',

  // LIC Pension Fund (SM003 — has Central/State Govt at 001/002)
  'LIC Pension Fund|I|E':              'SM003005',
  'LIC Pension Fund|I|C':             'SM003006',
  'LIC Pension Fund|I|G':             'SM003007',
  'LIC Pension Fund|I|A':             'SM003012',
  'LIC Pension Fund|II|E':            'SM003008',
  'LIC Pension Fund|II|C':            'SM003009',
  'LIC Pension Fund|II|G':            'SM003010',

  // Kotak Pension Fund (SM005 — no govt schemes, starts at 001)
  'Kotak Pension Fund|I|E':            'SM005001',
  'Kotak Pension Fund|I|C':           'SM005002',
  'Kotak Pension Fund|I|G':           'SM005003',
  'Kotak Pension Fund|I|A':           'SM005007',
  'Kotak Pension Fund|II|E':          'SM005004',
  'Kotak Pension Fund|II|C':          'SM005005',
  'Kotak Pension Fund|II|G':          'SM005006',

  // HDFC Pension Management (SM008 — no govt schemes)
  'HDFC Pension Management|I|E':       'SM008001',
  'HDFC Pension Management|I|C':      'SM008002',
  'HDFC Pension Management|I|G':      'SM008003',
  'HDFC Pension Management|I|A':      'SM008008',
  'HDFC Pension Management|II|E':     'SM008004',
  'HDFC Pension Management|II|C':     'SM008005',
  'HDFC Pension Management|II|G':     'SM008006',
  'HDFC Pension Management|II|A':     'SM008007',

  // Aditya Birla Sun Life Pension (SM010)
  'Aditya Birla Sun Life Pension|I|E':  'SM010001',
  'Aditya Birla Sun Life Pension|I|C': 'SM010002',
  'Aditya Birla Sun Life Pension|I|G': 'SM010003',
  'Aditya Birla Sun Life Pension|I|A': 'SM010004',
  'Aditya Birla Sun Life Pension|II|E':'SM010005',
  'Aditya Birla Sun Life Pension|II|C':'SM010006',
  'Aditya Birla Sun Life Pension|II|G':'SM010007',

  // Tata Pension Management (SM011)
  'Tata Pension Management|I|E':       'SM011001',
  'Tata Pension Management|I|C':      'SM011002',
  'Tata Pension Management|I|G':      'SM011003',
  'Tata Pension Management|I|A':      'SM011004',
  'Tata Pension Management|II|E':     'SM011005',
  'Tata Pension Management|II|C':     'SM011006',
  'Tata Pension Management|II|G':     'SM011007',

  // Max Life Pension Fund (SM012)
  'Max Life Pension Fund|I|E':         'SM012001',
  'Max Life Pension Fund|I|C':        'SM012002',
  'Max Life Pension Fund|I|G':        'SM012003',
  'Max Life Pension Fund|I|A':        'SM012004',
  'Max Life Pension Fund|II|E':       'SM012005',
  'Max Life Pension Fund|II|C':       'SM012006',
  'Max Life Pension Fund|II|G':       'SM012007',

  // Axis Pension Fund (SM013)
  'Axis Pension Fund|I|E':             'SM013001',
  'Axis Pension Fund|I|C':            'SM013002',
  'Axis Pension Fund|I|G':            'SM013003',
  'Axis Pension Fund|I|A':            'SM013004',
  'Axis Pension Fund|II|E':           'SM013005',
  'Axis Pension Fund|II|C':           'SM013006',
  'Axis Pension Fund|II|G':           'SM013007',
};

export function schemeCodeFor(fundManager, tier, assetClass) {
  return NPS_SCHEME_CODES[`${fundManager}|${tier}|${assetClass}`] || '';
}

function updateNPSRefreshBtn(loading) {
  const btn = document.getElementById('btn-refresh-nps-nav');
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;animation:spin 1s linear infinite"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg> Fetching…`
    : `<svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg> Refresh NAV`;
}

export async function fetchAllNPSNavs() {
  if (!state.nps.length) return;
  state.npsNavLoading = true;
  updateNPSRefreshBtn(true);

  // Collect unique scheme codes across all NPS records
  // Use the stored schemeCode field first; fall back to the lookup table
  const toFetch = new Map(); // schemeCode → { fundManager, tier, assetClass }
  state.nps.forEach(n => {
    const code = n.schemeCode || schemeCodeFor(n.fundManager, n.tier, n.assetClass);
    if (code) toFetch.set(code, { fundManager: n.fundManager, tier: n.tier, assetClass: n.assetClass });
  });

  if (!toFetch.size) {
    toast('No scheme codes found — add a scheme code to your NPS entries to enable live NAV.', 'warn');
    state.npsNavLoading = false;
    updateNPSRefreshBtn(false);
    return;
  }

  try {
    // Single call — proxy fetches npsnav.in/api/latest-min and returns:
    // { lastUpdated: "07-04-2026", navs: { "SM008001": 51.2367, ... } }
    const res = await fetch(NPS_PROXY);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const { lastUpdated, navs } = await res.json();

    // lastUpdated is "DD-MM-YYYY" — parse manually to avoid JS treating it as MM-DD
    let date = null;
    if (lastUpdated) {
      const [dd, mm, yyyy] = lastUpdated.split('-');
      const d = new Date(+yyyy, +mm - 1, +dd);
      if (!isNaN(d.getTime())) {
        date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
      }
    }

    state.npsNavs = {};
    let fetched = 0, missing = 0;

    for (const [code, { fundManager, tier, assetClass }] of toFetch) {
      const nav = navs[code];
      if (nav != null && nav > 0) {
        state.npsNavs[`${fundManager}|${tier}|${assetClass}`] = { nav, date };
        fetched++;
      } else {
        console.warn(`No NAV in API response for scheme code: ${code}`);
        missing++;
      }
    }

    renderNPSSection();
    window.__renderOverview?.();

    if (fetched === 0) {
      toast('Could not match any NPS schemes. Check scheme codes.', 'error');
    } else if (missing > 0) {
      toast(`NAV updated for ${fetched} scheme(s). ${missing} scheme code(s) not found in API.`, 'warn');
    }
  } catch (e) {
    console.warn('NPS NAV fetch failed:', e);
    toast('Could not fetch NPS NAV. Check your connection.', 'error');
  } finally {
    state.npsNavLoading = false;
    updateNPSRefreshBtn(false);
  }
}

export const addNPS    = data => addDoc(npsColRef(state.currentUser.uid), { ...data, createdAt: serverTimestamp() });
export const updateNPS = (id, data) => updateDoc(npsDocRef(state.currentUser.uid, id), { ...data, updatedAt: serverTimestamp() });
export const deleteNPS = id => deleteDoc(npsDocRef(state.currentUser.uid, id));


function getFilteredNPS() {
  const f = document.getElementById('npsPranFilter')?.value;
  return f ? state.nps.filter(n => (n.pran || 'Unknown') === f) : state.nps;
}

function updateNPSFilterOptions() {
  const filter = document.getElementById('npsPranFilter');
  if (!filter) return;
  const currentVal = filter.value;
  
  const prans = [...new Set(state.nps.map(n => n.pran || 'Unknown'))].sort();
  
  if (prans.length <= 1) {
    filter.style.display = 'none';
  } else {
    filter.style.display = '';
    let html = '<option value="">All Accounts</option>';
    prans.forEach(p => {
      const subName = state.nps.find(n => (n.pran || 'Unknown') === p)?.subscriberName || 'Unknown';
      const label = p !== 'Unknown' ? `${p} (${subName})` : 'Unknown PRAN';
      html += `<option value="${p}">${label}</option>`;
    });
    filter.innerHTML = html;
    if (prans.includes(currentVal)) {
      filter.value = currentVal;
    } else {
      filter.value = '';
    }
  }
}

/* ─────────────────────────────────────────────────────────────────
   KPI CARDS
   ───────────────────────────────────────────────────────────────── */
function liveNav(n) {
  const key = `${n.fundManager}|${n.tier}|${n.assetClass}`;
  return state.npsNavs[key]?.nav || n.currentNav || null;
}

function liveNavDate(n) {
  const key = `${n.fundManager}|${n.tier}|${n.assetClass}`;
  return state.npsNavs[key]?.date || n.navDate || null;
}

function renderNPSKpis() {
  let totalInvested = 0, totalCurrent = 0, withNav = 0;
  const npsList = getFilteredNPS();
  npsList.forEach(n => {
    const inv = n.totalContributed != null ? n.totalContributed : (n.units || 0) * (n.avgBuyNav || 0);
    totalInvested += inv;
    const nav = liveNav(n);
    if (nav) {
      totalCurrent += (n.units || 0) * nav;
      withNav++;
    } else {
      totalCurrent += inv;
    }
  });

  const gain   = totalCurrent - totalInvested;
  const retPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;

  const KSVG = (d, s = '#fff') =>
    `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:none;stroke:${s};stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${d}</svg>`;

  document.getElementById('npsKpiGrid').innerHTML = [
    {
      icon:  KSVG('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>'),
      label: 'Total Invested', cls: 'primary',
      value: fmt(Math.round(totalInvested)),
      sub:   `${npsList.length} scheme${npsList.length !== 1 ? 's' : ''}`,
    },
    {
      icon:  KSVG('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
      label: 'Current Value', cls: 'success',
      value: fmt(Math.round(totalCurrent)),
      sub:   withNav < npsList.length && npsList.length > 0
        ? `NAV for ${withNav}/${npsList.length} schemes`
        : withNav > 0 ? 'Based on latest NAV' : 'Enter NAV to see value',
    },
    {
      icon:  KSVG('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
      label: 'Total Gain / Loss', cls: gain >= 0 ? 'success' : '',
      value: (gain >= 0 ? '+' : '') + fmt(Math.round(gain)),
      sub:   totalInvested > 0 ? `${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}% overall` : '—',
    },
    {
      icon:  KSVG('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
      label: 'Account Type', cls: '',
      value: 'NPS',
      sub:   'National Pension System · PFRDA regulated',
    },
  ].map(k => `<div class="kpi-card ${k.cls}">
    <div class="kpi-icon">${k.icon}</div>
    <div class="kpi-label">${k.label}</div>
    <div class="kpi-value">${k.value}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`).join('');
}

/* ─────────────────────────────────────────────────────────────────
   TABLE
   ───────────────────────────────────────────────────────────────── */
function renderNPSTable() {
  const tbody = document.getElementById('npsTableBody');
  const tfoot = document.getElementById('npsTableFoot');

  const npsList = getFilteredNPS();
  if (!npsList.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:32px;color:#94a3b8;font-size:14px">No NPS schemes added yet. Click "+ Add Scheme" to get started.</td></tr>`;
    tfoot.innerHTML = '';
    return;
  }

  // Sort by PRAN, then tier, then asset
  const rows = [...npsList].sort((a, b) => {
    if ((a.pran || '') !== (b.pran || '')) return (a.pran || '').localeCompare(b.pran || '');
    if ((a.tier || '') !== (b.tier || '')) return (a.tier || '') < (b.tier || '') ? -1 : 1;
    return (a.assetClass || '').localeCompare(b.assetClass || '');
  });

  let totInvested = 0, totCurrent = 0;

  tbody.innerHTML = rows.map((n, i) => {
    const inv     = n.totalContributed != null ? n.totalContributed : (n.units || 0) * (n.avgBuyNav || 0);
    const nav     = liveNav(n);
    const cv      = nav ? (n.units || 0) * nav : null;
    const gain    = cv != null ? cv - inv : null;
    const retPct  = inv > 0 && gain != null ? (gain / inv) * 100 : null;
    const gainCol = gain != null ? (gain >= 0 ? '#059669' : '#ef4444') : '#94a3b8';

    totInvested += inv;
    totCurrent  += cv != null ? cv : inv;

    const navDate    = liveNavDate(n);
    const isLive     = !!state.npsNavs[`${n.fundManager}|${n.tier}|${n.assetClass}`];
    // Parse date robustly — API may return "07-Apr-2026", "2026-04-07", or a locale string
    let navDateStr = null;
    if (navDate) {
      const d = new Date(navDate);
      navDateStr = isNaN(d.getTime())
        ? navDate   // unrecognised format — display as-is
        : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
    }

    return `<tr>
      <td style="color:#94a3b8;font-size:11px">${i + 1}</td>
      <td>
        <div class="bond-name">${n.fundManager || '—'}</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px">
          ${n.pran ? `<span style="color:#475569;font-weight:600;margin-right:6px">PRAN: ${n.pran}</span>` : ''}
          ${tierBadge(n.tier)} ${schemeBadge(n.assetClass)}
          <span style="color:#94a3b8;margin-left:3px">${ASSET_CLASSES[n.assetClass] || ''}</span>
        </div>
      </td>
      <td class="num">${(n.units || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })}</td>
      <td class="num">₹${(n.avgBuyNav || 0).toFixed(4)}</td>
      <td class="num">
        ${nav
          ? `<span style="font-weight:600">₹${nav.toFixed(4)}</span>
             ${navDateStr ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px">as on ${navDateStr}</div>` : ''}`
          : `<span style="font-size:11px;color:#94a3b8">—</span>`}
      </td>
      <td class="num">${inv > 0 ? fmt(Math.round(inv)) : '—'}</td>
      <td class="num" style="font-weight:700">${cv != null ? fmt(Math.round(cv)) : '—'}</td>
      <td class="num" style="font-weight:600;color:${gainCol}">
        ${gain != null ? (gain >= 0 ? '+' : '') + fmt(Math.round(gain)) : '—'}
        ${retPct != null ? `<div style="font-size:10px">${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%</div>` : ''}
      </td>
      ${!state.isViewMode ? `<td>
        <div class="actions">
          <button class="btn-icon bi-edit" data-npsaction="edit"   data-npsid="${n.id}" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon bi-del"  data-npsaction="delete" data-npsid="${n.id}" title="Delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </td>` : ''}
    </tr>`;
  }).join('');

  // Totals footer
  const gain   = totCurrent - totInvested;
  const col    = gain >= 0 ? '#059669' : '#ef4444';
  const retPct = totInvested > 0 ? (gain / totInvested) * 100 : 0;

  tfoot.innerHTML = `<tr style="font-weight:700;border-top:1px solid #909090">
    <td colspan="5" style="padding:10px 12px;font-size:12px;color:#94a3b8;text-align:right">Total</td>
    <td class="num" style="padding:10px 12px">${fmt(Math.round(totInvested))}</td>
    <td class="num" style="padding:10px 12px">${fmt(Math.round(totCurrent))}</td>
    <td class="num" style="padding:10px 12px;color:${col}">
      ${gain >= 0 ? '+' : ''}${fmt(Math.round(gain))}
      <div style="font-size:10px">${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%</div>
    </td>
    ${!state.isViewMode ? '<td></td>' : ''}
  </tr>`;
}

/* ─────────────────────────────────────────────────────────────────
   YEAR-WISE BREAKDOWN TABLE
   ───────────────────────────────────────────────────────────────── */
function renderNPSYearlyBreakdown() {
  const container = document.getElementById('npsYearlyBreakdown');
  if (!container) return;
  const npsList = getFilteredNPS();
  if (!npsList.length) { container.innerHTML = ''; return; }

  // Group current schemes by PRAN so we can render one table per PRAN
  const prans = [...new Set(npsList.map(n => n.pran || 'Unknown'))].sort();

  let html = '';

  prans.forEach(targetPran => {
    const subset = npsList.filter(n => (n.pran || 'Unknown') === targetPran);
    const subName = subset[0]?.subscriberName || 'Unknown';

    // Aggregate annualContributions across all schemes in this subset
    const yearMap = {};
    subset.forEach(n => {
      if (!n.annualContributions) return;
      Object.entries(n.annualContributions).forEach(([year, data]) => {
        if (!yearMap[year]) yearMap[year] = { voluntary: 0, employer: 0, switchIn: 0, switchOut: 0, charges: 0, net: 0 };
        if (typeof data === 'object') {
          yearMap[year].voluntary += data.voluntary || 0;
          yearMap[year].employer  += data.employer  || 0;
          yearMap[year].switchIn  += data.switchIn  || 0;
          yearMap[year].switchOut += data.switchOut || 0;
          yearMap[year].charges   += data.charges   || 0;
          yearMap[year].net       += data.net !== undefined
            ? data.net
            : ((data.voluntary || 0) + (data.employer || 0) + (data.switchIn || 0) - (data.switchOut || 0));
        } else {
          yearMap[year].voluntary += data;
          yearMap[year].net       += data;
        }
      });
    });

    const years = Object.keys(yearMap).sort();
    if (!years.length) return;

    // Column visibility
    const hasEmployer = years.some(y => yearMap[y].employer > 0);
    const hasSwitch   = years.some(y => yearMap[y].switchIn > 0 || yearMap[y].switchOut > 0);
    const hasCharges  = years.some(y => yearMap[y].charges > 0);

    // Running totals
    let totVoluntary = 0, totEmployer = 0, totSwitchIn = 0, totSwitchOut = 0, totCharges = 0, totNet = 0;
    years.forEach(y => {
      totVoluntary += yearMap[y].voluntary;
      totEmployer  += yearMap[y].employer;
      totSwitchIn  += yearMap[y].switchIn;
      totSwitchOut += yearMap[y].switchOut;
      totCharges   += yearMap[y].charges;
      totNet       += yearMap[y].net;
    });

    // "2022-03-31" → "FY 2021–22"
    function fyLabel(iso) {
      const yr = parseInt(iso.slice(0, 4), 10);
      const mo = parseInt(iso.slice(5, 7), 10);
      const endYY = mo <= 3 ? yr : yr + 1;
      return `FY ${endYY - 1}–${String(endYY).slice(2)}`;
    }

    const N = (v, neg = false) => v > 0
      ? `<span style="color:${neg ? '#ef4444' : 'inherit'}">${neg ? '−' : ''}${fmt(Math.round(v))}</span>`
      : `<span style="color:#94a3b8">—</span>`;

    const titlePrefix = targetPran !== 'Unknown'
      ? `Year-wise Contribution Breakdown — PRAN: ${targetPran}`
      : 'Year-wise Contribution Breakdown';
    const subTitle = targetPran !== 'Unknown' && subName !== 'Unknown'
      ? `<span style="font-size:12px;font-weight:500;color:#64748b;margin-top:2px">${subName}</span>`
      : '';

    html += `
      <div class="card" style="margin-top:20px">
        <div class="card-title"><span style="display:flex;flex-direction:column;gap:2px">${titlePrefix}${subTitle}</span></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>Financial Year</th>
              <th class="num">Your Contributions</th>
              ${hasEmployer ? '<th class="num">Employer Contributions</th>' : ''}
              ${hasSwitch   ? '<th class="num">Switch In</th><th class="num">Switch Out</th>' : ''}
              ${hasCharges  ? '<th class="num">Intermediary Charges</th>' : ''}
              <th class="num" style="font-weight:700">Net Invested</th>
            </tr></thead>
            <tbody>
              ${years.map(y => `<tr>
                <td style="font-weight:500">${fyLabel(y)}</td>
                <td class="num">${N(yearMap[y].voluntary)}</td>
                ${hasEmployer ? `<td class="num">${N(yearMap[y].employer)}</td>` : ''}
                ${hasSwitch   ? `<td class="num">${N(yearMap[y].switchIn)}</td><td class="num">${N(yearMap[y].switchOut, true)}</td>` : ''}
                ${hasCharges  ? `<td class="num">${N(yearMap[y].charges, true)}</td>` : ''}
                <td class="num" style="font-weight:600">${fmt(Math.round(yearMap[y].net))}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr style="font-weight:700;border-top:1px solid #909090">
              <td style="padding:10px 12px;font-size:12px;color:#94a3b8;text-align:right">Total</td>
              <td class="num" style="padding:10px 12px">${fmt(Math.round(totVoluntary))}</td>
              ${hasEmployer ? `<td class="num" style="padding:10px 12px">${fmt(Math.round(totEmployer))}</td>` : ''}
              ${hasSwitch   ? `<td class="num" style="padding:10px 12px">${N(totSwitchIn)}</td><td class="num" style="padding:10px 12px">${N(totSwitchOut, true)}</td>` : ''}
              ${hasCharges  ? `<td class="num" style="padding:10px 12px">${N(totCharges, true)}</td>` : ''}
              <td class="num" style="padding:10px 12px">${fmt(Math.round(totNet))}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

/* ─────────────────────────────────────────────────────────────────
   MAIN RENDER
   ───────────────────────────────────────────────────────────────── */
export function renderNPSSection() {
  updateNPSFilterOptions();
  renderNPSKpis();
  renderNPSTable();
  renderNPSYearlyBreakdown();
  window.__renderOverview?.();
}

/* ─────────────────────────────────────────────────────────────────
   MODAL
   ───────────────────────────────────────────────────────────────── */
// Fetch NAV for a given scheme code and fill the modal's Current NAV + NAV Date fields
async function fetchAndFillModalNAV(schemeCode) {
  if (!schemeCode) return;
  const navInput  = document.getElementById('npsf-currentNav');
  const dateInput = document.getElementById('npsf-navDate');
  if (!navInput || !dateInput) return;

  navInput.placeholder = 'Fetching…';

  try {
    // Reuse the same single-call endpoint — look up the scheme in the navs map
    const res = await fetch(NPS_PROXY);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { lastUpdated, navs } = await res.json();

    const nav = navs?.[schemeCode.toUpperCase()];
    if (nav && nav > 0) {
      navInput.value = nav;
      // Parse "DD-MM-YYYY" → YYYY-MM-DD for the date input
      if (lastUpdated) {
        const [dd, mm, yyyy] = lastUpdated.split('-');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
      }
    }
  } catch (e) {
    console.warn('Modal NAV fetch failed for', schemeCode, e);
  } finally {
    navInput.placeholder = 'e.g. 58.7640';
  }
}

function autoFillSchemeCode() {
  const fm    = document.getElementById('npsf-fundManager')?.value || '';
  const tier  = document.getElementById('npsf-tier')?.value || '';
  const asset = document.getElementById('npsf-assetClass')?.value || '';
  const field = document.getElementById('npsf-schemeCode');
  if (!field) return;
  // Only auto-fill if the user hasn't manually typed something different
  if (field.dataset.userEdited !== 'true') {
    field.value = schemeCodeFor(fm, tier, asset);
  }
  // Fetch live NAV for whatever code is now in the field
  if (field.value) fetchAndFillModalNAV(field.value);
}

export function openNPSModal(id = null) {
  state.editingNPSId = id;
  const n = id ? state.nps.find(x => x.id === id) : null;
  document.getElementById('nps-modal-title').textContent = n ? 'Edit NPS Scheme' : 'Add NPS Scheme';
  document.getElementById('nps-save-btn').textContent    = n ? 'Save Changes'    : 'Add Scheme';
  document.getElementById('npsf-pran').value         = n?.pran         || '';
  document.getElementById('npsf-fundManager').value  = n?.fundManager  || FUND_MANAGERS[0];
  document.getElementById('npsf-tier').value         = n?.tier         || 'I';
  document.getElementById('npsf-assetClass').value   = n?.assetClass   || 'E';
  document.getElementById('npsf-units').value        = n?.units        || '';
  document.getElementById('npsf-avgBuyNav').value    = n?.avgBuyNav    || '';
  document.getElementById('npsf-currentNav').value   = n?.currentNav   || '';
  document.getElementById('npsf-navDate').value      = n?.navDate      || '';

  // Scheme code — use stored value if editing, otherwise derive from lookup
  const codeField = document.getElementById('npsf-schemeCode');
  if (codeField) {
    codeField.dataset.userEdited = 'false';
    codeField.value = n?.schemeCode
      || schemeCodeFor(n?.fundManager || FUND_MANAGERS[0], n?.tier || 'I', n?.assetClass || 'E');
    // Auto-fetch live NAV and fill the fields
    if (codeField.value) fetchAndFillModalNAV(codeField.value);
  }

  document.getElementById('nps-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('npsf-units').focus(), 50);
}

function closeNPSModal() {
  document.getElementById('nps-modal').classList.add('hidden');
  document.getElementById('nps-form').reset();
  state.editingNPSId = null;
}

/* ─────────────────────────────────────────────────────────────────
   CSV IMPORT — PARSER
   ───────────────────────────────────────────────────────────────── */

// Map raw fund manager names from the statement to display names
const FM_MAP = [
  { key: 'HDFC',         display: 'HDFC Pension Management' },
  { key: 'SBI',          display: 'SBI Pension Funds' },
  { key: 'LIC',          display: 'LIC Pension Fund' },
  { key: 'KOTAK',        display: 'Kotak Pension Fund' },
  { key: 'UTI',          display: 'UTI Retirement Solutions' },
  { key: 'ADITYA BIRLA', display: 'Aditya Birla Sun Life Pension' },
  { key: 'MAX LIFE',     display: 'Max Life Pension Fund' },
  { key: 'MAX',          display: 'Max Life Pension Fund' },
  { key: 'TATA',         display: 'Tata Pension Management' },
  { key: 'AXIS',         display: 'Axis Pension Fund' },
];

function normalizeFundManager(raw) {
  const u = raw.toUpperCase();
  for (const { key, display } of FM_MAP) {
    if (u.includes(key)) return display;
  }
  return raw.trim();
}

// "31-Mar-2022" → "2022-03-31"
function navDateToISO(str) {
  const MONTHS = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                   Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
  const p = str.split('-');
  if (p.length !== 3) return null;
  return `${p[2]}-${MONTHS[p[1]] || '01'}-${p[0].padStart(2, '0')}`;
}

// Parse one NSDL annual statement CSV
// Returns { tier, fundManager, navDate, schemes: { E: { units, nav, totalContributed } } }
function parseNPSCsv(text) {
  const lines = text.split('\n').map(l => l.trim());

  // Detect Tier and PRAN
  let tier = 'I';
  let pran = 'Unknown';
  let subscriberName = 'Unknown';
  for (const l of lines) {
    if (l.includes('Tier II Account')) { tier = 'II'; }
    if (l.includes('Tier I Account'))  { tier = 'I'; }
    if (l.startsWith("PRAN,'") || l.startsWith("PRAN,")) {
      pran = l.split(',')[1].replace(/['"]/g, '').trim();
    }
    if (l.startsWith("Subscriber Name,")) {
      subscriberName = l.split(',')[1].replace(/['"]/g, '').trim();
    }
  }

  const result = { tier, pran, subscriberName, fundManager: null, navDate: null, schemes: {} };

  let inSummary      = false;
  let inTransactions = false;
  let currentScheme  = null;

  for (const line of lines) {
    // ── Section markers ──────────────────────────────────────────
    if (line.includes('Investment Details - Scheme Wise Summary')) {
      inSummary = true; inTransactions = false; currentScheme = null; continue;
    }
    if (line.includes('Transaction Details')) {
      inSummary = false; inTransactions = true; currentScheme = null; continue;
    }
    if (line.includes('Contribution/Redemption Details')) {
      inSummary = false; inTransactions = false; currentScheme = null; continue;
    }

    // ── Summary section header — extract NAV date ─────────────────
    if (inSummary && line.startsWith('Particulars,')) {
      const m = line.match(/NAV as on (\d{2}-\w{3}-\d{4})/i);
      if (m) result.navDate = navDateToISO(m[1]);
      continue;
    }

    // ── Scheme name line (appears in both summary and transaction sections) ──
    const sm = line.match(/^NPS TRUST.*?SCHEME\s+([ECGA])\s*-\s*TIER\s+(I{1,2})/i);
    if (sm) {
      const cls = sm[1].toUpperCase();

      // Extract fund manager once
      if (!result.fundManager) {
        const fm = line.match(/NPS TRUST-?\s*A\/C\s+(.+?)\s+SCHEME\s+[ECGA]/i);
        if (fm) result.fundManager = normalizeFundManager(fm[1]);
      }

      if (inSummary) {
        // Data row: Name, Value, Units, NAV
        const parts = line.split(',');
        const units = parseFloat(parts[2]) || 0;
        const nav   = parseFloat(parts[3]) || 0;
        if (!result.schemes[cls]) result.schemes[cls] = { units: 0, nav: 0, voluntary: 0, employer: 0, switchIn: 0, switchOut: 0, charges: 0 };
        result.schemes[cls].units = units;
        result.schemes[cls].nav   = nav;
      } else if (inTransactions) {
        currentScheme = cls;
        if (!result.schemes[cls]) result.schemes[cls] = { units: 0, nav: 0, voluntary: 0, employer: 0, switchIn: 0, switchOut: 0, charges: 0 };
      }
      continue;
    }

    // ── Transaction rows ──────────────────────────────────────────
    if (inTransactions && currentScheme) {
      if (line.startsWith('Date,')) continue; // skip column header

      const parts = line.split(',');
      if (parts.length < 5) continue;

      const desc      = (parts[1] || '').trim();
      const amountStr = (parts[2] || '').trim();

      // Skip balance rows (not real transactions)
      if (/opening balance|closing balance/i.test(desc)) continue;
      if (!amountStr) continue;

      const isNeg  = amountStr.startsWith('(');
      const amount = parseFloat(amountStr.replace(/[()]/g, '')) || 0;
      if (amount <= 0) continue;

      const sc = result.schemes[currentScheme];
      if (desc === 'By Voluntary Contributions') {
        // Employee self-contributions (eNPS / voluntary)
        sc.voluntary += amount;
      } else if (!isNeg && /^by contribution/i.test(desc)) {
        // Employer / payroll contributions e.g. "By Contribution for March2024" or "By Contribution (Month)"
        sc.employer += amount;
      } else if (!isNeg && /employer|government|govt/i.test(desc)) {
        // Fallback for govt-sector statements that use different wording
        sc.employer += amount;
      } else if (/switch|rebalanc/i.test(desc)) {
        if (isNeg) sc.switchOut += amount;
        else       sc.switchIn  += amount;
      } else if (/charge|billing/i.test(desc)) {
        // "Billing for Q1 2024-2025" etc.
        sc.charges += amount;
      } else if (!isNeg) {
        // Safe fallback for any other unknown positive contributions
        sc.voluntary += amount;
      }
    }
  }

  return result;
}

// Merge results from multiple years into one record per scheme.
// Units + NAV come from the most recent statement.
// Contributions are stored per statement date so re-imports never double-count.
function mergeYears(parsedFiles) {
  // Sort oldest → newest so the last write wins for units/NAV
  parsedFiles.sort((a, b) => (a.navDate || '') < (b.navDate || '') ? -1 : 1);

  const map = {};
  for (const file of parsedFiles) {
    for (const [cls, data] of Object.entries(file.schemes)) {
      const key = `${file.pran}|${file.fundManager}|${file.tier}|${cls}`;
      if (!map[key]) {
        map[key] = { pran: file.pran, subscriberName: file.subscriberName, fundManager: file.fundManager, tier: file.tier, assetClass: cls,
                     units: 0, nav: 0, navDate: null, annualContributions: {} };
      }
      // Latest file wins for units / NAV
      map[key].units   = data.units;
      map[key].nav     = data.nav;
      map[key].navDate = file.navDate;
      // Store per-year breakdown — re-importing same year just overwrites its own key
      if (file.navDate) {
        const voluntary  = data.voluntary  || 0;
        const employer   = data.employer   || 0;
        const switchIn   = data.switchIn   || 0;
        const switchOut  = data.switchOut  || 0;
        const charges    = data.charges    || 0;
        map[key].annualContributions[file.navDate] = {
          voluntary, employer, switchIn, switchOut, charges,
          net: voluntary + employer + switchIn - switchOut,
        };
      }
    }
  }

  return Object.values(map).map(s => {
    const totalContributed = Object.values(s.annualContributions).reduce((sum, yr) => {
      if (typeof yr === 'object') return sum + (yr.net !== undefined ? yr.net : ((yr.voluntary || 0) + (yr.employer || 0)));
      return sum + yr; // backward compat: old records stored a plain number
    }, 0);
    return { ...s, totalContributed, avgBuyNav: s.units > 0 ? totalContributed / s.units : 0 };
  });
}

/* ─────────────────────────────────────────────────────────────────
   CSV IMPORT — PREVIEW & CONFIRM
   ───────────────────────────────────────────────────────────────── */
let _pendingImport = [];

function showImportPreview(schemes) {
  _pendingImport = schemes;

  const rows = schemes.map(s => {
    // Compute the merged total that will actually be saved (existing years + new years)
    const existing       = state.nps.find(n =>
      (n.pran || 'Unknown') === s.pran && n.fundManager === s.fundManager && n.tier === s.tier && n.assetClass === s.assetClass
    );
    const mergedContribs  = { ...(existing?.annualContributions || {}), ...s.annualContributions };
    const mergedTotal     = Object.values(mergedContribs).reduce((sum, yr) => {
      if (typeof yr === 'object') return sum + (yr.net !== undefined ? yr.net : (yr.voluntary || 0));
      return sum + yr;
    }, 0);
    const mergedAvgNav    = s.units > 0 ? mergedTotal / s.units : 0;

    const cv     = s.units * s.nav;
    const gain   = cv - mergedTotal;
    const retPct = mergedTotal > 0 ? (gain / mergedTotal) * 100 : 0;
    const col    = gain >= 0 ? '#059669' : '#ef4444';
    const dateLabel = s.navDate
      ? new Date(s.navDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
      : '—';
    const yearsLabel = Object.keys(mergedContribs).length;
    return `<tr>
      <td>
        <div style="font-weight:600;font-size:13px">${s.fundManager}</div>
        <div style="font-size:11px;color:#64748b;margin-top:3px">${s.pran !== 'Unknown' ? `<span style="color:#0f172a;font-weight:600;margin-right:6px">PRAN: ${s.pran}</span>` : ''}${tierBadge(s.tier)} ${schemeBadge(s.assetClass)} ${ASSET_CLASSES[s.assetClass]}</div>
      </td>
      <td class="num">${s.units.toLocaleString('en-IN', { maximumFractionDigits: 4 })}</td>
      <td class="num">${fmt(Math.round(mergedTotal))}<div style="font-size:10px;color:#94a3b8">${yearsLabel} yr${yearsLabel !== 1 ? 's' : ''}</div></td>
      <td class="num">₹${mergedAvgNav.toFixed(4)}</td>
      <td class="num">₹${s.nav.toFixed(4)}<div style="font-size:10px;color:#94a3b8">${dateLabel}</div></td>
      <td class="num" style="color:${col}">
        ${gain >= 0 ? '+' : ''}${fmt(Math.round(gain))}
        <div style="font-size:10px">${retPct >= 0 ? '+' : ''}${retPct.toFixed(2)}%</div>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('nps-import-preview').innerHTML = `
    <p style="padding:0 4px 12px;color:#475569;font-size:13px">
      Found <strong>${schemes.length} scheme${schemes.length !== 1 ? 's' : ''}</strong>.
      Units &amp; NAV are from your most recent statement.
      Invested is summed across all uploaded statements.
    </p>
    <div class="table-wrap">
      <table class="data-table" style="font-size:12px">
        <thead><tr>
          <th>Scheme</th>
          <th class="num">Units</th>
          <th class="num">Total Invested</th>
          <th class="num">Avg Buy NAV</th>
          <th class="num">NAV (Statement)</th>
          <th class="num">Gain / Loss</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p style="padding:10px 4px 0;color:#94a3b8;font-size:11px">
      If a scheme already exists it will be updated; otherwise a new entry is created.
    </p>`;

  document.getElementById('nps-import-modal').classList.remove('hidden');
}

async function confirmImport() {
  const btn = document.getElementById('nps-import-confirm');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    for (const s of _pendingImport) {
      const existing = state.nps.find(n =>
        (n.pran || 'Unknown') === s.pran && n.fundManager === s.fundManager && n.tier === s.tier && n.assetClass === s.assetClass
      );

      // Merge this import's per-year contributions with whatever is already stored.
      // Existing years are preserved; the newly imported years overwrite their own keys
      // (so re-importing the same statement never double-counts).
      const existingContribs  = existing?.annualContributions || {};
      const mergedContribs    = { ...existingContribs, ...s.annualContributions };
      const totalContributed  = Object.values(mergedContribs).reduce((sum, yr) => {
        if (typeof yr === 'object') return sum + (yr.net !== undefined ? yr.net : (yr.voluntary || 0));
        return sum + yr; // backward compat
      }, 0);

      const data = {
        pran:                s.pran,
        subscriberName:      s.subscriberName,
        fundManager:         s.fundManager,
        tier:                s.tier,
        assetClass:          s.assetClass,
        units:               parseFloat(s.units.toFixed(4)),
        totalContributed:    parseFloat(totalContributed.toFixed(2)),
        avgBuyNav:           parseFloat((s.units > 0 ? totalContributed / s.units : 0).toFixed(4)),
        annualContributions: mergedContribs,
        schemeCode:          existing?.schemeCode || schemeCodeFor(s.fundManager, s.tier, s.assetClass),
        ...(s.nav > 0 && { currentNav: parseFloat(s.nav.toFixed(4)) }),
        ...(s.navDate  && { navDate: s.navDate }),
      };

      if (existing) {
        await updateNPS(existing.id, data);
        state.nps = state.nps.map(n => n.id === existing.id ? { ...n, ...data } : n);
      } else {
        const ref = await addNPS(data);
        state.nps = [...state.nps, { id: ref.id, ...data }];
      }
    }

    toast(`${_pendingImport.length} scheme${_pendingImport.length !== 1 ? 's' : ''} imported ✓`, 'success');
    document.getElementById('nps-import-modal').classList.add('hidden');
    _pendingImport = [];
    renderNPSSection();
  } catch (err) {
    toast('Import failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Import & Save';
  }
}

/* ─────────────────────────────────────────────────────────────────
   EVENT LISTENERS
   ───────────────────────────────────────────────────────────────── */
export function initNPSListeners() {
  document.getElementById('npsPranFilter')?.addEventListener('change', () => {
    renderNPSSection();
  });
  // Table row actions
  document.getElementById('npsTableBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-npsaction]');
    if (!btn) return;
    const { npsaction, npsid } = btn.dataset;
    if (npsaction === 'edit') { openNPSModal(npsid); return; }
    if (npsaction === 'delete') {
      if (!confirm('Remove this NPS scheme? This cannot be undone.')) return;
      try {
        await deleteNPS(npsid);
        state.nps = state.nps.filter(n => n.id !== npsid);
        renderNPSSection();
        toast('NPS scheme removed', 'info');
      } catch (err) { toast('Delete failed: ' + err.message, 'error'); }
    }
  });

  // Add button
  document.getElementById('btn-add-nps').addEventListener('click', () => openNPSModal());

  // CSV Import
  const csvInput = document.getElementById('nps-csv-input');
  document.getElementById('btn-refresh-nps-nav').addEventListener('click', fetchAllNPSNavs);
  document.getElementById('btn-import-nps').addEventListener('click', () => csvInput.click());
  csvInput.addEventListener('change', async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    try {
      const texts  = await Promise.all(files.map(f => f.text()));
      const parsed = texts
        .map(parseNPSCsv)
        .filter(p => p.fundManager && Object.keys(p.schemes).length > 0);
      if (!parsed.length) { toast('No NPS data found in the uploaded files.', 'error'); return; }
      showImportPreview(mergeYears(parsed));
    } catch (err) {
      toast('Error reading files: ' + err.message, 'error');
    }
    csvInput.value = ''; // reset so same file can be re-uploaded
  });

  // Import preview modal
  const closeImport = () => {
    document.getElementById('nps-import-modal').classList.add('hidden');
    _pendingImport = [];
  };
  document.getElementById('nps-import-close').addEventListener('click', closeImport);
  document.getElementById('nps-import-cancel').addEventListener('click', closeImport);
  document.getElementById('nps-import-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeImport();
  });
  document.getElementById('nps-import-confirm').addEventListener('click', confirmImport);

  // Scheme code auto-fill: re-derive when fund manager / tier / asset class changes
  const autoFillTriggers = ['npsf-fundManager', 'npsf-tier', 'npsf-assetClass'];
  autoFillTriggers.forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      const field = document.getElementById('npsf-schemeCode');
      if (field) field.dataset.userEdited = 'false'; // dropdown changed → re-derive
      autoFillSchemeCode();
    });
  });
  // If the user types in the scheme code field manually, stop overwriting it
  // and fetch the NAV for the entered code (debounced)
  let _navFetchTimer = null;
  document.getElementById('npsf-schemeCode')?.addEventListener('input', () => {
    const field = document.getElementById('npsf-schemeCode');
    if (!field) return;
    field.dataset.userEdited = 'true';
    clearTimeout(_navFetchTimer);
    const code = field.value.trim().toUpperCase();
    if (code.length >= 7) { // SM + 6 chars minimum
      _navFetchTimer = setTimeout(() => fetchAndFillModalNAV(code), 600);
    }
  });

  // Modal close
  document.getElementById('nps-modal-close').addEventListener('click', closeNPSModal);
  document.getElementById('nps-cancel-btn').addEventListener('click', closeNPSModal);
  document.getElementById('nps-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeNPSModal();
  });

  // Form submit
  document.getElementById('nps-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('nps-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';

    const currentNavRaw = parseFloat(document.getElementById('npsf-currentNav').value);
    const navDateRaw    = document.getElementById('npsf-navDate').value;

    const units     = parseFloat(document.getElementById('npsf-units').value)     || 0;
    const avgBuyNav = parseFloat(document.getElementById('npsf-avgBuyNav').value) || 0;

    const schemeCode = (document.getElementById('npsf-schemeCode')?.value || '').trim().toUpperCase();

    const data = {
      pran:             document.getElementById('npsf-pran').value,
      fundManager:      document.getElementById('npsf-fundManager').value,
      tier:             document.getElementById('npsf-tier').value,
      assetClass:       document.getElementById('npsf-assetClass').value,
      units,
      avgBuyNav,
      totalContributed: parseFloat((units * avgBuyNav).toFixed(2)),
      ...(schemeCode    && { schemeCode }),
      ...(currentNavRaw > 0 && { currentNav: currentNavRaw }),
      ...(navDateRaw    && { navDate: navDateRaw }),
    };

    try {
      if (state.editingNPSId) {
        await updateNPS(state.editingNPSId, data);
        state.nps = state.nps.map(n => n.id === state.editingNPSId ? { ...n, ...data } : n);
        toast('NPS scheme updated ✓', 'success');
      } else {
        const ref = await addNPS(data);
        state.nps = [...state.nps, { id: ref.id, ...data }];
        toast('NPS scheme added ✓', 'success');
      }
      renderNPSSection();
      closeNPSModal();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = state.editingNPSId ? 'Save Changes' : 'Add Scheme';
    }
  });
}
