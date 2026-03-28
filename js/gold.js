import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp, getDoc, setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db }                       from './firebase-init.js';
import { state }                    from './state.js';
import { fmt, fmtDate }             from './utils.js';
import { toast, setGoldState }      from './ui.js';

/* ─────────────────────────────────────────────────────────────────
   FIRESTORE REFS & LISTENER
   ───────────────────────────────────────────────────────────────── */
const goldColRef = uid => collection(db, 'users', uid, 'gold');
const goldDocRef = (uid, id) => doc(db, 'users', uid, 'gold', id);

export function startListeningGold(uid) {
  if (state.goldUnsub) { state.goldUnsub(); state.goldUnsub = null; }
  setGoldState('loading');
  state.goldUnsub = onSnapshot(
    goldColRef(uid),
    snap => {
      state.goldItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      state.goldItems.length === 0
        ? setGoldState('empty')
        : (setGoldState('data'), renderGoldDashboard());
    },
    () => {
      toast('Could not load gold data. Check Firestore rules.', 'error');
      setGoldState('empty');
    }
  );
}

/* ─────────────────────────────────────────────────────────────────
   CRUD
   ───────────────────────────────────────────────────────────────── */
export async function addGold(data) {
  await addDoc(goldColRef(state.currentUser.uid), { ...data, createdAt: serverTimestamp() });
}
export async function updateGold(id, data) {
  await updateDoc(goldDocRef(state.currentUser.uid, id), { ...data, updatedAt: serverTimestamp() });
}
export async function deleteGold(id) {
  await deleteDoc(goldDocRef(state.currentUser.uid, id));
}

/* ─────────────────────────────────────────────────────────────────
   GOLD PRICES
   ───────────────────────────────────────────────────────────────── */
export async function loadGoldPrices(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'settings', 'goldPrice'));
    if (snap.exists()) {
      const d = snap.data();
      state.goldPrices = { price22k: d.price22k || 0, price24k: d.price24k || 0 };
      // populate edit inputs too (for when user clicks Edit)
      document.getElementById('price-22k').value = state.goldPrices.price22k || '';
      document.getElementById('price-24k').value = state.goldPrices.price24k || '';
      if (d.updatedAt) {
        const dt = d.updatedAt.toDate ? d.updatedAt.toDate() : new Date(d.updatedAt);
        document.getElementById('gold-price-updated').textContent =
          'Updated ' + dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      }
      showGoldPriceView(); // prices exist → show read-only view
    } else {
      showGoldPriceEditMode(false); // no prices yet → show input fields, no cancel
    }
  } catch {
    if (state.isViewMode) {
      showGoldPriceView(); // show "—" prices without edit option
    } else {
      showGoldPriceEditMode(false);
    }
  }
}

function showGoldPriceView() {
  const p22 = state.goldPrices.price22k;
  const p24 = state.goldPrices.price24k;
  document.getElementById('price-22k-display').textContent = p22 ? '₹' + p22.toLocaleString('en-IN') : '—';
  document.getElementById('price-24k-display').textContent = p24 ? '₹' + p24.toLocaleString('en-IN') : '—';
  document.getElementById('gold-price-view').style.display = 'grid';
  document.getElementById('gold-price-edit').style.display = 'none';
  // Hide the edit button for viewers — they can read prices but not change them
  const editBtn = document.getElementById('btn-edit-price');
  if (editBtn) editBtn.style.display = state.isViewMode ? 'none' : '';
}

function showGoldPriceEditMode(showCancel = true) {
  document.getElementById('gold-price-view').style.display = 'none';
  document.getElementById('gold-price-edit').style.display = 'grid';
  document.getElementById('btn-cancel-price').style.display = showCancel ? 'block' : 'none';
}

async function saveGoldPrices(uid) {
  const p22 = parseFloat(document.getElementById('price-22k').value) || 0;
  const p24 = parseFloat(document.getElementById('price-24k').value) || 0;
  state.goldPrices = { price22k: p22, price24k: p24 };
  await setDoc(doc(db, 'users', uid, 'settings', 'goldPrice'), {
    price22k: p22, price24k: p24, updatedAt: serverTimestamp(),
  });
  document.getElementById('gold-price-updated').textContent = 'Updated just now';
  showGoldPriceView();
  renderGoldDashboard();
  toast('Gold prices updated ✓', 'success');
}

function goldCurrentValue(g) {
  const price = g.type === '24K' ? state.goldPrices.price24k : state.goldPrices.price22k;
  return price > 0 ? (g.weight || 0) * price : 0;
}

/* ─────────────────────────────────────────────────────────────────
   DASHBOARD RENDERING
   ───────────────────────────────────────────────────────────────── */
function destroyGoldCharts() {
  Object.keys(state.goldChartInst).forEach(k => {
    if (state.goldChartInst[k]) { state.goldChartInst[k].destroy(); state.goldChartInst[k] = null; }
  });
}

export function renderGoldDashboard() {
  const owned = state.goldItems.filter(g => !g.gifted);
  const KSVG  = (d, s = '#94a3b8') =>
    `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:none;stroke:${s};stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${d}</svg>`;

  const totalWeight       = owned.reduce((s, g) => s + (g.weight        || 0), 0);
  const paidItems         = owned.filter(g => (g.totalInvested || 0) > 0);
  const paidInvested      = paidItems.reduce((s, g) => s + (g.totalInvested || 0), 0);
  const totalCurrentValue = owned.reduce((s, g) => s + goldCurrentValue(g), 0);
  const totalProfit       = totalCurrentValue - paidInvested;
  const profitPct         = paidInvested > 0 ? (totalProfit / paidInvested * 100) : 0;
  const w22 = state.goldItems.filter(g => g.type === '22K').reduce((s, g) => s + (g.weight || 0), 0);
  const w24 = state.goldItems.filter(g => g.type === '24K').reduce((s, g) => s + (g.weight || 0), 0);

  document.getElementById('goldKpiGrid').innerHTML = [
    {
      icon:  KSVG('<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 000 4h4a2 2 0 010 4H8"/><line x1="12" y1="6" x2="12" y2="18"/>', 'white'),
      label: 'Total Invested',
      value: fmt(Math.round(paidInvested)),
      sub:   `${state.goldItems.length} items · ${owned.length} owned`,
      cls:   'primary',
    },
    {
      icon:  KSVG('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>', 'white'),
      label: 'Current Value',
      value: totalCurrentValue > 0 ? fmt(Math.round(totalCurrentValue)) : '—',
      sub:   totalCurrentValue > 0
        ? (profitPct >= 0 ? '▲ ' : '▼ ') + Math.abs(profitPct).toFixed(1) + '% gain'
        : 'Set prices above',
      cls: 'success',
    },
    {
      icon:  KSVG('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', '#d97706'),
      label: 'Total Weight',
      value: totalWeight.toFixed(2) + ' g',
      sub:   `${w22.toFixed(1)}g 22K · ${w24.toFixed(1)}g 24K`,
      cls:   '',
    },
    {
      icon:  KSVG('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>', '#8b5cf6'),
      label: 'Profit / Loss',
      value: totalCurrentValue > 0 ? (totalProfit >= 0 ? '+' : '') + fmt(Math.round(totalProfit)) : '—',
      sub:   'Based on current prices',
      cls:   '',
    },
  ].map(k => `<div class="kpi-card ${k.cls}">
    <div class="kpi-icon">${k.icon}</div>
    <div class="kpi-label">${k.label}</div>
    <div class="kpi-value">${k.value}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`).join('');

  destroyGoldCharts();

  /* Karat donut */
  const karatData = {};
  owned.forEach(g => { karatData[g.type || '?'] = (karatData[g.type || '?'] || 0) + (g.weight || 0); });
  state.goldChartInst.type = new Chart(document.getElementById('goldTypeChart'), {
    type: 'doughnut',
    data: { labels: Object.keys(karatData), datasets: [{ data: Object.values(karatData), backgroundColor: ['#d97706', '#f59e0b'], borderWidth: 3, borderColor: '#fff', hoverOffset: 8 }] },
    options: { responsive: true, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12, usePointStyle: true } }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${Number(ctx.raw).toFixed(2)}g` } } } },
  });

  /* Year-wise bar */
  const yearData = {};
  owned.forEach(g => {
    if (g.date) { const yr = new Date(g.date).getFullYear(); yearData[yr] = (yearData[yr] || 0) + (g.weight || 0); }
  });
  const goldYrs = Object.keys(yearData).sort();
  const GOLD_COLORS = ['#d97706', '#b45309', '#92400e', '#f59e0b', '#fbbf24', '#fde68a'];
  state.goldChartInst.year = new Chart(document.getElementById('goldYearChart'), {
    type: 'bar',
    data: { labels: goldYrs, datasets: [{ data: goldYrs.map(y => yearData[y]), backgroundColor: goldYrs.map((_, i) => GOLD_COLORS[i % GOLD_COLORS.length]), borderRadius: 7, borderSkipped: false }] },
    options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${Number(ctx.raw).toFixed(2)}g` } } }, scales: { x: { grid: { display: false }, ticks: { font: { size: 11 } } }, y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, callback: v => v + 'g' } } } },
  });

  /* Invested vs Current Value */
  state.goldChartInst.value = new Chart(document.getElementById('goldValueChart'), {
    type: 'bar',
    data: { labels: ['Invested', 'Current Value'], datasets: [{ data: [Math.round(paidInvested), Math.round(totalCurrentValue)], backgroundColor: ['#94a3b8', '#d97706'], borderRadius: 7, borderSkipped: false }] },
    options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.raw)}` } } }, scales: { x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, callback: v => '₹' + (v / 100000).toFixed(1) + 'L' } }, y: { grid: { display: false } } } },
  });

  renderGoldTable();
}

/* ─────────────────────────────────────────────────────────────────
   GOLD TABLE
   ───────────────────────────────────────────────────────────────── */
export function renderGoldTable() {
  const q     = (document.getElementById('goldSearchInput')?.value || '').toLowerCase();
  const typeF = document.getElementById('goldTypeFilter')?.value   || '';
  const giftF = document.getElementById('goldGiftFilter')?.value   || '';

  let filtered = state.goldItems.filter(g => {
    if (q     && !(g.name || '').toLowerCase().includes(q)) return false;
    if (typeF && g.type !== typeF) return false;
    if (giftF === 'gifted'   && !g.gifted) return false;
    if (giftF === 'received' && (g.gifted || (g.paidPerGram || 0) > 0)) return false;
    if (giftF === 'owned'    && (g.gifted || (g.paidPerGram || 0) === 0)) return false;
    return true;
  });

  if (state.goldSortCol) {
    filtered.sort((a, b) => {
      let va, vb;
      if (state.goldSortCol === 'currentValue') { va = goldCurrentValue(a); vb = goldCurrentValue(b); }
      else if (state.goldSortCol === 'profit')  { va = goldCurrentValue(a) - (a.totalInvested || 0); vb = goldCurrentValue(b) - (b.totalInvested || 0); }
      else { va = a[state.goldSortCol] ?? ''; vb = b[state.goldSortCol] ?? ''; }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return state.goldSortDir === 'asc' ? -1 : 1;
      if (va > vb) return state.goldSortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  document.querySelectorAll('[data-gsort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.gsort === state.goldSortCol) th.classList.add(state.goldSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });

  document.getElementById('goldTableBody').innerHTML = filtered.map((g, i) => {
    const cv       = goldCurrentValue(g);
    const profit   = cv - (g.totalInvested || 0);
    const profCol  = profit >= 0 ? '#059669' : '#ef4444';
    const statusBadge = g.gifted
      ? `<span class="badge badge-gift">Gifted${g.giftedFor ? ' · ' + g.giftedFor : ''}</span>`
      : (g.paidPerGram || 0) === 0
        ? `<span class="badge" style="background:#f0fdf4;color:#166534">Received Gift</span>`
        : `<span class="badge badge-active">Owned</span>`;
    return `<tr>
      <td style="color:#94a3b8;font-size:11px">${i + 1}</td>
      <td><div class="bond-name">${g.name || '—'}</div></td>
      <td><span class="badge ${g.type === '24K' ? 'badge-24k' : 'badge-22k'}">${g.type || '—'}</span></td>
      <td class="num">${(g.weight || 0).toFixed(2)}g</td>
      <td class="num">${(g.paidPerGram || 0) > 0 ? fmt(g.paidPerGram) : '—'}</td>
      <td class="num">${(g.totalInvested || 0) > 0 ? fmt(g.totalInvested) : '—'}</td>
      <td class="num" style="font-weight:700">${cv > 0 ? fmt(Math.round(cv)) : '—'}</td>
      <td class="num" style="font-weight:700;color:${cv > 0 ? profCol : '#94a3b8'}">${cv > 0 ? (profit >= 0 ? '+' : '') + fmt(Math.round(profit)) : '—'}</td>
      <td style="white-space:nowrap">${g.date ? fmtDate(g.date) : '—'}</td>
      <td>${statusBadge}</td>
      ${!state.isViewMode ? `<td>
        <div class="actions">
          <button class="btn-icon bi-edit" data-gaction="edit"   data-gid="${g.id}" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon bi-del"  data-gaction="delete" data-gid="${g.id}" title="Delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </td>` : ''}
    </tr>`;
  }).join('');

  document.getElementById('goldTableCount').textContent =
    `Showing ${filtered.length} of ${state.goldItems.length} items`;
}

/* ─────────────────────────────────────────────────────────────────
   GOLD MODAL
   ───────────────────────────────────────────────────────────────── */
export function openGoldModal(goldId = null) {
  state.editingGoldId = goldId;
  const g = goldId ? state.goldItems.find(x => x.id === goldId) : null;
  document.getElementById('gold-modal-title').textContent = g ? 'Edit Gold Item' : 'Add Gold Item';
  document.getElementById('gold-save-btn').textContent    = g ? 'Save Changes'   : 'Add Item';
  document.getElementById('gf-name').value          = g?.name          || '';
  document.getElementById('gf-type').value          = g?.type          || '';
  document.getElementById('gf-date').value          = g?.date          || '';
  document.getElementById('gf-weight').value        = g?.weight        || '';
  document.getElementById('gf-paidPerGram').value   = g?.paidPerGram   || '';
  document.getElementById('gf-totalInvested').value = g?.totalInvested || '';
  document.getElementById('gf-gifted').checked      = g?.gifted        || false;
  document.getElementById('gf-giftedFor').value     = g?.giftedFor     || '';
  document.getElementById('gf-gifted-for-field').style.display = g?.gifted ? 'block' : 'none';
  document.getElementById('gold-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('gf-name').focus(), 50);
}

function closeGoldModal() {
  document.getElementById('gold-modal').classList.add('hidden');
  document.getElementById('gold-form').reset();
  document.getElementById('gf-gifted-for-field').style.display = 'none';
  state.editingGoldId = null;
}

/* ─────────────────────────────────────────────────────────────────
   EVENT LISTENERS  (called once from app.js after DOM is ready)
   ───────────────────────────────────────────────────────────────── */
export function initGoldListeners() {
  /* gold table sort */
  document.querySelector('#tab-gold thead').addEventListener('click', e => {
    const th = e.target.closest('[data-gsort]');
    if (!th) return;
    const col = th.dataset.gsort;
    if (state.goldSortCol === col) {
      state.goldSortDir = state.goldSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.goldSortCol = col;
      state.goldSortDir = 'asc';
    }
    renderGoldTable();
  });

  /* gold table actions */
  document.getElementById('goldTableBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-gaction]');
    if (!btn) return;
    const { gaction, gid } = btn.dataset;
    if (gaction === 'edit') { openGoldModal(gid); return; }
    if (gaction === 'delete') {
      if (!confirm('Delete this gold item? This cannot be undone.')) return;
      try { await deleteGold(gid); toast('Item deleted', 'info'); }
      catch (err) { toast('Delete failed: ' + err.message, 'error'); }
    }
  });

  /* gold table filters */
  ['goldSearchInput', 'goldTypeFilter', 'goldGiftFilter'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderGoldTable);
  });

  /* gold modal open/close */
  document.getElementById('btn-add-gold').addEventListener('click', () => openGoldModal());
  document.getElementById('btn-add-first-gold').addEventListener('click', () => openGoldModal());
  document.getElementById('gold-modal-close').addEventListener('click', closeGoldModal);
  document.getElementById('gold-cancel-btn').addEventListener('click', closeGoldModal);
  document.getElementById('gold-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeGoldModal(); });

  /* auto-calc total invested */
  ['gf-weight', 'gf-paidPerGram'].forEach(fid => {
    document.getElementById(fid).addEventListener('input', () => {
      const w = parseFloat(document.getElementById('gf-weight').value)     || 0;
      const p = parseFloat(document.getElementById('gf-paidPerGram').value) || 0;
      if (w > 0 && p > 0) document.getElementById('gf-totalInvested').value = (w * p).toFixed(2);
    });
  });

  /* gifted toggle */
  document.getElementById('gf-gifted').addEventListener('change', e => {
    document.getElementById('gf-gifted-for-field').style.display = e.target.checked ? 'block' : 'none';
  });

  /* gold form submit */
  document.getElementById('gold-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('gold-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    const data = {
      name:          document.getElementById('gf-name').value.trim(),
      type:          document.getElementById('gf-type').value,
      date:          document.getElementById('gf-date').value,
      weight:        parseFloat(document.getElementById('gf-weight').value)        || 0,
      paidPerGram:   parseFloat(document.getElementById('gf-paidPerGram').value)   || 0,
      totalInvested: parseFloat(document.getElementById('gf-totalInvested').value) || 0,
      gifted:        document.getElementById('gf-gifted').checked,
      giftedFor:     document.getElementById('gf-giftedFor').value.trim(),
    };
    try {
      if (state.editingGoldId) { await updateGold(state.editingGoldId, data); toast('Item updated ✓', 'success'); }
      else                     { await addGold(data);                          toast('Item added ✓',   'success'); }
      closeGoldModal();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = state.editingGoldId ? 'Save Changes' : 'Add Item';
    }
  });

  /* Edit Prices button → switch to edit mode */
  document.getElementById('btn-edit-price').addEventListener('click', () => {
    if (state.isViewMode) { toast('View-only mode — cannot edit prices', 'info'); return; }
    showGoldPriceEditMode(true);
    document.getElementById('price-22k').focus();
  });

  /* Cancel button → revert to view mode */
  document.getElementById('btn-cancel-price').addEventListener('click', () => {
    showGoldPriceView();
  });

  /* Save / Update gold prices */
  document.getElementById('btn-update-price').addEventListener('click', async () => {
    if (state.isViewMode) { toast('View-only mode — cannot edit prices', 'info'); return; }
    const btn = document.getElementById('btn-update-price');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await saveGoldPrices(state.currentUser.uid);
    } catch (err) {
      toast('Failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Prices';
    }
  });
}
