import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db }           from './firebase-init.js';
import { state }        from './state.js';
import { fmt, fmtDate } from './utils.js';
import { toast }        from './ui.js';

/* ─────────────────────────────────────────────────────────────────
   FIRESTORE REFS
   ───────────────────────────────────────────────────────────────── */
const fdColRef = uid => collection(db, 'users', uid, 'fds');
const fdDocRef = (uid, id) => doc(db, 'users', uid, 'fds', id);
const rdColRef = uid => collection(db, 'users', uid, 'rds');
const rdDocRef = (uid, id) => doc(db, 'users', uid, 'rds', id);

/* ─────────────────────────────────────────────────────────────────
   LISTENERS
   ───────────────────────────────────────────────────────────────── */
export function startListeningFD(uid) {
  if (state.fdUnsub) { state.fdUnsub(); state.fdUnsub = null; }
  state.fdUnsub = onSnapshot(fdColRef(uid), snap => {
    state.fds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFDSection();
  }, () => toast('Could not load FD data. Check Firestore rules.', 'error'));
}

export function startListeningRD(uid) {
  if (state.rdUnsub) { state.rdUnsub(); state.rdUnsub = null; }
  state.rdUnsub = onSnapshot(rdColRef(uid), snap => {
    state.rds = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRDSection();
  }, () => toast('Could not load RD data. Check Firestore rules.', 'error'));
}

/* ─────────────────────────────────────────────────────────────────
   CRUD
   ───────────────────────────────────────────────────────────────── */
export const addFD    = data => addDoc(fdColRef(state.currentUser.uid), { ...data, createdAt: serverTimestamp() });
export const updateFD = (id, data) => updateDoc(fdDocRef(state.currentUser.uid, id), { ...data, updatedAt: serverTimestamp() });
export const deleteFD = id => deleteDoc(fdDocRef(state.currentUser.uid, id));

export const addRD    = data => addDoc(rdColRef(state.currentUser.uid), { ...data, createdAt: serverTimestamp() });
export const updateRD = (id, data) => updateDoc(rdDocRef(state.currentUser.uid, id), { ...data, updatedAt: serverTimestamp() });
export const deleteRD = id => deleteDoc(rdDocRef(state.currentUser.uid, id));

/* ─────────────────────────────────────────────────────────────────
   CALCULATIONS
   ───────────────────────────────────────────────────────────────── */
function monthDiff(d1, d2) {
  const a = new Date(d1), b = new Date(d2);
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()));
}

// FD maturity using quarterly compounding (standard for Indian FDs)
function fdMaturityAmount(principal, rate, startDate, maturityDate) {
  if (!principal || !rate || !startDate || !maturityDate) return 0;
  const ms    = new Date(maturityDate) - new Date(startDate);
  const years = ms / (365.25 * 24 * 3600 * 1000);
  return principal * Math.pow(1 + rate / 400, years * 4);
}

// RD: how many installments have been deducted so far
function rdInstallmentsPaid(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const today = new Date();
  let months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
  if (today.getDate() >= start.getDate()) months++;
  return Math.max(0, months);
}

// RD maturity using quarterly compounding converted to monthly rate
function rdMaturityAmount(monthlyAmount, rate, startDate, maturityDate) {
  if (!monthlyAmount || !rate || !startDate || !maturityDate) return 0;
  const n = monthDiff(startDate, maturityDate);
  if (n <= 0) return 0;
  const i = Math.pow(1 + rate / 400, 1 / 3) - 1; // monthly equivalent of quarterly rate
  if (i <= 0) return monthlyAmount * n;
  return monthlyAmount * (Math.pow(1 + i, n) - 1) * (1 + i) / i;
}

function tenure(startDate, maturityDate) {
  if (!startDate || !maturityDate) return '—';
  const m = monthDiff(startDate, maturityDate);
  const y = Math.floor(m / 12), rem = m % 12;
  if (y === 0) return `${rem}m`;
  if (rem === 0) return `${y}y`;
  return `${y}y ${rem}m`;
}

function statusBadge(maturityDate) {
  if (!maturityDate) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const mat   = new Date(maturityDate);
  const days  = Math.ceil((mat - today) / (24 * 3600 * 1000));
  if (days < 0)   return `<span class="badge badge-matured">Matured</span>`;
  if (days <= 30) return `<span class="badge badge-soon">Maturing Soon</span>`;
  return `<span class="badge badge-active">Active</span>`;
}

/* ─────────────────────────────────────────────────────────────────
   KPI CARDS
   ───────────────────────────────────────────────────────────────── */
function renderFDRDKpis() {
  const totalFDPrincipal = state.fds.reduce((s, f) => s + (f.principal || 0), 0);
  const totalFDMaturity  = state.fds.reduce((s, f) =>
    s + fdMaturityAmount(f.principal, f.interestRate, f.startDate, f.maturityDate), 0);

  const totalRDInvested = state.rds.reduce((s, r) => {
    const total = monthDiff(r.startDate, r.maturityDate);
    const paid  = Math.min(rdInstallmentsPaid(r.startDate), total);
    return s + paid * (r.monthlyAmount || 0);
  }, 0);
  const totalRDMaturity = state.rds.reduce((s, r) =>
    s + rdMaturityAmount(r.monthlyAmount, r.interestRate, r.startDate, r.maturityDate), 0);

  const KSVG = (d, s = '#fff') =>
    `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:none;stroke:${s};stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${d}</svg>`;

  document.getElementById('fdKpiGrid').innerHTML = [
    {
      icon:  KSVG('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>'),
      label: 'FD Principal', cls: 'primary',
      value: fmt(Math.round(totalFDPrincipal)),
      sub:   `${state.fds.length} deposit${state.fds.length !== 1 ? 's' : ''}`,
    },
    {
      icon:  KSVG('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
      label: 'FD at Maturity', cls: 'success',
      value: fmt(Math.round(totalFDMaturity)),
      sub:   totalFDPrincipal > 0
        ? `+${fmt(Math.round(totalFDMaturity - totalFDPrincipal))} interest`
        : 'Add FDs to see',
    },
    {
      icon:  KSVG('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>'),
      label: 'RD Invested So Far', cls: '',
      value: fmt(Math.round(totalRDInvested)),
      sub:   `${state.rds.length} RD${state.rds.length !== 1 ? 's' : ''} active`,
    },
    {
      icon:  KSVG('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
      label: 'RD at Maturity', cls: '',
      value: fmt(Math.round(totalRDMaturity)),
      sub:   totalRDInvested > 0
        ? `+${fmt(Math.round(totalRDMaturity - totalRDInvested))} interest`
        : 'Add RDs to see',
    },
  ].map(k => `<div class="kpi-card ${k.cls}">
    <div class="kpi-icon">${k.icon}</div>
    <div class="kpi-label">${k.label}</div>
    <div class="kpi-value">${k.value}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`).join('');
}

/* ─────────────────────────────────────────────────────────────────
   FD TABLE
   ───────────────────────────────────────────────────────────────── */
export function renderFDSection() {
  renderFDRDKpis();
  const tbody = document.getElementById('fdTableBody');

  if (!state.fds.length) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:32px;color:#94a3b8;font-size:14px">No FDs added yet</td></tr>`;
    document.getElementById('fdTableCount').textContent = '';
    return;
  }

  // Sort
  let sorted = [...state.fds];
  if (state.fdSortCol) {
    sorted.sort((a, b) => {
      let va, vb;
      if (state.fdSortCol === 'maturityAmt') {
        va = fdMaturityAmount(a.principal, a.interestRate, a.startDate, a.maturityDate);
        vb = fdMaturityAmount(b.principal, b.interestRate, b.startDate, b.maturityDate);
      } else if (state.fdSortCol === 'gain') {
        va = fdMaturityAmount(a.principal, a.interestRate, a.startDate, a.maturityDate) - (a.principal || 0);
        vb = fdMaturityAmount(b.principal, b.interestRate, b.startDate, b.maturityDate) - (b.principal || 0);
      } else if (state.fdSortCol === 'tenure') {
        va = monthDiff(a.startDate, a.maturityDate);
        vb = monthDiff(b.startDate, b.maturityDate);
      } else if (state.fdSortCol === 'status') {
        va = a.maturityDate ? new Date(a.maturityDate).getTime() : Infinity;
        vb = b.maturityDate ? new Date(b.maturityDate).getTime() : Infinity;
      } else {
        va = a[state.fdSortCol] ?? '';
        vb = b[state.fdSortCol] ?? '';
      }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return state.fdSortDir === 'asc' ? -1 : 1;
      if (va > vb) return state.fdSortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  // Update sort indicators
  document.querySelectorAll('[data-fdsort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.fdsort === state.fdSortCol)
      th.classList.add(state.fdSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });

  tbody.innerHTML = sorted.map((f, i) => {
    const mat  = fdMaturityAmount(f.principal, f.interestRate, f.startDate, f.maturityDate);
    const gain = mat - (f.principal || 0);
    return `<tr>
      <td style="color:#94a3b8;font-size:11px">${i + 1}</td>
      <td><div class="bond-name">${f.name || '—'}</div></td>
      <td class="num">${fmt(f.principal || 0)}</td>
      <td class="num">${f.interestRate ? f.interestRate + '%' : '—'}</td>
      <td style="white-space:nowrap">${f.startDate ? fmtDate(f.startDate) : '—'}</td>
      <td style="white-space:nowrap">${f.maturityDate ? fmtDate(f.maturityDate) : '—'}</td>
      <td style="white-space:nowrap">${tenure(f.startDate, f.maturityDate)}</td>
      <td class="num" style="font-weight:700">${mat > 0 ? fmt(Math.round(mat)) : '—'}</td>
      <td class="num" style="color:#059669;font-weight:600">${gain > 0 ? '+' + fmt(Math.round(gain)) : '—'}</td>
      <td>${f.investedBy || '—'}</td>
      <td>${statusBadge(f.maturityDate)}</td>
      ${!state.isViewMode ? `<td id="fd-th-actions">
        <div class="actions">
          <button class="btn-icon bi-edit" data-fdaction="edit"   data-fdid="${f.id}" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon bi-del"  data-fdaction="delete" data-fdid="${f.id}" title="Delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </td>` : ''}
    </tr>`;
  }).join('');

  document.getElementById('fdTableCount').textContent =
    `${state.fds.length} FD${state.fds.length !== 1 ? 's' : ''}`;
}

/* ─────────────────────────────────────────────────────────────────
   RD TABLE
   ───────────────────────────────────────────────────────────────── */
export function renderRDSection() {
  renderFDRDKpis();
  const tbody = document.getElementById('rdTableBody');

  if (!state.rds.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:32px;color:#94a3b8;font-size:14px">No RDs added yet</td></tr>`;
    document.getElementById('rdTableCount').textContent = '';
    return;
  }

  // Sort
  let sorted = [...state.rds];
  if (state.rdSortCol) {
    sorted.sort((a, b) => {
      let va, vb;
      if (state.rdSortCol === 'maturityAmt') {
        va = rdMaturityAmount(a.monthlyAmount, a.interestRate, a.startDate, a.maturityDate);
        vb = rdMaturityAmount(b.monthlyAmount, b.interestRate, b.startDate, b.maturityDate);
      } else if (state.rdSortCol === 'gain') {
        const totalA = monthDiff(a.startDate, a.maturityDate) * (a.monthlyAmount || 0);
        const totalB = monthDiff(b.startDate, b.maturityDate) * (b.monthlyAmount || 0);
        va = rdMaturityAmount(a.monthlyAmount, a.interestRate, a.startDate, a.maturityDate) - totalA;
        vb = rdMaturityAmount(b.monthlyAmount, b.interestRate, b.startDate, b.maturityDate) - totalB;
      } else if (state.rdSortCol === 'tenure') {
        va = monthDiff(a.startDate, a.maturityDate);
        vb = monthDiff(b.startDate, b.maturityDate);
      } else if (state.rdSortCol === 'invested') {
        const paidA = Math.min(rdInstallmentsPaid(a.startDate), monthDiff(a.startDate, a.maturityDate));
        const paidB = Math.min(rdInstallmentsPaid(b.startDate), monthDiff(b.startDate, b.maturityDate));
        va = paidA * (a.monthlyAmount || 0);
        vb = paidB * (b.monthlyAmount || 0);
      } else if (state.rdSortCol === 'status') {
        va = a.maturityDate ? new Date(a.maturityDate).getTime() : Infinity;
        vb = b.maturityDate ? new Date(b.maturityDate).getTime() : Infinity;
      } else {
        va = a[state.rdSortCol] ?? '';
        vb = b[state.rdSortCol] ?? '';
      }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return state.rdSortDir === 'asc' ? -1 : 1;
      if (va > vb) return state.rdSortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  // Update sort indicators
  document.querySelectorAll('[data-rdsort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.rdsort === state.rdSortCol)
      th.classList.add(state.rdSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });

  tbody.innerHTML = sorted.map((r, i) => {
    const total    = monthDiff(r.startDate, r.maturityDate);
    const paid     = Math.min(rdInstallmentsPaid(r.startDate), total);
    const invested = paid * (r.monthlyAmount || 0);
    const mat      = rdMaturityAmount(r.monthlyAmount, r.interestRate, r.startDate, r.maturityDate);
    const totalDeposit = total * (r.monthlyAmount || 0);
    const gain     = mat - totalDeposit;
    return `<tr>
      <td style="color:#94a3b8;font-size:11px">${i + 1}</td>
      <td><div class="bond-name">${r.name || '—'}</div></td>
      <td class="num">${fmt(r.monthlyAmount || 0)}<span style="font-size:10px;opacity:.6">/mo</span></td>
      <td class="num">${r.interestRate ? r.interestRate + '%' : '—'}</td>
      <td style="white-space:nowrap">${r.startDate ? fmtDate(r.startDate) : '—'}</td>
      <td style="white-space:nowrap">${r.maturityDate ? fmtDate(r.maturityDate) : '—'}</td>
      <td style="text-align:center;white-space:nowrap">
        <span style="font-weight:700">${paid}</span><span style="opacity:.5"> / ${total}</span>
      </td>
      <td class="num">${fmt(Math.round(invested))}</td>
      <td class="num" style="font-weight:700">${mat > 0 ? fmt(Math.round(mat)) : '—'}</td>
      <td class="num" style="color:#059669;font-weight:600">${gain > 0 ? '+' + fmt(Math.round(gain)) : '—'}</td>
      <td>${r.investedBy || '—'}</td>
      <td>${statusBadge(r.maturityDate)}</td>
      ${!state.isViewMode ? `<td>
        <div class="actions">
          <button class="btn-icon bi-edit" data-rdaction="edit"   data-rdid="${r.id}" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon bi-del"  data-rdaction="delete" data-rdid="${r.id}" title="Delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </td>` : ''}
    </tr>`;
  }).join('');

  document.getElementById('rdTableCount').textContent =
    `${state.rds.length} RD${state.rds.length !== 1 ? 's' : ''}`;
}

/* ─────────────────────────────────────────────────────────────────
   FD MODAL
   ───────────────────────────────────────────────────────────────── */
export function openFDModal(fdId = null) {
  state.editingFDId = fdId;
  const f = fdId ? state.fds.find(x => x.id === fdId) : null;
  document.getElementById('fd-modal-title').textContent = f ? 'Edit FD' : 'Add FD';
  document.getElementById('fd-save-btn').textContent    = f ? 'Save Changes' : 'Add FD';
  document.getElementById('ff-name').value         = f?.name         || '';
  document.getElementById('ff-principal').value    = f?.principal    || '';
  document.getElementById('ff-rate').value         = f?.interestRate || '';
  document.getElementById('ff-startDate').value    = f?.startDate    || '';
  document.getElementById('ff-maturityDate').value = f?.maturityDate || '';
  document.getElementById('ff-investedBy').value   = f?.investedBy   || '';
  document.getElementById('fd-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('ff-name').focus(), 50);
}

function closeFDModal() {
  document.getElementById('fd-modal').classList.add('hidden');
  document.getElementById('fd-form').reset();
  state.editingFDId = null;
}

/* ─────────────────────────────────────────────────────────────────
   RD MODAL
   ───────────────────────────────────────────────────────────────── */
export function openRDModal(rdId = null) {
  state.editingRDId = rdId;
  const r = rdId ? state.rds.find(x => x.id === rdId) : null;
  document.getElementById('rd-modal-title').textContent = r ? 'Edit RD' : 'Add RD';
  document.getElementById('rd-save-btn').textContent    = r ? 'Save Changes' : 'Add RD';
  document.getElementById('rf-name').value         = r?.name          || '';
  document.getElementById('rf-monthly').value      = r?.monthlyAmount || '';
  document.getElementById('rf-rate').value         = r?.interestRate  || '';
  document.getElementById('rf-startDate').value    = r?.startDate     || '';
  document.getElementById('rf-maturityDate').value = r?.maturityDate  || '';
  document.getElementById('rf-investedBy').value   = r?.investedBy    || '';
  document.getElementById('rd-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('rf-name').focus(), 50);
}

function closeRDModal() {
  document.getElementById('rd-modal').classList.add('hidden');
  document.getElementById('rd-form').reset();
  state.editingRDId = null;
}

/* ─────────────────────────────────────────────────────────────────
   EVENT LISTENERS
   ───────────────────────────────────────────────────────────────── */
export function initFDListeners() {
  /* FD table header sort */
  document.getElementById('fdTableBody').closest('table').querySelector('thead').addEventListener('click', e => {
    const th = e.target.closest('[data-fdsort]');
    if (!th) return;
    const col = th.dataset.fdsort;
    if (state.fdSortCol === col) {
      state.fdSortDir = state.fdSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.fdSortCol = col;
      state.fdSortDir = 'asc';
    }
    renderFDSection();
  });

  /* RD table header sort */
  document.getElementById('rdTableBody').closest('table').querySelector('thead').addEventListener('click', e => {
    const th = e.target.closest('[data-rdsort]');
    if (!th) return;
    const col = th.dataset.rdsort;
    if (state.rdSortCol === col) {
      state.rdSortDir = state.rdSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.rdSortCol = col;
      state.rdSortDir = 'asc';
    }
    renderRDSection();
  });

  /* FD table row actions */
  document.getElementById('fdTableBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-fdaction]');
    if (!btn) return;
    const { fdaction, fdid } = btn.dataset;
    if (fdaction === 'edit') { openFDModal(fdid); return; }
    if (fdaction === 'delete') {
      if (!confirm('Delete this FD? This cannot be undone.')) return;
      try { await deleteFD(fdid); toast('FD deleted', 'info'); }
      catch (err) { toast('Delete failed: ' + err.message, 'error'); }
    }
  });

  /* RD table row actions */
  document.getElementById('rdTableBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-rdaction]');
    if (!btn) return;
    const { rdaction, rdid } = btn.dataset;
    if (rdaction === 'edit') { openRDModal(rdid); return; }
    if (rdaction === 'delete') {
      if (!confirm('Delete this RD? This cannot be undone.')) return;
      try { await deleteRD(rdid); toast('RD deleted', 'info'); }
      catch (err) { toast('Delete failed: ' + err.message, 'error'); }
    }
  });

  /* FD modal open / close */
  document.getElementById('btn-add-fd').addEventListener('click', () => openFDModal());
  document.getElementById('fd-modal-close').addEventListener('click', closeFDModal);
  document.getElementById('fd-cancel-btn').addEventListener('click', closeFDModal);
  document.getElementById('fd-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeFDModal(); });

  /* FD form submit */
  document.getElementById('fd-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('fd-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    const data = {
      name:         document.getElementById('ff-name').value.trim(),
      principal:    parseFloat(document.getElementById('ff-principal').value) || 0,
      interestRate: parseFloat(document.getElementById('ff-rate').value)      || 0,
      startDate:    document.getElementById('ff-startDate').value,
      maturityDate: document.getElementById('ff-maturityDate').value,
      investedBy:   document.getElementById('ff-investedBy').value.trim(),
    };
    try {
      if (state.editingFDId) { await updateFD(state.editingFDId, data); toast('FD updated ✓', 'success'); }
      else                   { await addFD(data);                        toast('FD added ✓',   'success'); }
      closeFDModal();
    } catch (err) { toast('Error: ' + err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = state.editingFDId ? 'Save Changes' : 'Add FD'; }
  });

  /* RD modal open / close */
  document.getElementById('btn-add-rd').addEventListener('click', () => openRDModal());
  document.getElementById('rd-modal-close').addEventListener('click', closeRDModal);
  document.getElementById('rd-cancel-btn').addEventListener('click', closeRDModal);
  document.getElementById('rd-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeRDModal(); });

  /* RD form submit */
  document.getElementById('rd-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('rd-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    const data = {
      name:          document.getElementById('rf-name').value.trim(),
      monthlyAmount: parseFloat(document.getElementById('rf-monthly').value)  || 0,
      interestRate:  parseFloat(document.getElementById('rf-rate').value)     || 0,
      startDate:     document.getElementById('rf-startDate').value,
      maturityDate:  document.getElementById('rf-maturityDate').value,
      investedBy:    document.getElementById('rf-investedBy').value.trim(),
    };
    try {
      if (state.editingRDId) { await updateRD(state.editingRDId, data); toast('RD updated ✓', 'success'); }
      else                   { await addRD(data);                        toast('RD added ✓',   'success'); }
      closeRDModal();
    } catch (err) { toast('Error: ' + err.message, 'error'); }
    finally { btn.disabled = false; btn.textContent = state.editingRDId ? 'Save Changes' : 'Add RD'; }
  });

}

