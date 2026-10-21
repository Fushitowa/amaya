import { Router } from "express";
import pool from "../database.js";
import { httpError, requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

async function evaluateWithTypeSafe(state, questions) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw httpError(503, "TYPESAFE_API_KEY is not configured on the server.");
  }
  const response = await fetch(TYPESAFE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state,
      questions,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw httpError(502, `TypeSafe Jev evaluation failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * POST /api/decisions/inventory-triage
 * Evaluates current warehouse stock levels using TypeSafe System One (Jev)
 * to return calibrated restock urgency scores and recommended procurement actions.
 */
router.post("/inventory-triage", requireAuth, requireRole("admin"), async (_request, response) => {
  const [items] = await pool.execute(
    `SELECT id, name, category, quantity, unit, maximum_stock, unit_cost
       FROM inventory_items
      WHERE is_archived = FALSE
      ORDER BY quantity ASC, name ASC
      LIMIT 25`,
  );

  if (!items.length) {
    return response.json({ model: "jev-latest", items: [], summary: null });
  }

  const stateItems = items.map((item) => {
    const qty = Number(item.quantity || 0);
    const max = item.maximum_stock == null ? null : Number(item.maximum_stock);
    const fillRatio = max && max > 0 ? Number(((qty / max) * 100).toFixed(1)) : null;
    return {
      id: Number(item.id),
      name: item.name,
      category: item.category,
      quantity: qty,
      unit: item.unit,
      maximumStock: max,
      fillPercent: fillRatio,
      unitCost: Number(item.unit_cost || 0),
    };
  });

  const urgencyRubric = [
    "Healthy stock: no restock needed right now",
    "Monitor: moderate stock, plan routine replenishment soon",
    "Low stock warning: prioritize in the next supplier purchase batch",
    "Critical shortage / Out of stock: immediate emergency restock required to prevent menu stockouts",
  ];

  const questions = {
    overall_warehouse_action: {
      type: "choice",
      instructions: "What is the top procurement priority for the store manager based on `inventory`?",
      criteria: {
        immediate_emergency_restock: "One or more core ingredients are depleted (0) or critically low (< 15% of maximum stock)",
        scheduled_batch_replenishment: "No items are completely out of stock, but several are approaching low-stock thresholds",
        warehouse_healthy_hold_orders: "All tracked ingredients have comfortable stock levels",
      },
    },
  };

  for (const entry of stateItems.slice(0, 10)) {
    questions[`item_${entry.id}_urgency`] = {
      type: "score",
      instructions: `Rate the restock urgency for ingredient "${entry.name}" (quantity: ${entry.quantity} ${entry.unit}, fillPercent: ${entry.fillPercent ?? "unset"}%).`,
      criteria: urgencyRubric,
    };
  }

  const evaluation = await evaluateWithTypeSafe({ inventory: stateItems }, questions);
  const answers = evaluation.answers || {};

  const triagedItems = stateItems.slice(0, 10).map((entry) => {
    const ans = answers[`item_${entry.id}_urgency`];
    return {
      ...entry,
      urgencyScore: ans?.score ?? null,
      confidence: ans?.confidence ?? null,
    };
  });

  response.json({
    model: evaluation.model || "jev-latest",
    overallAction: answers.overall_warehouse_action || null,
    items: triagedItems,
    usage: evaluation.usage || null,
  });
});

/**
 * POST /api/decisions/order-guard
 * Evaluates a kitchen instruction or order cancellation request using TypeSafe Jev.
 */
router.post("/order-guard", requireAuth, requireRole("admin", "staff"), async (request, response) => {
  const note = String(request.body?.note || "").trim().slice(0, 500);
  const orderTotal = Number(request.body?.total || 0);
  if (!note) {
    throw httpError(400, "Provide a customer note or cancellation reason to evaluate.");
  }

  const evaluation = await evaluateWithTypeSafe(
    { note, orderTotal },
    {
      requests_unpaid_extra_addon: {
        type: "noul",
        instructions: "Does `note` ask for extra paid toppings/add-ons (such as extra pearls, extra cheese, extra shots, or upsizing) inside the free-text kitchen instructions without paying?",
        criteria: {
          true: "Asks for extra physical ingredients, toppings, or larger size in the note",
          false: "Normal preparation preference (ice/sugar level, allergy note, packaging request)",
        },
      },
      contains_allergy_or_dietary_warning: {
        type: "noul",
        instructions: "Does `note` mention a food allergy, intolerance, or strict medical dietary restriction?",
        criteria: {
          true: "Mentions allergy, dairy/lactose intolerance, nut allergy, or medical restriction",
          false: "Standard taste preference with no allergy or medical risk",
        },
      },
    },
  );

  response.json({
    model: evaluation.model || "jev-latest",
    answers: evaluation.answers || {},
    usage: evaluation.usage || null,
  });
});

export default router;
