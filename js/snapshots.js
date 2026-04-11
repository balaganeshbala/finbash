import {
  collection, doc, setDoc, getDocs, query, where, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-init.js';

/* ─────────────────────────────────────────────────────────────────
   PORTFOLIO SNAPSHOT — save once per day, fetch for charting
   Each document is keyed by "YYYY-MM-DD" for natural deduplication.
   ───────────────────────────────────────────────────────────────── */

const snapColRef = uid => collection(db, 'users', uid, 'portfolioSnapshots');

// Track whether we've already saved today in this browser session
let _savedDateThisSession = null;

/**
 * Save today's portfolio snapshot to Firestore.
 * - Skips silently if already saved today in this session.
 * - Skips if portfolio has no value yet (prices still loading).
 * - Uses setDoc so re-running overwrites stale same-day data.
 */
export async function saveSnapshotIfNeeded(uid, totalValue, totalInvested, breakdown) {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  if (_savedDateThisSession === today) return;
  if (!uid || totalValue <= 0) return;

  try {
    await setDoc(
      doc(db, 'users', uid, 'portfolioSnapshots', today),
      { date: today, totalValue: Math.round(totalValue), totalInvested: Math.round(totalInvested), breakdown },
    );
    _savedDateThisSession = today;
  } catch (e) {
    // Snapshots are best-effort — never block the UI
    console.warn('[snapshots] Save failed:', e);
  }
}

/**
 * Fetch portfolio snapshots from Firestore, sorted oldest → newest.
 * @param {string}      uid
 * @param {string|null} sinceDate  ISO date "YYYY-MM-DD", or null for all time
 */
export async function fetchSnapshots(uid, sinceDate = null) {
  if (!uid) return [];
  try {
    const constraints = [orderBy('date', 'asc')];
    if (sinceDate) constraints.unshift(where('date', '>=', sinceDate));
    const snap = await getDocs(query(snapColRef(uid), ...constraints));
    return snap.docs.map(d => d.data());
  } catch (e) {
    console.warn('[snapshots] Fetch failed:', e);
    return [];
  }
}
