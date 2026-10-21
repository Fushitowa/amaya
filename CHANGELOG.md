# 📝 Amaya POS & Sales Management System — Changelog & Engineering Ledger

All notable changes, architectural upgrades, and bug fixes for **Amaya's Drinks and Bites POS & Sales Monitoring System** are documented in this file.

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
