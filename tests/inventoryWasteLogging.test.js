import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pool from "../api/src/database.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

const FORBIDDEN_STAFF_COST_KEYS = new Set([
  "unitCost",
  "unit_cost",
  "wasteValue",
  "waste_value",
  "batchCost",
  "batch_cost",
  "journalEntryId",
  "journal_entry_id",
  "unitCostBefore",
  "unit_cost_before",
  "unitCostAfter",
  "unit_cost_after",
  "purchasePrice",
  "purchase_price",
  "inventoryValue",
  "inventory_value",
  "totalWasteLossToday",
  "total_waste_loss_today",
]);

function findForbiddenKeys(value, prefix = "") {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((entry, idx) => {
      hits.push(...findForbiddenKeys(entry, `${prefix}[${idx}]`));
    });
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (FORBIDDEN_STAFF_COST_KEYS.has(key)) {
        hits.push(path);
      }
      hits.push(...findForbiddenKeys(nested, path));
    }
  }
  return hits;
}

function assertNoStaffCostLeakage(data, rawText, contextLabel) {
  assert.equal(
    /₱/.test(rawText || ""),
    false,
    `${contextLabel}: staff response must NEVER contain peso sign (₱). Got: ${rawText}`,
  );
  const leakedKeys = findForbiddenKeys(data);
  assert.deepEqual(
    leakedKeys,
    [],
    `${contextLabel}: staff response exposed forbidden financial/cost keys: ${leakedKeys.join(", ")}`,
  );
}

describe("Tala TDD Suite: Zero-Guesswork Waste & Spoilage Logging", () => {
  let server;
  let adminUser;
  let staffUser;
  let staffSessionId;
  const tracker = createCleanupTracker();
  const createdItemNames = new Set();
  const createdActorNames = new Set();

  async function createTestInventoryItem({
    namePrefix = "TalaWasteItem",
    category = "Ingredients",
    quantity = 1000,
    unit = "g",
    purchasePrice = 100,
    packageQuantity = 1,
    packageUnit = "bottle",
    contentsPerPackage = 1000,
  } = {}) {
    const itemName = makeUniqueTag(namePrefix);
    createdItemNames.add(itemName);

    const res = await server.requestJson("/api/inventory", {
      method: "POST",
      token: adminUser.token,
      body: {
        item: itemName,
        category,
        quantity,
        unit,
        purchasePrice,
        packageQuantity,
        packageUnit,
        contentsPerPackage,
      },
    });
    assert.equal(
      res.status,
      201,
      `Setup inventory item "${itemName}" must return HTTP 201, got ${res.status}: ${res.text}`,
    );
    tracker.inventoryItemIds.add(Number(res.data.id));
    return res.data;
  }

  async function getDbItemQuantity(itemId) {
    const [[row]] = await pool.execute(
      "SELECT quantity FROM inventory_items WHERE id = ? LIMIT 1",
      [itemId],
    );
    assert.ok(row, `Inventory item #${itemId} must exist in DB`);
    return Number(row.quantity);
  }

  before(async () => {
    server = await startTestServer();
    adminUser = await tracker.createUser({
      role: "admin",
      displayName: makeUniqueTag("Tala Waste Admin"),
      username: makeUniqueTag("tala_waste_admin").toLowerCase(),
    });
    staffUser = await tracker.createUser({
      role: "staff",
      displayName: makeUniqueTag("Tala Waste Staff"),
      username: makeUniqueTag("tala_waste_staff").toLowerCase(),
    });
    createdActorNames.add(adminUser.displayName);
    createdActorNames.add(staffUser.displayName);

    // Seed an active open cashier shift for staffUser without touching store_daily_asset_snapshots
    const [sessRes] = await pool.execute(
      `INSERT INTO cashier_sessions (user_id, cashier_name_snapshot, terminal_label, opening_float, status)
       VALUES (?, ?, 'Tala Waste Counter', 1000.00, 'open')`,
      [staffUser.id, staffUser.displayName],
    );
    staffSessionId = Number(sessRes.insertId);
    tracker.sessionIds.add(staffSessionId);
  });

  after(async () => {
    try {
      // 1. Clean any 'inventory_waste' notifications delivered to pre-existing active admins
      const notificationPatterns = [...createdItemNames, ...createdActorNames];
      for (const pattern of notificationPatterns) {
        const likeTerm = `%${pattern}%`;
        await pool.execute(
          `DELETE FROM notifications
            WHERE type = 'inventory_waste'
              AND (title LIKE ? OR message LIKE ?)`,
          [likeTerm, likeTerm],
        );
      }

      // 2. Clean any journal_entries/lines linked to movements of our created inventory items
      const invIds = [...tracker.inventoryItemIds];
      if (invIds.length > 0) {
        const invMarks = invIds.map(() => "?").join(",");
        const [movRows] = await pool.execute(
          `SELECT id FROM inventory_movements WHERE inventory_item_id IN (${invMarks})`,
          invIds,
        );
        const movIds = movRows.map((row) => Number(row.id));
        if (movIds.length > 0) {
          const movMarks = movIds.map(() => "?").join(",");
          const [jeRows] = await pool.execute(
            `SELECT id FROM journal_entries WHERE inventory_movement_id IN (${movMarks})`,
            movIds,
          );
          const jeIds = jeRows.map((row) => Number(row.id));
          if (jeIds.length > 0) {
            const jeMarks = jeIds.map(() => "?").join(",");
            await pool.execute(
              `DELETE FROM journal_entry_lines WHERE journal_entry_id IN (${jeMarks})`,
              jeIds,
            );
            await pool.execute(
              `UPDATE journal_entries
                  SET reverses_entry_id = NULL
                WHERE id IN (${jeMarks}) OR reverses_entry_id IN (${jeMarks})`,
              [...jeIds, ...jeIds],
            );
            await pool.execute(
              `DELETE FROM journal_entries WHERE id IN (${jeMarks})`,
              jeIds,
            );
          }
        }
      }

      // 3. Run standard shared tracker cleanup (notifications, journals, movements, items, products, sessions, categories, users)
      await tracker.cleanup();
    } finally {
      try {
        if (server) await server.close();
      } finally {
        await pool.end();
      }
    }
  });

  // --------------------------------------------------------------------------
  // TEST 1: REMAINING_COUNT WEIGH-BACK + ATOMIC DB, LEDGER & ADMIN NOTIFICATION
  // --------------------------------------------------------------------------
  it("TEST 1 (remaining_count weigh-back): derives exact 250g waste from 750g remaining, writes spoilage movement, balanced DR 6030 / CR 1050 ₱25.00 journal, and admin notification", async () => {
    const oil = await createTestInventoryItem({
      namePrefix: "TalaOil_Test1",
      category: "Ingredients",
      quantity: 1000,
      unit: "g",
      purchasePrice: 100,
      packageQuantity: 1,
      packageUnit: "bottle",
      contentsPerPackage: 1000, // ₱0.10/g
    });
    assert.equal(Number(oil.unitCost), 0.1, "Setup oil unitCost must equal ₱0.10/g");

    const clientRequestId = randomUUID();
    const wasteRes = await server.requestJson(`/api/inventory/${oil.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "remaining_count",
        measuredQuantity: 750,
        measuredUnit: "g",
        tareWeight: 0,
        wasteReason: "spill_accident",
        note: "Spilled cooking oil near fryer",
        clientRequestId,
      },
    });

    assert.equal(
      wasteRes.status,
      201,
      `POST /api/inventory/:id/waste must return HTTP 201, got ${wasteRes.status}: ${wasteRes.text}`,
    );

    assert.equal(Number(wasteRes.data.deductedQuantity), 250, "Must derive deductedQuantity = 250");
    assert.equal(Number(wasteRes.data.beforeQuantity), 1000, "Must report beforeQuantity = 1000");
    assert.equal(Number(wasteRes.data.afterQuantity), 750, "Must report afterQuantity = 750");
    assert.equal(wasteRes.data.unit, "g");
    assert.equal(wasteRes.data.wasteReason, "spill_accident");
    assert.equal(wasteRes.data.measurementMethod, "remaining_count");
    assert.equal(Number(wasteRes.data.sessionId), staffSessionId);

    const movementId = Number(wasteRes.data.id ?? wasteRes.data.movementId);
    assert.ok(Number.isSafeInteger(movementId) && movementId > 0, "Response must include created movement id");

    // Verify MariaDB inventory_items stock updated
    assert.equal(await getDbItemQuantity(oil.id), 750, "DB inventory_items.quantity must equal 750");

    // Verify MariaDB inventory_movements structured waste audit columns
    const [[movRow]] = await pool.execute(
      `SELECT id, inventory_item_id, user_id, movement_type, quantity_change,
              before_quantity, after_quantity, unit, batch_cost, unit_cost_before, unit_cost_after,
              waste_reason, measurement_method, measured_input_qty, measured_input_unit,
              tare_weight, client_request_id, session_id, note
         FROM inventory_movements
        WHERE id = ?
        LIMIT 1`,
      [movementId],
    );
    assert.ok(movRow, "inventory_movements row must be persisted");
    assert.equal(Number(movRow.inventory_item_id), oil.id);
    assert.equal(Number(movRow.user_id), staffUser.id);
    assert.equal(movRow.movement_type, "spoilage");
    assert.equal(Number(movRow.quantity_change), -250);
    assert.equal(Number(movRow.before_quantity), 1000);
    assert.equal(Number(movRow.after_quantity), 750);
    assert.equal(movRow.unit, "g");
    assert.equal(Number(movRow.batch_cost), 25.00, "batch_cost must record exact ₱25.00 asset write-down");
    assert.equal(Number(movRow.unit_cost_before), 0.1);
    assert.equal(Number(movRow.unit_cost_after), 0.1);
    assert.equal(movRow.waste_reason, "spill_accident");
    assert.equal(movRow.measurement_method, "remaining_count");
    assert.equal(Number(movRow.measured_input_qty), 750);
    assert.equal(movRow.measured_input_unit, "g");
    assert.equal(Number(movRow.tare_weight || 0), 0);
    assert.equal(movRow.client_request_id, clientRequestId);
    assert.equal(Number(movRow.session_id), staffSessionId);

    // Verify double-entry journal entry: DR 6030 ₱25.00 / CR 1050 ₱25.00
    const [[jeRow]] = await pool.execute(
      `SELECT id, entry_type, is_reversal, created_by
         FROM journal_entries
        WHERE inventory_movement_id = ?
        LIMIT 1`,
      [movementId],
    );
    assert.ok(jeRow, "Balanced journal_entries header must be created for spoilage movement");
    assert.equal(jeRow.is_reversal, 0);

    const [jeLines] = await pool.execute(
      `SELECT jel.debit, jel.credit, coa.account_code
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE jel.journal_entry_id = ?`,
      [jeRow.id],
    );
    const totalDebit = jeLines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = jeLines.reduce((sum, l) => sum + Number(l.credit), 0);
    assert.equal(Number(totalDebit.toFixed(2)), 25.00, "Journal debits must total ₱25.00");
    assert.equal(Number(totalCredit.toFixed(2)), 25.00, "Journal credits must total ₱25.00");

    const debit6030 = jeLines.find((l) => l.account_code === "6030" && Number(l.debit) === 25.00 && Number(l.credit) === 0);
    const credit1050 = jeLines.find((l) => l.account_code === "1050" && Number(l.credit) === 25.00 && Number(l.debit) === 0);
    assert.ok(debit6030, "Must debit 6030 Inventory Wastage & Spoilage for ₱25.00");
    assert.ok(credit1050, "Must credit 1050 Merchandise Inventory for ₱25.00");

    // Verify Admin notification inserted with type = 'inventory_waste', and NOT sent to staff
    const [adminNotifs] = await pool.execute(
      `SELECT id, type, title, message
         FROM notifications
        WHERE user_id = ? AND type = 'inventory_waste'`,
      [adminUser.id],
    );
    const matchingNotif = adminNotifs.find(
      (n) => String(n.title).includes(oil.item) || String(n.message).includes(oil.item),
    );
    assert.ok(matchingNotif, `Admin user must receive an 'inventory_waste' notification mentioning ${oil.item}`);

    const [staffNotifs] = await pool.execute(
      `SELECT id FROM notifications WHERE user_id = ? AND type = 'inventory_waste'`,
      [staffUser.id],
    );
    assert.equal(staffNotifs.length, 0, "Staff user must NOT receive admin inventory_waste notifications");
  });

  // --------------------------------------------------------------------------
  // TEST 2: REMAINING_COUNT WITH TARE WEIGHT & CROSS-UNIT CONVERSION
  // --------------------------------------------------------------------------
  it("TEST 2 (tare weight & cross-unit remaining_count): subtracts 80g tare from 830g gross -> 250g waste, and converts 0.75 kg -> 750g remaining -> 250g waste", async () => {
    const oilTare = await createTestInventoryItem({
      namePrefix: "TalaOilTare_Test2A",
      quantity: 1000,
      unit: "g",
      purchasePrice: 100,
      packageQuantity: 1,
      packageUnit: "bottle",
      contentsPerPackage: 1000,
    });

    const tareRes = await server.requestJson(`/api/inventory/${oilTare.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "remaining_count",
        measuredQuantity: 830,
        measuredUnit: "g",
        tareWeight: 80,
        wasteReason: "spill_accident",
        note: "Weighed oil bottle including 80g container tare",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(
      tareRes.status,
      201,
      `Tare weigh-back must return HTTP 201, got ${tareRes.status}: ${tareRes.text}`,
    );
    assert.equal(Number(tareRes.data.deductedQuantity), 250, "830g gross - 80g tare = 750g net -> 250g deducted");
    assert.equal(Number(tareRes.data.afterQuantity), 750);
    assert.equal(await getDbItemQuantity(oilTare.id), 750);

    const [[tareMov]] = await pool.execute(
      `SELECT measured_input_qty, measured_input_unit, tare_weight, quantity_change
         FROM inventory_movements
        WHERE inventory_item_id = ? AND movement_type = 'spoilage'
        ORDER BY id DESC LIMIT 1`,
      [oilTare.id],
    );
    assert.equal(Number(tareMov.measured_input_qty), 830);
    assert.equal(tareMov.measured_input_unit, "g");
    assert.equal(Number(tareMov.tare_weight), 80);
    assert.equal(Number(tareMov.quantity_change), -250);

    // Cross-unit remaining_count: 0.75 kg on a g-unit item -> 750g remaining -> 250g waste
    const oilKg = await createTestInventoryItem({
      namePrefix: "TalaOilKg_Test2B",
      quantity: 1000,
      unit: "g",
      purchasePrice: 100,
      packageQuantity: 1,
      packageUnit: "bottle",
      contentsPerPackage: 1000,
    });

    const kgRes = await server.requestJson(`/api/inventory/${oilKg.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "remaining_count",
        measuredQuantity: 0.75,
        measuredUnit: "kg",
        tareWeight: 0,
        wasteReason: "expired_spoiled",
        note: "Weighed remaining oil in kilograms on digital scale",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(
      kgRes.status,
      201,
      `Cross-unit kg weigh-back must return HTTP 201, got ${kgRes.status}: ${kgRes.text}`,
    );
    assert.equal(Number(kgRes.data.deductedQuantity), 250, "0.75 kg remaining = 750 g -> 250 g deducted");
    assert.equal(Number(kgRes.data.afterQuantity), 750);
    assert.equal(await getDbItemQuantity(oilKg.id), 750);
  });

  // --------------------------------------------------------------------------
  // TEST 3: DIRECT_MEASURE + SEALED PACK + WHOLE-COUNT & DIMENSION INTEGRITY
  // --------------------------------------------------------------------------
  it("TEST 3 (direct_measure, sealed pack & count integrity): deducts 3 pcs and 0.5 dozen (6 pcs), supports sealed pack multiplier, rejects 2.37 pcs & ml-on-g with HTTP 400", async () => {
    const waxPaper = await createTestInventoryItem({
      namePrefix: "TalaWaxPaper_Test3A",
      category: "Supplies",
      quantity: 100,
      unit: "pcs",
      purchasePrice: 79,
      packageQuantity: 1,
      packageUnit: "pack",
      contentsPerPackage: 100,
    });

    // 1. Direct waste 3 pcs -> 97 pcs
    const pcsRes = await server.requestJson(`/api/inventory/${waxPaper.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 3,
        measuredUnit: "pcs",
        wasteReason: "damaged_contaminated",
        note: "Three wax paper sheets soaked by spilled drink",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(
      pcsRes.status,
      201,
      `Direct 3 pcs waste must return HTTP 201, got ${pcsRes.status}: ${pcsRes.text}`,
    );
    assert.equal(Number(pcsRes.data.deductedQuantity), 3);
    assert.equal(Number(pcsRes.data.afterQuantity), 97);
    assert.equal(await getDbItemQuantity(waxPaper.id), 97);

    // 2. Direct waste 0.5 dozen -> 6 pcs -> 91 pcs
    const dozenRes = await server.requestJson(`/api/inventory/${waxPaper.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 0.5,
        measuredUnit: "dozen",
        wasteReason: "damaged_contaminated",
        note: "Half dozen sheets torn in packaging drawer",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(
      dozenRes.status,
      201,
      `Direct 0.5 dozen waste must return HTTP 201, got ${dozenRes.status}: ${dozenRes.text}`,
    );
    assert.equal(Number(dozenRes.data.deductedQuantity), 6);
    assert.equal(Number(dozenRes.data.afterQuantity), 91);
    assert.equal(await getDbItemQuantity(waxPaper.id), 91);

    // 3. Reject fractional count (2.37 pcs) with HTTP 400
    const fractionalRes = await server.requestJson(`/api/inventory/${waxPaper.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 2.37,
        measuredUnit: "pcs",
        wasteReason: "damaged_contaminated",
        note: "Fractional piece count must be blocked",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(
      fractionalRes.status,
      400,
      `Fractional count (2.37 pcs) must be rejected with HTTP 400, got ${fractionalRes.status}`,
    );
    assert.equal(await getDbItemQuantity(waxPaper.id), 91, "Stock must remain 91 after rejected fractional count");

    // 4. Sealed pack conversion: 150 pcs with packageUnit 'pack' (100 pcs/pack) -> waste 1 pack -> 50 pcs
    const cupsPack = await createTestInventoryItem({
      namePrefix: "TalaCupPack_Test3B",
      category: "Supplies",
      quantity: 150,
      unit: "pcs",
      purchasePrice: 200,
      packageQuantity: 1,
      packageUnit: "pack",
      contentsPerPackage: 100,
    });
    const packRes = await server.requestJson(`/api/inventory/${cupsPack.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 1,
        measuredUnit: "pack",
        wasteReason: "damaged_contaminated",
        note: "One sealed pack of 100 pcs damaged by roof drip",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(
      packRes.status,
      201,
      `Sealed pack direct waste must return HTTP 201, got ${packRes.status}: ${packRes.text}`,
    );
    assert.equal(Number(packRes.data.deductedQuantity), 100, "1 pack * 100 contentsPerPackage = 100 pcs");
    assert.equal(Number(packRes.data.afterQuantity), 50);
    assert.equal(await getDbItemQuantity(cupsPack.id), 50);

    // 5. Reject cross-dimension unit (ml on g item) with HTTP 400
    const gramItem = await createTestInventoryItem({
      namePrefix: "TalaSugar_Test3C",
      quantity: 1000,
      unit: "g",
      purchasePrice: 80,
      packageQuantity: 1,
      packageUnit: "bag",
      contentsPerPackage: 1000,
    });
    const crossDimRes = await server.requestJson(`/api/inventory/${gramItem.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 100,
        measuredUnit: "ml",
        wasteReason: "spill_accident",
        note: "Volume ml cannot apply to mass gram stock",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(
      crossDimRes.status,
      400,
      `Cross-dimension unit (ml on g item) must be rejected with HTTP 400, got ${crossDimRes.status}`,
    );
    assert.equal(await getDbItemQuantity(gramItem.id), 1000, "Stock must remain untouched on dimension mismatch");
  });

  // --------------------------------------------------------------------------
  // TEST 4: ANTI-GUESS & BOUNDARY GUARDS (NO NEGATIVE STOCK, NO GUESSING)
  // --------------------------------------------------------------------------
  it("TEST 4 (anti-guess & boundary guards): rejects <=0 waste, remaining >= stock, waste > stock, negative tare/gross, gross < tare, short/empty note, and invalid reason/method", async () => {
    const guardedItem = await createTestInventoryItem({
      namePrefix: "TalaGuardOil_Test4",
      quantity: 1000,
      unit: "g",
      purchasePrice: 100,
      packageQuantity: 1,
      packageUnit: "bottle",
      contentsPerPackage: 1000,
    });

    const invalidCases = [
      {
        label: "direct_measure wasteQty == 0",
        body: {
          measurementMethod: "direct_measure",
          measuredQuantity: 0,
          measuredUnit: "g",
          wasteReason: "spill_accident",
          note: "Zero waste should be rejected",
        },
      },
      {
        label: "direct_measure wasteQty < 0",
        body: {
          measurementMethod: "direct_measure",
          measuredQuantity: -25,
          measuredUnit: "g",
          wasteReason: "spill_accident",
          note: "Negative waste should be rejected",
        },
      },
      {
        label: "remaining_count == currentStock (1000 == 1000)",
        body: {
          measurementMethod: "remaining_count",
          measuredQuantity: 1000,
          measuredUnit: "g",
          tareWeight: 0,
          wasteReason: "spill_accident",
          note: "Zero difference between remaining and current stock",
        },
      },
      {
        label: "remaining_count > currentStock (1200 > 1000)",
        body: {
          measurementMethod: "remaining_count",
          measuredQuantity: 1200,
          measuredUnit: "g",
          tareWeight: 0,
          wasteReason: "spill_accident",
          note: "Remaining exceeds system stock",
        },
      },
      {
        label: "direct_measure wasteQty > currentStock (1001 > 1000, prevents negative stock)",
        body: {
          measurementMethod: "direct_measure",
          measuredQuantity: 1001,
          measuredUnit: "g",
          wasteReason: "spill_accident",
          note: "Waste exceeds current stock",
        },
      },
      {
        label: "negative tareWeight (-10)",
        body: {
          measurementMethod: "remaining_count",
          measuredQuantity: 750,
          measuredUnit: "g",
          tareWeight: -10,
          wasteReason: "spill_accident",
          note: "Negative tare weight must be blocked",
        },
      },
      {
        label: "negative measuredQuantity in remaining_count (-50)",
        body: {
          measurementMethod: "remaining_count",
          measuredQuantity: -50,
          measuredUnit: "g",
          tareWeight: 0,
          wasteReason: "spill_accident",
          note: "Negative gross weight must be blocked",
        },
      },
      {
        label: "net remaining < 0 (gross 50 < tare 80)",
        body: {
          measurementMethod: "remaining_count",
          measuredQuantity: 50,
          measuredUnit: "g",
          tareWeight: 80,
          wasteReason: "spill_accident",
          note: "Gross weight lower than empty container tare",
        },
      },
      {
        label: "missing note",
        body: {
          measurementMethod: "direct_measure",
          measuredQuantity: 50,
          measuredUnit: "g",
          wasteReason: "spill_accident",
          note: "",
        },
      },
      {
        label: "short note under 5 chars ('tiny')",
        body: {
          measurementMethod: "direct_measure",
          measuredQuantity: 50,
          measuredUnit: "g",
          wasteReason: "spill_accident",
          note: "tiny",
        },
      },
      {
        label: "whitespace-only note",
        body: {
          measurementMethod: "direct_measure",
          measuredQuantity: 50,
          measuredUnit: "g",
          wasteReason: "spill_accident",
          note: "     ",
        },
      },
      {
        label: "invalid wasteReason",
        body: {
          measurementMethod: "direct_measure",
          measuredQuantity: 50,
          measuredUnit: "g",
          wasteReason: "rough_guess",
          note: "Invalid waste reason enum must fail",
        },
      },
      {
        label: "invalid measurementMethod (guess estimate)",
        body: {
          measurementMethod: "approx_quarter",
          measuredQuantity: 250,
          measuredUnit: "g",
          wasteReason: "spill_accident",
          note: "Guesswork percentage mode must never exist",
        },
      },
      {
        label: "inline combined amount+unit string ('250g')",
        body: {
          measurementMethod: "direct_measure",
          measuredQuantity: "250g",
          measuredUnit: "g",
          wasteReason: "spill_accident",
          note: "Combined string in numeric quantity must fail",
        },
      },
    ];

    for (const testCase of invalidCases) {
      const res = await server.requestJson(`/api/inventory/${guardedItem.id}/waste`, {
        method: "POST",
        token: staffUser.token,
        body: {
          ...testCase.body,
          clientRequestId: randomUUID(),
        },
      });
      assert.equal(
        res.status,
        400,
        `Guard "${testCase.label}" must reject with HTTP 400, got ${res.status}: ${res.text}`,
      );
    }

    assert.equal(
      await getDbItemQuantity(guardedItem.id),
      1000,
      "Guarded item quantity must remain 1000 after all rejected attempts",
    );
    const [spoilageRows] = await pool.execute(
      `SELECT id FROM inventory_movements WHERE inventory_item_id = ? AND movement_type = 'spoilage'`,
      [guardedItem.id],
    );
    assert.equal(spoilageRows.length, 0, "Zero spoilage rows may be inserted on rejected waste attempts");
  });

  // --------------------------------------------------------------------------
  // TEST 5: STAFF COST-REDACTION & ROLE ISOLATION
  // --------------------------------------------------------------------------
  it("TEST 5 (staff cost-redaction & RBAC): blocks unauthenticated (401), strips all cost/peso fields from staff POST & GET /waste-logs, exposes wasteValue & summary totals to admin", async () => {
    const costedItem = await createTestInventoryItem({
      namePrefix: "TalaCostSecret_Test5",
      quantity: 1000,
      unit: "g",
      purchasePrice: 100,
      packageQuantity: 1,
      packageUnit: "bottle",
      contentsPerPackage: 1000, // ₱0.10/g
    });

    // Unauthenticated callers must get HTTP 401
    const unauthPost = await server.requestJson(`/api/inventory/${costedItem.id}/waste`, {
      method: "POST",
      token: null,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 100,
        measuredUnit: "g",
        wasteReason: "spill_accident",
        note: "Unauthenticated caller test",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(unauthPost.status, 401, "Unauthenticated POST /waste must return HTTP 401");

    const unauthGet = await server.requestJson("/api/inventory/waste-logs", { token: null });
    assert.equal(unauthGet.status, 401, "Unauthenticated GET /waste-logs must return HTTP 401");

    // Staff GET /api/inventory must expose non-financial packageUnit/contentsPerPackage for sealed-pack waste presets while hiding all cost fields
    const staffInvRes = await server.requestJson("/api/inventory", { token: staffUser.token });
    assert.equal(staffInvRes.status, 200);
    const staffCostedRow = staffInvRes.data.find((row) => Number(row.id) === costedItem.id);
    assert.ok(staffCostedRow, "Staff GET /api/inventory must include the active item");
    assert.equal(staffCostedRow.packageUnit, "bottle");
    assert.equal(Number(staffCostedRow.contentsPerPackage), 1000);
    assertNoStaffCostLeakage(staffInvRes.data, staffInvRes.text, "Staff GET /api/inventory");

    // Staff logs 250g direct waste -> response must strictly omit all financial/cost data
    const staffPost = await server.requestJson(`/api/inventory/${costedItem.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 250,
        measuredUnit: "g",
        wasteReason: "prep_mistake",
        note: "Overcooked batch during morning prep",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(
      staffPost.status,
      201,
      `Staff POST /waste must return HTTP 201, got ${staffPost.status}: ${staffPost.text}`,
    );
    assertNoStaffCostLeakage(staffPost.data, staffPost.text, "Staff POST /api/inventory/:id/waste");

    // Staff fetches GET /api/inventory/waste-logs -> zero cost/peso leakage
    const staffLogs = await server.requestJson(`/api/inventory/waste-logs?itemId=${costedItem.id}`, {
      token: staffUser.token,
    });
    assert.equal(
      staffLogs.status,
      200,
      `Staff GET /api/inventory/waste-logs must return HTTP 200, got ${staffLogs.status}: ${staffLogs.text}`,
    );
    assert.ok(Array.isArray(staffLogs.data?.items), "GET /waste-logs must return an items array");
    const staffEntry = staffLogs.data.items.find((row) => Number(row.itemId) === costedItem.id);
    assert.ok(staffEntry, "Staff waste-logs feed must include the logged waste entry");
    assert.equal(Number(staffEntry.deductedQuantity), 250);
    assert.equal(staffEntry.wasteReason, "prep_mistake");
    assert.equal(staffEntry.measurementMethod, "direct_measure");
    assertNoStaffCostLeakage(staffLogs.data, staffLogs.text, "Staff GET /api/inventory/waste-logs");

    // Admin fetches GET /api/inventory/waste-logs -> receives wasteValue & summary totals
    const adminLogs = await server.requestJson(`/api/inventory/waste-logs?itemId=${costedItem.id}&scope=today`, {
      token: adminUser.token,
    });
    assert.equal(adminLogs.status, 200);
    assert.ok(Array.isArray(adminLogs.data?.items));
    const adminEntry = adminLogs.data.items.find((row) => Number(row.itemId) === costedItem.id);
    assert.ok(adminEntry, "Admin waste-logs feed must include the logged waste entry");
    assert.equal(Number(adminEntry.wasteValue), 25.00, "Admin entry must expose exact wasteValue = 25.00");
    assert.ok(
      Number(adminLogs.data.totalWasteEventsToday) >= 1,
      "Admin summary must expose totalWasteEventsToday >= 1",
    );
    assert.ok(
      Number(adminLogs.data.totalWasteLossToday) >= 25.00,
      "Admin summary must expose totalWasteLossToday >= 25.00",
    );
    assert.ok(
      Array.isArray(adminLogs.data.topWastedItems) && adminLogs.data.topWastedItems.length >= 1,
      "Admin summary must expose topWastedItems list",
    );
  });

  // --------------------------------------------------------------------------
  // TEST 6: IDEMPOTENCY & APPEND-ONLY ADMIN REVERSAL GUARD
  // --------------------------------------------------------------------------
  it("TEST 6 (idempotency & append-only reversal): deduplicates clientRequestId without double-deduction, blocks staff reversal (403), reverses stock & DR 1050 / CR 6030 for admin, and blocks double-reversal", async () => {
    const idempItem = await createTestInventoryItem({
      namePrefix: "TalaIdemp_Test6",
      quantity: 1000,
      unit: "g",
      purchasePrice: 100,
      packageQuantity: 1,
      packageUnit: "bottle",
      contentsPerPackage: 1000, // ₱0.10/g
    });

    const reqId = randomUUID();
    const firstRes = await server.requestJson(`/api/inventory/${idempItem.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 200,
        measuredUnit: "g",
        wasteReason: "spill_accident",
        note: "Dropped pitcher while pouring oil",
        clientRequestId: reqId,
      },
    });
    assert.equal(
      firstRes.status,
      201,
      `First waste post must return HTTP 201, got ${firstRes.status}: ${firstRes.text}`,
    );
    const movementId = Number(firstRes.data.id ?? firstRes.data.movementId);
    assert.ok(Number.isSafeInteger(movementId) && movementId > 0);
    assert.equal(await getDbItemQuantity(idempItem.id), 800);

    // Duplicate retry with identical clientRequestId -> HTTP 200, no double deduction
    const dupRes = await server.requestJson(`/api/inventory/${idempItem.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 200,
        measuredUnit: "g",
        wasteReason: "spill_accident",
        note: "Dropped pitcher while pouring oil",
        clientRequestId: reqId,
      },
    });
    assert.equal(
      dupRes.status,
      200,
      `Duplicate clientRequestId retry must return HTTP 200, got ${dupRes.status}: ${dupRes.text}`,
    );
    assert.equal(Number(dupRes.data.id ?? dupRes.data.movementId), movementId, "Idempotent replay must return original log id");
    assert.equal(await getDbItemQuantity(idempItem.id), 800, "Duplicate clientRequestId must NOT double-deduct stock");

    const [spoilageRows] = await pool.execute(
      `SELECT id FROM inventory_movements WHERE inventory_item_id = ? AND movement_type = 'spoilage'`,
      [idempItem.id],
    );
    assert.equal(spoilageRows.length, 1, "Duplicate clientRequestId must insert only ONE spoilage movement");

    const [origJeRows] = await pool.execute(
      `SELECT id FROM journal_entries WHERE inventory_movement_id = ?`,
      [movementId],
    );
    assert.equal(origJeRows.length, 1, "Duplicate clientRequestId must post only ONE 6030 journal entry");
    const origJeId = Number(origJeRows[0].id);

    // Staff attempting to reverse waste log -> HTTP 403 Forbidden
    const staffReverseRes = await server.requestJson(`/api/inventory/waste-logs/${movementId}/reverse`, {
      method: "POST",
      token: staffUser.token,
      body: { reason: "Staff should not be able to undo waste" },
    });
    assert.equal(
      staffReverseRes.status,
      403,
      `Staff attempting waste reversal must get HTTP 403, got ${staffReverseRes.status}`,
    );
    assert.equal(await getDbItemQuantity(idempItem.id), 800, "Stock must remain 800 after blocked staff reversal");

    // Admin reverses waste log -> restores stock to 1000, writes append-only adjustment + reversing journal (DR 1050 / CR 6030)
    const adminReverseRes = await server.requestJson(`/api/inventory/waste-logs/${movementId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Cashier accidentally logged wrong scale tare" },
    });
    assert.ok(
      adminReverseRes.status === 200 || adminReverseRes.status === 201,
      `Admin waste reversal must return HTTP 200/201, got ${adminReverseRes.status}: ${adminReverseRes.text}`,
    );
    assert.equal(await getDbItemQuantity(idempItem.id), 1000, "Admin reversal must restore exact 200g back to 1000g");

    // Original spoilage movement must still exist (append-only) AND a reversing adjustment movement must exist
    const [allMovs] = await pool.execute(
      `SELECT id, movement_type, quantity_change, before_quantity, after_quantity, note
         FROM inventory_movements
        WHERE inventory_item_id = ?
        ORDER BY id ASC`,
      [idempItem.id],
    );
    const originalSpoilageStillThere = allMovs.find((m) => Number(m.id) === movementId && m.movement_type === "spoilage");
    assert.ok(originalSpoilageStillThere, "Original spoilage movement must NEVER be deleted (append-only ledger)");

    const reversalAdj = allMovs.find(
      (m) => m.movement_type === "adjustment" && Number(m.quantity_change) === 200 && Number(m.after_quantity) === 1000,
    );
    assert.ok(reversalAdj, "Admin reversal must append an adjustment movement restoring +200g (800 -> 1000)");

    // Verify reversing journal entry DR 1050 ₱20.00 / CR 6030 ₱20.00 linked to origJeId
    const [[revJeRow]] = await pool.execute(
      `SELECT id, is_reversal, reverses_entry_id
         FROM journal_entries
        WHERE reverses_entry_id = ?
        LIMIT 1`,
      [origJeId],
    );
    assert.ok(revJeRow, "Admin reversal must create a reversing journal_entries row linked via reverses_entry_id");
    assert.equal(revJeRow.is_reversal, 1);

    const [revLines] = await pool.execute(
      `SELECT jel.debit, jel.credit, coa.account_code
         FROM journal_entry_lines jel
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE jel.journal_entry_id = ?`,
      [revJeRow.id],
    );
    assert.ok(
      revLines.find((l) => l.account_code === "1050" && Number(l.debit) === 20.00 && Number(l.credit) === 0),
      "Reversal journal must DR 1050 Merchandise Inventory ₱20.00",
    );
    assert.ok(
      revLines.find((l) => l.account_code === "6030" && Number(l.credit) === 20.00 && Number(l.debit) === 0),
      "Reversal journal must CR 6030 Inventory Wastage & Spoilage ₱20.00",
    );

    // Double-reversal attempt must be blocked (409 or 400) without re-crediting stock
    const doubleRevRes = await server.requestJson(`/api/inventory/waste-logs/${movementId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Attempt duplicate reversal" },
    });
    assert.ok(
      doubleRevRes.status === 409 || doubleRevRes.status === 400,
      `Double reversal must be blocked with HTTP 409 or 400, got ${doubleRevRes.status}`,
    );
    assert.equal(await getDbItemQuantity(idempItem.id), 1000, "Double reversal must NOT inflate stock above 1000g");
  });

  // --------------------------------------------------------------------------
  // TEST 7: DYNAMIC MENU STOCK SYNC ON WASTE DEDUCTION
  // --------------------------------------------------------------------------
  it("TEST 7 (dynamic menu stock sync): product using Oil (20g/serving) drops immediately from 50 to 37 servings on GET /api/menu after 250g oil waste", async () => {
    const oil = await createTestInventoryItem({
      namePrefix: "TalaSyncOil_Test7",
      category: "Ingredients",
      quantity: 1000,
      unit: "g",
      purchasePrice: 100,
      packageQuantity: 1,
      packageUnit: "bottle",
      contentsPerPackage: 1000,
    });

    const catName = makeUniqueTag("TalaWasteCat");
    const [catRes] = await pool.execute(
      "INSERT INTO menu_categories (name, operational_family) VALUES (?, 'general')",
      [catName],
    );
    tracker.menuCategoryIds.add(Number(catRes.insertId));

    const prodName = makeUniqueTag("TalaCrispyFries");
    const menuCreateRes = await server.requestJson("/api/menu", {
      method: "POST",
      token: adminUser.token,
      body: {
        name: prodName,
        category: catName,
        basePrice: 85,
        available: true,
        ingredients: [
          {
            inventoryItemId: oil.id,
            name: oil.item,
            quantityUsed: 20,
            unit: "g",
            stockUnit: "g",
          },
        ],
      },
    });
    assert.equal(
      menuCreateRes.status,
      201,
      `Creating test menu product must return HTTP 201, got ${menuCreateRes.status}: ${menuCreateRes.text}`,
    );
    const productId = Number(menuCreateRes.data.id);
    tracker.productIds.add(productId);

    // Baseline check: 1000g / 20g = 50 servings
    const menuBefore = await server.requestJson("/api/menu", { token: staffUser.token });
    assert.equal(menuBefore.status, 200);
    const prodBefore = menuBefore.data.find((p) => Number(p.id) === productId);
    assert.ok(prodBefore, "Menu product must appear in GET /api/menu");
    assert.equal(Number(prodBefore.stock), 50, "Baseline product stock must be 50 servings (1000g / 20g)");

    // Staff logs 250g oil waste via weigh-back (remaining 750g)
    const wasteRes = await server.requestJson(`/api/inventory/${oil.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "remaining_count",
        measuredQuantity: 750,
        measuredUnit: "g",
        tareWeight: 0,
        wasteReason: "spill_accident",
        note: "Dropped bottle beside fryer during lunch rush",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(
      wasteRes.status,
      201,
      `Oil waste post must return HTTP 201, got ${wasteRes.status}: ${wasteRes.text}`,
    );
    assert.equal(Number(wasteRes.data.afterQuantity), 750);

    // Immediate menu sync check: floor(750g / 20g) = 37 servings (both staff POS and public customer view)
    const menuAfterStaff = await server.requestJson("/api/menu", { token: staffUser.token });
    assert.equal(menuAfterStaff.status, 200);
    const prodAfterStaff = menuAfterStaff.data.find((p) => Number(p.id) === productId);
    assert.equal(Number(prodAfterStaff.stock), 37, "Staff POS menu stock must drop immediately to 37 servings");

    const menuAfterPublic = await server.requestJson("/api/menu", { token: null });
    assert.equal(menuAfterPublic.status, 200);
    const prodAfterPublic = menuAfterPublic.data.find((p) => Number(p.id) === productId);
    assert.equal(Number(prodAfterPublic.stock), 37, "Customer public menu stock must drop immediately to 37 servings");
  });

  // --------------------------------------------------------------------------
  // TEST 8: SCOPED IDEMPOTENCY CONFLICT GUARDS & CONCURRENT DEDUPLICATION
  // --------------------------------------------------------------------------
  it("TEST 8 (idempotency hardening): rejects malformed clientRequestId (400), rejects cross-item/cross-payload key reuse (409), scopes keys per-user, and deduplicates concurrent bursts", async () => {
    const itemA = await createTestInventoryItem({ namePrefix: "TalaIdempA_Test8", quantity: 500, unit: "g" });
    const itemB = await createTestInventoryItem({ namePrefix: "TalaIdempB_Test8", quantity: 500, unit: "g" });

    // Malformed clientRequestId -> 400
    const badReqRes = await server.requestJson(`/api/inventory/${itemA.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 50,
        measuredUnit: "g",
        wasteReason: "spill_accident",
        note: "Bad client id check",
        clientRequestId: "short",
      },
    });
    assert.equal(badReqRes.status, 400);

    const sharedKey = randomUUID();
    const firstCreate = await server.requestJson(`/api/inventory/${itemA.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 100,
        measuredUnit: "g",
        wasteReason: "spill_accident",
        note: "Original spill on item A",
        clientRequestId: sharedKey,
      },
    });
    assert.equal(firstCreate.status, 201);

    // Cross-item reuse by same user -> 409
    const crossItemRes = await server.requestJson(`/api/inventory/${itemB.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 100,
        measuredUnit: "g",
        wasteReason: "spill_accident",
        note: "Original spill on item A",
        clientRequestId: sharedKey,
      },
    });
    assert.equal(crossItemRes.status, 409, "Cross-item clientRequestId reuse must fail with 409");
    assert.equal(await getDbItemQuantity(itemB.id), 500);

    // Same item but mismatched payload -> 409
    const diffPayloadRes = await server.requestJson(`/api/inventory/${itemA.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 50,
        measuredUnit: "g",
        wasteReason: "spill_accident",
        note: "Changed quantity on same key",
        clientRequestId: sharedKey,
      },
    });
    assert.equal(diffPayloadRes.status, 409, "Same key with altered payload must fail with 409");
    assert.equal(await getDbItemQuantity(itemA.id), 400);

    // Different actor using same key string does not collide across accounts
    const diffUserRes = await server.requestJson(`/api/inventory/${itemB.id}/waste`, {
      method: "POST",
      token: adminUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 25,
        measuredUnit: "g",
        wasteReason: "quality_reject",
        note: "Separate actor independent key namespace",
        clientRequestId: sharedKey,
      },
    });
    assert.equal(diffUserRes.status, 201, "Different user reusing UUID string must succeed independently");
    assert.equal(await getDbItemQuantity(itemB.id), 475);

    // Concurrent identical burst -> deduplicates cleanly (only 1 deduction)
    const burstKey = randomUUID();
    const burstPayload = {
      measurementMethod: "direct_measure",
      measuredQuantity: 50,
      measuredUnit: "g",
      wasteReason: "prep_mistake",
      note: "Concurrent double-click burst",
      clientRequestId: burstKey,
    };
    const [b1, b2] = await Promise.all([
      server.requestJson(`/api/inventory/${itemA.id}/waste`, { method: "POST", token: staffUser.token, body: burstPayload }),
      server.requestJson(`/api/inventory/${itemA.id}/waste`, { method: "POST", token: staffUser.token, body: burstPayload }),
    ]);
    assert.deepEqual([b1.status, b2.status].sort(), [200, 201]);
    assert.equal(Number(b1.data.id), Number(b2.data.id));
    assert.equal(await getDbItemQuantity(itemA.id), 350);
  });

  // --------------------------------------------------------------------------
  // TEST 9: PRECISION BOUNDS, 1M+ DOWN-UNIT OVERFLOW FIX & PAIR/DOZEN GUARDS
  // --------------------------------------------------------------------------
  it("TEST 9 (precision & unit bounds): persists >= 1,000,000 ml down-unit conversions (DECIMAL 16,6), rejects sub-micro 1e-10, and enforces integer pair/dozen counts", async () => {
    const bulkLiquid = await createTestInventoryItem({
      namePrefix: "TalaBulkLiquid_Test9",
      quantity: 2000,
      unit: "l",
      purchasePrice: 4000,
      packageQuantity: 1,
      packageUnit: "bottle",
      contentsPerPackage: 1,
    });

    const largeMlRes = await server.requestJson(`/api/inventory/${bulkLiquid.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 1500000,
        measuredUnit: "ml",
        wasteReason: "damaged_contaminated",
        note: "Broken drum seal spilled 1500000 ml",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(largeMlRes.status, 201, `1,500,000 ml waste failed: ${largeMlRes.text}`);
    assert.equal(Number(largeMlRes.data.deductedQuantity), 1500);
    assert.equal(Number(largeMlRes.data.measuredInputQty), 1500000);
    assert.equal(await getDbItemQuantity(bulkLiquid.id), 500);

    // Reject sub-micro quantity
    const subMicroRes = await server.requestJson(`/api/inventory/${bulkLiquid.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 1e-10,
        measuredUnit: "l",
        wasteReason: "spill_accident",
        note: "Sub-micro should fail",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(subMicroRes.status, 400);

    // Pair and dozen discrete integer checks
    const pairItem = await createTestInventoryItem({ namePrefix: "TalaPair_Test9", quantity: 10, unit: "pair" });
    const badPairRes = await server.requestJson(`/api/inventory/${pairItem.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 0.37,
        measuredUnit: "pair",
        wasteReason: "damaged_contaminated",
        note: "Fractional pair test",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(badPairRes.status, 400);

    const dozenItem = await createTestInventoryItem({ namePrefix: "TalaDozen_Test9", quantity: 10, unit: "dozen" });
    const badDozenRes = await server.requestJson(`/api/inventory/${dozenItem.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 0.125,
        measuredUnit: "dozen",
        wasteReason: "damaged_contaminated",
        note: "Fractional dozen test",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(badDozenRes.status, 400);

    // Discrete container stock unit (bottle) must reject 0.5 bottle
    const bottleItem = await createTestInventoryItem({
      namePrefix: "TalaBottle_Test9",
      quantity: 10,
      unit: "bottle",
      packageUnit: "bottle",
      contentsPerPackage: 1,
    });
    const badBottleRes = await server.requestJson(`/api/inventory/${bottleItem.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 0.5,
        measuredUnit: "bottle",
        wasteReason: "spill_accident",
        note: "Fractional bottle container check",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(badBottleRes.status, 400, "Discrete container unit 'bottle' must reject 0.5 bottle");
  });

  // --------------------------------------------------------------------------
  // TEST 10: REVERSAL GUARDS (ARCHIVED, NON-WASTE, PRE-REVERSED GL & WAC)
  // --------------------------------------------------------------------------
  it("TEST 10 (reversal integrity): blocks non-waste/archived reversals, handles pre-reversed GL without 409 deadlock, and rebalances WAC", async () => {
    const wacItem = await createTestInventoryItem({
      namePrefix: "TalaWacRev_Test10",
      quantity: 1000,
      unit: "g",
      purchasePrice: 100, // 0.10 / g
      packageQuantity: 1,
      packageUnit: "bottle",
      contentsPerPackage: 1000,
    });

    const wasteRes = await server.requestJson(`/api/inventory/${wacItem.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 500,
        measuredUnit: "g",
        wasteReason: "expired_spoiled",
        note: "Expired batch cleared for WAC test",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(wasteRes.status, 201);
    const wasteMoveId = Number(wasteRes.data.id);

    // Restock +500g at 100 pesos (0.20/g) -> 1000g total, WAC = (500*0.10 + 100)/1000 = 0.15/g
    const restockRes = await server.requestJson(`/api/inventory/${wacItem.id}/restock`, {
      method: "POST",
      token: adminUser.token,
      body: { quantity: 500, batchCost: 100 },
    });
    assert.equal(restockRes.status, 200);

    // Simulate pre-existing Finances GL reversal linked to origJe
    const [[origJe]] = await pool.execute(
      "SELECT id, entry_number FROM journal_entries WHERE inventory_movement_id = ? AND is_reversal = FALSE LIMIT 1",
      [wasteMoveId],
    );
    assert.ok(origJe, "Original waste GL entry must exist");
    const [preRevJe] = await pool.execute(
      `INSERT INTO journal_entries (
         entry_number, entry_type, memo, reference_number,
         inventory_movement_id, is_reversal, reverses_entry_id, idempotency_key, created_by
       ) VALUES (?, 'void_reversal', 'Simulated Finances GL reversal', ?, ?, TRUE, ?, ?, ?)`,
      [
        `REV-PRE-${wasteMoveId}`,
        `REV-PRE-${wasteMoveId}`,
        wasteMoveId,
        origJe.id,
        `sim_fin_rev:${origJe.id}:${randomUUID()}`,
        adminUser.id,
      ],
    );
    const preRevJeId = Number(preRevJe.insertId);

    // Now reverse waste movement -> must succeed cleanly, link preRevJeId, restore +500g, and rebalance WAC
    const revRes = await server.requestJson(`/api/inventory/waste-logs/${wasteMoveId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Verified physical batch wasn't expired" },
    });
    assert.equal(revRes.status, 200, `Reversal after pre-reversed GL failed: ${revRes.text}`);
    assert.equal(Number(revRes.data.journalEntryId), preRevJeId);
    assert.equal(await getDbItemQuantity(wacItem.id), 1500);
    const [[rebalancedRow]] = await pool.execute(
      "SELECT unit_cost FROM inventory_items WHERE id = ? LIMIT 1",
      [wacItem.id],
    );
    // (1000 * 0.15 + 50.00) / 1500 = 200 / 1500 = 0.133333
    assert.ok(Math.abs(Number(rebalancedRow.unit_cost) - 0.133333) < 0.0001);

    // Non-waste spoilage movement (no waste_reason) -> blocked 400
    const [legacyMove] = await pool.execute(
      `INSERT INTO inventory_movements (
         inventory_item_id, user_id, movement_type, quantity_change, note,
         item_name_snapshot, actor_name_snapshot, before_quantity, after_quantity, unit
       ) VALUES (?, ?, 'spoilage', -5, 'Legacy row without waste_reason', ?, 'Test', 1500, 1495, 'g')`,
      [wacItem.id, staffUser.id, wacItem.item],
    );
    const legacyRevRes = await server.requestJson(`/api/inventory/waste-logs/${legacyMove.insertId}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Should reject legacy/order spoilage" },
    });
    assert.equal(legacyRevRes.status, 400);

    // Archived item reversal -> blocked 409
    const archItem = await createTestInventoryItem({ namePrefix: "TalaArchRev_Test10", quantity: 100, unit: "g" });
    const archWasteRes = await server.requestJson(`/api/inventory/${archItem.id}/waste`, {
      method: "POST",
      token: staffUser.token,
      body: {
        measurementMethod: "direct_measure",
        measuredQuantity: 10,
        measuredUnit: "g",
        wasteReason: "spill_accident",
        note: "Before item archive",
        clientRequestId: randomUUID(),
      },
    });
    assert.equal(archWasteRes.status, 201);
    const archiveDelRes = await server.requestJson(`/api/inventory/${archItem.id}`, {
      method: "DELETE",
      token: adminUser.token,
    });
    assert.equal(archiveDelRes.status, 204);
    const revArchRes = await server.requestJson(`/api/inventory/waste-logs/${archWasteRes.data.id}/reverse`, {
      method: "POST",
      token: adminUser.token,
      body: { reason: "Attempt reverse while archived" },
    });
    assert.equal(revArchRes.status, 409);
  });
});
