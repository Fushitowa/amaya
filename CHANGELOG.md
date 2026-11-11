# 📝 Amaya POS & Sales Management System — Changelog & Engineering Ledger

All notable changes, architectural upgrades, and bug fixes for **Amaya's Drinks and Bites POS & Sales Monitoring System** are documented in this file.

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
  * Zero `/refund/i` matches maintained across all codebase layers.

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
