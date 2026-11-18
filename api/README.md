# Amaya API

Express API for the Amaya React application. MySQL access stays on the server; the browser only talks to this API.

## Local setup

1. Create an empty MySQL database named `amaya` in Workbench.
2. Run `npm install` from this `api` folder.
3. Copy `.env.example` to `.env` and set `DB_PASSWORD`. Set `JWT_SECRET` to a random secret of at least 32 characters. Never commit `.env`.
4. Run `npm run db:migrate`. This executes all 39 migration entries registered in `api/src/migrate.js` (spanning `001` through `037` across 41 SQL files in `database/migrations/`), expands image storage, creates the 42-account double-entry Chart of Accounts and `financial_payables` subledger, and readies menu categories so products can be added in the Admin Portal.
5. Create an administrator account with `npm run user:create -- admin <username>` (at least 8 characters, max 72 bytes) or manage cashiers via `npm run accounts`. The CLI asks for passwords without echoing; cashiers require at least 6 characters and sign in under the shared `'staff'` login (`display_name` differentiates cashiers after Migration 021).
6. Start the API with `npm run dev`. It listens on `http://localhost:3001`.
7. Start the Vite frontend separately from the project root with `npm run dev` (Customer Showcase `:5173`) or `npm run dev:portal` (Staff POS / Admin Portal `:5174`).

The health endpoint is `GET /api/health`. Mounted route groups live under `/api/auth`, `/api/menu`, `/api/orders`, `/api/inventory`, `/api/settings`, `/api/notifications`, `/api/archive`, `/api/decisions`, `/api/sessions`, `/api/reports`, and `/api/finances`.

## Access rules & Security Gates

- **Public Visitors:** Can read available menu items (`GET /api/menu`) and general business info (`GET /api/settings`). Menu responses are strictly cost-blind (no ingredient costs, margin, or profit numbers exposed), and settings responses omit `targetFoodCost` completely.
- **Counter Staff (`staff`):** Can access counter POS, search products, read orders, record cashier shifts, and submit orders. Staff requests to `GET /api/settings` strip financial targets (`targetFoodCost`), ensuring sensitive margin ratios remain confidential.
- **Administrators (`admin`):** Full management access. Only admins receive `targetFoodCost` on `GET /api/settings` (served with `Cache-Control: private, no-store` and `Vary: Authorization`). Only admins can modify settings (`PUT /api/settings`), modify menu products, manage inventory restocks, or view comprehensive financial reports.
- **Login Session Lifespan:** Login tokens expire after 8 hours. Instant token versioning (`token_version` in Migration 015) revokes compromised or changed credentials immediately across active sessions.

## Settings & Costing Engine Endpoints

- **`GET /api/settings`:**
  - Public / Staff: returns store identity (`businessName`, `email`, `phone`, `address`, `openingTime`, `closingTime`).
  - Admin: returns full configuration including `targetFoodCost` (`0.1000` to `0.9000`, default `0.3000`). Emits private cache control headers so shared intermediaries never cache financial targets.
- **`PUT /api/settings` (Admin Only):**
  - Strict input validation: rejects non-object root payloads (`400`), rejects object/array type coercions, enforces string length limits, applies ReDoS-safe email validation (`<= 254` characters before regex), validates `HH:MM` 24-hour time formats, and enforces `[0.10, 0.90]` bounds on `targetFoodCost`.
  - Database integrity is backed by MariaDB `CHECK (target_food_cost >= 0.1000 AND target_food_cost <= 0.9000)` (Migration 029).
- **`GET /api/menu`:**
  - Dynamically calculates `suggestedPrice` using the store's authoritative `target_food_cost` (rounded to nearest ₱5) for authenticated admin requests.
- **`GET /api/reports/financial-summary` (Admin Only):**
  - Includes `summary.targetFoodCost` for live food cost variance calculations (`actualPct` vs `targetPct`) in Admin Reports, plus ex-VAT revenue and spoilage-adjusted COGS parity with the Profit & Loss statement (`grossCollectedSales` preserved for counter cash reconciliation).

```json
{
  "summary": {
    "grossCollectedSales": 201.60,
    "grossSales": 200.00,
    "discountTotal": 20.00,
    "taxCollected": 21.60,
    "netSales": 180.00,
    "cogs": 40.00,
    "spoilageCost": 20.00,
    "totalCogs": 60.00,
    "grossProfit": 161.60,
    "reconciledGrossProfit": 120.00
  }
}
```

## Income Statement, Payables Subledger & Double-Entry Ledger Endpoints (Migrations 036–037)

`chart_of_accounts` holds **42 active GL accounts** (`17` core accounts `1010`–`6040` from Migration `030`, `5` separated OPEX accounts `6120`, `6130`, `6140`, `6144`, `6172` from Migration `036`, and `20` Phase 2 accounts `1520`, `2030`, `6111–6113`, `6131–6134`, `6141–6143`, `6150`, `6160`, `6171`, `6173`, `6174`, `6179`, `6210`, `6310` from Migration `037`), classified directly in MariaDB by `report_section` and `expense_group` and summarized in one shared helper (`summarizeIncomeStatementLines` in `api/src/utils/ledgerService.js`). `journal_entries.entry_type` supports **13 entry types** (`opening_balance`, `sales_revenue`, `cogs_consumption`, `inventory_restock`, `operating_expense`, `capital_injection`, `owner_withdrawal`, `account_transfer`, `void_reversal`, `adjustment`, `ap_settlement`, `depreciation`, `income_tax`).

- **`GET /api/finances/accounts` & `GET /api/finances/trial-balance` (Admin Only):**
  - Every account exposes `reportSection` (`revenue`, `contra_revenue`, `cogs`, `opex`, `depreciation`, `tax`, `balance_sheet`) and `expenseGroup` (`Labor & Payroll`, `Rent & Occupancy`, `Utilities`, `Operating Supplies`, `Advertising & Marketing`, `Repairs & Maintenance`, `General & Administrative (G&A)`, `Others`, `Utilities & Rent (Legacy)`).
- **`GET /api/finances/reports/profit-and-loss` (Admin Only):**
  - Aggregates COGS across all `report_section = 'cogs'` accounts (`5010` customer sales + `6030` food spoilage & waste), groups `operatingExpenses` (`report_section = 'opex'`), and computes the complete waterfall: `ebitdaOperatingIncome`, `depreciation` (`6210`), `netIncomeBeforeTax`, `tax` (`6310`), and `netIncome` (synced with `netOperatingProfit`).

```json
{
  "grossSales": 200.00,
  "discounts": 20.00,
  "netSales": 180.00,
  "customerSalesCogs": 40.00,
  "foodSpoilageCogs": 20.00,
  "cogs": 60.00,
  "grossProfit": 120.00,
  "totalOperatingExpenses": 950.00,
  "operatingExpenses": [
    { "accountCode": "6120", "accountName": "Rent & Occupancy", "expenseGroup": "Rent & Occupancy", "amount": 500.00 }
  ],
  "ebitdaOperatingIncome": -830.00,
  "depreciation": 50.00,
  "netIncomeBeforeTax": -880.00,
  "tax": 20.00,
  "netIncome": -900.00,
  "netOperatingProfit": -900.00
}
```

- **`GET /api/finances/reports/balance-sheet` (Admin Only):**
  - Uses shared `summarizeBalanceSheetAccounts()` to net contra-asset `1520 Accumulated Depreciation` (`isContra: true`, positive display amount) against `1510 Equipment & Machinery` (`netEquipment = grossEquipment - accumulatedDepreciation`), while keeping `2010 Accounts Payable`, `2020 - Sales Tax / VAT Payable (Collected on Orders)` (isolated strictly for POS order VAT; manual postings to `2020` return HTTP `400`), and `2030 Income Tax Payable` separated so `Assets === Liabilities + Equity` (`isBalanced: true`).
- **`GET /api/finances/reports/cash-flow` (Admin Only):**
  - Counterpart-aware cash flow statement (`netCashFlow === SUM(debit - credit)` across liquid accounts `1010..1040`). Eliminates `-2X` double-counting on cash equipment purchases (`DR 1510 / CR 1010`), keeps `account_transfer` cash-neutral, routes `void_reversal` to its parent activity, routes `ap_settlement` by `financial_payables.bill_category` (`opexCashOutflow`, `restockCashOutflow`, or `operatingActivities.taxCashOutflow`), and leaves non-cash accruals (`CR 2010`, `CR 2030`, `CR 1520`) at `₱0.00` cash impact.
- **`GET /api/finances/payables` & `POST /api/finances/payables/:id/settle` (Admin Only):**
  - Lists and settles tracked bills in the `financial_payables` subledger (`2010` AP from unpaid OPEX or restock-on-credit `POST /api/inventory/:id/restock` with `creditAccountCode: "2010"`, and `2030` Income Tax Payable). Supports partial and full settlements (`DR 2010|2030 / CR 1010..1040`) with `SELECT ... FOR UPDATE` row locking, `clientRequestId` idempotency (`200` on identical replay, `409` on mismatch/overpayment/settled/voided), and atomic `paid_amount` / `status` updates on `POST /api/finances/journal-entries/:id/reverse`.

```json
// POST /api/finances/payables/7/settle
{
  "amount": 500.00,
  "paymentAccountCode": "1030",
  "memo": "Partial utility bill settlement",
  "clientRequestId": "optional-csprng-idempotency-key"
}
```

- **`POST /api/inventory/:id/internal-use` & `POST /api/inventory/internal-use/:movementId/reverse` (Admin Only):**
  - Deducts non-recipe store supplies (`movement_type = 'internal_use'`) and debits any of the **8 whitelisted OPEX accounts** (`6113` Employee Benefits (Staff Meals), `6130` Utilities, `6133` LPG / Cooking Gas, `6140` Operating Supplies, `6141` Linen & Uniforms, `6142` Dining Supplies, `6143` Kitchen Supplies, `6144` Sanitation Supplies) while crediting `1050` Merchandise Inventory.
  - Supports `clientRequestId` replay protection (`200` on identical replay, `409` on mismatch, `400` on disallowed account codes such as `6030`). Direct GL reversal of `inventory_movement_id` entries is blocked (`409`); use `POST /api/inventory/internal-use/:movementId/reverse` to atomically restore stock and `1050` valuation (`void_reversal`).

```json
// POST /api/inventory/14/internal-use
{
  "quantity": 2,
  "expenseAccountCode": "6113",
  "note": "Barista shift staff meal",
  "clientRequestId": "optional-uuid-16-to-80-chars"
}
```

- **`POST /api/sessions/:id/close` (Drawer Payouts & Cash Variance `6040` Posting):**
  - `expectedCash` incorporates all `1010 Cash Drawer` session flows (`sales_revenue`, `inventory_restock`, `operating_expense`, `ap_settlement`, `income_tax`, `owner_withdrawal`, `capital_injection`, `account_transfer`, and non-order `void_reversal`s). When `Math.abs(variance) >= 0.01`, posts an idempotent balanced entry (`idempotencyKey = session:<id>:cash_variance`) to `6040 Cash Drawer Discrepancy`, while daily asset snapshots (`store_daily_asset_snapshots`) net `1510 - 1520` for non-current assets and reuse `summarizeIncomeStatementLines`.

## Automated Test Suite

Run `npm test` from the repository root (`C:\Users\Mark Joshua\Desktop\SCHOOL CODING\AMAYA`) to execute all **127 automated tests across 28 suites (16 test files)** against `amaya_test`, including `tests/incomeStatementPhase2.test.js` (`P2-1` through `P2-8` covering the 42-account COA, `financial_payables` lifecycle, `12x` concurrent pool-stress idempotency exceeding `connectionLimit: 10`, `6113` Staff Meals + `1050` valuation parity, non-cash `6210/1520` NBV race guards, `6310/2030` vs `2020` tax isolation, counterpart Cash Flow, and WCAG 2.2 AA CSS contracts).

For deployment, use a dedicated MySQL user with only the privileges the API needs. Do not run the public API with the MySQL `root` account, expose `JWT_SECRET`, or place database credentials in the React app.
