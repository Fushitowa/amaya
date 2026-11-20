# AMAYA Future-Proofing Audit Tracker

Audit date: 2026-11-20 · Read-only audit of the admin, staff and customer apps, the API, MariaDB/XAMPP and the control panel.
Update the **Status** column as findings are fixed, and add the commit that fixed each one.

**Progress:** 17 of 18 findings fixed · F12 partly fixed (only the owner's Windows service install is left) · F1b and F18 also fixed · Test suite: 174 / 174 passing

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
| F1 | 🔴 CRITICAL | Live DB was missing migrations 043–045 (staff expenses, budgets, Net Income PIN all failed with 500s) | ✅ Fixed | Migrations applied to `amaya` and `amaya_test` after backup `database/backups/pre_migrate_043_045_20261120.sql`. Startup check for pending migrations added in Phase 3 (F1b) |
| F2 | 🟠 HIGH | Staff cash expense not linked to the shift, so closing posted a false shortage and credited cash twice | ✅ Fixed | `ff80468` |
| F3 | 🟠 HIGH | Staff could spend from GCash, Bank or Owner Reserve, and backdate expenses | ✅ Fixed | `ff80468` |

Extra fixes done alongside Phase 0:

| What | Status | Commit |
|---|---|---|
| F18 · Staff expense date went stale after midnight | ✅ Fixed | `ff80468` |
| Net Income ignored depreciation and income tax (overstated profit) | ✅ Fixed | `7bd280a` |
| 11 outdated tests (PIN-gated Net Income, optional waste note, COGS meaning, KPI wording) + new PIN gate test | ✅ Fixed | `db89423` |

---

## Phase 1: Money & database safety ✅ Done (F12 waits on the owner installing the MySQL service)

| ID | Severity | Finding | Where | Fix | Regression test | Status |
|---|---|---|---|---|---|---|
| F11 | 🟠 HIGH | No automated backups (last dump was Nov 13) | whole system | `api/src/backup-db.js` (`npm run db:backup`): verified `mysqldump --single-transaction` into `database/backups/auto/`, rotated (14 daily, 10 per other reason). Control panel takes a daily backup (checked every 30 min), one before every migrate and Vault run (aborts if it fails), and has a 💾 Backup Now button | Tested live: dump verified, daily skip works, panel helper works | ✅ |
| F12 | 🟠 HIGH | MySQL runs as a child of the control panel, so a Windows shutdown or update can hard-kill it | `scripts/amaya_control_panel.py` | Panel now starts MySQL through the `mysql` Windows service when it exists. **Owner action still needed:** install the service (see "How to install MySQL as a Windows service" below) | Reboot, then the error log shows no crash recovery | 🟡 |
| F9 | 🟠 HIGH | UI allows 5 MB images but MariaDB `max_allowed_packet` is 1 MB | `src/utils/imageResize.js`, `api/src/utils/validation.js` | Photos are resized in the browser (≤ 1024 px, WebP/JPEG, ≤ ~370 KB); API rejects data URIs over 850,000 chars with a clear 413 | 11 MB test photo → 419 KB WebP in the browser; 900 KB data URI → 413 | ✅ |
| F4 | 🟡 MEDIUM | Staff expenses have no idempotency key, so a retry double-posts | `api/src/routes/finances.js` (`/expense-records`), `StaffExpenseRecord.jsx` | One `clientRequestId` per expense, reused on retry; server returns the first entry (200, `replayed`) and 409s on a changed payload | Same `clientRequestId` twice gives 1 journal entry | ✅ |
| F7 | 🟠 HIGH | Change-password `409` reveals coworkers' passwords; staff login is password-only | `api/src/routes/auth.js` (`/change-password`) | Owner decision: **the owner sets cashier passwords**. Cashiers get a 403 from self-service change-password (no staff screen used it); login and Switch Cashier stay password-only and fast | A peer's password and a random guess get the same 403 | ✅ |

### How to install MySQL as a Windows service (F12, owner action)

1. Stop MySQL from the Amaya Control Panel and wait for "MySQL shut down cleanly".
2. Close the Amaya Control Panel.
3. Right-click **XAMPP Control Panel** → **Run as administrator**.
4. In the MySQL row, click the red ❌ in the **Service** column → **Yes**. It turns into a green ✔.
5. Open the Amaya Control Panel again and press Start All. Its log should say "Starting MySQL Windows service 'mysql'".
6. Optional: in Windows **Services**, set MySQL's startup type to **Automatic** so it starts with the PC.

Optional extra backup when the panel isn't open (run once in PowerShell, adjust the path):
`schtasks /Create /SC DAILY /ST 22:00 /TN "Amaya DB Backup" /TR "cmd /c cd /d \"%USERPROFILE%\Desktop\SCHOOL CODING\AMAYA\api\" && node src/backup-db.js --reason daily --if-older-than-hours 20"`

## Phase 2: Reliability ✅ Done

| ID | Severity | Finding | Where | Fix | Regression test | Status |
|---|---|---|---|---|---|---|
| F5 | 🟡 MEDIUM | Net Income PIN can be bypassed by subtraction; Trial Balance not gated | `api/src/routes/finances.js`, finance screens | Owner decision: **lock the profit statements**. While locked, the API hides COGS, gross profit, expenses, depreciation, tax, net income, equity and revenue/expense account balances (`profitLocked: true`); Trial Balance returns 403. Sales, cash, assets and liabilities stay visible. Screens show ₱•••••• and a "View Net Income" button | `tests/netIncomePinGate.test.js` checks every field | ✅ |
| F8 | 🟡 MEDIUM | Cashier can revert their own paid Pending order without approval | `api/src/services/ordersReversalService.js`, `OrderDetailsModal.jsx` | Owner decision: **5-minute grace, then approval**. After 5 minutes a coworker's or the owner's password is required (own password doesn't count) | `tests/orderRevertGraceWindow.test.js` | ✅ |
| F13 | 🟡 MEDIUM | Vault Archive & Clean resets AUTO_INCREMENT, so new items reuse old IDs and history points to the wrong items | `api/src/catalog-vault.js` | Removed the AUTO_INCREMENT reset (archive-instead-of-delete not done) | `tests/catalogVaultIdSafety.test.js` (source guard; a live run would wipe the shared test DB) | ✅ |
| F10 | 🟡 MEDIUM | `sql_mode` not strict, so bad values are silently clamped or truncated | `api/src/database.js` | Every API connection sets `STRICT_TRANS_TABLES` (no `my.ini` change or restart needed). It immediately caught 2 tests inserting an invalid category type | `tests/dbStrictMode.test.js` + full suite under strict mode | ✅ |

**Known limit of F5:** the Reports page sales analytics still show COGS and gross profit (needed for menu pricing), and the Expenses pages show spending, so someone with the owner's session could still roughly estimate profit by combining those pages. The formal statements themselves stay locked.

## Phase 3: Hardening ✅ Done

| ID | Severity | Finding | Where | Fix | Regression test | Status |
|---|---|---|---|---|---|---|
| F6 | 🟡 MEDIUM | PIN lockout resets after every lock (about 1 guess/min forever) | `api/src/routes/finances.js`, migration `046`, `NetIncomePinModal.jsx` | Lockouts escalate 5 min → 1 h → 24 h and reset after a correct PIN; new PINs must be 6 digits (existing 4–5 digit PINs still unlock) | `tests/netIncomePinLockout.test.js` | ✅ |
| F14 | 🔵 LOW | Vault writes backup JSON without fsync or read-back before wiping | `api/src/utils/verifiedWrite.js`, `catalog-vault.js` | Temp file, fsync, read back and check row counts, rename; any failure aborts before the wipe | `tests/verifiedWrite.test.js` | ✅ |
| F15 | 🔵 LOW | Archive auto-purge retries un-deletable items every 60 s forever | `api/src/routes/archive.js` | Purge query skips items with order or stock-movement history (kept on purpose) | `tests/archivePurgeHistory.test.js` | ✅ |
| F16 | 🔵 LOW | Control panel port probe floods `mysql_error.log` (15,138 lines, 20 MB) | `scripts/amaya_control_panel.py` (`is_port_open`) | MySQL is checked through the listening-socket table instead of a TCP connection | Measured: 20 old probes added 42 log lines, 20 new checks added 0 | ✅ |
| F17 | 🔵 LOW | Control panel log tabs grow without limit | `scripts/amaya_control_panel.py` (`_append_to_text_widget`) | Keep the newest 5,000 lines per tab | Measured: 5,200 lines appended, 5,000 kept | ✅ |
| F1b | 🔵 LOW | API never checks for pending migrations at startup | `api/src/migrationList.js`, `utils/migrationStatus.js`, `server.js`, control panel | Shared migration list; API logs a warning at startup, `/api/health` returns `pendingMigrations`, panel shows "migration(s) pending" | `tests/migrationStatus.test.js` | ✅ |

---

## Recommended `my.ini` settings (`[mysqld]` section, stop MySQL cleanly before editing)

```ini
innodb_flush_log_at_trx_commit=1   ; already set — keep
innodb_doublewrite=1               ; already on — keep
innodb_buffer_pool_size=256M       ; was 16M
max_allowed_packet=16M             ; was 1M   (F9)
sql_mode=STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION   ; (F10)
log_warnings=1                     ; optional now: F16 fixed the probe spam in the panel
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
