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
