// Shared mutable state — import this object in any module that needs to read or write app state.
export const state = {
  // Auth
  currentUser:    null,
  isViewMode:     false,
  viewOwnerUid:   null,
  viewOwnerName:  '',
  currentViewers: [],

  // Bonds
  bonds:          [],
  editingBondId:  null,
  pendingDeleteId:null,
  firestoreUnsub: null,
  chartInst:      {},
  sortCol:        null,
  sortDir:        'asc',

  // Gold
  goldItems:      [],
  editingGoldId:  null,
  goldUnsub:      null,
  goldChartInst:  {},
  goldSortCol:    null,
  goldSortDir:    'asc',
  goldPrices:     { price22k: 0, price24k: 0 },

  // UI
  activeTab:      'bonds',
};
