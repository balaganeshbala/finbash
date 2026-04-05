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
    },
    () => toast('Could not load NPS data. Check Firestore rules.', 'error'),
  );
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
function renderNPSKpis() {
  let totalInvested = 0, totalCurrent = 0, withNav = 0;
  const npsList = getFilteredNPS();
  npsList.forEach(n => {
    const inv = n.totalContributed != null ? n.totalContributed : (n.units || 0) * (n.avgBuyNav || 0);
    totalInvested += inv;
    if (n.currentNav) {
      totalCurrent += (n.units || 0) * n.currentNav;
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
    const cv      = n.currentNav ? (n.units || 0) * n.currentNav : null;
    const gain    = cv != null ? cv - inv : null;
    const retPct  = inv > 0 && gain != null ? (gain / inv) * 100 : null;
    const gainCol = gain != null ? (gain >= 0 ? '#059669' : '#ef4444') : '#94a3b8';

    totInvested += inv;
    totCurrent  += cv != null ? cv : inv;

    const navDateStr = n.navDate
      ? new Date(n.navDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
      : null;

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
        ${n.currentNav
          ? `<span style="font-weight:600">₹${n.currentNav.toFixed(4)}</span>
             ${navDateStr ? `<div style="font-size:10px;color:#94a3b8;margin-top:2px">as of ${navDateStr}</div>` : ''}`
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

    const titlePrefix = targetPran !== 'Unknown' ? `Year-wise Contribution Breakdown — PRAN: ${targetPran}` : 'Year-wise Contribution Breakdown';
    const subTitle = targetPran !== 'Unknown' && subName !== 'Unknown' ? ` &nbsp;<span style="font-size:12px;color:#94a3b8;font-weight:400">·&nbsp; ${subName}</span>` : '';

    html += `
      <div class="card" style="margin-top:20px">
        <div class="card-title">${titlePrefix}${subTitle}</div>
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

    const data = {
      pran:             document.getElementById('npsf-pran').value,
      fundManager:      document.getElementById('npsf-fundManager').value,
      tier:             document.getElementById('npsf-tier').value,
      assetClass:       document.getElementById('npsf-assetClass').value,
      units,
      avgBuyNav,
      totalContributed: parseFloat((units * avgBuyNav).toFixed(2)),
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
