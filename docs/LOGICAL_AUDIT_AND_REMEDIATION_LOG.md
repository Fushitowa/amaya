# 📋 Amaya POS — Complete Logical Audit & Remediation Report (v2.1)

> **Document Type:** System Engineering & Quality Assurance Ledger  
> **Target System:** Amaya's Drinks and Bites Point of Sale & Sales Monitoring System  
> **Audit Date:** 2026-10-20  
> **Decision & Prioritization Engine:** TypeSafe System One (`POST https://api.typesafe.ai/v1/systemone`, Model: `jev-latest` / `jev-1.13.0`)  
> **Auditors & Implementers:** Hazel (Architecture, Security & Backend Lead) + Bob (Frontend & Implementation Specialist) + Markie (Reviewer & Contributor)

---

## 1. Executive Summary

This document serves as the formal technical record of all logical bugs, edge cases, and calculation discrepancies identified during the full-stack audit of the Amaya POS codebase, along with the precise remediation applied.

All 8 defect clusters (`BUG-01` through `BUG-08`) were prioritized using live TypeSafe `Jev` evaluations, executed across 3 structured remediation waves, and verified with zero errors under ESLint and Vite production builds.

---

## 2. Summary of Discovered Defect Clusters & Applied Fixes

| Bug ID | Severity (`Jev` Score) | Affected Files | Core Logical Issue | Remediation Applied |
| :--- | :--- | :--- | :--- | :--- |
| **`BUG-01`** | **3.99 / 4.00** (`Critical`) | `AdminReport.jsx`, `StaffDashboard.jsx` | Unpaid orders included in recognized sales, COGS, and gross profit metrics. | Filtered recognized revenue, COGS, and top products strictly by `isOrderPaid(order)`; preserved `periodOrders` for volume and unpaid exposure. |
| **`BUG-02`** | **3.15 / 4.00** (`Critical`) | `StaffOrderConfirmation.jsx`, `StaffReceipt.jsx` | Blank `cashTendered` enabled the Confirm button and crashed with HTTP 400. | Blank `cashTendered` on Cash checkout now defaults to exact cash (`subtotal`); typed values `< subtotal` trigger `isShort` and block submission. Removed fake receipt fallback items. |
| **`BUG-03`** | **3.02 / 4.00** (`Severe`) | `StaffMenu.jsx`, `StaffQuantity.jsx` | Cart allowed adding items beyond ingredient limits and merged customized items into plain lines. | Added stock and shortage guards to Quick-Add, restricted line merging to identical options, and subtracted active cart reservations when computing available stock. |
| **`BUG-04`** | **2.34 / 4.00** (`High`) | `StaffQuantity.jsx`, `StaffOrder.jsx`, `orders.js` | Special instructions field mismatch (`instructions` vs `notes`) dropped kitchen notes. | Unified and normalized `instructions` and `notes` across modal, order confirmation, API persistence, and staff order display. |
| **`BUG-05`** | **2.52 / 4.00** (`High`) | `StaffOrder.jsx`, `OrdersContext.jsx`, `MenuContext.jsx`, `InventoryContext.jsx` | Hardcoded `"Walk-in Customer"` hid real customer names; active order counts included completed orders; contexts lacked live stock sync. | Displayed `order.customer || WALK_IN_CUSTOMER_NAME` everywhere; added customer search; separated active non-completed order count; wired `amaya:stock-mutated` cross-context sync. |
| **`BUG-06`** | **3.04 / 4.00** (`Severe`) | `AdminMenuManagement.jsx` | Saving single-size items wiped recipe ingredients to `[]`; add-on edits bypassed validation. | Mapped `formValues.ingredients` into default `"Regular"` size on save; enforced add-on price and usage validation; preserved precision in COGS calculations. |
| **`BUG-07`** | **3.22 / 4.00** (`Severe`) | `orders.js`, `menu.js` | Recipe-backed products were blocked by stale `stock_quantity` after restock; completed orders could be deleted without admin privilege. | Derived menu item stock dynamically from recipe ingredient inventory (`recipeServings`); aggregated same-product quantities across order lines; protected completed orders with admin role guard. |
| **`BUG-08`** | **2.68 / 4.00** (`Severe`) | `AdminInventory.jsx`, `create-user.js`, `middleware/auth.js` | Live unit cost preview showed 0 when contents was blank; restock suggested 1 at maximum stock; password length policy drifted. | Set live contents fallback to 1; cleared default restock quantity when stock is at maximum; aligned password length check (8–128 chars); validated active user in `optionalAuth`. |

---

## 3. New Live TypeSafe `Jev` Endpoints (`api/src/routes/decisions.js`)

Two production decision endpoints were integrated into the Express backend:

1. **`POST /api/decisions/inventory-triage` (Admin Only):**
   * Uses TypeSafe `Jev` (`jev-latest`) to score warehouse inventory items on restock urgency (`Healthy`, `Monitor`, `Low Stock Warning`, `Critical Shortage`) and recommend warehouse procurement priorities.
2. **`POST /api/decisions/order-guard` (Staff & Admin):**
   * Uses TypeSafe `Jev` (`noul` questions) to evaluate customer kitchen instructions in real time, detecting unpaid add-on requests (`requests_unpaid_extra_addon`) and flagging food allergies or dietary warnings (`contains_allergy_or_dietary_warning`).

---

## 4. Verification & Build Confirmation

* **ESLint:** `npm run lint` $\rightarrow$ **0 errors, 0 warnings**
* **Vite Customer App:** `npm run dev:customer` / `vite build --mode customer` $\rightarrow$ **Clean build (1.65s)**
* **Vite Staff/Admin Portal:** `npm run dev:portal` / `vite build --mode portal` $\rightarrow$ **Clean build (946ms)**
* **Backend Express Syntax:** Verified with `node --check` across all modified routes and middleware.

---

## 5. Settings & Target Costing Wiring Remediation (2026-11-11)

### 5.1 Investigation & Defect Identification
On 2026-11-11, an end-to-end audit of `.admin-settings-card` (Admin Settings) and `.menu-target-cost-selector` (Admin Menu Management) was performed. While `PUT /api/settings` persisted `target_food_cost` to `business_settings`, the connection between the settings screen and menu pricing was only partial, asymmetric, and exhibited multiple architectural risks:

1. **`SEC-01` Sensitive Data Leakage & Cache Drift:** `GET /api/settings` exposed `targetFoodCost` to unauthenticated and counter staff requests without cache control headers, risking proxy leakage.
2. **`SEC-02` Missing Input Validation & DB Bounds:** `PUT /api/settings` accepted arbitrary objects and lacked numeric range bounds on `targetFoodCost`, lacking database constraint enforcement.
3. **`SEC-03` Prototype Pollution Exposure:** Sizing dictionary lookups in menu costing lacked null-prototype isolation, making them vulnerable to prototype keys (`"toString"`, `"constructor"`).
4. **IEEE-754 Ceil Boundary Overshoot:** `Math.ceil((rawCost / target) / 5) * 5` suffered from IEEE-754 precision overshoot (e.g. `5.25 / 0.35 / 5 = 3.0000000000000004`), jumping ₱5 higher than intended.
5. **Single-Price & Direct-Cost Gaps:** `.menu-target-cost-selector` and suggested pricing calculations were disabled on single-price (`sizes = []`) and `costPrice`-fallback menu items.
6. **Report Variance Disconnect:** `AdminReport.jsx` received `summary.targetFoodCost` from the backend but did not compare it against actual COGS or display food cost variance.
7. **Accessibility & Clarity Deficits:** Missing toggle semantics (`role="switch"`), suboptimal text contrast, and ambiguity regarding whether `.menu-target-cost-selector` changed global settings or ephemeral previews.

### 5.2 Remediations Applied

| Remediation | Target Files | Key Technical Change |
| :--- | :--- | :--- |
| **`SEC-01` Role-Scoping & Headers** | `api/src/routes/settings.js` | Strip `targetFoodCost` for public/staff callers. Emit `Cache-Control: private, no-store` and `Vary: Authorization`. |
| **`SEC-02` Input & DB Hardening** | `api/src/routes/settings.js`<br>`database/migrations/029_*.sql` | Enforce non-object root payloads, ReDoS-safe email validation (`<= 254` chars), `[0.10, 0.90]` bounds, and MariaDB `CHECK` constraint. |
| **`SEC-03` Prototype Isolation** | `src/utils/menuCosting.js`<br>`AdminMenuManagement.jsx` | Use `Object.create(null)` for sizing maps; sanitize variation keys before indexing. |
| **IEEE-754 Epsilon Rounding** | `api/src/utils/costing.js`<br>`src/utils/menuCosting.js` | Applied `(rawCost / target) - 1e-9` epsilon before `Math.ceil(val / 5) * 5` in backend and frontend. |
| **Full Sizing & Costing Parity** | `AdminMenuManagement.jsx`<br>`src/utils/menuCosting.js` | Extended dynamic pricing preview, profit margins, and "Apply ₱X" suggested pricing to single-price and `costPrice` items. |
| **Financial Report Variance** | `AdminReport.jsx` | Added `Food cost vs target` in Sales Summary and `Food cost target` in Highlights with `Partial COGS` warning flag. |
| **UX & WCAG 2.2 AA Polish** | `AdminSettings.jsx`, `.css`<br>`AdminMenuManagement.jsx`, `.css` | Relabeled selector to "Price Preview:", added Store Default badge and Reset button, implemented `role="switch"` and `aria-checked`. |

### 5.3 Automated Verification Evidence
* **Integration Tests:** `tests/settingsFlow.test.js` (15 tests), `tests/menuEditFormSafety.test.js` (24 tests), `tests/reportingAnalytics.test.js` (5 tests).
* **Suite Benchmark:** **82 / 82 tests pass across 19 suites in 20.45s** (`node --test`).
* **Lint & Build:** ESLint exited with **0 errors, 0 warnings**; dual Vite builds for customer and portal completed cleanly in under 2 seconds. Strict non-destructive void-only order lifecycle confirmed.

---

## 6. Phase 1 Income Statement Remediation & Classification Alignment (2026-11-18)

### 6.1 Investigation & Misclassification Root Causes
Following the double-entry ledger rollout (Migrations `030`–`035`), an income statement alignment audit uncovered 13 partial or misplaced accounting items caused by five structural gaps:

1. **Prefix-Based Account Guessing (`code.startsWith("60")`):** Both `api/src/routes/finances.js` and `api/src/routes/sessions.js` inferred P&L sections from account code prefixes, mixing `6030 Inventory Wastage & Spoilage` into OPEX instead of COGS.
2. **4-Account `60xx` OPEX Bottleneck:** Migration `030` only seeded `6010`–`6040`, trapping Rent and Utilities together in `6020` and leaving no expense accounts for Operating Supplies, Sanitation Supplies, or Permits (`Taxes & Licenses`).
3. **Silent `6040` Shift Variances:** `POST /api/sessions/:id/close` saved `cashier_sessions.variance` but never posted balanced entries to `6040 Cash Drawer Discrepancy`.
4. **Missing Internal Store-Use Deduction Path:** Consuming cleaning chemicals, store supplies, or LPG from `1050` Inventory Asset had no non-spoilage OPEX deduction route (`internal_use`).
5. **Cross-Report Revenue & COGS Drift:** `GET /api/reports/financial-summary` reported VAT-inclusive `o.total` (`grossCollectedSales`) and recipe-only `cogs`, diverging from the P&L statement's ex-VAT `netSales` (`4010 - 4020`) and spoilage-inclusive COGS (`5010 + 6030`).

### 6.2 Remediations Applied (13 Items Across DB, API & UI)

```js
// Single source of truth in api/src/utils/ledgerService.js
const pnl = summarizeIncomeStatementLines(rows);
// -> { netSales, customerSalesCogs, foodSpoilageCogs, cogs,
//      grossProfit, operatingExpenses, totalOperatingExpenses,
//      ebitdaOperatingIncome, netOperatingProfit }
```

| Remediation Area | Target Files | Key Technical Change |
| :--- | :--- | :--- |
| **Migration `036` Schema & 22-Account COA** | `database/migrations/036_income_statement_classification_and_accounts.sql`<br>`api/src/migrate.js` | Added `report_section` and `expense_group` on `chart_of_accounts`; reclassified `6030` to `cogs`; marked `6020` `Utilities & Rent (Legacy)`; seeded `6120`, `6130`, `6140`, `6144`, `6172` (bringing COA from 17 to 22 active accounts); widened `inventory_movements.movement_type` ENUM with `'internal_use'`. |
| **Shared Classifier & P&L / BS Sync** | `api/src/utils/ledgerService.js`<br>`api/src/routes/finances.js` | Implemented `summarizeIncomeStatementLines(rows)`; exposed `reportSection` and `expenseGroup` in `/accounts` and `/trial-balance`; split P&L COGS into `customerSalesCogs` + `foodSpoilageCogs`; aligned Balance Sheet `retainedEarnings`; exposed `ebitdaOperatingIncome`. |
| **Shift-Close `6040` & Daily Snapshot Purity** | `api/src/routes/sessions.js` | Auto-posted `DR 6040 / CR 1010` (shortage) or `DR 1010 / CR 6040` (overage) when `|variance| >= 0.01`, guarded by `idempotencyKey = session:<id>:cash_variance`; routed `dailyJeLines` through `summarizeIncomeStatementLines` so `6030` never pollutes `operating_expenses`. |
| **Internal Store Use (`internal_use`)** | `api/src/routes/inventory.js`<br>`src/context/InventoryContext.jsx`<br>`src/pages/admin/AdminInventory.jsx` | Added admin-only `POST /api/inventory/:id/internal-use` (whitelisted to `6144`, `6140`, `6130`; `clientRequestId` idempotency; `DR OPEX / CR 1050`), movement filter support, and `"Use"` button + modal in Inventory. |
| **Ex-VAT & Spoilage Report Parity** | `api/src/routes/reports.js`<br>`src/pages/admin/AdminReport.jsx`<br>`src/utils/staffActivityFormatters.js` | Preserved `grossCollectedSales` while adding `grossSales`, `discountTotal`, `taxCollected`, `netSales`, `spoilageCost`, `totalCogs`, and `reconciledGrossProfit`; surfaced breakdowns and `"Internal Store Use"` filter pill in `AdminReport.jsx`. |
| **Grouped OPEX Modal & P&L Labels** | `src/components/FinancialReconciliationCenter.jsx` | Grouped OPEX `<optgroup>` selector dynamically by `expenseGroup`, grouped P&L OPEX lines, split `5010` + `6030` COGS rows, renamed P&L hero to **`EBITDA / Operating Income`**, and clarified `2020 - Sales Tax / VAT Payable (Collected on Orders)`. |

### 6.3 Automated Verification Evidence
* **New Integration Suite (`tests/incomeStatementRemediation.test.js`):** 5 end-to-end tests covering `6030` COGS reclassification, separated `61xx` OPEX + Balance Sheet equilibrium, shift-close `6040` shortage/overage/zero-variance idempotency, `internal-use` RBAC/whitelist/replay/zero-cost behavior, and `/api/reports/financial-summary` vs P&L ex-VAT & spoilage parity.
* **Full Test Suite (`npm test`):** **`119 / 119` tests passing across `15` test files (`27` subsuites)**.
* **Lint & Production Builds:** `npm run lint` exited with **`0` errors**; `npm run build:portal` and `npm run build:customer` completed cleanly. Strict non-destructive void-only order lifecycle confirmed across the codebase.

---

## 7. Phase 2 Income Statement Waterfall, Payables Subledger, Concurrency & WCAG 2.2 AA Remediation (v2.4.0 — 2026-11-18)

### 7.1 Investigation & Discovered Logical / Concurrency / Accessibility Risks
During the Phase 2 rollout of the remaining **22 `❌ MISSING` Income Statement & Balance Sheet items**, multi-agent audits (Levi, Pixel, Lucy, Rossie, Charlotte, and Hazel) identified and remediated nine critical accounting, concurrency, and accessibility hazards:

1. **Missing Below-EBITDA Waterfall & Sub-Account Granularity:** P&L terminated at `EBITDA / Operating Income` without non-cash `6210 Depreciation Expense` (`1520 Accumulated Depreciation`), `Net Income Before Tax`, or `6310 Income Tax Expense` (`2030 Income Tax Payable`), and lacked granular COA accounts across `Labor & Payroll` (`6111–6113`), `Utilities` (`6131–6134`), `Operating Supplies` (`6141–6143`), `Advertising & Marketing` (`6150`), `Repairs & Maintenance` (`6160`), and `G&A` (`6171, 6173, 6174, 6179`).
2. **Untracked `2010` AP & `2030` Tax Settlements:** Accruing unpaid bills (`CR 2010` or `CR 2030`) had no subledger (`financial_payables`) to track partial/full settlements (`ap_settlement`), prevent over-settlement (`409`), or re-open payable statuses upon journal reversal.
3. **Cash Flow `-2X` Equipment Purchase Bug & Transfer Distortion:** `GET /api/finances/reports/cash-flow` previously misclassified cash equipment purchases (`DR 1510 / CR 1010`), causing a `-2X` distortion, and lacked counterpart-aware routing for `account_transfer` (cash-neutral), `ap_settlement` by `bill_category` (`opexCashOutflow`, `restockCashOutflow`, `taxCashOutflow`), and `void_reversal`.
4. **Shift `expectedCash` Blindness to Non-Order `1010` Drawer Flows:** `SESSION_AGGREGATE_SQL` and `POST /api/sessions/:id/close` did not subtract/add non-order `1010 Cash Drawer` movements (`operating_expense`, `ap_settlement`, `income_tax`, `inventory_restock`, `owner_withdrawal`, `capital_injection`, `account_transfer`, and non-order `void_reversal`s) from `expectedCash`.
5. **`REPEATABLE READ` Stale Snapshots & Gap-Lock Deadlocks (`F-01`–`F-04`):**
   * `SELECT ... WHERE idempotency_key = ? FOR UPDATE` on a non-existent key inside `postBalancedEntry()` acquired overlapping InnoDB supremum gap locks before `INSERT`, deadlocking concurrent requests (`ER_LOCK_DEADLOCK`).
   * Calling `connection.beginTransaction()` and running a plain `SELECT` froze the transaction's `REPEATABLE READ` snapshot before `FOR UPDATE` locks or `ER_DUP_ENTRY` catch handlers ran, causing `SUM(...)` aggregates (`depreciation` NBV check, manual `ap_settlement` check) and duplicate-key replay lookups to read stale pre-commit state.
6. **Single-Connection Pool-Exhaustion Self-Deadlock (`F-05`):** Calling `pool.execute(...)` or `assertJournalReplayMatches(pool, ...)` while `connection` was still checked out inside a route caused 10 concurrent requests (`connectionLimit: 10, queueLimit: 0`) to hold all 10 pool connections while waiting forever for an 11th connection.
7. **Store Use (`internal_use`) Pool Deadlock, `6113` Staff Meals & `1050` Reversal Parity:** `POST /api/inventory/:id/internal-use` needed `findExistingWasteByClientRequest(connection, ...)` before `SELECT ... FOR UPDATE`, `expenseAccountCode` parity checking on replay, expansion to 8 OPEX accounts (including `6113 Employee Benefits (Staff Meals)`), and a dedicated `POST /api/inventory/internal-use/:movementId/reverse` endpoint preserving `1050` weighted-average inventory valuation.
8. **Reversal Memo `> 255`-Char Overflow & `DECIMAL(14,2)` Overflow:** Long reversal reasons risked `500 ER_DATA_TOO_LONG` on `journal_entries.memo` (`VARCHAR(255)`), and oversized numeric inputs (`1e20`, booleans) required strict `parseExactMoney` / `parseStrictFiniteNumber` guards (`<= 999_999_999_999.99`).
9. **WCAG 2.2 AA Contrast & Modal Accessibility Deficits:** `.admin-menu-modal label` overrode `.menu-builder-change-btn` text color (`1.89:1` contrast failure); `.fin-preset-chip:hover` overrode `.fin-preset-chip.is-active` background (`1.44:1` contrast failure); `.inventory-restock-field select:focus` suppressed keyboard focus rings (`outline: 0`); and financial modals required an accessible `FinDialog` wrapper with focus trapping, `Escape` dismissal, and roving `radiogroup` keyboard navigation.

### 7.2 Remediations Applied (`v2.4.0`)

```js
// Complete Phase 2 P&L Waterfall in api/src/utils/ledgerService.js
const pnl = summarizeIncomeStatementLines(rows);
// -> { grossSales, discounts, netSales, customerSalesCogs, foodSpoilageCogs, cogs,
//      grossProfit, operatingExpenses, totalOperatingExpenses,
//      ebitdaOperatingIncome, depreciation, netIncomeBeforeTax, tax, netIncome }
```

| Remediation Area | Target Files | Key Technical Change |
| :--- | :--- | :--- |
| **Migration `037` & 42-Account COA + `financial_payables`** | `database/migrations/037_income_statement_phase2_missing_items.sql`<br>`api/src/migrate.js` | Seeded 20 Phase 2 accounts (`42` active COA total); widened `journal_entries.entry_type` ENUM to 13 values (`ap_settlement`, `depreciation`, `income_tax`); created `financial_payables` with `CHECK` constraints (`2010`, `2030`) and `journal_entries.payable_id`. |
| **P&L Waterfall, `1520` Contra Netting & `2020`/`2030` Isolation** | `api/src/utils/ledgerService.js`<br>`api/src/routes/finances.js` | Added `netIncomeBeforeTax` and `netIncome`; shared `summarizeBalanceSheetAccounts()` nets `1520` (`isContra: true`) against `1510`; blocked `2020` on manual entries (`400`); enforced `is_active = TRUE` on COA lookups and `<= 999_999_999_999.99` on `parseExactMoney()`. |
| **Counterpart Cash Flow & Shift `expectedCash` Sync** | `api/src/routes/finances.js`<br>`api/src/routes/sessions.js` | Rebuilt Cash Flow around per-entry counterpart lines (`netCashFlow === SUM(debit - credit)` across `1010..1040`), fixing `-2X` `1510` bug, routing `ap_settlement` (and reversals via `COALESCE(je.payable_id, parent_je.payable_id)`) to `opexCashOutflow` / `restockCashOutflow` / `taxCashOutflow`; included all `1010` session flows in `expectedCash`. |
| **`REPEATABLE READ` & `F-01`–`F-05` Pool-Safety Hardening** | `api/src/utils/ledgerService.js`<br>`api/src/routes/finances.js`<br>`api/src/routes/inventory.js` | Removed `pool` from `ledgerService.js` (`0` nested pool checkouts while `connection` is held); moved pre-checks before `beginTransaction()`; used non-locking `SELECT` pre-insert + `LOCK IN SHARE MODE` in `ER_DUP_ENTRY` recovery; locked `journal_entry_lines` / `financial_payables` rows `FOR UPDATE` and summed in JS; rolled back before `assertJournalReplayMatches(connection, ...)`. |
| **8-Account `internal_use` (`6113 Staff Meals`) & Reversal** | `api/src/routes/inventory.js`<br>`src/context/InventoryContext.jsx`<br>`src/pages/admin/AdminInventory.jsx` | Whitelisted `6113, 6130, 6133, 6140, 6141, 6142, 6143, 6144`; added `POST /api/inventory/internal-use/:movementId/reverse` (restoring stock & `1050` valuation); added `2x2` quick-pick tiles, CSPRNG `crypto.getRandomValues` IDs, and Stock History `"Reverse"` flow; truncated reversal memos to `255` chars. |
| **WCAG 2.2 AA `FinDialog`, Contrast & Focus Rings** | `src/components/FinancialReconciliationCenter.jsx`<br>`FinancialManagement.css`<br>`AdminMenuManagement.css`<br>`AdminInventory.css` | Implemented `FinDialog` modal shell (`Escape`, focus trap, roving `radiogroup` chips); added `.admin-menu-modal.menu-builder .menu-builder-change-btn` light/dark contrast overrides (`8.59:1` / `7.64:1`), `.fin-preset-chip.is-active:hover:not(:disabled)` (`14.1:1`), and `.inventory-restock-field select:focus-visible` (`2px solid #603b26`). |

### 7.3 Automated Verification Evidence (`v2.4.0`)
* **Phase 2 End-to-End Test Suite (`tests/incomeStatementPhase2.test.js`):** **`8 / 8` suites passing (`P2-1` to `P2-8`)**, including **`12x` concurrent `Promise.all` pool-stress tests** (`Array.from({ length: 12 }, ...)` exceeding `database.js` `connectionLimit: 10`) on both `POST /api/finances/payables/:id/settle` (`P2-2`) and `POST /api/finances/journal-entries` (`P2-7`) with `0` deadlocks and `0` HTTP `500`s.
* **Full Sequential Test Suite (`npm test`):** **`127 / 127` tests passing across `28` suites (`16` test files)** on `amaya_test` (`0` failed, `0` skipped, `0` leaked test rows across `amaya` and `amaya_test`, `42` active COA accounts).
* **Lint & Production Builds:** `npm run lint` exited with **`0` errors, `0` warnings**; `npm run build:portal` (`1.48s`) and `npm run build:customer` (`1.30s`) compiled cleanly. Strict non-destructive void-only order lifecycle verified across all codebase layers.
