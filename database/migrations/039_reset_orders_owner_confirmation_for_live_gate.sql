-- Migration 039: Reset auto-backfilled orders to unconfirmed so live cashier sales await explicit Owner confirmation.
-- WARNING: One-time destructive data-reset migration. Guarded by api/src/migrate.js
-- (requires ALLOW_DESTRUCTIVE_MIGRATIONS=1 or --allow-destructive if un-noted confirmed orders exist).

UPDATE orders
   SET owner_confirmed_at = NULL,
       owner_confirmed_by = NULL
 WHERE payment_status = 'Paid'
   AND order_status <> 'Cancelled'
   AND owner_confirmation_note IS NULL;
