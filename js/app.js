import {
  signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDoc, doc }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import { auth, db, isConfigured }     from './firebase-init.js';
import { state }                       from './state.js';
import { toast, showSection }          from './ui.js';
import {
  startListening, loadPartners,
  initBondListeners, renderDashboard,
} from './bonds.js';
import {
  startListeningGold, loadGoldPrices,
  renderGoldDashboard, initGoldListeners,
} from './gold.js';
import {
  startListeningFD, startListeningRD, initFDListeners,
} from './fd.js';
import {
  startListeningMF, initMFListeners, fetchAllNavs,
} from './mf.js';
import {
  startListeningStocks, initStockListeners, fetchAllPrices,
} from './stocks.js';
import {
  startListeningNPS, initNPSListeners,
} from './nps.js';
import { renderOverview, renderOverviewChart } from './overview.js';

/* ─────────────────────────────────────────────────────────────────
   BOOT
   ───────────────────────────────────────────────────────────────── */
if (!isConfigured) {
  showSection('login-screen');
} else {

  /* ── LOGIN / LOGOUT ── */
  document.getElementById('btn-google-login').addEventListener('click', async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (e) { toast('Sign-in failed: ' + (e.code || e.message), 'error'); }
  });

  const doSignOut = async () => {
    if (state.firestoreUnsub) { state.firestoreUnsub(); state.firestoreUnsub = null; }
    if (state.goldUnsub)      { state.goldUnsub();      state.goldUnsub      = null; }
    if (state.fdUnsub)        { state.fdUnsub();        state.fdUnsub        = null; }
    if (state.rdUnsub)        { state.rdUnsub();        state.rdUnsub        = null; }
    if (state.mfUnsub)        { state.mfUnsub();        state.mfUnsub        = null; }
    if (state.stockUnsub)     { state.stockUnsub();     state.stockUnsub     = null; }
    if (state.npsUnsub)       { state.npsUnsub();       state.npsUnsub       = null; }
    state.bonds = []; state.goldItems = []; state.fds = []; state.rds = [];
    state.mfs = []; state.mfNavs = {}; state.stocks = []; state.stockPrices = {};
    state.nps = [];
    state.isViewMode = false; state.viewOwnerUid = null; state.currentViewers = [];
    await signOut(auth);
  };

  document.getElementById('btn-logout').addEventListener('click', doSignOut);

  /* ── TAB SWITCHING ── */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + state.activeTab).classList.add('active');
      // Re-render overview after the tab is visible so Chart.js measures correct dimensions
      // (same pattern as Gold — canvas is permanent in the HTML, chart redraws on tab switch)
      if (state.activeTab === 'overview') {
        renderOverview();
        requestAnimationFrame(() => renderOverviewChart());
      }
      // Re-render bonds charts after the tab is visible so Chart.js
      // measures the correct dimensions and animates from the right origin
      if (state.activeTab === 'bonds' && state.bonds.length > 0) {
        requestAnimationFrame(() => renderDashboard());
      }
      // Re-render gold charts after the tab is visible so Chart.js
      // measures the correct dimensions and animates from the right origin
      if (state.activeTab === 'gold' && state.goldItems.length > 0) {
        requestAnimationFrame(() => renderGoldDashboard());
      }
      // Refresh MF NAVs when switching to MF tab (at most once every 5 minutes)
      if (state.activeTab === 'mf' && state.mfs.length > 0) {
        const FIVE_MINUTES = 5 * 60 * 1000;
        if (!state.lastMFNavFetch || Date.now() - state.lastMFNavFetch > FIVE_MINUTES) {
          fetchAllNavs();
        }
      }
      // Refresh stock prices when switching to stocks tab (at most once every 5 minutes)
      if (state.activeTab === 'stocks' && state.stocks.length > 0) {
        const FIVE_MINUTES = 5 * 60 * 1000;
        if (!state.lastStockPriceFetch || Date.now() - state.lastStockPriceFetch > FIVE_MINUTES) {
          fetchAllPrices();
        }
      }
    });
  });

  /* ── HAMBURGER / MOBILE MENU ── */
  const mobileMenu = document.getElementById('mobile-menu');
  document.getElementById('btn-hamburger').addEventListener('click', e => {
    e.stopPropagation();
    mobileMenu.classList.toggle('open');
  });
  document.addEventListener('click', e => {
    if (!mobileMenu.contains(e.target) && e.target.id !== 'btn-hamburger')
      mobileMenu.classList.remove('open');
  });
  const closeMob = () => mobileMenu.classList.remove('open');

  document.getElementById('mob-btn-partners').addEventListener('click', () => {
    closeMob();
    document.getElementById('partners-modal').classList.remove('hidden');
  });
  document.getElementById('mob-btn-logout').addEventListener('click', async () => {
    closeMob();
    await doSignOut();
  });

  /* ── WIRE ALL MODULE LISTENERS ── */
  initBondListeners();
  initGoldListeners();
  initFDListeners();
  initMFListeners();
  initStockListeners();
  initNPSListeners();

  /* ── AUTH STATE ── */
  onAuthStateChanged(auth, async user => {
    state.currentUser = user;
    // Hide the initial full-page loader once Firebase has resolved auth
    document.getElementById('initial-loader').classList.add('hidden');

    if (user) {
      document.getElementById('app-screen').style.display  = 'block';
      document.getElementById('login-screen').style.display = 'none';

      /* Desktop user info */
      const av = document.getElementById('user-avatar');
      if (user.photoURL) { av.src = user.photoURL; av.style.display = 'block'; }
      else { av.style.display = 'none'; }
      document.getElementById('user-name').textContent = user.displayName || user.email;

      /* Mobile user info */
      ['user-avatar-mob', 'mob-avatar'].forEach(id => {
        const el = document.getElementById(id);
        if (user.photoURL) { el.src = user.photoURL; el.style.display = 'block'; }
        else { el.style.display = 'none'; }
      });
      document.getElementById('mob-user-name').textContent  = user.displayName || '';
      document.getElementById('mob-user-email').textContent = user.email;
      document.getElementById('header-sub').textContent =
        new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

      /* Check if this user is a viewer of someone else's portfolio */
      try {
        const viewerSnap = await getDoc(doc(db, 'viewerOf', user.email));
        if (viewerSnap.exists()) {
          state.isViewMode    = true;
          state.viewOwnerUid  = viewerSnap.data().ownerUid;
          state.viewOwnerName = viewerSnap.data().ownerName || 'Owner';
          document.getElementById('view-banner').style.display = 'flex';
          document.getElementById('view-owner-name').textContent = state.viewOwnerName + "'s";

          /* Hide write controls */
          ['btn-partners', 'mob-btn-partners', 'btn-add-gold', 'btn-add-bond'].forEach(id => {
            document.getElementById(id).style.display = 'none';
          });
          document.getElementById('th-actions').style.display  = 'none';
          document.getElementById('gth-actions').style.display = 'none';

          startListening(state.viewOwnerUid);
          startListeningGold(state.viewOwnerUid);
          loadGoldPrices(state.viewOwnerUid);
          startListeningFD(state.viewOwnerUid);
          startListeningRD(state.viewOwnerUid);
          startListeningMF(state.viewOwnerUid);
          startListeningStocks(state.viewOwnerUid);
          startListeningNPS(state.viewOwnerUid);
        } else {
          state.isViewMode = false; state.viewOwnerUid = null;
          document.getElementById('view-banner').style.display = 'none';

          /* Restore write controls */
          ['btn-partners', 'mob-btn-partners', 'btn-add-gold', 'btn-add-bond'].forEach(id => {
            document.getElementById(id).style.display = '';
          });
          document.getElementById('th-actions').style.display  = '';
          document.getElementById('gth-actions').style.display = '';

          startListening(user.uid);
          startListeningGold(user.uid);
          loadGoldPrices(user.uid);
          startListeningFD(user.uid);
          startListeningRD(user.uid);
          startListeningMF(user.uid);
          startListeningStocks(user.uid);
          startListeningNPS(user.uid);
          loadPartners(user.uid);
        }
      } catch {
        state.isViewMode = false;
        startListening(user.uid);
        startListeningGold(user.uid);
        loadGoldPrices(user.uid);
        startListeningFD(user.uid);
        startListeningRD(user.uid);
        startListeningMF(user.uid);
        startListeningStocks(user.uid);
        startListeningNPS(user.uid);
        loadPartners(user.uid);
      }
    } else {
      if (state.firestoreUnsub) { state.firestoreUnsub(); state.firestoreUnsub = null; }
      if (state.goldUnsub)      { state.goldUnsub();      state.goldUnsub      = null; }
      if (state.fdUnsub)        { state.fdUnsub();        state.fdUnsub        = null; }
      if (state.rdUnsub)        { state.rdUnsub();        state.rdUnsub        = null; }
      if (state.mfUnsub)        { state.mfUnsub();        state.mfUnsub        = null; }
      if (state.stockUnsub)     { state.stockUnsub();     state.stockUnsub     = null; }
      if (state.npsUnsub)       { state.npsUnsub();       state.npsUnsub       = null; }
      state.bonds = []; state.goldItems = []; state.fds = []; state.rds = [];
      state.mfs = []; state.mfNavs = {}; state.stocks = []; state.stockPrices = {};
      state.nps = [];
      state.isViewMode = false;
      showSection('login-screen');
    }
  });

} /* end if (isConfigured) */
