import "dotenv/config";
import pool from "../database.js";
import {
  postInventoryValuationDelta,
  postOrderSaleAndCogs,
  round2,
} from "../utils/ledgerService.js";

const applyMode = process.argv.includes("--apply");

const connection = await pool.getConnection();
try {
  const [[adminUser]] = await connection.query(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
  );
  if (!adminUser) {
    throw new Error("Cannot run ledger backfill: no admin user found.");
  }
  const systemActorId = Number(adminUser.id);

  // 1. Identify paid, non-cancelled orders missing double-entry postings
  const [unpostedOrders] = await connection.query(
    `SELECT o.id,
            o.order_number,
            o.payment_method,
            o.subtotal,
            o.total,
            o.session_id,
            o.created_by,
            o.paid_at,
            o.created_at,
            COALESCE((SELECT SUM(oic.line_cost) FROM order_inventory_consumptions oic WHERE oic.order_id = o.id AND oic.reversed_at IS NULL), 0) AS inv_cogs,
            COALESCE((
              SELECT SUM(oi.quantity * COALESCE(oi.unit_cost_snapshot, 0))
                FROM order_items oi
               WHERE oi.order_id = o.id
                 AND NOT EXISTS (
                   SELECT 1 FROM order_inventory_consumptions oic2
                    WHERE oic2.order_item_id = oi.id AND oic2.source = 'recipe'
                 )
            ), 0) AS direct_cogs
       FROM orders o
      WHERE o.payment_status = 'Paid'
        AND o.order_status <> 'Cancelled'
        AND NOT EXISTS (
          SELECT 1 FROM journal_entries je
           WHERE je.order_id = o.id
             AND je.entry_type = 'sales_revenue'
        )
      ORDER BY o.id ASC`
  );

  // 2. Preview current inventory valuation vs ledger 1050 balance AFTER orders would post
  const [[invLiveRow]] = await connection.query(
    "SELECT COALESCE(SUM(quantity * unit_cost), 0.00) AS live_val FROM inventory_items WHERE is_archived = FALSE"
  );
  const [[invLedgerRow]] = await connection.query(
    `SELECT COALESCE(v.current_balance, 0.00) AS ledger_val
       FROM chart_of_accounts coa
       LEFT JOIN view_account_balances v ON v.id = coa.id
      WHERE coa.account_code = '1050'
      LIMIT 1`
  );

  const projectedCogsCredit = round2(
    unpostedOrders.reduce((sum, o) => sum + Number(o.inv_cogs || 0) + Number(o.direct_cogs || 0), 0)
  );
  const projectedLedger1050 = round2(Number(invLedgerRow?.ledger_val || 0) - projectedCogsCredit);
  const liveInventoryVal = round2(invLiveRow?.live_val || 0);
  const inventoryGap = round2(liveInventoryVal - projectedLedger1050);

  if (!applyMode) {
    console.log(JSON.stringify({
      mode: "dry-run",
      unpostedPaidOrders: unpostedOrders.length,
      projectedOrderSalesTotal: round2(unpostedOrders.reduce((s, o) => s + Number(o.total || 0), 0)),
      projectedOrderCogsTotal: projectedCogsCredit,
      liveInventoryValuation: liveInventoryVal,
      currentLedger1050: round2(invLedgerRow?.ledger_val || 0),
      projectedInventoryGapToReconcile: inventoryGap,
    }, null, 2));
  } else {
    await connection.beginTransaction();
    try {
      for (const order of unpostedOrders) {
        const orderCogs = round2(Number(order.inv_cogs || 0) + Number(order.direct_cogs || 0));
        await postOrderSaleAndCogs(connection, {
          orderId: Number(order.id),
          orderNumber: order.order_number,
          total: Number(order.total || 0),
          subtotal: Number(order.subtotal ?? order.total ?? 0),
          paymentMethod: order.payment_method || "Cash",
          totalCogs: orderCogs,
          sessionId: order.session_id ? Number(order.session_id) : null,
          entryDate: order.paid_at || order.created_at,
          userId: Number(order.created_by || systemActorId),
        });
      }

      if (Math.abs(inventoryGap) >= 0.01) {
        await postInventoryValuationDelta(connection, {
          itemName: "Historical Inventory Opening Reconciliation",
          deltaValue: inventoryGap,
          entryType: "opening_balance",
          offsetAccountCode: "3010",
          memo: `Backfill reconciliation: align Account 1050 to live inventory valuation (₱${liveInventoryVal.toFixed(2)})`,
          userId: systemActorId,
        });
      }

      await connection.commit();
      console.log(JSON.stringify({
        mode: "applied",
        backfilledOrders: unpostedOrders.length,
        reconciledInventoryGap: inventoryGap,
      }, null, 2));
    } catch (err) {
      await connection.rollback();
      throw err;
    }
  }
} finally {
  connection.release();
  await pool.end();
}
