# 🧋 Amaya's Drinks and Bites: Point of Sale & Sales Monitoring System

> **Lead Developer & Maintainer:** Codenamed "Ken" ([@Fushitowa](https://github.com/Fushitowa))  
> **Contributor / Helper:** Markie  
> **Tech Stack:** React 19 • React Router 7 • Vite 8 • Node.js / Express 5 • MariaDB / MySQL • Python 3 (Tkinter)

---

## 📌 Executive Summary

**Amaya's Drinks and Bites POS** is a modern, full-stack point-of-sale, inventory tracking, and sales monitoring system engineered specifically for cafe and beverage operations. 

The system features dual-frontend applications (Public Customer Showcase and Staff/Admin Portal), an automated **Procurement-to-Recipe Costing Engine** with 4-decimal precision, atomic inventory row-locking during checkout, a 30-day soft-delete trash archive with rolling auto-purge, and a one-click desktop control panel.

---

## 🚀 Key Architectural Upgrades & System Features

### 1. 📐 4-Decimal Sub-Cent Inventory Costing Engine
Eliminates financial drift by converting bulk supplier packaging (sacks, packs, boxes) into measurable base stock units (`g`, `ml`, `pcs`) with 4-decimal unit costing (`DECIMAL(12, 4)`).

### 2. 🧋 Size-Specific Recipe & Add-On Inventory Deduction
Supports multi-size recipes (`Regular 16oz`, `Large 22oz`) and custom add-ons (`Extra Black Pearl`). Each size specifies precise ingredient deductions linked directly to inventory items.

### 3. ⚖️ Multi-Dimensional Culinary Unit Conversion
Built-in conversion matrix (`api/src/utils/inventoryUnits.js`) automatically translates recipe measurement units (`tbsp`, `oz`, `cup`, `tsp`) to stock inventory units (`g`, `ml`, `kg`, `l`, `pcs`) across mass, volume, and count.

### 4. 🔒 Atomic Inventory Protection & Order Reversal
Uses pessimistic MySQL row-locking (`SELECT ... FOR UPDATE`) during checkout. Automatically logs ingredient deductions in `order_inventory_consumptions` and reverses stock deductions if an order is cancelled.

### 5. 🗑️ 30-Day Trash Archive & Audit Trail (Migration 009)
Safely soft-deletes menu products and inventory items into a 30-day recycle bin (`is_archived = TRUE`), prevents deleting ingredients tied to active recipes, records permanent audit history (`archive_audit_logs`), and automatically purges expired records.

### 6. 🖥️ One-Click Desktop Service Launcher (v2.0)
A Tkinter Python GUI (`scripts/amaya_control_panel.py`) accompanied by a windowless batch launcher (`Start_Amaya_Control_Panel.bat`) managing all 4 local services:
1. `XAMPP MySQL Database (:3306)` (auto-start & clean `mysqladmin` shutdown)
2. `Backend Express API (:3001)`
3. `Customer Website (:5173)`
4. `Staff POS / Admin Portal (:5174)`

### 7. 🎨 Ergonomic Admin Inventory Layout
* **Sticky Metrics Right Rail:** Replaced clunky top metric banners with a persistent 5-card right-hand rail.
* **38px Centered Toolbar:** Perfectly aligned search and category filters.
* **Compact 27px Card Actions:** Eliminated button overflow and container clipping.
* **Header Stock Alert Flag:** Relocated out-of-stock warning flags directly into the topbar actions header.

### 8. 🧠 TypeSafe System One AI Decision Engine & Zero-Defect Logical Guard (v2.1)
* **Live AI Decision Routes (`/api/decisions`):** Integrates TypeSafe `Jev` (`jev-latest`) for real-time warehouse restock urgency triage (`/api/decisions/inventory-triage`) and cashier kitchen note risk evaluation (`/api/decisions/order-guard`).
* **Complete Logical Remediation:** 8 defect clusters remediated across financial reporting (strict Paid-only recognized revenue/COGS), exact cash checkout fallbacks, dynamic recipe-backed serving availability (`recipeServings`), and cumulative cart ingredient stock ceilings.
* **Engineering Ledger:** See [CHANGELOG.md](CHANGELOG.md) and [docs/LOGICAL_AUDIT_AND_REMEDIATION_LOG.md](docs/LOGICAL_AUDIT_AND_REMEDIATION_LOG.md) for full technical diffs and verification benchmarks.

### 9. 📋 Stock Health Restock List (Fushi / Ken)
* **Reports → Stock health:** The **View restock list** action opens a focused list of out-of-stock, critical (20% or less), and running-low (21–40%) inventory items.
* **Restock guidance:** Each row shows the current quantity, maximum stock, health status, and estimated quantity needed to return to the configured maximum.
* **Copy and Notepad workflow:** **Copy restock list** copies the full list to the clipboard and downloads it as a dated `.txt` file that can be opened in Notepad. Browsers cannot write directly into or launch Notepad, so the downloaded text file is the portable handoff.
* **Feature update by:** Fushi (Ken), [@Fushitowa](https://github.com/Fushitowa).

### 10. 🎯 Target Food Cost Pricing Engine & Admin Settings Wiring (v2.2)
* **Single Authoritative Target:** Stored globally in `business_settings.target_food_cost` (`0.1000` to `0.9000`, default `0.3000` / 30%), guarded by MariaDB `CHECK` constraint `chk_business_settings_target_food_cost` (Migration 029).
* **Role-Scoped Access & Cache Hygiene:** Admin-only access to food cost targets via `GET /api/settings` with `Cache-Control: private, no-store` and `Vary: Authorization`; stripped for public visitors and counter staff.
* **Dynamic Price Preview:** Admin Menu Management features an interactive price preview calculator with Store Default badge, 1-click Reset, and IEEE-754 epsilon precision across sized and single-price items.
* **Real-Time Financial Variance:** Admin Reports tracks live `Food cost vs target` and Highlights benchmarks against actual COGS with uncosted item badges.
* **Automated Test Certification (v2.2 baseline):** 82 / 82 automated regression tests passing across 19 suites at v2.2 release (expanded in v2.3 to **119 / 119 passing**).

### 11. 📊 Phase 1 Income Statement Remediation & Double-Entry Alignment (v2.3, Migration 036)
Fixes all 13 partial or misplaced P&L items across MariaDB, Express APIs, and the Admin Portal using a single database-driven classifier (`summarizeIncomeStatementLines` in `api/src/utils/ledgerService.js`):

```text
Net Sales (ex-VAT: 4010 - 4020)
  - Customer Sales COGS (5010)
  - Food Spoilage & Waste (6030, moved from OPEX to COGS)
= Gross Profit
  - Grouped OPEX (6120 Rent · 6130 Utilities · 6140 Operating · 6144 Sanitation · 6172 Permits · 6010/6040 Others)
= EBITDA / Operating Income
```

* **Database-Classified Chart of Accounts (`22` Accounts, Migration 036):** Adds `report_section` and `expense_group` columns to `chart_of_accounts`, reclassifies `6030 Inventory Wastage & Spoilage` to `cogs`, marks `6020` legacy, and seeds `6120` (`Rent & Occupancy`), `6130` (`Utilities`), `6140` (`Operating Supplies`), `6144` (`Sanitation Supplies`), and `6172` (`Taxes & Licenses (Permits)`).
* **Inventory "Store Use" Flow (`POST /api/inventory/:id/internal-use`):** Lets admins deduct non-recipe supplies (cleaning agents, store supplies, LPG) via `AdminInventory.jsx` (`Use` button) into `6144`/`6140`/`6130` OPEX (`DR OPEX / CR 1050`) with `movement_type = 'internal_use'`—never inflating `6030` spoilage—and adds an `"Internal Store Use"` filter pill in `AdminReport.jsx`.
* **Shift-Close `6040` Cash Variance Double-Entry:** Closing a cashier register shift (`POST /api/sessions/:id/close`) automatically posts an idempotent variance entry (`session:<id>:cash_variance`) debiting `6040` on cash shortage or crediting `6040` on overage, while daily asset snapshots compute clean OPEX via `summarizeIncomeStatementLines`.
* **Cross-Report Ex-VAT & Spoilage Parity:** `GET /api/reports/financial-summary` keeps `grossCollectedSales` for counter cash totals while exposing `grossSales`, `discountTotal`, `taxCollected`, `netSales`, `spoilageCost`, `totalCogs`, and `reconciledGrossProfit` alongside `AdminReport.jsx` breakdowns, a grouped `<optgroup>` OPEX modal, clarified `2020 - Sales Tax / VAT Payable (Collected on Orders)`, and `EBITDA / Operating Income` P&L labeling.
* **Verified Suite Benchmark (v2.3 baseline):** `119 / 119` tests passing across `15` test files (`27` subsuites) at v2.3 release (expanded in v2.4 to **`127 / 127` passing across `16` test files / `28` suites**), `0` ESLint errors, clean dual Vite builds, and strict non-destructive void-only order lifecycle compliance.

### 12. 🏛️ Phase 2 Complete Income Statement Waterfall, Payables Subledger & Pool-Safe Concurrency (v2.4, Migration 037)
Closes all **22 remaining `❌ MISSING` P&L & Balance Sheet items** across MariaDB (`037_income_statement_phase2_missing_items.sql`), Express 5 ledger routes, and the Admin Portal (`FinancialReconciliationCenter.jsx`, `AdminInventory.jsx`, `AdminMenuManagement.css`):

```text
Net Sales (ex-VAT: 4010 - 4020)
  - Customer Sales COGS (5010)
  - Food Spoilage & Waste (6030)
= Gross Profit
  - 8 Grouped OPEX Categories (Labor & Payroll · Rent & Occupancy · Utilities · Operating Supplies · Advertising & Marketing · Repairs & Maintenance · G&A · Others)
= EBITDA / Operating Income
  - Less: Depreciation Expense (6210 / Contra-Asset 1520)
= Net Income Before Tax
  - Less: Income Tax Expense (6310 / Payable 2030)
= NET INCOME
```

* **42-Account Chart of Accounts & 13 Journal Entry Types (Migration 037):** Seeds **20 new COA accounts** (`1520` Accumulated Depreciation, `2030` Income Tax Payable, `6111–6113` Labor & Payroll including `6113 Employee Benefits (Staff Meals)`, `6131–6134` Utilities, `6141–6143` Operating Supplies, `6150` Advertising & Marketing, `6160` Repairs & Maintenance, `6171/6173/6174/6179` G&A, `6210` Depreciation Expense, `6310` Income Tax Expense) for **`42` active accounts total**, and widens `journal_entries.entry_type` to **13 values** (`ap_settlement`, `depreciation`, `income_tax`).
* **Tracked Accounts Payable & Tax Payable Subledger (`financial_payables`):** Accruing unpaid OPEX (`CR 2010`), restock-on-credit (`POST /api/inventory/:id/restock` with `creditAccountCode: "2010"`), or unpaid income tax (`CR 2030`) creates a tracked bill in `financial_payables` (`unpaid` → `partial` → `paid` / `voided`). Admins inspect and settle bills via `GET /api/finances/payables` and `POST /api/finances/payables/:id/settle` without double-counting P&L expenses.
* **Non-Cash Depreciation (`6210` / `1520`), `2030` vs `2020` Tax Isolation & Counterpart Cash Flow:** `1520` nets against `1510 Equipment & Machinery` on the Balance Sheet (`isContra: true`, `netEquipment = grossEquipment - accumulatedDepreciation`, NBV cap enforced via `FOR UPDATE`). Manual entries touching `2020` POS VAT are blocked (`400`), isolating corporate income tax in `6310` / `2030`. Cash Flow (`GET /api/finances/reports/cash-flow`) aggregates per-entry counterpart lines (`netCashFlow === SUM(debit - credit)` across `1010..1040`), eliminating the `-2X` `1510` double-count and exposing `operatingActivities.taxCashOutflow`.
* **Expanded Store Use (`6113 Staff Meals` + 8 OPEX Accounts) & Reversal Route:** `POST /api/inventory/:id/internal-use` supports `6113, 6130, 6133, 6140, 6141, 6142, 6143, 6144` with `2x2` quick-pick tiles in `AdminInventory.jsx` and dedicated reversal via `POST /api/inventory/internal-use/:movementId/reverse` (restoring stock and `1050` valuation parity).
* **WCAG 2.2 AA `FinDialog` Modals, `Change Image` Contrast & `12x` Pool-Safe Concurrency:** Adds shared accessible `FinDialog` modal shell (`Escape`, focus trap, roving `radiogroup` chips), fixes `.menu-builder-change-btn` contrast (`#ffffff` on `#603b26` light / `#211812` on `#d4a373` dark), and eliminates single-connection self-deadlocks (`F-01`–`F-05`) under `connectionLimit: 10`.
* **Verified Suite Benchmark (v2.4):** **`127 / 127` tests passing across `16` test files (`28` suites)** including `tests/incomeStatementPhase2.test.js` (`P2-1` to `P2-8` with `12x` concurrent pool-stress tests), **`0` ESLint errors**, and clean dual Vite builds (`build:portal` & `build:customer`).

---

## 🧮 The Mathematical Inventory-to-Menu Costing Engine

The core financial framework connects bulk procurement directly to individual menu recipes.

```text
┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│   SUPPLIER PACKAGING   │ ───► │  INVENTORY BASE UNIT   │ ───► │   MENU RECIPE (COGS)   │
│  e.g. ₱180 / 1kg pack  │      │   ₱0.1800 per gram     │      │  30g powder = ₱5.40    │
└────────────────────────┘      └────────────────────────┘      └────────────────────────┘
```

### Formula 1: Total Bulk Measurable Contents
$$\text{Total Bulk Contents} = \text{Package Quantity} \times \text{Contents Per Package}$$
* *Example:* 1 pack of Milk Powder containing 1,000 g = **1,000.000 g**.

### Formula 2: 4-Decimal Sub-Cent Unit Cost
$$\text{Unit Cost} = \frac{\text{Purchase Price}}{\text{Package Quantity} \times \text{Contents Per Package}}$$
* *Example (Milk Powder):* $\frac{\text{₱}180.00}{1 \times 1,000\text{ g}} = \mathbf{\text{₱}0.1800 \text{ / g}}$
* *Example (Black Pearl):* $\frac{\text{₱}120.00}{1 \times 1,000\text{ g}} = \mathbf{\text{₱}0.1200 \text{ / g}}$
* *Example (16oz Cups):* $\frac{\text{₱}125.00}{1 \times 50\text{ pcs}} = \mathbf{\text{₱}2.5000 \text{ / pc}}$
* *Example (Ice Cubes):* $\frac{\text{₱}35.00}{1 \times 5,000\text{ g}} = \mathbf{\text{₱}0.0070 \text{ / g}}$

### Formula 3: Menu Recipe Cost of Goods Sold (COGS)
$$\text{Recipe Cost (COGS)} = \sum_{i=1}^{n} \left(\text{Quantity Used}_i \times \text{Unit Cost}_i\right)$$

#### Case Study: Regular (16oz) Milk Tea (Retail Price: ₱40.00)
| Ingredient | Category | Quantity Used | Unit Cost | Line Cost |
| :--- | :--- | :---: | :---: | :---: |
| **16oz Cup** | Packaging & Disposables | 1 pc | ₱2.5000 / pc | ₱2.50 |
| **Milk Powder** | Dairy & Creamers | 30 g | ₱0.1800 / g | ₱5.40 |
| **Black Pearl (Sago)** | Toppings & Add-ons | 40 g | ₱0.1200 / g | ₱4.80 |
| **Ice Cubes** | Store Supplies | 150 g | ₱0.0070 / g | ₱1.05 |
| **TOTAL RECIPE COGS** | | | | **₱13.75** |

### Formula 4: Gross Profit Margin & Food Cost Ratio
$$\text{Gross Profit} = \text{Retail Price} - \text{Recipe Cost (COGS)} = \text{₱}40.00 - \text{₱}13.75 = \mathbf{\text{₱}26.25}$$

$$\text{Gross Profit Margin \%} = \left(\frac{\text{Gross Profit}}{\text{Retail Price}}\right) \times 100\% = \left(\frac{26.25}{40.00}\right) \times 100\% = \mathbf{65.63\%}$$

$$\text{Food Cost Ratio \%} = \left(\frac{\text{Recipe Cost (COGS)}}{\text{Retail Price}}\right) \times 100\% = \left(\frac{13.75}{40.00}\right) \times 100\% = \mathbf{34.38\%}$$

### Formula 5: Total Inventory Asset Valuation
$$\text{Total Asset Value} = \sum_{j=1}^{m} \left(\text{Current Quantity}_j \times \text{Unit Cost}_j\right)$$
* Displayed dynamically in real-time on the Admin Dashboard KPI card and the Inventory Side-Rail.

---

## 📁 Repository Directory Structure

```text
AMAYA/
├── api/                       # Express 5 REST API & backend routes
│   ├── src/
│   │   ├── routes/            # auth, menu, orders, inventory, settings, notifications, archive, decisions, sessions, reports, finances
│   │   ├── utils/             # inventoryUnits.js, costing.js, ledgerService.js, recipeUnitSync.js, wasteMeasurement.js
│   │   ├── migrate.js         # Collation-safe MariaDB migration engine (39 tracked scripts across 001–037)
│   │   └── server.js          # Express app entry & background workers
│   ├── package.json
│   └── .env                   # Local credentials (JWT_SECRET, DB_PASS)
├── database/                  # Schema migrations
│   └── migrations/            # 41 SQL files across 001–037 (39 registered in api/src/migrate.js)
├── dist/                      # Vite production build output (customer & portal)
├── docs/                      # Centralized documentation vault
│   ├── diagrams/              # 10 architectural and flow diagrams
│   ├── LOGICAL_AUDIT_AND_REMEDIATION_LOG.md
│   └── Amayas_Drinks_and_Bites_POS_System_Upgrades_Illustrated.docx
├── public/                    # Static assets & brand media
├── scripts/                   # Desktop tooling & utilities
│   ├── amaya_control_panel.py # v2.0 Tkinter multi-service control panel
│   ├── run-tests.mjs          # Cross-platform Node test discovery runner
│   └── generate_documentation_with_images.py
├── src/                       # React 19 Frontend (Vite 8)
│   ├── apps/                  # CustomerApp.jsx (:5173), PortalApp.jsx (:5174)
│   ├── components/            # Sidebar, Header, Modals, Tooltips
│   ├── context/               # InventoryContext, MenuContext, OrderContext
│   └── pages/                 # Menu, Dashboard, Inventory, Archive, Reports
├── .gitignore                 # Clean gitignore (ignores bytecode, dumps, logs)
├── Start_Amaya_Control_Panel.bat # One-click windowless launcher
├── package.json & lock        # Frontend dependencies
└── vite.config.js             # Dual-mode Vite configuration
```

---

## 🗄️ Database Migrations Registry (001–037, 39 Tracked Scripts / 41 SQL Files)

> `api/src/migrate.js` executes **39** registered migration scripts sequentially across `001` through `037` (with dual `009_*` and `010_*` scripts); `002_expand_images_and_seed_menu.sql` and `021_inventory_item_image.sql` remain legacy unmounted SQL files in `database/migrations/` (**41** SQL files total).

| Migration | Script Name | Key Schema Additions |
| :---: | :--- | :--- |
| **001** | `001_initial_schema.sql` | `users`, `menu_categories`, `menu_products`, `orders`, `order_items`, `inventory_items`, `business_settings` |
| **002** | `002_expand_images_and_seed_menu.sql`<br>`002_expand_product_images_and_seed_menu.sql` | Expanded image URL storage and seeded initial menu catalog |
| **003** | `003_order_inventory_consumptions.sql` | `order_inventory_consumptions` for atomic ingredient deduction tracking |
| **004** | `004_inventory_tracked_addons.sql` | Added `inventory_item_id` foreign key to `product_addons` |
| **005** | `005_persistent_notifications.sql` | `notifications` table for persistent stock & system alerts |
| **006** | `006_inventory_inactivity_alerts.sql` | `inventory_inactivity_states` for 30-day stale stock monitoring |
| **007** | `007_recipe_unit_conversions.sql` | Multi-dimensional recipe unit translation support |
| **008** | `008_size_specific_recipes.sql` | `product_size_ingredients` for serving-size recipe configurations |
| **009** | `009_archive_and_audit_logs.sql`<br>`009_replace_minimum_with_maximum_stock.sql` | `is_archived`, `archive_audit_logs` 30-day trash recovery; `maximum_stock` refactor |
| **010** | `010_archive_inventory_items.sql`<br>`010_inventory_pricing_and_costing.sql` | Archive support for inventory items; 4-decimal purchase packaging & unit costing |
| **011** | `011_inventory_unit_precision.sql` | 6-decimal precision for inventory culinary unit conversions |
| **012** | `012_repair_archive_schema.sql` | Schema repair for archive audit logging and trash triggers |
| **013** | `013_cost_snapshots_and_unit_cost_precision.sql` | Order cost snapshots (`unit_cost_snapshot`, `line_cost`) and weighted-average restock |
| **014** | `014_cups_category_and_table.sql` | Cups inventory category classification and cup sizing tables |
| **015** | `015_user_token_version.sql` | `token_version` for instant JWT session revocation on password change |
| **016** | `016_seed_9_menu_categories.sql` | Seeded 9 store menu categories |
| **017** | `017_seed_23_store_products_and_ingredients.sql` | Seeded 23 initial store products with recipe ingredients |
| **018** | `018_seed_full_recipes_and_packaging_from_docx.sql` | Seeded full recipes and packaging specs from client document |
| **019** | `019_inventory_categories_and_operational_families.sql` | Categorization and operational families for inventory items |
| **020** | `020_dynamic_inventory_categories_and_reset_readiness.sql` | Dynamic inventory categories and clean reset readiness |
| **021** | `021_cashier_management_and_order_attribution.sql`<br>`021_inventory_item_image.sql` | Multi-user cashier accounts, shared 'staff' login, order attribution & item images |
| **022** | `022_repair_operational_family.sql` | Operational family schema repairs and fallback alignment |
| **023** | `023_repair_login_display_name.sql` | Display name resolution for staff and cashier logins |
| **024** | `024_repair_inventory_categories.sql` | Inventory categories sync and collation alignment |
| **025** | `025_migration_sync_and_drift_reconciliation.sql` | Idempotent constraint and column reconciliation across migrations |
| **026** | `026_order_audit_void_and_addon_cogs.sql` | Non-destructive order void, audit log, addon COGS, and status timeline |
| **027** | `027_structured_inventory_movements.sql` | Structured inventory movements ledger (`inventory_movements`) |
| **028** | `028_cashier_sessions.sql` | Cashier shift management, opening cash fund, and shift reconciliation |
| **029** | `029_business_settings_target_food_cost_check.sql` | MariaDB `CHECK` constraint `chk_business_settings_target_food_cost` (`0.1000`–`0.9000`) |
| **030** | `030_double_entry_financial_management_system.sql` | `chart_of_accounts` (17 initial GL accounts `1010`–`6040`), `journal_entries`, `journal_entry_lines`, `view_account_balances`, `store_daily_asset_snapshots` |
| **031** | `031_financial_ledger_integrity.sql` | `idempotency_key` (`uq_je_idempotency_key`), `uq_je_reverses_entry_id`, and composite lookup indexes |
| **032** | `032_expand_business_settings.sql` | VAT rate/toggle, discount presets, shift gate, stock alert thresholds, and `orders` discount/tax columns |
| **033** | `033_allow_partial_reversals.sql` | Drops 1-to-1 `uq_je_reverses_entry_id` and adds `idx_je_reverses_entry_id` for partial item-revert reversals |
| **034** | `034_inventory_waste_logging_metadata.sql` | Zero-guesswork waste tracking columns (`waste_reason`, `measurement_method`, `tare_weight`, `client_request_id`, `reversed_by_movement_id`) |
| **035** | `035_waste_measurement_precision_and_scoping.sql` | Aligns waste numeric precision (`DECIMAL(16,6)`) and actor-scoped `(user_id, client_request_id)` uniqueness |
| **036** | `036_income_statement_classification_and_accounts.sql` | Adds `report_section` + `expense_group` on `chart_of_accounts`, moves `6030` to `cogs`, seeds `6120`/`6130`/`6140`/`6144`/`6172` (22 GL accounts total), widens `movement_type` ENUM with `'internal_use'` |
| **037** | `037_income_statement_phase2_missing_items.sql` | Seeds 20 Phase 2 COA accounts (`1520`, `2030`, `6111–6113`, `6131–6134`, `6141–6143`, `6150`, `6160`, `6171/6173/6174/6179`, `6210`, `6310` — **42 active accounts total**), widens `journal_entries.entry_type` ENUM to 13 types (`ap_settlement`, `depreciation`, `income_tax`), creates `financial_payables` subledger, and adds `journal_entries.payable_id` |

---

## ⚙️ Local Setup & Quickstart Guide

### Method A: One-Click GUI Launcher (Recommended)
1. Double-click **`Start_Amaya_Control_Panel.bat`** in the project root.
2. The Control Panel automatically checks prerequisites, verifies `.env`, starts XAMPP MySQL (:3306), and provides one-click buttons to launch the API and Web apps.

### Method B: Manual CLI Execution

#### 1. Database Setup
Ensure XAMPP MySQL or MariaDB is running on port `3306`. Create an empty database:
```sql
CREATE DATABASE amaya CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

#### 2. Backend API Setup
```powershell
cd api
npm install
npm run db:migrate
npm run dev
```
* API runs at `http://localhost:3001` (Health check: `http://localhost:3001/api/health`).

#### 3. Frontend Web Setup
In the project root:
```powershell
npm install

# Run Customer Showcase (Public Menu)
npm run dev:customer
# Accessible at http://localhost:5173

# Run Staff POS & Admin Portal
npm run dev:portal
# Accessible at http://localhost:5174
```

---

## 🔑 Accounts & Role Access (CLI-Provisioned)

> `001_initial_schema.sql` intentionally creates an empty `users` table. Provision accounts via `cd api && npm run user:create -- <admin|staff> <username>` or manage cashiers with `npm run accounts`.

| Account Type | Login Username | Role | Notes & Default Redirect |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin` | `admin` | Full Dashboard, Inventory, Reports, & Financial Center (`/admin`) |
| **Cashier / Staff** | `staff` | `staff` | Shared `'staff'` username after Migration `021` (legacy `juan` was migrated to `'staff'` / `Cashier 1`); password selects the active cashier (`/staff/menu`) |

---

## 👥 Project Team & Contributors

* **Ken ([@Fushitowa](https://github.com/Fushitowa))** — *Lead Developer & Repository Maintainer* (End-to-end development, system architecture, frontend and backend implementation, feature integration, and repository maintenance)
* **Markie** — *Helper & Contributor* (Inventory Pricing Calculations, UI Layout Refinements, Desktop Tooling, and System Utilities)
* **Louie** — *Project Planner & Strategy Contributor* (Project planning, marketing strategies, and financial planning)
