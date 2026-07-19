# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

## Project: Finbash — Personal Finance Dashboard

A vanilla JS SPA (no build step, no framework) for tracking a personal investment portfolio. Runs entirely in the browser; Firebase handles auth and data; a Vercel proxy handles live price fetching.

### Tech Stack

- **Frontend:** Vanilla JS ES modules, HTML, CSS — no bundler, no framework
- **Auth & DB:** Firebase v10 (CDN imports from `gstatic.com`), Firestore with `persistentLocalCache`
- **Live prices:** Vercel serverless functions (TypeScript) in `stock-price-proxy/api/` — scrape goodreturns.in
- **Hosting:** Static files served as-is (no build); proxy deployed separately to Vercel

### File Map

| File | Purpose |
|---|---|
| `index.html` | Single page — all tab panels, modals, and price bars live here |
| `css/main.css` | All styles — one file, no preprocessor |
| `js/app.js` | Boot, auth flow, tab switching, view-mode setup |
| `js/state.js` | Single shared mutable object — import `state` everywhere |
| `js/firebase-init.js` | Firebase app/auth/db init; exports `{ app, auth, db, isConfigured }` |
| `js/ui.js` | Shared UI helpers: `toast()`, `showSection()`, `setGoldState()`, `setSilverState()` |
| `js/utils.js` | `fmt()` (₹ formatter), `fmtDate()`, `KSVG()` (KPI icon SVG helper) |
| `js/overview.js` | Overview tab — aggregates all asset modules into KPIs + pie chart |
| `js/bonds.js` | Bonds tab — CRUD, Firestore listener, dashboard render |
| `js/gold.js` | Gold tab — CRUD, price load/save, dashboard render |
| `js/silver.js` | Silver tab — CRUD, price load/save, dashboard render |
| `js/fd.js` | Fixed Deposit & Recurring Deposit tabs |
| `js/mf.js` | Mutual Funds tab — NAV fetching via proxy |
| `js/stocks.js` | Stocks tab — price fetching via proxy |
| `js/nps.js` | NPS tab |
| `js/epf.js` | EPF tab |
| `js/snapshots.js` | Portfolio snapshot logic (partner sharing) |
| `stock-price-proxy/api/gold-price.ts` | Vercel function — scrapes gold price from goodreturns.in |
| `stock-price-proxy/api/silver-price.ts` | Vercel function — scrapes silver price (999 purity only, ₹/gram) |
| `stock-price-proxy/api/stock-price.ts` | Vercel function — NSE stock prices |
| `stock-price-proxy/api/mf-nav.ts` | Vercel function — MF NAV |
| `stock-price-proxy/api/nps-nav.ts` | Vercel function — NPS NAV |

### Tabs (in order)

`overview` · `bonds` · `gold` · `silver` · `fd` · `mf` · `stocks` · `nps` · `epf`

### Firestore Data Model

All data is scoped under `users/{uid}/`:

| Collection / Doc | Contents |
|---|---|
| `users/{uid}/bonds` | Bond items |
| `users/{uid}/gold` | Gold items (fields: name, date, karat, weight, paidPerGram, totalInvested, gifted, giftedFor) |
| `users/{uid}/silver` | Silver items (fields: name, date, weight, paidPerGram, totalInvested, gifted, giftedFor) — 99.9% purity only |
| `users/{uid}/fds` | Fixed deposits |
| `users/{uid}/rds` | Recurring deposits |
| `users/{uid}/mf` | Mutual fund holdings |
| `users/{uid}/stocks` | Stock holdings |
| `users/{uid}/nps` | NPS holdings |
| `users/{uid}/epf` | EPF record |
| `users/{uid}/settings/goldPrice` | `{ price22k, price24k }` |
| `users/{uid}/settings/silverPrice` | `{ price999 }` |
| `users/{uid}/viewers/{viewerUid}` | Partner/viewer access — `{ ownerUid, ownerName }` |

### Proxy URLs

```
https://stock-price-proxy.vercel.app/api/gold-price
https://stock-price-proxy.vercel.app/api/silver-price
https://stock-price-proxy.vercel.app/api/stock-price?symbol=RELIANCE
https://stock-price-proxy.vercel.app/api/mf-nav?code=123456
https://stock-price-proxy.vercel.app/api/nps-nav?scheme=...
```

Proxy changes require a separate `vercel deploy` inside `stock-price-proxy/`.

### Architecture Patterns

**State** — one object in `js/state.js`, mutated directly. No reactive framework. Example:
```js
state.goldItems = snap.docs.map(d => ({ id: d.id, ...d.data() }));
```

**Per-asset module pattern** — every asset module exports:
- `startListening{Asset}(uid)` — attaches Firestore `onSnapshot`, populates `state`
- `load{Asset}Prices(uid)` — reads price settings doc, updates `state.*Prices`
- `render{Asset}Dashboard()` — reads `state`, writes to DOM
- `init{Asset}Listeners()` — wires up button/form event listeners

**View mode (partner access)** — `state.isViewMode = true` when viewing another user's portfolio. Write controls (`btn-add-*`, action columns `sth-actions`, `gth-actions`) are hidden. All `startListening*` calls use `state.viewOwnerUid` instead of the logged-in user's uid.

**KPI cards** — rendered via JS into `#{asset}KpiGrid` using `KSVG()` + template literal. Class `kpi-card primary/success/danger` controls the left-border accent color.

**Price bars** — each asset tab has a `#*-price-view` / `#*-price-edit` toggle. View shows fetched price + timestamp; edit has inputs + "Fetch Live Price" button that calls the proxy.

**Tab switching** — handled in `app.js`; on switch, if `state.activeTab === '{asset}'` and items exist, calls `requestAnimationFrame(() => render{Asset}Dashboard())`.

### CSS Conventions

- KPI grid default: `repeat(6, 1fr)`. Override per asset with `#{asset}KpiGrid { grid-template-columns: repeat(4, 1fr); }` — Gold and Silver both use 4 columns.
- `.gold-price-updated` class is reused for the silver price timestamp too (same 11px style).
- `#silver-price-view div span` (not bare `span`) targets the price value — avoids overriding the `.gold-price-updated` sibling span.
- Responsive breakpoints: 1100px → 2-col KPI for fixed-4-col grids; 900px → 2-col KPI general; 768px → 1-col KPI with `!important`.

### Silver-specific Notes

- Only 99.9% (999) purity — no 925 or 800 options anywhere.
- `silverCurrentValue(item)` always uses `state.silverPrices.price999 * item.weight`.
- Silver proxy parses goodreturns.in HTML — must `stripTags()` before regex to avoid class-name digit interference. Valid per-gram range: ₹50–₹500.
