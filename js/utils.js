export const TODAY = (() => { const d = new Date(); d.setHours(0,0,0,0); return d; })();
export const MS_DAY = 86400000;

export const fmt      = n => '₹' + Number(n).toLocaleString('en-IN');
export const fmtDate  = s => new Date(s).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
export const groupSum = (arr, key, val) =>
  arr.reduce((acc, b) => { acc[b[key]] = (acc[b[key]] || 0) + (b[val] || 0); return acc; }, {});

export const PLATFORM_BADGE = {
  'Stable Money': 'badge-sm',
  'Aionion':      'badge-ai',
  'GoldenPi':     'badge-gp',
  'WintWealth':   'badge-ww',
};

export const PLATFORM_COLORS = {
  'Stable Money': '#3b82f6',
  'Aionion':      '#06b6d4',
  'GoldenPi':     '#10b981',
  'WintWealth':   '#f59e0b',
};

/**
 * Returns a consistent empty-state <tr> for use inside any <tbody>.
 * @param {string} title   — primary message, e.g. "No stocks added yet"
 * @param {string} sub     — secondary hint, e.g. "Click "+ Add Stock" to get started"
 * @param {number} colspan — number of columns the cell should span
 */
export function emptyRow(title, sub = '', colspan = 10) {
  return `<tr><td colspan="${colspan}" style="padding:0;border:none">
    <div class="empty-state">
      <div class="empty-state-title">${title}</div>
      ${sub ? `<div class="empty-state-sub">${sub}</div>` : ''}
    </div>
  </td></tr>`;
}
