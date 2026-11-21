# Finance Page Hardening Plan

Scope: `src/components/FinancialReconciliationCenter.jsx`, `src/components/admin/finances/FinancialStatementTabs.jsx`, `api/src/routes/finances.js`, `api/src/services/financesReportService.js`.

Status: Phases 1-4 DONE (see Phase 4 outcome below).

Phase 4 outcome: month close (migration 053 `period_closures`; GET /finances/periods, POST /periods/:month/close and /reopen, both need the Net Income PIN; `assertPeriodOpen` blocks any posting or utility-bill void dated in a closed month; reversals post in the open month); 'Close the Month' dialog; journal search by note/reference/number, type filter, and PIN-protected amount range; CSV download for every tab (formula-safe, locked figures blank); tab keyboard navigation and tabpanel; cash drawer over/short tier label (OK / Take a look / Check today, thresholds in financeLabels.js); FinDialog, formatting helpers, CSV/export code and the month-close panel moved out of the 1,900-line page file. Prime cost vs 60% goal was already on the Profit Report. Follow-up (done): drawer limits stored in business_settings (migration 054, GET/PUT /finances/drawer-thresholds, PIN to change); drawer history by cashier and weekday with repeat-problem flag (GET /finances/reports/drawer-history, shared/drawerThresholds.js); Profit Report, Daily Check and Cancel dialog split into their own files. The money pop-ups (expense, pay bill/tax, wear & tear, income tax, owner withdrawal, owner money added, transfers) now live in `FinanceActionDialog.jsx`, opened with `ref.current.open(mode)`; the Cancel dialog has its own submit/error state. The page file went from about 1,950 to about 840 lines. Checked in a browser against the test database: recording an expense, the Unpaid Bills button, cancelling a transaction, journal wording and PIN masking, Close the Month list, Profit Report and drawer history all worked with no console errors. Tests: financePhase4Period, financePhase4Export.

Phase 3 outcome: all Finance wording moved to `src/config/financeLabels.js` (plain label + accounting term as tooltip); account numbers hidden unless 'Show account numbers' is ticked; journal reads 'Goes to / Comes from', friendly entry types, one Cancelled badge, Reverse -> Cancel; Balance Sheet and Cash Flow renamed; modal text rewritten; emoji locks replaced by the Lock icon; 'run reconciliation backfill' message replaced.

Phase 2 outcome: expense date field (past days only, server-validated, budget check uses that month); budget check is advice only and uses an inline confirm instead of window.confirm; tabs keep old figures while refreshing; Try Again button; one account/bill loader; liquid accounts read from the chart; depreciation estimator uses net book value; Balance Sheet 'As of' date (server `asOf`, past days skip the live stock check, settle buttons hidden); income-tax modal explains when profit is hidden; page numbers clamp; drawer variance shows over/short in words; double '+' removed. Tests: tests/financePhase2Logic.test.js.

Phase 1 outcome (after reading the server code):
- Already correct, no change needed: single-reversal rule, blocking reversal of payroll/order/inventory/utility entries, balanced-entry check, idempotent `clientRequestId` on `/journal-entries` and `/payables/:id/settle`.
- Fixed: journal list now honours the Net Income PIN (entries touching COGS, depreciation, tax, equity or payroll accounts hide all amounts; manual expenses stay visible because the expense pages need them).
- Fixed: shared `assertLiquidFunds` guard now also covers account transfers and reversals of incoming money (withdrawals already had it).
- Decision: paid expenses, income tax and bill settlements are NOT blocked when an account looks short (a shop may record spending before it records deposits). They post and return `warnings`, shown in the page notice.
- Fixed: reversal reason (min 3 chars) enforced on the server.
- Tests: `tests/financePhase1Hardening.test.js` (new); two old fixtures in `tests/incomeStatementPhase2.test.js` now fund the account before transferring.

## Research basis (community / industry practice)

| # | Idea | Source |
|---|---|---|
| R1 | Journals are append-only; corrections are linked reversal entries (`reversal_of`, reason, actor), then a corrected entry | [Trio](https://trio.dev/payment-ledger-architecture-fintech/), [Griffin](https://griffin.com/blog/the-immutable-bank), [Faysal Ahmed](https://faysalahmed.space/blog/double-entry-accounting-db-model-2026.md/) |
| R2 | Enforce debits = credits and atomic commit in the database, not only app code; use idempotency keys | [Matthews Wong](https://www.matthewswong.com/en/blog/erp-general-ledger-double-entry-design/), [Finlego](https://finlego.com/blog/designing-a-real-time-ledger-system-with-double-entry-logic) |
| R3 | Period close: closed periods reject new postings; corrections go into an open period so old reports stay reproducible | [ScaleDojo](https://scaledojo.dev/blogs/double-entry-ledger-design-the-500-year-old-system-that-powers-banking), [Matthews Wong](https://www.matthewswong.com/en/blog/erp-general-ledger-double-entry-design/) |
| R4 | Prime cost = (COGS + total labor) / sales; QSR about 55-60%, food 28-35%, labor 25-35%; track labor daily, prime cost weekly | [7shifts](https://www.7shifts.com/blog/restaurant-prime-cost-guide/), [StockCount](https://stockcount.io/blog/restaurant-prime-cost), [Smart Restaurant Owner](https://smartrestaurantowner.com/blog/restaurant-prime-cost-guide) |
| R5 | Plain-language UX: hide chart-of-accounts codes, verb-labelled actions, business meaning before accounting term, hover definitions, layer advanced detail behind a fold | [Deelo](https://www.deelo.ai/blog/best-accounting-software-non-accountants-2026), [Dashboard Critic](https://dashboardcritic.substack.com/p/the-importance-of-plain-language), [GitHub PR example](https://github.com/quadriabiodun9911-rgb/sme-financial-mobile-app/pull/93) |
| R6 | Cash drawer: reconcile per shift and per cashier; expected = float + cash sales - drops - refunds - paid-outs; tiered variance thresholds (about 1-5 review, higher = investigate before closing); track patterns by cashier/day; never deduct shortages from pay | [AnywherePOS](https://www.anywherepos.com/cash-register-shortage-end-of-day/cash-over-and-short-accounting/), [Selfemployed](https://www.selfemployed.com/cash-drawer-management-guide/), [DOHAssist](https://www.dohassist.com/assist-guides-daily-cash-reconciliation-guide), [Tabres](https://tabres.com/articles/how-to-keep-your-restaurant-cash-drawer-from-coming-up-short) |

Caveat: sources are mostly vendor blogs and dev guides, not accounting standards. Thresholds are in USD; scale to PHP and make them configurable.

## Phase 1: Integrity and security (do first)

1. PIN-gate the journal tab (verify `GET /finances/journal-entries`, `finances.js:812`). Send `financialHeaders` from the client; server masks COGS, capital, drawing and tax amounts while locked. (Own audit; R1)
2. Server-enforced single reversal: reject reversing an entry that already has `reversed_by` or is itself a reversal; do not rely on the client's current-page scan (verify `finances.js:1714`). Return `isAlreadyReversed` always. (R1)
3. Block reversing system-owned entries (payroll runs, payable settlements, shift close) from this screen, or route them to their own undo flow.
4. Confirm DB-level balanced-entry check and single transaction for header + lines (verify). Add a constraint or trigger if absent. (R2)
5. Source-balance guard for transfers, drawings and paid expenses: warn or block when a liquid account would go negative; allow admin override with reason.
6. Idempotency: confirm server returns the original entry on duplicate `clientRequestId` for `/journal-entries` (exists for expense-records; verify here). (R2)

Done when: tests cover each rejection, and a locked-PIN request to the journal returns masked amounts.

## Phase 2: Logic fixes

1. Opex budget check uses the entry's own month. Add an optional "Date of expense" field (default today, Manila). Budget check failure becomes a warning, not a blocker.
2. Replace `window.confirm` with the existing `FinDialog` confirm.
3. Keep stale data visible while refetching (no unmount on `loading`); show a subtle "Refreshing" indicator. Fixes flicker on every `amaya:stock-mutated`.
4. Balance Sheet gets an "As of" date picker, sent as `to`/`asOf`; label states the date.
5. Income Tax modal: fetch P&L for the selected range on open, show "Locked, enter PIN" instead of silently disabling chips.
6. Depreciation estimator defaults to net book value, not gross; cap suggested amount at remaining NBV.
7. Load liquid accounts from `/finances/accounts` (flag `isLiquid`) instead of the hard-coded list; drop 1040 as a pay-from option unless intended.
8. Remove duplicate mount fetch vs `loadMeta`; add retry button to error banners.
9. Fix numeric-type compares for variance/delta colours; add +/- sign or icon so colour is not the only cue.
10. Reset page numbers on tab change; clamp page to max after total changes.
11. Remove double "+" in button labels.

## Phase 3: Plain-language pass (R5)

1. Create `src/config/financeLabels.js`: one dictionary for tab names, column headers, entry types, modal titles, button text. Each entry has `label`, optional `term` (accounting name) and `help` (tooltip).
2. Hide account codes by default; "Show account codes" toggle for admin/accountant view.
3. Journal lines: "Money Out / Money In" instead of DR/CR; entry type labels from the dictionary; single status badge (Cancelled / Correction).
4. Rename per the earlier table (Money & Books, Daily Cash & Stock Check, Value at Opening/Closing, Change in Value Today, Total Sales, Cost of Ingredients Sold, Profit, Cash Drawer Over/Short, Profit Report, Money In & Out, What We Own & Owe, Transaction History, Equipment Wear & Tear, Add Owner's Money, Owner Withdrawal). Keep the accounting term as a tooltip or subtitle so the defense panel still sees the real terms.
5. Replace "run reconciliation backfill" message with a plain explanation and a diagnostic (which accounts differ).
6. Replace emoji lock with the Lucide `Lock` icon; verb-first action labels.

## Phase 4: Strengthen (R3, R4, R6)

1. Period close: `fiscal_periods` (month, status open/closed, closed_by, closed_at). Server rejects postings or reversals dated in a closed period; corrections post in the open period. "Close month" button with a checklist (all shifts closed, no unbalanced entries, drawer variances reviewed). Needs a new migration (next number after 052).
2. Per-shift drawer reconciliation panel: expected vs counted, variance per cashier, tiered status (OK / Review / Investigate) using configurable thresholds in settings; pattern view by cashier and weekday. Over-threshold variance blocks shift close until a note is entered. (R6)
3. Prime-cost strip on the recon tab: daily labor % and weekly prime cost % vs configurable targets (reuse `laborMetricsService` and the `cost_targets` from migration 050). (R4)
4. Journal search and filter (type, memo text, amount range, account, cashier); server-side.
5. Export CSV (and print view) for P&L, balance sheet, journal, recon.
6. Split `FinancialReconciliationCenter.jsx`: `useFinanceActions` hook (modal state and submit), `ProfitLossTabView`, `ReconTabView`, `ActionDialogs`. Move inline colours to CSS variables.
7. Accessibility: `tabpanel`, `aria-controls`, arrow-key tab navigation.

## Tests

- API: reversal rules, closed-period rejection, idempotent replay, PIN masking on journal, negative-balance guard.
- UI: label dictionary coverage (no raw `entryType` rendered), budget-check failure does not block posting, pagination clamp.
- Extend existing `tests/netIncomePinGate.test.js` for the journal.

## Order of work

Phase 1 -> Phase 2 -> Phase 3 -> Phase 4 (items 1 and 2 first). Each phase is a separate commit. Phase 3 can run in parallel with Phase 4 item 4-5 since they touch different files.

## Risks

- Period close needs a migration and backfill; test on a copy of the database first.
- Renaming labels may break existing tests or screenshots that match old text; grep tests before renaming.
- Do not enforce variance thresholds as pay deductions; keep them as review flags only (R6).
