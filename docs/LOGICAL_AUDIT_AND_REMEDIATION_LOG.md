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
* **Lint & Build:** ESLint exited with **0 errors, 0 warnings**; dual Vite builds for customer and portal completed cleanly in under 2 seconds. Zero `/refund/i` matches confirmed.
