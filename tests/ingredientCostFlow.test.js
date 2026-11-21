import "./helpers/loadEnv.js";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pool from "../api/src/database.js";
import { getManilaDateString } from "../shared/manilaDate.js";
import { getWasteKind } from "../shared/wasteMeasurement.js";
import { isWholeNumberUnit } from "../shared/units.js";
import { createCleanupTracker, makeUniqueTag, startTestServer } from "./helpers/testServer.js";

const round2 = (value) => Math.round(Number(value) * 100) / 100;

describe("Ingredient cost flow: waste, shrinkage and actual vs theoretical food cost", () => {
  let server;
  let admin;
  let staff;
  const tracker = createCleanupTracker();
  const createdItemNames = new Set();
  const today = getManilaDateString();

  async function createItem({ quantity = 1000, unit = "g", purchasePrice = 100, contentsPerPackage = 1000 } = {}) {
    const itemName = makeUniqueTag("CostFlowItem");
    createdItemNames.add(itemName);
    const res = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: { item: itemName, category: "Ingredients", quantity, unit, purchasePrice, packageQuantity: 1, packageUnit: "bottle", contentsPerPackage },
    });
    assert.equal(res.status, 201, res.text);
    tracker.inventoryItemIds.add(Number(res.data.id));
    return res.data;
  }

  async function flow() {
    const res = await server.requestJson(`/api/inventory/cost-flow?from=${today}&to=${today}`, { token: admin.token });
    assert.equal(res.status, 200, res.text);
    return res.data;
  }

  before(async () => {
    server = await startTestServer();
    admin = await tracker.createUser({ role: "admin", displayName: makeUniqueTag("Flow Admin"), username: makeUniqueTag("flow_admin").toLowerCase() });
    staff = await tracker.createUser({ role: "staff", displayName: makeUniqueTag("Flow Staff"), username: makeUniqueTag("flow_staff").toLowerCase() });
  });

  after(async () => {
    try {
      for (const pattern of createdItemNames) {
        await pool.execute(
          "DELETE FROM notifications WHERE type = 'inventory_waste' AND (title LIKE ? OR message LIKE ?)",
          [`%${pattern}%`, `%${pattern}%`],
        );
      }
      const invIds = [...tracker.inventoryItemIds];
      if (invIds.length > 0) {
        const invMarks = invIds.map(() => "?").join(",");
        const [movRows] = await pool.execute(`SELECT id FROM inventory_movements WHERE inventory_item_id IN (${invMarks})`, invIds);
        const movIds = movRows.map((row) => Number(row.id));
        if (movIds.length > 0) {
          const movMarks = movIds.map(() => "?").join(",");
          const [jeRows] = await pool.execute(`SELECT id FROM journal_entries WHERE inventory_movement_id IN (${movMarks})`, movIds);
          const jeIds = jeRows.map((row) => Number(row.id));
          if (jeIds.length > 0) {
            const jeMarks = jeIds.map(() => "?").join(",");
            await pool.execute(`DELETE FROM journal_entry_lines WHERE journal_entry_id IN (${jeMarks})`, jeIds);
            await pool.execute(`UPDATE journal_entries SET reverses_entry_id = NULL WHERE id IN (${jeMarks}) OR reverses_entry_id IN (${jeMarks})`, [...jeIds, ...jeIds]);
            await pool.execute(`DELETE FROM journal_entries WHERE id IN (${jeMarks})`, jeIds);
          }
        }
      }
      await tracker.cleanup();
    } finally {
      try {
        if (server) await server.close();
      } finally {
        await pool.end();
      }
    }
  });

  it("only admins can read the cost flow", async () => {
    const res = await server.requestJson("/api/inventory/cost-flow", { token: staff.token });
    assert.equal(res.status, 403);
  });

  it("a recount posts to 6031 shrinkage (never 6030 waste or 3010 equity) and the flow table adds up", async () => {
    const item = await createItem(); // ₱0.10 per g
    const before = await flow();

    // Waste 250 g of spilled stock: DR 6030 / CR 1050 for ₱25.00
    const wasteRes = await server.requestJson(`/api/inventory/${item.id}/waste`, {
      method: "POST",
      token: admin.token,
      body: { measurementMethod: "direct_measure", measuredQuantity: 250, measuredUnit: "g", wasteReason: "spilled", clientRequestId: randomUUID() },
    });
    assert.equal(wasteRes.status, 201, wasteRes.text);

    // Recount finds 50 g less than the books say (750 -> 700): DR 6031 / CR 1050 for ₱5.00
    const putBody = (quantity) => ({ item: item.item, category: "Ingredients", unit: "g", quantity, purchasePrice: 100, packageQuantity: 1, packageUnit: "bottle", contentsPerPackage: 1000 });
    const shortRes = await server.requestJson(`/api/inventory/${item.id}`, { method: "PUT", token: admin.token, body: putBody(700) });
    assert.equal(shortRes.status, 200, shortRes.text);
    // Recount finds 20 g more (700 -> 720): CR 6031 / DR 1050 for ₱2.00, an overage
    const overRes = await server.requestJson(`/api/inventory/${item.id}`, { method: "PUT", token: admin.token, body: putBody(720) });
    assert.equal(overRes.status, 200, overRes.text);

    const [lines] = await pool.execute(
      `SELECT coa.account_code, SUM(jel.debit) AS debit, SUM(jel.credit) AS credit
         FROM inventory_movements m
         JOIN journal_entries je ON je.inventory_movement_id = m.id
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         JOIN chart_of_accounts coa ON coa.id = jel.account_id
        WHERE m.inventory_item_id = ? AND m.movement_type = 'adjustment'
        GROUP BY coa.account_code`,
      [item.id],
    );
    const byCode = Object.fromEntries(lines.map((row) => [row.account_code, row]));
    assert.ok(byCode["6031"], "recounts must post to 6031");
    assert.equal(byCode["6030"], undefined, "recounts must never post to 6030 Waste Cost");
    assert.equal(byCode["3010"], undefined, "recounts must never post to 3010 Owner's Capital");
    assert.equal(round2(byCode["6031"].debit), 5.0);
    assert.equal(round2(byCode["6031"].credit), 2.0);

    const after = await flow();
    assert.equal(round2(after.flow.waste - before.flow.waste), 25.0, "waste grows by the logged spill");
    assert.equal(round2(after.flow.shrinkage - before.flow.shrinkage), 3.0, "net shrinkage is 5.00 short minus 2.00 over");

    // Opening + Bought = Sold + Waste + Store use + Shrinkage + Closing, always
    const f = after.flow;
    assert.equal(
      round2(f.opening + f.bought - f.soldInDrinks - f.waste - f.storeUse - f.shrinkage),
      round2(f.closing),
      "the flow table must add up",
    );
    assert.equal(
      round2(after.foodCost.actual),
      round2(f.soldInDrinks + f.waste + f.shrinkage),
      "actual food cost = recipe cost + waste + shrinkage",
    );
    assert.equal(round2(after.foodCost.gap), round2(f.waste + f.shrinkage));

    const spilled = after.waste.byReason.find((row) => row.reason === "spilled");
    assert.ok(spilled && spilled.kind === "avoidable", "spilled stock is avoidable waste");
  });

  it("prep trimming counts as normal waste and every other reason as avoidable", async () => {
    assert.equal(getWasteKind("prep_trim"), "normal");
    for (const reason of ["spoiled", "expired", "damaged", "spilled", "other", "spill_accident"]) {
      assert.equal(getWasteKind(reason), "avoidable", reason);
    }
    const item = await createItem();
    const before = await flow();
    const res = await server.requestJson(`/api/inventory/${item.id}/waste`, {
      method: "POST",
      token: admin.token,
      body: { measurementMethod: "direct_measure", measuredQuantity: 100, measuredUnit: "g", wasteReason: "prep_trim", clientRequestId: randomUUID() },
    });
    assert.equal(res.status, 201, res.text);
    const after = await flow();
    assert.equal(round2(after.waste.normal - before.waste.normal), 10.0);
    assert.equal(round2(after.waste.total - before.waste.total), 10.0);
  });

  it("pieces, cans and pairs only take whole numbers", async () => {
    assert.equal(isWholeNumberUnit("pcs"), true);
    assert.equal(isWholeNumberUnit("can"), true);
    assert.equal(isWholeNumberUnit("pair"), true);
    assert.equal(isWholeNumberUnit("dozen"), false);
    assert.equal(isWholeNumberUnit("g"), false);

    const badCreate = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: { item: makeUniqueTag("CostFlowPcs"), category: "Ingredients", quantity: 10.5, unit: "pcs" },
    });
    assert.equal(badCreate.status, 400, badCreate.text);
    assert.match(badCreate.text, /whole number/i);

    const okCreate = await server.requestJson("/api/inventory", {
      method: "POST",
      token: admin.token,
      body: { item: makeUniqueTag("CostFlowPcsOk"), category: "Ingredients", quantity: 10, unit: "pcs" },
    });
    assert.equal(okCreate.status, 201, okCreate.text);
    tracker.inventoryItemIds.add(Number(okCreate.data.id));
  });
});
