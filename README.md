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
│   │   ├── routes/            # auth, menu, orders, inventory, archive, reports
│   │   ├── utils/             # inventoryUnits.js (culinary unit conversions)
│   │   ├── migrate.js         # Collation-safe MariaDB migration engine
│   │   └── server.js          # Express app entry & background workers
│   ├── package.json
│   └── .env                   # Local credentials (JWT_SECRET, DB_PASS)
├── database/                  # Schema migrations
│   └── migrations/            # 001 through 010 SQL migration scripts
├── dist/                      # Vite production build output (customer & portal)
├── docs/                      # Centralized documentation vault
│   ├── diagrams/              # 10 architectural and flow diagrams
│   └── Amayas_Drinks_and_Bites_POS_System_Upgrades_Illustrated.docx
├── public/                    # Static assets & brand media
├── scripts/                   # Desktop tooling & utilities
│   ├── amaya_control_panel.py # v2.0 Tkinter multi-service control panel
│   ├── generate_documentation_docx.py
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

## 🗄️ Database Migrations Registry (001–010)

| Migration | Script Name | Key Schema Additions |
| :---: | :--- | :--- |
| **001** | `001_initial_schema.sql` | `users`, `menu_categories`, `menu_products`, `orders`, `order_items`, `inventory_items`, `business_settings` |
| **002** | `002_expand_product_images...sql` | Expanded image URL storage and seeded initial menu catalog |
| **003** | `003_order_inventory_consumptions.sql` | `order_inventory_consumptions` for atomic ingredient deduction tracking |
| **004** | `004_inventory_tracked_addons.sql` | Added `inventory_item_id` foreign key to `product_addons` |
| **005** | `005_persistent_notifications.sql` | `notifications` table for persistent stock & system alerts |
| **006** | `006_inventory_inactivity_alerts.sql` | `inventory_inactivity_states` for 30-day stale stock monitoring |
| **007** | `007_recipe_unit_conversions.sql` | Multi-dimensional recipe unit translation support |
| **008** | `008_size_specific_recipes.sql` | `product_size_ingredients` for serving-size recipe configurations |
| **009** | `009_archive_and_audit_logs.sql` | `is_archived`, `archived_at`, and `archive_audit_logs` for 30-day trash recovery |
| **010** | `010_inventory_pricing_and_costing.sql` | `purchase_price`, `package_quantity`, `package_unit`, `contents_per_package`, `unit_cost` |

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

## 🔑 Default Accounts (In Database)

| Account Type | Username | Password | Role | Default Redirect |
| :--- | :--- | :--- | :--- | :--- |
| **Administrator** | `admin` | `Admin12345678` | `admin` | `/admin` (Full Dashboard, Inventory, Reports) |
| **Staff Member** | `juan` | `Staff12345678` | `staff` | `/staff/menu` (Counter POS & Order Terminal) |

---

## 👥 Project Team & Contributors

* **Ken ([@Fushitowa](https://github.com/Fushitowa))** — *Lead Developer & Repository Maintainer* (Architecture, Base System, and Menu Management)
* **Markie** — *Helper & Contributor* (Inventory Pricing Calculations, UI Layout Refinements, Desktop Tooling, and System Utilities)
