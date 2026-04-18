import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp, getDoc, setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db }                         from './firebase-init.js';
import { state }                      from './state.js';
import { fmt, fmtDate, groupSum, PLATFORM_BADGE, PLATFORM_COLORS, TODAY, MS_DAY } from './utils.js';
import { toast, setDashboardState }   from './ui.js';

/* ─────────────────────────────────────────────────────────────────
   FIRESTORE REFS & LISTENER
   ───────────────────────────────────────────────────────────────── */
const bondsRef = () => collection(db, 'users', state.currentUser.uid, 'bonds');
const bondDoc  = id => doc(db, 'users', state.currentUser.uid, 'bonds', id);

export function startListening(uid) {
  state.firestoreUnsub = onSnapshot(
    collection(db, 'users', uid, 'bonds'),
    snap => {
      state.bonds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      state.bonds.length === 0
        ? setDashboardState('empty')
        : (setDashboardState('data'), renderDashboard());
      window.__renderOverview?.();
    },
    () => {
      toast('Could not load data. Check your Firestore security rules.', 'error');
      setDashboardState('empty');
    }
  );
}

/* ─────────────────────────────────────────────────────────────────
   CRUD
   ───────────────────────────────────────────────────────────────── */
export async function addBond(data) {
  await addDoc(bondsRef(), { ...data, createdAt: serverTimestamp() });
}
export async function updateBond(id, data) {
  await updateDoc(bondDoc(id), { ...data, updatedAt: serverTimestamp() });
}
export async function deleteBond(id) {
  await deleteDoc(bondDoc(id));
}

/* ─────────────────────────────────────────────────────────────────
   DASHBOARD RENDERING
   ───────────────────────────────────────────────────────────────── */
function destroyCharts() {
  Object.keys(state.chartInst).forEach(k => {
    if (state.chartInst[k]) { state.chartInst[k].destroy(); state.chartInst[k] = null; }
  });
}

export function renderDashboard() {
  const active  = state.bonds.filter(b => !b.matured);
  const matured = state.bonds.filter(b =>  b.matured);
  const totalFV      = active.reduce((s, b) => s + (b.faceValue || 0), 0);
  const totalMonthly = active.reduce((s, b) => s + (b.monthly   || 0), 0);
  const annualInt    = totalMonthly * 12;
  const avgYTM       = active.length ? active.reduce((s, b) => s + (b.ytm    || 0), 0) / active.length : 0;
  const avgCoupon    = active.length ? active.reduce((s, b) => s + (b.coupon || 0), 0) / active.length : 0;

  /* KPIs */
  const KSVG = (d, s = '#94a3b8') =>
    `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:none;stroke:${s};stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${d}</svg>`;

  document.getElementById('kpiGrid').innerHTML = [
    { icon: KSVG('<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 000 4h4a2 2 0 010 4H8"/><line x1="12" y1="6" x2="12" y2="18"/>', 'white'), label: 'Total Invested',   value: fmt(totalFV),                   sub: 'Active bonds only',                  cls: 'primary' },
    { icon: KSVG('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>', 'white'), label: 'Monthly Interest', value: fmt(Math.round(totalMonthly)), sub: 'Expected per month',                  cls: 'success' },
    { icon: KSVG('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>', '#059669'),      label: 'Annual Interest',  value: fmt(Math.round(annualInt)),      sub: 'Projected yearly income',            cls: '' },
    { icon: KSVG('<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>', '#3b82f6'), label: 'Active Bonds',     value: active.length,                   sub: `${matured.length} matured/withdrawn`, cls: '' },
    { icon: KSVG('<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>', '#8b5cf6'),              label: 'Avg YTM',          value: avgYTM.toFixed(2) + '%',         sub: 'Yield to maturity',                  cls: '' },
    { icon: KSVG('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>', '#f59e0b'),                              label: 'Avg Coupon',       value: avgCoupon.toFixed(2) + '%',      sub: 'Across active holdings',             cls: '' },
  ].map(k => `<div class="kpi-card ${k.cls}">
    <div class="kpi-label">${k.label}</div>
    <div class="kpi-value">${k.value}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`).join('');

  destroyCharts();

  /* Platform donut */
  const pd = groupSum(active, 'platform', 'faceValue');
  state.chartInst.platform = new Chart(document.getElementById('platformChart'), {
    type: 'doughnut',
    data: { labels: Object.keys(pd), datasets: [{ data: Object.values(pd), backgroundColor: Object.keys(pd).map(k => PLATFORM_COLORS[k] || '#94a3b8'), borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }] },
    options: { responsive: true, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12, usePointStyle: true } }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)} (${(ctx.raw / totalFV * 100).toFixed(1)}%)` } } } },
  });

  /* Investor donut */
  const id_ = groupSum(active, 'by', 'faceValue');
  state.chartInst.investor = new Chart(document.getElementById('investorChart'), {
    type: 'doughnut',
    data: { labels: Object.keys(id_), datasets: [{ data: Object.values(id_), backgroundColor: ['#4f46e5', '#a855f7', '#ec4899', '#f97316'], borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }] },
    options: { responsive: true, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12, usePointStyle: true } }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)} (${totalFV ? ((ctx.raw / totalFV) * 100).toFixed(1) : 0}%)` } } } },
  });

  /* Demat donut */
  const dd = groupSum(active, 'demat', 'faceValue');
  const de = Object.entries(dd).sort((a, b) => b[1] - a[1]);
  state.chartInst.demat = new Chart(document.getElementById('dematChart'), {
    type: 'doughnut',
    data: { labels: de.map(([k]) => k), datasets: [{ data: de.map(([, v]) => v), backgroundColor: ['#1e3a8a', '#2563eb', '#60a5fa', '#7c3aed', '#a78bfa', '#0369a1'], borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }] },
    options: { responsive: true, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12, usePointStyle: true } }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.raw)} (${(ctx.raw / totalFV * 100).toFixed(1)}%)` } } } },
  });

  /* Maturity by year */
  const mby = active.reduce((acc, b) => {
    if (b.maturity) { const yr = new Date(b.maturity).getFullYear(); acc[yr] = (acc[yr] || 0) + (b.faceValue || 0); }
    return acc;
  }, {});
  const yrs = Object.keys(mby).sort();
  const YC  = ['#ef4444', '#f97316', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#10b981'];
  state.chartInst.maturity = new Chart(document.getElementById('maturityChart'), {
    type: 'bar',
    data: { labels: yrs, datasets: [{ data: yrs.map(y => mby[y]), backgroundColor: yrs.map((_, i) => YC[i % YC.length]), borderRadius: 7, borderSkipped: false }] },
    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 12, weight: '600' } } }, y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, callback: v => '₹' + (v / 100000).toFixed(0) + 'L' } } } },
  });

  /* Upcoming maturities */
  const oneYearOut = new Date(); oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);
  const upcoming = active
    .filter(b => { const m = new Date(b.maturity); return m >= TODAY && m <= oneYearOut; })
    .sort((a, b) => new Date(a.maturity) - new Date(b.maturity));
  document.getElementById('upcomingList').innerHTML = upcoming.length === 0
    ? '<div style="text-align:center;color:#94a3b8;padding:30px;font-size:13px">No maturities in the next 12 months</div>'
    : upcoming.map(b => {
        const days = Math.round((new Date(b.maturity) - TODAY) / MS_DAY);
        const cls  = days < 90 ? 'urgent' : days < 180 ? 'warn' : 'normal';
        return `<div class="upcoming-item ${cls}">
          <div><div class="up-name">${b.name}</div><div class="up-meta">${b.platform} · ${fmt(b.faceValue)}</div></div>
          <div class="up-right"><div class="up-date">${fmtDate(b.maturity)}</div><div class="up-days">${days}d away</div></div>
        </div>`;
      }).join('');

  updateInvestorOptions();
  renderTable();
  renderTracker();
}

/* ─────────────────────────────────────────────────────────────────
   INTEREST TRACKER
   ───────────────────────────────────────────────────────────────── */
const CURRENT_MONTH = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();
const MONTH_LABEL = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

export function renderTracker() {
  document.getElementById('tracker-month-label').textContent = MONTH_LABEL;

  const active = state.bonds
    .filter(b => !b.matured && (b.monthly || 0) > 0)
    .sort((a, b) => (parseInt(a.frequency) || 99) - (parseInt(b.frequency) || 99));

  const receivedCount = active.filter(b => (b.receivedMonths || []).includes(CURRENT_MONTH)).length;
  const receivedAmt   = active.filter(b =>  (b.receivedMonths || []).includes(CURRENT_MONTH)).reduce((s, b) => s + (b.monthly || 0), 0);
  const pendingAmt    = active.filter(b => !(b.receivedMonths || []).includes(CURRENT_MONTH)).reduce((s, b) => s + (b.monthly || 0), 0);

  document.getElementById('tracker-summary').innerHTML = `
    <div class="tracker-stat done">
      <div class="tracker-stat-label">Received (${receivedCount}/${active.length})</div>
      <div class="tracker-stat-value">${fmt(Math.round(receivedAmt))}</div>
    </div>
    <div class="tracker-stat">
      <div class="tracker-stat-label">Pending (${active.length - receivedCount})</div>
      <div class="tracker-stat-value">${fmt(Math.round(pendingAmt))}</div>
    </div>
    <div class="tracker-stat">
      <div class="tracker-stat-label">Total Expected</div>
      <div class="tracker-stat-value">${fmt(Math.round(receivedAmt + pendingAmt))}</div>
    </div>
  `;

  document.getElementById('tracker-body').innerHTML = active.length === 0
    ? '<div style="text-align:center;color:#94a3b8;padding:30px;font-size:13px">No active bonds with monthly interest</div>'
    : active.map((b, i) => {
        const isReceived = (b.receivedMonths || []).includes(CURRENT_MONTH);
        return `
          <div class="tracker-row ${isReceived ? 'received' : ''}">
            <span class="tracker-num">${i + 1}</span>
            <span class="tracker-name" title="${b.name}">${b.name}</span>
            <span class="tracker-schedule">${b.frequency || '—'}</span>
            <span class="tracker-investor">${b.demat || '—'}</span>
            <span class="tracker-amount">${fmt(b.monthly)}</span>
            <button class="btn-mark ${isReceived ? 'received-btn' : 'pending'}"
              data-tracker-id="${b.id}" data-received="${isReceived}">
              ${isReceived
                ? `<svg style="width:13px;height:13px;fill:none;stroke:#15803d;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;margin-right:4px;vertical-align:middle" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>Received`
                : `<svg style="width:13px;height:13px;fill:none;stroke:#64748b;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;margin-right:4px;vertical-align:middle" viewBox="0 0 24 24"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 00-.586-1.414L12 12l-4.414 4.414A2 2 0 007 17.828V22"/><path d="M7 2v4.172a2 2 0 00.586 1.414L12 12l4.414-4.414A2 2 0 0017 6.172V2"/></svg>Pending`}
            </button>
          </div>
        `;
      }).join('');
}

/* ─────────────────────────────────────────────────────────────────
   TABLE
   ───────────────────────────────────────────────────────────────── */
export function updateInvestorOptions() {
  const names = [...new Set(state.bonds.map(b => b.by).filter(Boolean))].sort();
  if (names.length === 0) {
    const first = (state.currentUser?.displayName || 'Me').split(' ')[0];
    names.push(first);
  }
  const filterEl = document.getElementById('investorFilter');
  if (filterEl) {
    const prev = filterEl.value;
    filterEl.innerHTML = '<option value="">All Investors</option>' +
      names.map(n => `<option value="${n}">${n}</option>`).join('');
    if (names.includes(prev)) filterEl.value = prev;
  }
}

export function renderTable() {
  const q   = (document.getElementById('searchInput')?.value   || '').toLowerCase();
  const plt = document.getElementById('platformFilter')?.value  || '';
  const inv = document.getElementById('investorFilter')?.value  || '';
  const sts = document.getElementById('statusFilter')?.value    || '';

  const filtered = state.bonds.filter(b => {
    if (q   && !(b.name || '').toLowerCase().includes(q)) return false;
    if (plt && b.platform !== plt) return false;
    if (inv && b.by !== inv) return false;
    if (sts === 'active'  &&  b.matured) return false;
    if (sts === 'matured' && !b.matured) return false;
    return true;
  });

  if (state.sortCol) {
    filtered.sort((a, b) => {
      let va = a[state.sortCol] ?? '';
      let vb = b[state.sortCol] ?? '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return state.sortDir === 'asc' ? -1 : 1;
      if (va > vb) return state.sortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  document.querySelectorAll('thead th.sortable').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === state.sortCol) th.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });

  document.getElementById('tableBody').innerHTML = filtered.map((b, i) => {
    const days    = !b.matured && b.maturity ? Math.round((new Date(b.maturity) - TODAY) / MS_DAY) : null;
    const ytmColor = (b.ytm || 0) >= 12 ? '#059669' : (b.ytm || 0) >= 11.5 ? '#2563eb' : '#475569';
    const daysChip = days !== null
      ? `<div style="font-size:10px;font-weight:600;margin-top:2px;color:${days < 90 ? '#ef4444' : days < 365 ? '#f97316' : '#94a3b8'}">${days}d left</div>`
      : '';
    return `<tr>
      <td style="color:#94a3b8;font-size:11px">${i + 1}</td>
      <td><div class="bond-name">${b.name || '—'}</div></td>
      <td><span class="badge ${PLATFORM_BADGE[b.platform] || 'badge-sm'}">${b.platform || '—'}</span></td>
      <td class="num">${fmt(b.faceValue || 0)}</td>
      <td class="num">${(b.coupon || 0).toFixed(2)}%</td>
      <td class="num" style="font-weight:700;color:${ytmColor}">${(b.ytm || 0).toFixed(2)}%</td>
      <td>${b.investedOn ? fmtDate(b.investedOn) : '—'}</td>
      <td style="white-space:nowrap"><div>${b.maturity ? fmtDate(b.maturity) : '—'}</div>${daysChip}</td>
      <td class="num">${(b.monthly || 0) > 0 ? fmt(b.monthly) : '—'}</td>
      <td style="font-size:11.5px;color:#475569">${b.frequency || '—'}</td>
      <td>${b.by || '—'}</td>
      <td style="font-size:11px;color:#64748b">${b.demat || '—'}</td>
      <td><span class="badge ${b.matured ? 'badge-matured' : 'badge-active'}">${b.matured ? 'Matured' : 'Active'}</span></td>
      ${!state.isViewMode ? `<td>
        <div class="actions">
          <button class="btn-icon bi-edit"   data-action="edit"   data-id="${b.id}" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon ${b.matured ? 'bi-restore' : 'bi-toggle'}" data-action="toggle" data-id="${b.id}" title="${b.matured ? 'Mark Active' : 'Mark Withdrawn'}">
            ${b.matured
              ? `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>`
              : `<svg viewBox="0 0 24 24"><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/><polyline points="9 11 12 14 22 4"/></svg>`}
          </button>
          <button class="btn-icon bi-del" data-action="delete" data-id="${b.id}" title="Delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </td>` : ''}
    </tr>`;
  }).join('');

  document.getElementById('tableCount').textContent =
    `Showing ${filtered.length} of ${state.bonds.length} bonds`;
}

/* ─────────────────────────────────────────────────────────────────
   MODAL (ADD / EDIT)
   ───────────────────────────────────────────────────────────────── */
export function openModal(bondId = null) {
  state.editingBondId = bondId;
  const b = bondId ? state.bonds.find(x => x.id === bondId) : null;
  document.getElementById('modal-title').textContent = b ? 'Edit Bond' : 'Add New Bond';
  document.getElementById('save-btn').textContent    = b ? 'Save Changes' : 'Add Bond';
  document.getElementById('f-name').value       = b?.name       || '';
  document.getElementById('f-platform').value   = b?.platform   || '';
  document.getElementById('f-by').value         = b?.by         || '';
  document.getElementById('f-faceValue').value  = b?.faceValue  || '';
  document.getElementById('f-purchase').value   = b?.purchase   || '';
  document.getElementById('f-coupon').value     = b?.coupon     || '';
  document.getElementById('f-ytm').value        = b?.ytm        || '';
  document.getElementById('f-investedOn').value = b?.investedOn || '';
  document.getElementById('f-maturity').value   = b?.maturity   || '';
  document.getElementById('f-monthly').value    = b?.monthly    || '';
  document.getElementById('f-demat').value      = b?.demat      || '';
  document.getElementById('f-frequency').value  = b?.frequency  || '';
  document.getElementById('f-matured').checked  = b?.matured    || false;
  document.getElementById('bond-modal').classList.remove('hidden');
  document.getElementById('f-name').focus();
}

function closeModal() {
  document.getElementById('bond-modal').classList.add('hidden');
  document.getElementById('bond-form').reset();
  state.editingBondId = null;
}

/* ─────────────────────────────────────────────────────────────────
   PARTNERS
   ───────────────────────────────────────────────────────────────── */
export async function loadPartners(uid) {
  try {
    const snap = await getDoc(doc(db, 'partnerAccess', uid));
    state.currentViewers = snap.exists() ? (snap.data().viewers || []) : [];
  } catch { state.currentViewers = []; }
  renderPartnersList();
}

function renderPartnersList() {
  const el = document.getElementById('partner-list');
  if (!el) return;
  if (state.currentViewers.length === 0) {
    el.innerHTML = '<div class="no-partners">No partners added yet</div>';
    return;
  }
  el.innerHTML = state.currentViewers.map(email => `
    <div class="partner-item">
      <div>
        <div class="partner-email">${email}</div>
        <div class="partner-meta">Read-only access</div>
      </div>
      <button class="btn-remove-partner" data-email="${email}">Remove</button>
    </div>
  `).join('');
}

async function addPartnerEmail(uid, email) {
  email = email.trim().toLowerCase();
  if (!email.includes('@')) { toast('Please enter a valid email address', 'error'); return; }
  if (state.currentViewers.includes(email)) { toast('This partner is already added', 'info'); return; }
  state.currentViewers = [...state.currentViewers, email];
  await setDoc(doc(db, 'partnerAccess', uid), { viewers: state.currentViewers });
  await setDoc(doc(db, 'viewerOf', email), {
    ownerUid:   uid,
    ownerName:  state.currentUser.displayName || state.currentUser.email,
    ownerEmail: state.currentUser.email,
  });
  renderPartnersList();
  toast(`${email} can now view your portfolio ✓`, 'success');
}

async function removePartnerEmail(uid, email) {
  state.currentViewers = state.currentViewers.filter(e => e !== email);
  await setDoc(doc(db, 'partnerAccess', uid), { viewers: state.currentViewers });
  try { await deleteDoc(doc(db, 'viewerOf', email)); } catch { /* may not exist */ }
  renderPartnersList();
  toast(`${email} removed`, 'info');
}

const openPartnersModal  = () => document.getElementById('partners-modal').classList.remove('hidden');
const closePartnersModal = () => {
  document.getElementById('partners-modal').classList.add('hidden');
  document.getElementById('partner-email-input').value = '';
};

/* ─────────────────────────────────────────────────────────────────
   EVENT LISTENERS  (called once from app.js after DOM is ready)
   ───────────────────────────────────────────────────────────────── */
export function initBondListeners() {
  /* tracker toggle */
  document.getElementById('tracker-body').addEventListener('click', async e => {
    const btn = e.target.closest('[data-tracker-id]');
    if (!btn || state.isViewMode) return;
    const id = btn.dataset.trackerId;
    const wasReceived = btn.dataset.received === 'true';
    const b = state.bonds.find(x => x.id === id);
    if (!b) return;
    btn.disabled = true;
    try {
      const months  = b.receivedMonths || [];
      const updated = wasReceived ? months.filter(m => m !== CURRENT_MONTH) : [...months, CURRENT_MONTH];
      await updateBond(id, { receivedMonths: updated });
      b.receivedMonths = updated;
      renderTracker();
      toast(wasReceived ? 'Marked as pending' : 'Marked as received ✓', wasReceived ? 'info' : 'success');
    } catch (err) {
      toast('Update failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  /* table filters */
  ['searchInput', 'platformFilter', 'investorFilter', 'statusFilter']
    .forEach(id => document.getElementById(id)?.addEventListener('input', renderTable));

  /* column sort */
  document.querySelector('thead').addEventListener('click', e => {
    const th = e.target.closest('th.sortable');
    if (!th) return;
    const col = th.dataset.sort;
    if (state.sortCol === col) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortCol = col;
      state.sortDir = 'asc';
    }
    renderTable();
  });

  /* table row actions */
  document.getElementById('tableBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === 'edit') { openModal(id); return; }
    if (action === 'toggle') {
      const b = state.bonds.find(x => x.id === id);
      if (!b) return;
      try {
        await updateBond(id, { matured: !b.matured });
        toast(b.matured ? 'Marked as active ✓' : 'Marked as withdrawn ✓', 'info');
      } catch { toast('Update failed', 'error'); }
    }
    if (action === 'delete') {
      state.pendingDeleteId = id;
      const b = state.bonds.find(x => x.id === id);
      document.getElementById('confirm-text').textContent =
        `Are you sure you want to permanently delete "${b?.name || 'this bond'}"? This cannot be undone.`;
      document.getElementById('confirm-modal').classList.remove('hidden');
    }
  });

  /* bond modal */
  document.getElementById('btn-add-bond').addEventListener('click', () => openModal());
  document.getElementById('btn-add-first').addEventListener('click', () => openModal());
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('cancel-btn').addEventListener('click', closeModal);
  document.getElementById('bond-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

  /* auto-calc monthly interest */
  ['f-faceValue', 'f-coupon'].forEach(fid => {
    document.getElementById(fid).addEventListener('input', () => {
      const fv = parseFloat(document.getElementById('f-faceValue').value) || 0;
      const c  = parseFloat(document.getElementById('f-coupon').value)    || 0;
      if (fv > 0 && c > 0)
        document.getElementById('f-monthly').value = ((fv * c / 100) / 12).toFixed(2);
    });
  });

  /* bond form submit */
  document.getElementById('bond-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    const data = {
      name:       document.getElementById('f-name').value.trim(),
      platform:   document.getElementById('f-platform').value,
      by:         document.getElementById('f-by').value,
      faceValue:  parseFloat(document.getElementById('f-faceValue').value) || 0,
      purchase:   parseFloat(document.getElementById('f-purchase').value)  || 0,
      coupon:     parseFloat(document.getElementById('f-coupon').value)    || 0,
      ytm:        parseFloat(document.getElementById('f-ytm').value)       || 0,
      investedOn: document.getElementById('f-investedOn').value,
      maturity:   document.getElementById('f-maturity').value,
      monthly:    parseFloat(document.getElementById('f-monthly').value)   || 0,
      demat:      document.getElementById('f-demat').value.trim(),
      frequency:  document.getElementById('f-frequency').value.trim(),
      matured:    document.getElementById('f-matured').checked,
    };
    try {
      if (state.editingBondId) { await updateBond(state.editingBondId, data); toast('Bond updated ✓', 'success'); }
      else                     { await addBond(data);                          toast('Bond added ✓',   'success'); }
      closeModal();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = state.editingBondId ? 'Save Changes' : 'Add Bond';
    }
  });

  /* delete confirm */
  const closeConfirm = () => {
    document.getElementById('confirm-modal').classList.add('hidden');
    state.pendingDeleteId = null;
  };
  document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);
  document.getElementById('confirm-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeConfirm(); });
  document.getElementById('confirm-delete').addEventListener('click', async () => {
    if (!state.pendingDeleteId) return;
    try {
      await deleteBond(state.pendingDeleteId);
      toast('Bond deleted', 'info');
      closeConfirm();
    } catch (e) {
      toast('Delete failed: ' + e.message, 'error');
    }
  });

  /* partners modal */
  document.getElementById('btn-partners').addEventListener('click', openPartnersModal);
  document.getElementById('partners-close-btn').addEventListener('click', closePartnersModal);
  document.getElementById('partners-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closePartnersModal(); });

  document.getElementById('btn-add-partner-action').addEventListener('click', async () => {
    const email = document.getElementById('partner-email-input').value.trim();
    if (!email) return;
    const btn = document.getElementById('btn-add-partner-action');
    btn.disabled = true; btn.textContent = 'Adding…';
    try {
      await addPartnerEmail(state.currentUser.uid, email);
      document.getElementById('partner-email-input').value = '';
    } catch (e) {
      toast('Failed: ' + e.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Add';
    }
  });

  document.getElementById('partner-email-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-add-partner-action').click();
  });

  document.getElementById('partner-list').addEventListener('click', async e => {
    const btn = e.target.closest('.btn-remove-partner');
    if (!btn) return;
    const email = btn.dataset.email;
    btn.disabled = true; btn.textContent = 'Removing…';
    try { await removePartnerEmail(state.currentUser.uid, email); }
    catch (e) { toast('Failed: ' + e.message, 'error'); btn.disabled = false; btn.textContent = 'Remove'; }
  });
}
