import {
  collection, doc, setDoc, getDocs, query, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-init.js';

/* ─────────────────────────────────────────────────────────────────
   PORTFOLIO SNAPSHOT — save once per day, fetch for charting
   Each document is keyed by "YYYY-MM-DD" for natural deduplication.
   ───────────────────────────────────────────────────────────────── */

const snapColRef = uid => collection(db, 'users', uid, 'portfolioSnapshots');

// Track whether we've already saved today — one write per day, no retries
let _savedDateThisSession = null;

/**
 * Save today's portfolio snapshot to Firestore.
 * - Skips silently if already saved today in this session.
 * - Skips if portfolio has no value yet (prices still loading).
 * - Uses setDoc so a re-run overwrites stale same-day data.
 * Returns true if a write actually happened.
 */
export async function saveSnapshotIfNeeded(uid, totalValue, totalInvested, breakdown) {
  const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
  if (!uid || totalValue <= 0) return false;
  if (_savedDateThisSession === today) return false;  // already saved today

  try {
    await setDoc(
      doc(db, 'users', uid, 'portfolioSnapshots', today),
      { date: today, totalValue: Math.round(totalValue), totalInvested: Math.round(totalInvested), breakdown },
    );
    _savedDateThisSession = today;
    console.info('[snapshots] Snapshot saved for', today, '— value:', Math.round(totalValue));
    return true;
  } catch (e) {
    console.warn('[snapshots] Save failed:', e);
    return false;
  }
}

/**
 * Fetch portfolio snapshots from Firestore, sorted oldest → newest.
 * Sorting is done in JS to avoid needing a Firestore composite index.
 * @param {string}      uid
 * @param {string|null} sinceDate  ISO date "YYYY-MM-DD", or null for all time
 */
export async function fetchSnapshots(uid, sinceDate = null) {
  if (!uid) return [];
  try {
    const col = snapColRef(uid);
    const q   = sinceDate
      ? query(col, where('date', '>=', sinceDate))
      : query(col);
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => d.data());
    // Sort oldest → newest in JS (avoids composite-index requirement on Firestore)
    docs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return docs;
  } catch (e) {
    console.warn('[snapshots] Fetch failed:', e);
    return [];
  }
}
