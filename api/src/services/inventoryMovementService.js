import pool from "../database.js";
import { httpError } from "../middleware/auth.js";
import { resolveMediaUrl } from "../routes/media.js";
import {
  generateEntryNumber,
  postInventoryValuationDelta,
  resolveActiveSessionId,
  stripCostFromNote,
} from "../utils/ledgerService.js";
import {
  computeWasteDeduction,
  normalizeWasteUnit,
  parseStrictFiniteNumber,
  round2,
  round6,
  WASTE_REASON_MAP,
} from "../utils/wasteMeasurement.js";

export const VALID_MOVEMENT_TYPES = new Set([
  "restock",
  "adjustment",
  "usage",
  "spoilage",
  "void_restore",
  "internal_use",
]);

export const ALLOWED_INTERNAL_USE_ACCOUNTS = new Set([
  "6113",
  "6130",
  "6133",
  "6140",
  "6141",
  "6142",
  "6143",
  "6144",
]);

export function mapItem(row, includeCost = true, mediaMode = null) {
  const quantity = Number(row.quantity || 0);
  const unitCost = Number(row.unit_cost || 0);
  const purchasePrice = Number(row.purchase_price || 0);
  const packageQuantity = Number(row.package_quantity || 1);
  const contentsPerPackage = Number(row.contents_per_package || 1);
  return {
    id: Number(row.id),
    item: row.name,
    image: mediaMode === "url" ? resolveMediaUrl("inventory", row.id, row.image_url, row.updated_at) : (row.image_url || ""),
    category: row.category,
    quantity,
    unit: row.unit,
    maximumStock: row.maximum_stock == null ? null : Number(row.maximum_stock),
    addedFromMenu: Boolean(row.added_from_menu),
    packageUnit: row.package_unit || "pack",
    contentsPerPackage,
    ...(includeCost ? {
      purchasePrice,
      packageQuantity,
      unitCost,
      inventoryValue: Number((quantity * unitCost).toFixed(2)),
    } : {}),
    lastUpdated: new Date(row.updated_at).toISOString(),
    isCupCategory: Boolean(row.is_cup_category),
  };
}

export function unitWithAmountError(unit) {
  const match = String(unit || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
  return match
    ? `Keep amount and unit separate. Enter ${match[1]} in the stock quantity field and “${match[2]}” as the unit (for example, quantity 5 and unit kg).`
    : null;
}

export function resolveCosting(body = {}, current = null) {
  const isUpdate = Boolean(current);
  const rawPurchasePrice = body.purchasePrice !== undefined ? body.purchasePrice : (current?.purchase_price ?? 0);
  const purchasePrice = rawPurchasePrice === "" || rawPurchasePrice == null ? 0 : Number(rawPurchasePrice);
  if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
    throw httpError(400, "Purchase price must be zero or greater.");
  }

  const rawPkgQty = body.packageQuantity !== undefined ? body.packageQuantity : current?.package_quantity;
  const rawContents = body.contentsPerPackage !== undefined ? body.contentsPerPackage : current?.contents_per_package;
  const parsedPkgQty = rawPkgQty === "" || rawPkgQty == null ? (isUpdate ? Number(current.package_quantity || 1) : 0) : Number(rawPkgQty);
  const parsedContents = rawContents === "" || rawContents == null ? (isUpdate ? Number(current.contents_per_package || 1) : 0) : Number(rawContents);

  if (purchasePrice > 0 && (!Number.isFinite(parsedPkgQty) || parsedPkgQty <= 0 || !Number.isFinite(parsedContents) || parsedContents <= 0)) {
    throw httpError(400, "Enter a package quantity and the measurable contents per package to calculate unit cost.");
  }

  const packageQuantity = Number.isFinite(parsedPkgQty) && parsedPkgQty > 0 ? parsedPkgQty : 1;
  const contentsPerPackage = Number.isFinite(parsedContents) && parsedContents > 0 ? parsedContents : 1;
  const packageUnit = String(body.packageUnit || current?.package_unit || "pack").trim().slice(0, 40) || "pack";

  let unitCost;
  if (!isUpdate) {
    unitCost = purchasePrice > 0
      ? Number((purchasePrice / (packageQuantity * contentsPerPackage)).toFixed(6))
      : 0;
  } else {
    const costInputsChanged =
      Math.abs(purchasePrice - Number(current.purchase_price || 0)) > 1e-6 ||
      Math.abs(packageQuantity - Number(current.package_quantity || 1)) > 1e-6 ||
      Math.abs(contentsPerPackage - Number(current.contents_per_package || 1)) > 1e-6;
    if (costInputsChanged) {
      unitCost = purchasePrice > 0
        ? Number((purchasePrice / (packageQuantity * contentsPerPackage)).toFixed(6))
        : 0;
    } else {
      unitCost = Number(current.unit_cost || 0);
    }
  }

  return { purchasePrice, packageQuantity, packageUnit, contentsPerPackage, unitCost };
}

export async function syncCupRow(connection, itemId, category, name) {
  let isCupCategory;
  try {
    const [[catRow]] = await connection.execute(
      "SELECT is_cup_category FROM inventory_categories WHERE name = ? LIMIT 1",
      [category],
    );
    isCupCategory = Boolean(catRow?.is_cup_category);
  } catch {
    isCupCategory = false;
  }

  if (!isCupCategory) {
    await connection.execute("DELETE FROM inventory_cups WHERE inventory_item_id = ?", [itemId]);
    return;
  }
  const oz = String(name).match(/(\d+(?:\.\d+)?)\s*oz/i);
  await connection.execute(
    "INSERT INTO inventory_cups (inventory_item_id, cup_size_oz) VALUES (?, ?) ON DUPLICATE KEY UPDATE cup_size_oz = VALUES(cup_size_oz)",
    [itemId, oz ? Number(oz[1]) : null],
  );
}

export async function fetchMappedItemById(id, includeCost = true) {
  const [[row]] = await pool.execute(
    `SELECT ii.*, COALESCE(ic.is_cup_category, FALSE) AS is_cup_category
       FROM inventory_items ii
       LEFT JOIN inventory_categories ic ON LOWER(ii.category) COLLATE utf8mb4_unicode_ci = LOWER(ic.name) COLLATE utf8mb4_unicode_ci
      WHERE ii.id = ?
      LIMIT 1`,
    [id],
  );
  return row ? mapItem(row, includeCost) : null;
}

export function mapMovementRow(row, includeCost = true) {
  return {
    id: Number(row.id),
    itemId: Number(row.inventory_item_id),
    itemName: row.item_name || row.item_name_snapshot || "Unknown Item",
    type: row.movement_type,
    quantityChange: Number(row.quantity_change),
    beforeQuantity: row.before_quantity == null ? null : Number(row.before_quantity),
    afterQuantity: row.after_quantity == null ? null : Number(row.after_quantity),
    unit: row.unit || row.current_item_unit || null,
    ...(includeCost ? {
      batchCost: row.batch_cost == null ? null : Number(row.batch_cost),
      unitCostBefore: row.unit_cost_before == null ? null : Number(row.unit_cost_before),
      unitCostAfter: row.unit_cost_after == null ? null : Number(row.unit_cost_after),
    } : {}),
    supplierName: row.supplier_name || null,
    referenceNo: row.reference_no || null,
    orderId: row.order_id == null ? null : Number(row.order_id),
    orderNumber: row.order_number || null,
    sessionId: row.session_id == null ? null : Number(row.session_id),
    wasteReason: row.waste_reason || null,
    measurementMethod: row.measurement_method || null,
    measuredInputQty: row.measured_input_qty == null ? null : Number(row.measured_input_qty),
    measuredInputUnit: row.measured_input_unit || null,
    tareWeight: row.tare_weight == null ? null : Number(row.tare_weight),
    clientRequestId: row.client_request_id || null,
    reversedByMovementId: row.reversed_by_movement_id == null ? null : Number(row.reversed_by_movement_id),
    isReversed: Boolean(row.reversed_by_movement_id),
    note: includeCost ? (row.note || "") : stripCostFromNote(row.note || ""),
    actorId: row.user_id == null ? null : Number(row.user_id),
    actor: row.actor_name || "System",
    timestamp: new Date(row.created_at).toISOString(),
  };
}

export function formatWasteResponseRow(row, includeCost = true, journalEntryId = null) {
  const deductedQuantity = round6(Math.abs(Number(row.quantity_change || 0)));
  const resolvedJeId = journalEntryId !== null && journalEntryId !== undefined
    ? Number(journalEntryId)
    : (row.journal_entry_id == null ? null : Number(row.journal_entry_id));
  return {
    id: Number(row.id),
    movementId: Number(row.id),
    itemId: Number(row.inventory_item_id),
    itemName: row.item_name || row.item_name_snapshot || "Unknown Item",
    type: row.movement_type,
    quantityChange: Number(row.quantity_change),
    deductedQuantity,
    beforeQuantity: row.before_quantity == null ? null : Number(row.before_quantity),
    afterQuantity: row.after_quantity == null ? null : Number(row.after_quantity),
    unit: row.unit || row.current_item_unit || null,
    wasteReason: row.waste_reason || null,
    measurementMethod: row.measurement_method || null,
    measuredInputQty: row.measured_input_qty == null ? null : Number(row.measured_input_qty),
    measuredInputUnit: row.measured_input_unit || null,
    tareWeight: row.tare_weight == null ? null : Number(row.tare_weight),
    clientRequestId: row.client_request_id || null,
    reversedByMovementId: row.reversed_by_movement_id == null ? null : Number(row.reversed_by_movement_id),
    isReversed: Boolean(row.reversed_by_movement_id),
    orderId: row.order_id == null ? null : Number(row.order_id),
    orderNumber: row.order_number || null,
    sessionId: row.session_id == null ? null : Number(row.session_id),
    note: includeCost ? (row.note || "") : stripCostFromNote(row.note || ""),
    actorId: row.user_id == null ? null : Number(row.user_id),
    actor: row.actor_name || "System",
    timestamp: new Date(row.created_at).toISOString(),
    ...(includeCost ? {
      wasteValue: row.batch_cost == null ? 0 : round2(row.batch_cost),
      batchCost: row.batch_cost == null ? null : round2(row.batch_cost),
      unitCostBefore: row.unit_cost_before == null ? null : Number(row.unit_cost_before),
      unitCostAfter: row.unit_cost_after == null ? null : Number(row.unit_cost_after),
      journalEntryId: resolvedJeId,
    } : {}),
  };
}

export function formatInternalUseResponseRow(row, fallbackExpenseCode = null) {
  const matchedCode = String(row.note || "").match(/^Internal store use \((\d+)\)/)?.[1] || fallbackExpenseCode;
  return {
    ...mapMovementRow(row, true),
    movementId: Number(row.id),
    usageValue: row.batch_cost == null ? 0 : round2(row.batch_cost),
    expenseAccountCode: matchedCode,
    journalEntryId: row.journal_entry_id ? Number(row.journal_entry_id) : null,
  };
}

export function assertInternalUseReplayMatches(existingMove, itemId, deductQty, expenseAccountCode, expectedNote) {
  if (Number(existingMove.inventory_item_id) !== itemId) {
    throw httpError(409, "Client request ID was already used for a different inventory item.");
  }
  const storedQty = round6(Math.abs(Number(existingMove.quantity_change || 0)));
  const storedCode = String(existingMove.note || "").match(/^Internal store use \((\d+)\)/)?.[1] || null;
  if (
    existingMove.movement_type !== "internal_use" ||
    storedQty !== deductQty ||
    storedCode !== expenseAccountCode ||
    String(existingMove.note || "") !== expectedNote
  ) {
    throw httpError(409, "Client request ID was already used with a different internal store use payload.");
  }
}

export async function findExistingWasteByClientRequest(executor, userId, clientRequestId) {
  const [[row]] = await executor.execute(
    `SELECT m.*,
            COALESCE(ii.name, m.item_name_snapshot) AS item_name,
            ii.unit AS current_item_unit,
            COALESCE(NULLIF(u.display_name, ''), NULLIF(m.actor_name_snapshot, ''), u.username, 'System') AS actor_name,
            je.id AS journal_entry_id
       FROM inventory_movements m
       LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN journal_entries je ON je.inventory_movement_id = m.id AND je.is_reversal = FALSE
      WHERE m.user_id = ? AND m.client_request_id = ?
      LIMIT 1`,
    [userId, clientRequestId],
  );
  return row || null;
}

export function assertWasteReplayMatches(existingMove, itemId, body = {}) {
  if (Number(existingMove.inventory_item_id) !== itemId) {
    throw httpError(409, "Client request ID was already used for a different inventory item.");
  }

  const incomingMethod = typeof body.measurementMethod === "string" ? body.measurementMethod.trim() : "";
  const incomingReason = typeof body.wasteReason === "string" ? body.wasteReason.trim() : "";
  const incomingNote = typeof body.note === "string" ? body.note.trim() : "";
  const incomingQty = parseStrictFiniteNumber(body.measuredQuantity);
  const incomingRoundedQty = incomingQty === null ? null : round6(incomingQty);
  const storedQty = existingMove.measured_input_qty == null ? null : round6(Number(existingMove.measured_input_qty));

  const fallbackUnit = existingMove.current_item_unit || existingMove.unit || "";
  const incomingUnit = normalizeWasteUnit(String(body.measuredUnit || fallbackUnit).trim());
  const storedUnit = normalizeWasteUnit(String(existingMove.measured_input_unit || fallbackUnit).trim());

  const hasIncomingTare =
    body.tareWeight !== null &&
    body.tareWeight !== undefined &&
    !(typeof body.tareWeight === "string" && body.tareWeight.trim() === "");
  const incomingTareNum = hasIncomingTare ? parseStrictFiniteNumber(body.tareWeight) : null;
  const incomingRoundedTare = hasIncomingTare
    ? (incomingTareNum === null ? NaN : round6(incomingTareNum))
    : null;
  const storedTare = existingMove.tare_weight == null ? null : round6(Number(existingMove.tare_weight));

  const payloadMatches =
    existingMove.measurement_method === incomingMethod &&
    existingMove.waste_reason === incomingReason &&
    String(existingMove.note || "").trim() === incomingNote &&
    incomingRoundedQty !== null &&
    storedQty === incomingRoundedQty &&
    storedUnit === incomingUnit &&
    ((storedTare === null && incomingRoundedTare === null) ||
      (storedTare !== null && Number.isFinite(incomingRoundedTare) && storedTare === incomingRoundedTare));

  if (!payloadMatches) {
    throw httpError(409, "Client request ID was already used with a different waste payload.");
  }
}

export async function reverseDeductionMovement(request, targetMode) {
  const isWaste = targetMode === "spoilage";
  const label = isWaste ? "waste" : "internal store use";
  const movementId = Number(request.params.movementId);
  if (!Number.isSafeInteger(movementId) || movementId <= 0) {
    throw httpError(400, `Invalid ${label} movement ID.`);
  }

  const cleanReason = String(request.body?.reason || "").trim().slice(0, 255);
  if (cleanReason.length < 3) {
    throw httpError(400, "Please enter a clear reversal reason (at least 3 characters).");
  }

  const actorName = request.authUser?.displayName || request.authUser?.username || "Admin";
  const connection = await pool.getConnection();
  let responsePayload;

  try {
    await connection.beginTransaction();

    const [[orig]] = await connection.execute(
      "SELECT * FROM inventory_movements WHERE id = ? FOR UPDATE",
      [movementId],
    );
    if (!orig) {
      throw httpError(404, isWaste ? "Waste movement entry not found." : "Internal store use movement entry not found.");
    }
    if (orig.movement_type !== targetMode) {
      throw httpError(
        400,
        isWaste ? "Only spoilage / waste log entries can be reversed here." : "Only internal store use entries can be reversed here.",
      );
    }
    if (orig.order_id != null || (isWaste && !orig.waste_reason)) {
      throw httpError(
        400,
        isWaste
          ? "Only standalone zero-guesswork waste logs can be reversed here."
          : "Only standalone internal store use entries can be reversed here.",
      );
    }
    if (orig.reversed_by_movement_id != null) {
      throw httpError(409, `This ${label} entry has already been reversed.`);
    }

    const [[itemRow]] = await connection.execute(
      "SELECT * FROM inventory_items WHERE id = ? FOR UPDATE",
      [orig.inventory_item_id],
    );
    if (!itemRow) {
      throw httpError(404, "Associated inventory item not found.");
    }
    if (itemRow.is_archived) {
      throw httpError(409, `Cannot reverse ${label} on an archived inventory item. Restore the inventory item first.`);
    }

    const restoredQuantity = round6(Math.abs(Number(orig.quantity_change || 0)));
    if (!Number.isFinite(restoredQuantity) || restoredQuantity <= 0) {
      throw httpError(400, `This ${label} movement has no quantity available to restore.`);
    }

    const beforeQuantity = round6(Number(itemRow.quantity || 0));
    const afterQuantity = round6(beforeQuantity + restoredQuantity);
    const currentUnitCost = Number(itemRow.unit_cost || 0);
    const restoredBatchCost = orig.batch_cost == null ? null : round2(Math.abs(Number(orig.batch_cost)));
    const oldQtyPositive = Math.max(0, beforeQuantity);
    const oldCostPositive = Math.max(0, currentUnitCost);
    const origUnitCostBefore = orig.unit_cost_before != null ? Math.max(0, Number(orig.unit_cost_before)) : null;
    const exactRestoredValue = (origUnitCostBefore !== null && origUnitCostBefore > 0)
      ? (restoredQuantity * origUnitCostBefore)
      : (restoredBatchCost !== null ? restoredBatchCost : (restoredQuantity * oldCostPositive));
    const newUnitCost = afterQuantity > 0
      ? round6(((oldQtyPositive * oldCostPositive) + exactRestoredValue) / afterQuantity)
      : (origUnitCostBefore ?? oldCostPositive);

    const sessionId = await resolveActiveSessionId(connection, request.authUser.sub, orig.session_id);

    await connection.execute(
      "UPDATE inventory_items SET quantity = ?, unit_cost = ? WHERE id = ?",
      [afterQuantity, newUnitCost, itemRow.id],
    );

    const reversalNote = `Reversal of ${isWaste ? "waste log" : "internal store use"} #${orig.id}: ${cleanReason}`.slice(0, 500);
    const [revMoveRes] = await connection.execute(
      `INSERT INTO inventory_movements (
         inventory_item_id, user_id, movement_type, quantity_change, note,
         item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
         batch_cost, unit_cost_before, unit_cost_after, session_id
       ) VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        itemRow.id,
        request.authUser.sub,
        restoredQuantity,
        reversalNote,
        itemRow.name,
        actorName,
        beforeQuantity,
        afterQuantity,
        orig.unit || itemRow.unit,
        restoredBatchCost,
        currentUnitCost,
        newUnitCost,
        sessionId,
      ],
    );
    const reversalMovementId = Number(revMoveRes.insertId);

    const [linkRes] = await connection.execute(
      "UPDATE inventory_movements SET reversed_by_movement_id = ? WHERE id = ? AND reversed_by_movement_id IS NULL",
      [reversalMovementId, orig.id],
    );
    if (linkRes.affectedRows !== 1) {
      throw httpError(409, `This ${label} entry has already been reversed.`);
    }

    let reversalJournalEntryId = null;
    const [[origJe]] = await connection.execute(
      "SELECT * FROM journal_entries WHERE inventory_movement_id = ? AND is_reversal = FALSE ORDER BY id ASC LIMIT 1 FOR UPDATE",
      [orig.id],
    );

    if (origJe) {
      const [[existingRevJe]] = await connection.execute(
        "SELECT id FROM journal_entries WHERE reverses_entry_id = ? LIMIT 1 FOR UPDATE",
        [origJe.id],
      );
      if (existingRevJe) {
        reversalJournalEntryId = Number(existingRevJe.id);
      } else {
        const [origLines] = await connection.execute(
          "SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?",
          [origJe.id],
        );

        if (origLines && origLines.length > 0) {
          const reversalEntryNumber = generateEntryNumber("REV");
          const memoPrefix = isWaste ? "waste" : "internal-use";
          const refPrefix = isWaste ? "REV-WASTE" : "REV-USE";
          const idemSuffix = isWaste ? "waste_reversal" : "internal_use_reversal";
          const [revJeRes] = await connection.execute(
            `INSERT INTO journal_entries (
               entry_number, entry_type, memo, reference_number,
               inventory_movement_id, session_id, is_reversal, reverses_entry_id,
               idempotency_key, created_by
             ) VALUES (?, 'void_reversal', ?, ?, ?, ?, TRUE, ?, ?, ?)`,
            [
              reversalEntryNumber,
              `Reversal of ${memoPrefix} movement #${orig.id} (${origJe.entry_number}): ${cleanReason}`.slice(0, 255),
              `${refPrefix}-${orig.id}`,
              reversalMovementId,
              sessionId,
              origJe.id,
              `inv_move:${reversalMovementId}:${idemSuffix}`,
              request.authUser.sub,
            ],
          );
          reversalJournalEntryId = Number(revJeRes.insertId);

          for (const line of origLines) {
            await connection.execute(
              `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, line_memo)
               VALUES (?, ?, ?, ?, ?)`,
              [
                reversalJournalEntryId,
                line.account_id,
                round2(line.credit),
                round2(line.debit),
                `Reversal of line #${line.id} (${label} #${orig.id})`,
              ],
            );
          }
        }
      }
    }

    await connection.commit();
    responsePayload = {
      originalMovementId: Number(orig.id),
      reversalMovementId,
      itemId: Number(itemRow.id),
      itemName: itemRow.name,
      restoredQuantity,
      beforeQuantity,
      afterQuantity,
      unit: orig.unit || itemRow.unit,
      journalEntryId: reversalJournalEntryId,
      reason: cleanReason,
      reversedBy: actorName,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return responsePayload;
}

export async function executeLogWaste({ id, authUser, body, cleanClientRequestId }) {
  const includeCost = authUser.role === "admin";
  const actorName = authUser?.displayName || authUser?.username || "Staff";
  const {
    measurementMethod,
    measuredQuantity,
    measuredUnit,
    tareWeight = null,
    wasteReason,
    note,
  } = body || {};

  if (cleanClientRequestId) {
    const existingMove = await findExistingWasteByClientRequest(
      pool,
      authUser.sub,
      cleanClientRequestId,
    );
    if (existingMove) {
      assertWasteReplayMatches(existingMove, id, body || {});
      return { status: 200, body: formatWasteResponseRow(existingMove, includeCost) };
    }
  }

  const connection = await pool.getConnection();
  let txOpen = false;
  try {
    await connection.beginTransaction();
    txOpen = true;

    const [[current]] = await connection.execute(
      "SELECT * FROM inventory_items WHERE id = ? AND is_archived = FALSE FOR UPDATE",
      [id],
    );
    if (!current) {
      throw httpError(404, "Inventory item not found.");
    }

    const calc = computeWasteDeduction({
      item: {
        id: Number(current.id),
        name: current.name,
        unit: current.unit,
        quantity: Number(current.quantity || 0),
        packageUnit: current.package_unit,
        contentsPerPackage: Number(current.contents_per_package || 1),
      },
      measurementMethod,
      measuredQuantity,
      measuredUnit,
      tareWeight,
      wasteReason,
      note,
      beforeQuantity: Number(current.quantity || 0),
    });

    if (!calc.ok) {
      await connection.rollback();
      txOpen = false;
      if (cleanClientRequestId) {
        const raceExisting = await findExistingWasteByClientRequest(
          connection,
          authUser.sub,
          cleanClientRequestId,
        );
        if (raceExisting) {
          assertWasteReplayMatches(raceExisting, id, body || {});
          return { status: 200, body: formatWasteResponseRow(raceExisting, includeCost) };
        }
      }
      throw httpError(400, calc.error);
    }

    const sessionId = await resolveActiveSessionId(connection, authUser.sub, {
      explicitSessionId: body?.sessionId ?? null,
    });

    await connection.execute(
      "UPDATE inventory_items SET quantity = ? WHERE id = ? AND is_archived = FALSE",
      [calc.afterQuantity, id],
    );

    const unitCost = Number(current.unit_cost || 0);
    const wasteValue = round2(calc.deductedQuantity * unitCost);
    let movementId = null;

    try {
      const [moveRes] = await connection.execute(
        `INSERT INTO inventory_movements (
           inventory_item_id, user_id, movement_type, quantity_change, note,
           item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit,
           batch_cost, unit_cost_before, unit_cost_after, session_id,
           waste_reason, measurement_method, measured_input_qty, measured_input_unit, tare_weight, client_request_id
         ) VALUES (?, ?, 'spoilage', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          authUser.sub,
          -calc.deductedQuantity,
          calc.note,
          current.name,
          actorName,
          calc.beforeQuantity,
          calc.afterQuantity,
          current.unit,
          wasteValue,
          unitCost,
          unitCost,
          sessionId,
          calc.wasteReason,
          calc.measurementMethod,
          calc.measuredInputQty,
          calc.measuredInputUnit,
          calc.tareWeight,
          cleanClientRequestId,
        ],
      );
      movementId = Number(moveRes.insertId);
    } catch (insertError) {
      if (cleanClientRequestId && insertError?.code === "ER_DUP_ENTRY") {
        await connection.rollback();
        txOpen = false;
        const raceExisting = await findExistingWasteByClientRequest(
          connection,
          authUser.sub,
          cleanClientRequestId,
        );
        if (raceExisting) {
          assertWasteReplayMatches(raceExisting, id, body || {});
          return { status: 200, body: formatWasteResponseRow(raceExisting, includeCost) };
        }
      }
      throw insertError;
    }

    const ledgerRes = await postInventoryValuationDelta(connection, {
      inventoryMovementId: movementId,
      itemName: current.name,
      deltaValue: -wasteValue,
      entryType: "adjustment",
      offsetAccountCode: "6030",
      memo: `Waste / spoilage (${calc.wasteReason}): ${current.name} (-${calc.deductedQuantity} ${current.unit})`,
      referenceNumber: `WASTE-${movementId}`,
      sessionId,
      userId: authUser.sub,
    });

    const reasonLabel = WASTE_REASON_MAP[calc.wasteReason]?.label || calc.wasteReason;
    const notifTitle = `Waste Logged: ${current.name}`.slice(0, 180);
    const notifMessage = `${actorName} logged -${calc.deductedQuantity} ${current.unit} (${reasonLabel})${wasteValue > 0 ? ` · ₱${wasteValue.toFixed(2)} loss` : ""} · ${calc.note}`.slice(0, 1000);
    const notifEventKey = `inventory-waste-${movementId}`.slice(0, 120);
    await connection.execute(
      `INSERT INTO notifications (user_id, event_key, type, title, message)
       SELECT id, ?, 'inventory_waste', ?, ?
         FROM users
        WHERE is_active = TRUE AND role = 'admin'
       ON DUPLICATE KEY UPDATE event_key = VALUES(event_key)`,
      [notifEventKey, notifTitle, notifMessage],
    );

    await connection.commit();
    txOpen = false;

    const [[createdRow]] = await pool.execute(
      `SELECT m.*,
              COALESCE(ii.name, m.item_name_snapshot) AS item_name,
              ii.unit AS current_item_unit,
              COALESCE(NULLIF(u.display_name, ''), NULLIF(m.actor_name_snapshot, ''), u.username, 'System') AS actor_name
         FROM inventory_movements m
         LEFT JOIN inventory_items ii ON ii.id = m.inventory_item_id
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.id = ?
        LIMIT 1`,
      [movementId],
    );

    return {
      status: 201,
      body: formatWasteResponseRow(createdRow, includeCost, ledgerRes?.entryId ?? null),
    };
  } catch (error) {
    if (txOpen) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }
}
