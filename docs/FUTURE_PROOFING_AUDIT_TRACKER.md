# AMAYA Future-Proofing Audit Tracker

Audit date: 2026-11-20 · Read-only audit of the admin, staff and customer apps, the API, MariaDB/XAMPP and the control panel.
Update the **Status** column as findings are fixed, and add the commit that fixed each one.

**Progress:** 3 of 18 findings fixed (F1, F2, F3) · F18 also fixed · 15 open · Test suite: 159 / 159 passing

Status key: ✅ Fixed · ⏳ Open · 🟡 Partly fixed

---

## Before the audit (same day)

| What | Status | Commit / note |
|---|---|---|
| `amaya.product_ingredients` corrupted (page 0 bad checksum, MySQL crashed on every menu request) | ✅ Repaired | All 20 rows recovered from the healthy data pages; table rebuilt. Original files kept in `C:\xampp\mysql\backup_before_repair_20261120` |
| Control panel force-killed MySQL 10 s after shutdown (root cause of the corruption) | ✅ Fixed | `255aefa` · waits up to 180 s, never `taskkill`s mysqld, never starts a second mysqld |

---

## Phase 0: Emergency ✅ Done

| ID | Severity | Finding | Status | Commit |
|---|---|---|---|---|
| F1 | 🔴 CRITICAL | Live DB was missing migrations 043–045 (staff expenses, budgets, Net Income PIN all failed with 500s) | ✅ Fixed | Migrations applied to `amaya` and `amaya_test` after backup `database/backups/pre_migrate_043_045_20261120.sql`. Startup check for pending migrations still ⏳ (see Phase 3) |
| F2 | 🟠 HIGH | Staff cash expense not linked to the shift, so closing posted a false shortage and credited cash twice | ✅ Fixed | `ff80468` |
| F3 | 🟠 HIGH | Staff could spend from GCash, Bank or Owner Reserve, and backdate expenses | ✅ Fixed | `ff80468` |

Extra fixes done alongside Phase 0:

| What | Status | Commit |
|---|---|---|
| F18 · Staff expense date went stale after midnight | ✅ Fixed | `ff80468` |
| Net Income ignored depreciation and income tax (overstated profit) | ✅ Fixed | `7bd280a` |
| 11 outdated tests (PIN-gated Net Income, optional waste note, COGS meaning, KPI wording) + new PIN gate test | ✅ Fixed | `db89423` |

---

## Phase 1: Money & database safety ⏳ Next

| ID | Severity | Finding | Where | Fix | Regression test | Status |
|---|---|---|---|---|---|---|
| F11 | 🟠 HIGH | No automated backups (last dump was Nov 13) | whole system | Daily `mysqldump --single-transaction`, keep 14 days, plus a dump before every migrate or Vault run | Backup file exists after the scheduled run | ⏳ |
| F12 | 🟠 HIGH | MySQL runs as a child of the control panel, so a Windows shutdown or update can hard-kill it | `scripts/amaya_control_panel.py` | Install XAMPP MySQL as a Windows service | Reboot, then the error log shows no crash recovery | ⏳ |
| F9 | 🟠 HIGH | UI allows 5 MB images but MariaDB `max_allowed_packet` is 1 MB | `src/pages/admin/AdminMenuManagement.jsx:36`, `my.ini` | Resize images to ≤ 300 KB before upload; optionally raise packet to 16M | A 2 MB photo saves; stored length ≤ 400 KB | ⏳ |
| F4 | 🟡 MEDIUM | Staff expenses have no idempotency key, so a retry double-posts | `api/src/routes/finances.js` (`/expense-records`) | `clientRequestId` + `idempotencyKey` | Same `clientRequestId` twice gives 1 journal entry | ⏳ |
| F7 | 🟠 HIGH | Change-password `409` reveals coworkers' passwords; staff login is password-only | `api/src/routes/auth.js:62-87, 240-252` | Login picks the cashier first, then drop the uniqueness check | Changing to a peer's password gives no distinguishable answer | ⏳ |

## Phase 2: Reliability ⏳

| ID | Severity | Finding | Where | Fix | Regression test | Status |
|---|---|---|---|---|---|---|
| F5 | 🟡 MEDIUM | Net Income PIN can be bypassed by subtraction; Trial Balance not gated | `api/src/routes/finances.js` (trial-balance, P&L, balance sheet) | Require the PIN token for the whole P&L, Trial Balance and Balance Sheet | No field lets Net Income be derived without a token | ⏳ |
| F8 | 🟡 MEDIUM | Cashier can revert their own paid Pending order without approval | `api/src/services/ordersReversalService.js:342-371` | Require peer/admin approval for reverts on Paid orders | Staff self-revert without password gives 403 | ⏳ |
| F13 | 🟡 MEDIUM | Vault Archive & Clean resets AUTO_INCREMENT, so new items reuse old IDs and history points to the wrong items | `api/src/catalog-vault.js:396-433` | Never reset AUTO_INCREMENT; archive instead of delete | New item ID is greater than every historical ID | ⏳ |
| F10 | 🟡 MEDIUM | `sql_mode` not strict, so bad values are silently clamped or truncated | `C:\xampp\mysql\bin\my.ini` | Add `STRICT_TRANS_TABLES` (test on `amaya_test` first) | Full suite passes under strict mode | ⏳ |

## Phase 3: Hardening ⏳

| ID | Severity | Finding | Where | Fix | Regression test | Status |
|---|---|---|---|---|---|---|
| F6 | 🟡 MEDIUM | PIN lockout resets after every lock (about 1 guess/min forever) | `api/src/routes/finances.js:88-92` | Escalating lock (5 min → 1 h → 24 h), 6-digit PIN | 15 wrong PINs gives a lock of 1 h or more | ⏳ |
| F14 | 🔵 LOW | Vault writes backup JSON without fsync or read-back before wiping | `api/src/catalog-vault.js:382-383` | Temp file, fsync, parse back, rename, then wipe | Corrupt backup aborts the wipe | ⏳ |
| F15 | 🔵 LOW | Archive auto-purge retries un-deletable items every 60 s forever | `api/src/routes/archive.js:186-207` | Exclude items with order history from the purge query | Purge skips consumed items with no warning | ⏳ |
| F16 | 🔵 LOW | Control panel port probe floods `mysql_error.log` (15,138 lines, 20 MB) | `scripts/amaya_control_panel.py` (`is_port_open`) | `log_warnings=1` in `my.ini` or probe less often | Error log stops growing while idle | ⏳ |
| F17 | 🔵 LOW | Control panel log tabs grow without limit | `scripts/amaya_control_panel.py` (`_append_to_text_widget`) | Keep the last 5,000 lines per tab | Log tab stays ≤ 5,000 lines | ⏳ |
| F1b | 🔵 LOW | API never checks for pending migrations at startup | `api/src/server.js:119` | `/api/health` reports pending migrations | Health shows pending when a migration is unrecorded | ⏳ |

---

## Recommended `my.ini` settings (`[mysqld]` section, stop MySQL cleanly before editing)

```ini
innodb_flush_log_at_trx_commit=1   ; already set — keep
innodb_doublewrite=1               ; already on — keep
innodb_buffer_pool_size=256M       ; was 16M
max_allowed_packet=16M             ; was 1M   (F9)
sql_mode=STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION   ; (F10)
log_warnings=1                     ; stops probe spam (F16)
```

## Recovery runbook (if MySQL won't start again)

1. Read `C:\xampp\mysql\data\mysql_error.log` and find the table it names.
2. Stop MySQL and copy the whole data folder somewhere safe. Never copy it while mysqld is running.
3. One bad table: check page checksums, salvage rows from healthy pages, rebuild the table (what we did on 2026-11-20).
4. Wide damage: use `innodb_force_recovery` 1 → 3 only to `mysqldump`, then restore into a fresh data folder. Never write while in force-recovery mode.

## Checked and safe (no action needed)

Server-side price, discount and VAT recompute · last-item race (row locks) · order double-submit (unique key) · owner sales confirmation uses inspected order IDs · CSV formula injection · no XSS sinks · logout revokes via `token_version` · tests refuse non-`_test` databases · control panel passes passwords via stdin · Free All Ports skips MySQL · PIN stored as bcrypt · JWT pinned to HS256 · ledger balanced (DR = CR).

## Not audited yet

WCAG accessibility pass and live cashier tap-count walkthrough (UI not run) · dashboard hero vs balance sheet math · menu costing parity · unit conversions · waste tracker math · report parity across date filters · notification table growth · deadlocks under real load · fresh install of all 45 migrations.
