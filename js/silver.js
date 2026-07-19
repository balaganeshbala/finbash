import {
  collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, serverTimestamp, getDoc, setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { db }                          from './firebase-init.js';
import { state }                       from './state.js';
import { fmt, fmtDate }                from './utils.js';
import { toast, setSilverState }       from './ui.js';

/* ─────────────────────────────────────────────────────────────────
   FIRESTORE REFS & LISTENER
   ───────────────────────────────────────────────────────────────── */
const silverColRef = uid => collection(db, 'users', uid, 'silver');
const silverDocRef = (uid, id) => doc(db, 'users', uid, 'silver', id);

export function startListeningSilver(uid) {
  if (state.silverUnsub) { state.silverUnsub(); state.silverUnsub = null; }
  setSilverState('loading');
  state.silverUnsub = onSnapshot(
    silverColRef(uid),
    snap => {
      state.silverItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      state.silverItems.length === 0
        ? setSilverState('empty')
        : (setSilverState('data'), renderSilverDashboard());
      window.__renderOverview?.();
    },
    () => {
      toast('Could not load silver data. Check Firestore rules.', 'error');
      setSilverState('empty');
    }
  );
}

/* ─────────────────────────────────────────────────────────────────
   CRUD
   ───────────────────────────────────────────────────────────────── */
export async function addSilver(data) {
  await addDoc(silverColRef(state.currentUser.uid), { ...data, createdAt: serverTimestamp() });
}
export async function updateSilver(id, data) {
  await updateDoc(silverDocRef(state.currentUser.uid, id), { ...data, updatedAt: serverTimestamp() });
}
export async function deleteSilver(id) {
  await deleteDoc(silverDocRef(state.currentUser.uid, id));
}

/* ─────────────────────────────────────────────────────────────────
   SILVER PRICES
   ───────────────────────────────────────────────────────────────── */
const SILVER_PROXY = 'https://stock-price-proxy.vercel.app/api/silver-price';

async function fetchAndApplyLiveSilverPrice(uid, { silent = false } = {}) {
  const btn = document.getElementById('btn-fetch-silver-price');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }
  try {
    const res = await fetch(SILVER_PROXY);
    if (!res.ok) throw new Error(`Proxy returned ${res.status}`);
    const { price999 } = await res.json();
    if (!price999) throw new Error('Invalid price received');

    state.silverPrices = { price999 };
    await setDoc(doc(db, 'users', uid, 'settings', 'silverPrice'), {
      price999, updatedAt: serverTimestamp(),
    });
    document.getElementById('silver-p999').value = price999;
    document.getElementById('silver-price-updated').textContent = 'Updated just now';
    showSilverPriceView();
    renderSilverDashboard();
    if (!silent) toast('Live silver price fetched ✓', 'success');
  } catch (err) {
    if (!silent) toast('Could not fetch live price: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Fetch Live Price'; }
  }
}

export async function loadSilverPrices(uid) {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'settings', 'silverPrice'));
    if (snap.exists()) {
      const d = snap.data();
      state.silverPrices = { price999: d.price999 || 0 };
      document.getElementById('silver-p999').value = state.silverPrices.price999 || '';
      if (d.updatedAt) {
        const dt = d.updatedAt.toDate ? d.updatedAt.toDate() : new Date(d.updatedAt);
        document.getElementById('silver-price-updated').textContent =
          'Updated ' + dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const priceDate = dt.toISOString().slice(0, 10);
        const today     = new Date().toISOString().slice(0, 10);
        if (!state.isViewMode && priceDate !== today) {
          fetchAndApplyLiveSilverPrice(uid, { silent: true });
        }
      }
      showSilverPriceView();
    } else if (!state.isViewMode) {
      showSilverPriceEditMode(false);
      fetchAndApplyLiveSilverPrice(uid, { silent: true });
    } else {
      showSilverPriceView();
    }
  } catch {
    if (state.isViewMode) {
      showSilverPriceView();
    } else {
      showSilverPriceEditMode(false);
    }
  }
}

function showSilverPriceView() {
  const p999 = state.silverPrices.price999;
  document.getElementById('silver-p999-display').textContent = p999 ? '₹' + p999.toLocaleString('en-IN') : '—';
  document.getElementById('silver-price-view').style.display = 'grid';
  document.getElementById('silver-price-edit').style.display = 'none';
  const editBtn = document.getElementById('btn-edit-silver-price');
  if (editBtn) editBtn.style.display = state.isViewMode ? 'none' : '';
}

function showSilverPriceEditMode(showCancel = true) {
  document.getElementById('silver-price-view').style.display = 'none';
  document.getElementById('silver-price-edit').style.display = 'grid';
  document.getElementById('btn-cancel-silver-price').style.display = showCancel ? 'block' : 'none';
}

async function saveSilverPrices(uid) {
  const p999 = parseFloat(document.getElementById('silver-p999').value) || 0;
  state.silverPrices = { price999: p999 };
  await setDoc(doc(db, 'users', uid, 'settings', 'silverPrice'), {
    price999: p999, updatedAt: serverTimestamp(),
  });
  document.getElementById('silver-price-updated').textContent = 'Updated just now';
  showSilverPriceView();
  renderSilverDashboard();
  toast('Silver price updated ✓', 'success');
}

function silverCurrentValue(s) {
  const price = state.silverPrices.price999;
  return price > 0 ? (s.weight || 0) * price : 0;
}

/* ─────────────────────────────────────────────────────────────────
   DASHBOARD RENDERING
   ───────────────────────────────────────────────────────────────── */
export function renderSilverDashboard() {
  const owned = state.silverItems.filter(s => !s.gifted);
  const KSVG  = (d, stroke = '#94a3b8') =>
    `<svg viewBox="0 0 24 24" style="width:22px;height:22px;fill:none;stroke:${stroke};stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${d}</svg>`;

  const totalWeight       = owned.reduce((s, i) => s + (i.weight || 0), 0);
  const paidItems         = owned.filter(i => (i.totalInvested || 0) > 0);
  const paidInvested      = paidItems.reduce((s, i) => s + (i.totalInvested || 0), 0);
  const totalCurrentValue = owned.reduce((s, i) => s + silverCurrentValue(i), 0);
  const totalProfit       = totalCurrentValue - paidInvested;
  const profitPct         = paidInvested > 0 ? (totalProfit / paidInvested * 100) : 0;

  document.getElementById('silverKpiGrid').innerHTML = [
    {
      icon:  KSVG('<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 000 4h4a2 2 0 010 4H8"/><line x1="12" y1="6" x2="12" y2="18"/>', 'white'),
      label: 'Total Invested',
      value: fmt(Math.round(paidInvested)),
      sub:   `${state.silverItems.length} items · ${owned.length} owned`,
      cls:   'primary',
    },
    {
      icon:  KSVG('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>', 'white'),
      label: 'Current Value',
      value: totalCurrentValue > 0 ? fmt(Math.round(totalCurrentValue)) : '—',
      sub:   totalCurrentValue > 0
        ? (profitPct >= 0 ? '▲ ' : '▼ ') + Math.abs(profitPct).toFixed(1) + '% gain'
        : 'Set price above',
      cls: 'success',
    },
    {
      icon:  KSVG('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', '#718096'),
      label: 'Total Weight',
      value: totalWeight.toFixed(2) + ' g',
      sub:   `${owned.length} items · 99.9 purity`,
      cls:   '',
    },
    {
      icon:  KSVG('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/>', '#8b5cf6'),
      label: 'Profit / Loss',
      value: totalCurrentValue > 0 ? (totalProfit >= 0 ? '+' : '') + fmt(Math.round(totalProfit)) : '—',
      sub:   'Based on current price',
      cls:   '',
    },
  ].map(k => `<div class="kpi-card ${k.cls}">
    <div class="kpi-label">${k.label}</div>
    <div class="kpi-value">${k.value}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`).join('');

  renderSilverTable();
}

/* ─────────────────────────────────────────────────────────────────
   SILVER TABLE
   ───────────────────────────────────────────────────────────────── */
export function renderSilverTable() {
  const q     = (document.getElementById('silverSearchInput')?.value || '').toLowerCase();
  const giftF = document.getElementById('silverGiftFilter')?.value   || '';

  let filtered = state.silverItems.filter(i => {
    if (q     && !(i.name || '').toLowerCase().includes(q)) return false;
    if (giftF === 'gifted'   && !i.gifted) return false;
    if (giftF === 'received' && (i.gifted || (i.paidPerGram || 0) > 0)) return false;
    if (giftF === 'owned'    && (i.gifted || (i.paidPerGram || 0) === 0)) return false;
    return true;
  });

  if (state.silverSortCol) {
    filtered.sort((a, b) => {
      let va, vb;
      if (state.silverSortCol === 'currentValue') { va = silverCurrentValue(a); vb = silverCurrentValue(b); }
      else if (state.silverSortCol === 'profit')  { va = silverCurrentValue(a) - (a.totalInvested || 0); vb = silverCurrentValue(b) - (b.totalInvested || 0); }
      else { va = a[state.silverSortCol] ?? ''; vb = b[state.silverSortCol] ?? ''; }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return state.silverSortDir === 'asc' ? -1 : 1;
      if (va > vb) return state.silverSortDir === 'asc' ?  1 : -1;
      return 0;
    });
  }

  document.querySelectorAll('[data-ssort]').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.ssort === state.silverSortCol) th.classList.add(state.silverSortDir === 'asc' ? 'sort-asc' : 'sort-desc');
  });

  document.getElementById('silverTableBody').innerHTML = filtered.map((s, i) => {
    const cv      = silverCurrentValue(s);
    const profit  = cv - (s.totalInvested || 0);
    const profCol = profit >= 0 ? '#059669' : '#ef4444';
    const statusBadge = s.gifted
      ? `<span class="badge badge-gift">Gifted${s.giftedFor ? ' · ' + s.giftedFor : ''}</span>`
      : (s.paidPerGram || 0) === 0
        ? `<span class="badge" style="background:#f0fdf4;color:#166534">Received Gift</span>`
        : `<span class="badge badge-active">Owned</span>`;
    return `<tr>
      <td style="color:#94a3b8;font-size:11px">${i + 1}</td>
      <td><div class="bond-name">${s.name || '—'}</div></td>
      <td class="num">${(s.weight || 0).toFixed(2)}g</td>
      <td class="num">${(s.paidPerGram || 0) > 0 ? fmt(s.paidPerGram) : '—'}</td>
      <td class="num">${(s.totalInvested || 0) > 0 ? fmt(s.totalInvested) : '—'}</td>
      <td class="num" style="font-weight:700">${cv > 0 ? fmt(Math.round(cv)) : '—'}</td>
      <td class="num" style="font-weight:700;color:${cv > 0 ? profCol : '#94a3b8'}">${cv > 0 ? (profit >= 0 ? '+' : '') + fmt(Math.round(profit)) : '—'}</td>
      <td style="white-space:nowrap">${s.date ? fmtDate(s.date) : '—'}</td>
      <td>${statusBadge}</td>
      ${!state.isViewMode ? `<td>
        <div class="actions">
          <button class="btn-icon bi-edit" data-saction="edit"   data-sid="${s.id}" title="Edit">
            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon bi-del"  data-saction="delete" data-sid="${s.id}" title="Delete">
            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </td>` : ''}
    </tr>`;
  }).join('');

  const tfoot = document.getElementById('silverTableFoot');
  if (filtered.length) {
    const footWeight   = filtered.reduce((s, i) => s + (i.weight || 0), 0);
    const footInvested = filtered.reduce((s, i) => s + (i.totalInvested || 0), 0);
    const footValue    = filtered.reduce((s, i) => s + silverCurrentValue(i), 0);
    const footProfit   = footValue - footInvested;
    const actionCols   = state.isViewMode ? '' : '<td></td>';
    tfoot.innerHTML = `<tr class="overview-total-row">
      <td></td>
      <td><strong>Total</strong></td>
      <td class="num"><strong>${footWeight.toFixed(2)}g</strong></td>
      <td></td>
      <td class="num"><strong>${footInvested > 0 ? fmt(Math.round(footInvested)) : '—'}</strong></td>
      <td class="num"><strong>${footValue > 0 ? fmt(Math.round(footValue)) : '—'}</strong></td>
      <td class="num" style="color:${footProfit >= 0 ? '#059669' : '#ef4444'}"><strong>${footValue > 0 ? (footProfit >= 0 ? '+' : '') + fmt(Math.round(footProfit)) : '—'}</strong></td>
      <td></td>
      <td></td>${actionCols}
    </tr>`;
  } else {
    tfoot.innerHTML = '';
  }

  document.getElementById('silverTableCount').textContent =
    `Showing ${filtered.length} of ${state.silverItems.length} items`;
}

/* ─────────────────────────────────────────────────────────────────
   SILVER MODAL
   ───────────────────────────────────────────────────────────────── */
export function openSilverModal(silverId = null) {
  state.editingSilverId = silverId;
  const s = silverId ? state.silverItems.find(x => x.id === silverId) : null;
  document.getElementById('silver-modal-title').textContent = s ? 'Edit Silver Item' : 'Add Silver Item';
  document.getElementById('silver-save-btn').textContent    = s ? 'Save Changes'     : 'Add Item';
  document.getElementById('sf-name').value          = s?.name          || '';
  document.getElementById('sf-date').value          = s?.date          || '';
  document.getElementById('sf-weight').value        = s?.weight        || '';
  document.getElementById('sf-paidPerGram').value   = s?.paidPerGram   || '';
  document.getElementById('sf-totalInvested').value = s?.totalInvested || '';
  document.getElementById('sf-gifted').checked      = s?.gifted        || false;
  document.getElementById('sf-giftedFor').value     = s?.giftedFor     || '';
  document.getElementById('sf-gifted-for-field').style.display = s?.gifted ? 'block' : 'none';
  document.getElementById('silver-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('sf-name').focus(), 50);
}

function closeSilverModal() {
  document.getElementById('silver-modal').classList.add('hidden');
  document.getElementById('silver-form').reset();
  document.getElementById('sf-gifted-for-field').style.display = 'none';
  state.editingSilverId = null;
}

/* ─────────────────────────────────────────────────────────────────
   EVENT LISTENERS  (called once from app.js after DOM is ready)
   ───────────────────────────────────────────────────────────────── */
export function initSilverListeners() {
  /* silver table sort */
  document.querySelector('#tab-silver thead').addEventListener('click', e => {
    const th = e.target.closest('[data-ssort]');
    if (!th) return;
    const col = th.dataset.ssort;
    if (state.silverSortCol === col) {
      state.silverSortDir = state.silverSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.silverSortCol = col;
      state.silverSortDir = 'asc';
    }
    renderSilverTable();
  });

  /* silver table actions */
  document.getElementById('silverTableBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-saction]');
    if (!btn) return;
    const { saction, sid } = btn.dataset;
    if (saction === 'edit') { openSilverModal(sid); return; }
    if (saction === 'delete') {
      if (!confirm('Delete this silver item? This cannot be undone.')) return;
      try { await deleteSilver(sid); toast('Item deleted', 'info'); }
      catch (err) { toast('Delete failed: ' + err.message, 'error'); }
    }
  });

  /* silver table filters */
  ['silverSearchInput', 'silverGiftFilter'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderSilverTable);
  });

  /* silver modal open/close */
  document.getElementById('btn-add-silver').addEventListener('click', () => openSilverModal());
  document.getElementById('btn-add-first-silver').addEventListener('click', () => openSilverModal());
  document.getElementById('silver-modal-close').addEventListener('click', closeSilverModal);
  document.getElementById('silver-cancel-btn').addEventListener('click', closeSilverModal);
  document.getElementById('silver-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSilverModal(); });

  /* auto-calc total invested */
  ['sf-weight', 'sf-paidPerGram'].forEach(fid => {
    document.getElementById(fid).addEventListener('input', () => {
      const w = parseFloat(document.getElementById('sf-weight').value)     || 0;
      const p = parseFloat(document.getElementById('sf-paidPerGram').value) || 0;
      if (w > 0 && p > 0) document.getElementById('sf-totalInvested').value = (w * p).toFixed(2);
    });
  });

  /* gifted toggle */
  document.getElementById('sf-gifted').addEventListener('change', e => {
    document.getElementById('sf-gifted-for-field').style.display = e.target.checked ? 'block' : 'none';
  });

  /* silver form submit */
  document.getElementById('silver-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('silver-save-btn');
    btn.disabled = true; btn.textContent = 'Saving…';
    const data = {
      name:          document.getElementById('sf-name').value.trim(),
      date:          document.getElementById('sf-date').value,
      weight:        parseFloat(document.getElementById('sf-weight').value)        || 0,
      paidPerGram:   parseFloat(document.getElementById('sf-paidPerGram').value)   || 0,
      totalInvested: parseFloat(document.getElementById('sf-totalInvested').value) || 0,
      gifted:        document.getElementById('sf-gifted').checked,
      giftedFor:     document.getElementById('sf-giftedFor').value.trim(),
    };
    try {
      if (state.editingSilverId) { await updateSilver(state.editingSilverId, data); toast('Item updated ✓', 'success'); }
      else                       { await addSilver(data);                           toast('Item added ✓',   'success'); }
      closeSilverModal();
    } catch (err) {
      toast('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = state.editingSilverId ? 'Save Changes' : 'Add Item';
    }
  });

  /* Fetch Live Price button */
  document.getElementById('btn-fetch-silver-price').addEventListener('click', () => {
    if (state.isViewMode) return;
    fetchAndApplyLiveSilverPrice(state.currentUser.uid);
  });

  /* Edit Prices button */
  document.getElementById('btn-edit-silver-price').addEventListener('click', () => {
    if (state.isViewMode) { toast('View-only mode — cannot edit prices', 'info'); return; }
    showSilverPriceEditMode(true);
    document.getElementById('silver-p999').focus();
  });

  /* Cancel button */
  document.getElementById('btn-cancel-silver-price').addEventListener('click', () => {
    showSilverPriceView();
  });

  /* Save silver price */
  document.getElementById('btn-update-silver-price').addEventListener('click', async () => {
    if (state.isViewMode) { toast('View-only mode — cannot edit prices', 'info'); return; }
    const btn = document.getElementById('btn-update-silver-price');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await saveSilverPrices(state.currentUser.uid);
    } catch (err) {
      toast('Failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'Save Price';
    }
  });
}
