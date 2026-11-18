# 📝 Amaya POS & Sales Management System — Changelog & Engineering Ledger

All notable changes, architectural upgrades, and bug fixes for **Amaya's Drinks and Bites POS & Sales Monitoring System** are documented in this file.

---

## [v2.4.0] — 2026-11-18

### 🏛️ Income Statement Phase 2 (`22 MISSING` Items), `financial_payables` Subledger, Pool-Safe Concurrency & WCAG 2.2 AA Hardening
Completed all **22 remaining `❌ MISSING` Income Statement & Balance Sheet capabilities** across MariaDB (`037_income_statement_phase2_missing_items.sql`), Express 5 ledger/inventory/session routes, and the Admin Portal (`FinancialReconciliationCenter.jsx`, `AdminInventory.jsx`, `AdminMenuManagement.css`), verified by **127 / 127 passing automated tests across 28 suites (16 test files)**.

```text
Complete Phase 2 P&L Waterfall (Migration 037 + summarizeIncomeStatementLines):
  Gross Sales (4010)                   ₱200.00
- Sales Discounts (4020)                ₱20.00
= Net Sales (ex-VAT)                   ₱180.00
- Customer Sales COGS (5010)            ₱40.00
- Food Spoilage & Waste (6030)          ₱20.00
= Gross Profit                         ₱120.00
- 8 Grouped OPEX Categories (6111–6179, 6010, 6040)
= EBITDA / Operating Income
- Less: Depreciation Expense (6210 / Contra-Asset 1520)
= Net Income Before Tax
- Less: Income Tax Expense (6310 / Payable 2030)
= NET INCOME
```

---

### 1. 🗄️ Migration 037, 42-Account Chart of Accounts & `financial_payables` Subledger (`database/migrations/`, `api/src/`)
* **20 New Chart of Accounts Rows & 13 Entry Types (`database/migrations/037_income_statement_phase2_missing_items.sql`, `api/src/migrate.js`):**
  * Registered Migration `037` in `api/src/migrate.js` (**`39` tracked migration scripts across `001`–`037`**; `41` SQL files in `database/migrations/`).
  * Seeded 20 new `chart_of_accounts` rows via idempotent `ON DUPLICATE KEY UPDATE`, reaching **`42` active accounts**:
    * **Contra-Asset & Tax Liability:** `1520` `Accumulated Depreciation` (`asset`, `credit`, `balance_sheet`), `2030` `Income Tax Payable` (`liability`, `credit`, `balance_sheet`).
    * **Labor & Payroll:** `6111` `Salaries, Wages & Overtime`, `6112` `Mandatory Benefits (SSS / PhilHealth / Pag-IBIG)`, `6113` `Employee Benefits (Staff Meals)`.
    * **Utilities:** `6131` `Electricity`, `6132` `Water`, `6133` `LPG / Cooking Gas`, `6134` `Internet & Telecommunications`.
    * **Operating Supplies:** `6141` `Linen & Uniforms`, `6142` `Dining Supplies`, `6143` `Kitchen Supplies`.
    * **Marketing, Repairs & G&A:** `6150` `Advertising & Marketing`, `6160` `Repairs & Maintenance`, `6171` `Office Expenses`, `6173` `Professional & Bank Fees`, `6174` `Transportation & Travel`, `6179` `Miscellaneous`.
    * **Below-EBITDA Sections:** `6210` `Depreciation Expense` (`report_section = 'depreciation'`), `6310` `Income Tax Expense` (`report_section = 'tax'`).
  * Widened `journal_entries.entry_type` ENUM from `10` to **`13` values**, adding `'ap_settlement'`, `'depreciation'`, and `'income_tax'`.
  * Created `financial_payables` subledger (`utf8mb4_unicode_ci`) with `CHECK` constraints (`original_amount > 0.00`, `0.00 <= paid_amount <= original_amount`, `liability_account_code IN ('2010', '2030')`) and added `journal_entries.payable_id` (`idx_je_payable`, `fk_je_payable`).
* **Shared Ledger Summarizer & Exact Money Guards (`api/src/utils/ledgerService.js`):**
  * Extended `summarizeIncomeStatementLines()` to compute `netIncomeBeforeTax` (`ebitdaOperatingIncome - depreciation`) and `netIncome` (`netIncomeBeforeTax - tax`, synced with `netOperatingProfit`).
  * Centralized `parseExactMoney()` (with `DECIMAL(14,2)` upper cap `999_999_999_999.99` and sub-cent rejection), `resolveActiveSessionId()`, and `stripCostFromNote()`, while enforcing `is_active = TRUE` on `chart_of_accounts` lookups.

---

### 2. ⚖️ Payables Settlement, Non-Cash Depreciation, Tax Isolation, Cash Flow & Shift Equilibrium (`api/src/routes/`)
* **Tracked `2010` AP & `2030` Tax Payables Lifecycle (`api/src/routes/finances.js`, `api/src/routes/inventory.js`):**
  * Accruing unpaid OPEX (`CR 2010`), restocking inventory on credit (`POST /api/inventory/:id/restock` with `creditAccountCode === "2010"`), or accruing unpaid income tax (`CR 2030`) automatically inserts a tracked bill in `financial_payables`.
  * Added `GET /api/finances/payables` and `POST /api/finances/payables/:id/settle` supporting partial and full settlements (`DR 2010|2030 / CR 1010..1040`) with `FOR UPDATE` row locking and `409` overpayment/settled/voided guards.
  * Updated `POST /api/finances/journal-entries/:id/reverse` to block reversing incurred bills when `paid_amount > 0` (`409`), mark unpaid bills `'voided'` when `paid_amount === 0`, atomically decrement `paid_amount` and reopen status (`paid` → `partial` → `unpaid`) when reversing an `ap_settlement`, and slice reversal memos to `255` characters.
* **Contra-Asset `1520` Netting & `2020` vs `2030` Tax Isolation (`api/src/routes/finances.js`):**
  * Shared `summarizeBalanceSheetAccounts()` nets `1520` (`isContra: true`, `netEquipment = grossEquipment - accumulatedDepreciation`) against `1510` across `GET /accounts` and `GET /reports/balance-sheet`.
  * Non-cash `depreciation` (`DR 6210 / CR 1520`) locks `1510` and `1520` lines `FOR UPDATE` to reject charges exceeding Net Book Value (`409`).
  * Blocked manual postings touching `2020` (`400`), isolating POS order VAT (`2020`) from corporate income tax (`6310` / `2030`).
* **Counterpart-Aware Cash Flow & Shift Drawer Payouts (`api/src/routes/finances.js`, `api/src/routes/sessions.js`):**
  * Refactored `GET /api/finances/reports/cash-flow` around per-entry counterpart lines (`netCashFlow === SUM(debit - credit)` across `1010..1040`), fixing the `-2X` `1510` equipment purchase bug, keeping `account_transfer` cash-neutral, routing `void_reversal` to its parent activity, routing `ap_settlement` (and its reversals via `COALESCE(je.payable_id, parent_je.payable_id)`) to `opexCashOutflow`, `restockCashOutflow`, or `operatingActivities.taxCashOutflow`.
  * Expanded `SESSION_AGGREGATE_SQL` and `POST /api/sessions/:id/close` `1010` drawer flow queries to include `inventory_restock`, `operating_expense`, `ap_settlement`, `income_tax`, `owner_withdrawal`, `capital_injection`, `account_transfer`, and non-order `void_reversal`s so `expectedCash` reflects all shift drawer payouts, while daily snapshots net `1510 - 1520` and validate `countedCash` via `parseStrictFiniteNumber`.
* **Expanded Store Use (`6113 Staff Meals` + 8 Accounts) & Reversal (`api/src/routes/inventory.js`):**
  * Expanded `ALLOWED_INTERNAL_USE_ACCOUNTS` to `6113, 6130, 6133, 6140, 6141, 6142, 6143, 6144` and added `POST /api/inventory/internal-use/:movementId/reverse` (blocking direct GL reversal of `inventory_movement_id != null` with `409`).

---

### 3. 🔒 `REPEATABLE READ` & `F-01`–`F-05` Single-Connection Pool-Safety Hardening (`api/src/utils/ledgerService.js`, `finances.js`, `inventory.js`)
* **Zero Nested Pool Acquisition (`F-05` Fix):** Removed `pool` imports/calls inside transactional paths (`postBalancedEntry`, `POST /opening-balance`, `POST /journal-entries`, `POST /payables/:id/settle`, `POST /:id/internal-use`, `POST /:id/waste`) so a route holding a checked-out `connection` never requests a second connection from `database.js` (`connectionLimit: 10, queueLimit: 0`), preventing pool-exhaustion self-deadlocks under `12x` concurrent load.
* **Gap-Lock-Free Idempotency & Current-Read `FOR UPDATE` Guards (`F-01`–`F-04`):**
  * Moved fast-path `idempotency_key` checks and read-only `chart_of_accounts` lookups before `connection.beginTransaction()`.
  * Inside `postBalancedEntry()`, replaced pre-insert `FOR UPDATE` on non-existent `idempotency_key` values (which caused InnoDB supremum gap-lock deadlocks) with non-locking `SELECT`, and used `LOCK IN SHARE MODE` on `connection` inside `ER_DUP_ENTRY` recovery to read newly committed rows across `REPEATABLE READ` snapshots.
  * Locked `journal_entry_lines` and `financial_payables` rows `FOR UPDATE` and summed in JS for `depreciation` NBV checks, untracked `ap_settlement` checks, and `/payables/:id/settle` concurrency guards.

---

### 4. 🎨 Frontend P&L Waterfall, `FinDialog` Accessibility & `Change Image` Contrast (`src/`)
* **Financial Reconciliation Center (`src/components/FinancialReconciliationCenter.jsx`, `src/assets/css/admin/FinancialManagement.css`):**
  * Built shared WCAG 2.2 AA `FinDialog` modal shell (`Escape` key when `!busy`, focus trap + `isConnected` focus restoration, `aria-labelledby`, `overscroll-behavior: contain`, per-field `aria-invalid`, `role="alert"` errors).
  * Rendered all 8 OPEX groups, the full P&L waterfall (`EBITDA / Operating Income` → `Less: Depreciation` → `Net Income Before Tax` → `Less: Income Tax` → single dark hero `NET INCOME`), Balance Sheet `1520` contra-asset netting + `2010`/`2020`/`2030` inline actions, Cash Flow `taxCashOutflow`, and all 4 Phase 2 modals (`Record Expense`, `Settle Payable`, `Record Depreciation` with collapsible straight-line estimator & roving-`tabIndex` `radiogroup` chips + `.fin-preset-chip.is-active:hover:not(:disabled)` contrast guard, and `Record Income Tax` with fresh NIBT auto-fetch).
* **Admin Inventory Store Use & Reversal (`src/pages/admin/AdminInventory.jsx`, `src/context/InventoryContext.jsx`, `src/assets/css/admin/AdminInventory.css`):**
  * Upgraded `Store Use` modal with `2x2` quick-pick tiles (`6113 Staff Meals`, `6144 Sanitation`, `6140 Operating Supplies`, `6133 LPG`) synced with the 8-account `<select>`, CSPRNG `crypto.getRandomValues` request IDs, inline Stock History `"Reverse"` confirmation flow (`reverseInternalUse`), and `.inventory-restock-field select:focus-visible` keyboard ring (`2px solid #603b26`).
* **Menu Builder `Change Image` Contrast Fix (`src/assets/css/admin/AdminMenuManagement.css`):**
  * Added high-specificity `.admin-menu-modal.menu-builder .menu-builder-change-btn` (`#ffffff` on `#603b26` light mode; `#211812` on `#d4a373` dark mode) and `:focus-within` outline so `.admin-menu-modal label` no longer overrides button text contrast.

---

### 5. 🧪 Automated Verification (`tests/incomeStatementPhase2.test.js`)
* Added 8 comprehensive end-to-end test suites (`P2-1` through `P2-8`) covering the 42-account COA, `2010` AP + restock-on-credit + `12x` concurrent settlement pool-stress (`> connectionLimit: 10`), `6113` Staff Meals + `1050` weighted valuation parity, `6210/1520` NBV race `[201, 409]`, `6310/2030` vs `2020` VAT isolation, counterpart Cash Flow + shift `expectedCash` drawer payouts, `12x` concurrent journal-entry idempotency + `> 255`-char memo truncation, and static UI/CSS accessibility contracts.
* **Verified Benchmark:** `npm test` **`127 / 127` tests passing across `16` test files (`28` suites)**; `npm run lint` **`0` errors**; dual Vite builds (`build:portal` & `build:customer`) clean; strict non-destructive void-only order lifecycle verified.

---

## [v2.3.0] — 2026-11-18

### 📊 Phase 1 Income Statement Remediation & Double-Entry Classification Alignment
Eliminated all 13 partial or misplaced Income Statement classifications across MariaDB, Express 5 API routes, and React admin portals by replacing `code.startsWith("60")` heuristics with database-driven `report_section` and `expense_group` columns, wiring shift-close `6040` cash variance postings, separating `61xx` OPEX buckets, and adding the `internal_use` Store Use inventory flow.

```text
Example P&L Waterfall (Migration 036 + summarizeIncomeStatementLines):
  Gross Sales (4010)           ₱200.00
- Sales Discounts (4020)        ₱20.00
= Net Revenue (ex-VAT)         ₱180.00
- Customer Sales COGS (5010)    ₱40.00
- Food Spoilage & Waste (6030)  ₱20.00  <-- reclassified from OPEX to COGS
= Gross Profit                 ₱120.00
- Grouped OPEX (6120/6130/6140/6144/6172/6010/6040)
= EBITDA / Operating Income
```

---

### 1. 🗄️ Migration 036 & Shared Income Statement Classifier (`database/migrations/`, `api/src/`)
* **Schema Classification & 5 Separated OPEX Accounts (`database/migrations/036_income_statement_classification_and_accounts.sql`, `api/src/migrate.js`):**
  * Registered Migration `036` in `api/src/migrate.js` (`38` tracked migration scripts across `001`–`036`; `40` SQL files in `database/migrations/`).
  * Idempotently added `report_section ENUM('revenue','contra_revenue','cogs','opex','depreciation','tax','balance_sheet') NOT NULL DEFAULT 'balance_sheet'` and `expense_group VARCHAR(80) NULL` to `chart_of_accounts`.
  * Backfilled all existing GL accounts (`1010–3020` → `balance_sheet`; `4010` → `revenue`; `4020` → `contra_revenue`; `5010` & **`6030` → `cogs`**; `6010` & `6040` → `opex` [`'Others'`]; `6020` → `opex` [`'Utilities & Rent (Legacy)'`]).
  * Seeded 5 Phase 1 OPEX accounts via `ON DUPLICATE KEY UPDATE` (bringing `chart_of_accounts` from `17` to **`22`** active accounts): `6120` `Rent & Occupancy`, `6130` `Utilities`, `6140` `Operating Supplies`, `6144` `Sanitation Supplies`, and `6172` `Taxes & Licenses (Permits)`.
  * Widened `inventory_movements.movement_type` ENUM with `'internal_use'`.
* **Single Authoritative Summarizer (`api/src/utils/ledgerService.js`):**
  * Added `summarizeIncomeStatementLines(rows, { clampSections = true })`, shared across `finances.js` (`/accounts`, `/reports/profit-and-loss`, `/reports/balance-sheet`) and `sessions.js` (`store_daily_asset_snapshots`).
* **P&L, Trial Balance & Balance Sheet Sync (`api/src/routes/finances.js`):**
  * Exposed `reportSection` and `expenseGroup` in `GET /api/finances/accounts` and `GET /api/finances/trial-balance`.
  * Updated `GET /api/finances/reports/profit-and-loss` to return `customerSalesCogs`, `foodSpoilageCogs`, combined `cogs`, grouped `operatingExpenses` (`report_section = 'opex'`, never `6030`), `depreciation`, `tax`, `ebitdaOperatingIncome`, and backward-compatible `netOperatingProfit`.
  * Synced `GET /api/finances/reports/balance-sheet` `retainedEarnings` via `summarizeIncomeStatementLines` so `Assets === Liabilities + Equity` holds across all `61xx` and `6030` postings.

---

### 2. ⚖️ Shift Cash Variance (`6040`), Store Use (`internal_use`) & Report Parity (`api/src/routes/`)
* **Auto-Posted Shift Cash Discrepancy (`api/src/routes/sessions.js`):**
  * Inside `POST /api/sessions/:id/close`, variance `|variance| >= 0.01` now posts an idempotent double-entry (`idempotencyKey: session:<id>:cash_variance`): shortage debits `6040` / credits `1010`; overage debits `1010` / credits `6040`; exact `0` posts no entry.
  * Updated `store_daily_asset_snapshots` calculation (`dailyJeLines`) to join `report_section` / `expense_group` and pass lines through `summarizeIncomeStatementLines`, isolating `6030` into `spoilage_shrinkage` and keeping `operating_expenses` clean.
* **Internal Store Use Endpoint (`api/src/routes/inventory.js`, `api/src/routes/reports.js`):**
  * Added admin-only `POST /api/inventory/:id/internal-use` validating positive stock quantity and whitelisted `expenseAccountCode` (`6144`, `6140`, `6130`), supporting `clientRequestId` replay safety (`200` replay, `409` conflict), deducting stock atomically, inserting `'internal_use'` movements, and posting `DR OPEX / CR 1050` via `postInventoryValuationDelta` (`journalEntryId: null` when `unit_cost === 0`).
  * Enabled `type=internal_use` filtering in `GET /api/inventory/movements` and `GET /api/reports/inventory-activity` (`totalInternalUseCount`).
* **Ex-VAT & Spoilage Parity (`api/src/routes/reports.js`):**
  * Preserved `grossCollectedSales` and recipe `cogs` on `GET /api/reports/financial-summary` while adding `grossSales`, `discountTotal`, `taxCollected`, `netSales` (matching P&L ex-VAT), `spoilageCost` (`6030`), `totalCogs` (`cogs + spoilageCost`), and `reconciledGrossProfit`. Filtered order slices (`paymentMethod=GCash`) cleanly exclude unrelated storewide manual `6030` waste.

---

### 3. 🎛️ Frontend Portal Alignment (`src/`)
* **Store Use Action & Modal (`src/pages/admin/AdminInventory.jsx`, `src/context/InventoryContext.jsx`):**
  * Added `recordInternalUse` context helper and `"Use"` button + 3-field `"INTERNAL STORE USE"` modal (`Quantity`, `6144`/`6140`/`6130` account selector, `Note`) alongside `"Waste"`.
* **Grouped OPEX Modal & `EBITDA / Operating Income` (`src/components/FinancialReconciliationCenter.jsx`):**
  * Fetches `/finances/accounts` to render `<optgroup>` buckets grouped by `expenseGroup` (tagging `6020` as `(Legacy)`).
  * Breaks P&L COGS into `5010` + `6030`, groups OPEX rows by `expenseGroup`, renames the P&L summary hero to **`EBITDA / Operating Income`**, and clarifies Balance Sheet `2020` as `"2020 - Sales Tax / VAT Payable (Collected on Orders)"`.
* **Admin Reports Sub-Captions & Filter (`src/pages/admin/AdminReport.jsx`, `src/utils/staffActivityFormatters.js`):**
  * Added `Net Sales (ex-VAT)` / `Tax`, `Total COGS incl. Spoilage`, and `Reconciled (ex-VAT, incl. Spoilage)` breakdowns plus the `"Internal Store Use"` filter pill and `"Store Use"` movement KPI slip.

---

### 4. 🧪 Automated Verification (`tests/incomeStatementRemediation.test.js`)
* Added 5 integration tests covering `6030` COGS reclassification, separated `61xx` OPEX + Balance Sheet equilibrium, shift-close `6040` shortage/overage/zero-variance idempotency, `internal-use` RBAC/whitelist/replay/zero-cost behavior, and `financial-summary` vs P&L parity.
* **Verified Benchmark:** `npm test` **`119 / 119` tests passing across `15` test files (`27` subsuites)**; `npm run lint` **`0` errors**; dual Vite builds (`build:portal` & `build:customer`) clean; strict non-destructive void-only order lifecycle verified.

---

## [v2.2.0] — 2026-11-11

### 🎯 Admin Settings & Target Food Cost Wiring, Hardening, Costing Parity & Test Certification
Conducted full-stack wiring, security hardening, and calculation parity between the Admin Settings Financial Targets card (`.admin-settings-card`) and the Menu Target Cost Selector (`.menu-target-cost-selector`), backed by Migration 029, pure costing utilities, and 82/82 passing automated tests.

---

### 1. 🔒 Backend Costing Engine & Settings Security Hardening (`api/src/`)
* **Role-Scoped Access Control & Header Hygiene (`api/src/routes/settings.js`):**
  * `GET /api/settings` strips `targetFoodCost` for public and counter `staff` callers. Returns `targetFoodCost` strictly to authenticated administrators.
  * Emits `Cache-Control: private, no-store` and `Vary: Authorization` headers so intermediate proxies and browsers never cache administrative financial targets.
* **Strict Settings Input Validation (`api/src/routes/settings.js`):**
  * Rejects non-object root payloads (`null`, arrays, primitives) with HTTP 400.
  * Blocks object/array type coercion on `businessName`, `email`, `phone`, and `address`.
  * Implements length-first ReDoS defense on email fields (`length <= 254` checked prior to regex execution).
  * Validates `openingTime` and `closingTime` against `HH:MM` 24-hour format.
  * Validates `targetFoodCost` strictly within `[0.10, 0.90]` bounds (`10%` to `90%`). Preserves existing value when omitted.
* **IEEE-754 Ceiling Overshoot Remediation (`api/src/utils/costing.js`):**
  * Fixed floating-point precision bug where exact boundary calculations (e.g. `5.25 / 0.35 / 5 = 3.0000000000000004`) erroneously rounded up to `₱20` instead of `₱15`. Applied `(rawCost / target) - 1e-9` epsilon before `Math.ceil`.
  * Exported `normalizeTargetFoodCost`, `DEFAULT_TARGET_FOOD_COST (0.30)`, `MIN_TARGET_FOOD_COST (0.10)`, and `MAX_TARGET_FOOD_COST (0.90)`.
* **Database Constraint Migration 029 (`database/migrations/029_business_settings_target_food_cost_check.sql`):**
  * Pre-clamps legacy drifted rows within `[0.1000, 0.9000]`.
  * Adds idempotent MariaDB `CHECK` constraint `chk_business_settings_target_food_cost` ensuring database-level integrity.
* **Downstream Costing Propagation (`api/src/routes/menu.js` & `api/src/routes/reports.js`):**
  * Aligned `menu.js` to compute `suggestedPrice` using the authoritative store target for authenticated admins.
  * Added `summary.targetFoodCost` in `GET /api/reports/financial-summary` for live food cost variance monitoring.

---

### 2. 🎛️ Frontend Costing Parity, State Sync & Price Preview UX (`src/`)
* **Auth-Reactive Business Settings State (`src/context/BusinessContext.jsx`):**
  * Listens to authentication state changes, `"amaya:session-changed"`, and debounced window focus events to refresh store settings.
  * Resets `targetFoodCost: null` on non-admin sessions. Provides truthful loading and retry error states.
  * Clarified Card 4 Notifications as browser-local (`localStorage` key `amaya-admin-notifications`).
* **Modular Frontend Costing Utility (`src/utils/menuCosting.js`):**
  * Created pure, testable menu costing module mirroring backend `summarizeCosting` with identical epsilon ceiling logic, gross margin calculation, and prototype-safe dictionary operations.
* **Interactive Menu Price Preview (`src/pages/admin/AdminMenuManagement.jsx`):**
  * Explicitly relabeled `.menu-target-cost-selector` to **"Price Preview:"**.
  * Added visual `Default` badge to the pill corresponding to the store-wide setting, and a 1-click `Reset` button when overriding.
  * Clarified that selecting preview pills is an ephemeral simulation and does not alter store-wide settings or product recipes.
  * Extended live preview and "Apply ₱X" suggested pricing to single-price products (`sizes = []`) and direct `costPrice` inventory items.
  * Hardened recipe sizing lookup against prototype-polluting keys (`"toString"`, `"constructor"`).
* **Live Target Variance & Highlights in Reports (`src/pages/admin/AdminReport.jsx`):**
  * Added `Food cost vs target` metric in Sales Summary showing actual COGS percentage vs configured store target with signed percentage-point delta (`+X.X pts over` / `-X.X pts under` / `On target`).
  * Added `Food cost target` highlight card with `Partial COGS` warning flag when uncosted menu items exist.
* **Accessibility (WCAG 2.2 AA) Polish:**
  * Verified text contrast `>= 4.5:1` across labels, badges, and preview pills.
  * Added `role="switch"` and `aria-checked` to setting toggle controls and preserved visible focus rings.

---

### 3. 🧪 Automated Test Certification & Verification Harness (`tests/`)
* **New Integration Test Suite (`tests/settingsFlow.test.js`):**
  * 15 comprehensive automated test cases covering backend costing utilities, role-scoped settings retrieval, cache header hygiene, validation boundaries, ReDoS safety, downstream propagation, and Migration 029 constraint enforcement.
* **Test Server Harness Upgrade (`tests/helpers/testServer.js`):**
  * Mounted `settingsRoutes` and implemented automatic snapshot and restoration of `business_settings` row `id = 1` across test suite runs to prevent database state leakage.
* **Full Verification Benchmark:**
  * `npm test`: **82 / 82 tests passing across 19 suites** (`node --test`).
  * `npm run lint`: **0 errors, 0 warnings** (`eslint .`).
  * `npm run build:portal` & `npm run build`: Dual Vite production builds compiled cleanly.
  * Strict non-destructive void-only order lifecycle maintained across all codebase layers.

---

## [v2.1.0] — 2026-10-20

### 🎯 3-Wave Logical Audit & Zero-Defect Remediation (Coordinated by Hazel & Bob)
Conducted a deep logical and architectural audit of all React frontend views, contexts, and Express 5 API routes, uncovering 8 major defect clusters (19 specific code issues) evaluated and prioritized using **TypeSafe `Jev` (`jev-latest`)**.

---

### 1. 💵 Financial Reporting & Checkout Integrity (`BUG-01`, `BUG-02`)

* **Fixed Unpaid Order Contamination in Financial Reports (`src/pages/admin/AdminReport.jsx` & `src/pages/staff/StaffDashboard.jsx`):**
  * `periodSales`, `previousSales`, `averageOrder`, `itemsSold`, `periodCogs`, `periodGrossProfit`, `revenueSeries`, `topProducts`, and `channelMix` in `AdminReport.jsx` previously calculated metrics across all orders without checking payment status.
  * *Fix:* Created `paidPeriodOrders` and `paidPreviousOrders` filtering strictly by `isOrderPaid(order)` to ensure recognized revenue and COGS match `AdminDashboard.jsx` and `/api/orders/summary`. Kept total order volume and `unpaidExposure` distinctly separated.
  * *Fix:* Updated `StaffDashboard.jsx` `todaysRevenue` to sum only orders where `isOrderPaid(order)` is `true`.
* **Fixed Blank Cash Tendered Checkout Crash (`src/pages/staff/StaffOrderConfirmation.jsx` & `src/pages/staff/StaffReceipt.jsx`):**
  * In `StaffOrderConfirmation.jsx`, when `cashTendered` was empty (`""`), `isShort` previously evaluated to `false` (`cashTendered !== ""`), enabling the Confirm button while sending `cashTendered: 0` to `POST /api/orders`, resulting in `HTTP 400: Cash tendered must cover the order total`.
  * *Fix:* Implemented exact cash fallback: when `selectedPayment === "Cash"`, an empty `cashTendered` input defaults `tenderedAmount` to `subtotal` (exact cash), enabling seamless 1-click checkout, while typed values `< subtotal` trigger `isShort` and disable the button.
  * *Fix:* Removed hardcoded sample items (`Matcha Milk Tea`, `Takoyaki`, `|| 108` subtotal fallback) from `StaffReceipt.jsx`, rendering dynamic items and payment statuses (`PAID` vs `UNPAID`).

---

### 2. 📦 Inventory Deduction, Cart Stock Ceilings & Order Deletion (`BUG-03`, `BUG-07`)

* **Fixed Cart-Wide Ingredient Stock Limit Bypass & Merge Keys (`src/pages/staff/StaffMenu.jsx` & `src/pages/staff/StaffQuantity.jsx`):**
  * `quickAddToOrder` in `StaffMenu.jsx` previously bypassed ingredient shortage checks and merged customized items into plain items.
  * *Fix:* Added shortage and recipe configuration guards to `quickAddToOrder`. Ensured cart line merging strictly requires matching `productId`, `size === "Regular"`, empty `addons`, and empty `instructions`/`notes`. Capped both Quick-Add and the cart `+` stepper at available stock limits.
  * *Fix:* In `StaffQuantity.jsx`, subtracted cumulative ingredient quantities already reserved by items in the current active cart when computing `ingredientStockLines` and `maxServingsFromIngredients`.
* **Fixed Recipe-Backed Product Stock Desynchronization on Restock (`api/src/routes/orders.js` & `api/src/routes/menu.js`):**
  * Recipe-backed products were previously blocked by stale `menu_products.stock_quantity` even after recipe ingredients were restocked in `AdminInventory.jsx`.
  * *Fix:* Updated `toProduct()` in `menu.js` to dynamically compute `effectiveStock` from live `inventory_items` recipe quantities (`recipeServings`). Updated `orders.js` to enforce live row-locked ingredient inventory for recipe items and aggregate cumulative quantities across same-product lines.
* **Protected Completed Orders Against Unauthorized Deletion (`api/src/routes/orders.js`):**
  * `DELETE /api/orders/:orderNumber` previously allowed deleting `Completed` orders without administrative privilege.
  * *Fix:* Enforced `if (order.order_status === "Completed" && request.authUser.role !== "admin") throw httpError(403)`.

---

### 3. 🍲 Recipe Costing, Variations & Authentication Consistency (`BUG-06`, `BUG-08`)

* **Fixed Single-Size Product Save Wiping Recipe Ingredients (`src/pages/admin/AdminMenuManagement.jsx`):**
  * When saving a product without explicit variation tabs (`cleanSizes.length === 0`), `finalSizes` previously defaulted to `ingredients: []`, erasing the item's recipe costing.
  * *Fix:* Mapped `formValues.ingredients` into the default `"Regular"` size so single-size recipes retain full ingredient costing on save.
* **Added Strict Add-On Save Validation & Precision Costing (`src/pages/admin/AdminMenuManagement.jsx`):**
  * Added validation in `saveProduct()` ensuring every add-on has `price >= 0`, `quantityUsed > 0`, and compatible unit conversion with its linked inventory stock unit. Kept unrounded floating-point precision during recipe line cost summation in `computeSizeCosting()`.
* **Fixed Live Costing Preview & Restock Default Quantity (`src/pages/admin/AdminInventory.jsx`):**
  * Fixed `liveContents` calculation to default to `1` when `contentsPerPackage` is blank, matching `handleSave` logic. Updated `openRestock` so items already at or above `maximumStock` do not default to suggesting `"1"`.
* **Aligned Password Minimum Length & Verified Inactive Users in Auth (`api/src/create-user.js` & `api/src/middleware/auth.js`):**
  * Aligned `create-user.js` password length policy (`8–128` characters) with `auth.js`.
  * Updated `optionalAuth` in `middleware/auth.js` to verify user existence and `is_active` status in MySQL, setting normalized `{ sub, username, role }`.

---

### 4. 🎛️ Staff Workflow, Customer Display & Real-Time Sync (`BUG-04`, `BUG-05`)

* **Fixed Customer Name Hiding & Special Instructions Sync (`src/pages/staff/StaffOrder.jsx` & `src/pages/staff/StaffQuantity.jsx`):**
  * Replaced hardcoded `WALK_IN_CUSTOMER_NAME` on order cards, details modals, delete dialogs, and thermal slips with `order.customer || order.customerName || WALK_IN_CUSTOMER_NAME`. Added customer names and table numbers to the search filter.
  * Normalized kitchen notes across `item.instructions` and `item.notes`, and persisted them through `POST /api/orders`.
  * Fixed top summary card `"Active Orders"` to display non-completed orders (`Pending + Preparing + Ready`) rather than all historical orders.
  * Awaited `updateOrderStatus` and `deleteOrder` before displaying success toasts.
* **Integrated Cross-Context Real-Time Inventory & Menu Refresh (`src/context/*`):**
  * Created `amaya:stock-mutated` event architecture across `OrdersContext.jsx`, `MenuContext.jsx`, and `InventoryContext.jsx` so order checkouts, order cancellations, and warehouse restocks immediately synchronize live stock numbers across the POS and Admin views without manual page reloads.

---

### 5. 🤖 Live TypeSafe `Jev` System One Production Endpoints (`api/src/routes/decisions.js`)

* **`POST /api/decisions/inventory-triage`:**
  * Uses TypeSafe `Jev` (`jev-latest`) to score warehouse inventory items on restock urgency (`Healthy`, `Monitor`, `Low Stock Warning`, `Critical Shortage`) and recommend high-level procurement actions.
* **`POST /api/decisions/order-guard`:**
  * Uses TypeSafe `Jev` (`noul` primitives) to evaluate customer kitchen instructions in real time, detecting unpaid add-on requests (`requests_unpaid_extra_addon`) and flagging food allergies or dietary warnings (`contains_allergy_or_dietary_warning`).
