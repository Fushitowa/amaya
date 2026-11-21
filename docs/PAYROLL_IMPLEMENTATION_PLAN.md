# AMAYA Payroll (Labor and Payroll) — Implementation Plan

Plan date: 2026-11-21 (revised after review) · Scope: staff list, salary / wages / overtime, payroll runs, 13th month, owner's pay, and how they feed the dashboard, reports, finance and budgets.

Status key: ✅ Done · ⏳ Open · 🟡 Partly done. Update the **Status** column and add the commit as tasks land.

---

## 0. Build order at a glance

```
Phase 1  Foundation        accounts + staff list + budget fix          (no manual-expense block yet)
Phase 2  Payroll engine    rates, runs, approve, pay, void, 13th month, owner's pay
Phase 3  Connect           dashboard, reports, budget auto-fill, PIN lock
Phase 3B Operating costs   utilities, occupancy, marketing to the restaurant standard (USAR)
Phase 4  Later             out of scope
```

Rules of the order:
- Each phase is shippable on its own and leaves the app working.
- **The manual-expense block (old P1.4) now ships in Phase 2, together with Approve**, so the owner is never left without a way to record salaries.
- Migrations run in number order: 047 → 048 → 049 → 050 → 051.
- Phase 3B can be built before or after Phase 3, but its dashboard tiles (O3.8) share the dashboard work in P3.3, so build them together.

---

## 1. Rules we follow

| Rule | What it means in AMAYA |
|---|---|
| A sole proprietor cannot pay themselves a salary. Owner money is **Owner's Drawings** (equity), not an expense. | Owner is never on payroll. Owner's pay posts `owner_withdrawal` (Dr 3020 / Cr cash). Lowers equity and cash, not net income. |
| Employee master file is separate from system logins. | New `employees` table. A POS login can be linked, but crew without logins can still be paid. |
| Pay basis (monthly / daily / hourly) is stored per employee. | **Salary** = monthly-rated. **Wages** = daily/hourly × days/hours. **Overtime** = hours over 8/day at +25%. |
| Daily equivalent uses a per-employee divisor. | Default 313 (6-day week). 261 for a 5-day week. Hourly = daily ÷ 8. Stored on the employee. |
| Rate changes keep history. | `employee_pay_rates` with `effective_from`; payroll lines snapshot the rate. |
| Semi-monthly cut-offs (1–15, 16–end), itemized payslip. | One run per cut-off. Payslip lists rate, days/hours, OT, each deduction, net pay. |
| 2026 contributions: SSS 15% of MSC (ER 10% + EC ₱10/₱30, EE 5%, MSC ₱5k–₱35k); PhilHealth 5% split 2.5/2.5 (base ₱10k–₱100k); Pag-IBIG 2% each, fund salary capped ₱10k (max ₱200 each). | Kept in one rates file with an effective year. Whether the monthly amount is split per cut-off or taken once a month is a **setting** (default: split half). |
| Withholding tax on compensation. | Start with exempt below ₱20,833/month and TRAIN brackets above it, in the rates file. |
| 13th month = basic pay earned in the year ÷ 12, due by Dec 24 (PD 851). | Accrued every run (basic ÷ 12) into 2045. Paid out in December, pro-rated for resignations. |
| Accrue first, pay later. Errors are reversed, never edited. | **Approve** posts expense + payables. **Pay** clears the payable from cash. **Void** posts a reversal. |
| Payroll expense is entered only through payroll. | Manual expense form refuses payroll accounts and points to Payroll Runs. Staff Meals stays manual. |
| Money handling. | DECIMAL columns. Round each line to 2 decimals, then sum lines for journal totals so entries always balance. |

---

## 1B. Operating costs standard (researched 2026-11-21)

AMAYA follows the **Uniform System of Accounts for Restaurants (USAR)**, the National Restaurant Association's standard chart of accounts that most restaurant operators, and their accountants, use. Chains report the same way: McDonald's splits company-operated restaurant costs into *food & paper*, *payroll & employee benefits*, and *occupancy & other operating expenses*.

**USAR income statement order:**

```
Sales
− Cost of sales (food, beverage, packaging)            ← COGS
− Labor (salaries & wages + employee benefits)          ← Phase 1–2
= PRIME COST  (cost of sales + labor)
− Controllable operating expenses
    Direct operating · Marketing · Utilities · General & administrative · Repairs & maintenance
= CONTROLLABLE INCOME      ← what the manager can influence
− Non-controllable expenses
    Occupancy (rent, building insurance, property taxes) · Equipment leasing · Depreciation
= RESTAURANT OPERATING INCOME
− Interest, other, income tax
= NET INCOME
```

**What goes where (USAR detail version):**

| USAR group | Sub-accounts | Controllable? |
|---|---|---|
| **Utilities** | Electricity · Gas (LPG) · Other fuel · Trash removal · Water & sewage | Yes |
| **General & administrative** | **Telephone & communications (internet)** · Bank & card charges · **Cash (over)/short** · Licenses & permits · Professional services · Liability insurance | Yes |
| **Marketing** | Advertising · Promotions · Public relations | Yes |
| **Occupancy** | Rent (fixed / % of sales) · Common area maintenance · Building insurance · Real property tax | **No** |
| **Depreciation** | Equipment, furniture, leasehold improvements | No |

**Benchmarks (share of net sales):**

| Measure | Target | Source |
|---|---|---|
| Prime cost (COGS + labor) | ≤ 60% (65%+ leaves almost no profit) | Toast / NRA |
| Utilities | 3–5% (coffee-shop examples 3–4%) | HigherMe, Stackrows |
| Occupancy | 6–10% (NRA 2024 limited-service median 5.2%; cafés often 8–15%) | NRA via AlstigInc, The Fork CPAs |
| McDonald's company-operated (2003) | food & paper 33.7% · payroll 26.4% · occupancy & other 25.4% · margin 14.5% | McDonald's SEC filings |

**Recording rule (accrual):** a utility cost belongs to the month the power, water or gas was **used**, not the month the bill arrives. Restaurant software (e.g. Restaurant365) stores each bill's **service period** and splits it across months by days. When a bill is late, the month is estimated as *last bill ÷ its days × days in this month* and replaced by the real bill later.

**What AMAYA has today vs the standard** (investigated 2026-11-21; the live `amaya` DB has no utility, rent or marketing records yet):

| Item | Today | Standard | Gap |
|---|---|---|---|
| Electricity 6131, Water 6132, LPG 6133 | Under Utilities ✅ | Utilities | — |
| Internet 6134 | Under Utilities | **G&A → Telephone & communications** | Reclassify |
| Trash / garbage collection | Missing | Utilities | Add account |
| 6130 "Utilities (general)" | No page; only in the folder total; Budget Overview total leaves it out | Utilities | Add "Other Utilities" page; fix the total |
| Recording on the "Utilities" total page | Posts to **6020 "Utilities & Rent" (legacy)** | Never mix rent with utilities | Post to 6130 |
| Rent 6120 | In P&L as opex; **no page, no budget** | **Occupancy (non-controllable)** | Add Occupancy section + pages |
| Advertising 6150 | In P&L; **no page, no budget** | Marketing | Add page |
| Cash drawer discrepancy 6040 | "Others" | G&A → Cash (over)/short | Regroup |
| P&L layout | One "Operating expenses" block | Controllable → Controllable income → Occupancy | Restructure |
| Dashboard | Sales, COGS, gross profit only | Prime cost, utilities %, occupancy %, controllable income | Add tiles |
| Utility bills | One amount, dated when typed | Service period, accrual, provider, meter reading | Add bill fields |

---

## 2. How it connects (verified against the code)

Every money screen reads the same journal ledger, so payroll posted there appears everywhere.

| Module | Payroll shows up? | Change needed |
|---|---|---|
| P&L, net income, daily close | ✅ under Labor & Payroll once new accounts use that group | Seed accounts only |
| Balance Sheet | ✅ any `liability` account | Display labels in `coaConstants.js` |
| Cash Flow | ✅ payouts are `ap_settlement` → operating; owner's pay → financing | Optional "Payroll paid" line |
| Payables (`financial_payables`) | ❌ CHECK allows only 2010/2030 | Widen in migration 047 |
| Budget Health / category pages | 🟡 only `operating_expense`, matched by tag or account code | Give each child its own account; parent = sum of children |
| Admin Dashboard, Staff Performance | ❌ no labor | Add labor cost, labor %, prime cost, sales per labor hour |
| Net Income PIN lock | 🟡 | Add new labor KPI keys to `LOCKED_SUMMARY_KEYS` |
| Owner's pay | ✅ `owner_withdrawal` already supported | UI only |

---

## 3. Ledger design

### Accounts (migration 047)

| Code | Name | Type | P&L group |
|---|---|---|---|
| 6111 | Salaries (Monthly-rated Staff) — renamed from "Salaries, Wages & Overtime" | expense | Labor & Payroll |
| 6115 | Wages (Daily / Hourly Staff) | expense | Labor & Payroll |
| 6116 | Overtime & Premium Pay | expense | Labor & Payroll |
| 6114 | 13th Month Pay | expense | Labor & Payroll |
| 6112 | Employer Contributions — existing | expense | Labor & Payroll |
| 6113 | Staff Meals — existing, unchanged | expense | Labor & Payroll |
| 2040 | Salaries & Wages Payable | liability | balance sheet |
| 2045 | 13th Month Pay Payable | liability | balance sheet |
| 2050 | SSS / PhilHealth / Pag-IBIG Payable | liability | balance sheet |
| 2060 | Withholding Tax on Compensation Payable | liability | balance sheet |

Old 6111 entries stay put and read as Salary. Nothing is rewritten. Note in the migration: past expenses tagged "overtime" that were booked to 6111 will read as Salary.

### Entries

```
APPROVE RUN  (entry_type = operating_expense, dated period end)
  Dr 6111 Salaries            basic pay, monthly-rated staff
  Dr 6115 Wages               basic pay, daily/hourly staff
  Dr 6116 Overtime            OT + premiums
  Dr 6112 Employer contrib.   SSS ER + EC + PhilHealth ER + Pag-IBIG ER
  Dr 6114 13th Month          basic ÷ 12
    Cr 2040 Salaries Payable  total net pay
    Cr 2050 Gov't Payable     employee + employer shares
    Cr 2060 Withholding Tax   tax withheld
    Cr 2045 13th Month Payable
  (no other_deductions in this scope — see decision D1)

PAY STAFF  (ap_settlement, payable category 'payroll')
  Dr 2040  /  Cr 1010 Cash Drawer | 1020 GCash | 1030 Bank

PAY 13TH MONTH  (ap_settlement, December)
  Dr 2045  /  Cr cash account

REMIT  (existing payables settle screen)
  Dr 2050 or 2060  /  Cr 1030 Bank

OWNER'S PAY  (owner_withdrawal)
  Dr 3020 Owner's Drawings  /  Cr cash account

VOID  (reversal)
  Mirror of the approve entry. Dated today if the original period is closed, otherwise the original date.
```

### Decisions locked in (from review)

| ID | Decision |
|---|---|
| D1 | `other_deductions` is **removed from this scope** (cash advances / loans are Phase 4). Keeps the entry balanced: gross − EE shares − tax = net pay. |
| D2 | **Payable granularity:** one payable per bucket per run (net pay, gov't, tax, 13th). Per-employee pay settles it partially. |
| D3 | **Single source of truth for "paid":** `financial_payables.paid_amount`. `payroll_lines.paid_at` is written in the same transaction and is display only. |
| D4 | **One live run per period:** unique key on non-voided `(period_start, period_end)` plus an overlap check. |
| D5 | **Proration:** monthly-rated staff who start or leave mid-period are prorated by days worked ÷ working days in the period. |
| D6 | **Access:** payroll pages are owner/admin only. TIN is stored encrypted, masked in the UI. Rate history and payroll totals sit behind the Net Income PIN. |

---

## 4. Data model

| Table | Key columns |
|---|---|
| `employees` | `id`, `user_id` (nullable, unique → POS login), `full_name`, `position`, `employment_status`, `pay_basis`, `daily_divisor` (default 313), `start_date`, `end_date`, `status`, `sss_no`, `philhealth_no`, `pagibig_no`, `tin` (encrypted), `is_archived`, audit columns |
| `employee_pay_rates` | `employee_id`, `rate`, `effective_from`, `set_by`, `created_at` (history; never updated) |
| `payroll_runs` | `period_start`, `period_end`, `pay_date`, `status` (draft / approved / paid / voided), totals, `accrual_journal_entry_id`, `approved_by/at`, `voided_by/at`; unique non-voided period |
| `payroll_lines` | `run_id`, `employee_id` (unique pair), snapshots of `pay_basis` + `rate` + `daily_divisor`, `days_worked`, `hours_worked`, `ot_hours`, `basic_pay`, `ot_pay`, `gross_pay`, EE shares (`sss_ee`, `philhealth_ee`, `pagibig_ee`), `withholding_tax`, `net_pay`, ER shares (`sss_er`, `ec_er`, `philhealth_er`, `pagibig_er`), `thirteenth_month_accrual`, `paid_at`, `payment_channel`, `payment_journal_entry_id` |
| `financial_payables` (changed) | `bill_category` adds `payroll`, `statutory`; `liability_account_code` CHECK adds 2040, 2045, 2050, 2060 |
| `business_settings` (changed) | `target_labor_cost` (default 0.30, bounded like `target_food_cost`), `payroll_frequency` (semi_monthly), `contribution_split` (per_cutoff / monthly) |

---

## 5. Phases and tasks

### Phase 1 — Foundation ✅
**Goal:** new accounts exist, staff can be listed and edited, budget stops double-counting. No behavior is taken away from the user yet.

| ID | Task | Files | Depends on | Status |
|---|---|---|---|---|
| P1.1 | Migration 047: new accounts, rename 6111, widen payable CHECK/enum, new category slugs (`government-contributions`, `thirteenth-month`) | `database/migrations/047_payroll_accounts.sql`, `api/src/migrationList.js` | — | ✅ (uncommitted) |
| P1.2 | Balance sheet labels for 2040/2045/2050/2060 | `api/src/utils/coaConstants.js` | P1.1 | ✅ (uncommitted) |
| P1.3 | Expense nav: salary→6111, wages→6115, overtime→6116, add gov't contributions→6112 and 13th month→6114; drop "shared account" notes | `shared/expenseNavigation.js`, `src/components/ExpenseBudgetBoard.jsx` | P1.1 | ✅ (uncommitted) |
| P1.4 | Budget Health: parent spend = sum of its children only | `api/src/routes/finances.js` | P1.3 | ✅ (uncommitted) |
| P1.5 | Migration 048: `employees`, `employee_pay_rates` | `database/migrations/048_employees.sql` | — | ✅ (uncommitted) |
| P1.6 | Staff API: list, add, edit, change rate (new history row), resign/archive, link POS login. Admin only, TIN encrypted | `api/src/routes/payroll.js`, `api/src/server.js` | P1.5 | ✅ (uncommitted) |
| P1.7 | **Staff page**: list, Add Employee form, rate history, IDs masked | `src/pages/admin/AdminStaff.jsx`, `src/apps/PortalApp.jsx`, `src/components/Sidebar.jsx` | P1.6 | ✅ (uncommitted) |

**Notes from the build:** the one-owner rule for untagged records applies to every category, not only labor (it also fixes the shared 6160 Repairs account). The category tree now lives in `shared/expenseNavigation.js` (`EXPENSE_NAV_TREE`) and the sidebar and budget board read it. The Staff page sits at `/admin/expenses-payroll/staff`, under Expenses and Payroll in the sidebar. Payroll payables 2040–2060 are refused in manual journal entries. Archiving an employee unlinks their POS login. Gov't IDs use `PAYROLL_DATA_KEY` when set, otherwise a key derived from `JWT_SECRET`. Tests: `tests/expenseBudgetNoDoubleCount.test.js`, `tests/payrollStaff.test.js` (covers the access test planned as `payrollAccess.test.js`).

**Done when:** 047/048 run clean on a copy of the DB; P&L still totals the same as before; budget board shows each labor child once; staff can be added and rate-changed.

### Phase 2 — Payroll engine ✅
**Goal:** a full cycle works: draft → approve → pay → (void), plus 13th month and owner's pay.

| ID | Task | Files | Depends on | Status |
|---|---|---|---|---|
| P2.1 | Rates file (2026 SSS / PhilHealth / Pag-IBIG / withholding, effective year) and pure `computePayrollLine()` with proration (D5) | `shared/payrollRates.js`, `shared/payrollComputation.js` | — | ✅ (uncommitted) |
| P2.2 | Migration 049: `payroll_runs`, `payroll_lines` with the D4 unique key | `database/migrations/049_payroll_runs.sql` | P1.5 | ✅ (uncommitted) |
| P2.3 | Create draft run: active employees, days/hours pre-filled from closed `cashier_sessions` for linked logins, all editable | `api/src/routes/payroll.js` | P2.1, P2.2 | ✅ (uncommitted) |
| P2.4 | **Approve:** lock run, post accrual entry, create the four payables (D2), in one transaction | `api/src/routes/payroll.js`, `api/src/utils/ledgerService.js` | P2.3, P1.1 | ✅ (uncommitted) |
| P2.5 | **Block payroll accounts (6111, 6112, 6114, 6115, 6116) in the manual expense form** with "Use Payroll Runs". Ships in the same release as P2.4 | `api/src/routes/finances.js` (`/expense-records`, `/journal-entries`) | P2.4 | ✅ (uncommitted) |
| P2.6 | **Pay:** per employee or whole run, from cash / GCash / bank. Cash-drawer pay ties to the open shift; verify `sessions.js` expected-cash counts it. Updates payable and line in one transaction (D3) | `api/src/routes/payroll.js`, `api/src/routes/sessions.js` | P2.4 | ✅ (uncommitted) |
| P2.7 | **Pay 13th month** (December): per employee, pro-rated for resignations | `api/src/routes/payroll.js` | P2.4 | ✅ (uncommitted) |
| P2.8 | **Void:** reversal entries + payables voided; only before any payment, otherwise reverse payments first. Reversal date per §3 | `api/src/routes/payroll.js` | P2.6 | ✅ (uncommitted) |
| P2.9 | **Payroll Runs page**, run detail (editable lines while draft), **payslip** print view | `src/pages/admin/AdminPayrollRuns.jsx`, `AdminPayrollRunDetail.jsx`, `src/components/PayslipView.jsx` | P2.3–P2.8 | ✅ (uncommitted) |
| P2.10 | **Owner's Pay** screen under Finances (posts `owner_withdrawal`; states it is not an expense) | `src/pages/admin/AdminFinances.jsx` | — | ✅ (uncommitted) |

**Notes from the build (changes to the plan above):**
- **13th month is tracked per payroll line, not as a payable per run.** It still accrues to 2045 on the balance sheet; the December payout posts Dr 2045 / Cr cash per employee. A payable per run would have meant up to 24 settlement entries per employee. So D2 is now three payables per run: net pay (2040), government contributions (2050), withholding tax (2060).
- **Migration 049 drops the unique key on `financial_payables.incurred_journal_entry_id`** (one accrual entry creates up to three payables) and adds `financial_payables.payroll_run_id`.
- **Payroll needs the Owner PIN.** All run, 13th month and owner's pay routes return 403 `pinRequired` without it (D6).
- **The general ledger screens cannot bypass payroll.** A payroll entry cannot be reversed from Finances → Journal, and the staff net-pay payable cannot be settled from Payables. Gov't contributions and tax are remitted from Payables as planned.
- **Undo exists for payments and for the 13th month** (each posts a reversal), so a run can be voided after mistakes.
- **Contributions are split half per cut-off.** The "deduct monthly in the 2nd cut-off" option moves to P3.1 together with the settings migration.
- **The rate table falls back to the newest year on or before the run** (only 2026 exists). Each run records which table year it used.
- **Owner's Pay is a tab on the Payroll page** (Expenses and Payroll → Payroll), not on Finances. It posts `owner_withdrawal` and lists this year's drawings. Finances keeps its existing Withdraw form.
- **Files:** `api/src/routes/payrollRuns.js`, `api/src/utils/payrollGuards.js`, `src/pages/admin/AdminPayroll.jsx` (one page for runs list, run detail, 13th month and owner's pay, so the PIN unlock carries across them), `src/components/PayslipView.jsx`.
- **Tests:** `tests/payrollComputation.test.js`, `tests/payrollLedgerIntegration.test.js`, `tests/ownerPayDrawings.test.js`; `tests/expenseBudgetNoDoubleCount.test.js` now also checks the manual-entry block.

**Done when:** one test run approves into a balanced entry, P&L Labor & Payroll equals the run, paying clears 2040 and moves cash, void zeroes everything, and the manual form refuses payroll accounts.

### Phase 3 — Connect to dashboard, reports, budget ✅

| ID | Task | Files | Depends on | Status |
|---|---|---|---|---|
| P3.1 | `target_labor_cost` setting beside target food cost (migration 050) | `database/migrations/050_*.sql`, `api/src/routes/settings.js`, `AdminSettings.jsx` | — | ✅ (uncommitted) |
| P3.2 | Financial summary adds `laborCost` (6111–6116), `laborPercent`, `primeCost`, `primeCostPercent`, `salesPerLaborHour` | `api/src/routes/reports.js` | P2.4 | ✅ (uncommitted) |
| P3.3 | Dashboard tiles: Labor % vs target, Prime cost % (goal < 60%) | `src/pages/admin/AdminDashboard.jsx` | P3.1, P3.2 | ✅ (uncommitted) |
| P3.4 | Staff Performance: labor cost, sales per labor hour, profit after wages (linked employees) | `api/src/routes/reports.js`, `AdminReport.jsx` | P3.2 | ✅ (uncommitted) |
| P3.5 | Add labor keys to the Net Income PIN lock list | `api/src/routes/finances.js` | P3.2 | ✅ (uncommitted) |
| P3.6 | Budget auto-fill: Salary = monthly roster; Wages = daily rate × scheduled days; contributions and 13th month computed; ceiling = target labor % × avg net sales of last 3 months; owner edits only OT cap and the % | `api/src/routes/finances.js`, `ExpenseCategoryBudget.jsx` | P1.4, P3.1 | ✅ (uncommitted) |
| P3.7 | Optional "Payroll paid" line in Cash Flow | `api/src/services/financesReportService.js` | P2.6 | ✅ (uncommitted) |

**Notes from the build (changes to the plan above):**
- **Migration 050** (`050_cost_targets_and_payroll_settings.sql`) holds all the targets: `target_labor_cost` (0.30, 5–60%), `target_utilities_cost` (0.05, 1–30%), `target_occupancy_cost` (0.10, 1–40%), `payroll_frequency` (semi-monthly only) and `contribution_split`. The O3.8 targets moved here from 051. Bounds live in `shared/costTargets.js`; Settings → Food cost & stock has a "Running cost targets" group and a "Payroll" group.
- **Contribution split "monthly"** deducts nothing in the 1st cut-off and the month's total, less whatever the 1st cut-off already took, in the 2nd. Each run stores the split it used (`payroll_runs.contribution_split`); drafts follow the current setting, approved runs never change.
- **All labor figures come from the ledger P&L** for the same dates (`api/src/services/laborMetricsService.js`), so the dashboard always matches Finances → Profit & Loss. They ignore the Reports order filters (staff, payment, type).
- **Labor hours** = hours paid in approved / paid runs whose cut-off ends in the range (the same runs whose cost is in the P&L, since the accrual is dated on the last day). Monthly-rated staff count their working days employed less absences × 8; OT hours are added.
- **Staff Performance labor** = employer cost of a line: gross pay + employer contributions + 13th month accrual. Only staff linked to a POS login show it.
- **PIN lock:** `LABOR_LOCKED_KEYS` in `finances.js` are nulled on the P&L, the dashboard summary (`laborLocked: true`) and Staff Performance; the cash-flow "Payroll paid" line hides too. The existing gross-profit figures on the dashboard summary are unchanged.
- **Budget auto-fill** is a panel on the Labor and Payroll page (`src/components/LaborBudgetPlan.jsx`, routes `GET /finances/expense-budgets/labor-plan` and `POST …/labor-plan/apply`, Owner PIN). It writes Salary, Wages, Government Contributions, 13th Month, the Overtime cap, and the Labor and Payroll ceiling. Average net sales count only the last 3 months that had sales.
- **Cash Flow:** "Payroll paid" is shown as "of which" inside OPEX paid (it was already counted there), so totals do not move.
- **Dashboard tiles:** `src/components/CostRatioTiles.jsx`, month to date, on both the desktop and mobile dashboards, with their own PIN button.
- **Tests:** `tests/laborKpis.test.js` (new), more cases in `tests/payrollComputation.test.js` and `tests/netIncomePinGate.test.js`.

**Done when:** dashboard and Staff Performance show labor figures that match the P&L, and all new labor KPIs are hidden while the PIN is locked.

### Phase 3B — Operating costs to the restaurant standard (USAR) ✅
**Goal:** utilities, occupancy and marketing are classified like a real restaurant P&L, every running cost has a page and a budget, utility bills land in the month they were used, and the dashboard shows the standard ratios.

| ID | Task | Files | Depends on | Status |
|---|---|---|---|---|
| O3.1 | Migration 051: add **6135 Trash & Garbage Collection** (Utilities); add **6125 Building Insurance & Real Property Tax**; move **6120 Rent** and 6125 to a new `report_section = 'occupancy'`; reclassify **6134 → "Telephone & Internet" (G&A)**; regroup **6040 → G&A "Cash (Over)/Short"**; new expense-category slugs (`trash-collection`, `other-utilities`, `occupancy`, `rent`, `building-insurance-and-taxes`, `marketing`, `telephone-and-internet`, `cash-over-short`). Older entries are not rewritten | `database/migrations/051_operating_costs_usar.sql`, `api/src/migrationList.js` | — | ✅ (uncommitted) |
| O3.2 | Expense nav to USAR: **Utilities** = Electricity, Water, LPG, Trash Collection, Other Utilities (6130 + legacy 6020); **Occupancy** (new folder) = Rent, Building Insurance & Taxes; **Marketing** page (6150); **G&A** adds Telephone & Internet and Cash Over/Short (read-only: it comes from shift close). A folder's "Record an expense" posts to its general account (Utilities → 6130), never 6020 | `shared/expenseNavigation.js`, `AdminExpenseCategory.jsx` | O3.1 | ✅ (uncommitted) |
| O3.3 | Budget Overview grand total = every page plus each folder's own records (fixes money on 6130 and folder-tagged entries being left out) | `src/components/ExpenseBudgetBoard.jsx` | O3.2 | ✅ (uncommitted) |
| O3.4 | **Utility bill form**: provider (Meralco / water district / LPG supplier), account or meter no., **service period from–to**, optional reading (kWh / m³ / kg), amount, due date, paid now or later. Unpaid → existing AP payable (2010) with the due date. The expense is dated by service period; a bill spanning two months is split by days (Restaurant365 method) | migration 051 (`utility_bills`), `api/src/routes/finances.js`, new `UtilityBillForm.jsx` | O3.1 | ✅ (uncommitted) |
| O3.5 | **Missing-bill estimate**: for each utility with a bill last month but none yet for the month being viewed, show *"Estimated ₱X — bill not in yet"* (last bill ÷ its days × days in month) on Budget Overview and the P&L, **shown, not posted** (decision D7) | `api/src/routes/finances.js`, `ExpenseBudgetBoard.jsx`, `AdminReport.jsx` | O3.4 | ✅ (uncommitted) |
| O3.6 | **LPG from inventory**: when an LPG tank is marked "internal store use" (6133), record the swap date; show cost per day and days per tank | `api/src/routes/inventory.js`, LPG page | O3.2 | ✅ (uncommitted) |
| O3.7 | **P&L in USAR order**: Sales → COGS → Labor → **Prime cost** → controllable expenses by group → **Controllable income** → Occupancy → Depreciation → Operating income → Tax → Net. New keys (`primeCost`, `controllableIncome`, `totalOccupancy`) added to the Net Income PIN lock | `api/src/utils/ledgerService.js` (`summarizeIncomeStatementLines`), `financesReportService.js`, `AdminReport.jsx`, `finances.js` | O3.1, P3.2 | ✅ (uncommitted) |
| O3.8 | **Dashboard tiles** (with P3.3): Utilities % of sales vs target, Occupancy % vs target, Controllable income %. Settings `target_utilities_cost` (default 0.05) and `target_occupancy_cost` (default 0.10), bounded like `target_food_cost` | migration 050/051, `reports.js`, `AdminDashboard.jsx`, `AdminSettings.jsx` | O3.7, P3.1 | ✅ (uncommitted) |
| O3.9 | Utility insight on each utility page: this month vs last month and the same month last year, cost per kWh / m³ when readings exist, and kWh per ₱1,000 of sales | `AdminExpenseCategory.jsx`, `finances.js` | O3.4 | ✅ (uncommitted) |

**Decisions for Phase 3B:**

| ID | Decision |
|---|---|
| D7 | Late-bill estimates are **displayed, not posted**. A small café closes its books monthly from real bills; posting and reversing estimates (full accrual) adds entries the owner must understand. Revisit if an accountant asks for accrual-basis monthly statements. |
| D8 | **Follow USAR over local habit**: Internet is G&A (communications), not a utility; rent is Occupancy, not opex. The sidebar names stay plain ("Telephone & Internet", "Rent") so nobody needs to know the codes. |
| D9 | Older entries keep their account. Only new entries use the new accounts; the legacy 6020 account stays readable under "Other Utilities". |

**Notes from the build (changes to the plan above):**
- **Internet keeps its slug `internet`** (relabelled "Telephone & Internet" and moved under G&A) instead of a new `telephone-and-internet` slug, so older records tagged Internet stay on the same page.
- **6010 "Operating Expenses (OPEX)"** (older records and stock-adjustment offsets) is counted on the Miscellaneous page, so every expense account has a page and the Budget Overview total can equal the P&L.
- **Cash Over/Short** (6040) is a read-only page. Budget Health counts the net (shortages − overages) of shift-close adjustments on 6040 and 6010; everything else counts operating-expense debits as before.
- **Occupancy is still inside `totalOperatingExpenses`** and net income is unchanged. The P&L adds `usarGroups`, `laborCost`, `primeCost`, `controllableExpenses`, `controllableIncome`, `totalOccupancy`, `utilitiesCost` and their percentages.
- **Utility bills:** every month part posts Dr expense / Cr 2010, dated on the part's last day. One AP payable carries the whole bill; "paid already" settles it today (cash drawer payments tie to the open shift). Bills live in `utility_bills` + `utility_bill_parts` (migration 051). A bill can be voided only as a whole (`POST /finances/utility-bills/:id/void`). That reverses its payments and every month part, each reversal dated like its original. The Journal refuses to reverse a single month part. Overlapping bills on the same meter are refused. One bill covers at most 93 days.
- **Late-bill estimate** = latest bill ÷ its days × the days of the month no bill covers yet (not always the whole month). Shown on the Budget Overview, on each utility page and under the P&L. Never posted (D7).
- **LPG (O3.6)** reads the existing Inventory → internal-use movements on 6133. No new table was needed. The LPG page lists swaps, days per tank and cost per day.
- **Files:** `api/src/routes/utilityBills.js` (mounted at `/api/finances/utility-bills`), `shared/utilityBills.js`, `src/components/UtilityBillPanel.jsx`, `src/assets/css/admin/UtilityBills.css`.
- **Tests:** `tests/operatingCostsUsar.test.js`, `tests/utilityBillServicePeriod.test.js`. Older tests that checked the pre-USAR layout (Rent as opex, 6040 under Others, 49 accounts) were updated.

**Done when:** every running-cost account has exactly one page and budget; the Budget Overview total equals the P&L operating expenses for the month; a Meralco bill for Oct 20 – Nov 19 shows about ⅔ in November and ⅓ in October; the P&L reads in USAR order with prime cost and controllable income; dashboard tiles match the P&L and hide while the PIN is locked.

### Phase 4 — Later (not in this scope)
Time-in/out for non-POS staff, holiday and rest-day premiums, night differential, leave credits, **cash advances / loan deductions (`other_deductions`)**, employee self-service payslips, BIR 2316 / alphalist exports.

---

## 6. Tests

| Test file | Covers | Phase |
|---|---|---|
| `tests/payrollComputation.test.js` | Monthly vs daily vs hourly, divisor 313 vs 261, OT +25%, caps (SSS ₱35k MSC, PhilHealth ₱100k, Pag-IBIG ₱10k), split vs monthly deduction, 13th month ÷ 12, mid-period proration, effective-year rate fallback | 2 |
| `tests/payrollLedgerIntegration.test.js` | Approve posts a balanced entry; P&L Labor & Payroll matches the run; balance sheet shows payables; pay clears 2040 and moves cash; 13th month payout; void reverses everything; duplicate/overlapping run rejected; approve and void under concurrency | 2 |
| `tests/expenseBudgetNoDoubleCount.test.js` | Salary, Wages, OT each count their own account once; parent = sum of children | 1 |
| `tests/laborKpis.test.js` | Dashboard labor cost, labor %, prime cost and sales per labor hour equal the P&L; Staff Performance wages and profit after wages; cash-flow payroll line; settings targets; budget auto-fill | 3 |
| `tests/ownerPayDrawings.test.js` | Owner's pay never touches P&L, lowers equity and cash | 2 |
| `tests/payrollAccess.test.js` | Non-admin cannot read staff, rates or runs; TIN never returned unmasked | 1–2 |
| extend `tests/netIncomePinGate.test.js` | New labor KPIs hidden while locked; `primeCost`, `controllableIncome`, `totalOccupancy` hidden while locked | 3 / 3B |
| `tests/operatingCostsUsar.test.js` | Each opex account belongs to one page; Budget Overview total = P&L operating expenses; Utilities folder posts to 6130, never 6020; Rent lands in Occupancy, below Controllable income | 3B |
| `tests/utilityBillServicePeriod.test.js` | Bill dated by service period; a two-month bill is split by days and the parts add up to the bill; an unpaid bill creates an AP payable with its due date; late-bill estimate = last bill ÷ days × days, and is not posted | 3B |

---

## 7. Risks and checks before each release

| Risk | Check |
|---|---|
| Migration widens CHECK constraints | Run 047 against a copy of production data first; confirm old payables still load |
| Cash-drawer payouts skew shift close | Close a test shift after a drawer payroll payment; variance must be 0 |
| Backdated entries into a closed period | Confirm approve/void respect the daily-close behavior; test with a closed period |
| Rate tables change yearly | Rates file has an effective year; the test fails loudly if the year has no table |
| Budget numbers shift after P1.4 | Compare Budget Health before/after on the same month; differences must be the double-count only |

---

## Sources

- Timekeep — Payroll software for PH cafés: https://www.timekeep.ph/blog/payroll-software-philippines
- HR Easily — PH payroll compliance checklist: https://hreasilypro.freshdesk.com/en/support/solutions/articles/72000617899
- LaborCode.ph — Payslip fields: https://laborcode.ph/payslip-sample-philippines-format-template/
- Tax and Accounting Center — Payroll register: https://taxacctgcenter.ph/understanding-the-payroll-register-in-the-philippines/
- CloudCFO PH — Paying yourself as an owner: https://cloudcfo.ph/blog/pay-yourself-business-owner-philippines/
- Xero PH — SSS / PhilHealth / Pag-IBIG employer guide: https://www.xero.com/ph/guides/philhealth-sss-pag-ibig-employer-philippines/
- 2026 contribution tables: https://philippinetaxcalculator.ph/contributions-guide
- Toast / 7shifts — labor % and prime cost benchmarks: https://pos.toasttab.com/blog/on-the-line/restaurant-payroll-percentage
- National Restaurant Association — Uniform System of Accounts for Restaurants, summary and detail income statement: https://www.restaurantowner.com/usar_preliminary_P&L.pdf
- Controllable vs non-controllable expenses (Egan, Introduction to Food Production and Service): https://workforce.libretexts.org/Bookshelves/Food_Production_and_Service/Introduction_to_Food_Production_and_Service_(Egan)/04:_Managing_and_Controlling_Operating_Expenses/4.03:_Managing_and_Controlling_Other_Expenses
- Pease Bell — Restaurant chart of accounts and prime cost: https://www.peasebell.com/insights/restaurant-chart-of-accounts/
- McDonald's 8-K (FY2004 supplemental) — company-operated cost split: https://www.sec.gov/Archives/edgar/data/0000063908/000006390804000007/supplemental.htm
- McDonald's franchise FDD Item 19 summary: https://www.franchisechatter.com/2023/09/25/fdd-talk-mcdonalds-franchise-costs-fees-average-revenues-and-or-profits-2023-review/
- Occupancy cost benchmark (NRA 2024 limited-service data): http://alstiginc.com/articles/restaurant-occupancy-cost-percentage-benchmark
- The Fork CPAs — Ideal rent percentage: https://theforkcpas.com/negotiating-the-ideal-percentage-rent/
- HigherMe — Restaurant monthly expenses (utilities 3–5%): https://higherme.com/blog/restaurant-monthly-expenses-you-need-to-budget-for
- Stackrows — Coffee shop income statement example: https://stackrows.com/blog/coffee-shop-income-statement-example
- Utility bill accruals by service period: https://invoicedataextraction.com/blog/utility-bill-accruals
- Restaurant365 — AP accrual by dates of service: https://docs.restaurant365.com/docs/ap-accrual.md
