import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db }    from './firebase-init.js';
import { state } from './state.js';
import { fmt }   from './utils.js';
import { toast } from './ui.js';

/* ─────────────────────────────────────────────────────────────────
   FIRESTORE
   ───────────────────────────────────────────────────────────────── */
const epfColRef = uid => collection(db, 'users', uid, 'epf');
const epfDocRef = (uid, id) => doc(db, 'users', uid, 'epf', id);

export function startListeningEPF(uid) {
  if (state.epfUnsub) { state.epfUnsub(); state.epfUnsub = null; }
  state.epfUnsub = onSnapshot(
    epfColRef(uid),
    snap => {
      state.epf = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderEPFSection();
    },
    () => toast('Could not load EPF data. Check Firestore rules.', 'error'),
  );
}

export const addEPF    = data => addDoc(epfColRef(state.currentUser.uid), { ...data, createdAt: serverTimestamp() });
export const updateEPF = (id, data) => updateDoc(epfDocRef(state.currentUser.uid, id), { ...data, updatedAt: serverTimestamp() });
export const deleteEPF = id => deleteDoc(epfDocRef(state.currentUser.uid, id));

/* ─────────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────────── */

// Compute totals for one account
function accountTotals(account) {
  const opening  = account.openingBalance || 0;
  const rows     = account.yearlyData || [];
  let employee   = 0, employer = 0, interest = 0;
  rows.forEach(r => {
    employee += r.employeeContribution || 0;
    employer += r.employerContribution || 0;
    interest += r.interest             || 0;
  });
  const invested = opening + employee + employer;
  const balance  = invested + interest;
  return { opening, employee, employer, interest, invested, balance };
}

// "2023-24" → sort key (use end year)
function fyToSortKey(fy) {
  const parts = fy.split('-');
  return parts[parts.length - 1];
}

/* ─────────────────────────────────────────────────────────────────
   KPI CARDS
   ───────────────────────────────────────────────────────────────── */
function renderEPFKpis() {
  let totBalance = 0, totEmployee = 0, totEmployer = 0, totInterest = 0;

  state.epf.forEach(acc => {
    const t = accountTotals(acc);
    totBalance  += t.balance;
    totEmployee += t.employee;
    totEmployer += t.employer;
    totInterest += t.interest;
  });

  const retPct = (totBalance - totInterest) > 0
    ? (totInterest / (totBalance - totInterest)) * 100
    : 0;

  const KSVG = (d, s = '#fff') =>
    `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:none;stroke:${s};stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${d}</svg>`;

  document.getElementById('epfKpiGrid').innerHTML = [
    {
      icon:  KSVG('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/>'),
      label: 'Total EPF Balance', cls: 'primary',
      value: fmt(Math.round(totBalance)),
      sub:   `${state.epf.length} account${state.epf.length !== 1 ? 's' : ''}`,
    },
    {
      icon:  KSVG('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>'),
      label: 'Your Contributions', cls: '',
      value: fmt(Math.round(totEmployee)),
      sub:   'Employee share',
    },
    {
      icon:  KSVG('<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>'),
      label: 'Employer Contributions', cls: '',
      value: fmt(Math.round(totEmployer)),
      sub:   'Employer share',
    },
    {
      icon:  KSVG('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
      label: 'Interest Earned', cls: 'success',
      value: fmt(Math.round(totInterest)),
      sub:   totBalance > 0 ? `${retPct.toFixed(2)}% overall return` : '—',
    },
  ].map(k => `<div class="kpi-card ${k.cls}">
    <div class="kpi-icon">${k.icon}</div>
    <div class="kpi-label">${k.label}</div>
    <div class="kpi-value">${k.value}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`).join('');
}

/* ─────────────────────────────────────────────────────────────────
   ACCOUNT CARDS
   ───────────────────────────────────────────────────────────────── */
function renderEPFAccounts() {
  const container = document.getElementById('epfAccountList');

  if (!state.epf.length) {
    container.innerHTML = `<div style="text-align:center;padding:48px 24px;color:#94a3b8;font-size:14px">
      No EPF accounts added yet. Click "+ Add Account" to get started.
    </div>`;
    return;
  }

  container.innerHTML = state.epf.map(account => {
    const t    = accountTotals(account);
    const rows = [...(account.yearlyData || [])].sort((a, b) =>
      fyToSortKey(a.year) < fyToSortKey(b.year) ? -1 : 1
    );

    // Running balance per row
    let runningBal = account.openingBalance || 0;

    const statusBadge = account.status === 'inactive'
      ? `<span class="badge" style="background:#fef3c7;color:#92400e;font-size:10px">Inactive</span>`
      : `<span class="badge" style="background:#d1fae5;color:#065f46;font-size:10px">Active</span>`;

    const actionsHtml = !state.isViewMode ? `
      <div class="actions">
        <button class="btn-icon bi-edit" data-epfaction="edit"   data-epfid="${account.id}" title="Edit">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn-icon bi-del" data-epfaction="delete" data-epfid="${account.id}" title="Delete">
          <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>` : '';

    const yearRows = rows.map(r => {
      const rowTotal = (r.employeeContribution || 0) + (r.employerContribution || 0) + (r.interest || 0);
      runningBal += rowTotal;
      return `<tr>
        <td style="font-weight:500">${r.year}</td>
        <td class="num">${fmt(Math.round(r.employeeContribution || 0))}</td>
        <td class="num">${fmt(Math.round(r.employerContribution || 0))}</td>
        <td class="num" style="color:#059669">+${fmt(Math.round(r.interest || 0))}</td>
        <td class="num">${fmt(Math.round(rowTotal))}</td>
        <td class="num" style="font-weight:600">${fmt(Math.round(runningBal))}</td>
      </tr>`;
    }).join('');

    const openingRow = (account.openingBalance || 0) > 0 ? `
      <tr>
        <td style="font-weight:500;color:#64748b">Opening Balance</td>
        <td class="num" colspan="4" style="color:#94a3b8">—</td>
        <td class="num" style="font-weight:500">${fmt(Math.round(account.openingBalance))}</td>
      </tr>` : '';

    const footerRow = rows.length ? `
      <tfoot><tr style="font-weight:700;border-top:1px solid #909090">
        <td style="padding:10px 12px;font-size:12px;color:#94a3b8;text-align:right">Total</td>
        <td class="num" style="padding:10px 12px">${fmt(Math.round(t.employee))}</td>
        <td class="num" style="padding:10px 12px">${fmt(Math.round(t.employer))}</td>
        <td class="num" style="padding:10px 12px;color:#059669">+${fmt(Math.round(t.interest))}</td>
        <td class="num" style="padding:10px 12px">${fmt(Math.round(t.employee + t.employer + t.interest))}</td>
        <td class="num" style="padding:10px 12px">${fmt(Math.round(t.balance))}</td>
      </tr></tfoot>` : '';

    // Card title line: employer name + meta + balance summary on right + actions
    const titleMeta = [
      statusBadge,
      account.holderName    ? `<span style="font-size:12px;font-weight:400;color:#64748b">${account.holderName}</span>` : '',
      account.accountNumber ? `<span style="font-size:11px;font-weight:400;color:#94a3b8">· UAN ${account.accountNumber}</span>` : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="card" style="margin:0 16px 16px">
        <div class="card-title" style="justify-content:space-between;margin-bottom:14px">
          <span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${account.employerName || '—'}
            ${titleMeta}
          </span>
          <span style="display:flex;align-items:center;gap:16px;margin-left:auto;padding-left:16px">
            <span style="font-size:13px;font-weight:400;color:#64748b">
              Balance <strong style="color:#1e293b;font-size:15px">${fmt(Math.round(t.balance))}</strong>
            </span>
            <span style="font-size:13px;font-weight:600;color:#059669">+${fmt(Math.round(t.interest))} interest</span>
            ${actionsHtml}
          </span>
        </div>
        <div class="table-wrap">
          ${rows.length ? `
          <table class="data-table">
            <thead><tr>
              <th>Financial Year</th>
              <th class="num">Employee (₹)</th>
              <th class="num">Employer (₹)</th>
              <th class="num">Interest (₹)</th>
              <th class="num">Year Total</th>
              <th class="num">Balance</th>
            </tr></thead>
            <tbody>
              ${openingRow}
              ${yearRows}
            </tbody>
            ${footerRow}
          </table>` : `<div style="padding:12px 0;text-align:center;color:#94a3b8;font-size:13px">No year data yet. Edit the account to add contributions.</div>`}
        </div>
      </div>`;
  }).join('');
}

/* ─────────────────────────────────────────────────────────────────
   MAIN RENDER
   ───────────────────────────────────────────────────────────────── */
export function renderEPFSection() {
  renderEPFKpis();
  renderEPFAccounts();
  window.__renderOverview?.();
}

/* ─────────────────────────────────────────────────────────────────
   MODAL — YEAR ROW HELPERS
   ───────────────────────────────────────────────────────────────── */
// Shared inline style for all editable inputs inside the year table
const INP = 'style="width:100%;padding:6px 8px;font-size:12px;border:1.5px solid #e2e8f0;border-radius:7px;background:#fff;color:#0f172a;outline:none;box-sizing:border-box"';
const INP_R = 'style="width:100%;padding:6px 8px;font-size:12px;border:1.5px solid #e2e8f0;border-radius:7px;background:#fff;color:#0f172a;outline:none;box-sizing:border-box;text-align:right"';

function makeYearRow(data = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td style="padding:4px 8px"><input class="epf-yr-year" ${INP}   placeholder="2024-25"  value="${data.year || ''}" /></td>
    <td style="padding:4px 8px"><input class="epf-yr-emp"  ${INP_R} type="number" min="0" step="0.01" placeholder="0" value="${data.employeeContribution ?? ''}" /></td>
    <td style="padding:4px 8px"><input class="epf-yr-er"   ${INP_R} type="number" min="0" step="0.01" placeholder="0" value="${data.employerContribution ?? ''}" /></td>
    <td style="padding:4px 8px"><input class="epf-yr-int"  ${INP_R} type="number" min="0" step="0.01" placeholder="0" value="${data.interest ?? ''}" /></td>
    <td style="padding:4px 8px;text-align:center">
      <button type="button" class="btn-icon bi-del epf-del-row" title="Remove row">
        <svg viewBox="0 0 24 24" style="width:14px;height:14px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>
    </td>
  `;
  tr.querySelector('.epf-del-row').addEventListener('click', () => tr.remove());
  return tr;
}

function collectYearRows() {
  return [...document.querySelectorAll('#epf-year-rows tr')].map(tr => ({
    year:                  tr.querySelector('.epf-yr-year')?.value.trim() || '',
    employeeContribution:  parseFloat(tr.querySelector('.epf-yr-emp')?.value)  || 0,
    employerContribution:  parseFloat(tr.querySelector('.epf-yr-er')?.value)   || 0,
    interest:              parseFloat(tr.querySelector('.epf-yr-int')?.value)   || 0,
  })).filter(r => r.year);
}

/* ─────────────────────────────────────────────────────────────────
   MODAL — OPEN / CLOSE
   ───────────────────────────────────────────────────────────────── */
export function openEPFModal(id = null) {
  state.editingEPFId = id;
  const acc = id ? state.epf.find(x => x.id === id) : null;

  document.getElementById('epf-modal-title').textContent = acc ? 'Edit EPF Account' : 'Add EPF Account';
  document.getElementById('epf-save-btn').textContent    = acc ? 'Save Changes'     : 'Add Account';
  document.getElementById('epff-holderName').value       = acc?.holderName       || '';
  document.getElementById('epff-accountNumber').value    = acc?.accountNumber    || '';
  document.getElementById('epff-employerName').value     = acc?.employerName     || '';
  document.getElementById('epff-status').value           = acc?.status           || 'active';
  document.getElementById('epff-openingBalance').value   = acc?.openingBalance   || '';

  // Populate year rows
  const tbody = document.getElementById('epf-year-rows');
  tbody.innerHTML = '';
  (acc?.yearlyData || [])
    .sort((a, b) => fyToSortKey(a.year) < fyToSortKey(b.year) ? -1 : 1)
    .forEach(r => tbody.appendChild(makeYearRow(r)));

  document.getElementById('epf-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('epff-holderName').focus(), 50);
}

function closeEPFModal() {
  document.getElementById('epf-modal').classList.add('hidden');
  document.getElementById('epf-form').reset();
  document.getElementById('epf-year-rows').innerHTML = '';
  state.editingEPFId = null;
}

/* ─────────────────────────────────────────────────────────────────
   EVENT LISTENERS
   ───────────────────────────────────────────────────────────────── */
export function initEPFListeners() {
  // Account card actions (edit / delete)
  document.getElementById('epfAccountList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-epfaction]');
    if (!btn) return;
    const { epfaction, epfid } = btn.dataset;
    if (epfaction === 'edit') { openEPFModal(epfid); return; }
    if (epfaction === 'delete') {
      if (!confirm('Remove this EPF account and all its data? This cannot be undone.')) return;
      try {
        await deleteEPF(epfid);
        state.epf = state.epf.filter(a => a.id !== epfid);
        renderEPFSection();
        toast('EPF account removed', 'info');
      } catch (err) { toast('Delete failed: ' + err.message, 'error'); }
    }
  });

  // Add account button
  document.getElementById('btn-add-epf').addEventListener('click', () => openEPFModal());

  // Add year row button
  document.getElementById('epf-add-year-row').addEventListener('click', () => {
    document.getElementById('epf-year-rows').appendChild(makeYearRow());
  });

  // Modal close
  document.getElementById('epf-modal-close').addEventListener('click', closeEPFModal);
  document.getElementById('epf-cancel-btn').addEventListener('click', closeEPFModal);
  document.getElementById('epf-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeEPFModal();
  });

  // Form submit
  document.getElementById('epf-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('epf-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';

    const data = {
      holderName:     document.getElementById('epff-holderName').value.trim(),
      accountNumber:  document.getElementById('epff-accountNumber').value.trim(),
      employerName:   document.getElementById('epff-employerName').value.trim(),
      status:         document.getElementById('epff-status').value,
      openingBalance: parseFloat(document.getElementById('epff-openingBalance').value) || 0,
      yearlyData:     collectYearRows(),
    };

    try {
      if (state.editingEPFId) {
        await updateEPF(state.editingEPFId, data);
        state.epf = state.epf.map(a => a.id === state.editingEPFId ? { ...a, ...data } : a);
        toast('EPF account updated ✓', 'success');
      } else {
        const ref = await addEPF(data);
        state.epf = [...state.epf, { id: ref.id, ...data }];
        toast('EPF account added ✓', 'success');
      }
      renderEPFSection();
      closeEPFModal();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = state.editingEPFId ? 'Save Changes' : 'Add Account';
    }
  });
}
