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

  // FD & RD
  fds:            [],
  rds:            [],
  editingFDId:    null,
  editingRDId:    null,
  fdUnsub:        null,
  rdUnsub:        null,
  fdSortCol:      null,
  fdSortDir:      'asc',
  rdSortCol:      null,
  rdSortDir:      'asc',

  // Mutual Funds
  mfs:            [],
  editingMFId:    null,
  mfUnsub:        null,
  mfNavs:         {},   // schemeCode → { nav, date, prevNav }
  mfNavLoading:   false,
  mfSortCol:      null,
  mfSortDir:      'asc',

  // Stocks
  stocks:            [],
  editingStockId:    null,
  stockUnsub:        null,
  stockPrices:       {},   // tickerSym → { price, prevClose, name }
  stockPriceLoading: false,
  stockSortCol:      null,
  stockSortDir:      'asc',
  stockViewMode:     'holding',  // 'holding' | 'stock'
  usdInrRate:        null,       // live USD→INR rate for US stock conversion

  // NPS
  nps:            [],
  editingNPSId:   null,
  npsUnsub:       null,
  npsNavs:        {},   // "${fundManager}|${tier}|${assetClass}" → { nav, date }
  npsNavLoading:  false,

  // EPF
  epf:            [],
  editingEPFId:   null,
  epfUnsub:       null,

  // UI
  activeTab:      'overview',
};
