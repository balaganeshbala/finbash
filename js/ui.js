// ── Toast ──────────────────────────────────────────────────────────
let toastTimer;

export function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(toastTimer);
  requestAnimationFrame(() => t.classList.add('show'));
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Screen switcher ────────────────────────────────────────────────
export function showSection(id) {
  ['login-screen', 'app-screen'].forEach(s => {
    // Use '' for app-screen so CSS media query controls the display value (flex on desktop, block on mobile)
    const show = s === id;
    if (s === 'app-screen') {
      document.getElementById(s).style.display = show ? '' : 'none';
    } else {
      document.getElementById(s).style.display = show ? 'block' : 'none';
    }
  });
  if (id === 'login-screen')
    document.getElementById('login-screen').querySelector('.login-screen').style.display = 'flex';
}

// ── Dashboard state (bonds tab) ────────────────────────────────────
export function setDashboardState(state) {
  document.getElementById('loading-state').style.display = state === 'loading' ? 'flex'  : 'none';
  document.getElementById('empty-state').style.display   = state === 'empty'   ? 'block' : 'none';
  document.getElementById('dashboard').style.display     = state === 'data'    ? 'block' : 'none';
}

// ── Dashboard state (gold tab) ─────────────────────────────────────
export function setGoldState(state) {
  document.getElementById('gold-loading').style.display   = state === 'loading' ? 'flex'  : 'none';
  document.getElementById('gold-empty').style.display     = state === 'empty'   ? 'block' : 'none';
  document.getElementById('gold-dashboard').style.display = state === 'data'    ? 'block' : 'none';
}
