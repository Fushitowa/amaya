import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import pool from "../database.js";
import { httpError } from "../middleware/auth.js";
import {
  postOrderItemRevertReversal,
  postOrderVoidReversal,
} from "../utils/ledgerService.js";
import { loadOrderByNumber } from "./ordersQueryService.js";

export async function findAuthorizingUser(connection, authPassword, { includeStaff = false, excludeUserId = null } = {}) {
  if (!authPassword) return null;
  const roleClause = includeStaff ? "role IN ('admin', 'staff')" : "role = 'admin'";
  const excludeClause = excludeUserId != null ? " AND id != ?" : "";
  const params = excludeUserId != null ? [Number(excludeUserId)] : [];
  const [candidates] = await connection.execute(
    `SELECT id, username, display_name, password_hash, role
       FROM users
      WHERE is_active = 1 AND ${roleClause}${excludeClause}
      ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, id ASC`,
    params,
  );
  for (const candidate of candidates) {
    if (await bcrypt.compare(authPassword, candidate.password_hash)) {
      return {
        id: Number(candidate.id),
        displayName: candidate.display_name || candidate.username,
        role: candidate.role,
      };
    }
  }
  return null;
}

export async function resolveVoidOrRevertSessionId(connection, order, actorId) {
  if (order?.session_id != null) {
    return Number(order.session_id);
  }
  const [[activeSession]] = await connection.execute(
    "SELECT id FROM cashier_sessions WHERE user_id = ? AND status = 'open' ORDER BY opened_at DESC, id DESC LIMIT 1",
    [actorId],
  );
  return activeSession ? Number(activeSession.id) : null;
}

export async function reverseFullOrderInventoryAndCogs(
  connection,
  {
    order,
    restoreStock,
    reason,
    actorId,
    actorName,
    sessionId,
    restoreNotePrefix = `Voided order ${order.order_number}`,
    spoilageNotePrefix = `Spoilage on voided order #${order.order_number}`,
  },
) {
  const [consumptions] = await connection.execute(
    `SELECT id, inventory_item_id, inventory_item_name_snapshot, quantity_used, unit, line_cost
       FROM order_inventory_consumptions
      WHERE order_id = ? AND reversed_at IS NULL AND order_item_id IS NOT NULL
      ORDER BY inventory_item_id ASC, id ASC
        FOR UPDATE`,
    [order.id],
  );

  const [[directCogsRow]] = await connection.execute(
    `SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.unit_cost_snapshot, 0)), 0) AS direct_cogs
       FROM order_items oi
      WHERE oi.order_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM order_inventory_consumptions oic
           WHERE oic.order_item_id = oi.id
             AND COALESCE(oic.line_cost, 0) > 0
             AND oic.reversed_at IS NULL
        )`,
    [order.id],
  );
  const invCogs = consumptions.reduce((sum, c) => sum + Number(c.line_cost || 0), 0);
  const voidTotalCogs = invCogs + Number(directCogsRow?.direct_cogs || 0);

  const distinctInventoryIds = [...new Set(consumptions.map((c) => Number(c.inventory_item_id)))].sort((a, b) => a - b);
  const runningStockByItem = new Map();
  if (distinctInventoryIds.length) {
    const marks = distinctInventoryIds.map(() => "?").join(",");
    const [lockedInventory] = await connection.execute(
      `SELECT id, name, quantity, unit FROM inventory_items WHERE id IN (${marks}) ORDER BY id FOR UPDATE`,
      distinctInventoryIds,
    );
    for (const inv of lockedInventory) {
      runningStockByItem.set(Number(inv.id), {
        name: inv.name,
        quantity: Number(inv.quantity),
        unit: inv.unit,
      });
    }
  }

  if (restoreStock) {
    for (const consumption of consumptions) {
      const invId = Number(consumption.inventory_item_id);
      const qty = Number(consumption.quantity_used);
      const state = runningStockByItem.get(invId);
      const beforeQuantity = state ? state.quantity : 0;
      const afterQuantity = Math.round((beforeQuantity + qty) * 1000000) / 1000000;
      if (state) state.quantity = afterQuantity;

      await connection.execute("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ?", [qty, invId]);
      await connection.execute(
        `INSERT INTO inventory_movements (
           inventory_item_id, user_id, movement_type, quantity_change, note,
           item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit, order_id, session_id
         ) VALUES (?, ?, 'void_restore', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invId,
          actorId,
          qty,
          `${restoreNotePrefix}: ${reason}`.slice(0, 500),
          state?.name || consumption.inventory_item_name_snapshot,
          actorName,
          beforeQuantity,
          afterQuantity,
          state?.unit || consumption.unit,
          order.id,
          sessionId,
        ],
      );
      await connection.execute("UPDATE order_inventory_consumptions SET reversed_at = CURRENT_TIMESTAMP WHERE id = ?", [consumption.id]);
    }

    const [nonRecipeItems] = await connection.execute(
      `SELECT oi.product_id, SUM(oi.quantity) AS quantity
         FROM order_items oi
        WHERE oi.order_id = ?
          AND oi.product_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM order_inventory_consumptions oic
             WHERE oic.order_item_id = oi.id AND oic.source = 'recipe'
          )
        GROUP BY oi.product_id
        ORDER BY oi.product_id ASC`,
      [order.id],
    );
    for (const item of nonRecipeItems) {
      await connection.execute(
        "UPDATE menu_products SET stock_quantity = stock_quantity + ? WHERE id = ?",
        [Number(item.quantity), item.product_id],
      );
    }
  } else {
    for (const consumption of consumptions) {
      const invId = Number(consumption.inventory_item_id);
      const state = runningStockByItem.get(invId);
      const currentQty = state ? state.quantity : 0;
      await connection.execute(
        `INSERT INTO inventory_movements (
           inventory_item_id, user_id, movement_type, quantity_change, note,
           item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
           batch_cost, order_id, session_id
         ) VALUES (?, ?, 'spoilage', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invId,
          actorId,
          `${spoilageNotePrefix}: ${reason}`.slice(0, 500),
          state?.name || consumption.inventory_item_name_snapshot,
          actorName,
          currentQty,
          currentQty,
          state?.unit || consumption.unit,
          Number(Number(consumption.line_cost || 0).toFixed(2)),
          order.id,
          sessionId,
        ],
      );
    }
  }

  await postOrderVoidReversal(connection, {
    orderId: order.id,
    orderNumber: order.order_number,
    restoreStock,
    totalCogs: voidTotalCogs,
    reason,
    sessionId,
    userId: actorId,
  });
}

export async function findMatchingOrderItemRevertReplay(
  executor,
  { actorId, cleanClientRequestId, orderNumber, itemId, restoreStock, requestedQty, includeCost },
) {
  if (!cleanClientRequestId) return null;
  const [[existingRev]] = await executor.execute(
    `SELECT r.*, o.order_number,
            COALESCE(NULLIF(au.display_name, ''), au.username) AS auth_display_name,
            au.role AS auth_role
       FROM order_item_reversals r
       JOIN orders o ON o.id = r.order_id
       LEFT JOIN users au ON au.id = r.authorized_by
      WHERE r.user_id = ? AND r.client_request_id = ?
      LIMIT 1`,
    [actorId, cleanClientRequestId],
  );
  if (!existingRev) return null;
  const reqQty = requestedQty == null ? null : Number(requestedQty);
  if (
    existingRev.order_number !== orderNumber ||
    Number(existingRev.order_item_id_snapshot) !== Number(itemId) ||
    Boolean(existingRev.restore_stock) !== restoreStock ||
    (reqQty !== null && Number(existingRev.reverted_quantity) !== reqQty)
  ) {
    throw httpError(409, "Client request ID was already used for a different item revert.");
  }
  const replayedOrder = await loadOrderByNumber(orderNumber, {
    includeCost,
    includeDetails: true,
  });
  return {
    ...replayedOrder,
    authorizedBy: existingRev.authorized_by
      ? {
          id: Number(existingRev.authorized_by),
          displayName: existingRev.auth_display_name || "Authorizer",
          role: existingRev.auth_role || "staff",
        }
      : null,
  };
}

export async function executeVoidOrder({ orderNumber, reason, restoreStock, actorId, actorName }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.execute(
      "SELECT id, order_number, order_status, session_id FROM orders WHERE order_number = ? FOR UPDATE",
      [orderNumber],
    );
    if (!order) throw httpError(404, "Order not found.");
    if (order.order_status === "Cancelled") {
      throw httpError(409, "This order has already been voided.");
    }

    const sessionId = await resolveVoidOrRevertSessionId(connection, order, actorId);

    await connection.execute(
      `UPDATE orders
          SET order_status = 'Cancelled',
              voided_by = ?,
              voided_at = CURRENT_TIMESTAMP,
              void_reason = ?
        WHERE id = ?`,
      [actorId, reason, order.id],
    );
    await connection.execute(
      `INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, actor_name_snapshot, reason)
       VALUES (?, ?, 'Cancelled', ?, ?, ?)`,
      [order.id, order.order_status, actorId, actorName, reason],
    );

    await reverseFullOrderInventoryAndCogs(connection, {
      order,
      restoreStock,
      reason,
      actorId,
      actorName,
      sessionId,
    });

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  return loadOrderByNumber(orderNumber, {
    includeCost: true,
    includeDetails: true,
  });
}

export async function executeOrderItemRevert({
  orderNumber,
  itemId,
  reason,
  authPassword,
  restoreStock,
  requestedQty,
  cleanClientRequestId,
  actorId,
  actorName,
  actorRole,
}) {
  const includeCost = actorRole === "admin";
  const preReplay = await findMatchingOrderItemRevertReplay(pool, {
    actorId,
    cleanClientRequestId,
    orderNumber,
    itemId,
    restoreStock,
    requestedQty,
    includeCost,
  });
  if (preReplay) {
    return preReplay;
  }

  const connection = await pool.getConnection();
  let authorizingUser = null;
  let txOpen = false;
  try {
    await connection.beginTransaction();
    txOpen = true;
    const [[order]] = await connection.execute(
      `SELECT id, order_number, order_status, payment_status, payment_method, subtotal, discount_amount, tax_amount, total, cash_tendered, change_due, owner_confirmed_at, created_by, session_id
         FROM orders
        WHERE order_number = ?
          FOR UPDATE`,
      [orderNumber],
    );
    if (!order) throw httpError(404, "Order not found.");
    if (order.order_status === "Cancelled") {
      if (cleanClientRequestId) {
        await connection.rollback();
        txOpen = false;
        const raceReplay = await findMatchingOrderItemRevertReplay(pool, {
          actorId,
          cleanClientRequestId,
          orderNumber,
          itemId,
          restoreStock,
          requestedQty,
          includeCost,
        });
        if (raceReplay) return raceReplay;
      }
      throw httpError(409, "Cancelled orders cannot be modified.");
    }

    if (actorRole !== "admin" && order.owner_confirmed_at != null) {
      authorizingUser = await findAuthorizingUser(connection, authPassword, { includeStaff: false });
      if (!authorizingUser) {
        throw httpError(403, "This order's sales have already been confirmed by the Owner. Only an admin may revert items on an owner-confirmed order.");
      }
    } else if (actorRole !== "admin" && order.order_status !== "Pending") {
      authorizingUser = await findAuthorizingUser(connection, authPassword, {
        includeStaff: true,
        excludeUserId: actorId,
      });
      if (!authorizingUser) {
        throw httpError(403, "Enter a valid staff or admin password to authorize reverting an item after preparation starts.");
      }
    } else if (
      actorRole !== "admin" &&
      order.order_status === "Pending" &&
      order.created_by != null &&
      Number(order.created_by) !== Number(actorId)
    ) {
      authorizingUser = await findAuthorizingUser(connection, authPassword, {
        includeStaff: true,
        excludeUserId: actorId,
      });
      if (!authorizingUser) {
        throw httpError(
          403,
          "Only the cashier who created this Pending order or an authorizing peer/admin may revert its items.",
        );
      }
    }

    const [allItems] = await connection.execute(
      "SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC FOR UPDATE",
      [order.id],
    );
    const targetItem = allItems.find((r) => Number(r.id) === Number(itemId));
    if (!targetItem) {
      if (cleanClientRequestId) {
        await connection.rollback();
        txOpen = false;
        const raceReplay = await findMatchingOrderItemRevertReplay(pool, {
          actorId,
          cleanClientRequestId,
          orderNumber,
          itemId,
          restoreStock,
          requestedQty,
          includeCost,
        });
        if (raceReplay) return raceReplay;
      }
      throw httpError(404, "Order item not found.");
    }

    const itemQty = Number(targetItem.quantity);
    const revertQty = requestedQty == null ? itemQty : Number(requestedQty);
    if (!Number.isSafeInteger(revertQty) || revertQty < 1 || revertQty > itemQty) {
      throw httpError(400, `Revert quantity must be an integer between 1 and ${itemQty}.`);
    }

    const sessionId = await resolveVoidOrRevertSessionId(connection, order, actorId);
    const authSuffix = authorizingUser
      ? ` (Authorized by ${authorizingUser.displayName} [${authorizingUser.role}])`
      : "";
    const buildAuditReason = (prefix, maxLen = 255) => {
      const base = `${prefix}: ${reason}`;
      if (!authSuffix) return base.slice(0, maxLen);
      const baseMax = Math.max(0, maxLen - authSuffix.length);
      return `${base.slice(0, baseMax)}${authSuffix}`.slice(0, maxLen);
    };

    let cancelledOrderByRevert = false;
    let revertedDeltaAmount = 0;

    if (allItems.length === 1 && revertQty === itemQty) {
      cancelledOrderByRevert = true;
      revertedDeltaAmount = Number(order.total ?? Number(targetItem.unit_price) * revertQty);
      const fullReason = buildAuditReason(`Reverted (${targetItem.product_name_snapshot} ×${revertQty})`);
      await connection.execute(
        `UPDATE orders
            SET order_status = 'Cancelled',
                voided_by = ?,
                voided_at = CURRENT_TIMESTAMP,
                void_reason = ?
          WHERE id = ?`,
        [authorizingUser?.id || actorId, fullReason, order.id],
      );
      await connection.execute(
        `INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, actor_name_snapshot, reason)
         VALUES (?, ?, 'Cancelled', ?, ?, ?)`,
        [order.id, order.order_status, actorId, actorName, fullReason],
      );

      await reverseFullOrderInventoryAndCogs(connection, {
        order,
        restoreStock,
        reason: fullReason,
        actorId,
        actorName,
        sessionId,
        restoreNotePrefix: `Reverted last item on order ${order.order_number}`,
        spoilageNotePrefix: `Spoilage on reverted last item #${order.order_number}`,
      });
    } else {
      const ratio = revertQty / itemQty;
      const [consumptions] = await connection.execute(
        `SELECT id, inventory_item_id, inventory_item_name_snapshot, quantity_used, unit, line_cost, source
           FROM order_inventory_consumptions
          WHERE order_item_id = ? AND reversed_at IS NULL
          ORDER BY inventory_item_id ASC, id ASC
            FOR UPDATE`,
        [targetItem.id],
      );

      const distinctInventoryIds = [...new Set(consumptions.map((c) => Number(c.inventory_item_id)))].sort((a, b) => a - b);
      const runningStockByItem = new Map();
      if (distinctInventoryIds.length) {
        const marks = distinctInventoryIds.map(() => "?").join(",");
        const [lockedInventory] = await connection.execute(
          `SELECT id, name, quantity, unit FROM inventory_items WHERE id IN (${marks}) ORDER BY id FOR UPDATE`,
          distinctInventoryIds,
        );
        for (const inv of lockedInventory) {
          runningStockByItem.set(Number(inv.id), {
            name: inv.name,
            quantity: Number(inv.quantity),
            unit: inv.unit,
          });
        }
      }

      let revertedInvCogs = 0;
      let hasRecipeConsumption = false;
      let hasCostedConsumption = false;
      for (const c of consumptions) {
        if (c.source === "recipe") hasRecipeConsumption = true;
        if (Number(c.line_cost || 0) > 0) hasCostedConsumption = true;
        const invId = Number(c.inventory_item_id);
        const restoreQty = Math.round(Number(c.quantity_used) * ratio * 1000000) / 1000000;
        const restoreLineCost = Math.round(Number(c.line_cost || 0) * ratio * 10000) / 10000;
        revertedInvCogs += restoreLineCost;

        const state = runningStockByItem.get(invId);
        if (restoreStock) {
          const beforeQuantity = state ? state.quantity : 0;
          const afterQuantity = Math.round((beforeQuantity + restoreQty) * 1000000) / 1000000;
          if (state) state.quantity = afterQuantity;

          await connection.execute("UPDATE inventory_items SET quantity = quantity + ? WHERE id = ?", [restoreQty, invId]);
          await connection.execute(
            `INSERT INTO inventory_movements (
               inventory_item_id, user_id, movement_type, quantity_change, note,
               item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit, order_id, session_id
             ) VALUES (?, ?, 'void_restore', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              invId,
              actorId,
              restoreQty,
              `Reverted ${revertQty}× ${targetItem.product_name_snapshot} on order ${order.order_number}: ${reason}`.slice(0, 500),
              state?.name || c.inventory_item_name_snapshot,
              actorName,
              beforeQuantity,
              afterQuantity,
              state?.unit || c.unit,
              order.id,
              sessionId,
            ],
          );
        } else {
          const currentQty = state ? state.quantity : 0;
          await connection.execute(
            `INSERT INTO inventory_movements (
               inventory_item_id, user_id, movement_type, quantity_change, note,
               item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
               batch_cost, order_id, session_id
             ) VALUES (?, ?, 'spoilage', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              invId,
              actorId,
              `Spoilage on reverted ${revertQty}× ${targetItem.product_name_snapshot} (#${order.order_number}): ${reason}`.slice(0, 500),
              state?.name || c.inventory_item_name_snapshot,
              actorName,
              currentQty,
              currentQty,
              state?.unit || c.unit,
              Number(restoreLineCost.toFixed(2)),
              order.id,
              sessionId,
            ],
          );
        }

        if (revertQty === itemQty) {
          if (restoreStock) {
            await connection.execute(
              "UPDATE order_inventory_consumptions SET reversed_at = CURRENT_TIMESTAMP WHERE id = ?",
              [c.id],
            );
          }
        } else {
          await connection.execute(
            `UPDATE order_inventory_consumptions
                SET quantity_used = GREATEST(0, quantity_used - ?),
                    line_cost = GREATEST(0, COALESCE(line_cost, 0) - ?)
              WHERE id = ?`,
            [restoreQty, restoreLineCost, c.id],
          );
        }
      }

      const directCogsDelta = !hasCostedConsumption && targetItem.product_id != null
        ? Number(targetItem.unit_cost_snapshot || 0) * revertQty
        : 0;
      if (!hasRecipeConsumption && targetItem.product_id != null && restoreStock) {
        await connection.execute(
          "UPDATE menu_products SET stock_quantity = stock_quantity + ? WHERE id = ?",
          [revertQty, targetItem.product_id],
        );
      }
      const cogsDelta = Math.round((revertedInvCogs + directCogsDelta) * 10000) / 10000;

      if (revertQty === itemQty) {
        await connection.execute("DELETE FROM order_items WHERE id = ?", [targetItem.id]);
      } else {
        await connection.execute("UPDATE order_items SET quantity = quantity - ? WHERE id = ?", [revertQty, targetItem.id]);
      }

      const revertedLineSubtotal = Math.round(Number(targetItem.unit_price) * revertQty * 100) / 100;
      const oldSubtotal = Number(order.subtotal ?? order.total);
      const oldDiscount = Number(order.discount_amount ?? 0);
      const oldTax = Number(order.tax_amount ?? 0);
      const oldTotal = Number(order.total);
      const newSubtotal = Math.max(0, Math.round((oldSubtotal - revertedLineSubtotal) * 100) / 100);
      const newDiscount = oldSubtotal > 0 && oldDiscount > 0
        ? Math.round(oldDiscount * (newSubtotal / oldSubtotal) * 100) / 100
        : 0;
      const oldNetTaxable = Math.max(0, Math.round((oldSubtotal - oldDiscount) * 100) / 100);
      const newNetTaxable = Math.max(0, Math.round((newSubtotal - newDiscount) * 100) / 100);
      const newTax = oldNetTaxable > 0 && oldTax > 0
        ? Math.round(oldTax * (newNetTaxable / oldNetTaxable) * 100) / 100
        : 0;
      const newTotal = Math.max(0, Math.round((newNetTaxable + newTax) * 100) / 100);
      const subtotalDelta = Math.max(0, Math.round((oldSubtotal - newSubtotal) * 100) / 100);
      const discountDelta = Math.max(0, Math.round((oldDiscount - newDiscount) * 100) / 100);
      const taxDelta = Math.max(0, Math.round((oldTax - newTax) * 100) / 100);
      const totalDelta = Math.max(0, Math.round((oldTotal - newTotal) * 100) / 100);

      let newCashTendered = order.cash_tendered == null ? null : Number(order.cash_tendered);
      let newChangeDue = order.change_due == null ? null : Number(order.change_due);
      if (order.cash_tendered != null) {
        newCashTendered = Math.max(newTotal, Math.round((Number(order.cash_tendered) - totalDelta) * 100) / 100);
        newChangeDue = Math.max(0, Math.round((newCashTendered - newTotal) * 100) / 100);
      }

      await connection.execute(
        `UPDATE orders
            SET subtotal = ?,
                discount_amount = ?,
                tax_amount = ?,
                total = ?,
                cash_tendered = ?,
                change_due = ?
          WHERE id = ?`,
        [newSubtotal, newDiscount, newTax, newTotal, newCashTendered, newChangeDue, order.id],
      );

      revertedDeltaAmount = totalDelta;
      const eventReason = buildAuditReason(`Reverted ${revertQty}× ${targetItem.product_name_snapshot}`);
      await connection.execute(
        `INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, actor_name_snapshot, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [order.id, order.order_status, order.order_status, actorId, actorName, eventReason],
      );

      await postOrderItemRevertReversal(connection, {
        orderId: order.id,
        orderNumber: order.order_number,
        revertKey: cleanClientRequestId
          ? `req:${cleanClientRequestId}`
          : `${targetItem.id}:${Date.now()}-${randomInt(1000, 9999)}`,
        subtotalDelta,
        discountDelta,
        taxDelta,
        totalDelta,
        cogsDelta,
        restoreStock,
        paymentMethod: order.payment_method || "Cash",
        reason,
        sessionId,
        userId: actorId,
      });
    }

    await connection.execute(
      `INSERT INTO order_item_reversals
         (order_id, order_item_id_snapshot, user_id, client_request_id, reverted_quantity, restore_stock, reason, authorized_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        targetItem.id,
        actorId,
        cleanClientRequestId,
        revertQty,
        restoreStock ? 1 : 0,
        reason,
        authorizingUser?.id || null,
      ],
    );

    const approverLabel = authorizingUser
      ? `${authorizingUser.displayName} (${authorizingUser.role})`
      : `${actorName} (${actorRole})`;
    const notificationTitle = (
      cancelledOrderByRevert
        ? `Order #${order.order_number} Cancelled by Revert`
        : `Item Reverted on Order #${order.order_number}`
    ).slice(0, 180);
    const notificationMessage = `${actorName} reverted ${revertQty}× ${targetItem.product_name_snapshot} (-₱${Number(revertedDeltaAmount || 0).toFixed(2)}) · Stock: ${restoreStock ? "Restored" : "Spoilage"} · Authorized by ${approverLabel} · Reason: ${reason}`.slice(0, 1000);
    const notificationEventKey = `order-revert-${order.id}-${targetItem.id}-${Date.now()}-${randomInt(1000, 9999)}`.slice(0, 120);
    await connection.execute(
      `INSERT INTO notifications (user_id, event_key, type, title, message)
       SELECT id, ?, 'order_revert', ?, ?
         FROM users
        WHERE is_active = TRUE AND role = 'admin'
       ON DUPLICATE KEY UPDATE event_key = VALUES(event_key)`,
      [notificationEventKey, notificationTitle, notificationMessage],
    );

    await connection.commit();
    txOpen = false;
  } catch (error) {
    if (txOpen) {
      await connection.rollback();
    }
    if (error.code === "ER_DUP_ENTRY" && cleanClientRequestId) {
      const raceReplay = await findMatchingOrderItemRevertReplay(pool, {
        actorId,
        cleanClientRequestId,
        orderNumber,
        itemId,
        restoreStock,
        requestedQty,
        includeCost,
      });
      if (raceReplay) return raceReplay;
    }
    throw error;
  } finally {
    connection.release();
  }

  const updatedOrder = await loadOrderByNumber(orderNumber, {
    includeCost,
    includeDetails: true,
  });
  return {
    ...updatedOrder,
    authorizedBy: authorizingUser
      ? {
          id: authorizingUser.id,
          displayName: authorizingUser.displayName,
          role: authorizingUser.role,
        }
      : null,
  };
}
