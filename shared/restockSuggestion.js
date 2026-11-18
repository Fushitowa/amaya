import {
  round2,
  round6,
  isDiscreteCountUnit,
  toInventoryQuantity,
} from "./units.js";
import {
  getManilaDateString,
  getManilaTodayDateStr,
} from "./manilaDate.js";

const URGENCY_ORDER = Object.freeze({
  critical: 0,
  low: 1,
  velocity_alert: 2,
  ok: 3,
});

export function addDaysIsoDate(isoDate, deltaDays) {
  const [y, m, d] = String(isoDate || "").split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = String(dt.getUTCFullYear()).padStart(4, "0");
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function inclusiveDaysBetween(fromDateStr, toDateStr) {
  const [y1, m1, d1] = String(fromDateStr || "").split("-").map(Number);
  const [y2, m2, d2] = String(toDateStr || "").split("-").map(Number);
  if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 1;
  const ms = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export function convertConsumptionToStockUnit(quantityUsed, consumptionUnit, stockUnit) {
  const amount = Number(quantityUsed || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const converted = toInventoryQuantity(amount, consumptionUnit || stockUnit, stockUnit);
  return converted == null ? 0 : converted;
}

function getEffectiveUnitCost(item) {
  const unitCostRaw = Number(item.unitCost ?? item.unit_cost ?? 0);
  if (Number.isFinite(unitCostRaw) && unitCostRaw > 0) return unitCostRaw;
  const purchasePrice = Number(item.purchasePrice ?? item.purchase_price ?? 0);
  const contentsPerPackage = Number(item.contentsPerPackage ?? item.contents_per_package ?? 1);
  if (
    Number.isFinite(purchasePrice)
    && purchasePrice > 0
    && Number.isFinite(contentsPerPackage)
    && contentsPerPackage > 0
  ) {
    return purchasePrice / contentsPerPackage;
  }
  return 0;
}

/**
 * Compute deterministic demand-driven restock metrics and suggested buy quantity for one inventory item.
 */
export function computeRestockItemPlan({
  item,
  totalConsumed = 0,
  ordersUsingCount = 0,
  activeSaleDays = 0,
  firstConsumptionAt = null,
  lookbackDays = 14,
  coverDays = 7,
  windowStartDateStr,
  todayDateStr,
  lowThreshold = 40,
  criticalThreshold = 20,
}) {
  const id = Number(item.id);
  const itemName = item.item ?? item.name ?? "";
  const category = item.category ?? "";
  const unit = item.unit ?? "";
  const quantity = Number(item.quantity || 0);
  const rawMax = item.maximum_stock ?? item.maximumStock;
  const parsedMax = rawMax == null || rawMax === "" ? null : Number(rawMax);
  const maximumStock = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : null;

  const purchasePriceRaw = Number(item.purchase_price ?? item.purchasePrice ?? 0);
  const purchasePrice = Number.isFinite(purchasePriceRaw) && purchasePriceRaw > 0 ? purchasePriceRaw : 0;
  const contentsRaw = Number(item.contents_per_package ?? item.contentsPerPackage ?? 1);
  const contentsPerPackage = Number.isFinite(contentsRaw) && contentsRaw > 0 ? contentsRaw : 1;
  const packageUnit = String(item.package_unit ?? item.packageUnit ?? "pack").trim() || "pack";

  const unitCostRaw = Number(item.unit_cost ?? item.unitCost ?? 0);
  const costKnown = (Number.isFinite(unitCostRaw) && unitCostRaw > 0)
    || (purchasePrice > 0 && contentsPerPackage > 0);
  const effectiveUnitCost = costKnown ? getEffectiveUnitCost(item) : 0;

  const cleanLookback = Math.max(1, Math.trunc(Number(lookbackDays) || 14));
  const cleanCover = Math.max(1, Math.trunc(Number(coverDays) || 7));
  const today = todayDateStr || getManilaTodayDateStr();
  const windowStart = windowStartDateStr || addDaysIsoDate(today, -(cleanLookback - 1));

  const rawCreatedAt = item.created_at ?? item.createdAt ?? null;
  const createdDate = rawCreatedAt ? getManilaDateString(rawCreatedAt) : "";
  const firstConsDate = firstConsumptionAt ? getManilaDateString(firstConsumptionAt) : "";

  let earliestObserved;
  if (createdDate && firstConsDate) {
    earliestObserved = createdDate <= firstConsDate ? createdDate : firstConsDate;
  } else {
    earliestObserved = createdDate || firstConsDate;
  }

  let observedDays = cleanLookback;
  if (earliestObserved) {
    let clamped = earliestObserved;
    if (clamped < windowStart) clamped = windowStart;
    if (clamped > today) clamped = today;
    observedDays = Math.max(1, Math.min(cleanLookback, inclusiveDaysBetween(clamped, today)));
  }

  const cleanTotalConsumed = round6(Math.max(0, Number(totalConsumed || 0)));
  const rawAvgDailyUsage = cleanTotalConsumed > 0 ? cleanTotalConsumed / observedDays : 0;
  const avgDailyUsage = round6(rawAvgDailyUsage);
  const basis = cleanTotalConsumed > 0 ? "velocity" : "fallback";
  const lowData = cleanTotalConsumed === 0 || observedDays < 3;

  const rawDaysOfStockLeft = rawAvgDailyUsage > 0 ? Math.max(0, quantity) / rawAvgDailyUsage : null;
  const daysOfStockLeft = rawDaysOfStockLeft != null ? round2(rawDaysOfStockLeft) : null;

  const capacityPercent = maximumStock != null
    ? Math.min(100, Math.max(0, (quantity / maximumStock) * 100))
    : null;
  const reportedPercent = capacityPercent == null ? null : Math.round(capacityPercent);
  const lowPct = Number.isFinite(Number(lowThreshold)) ? Number(lowThreshold) : 40;
  const criticalPct = Math.min(
    lowPct - 1,
    Number.isFinite(Number(criticalThreshold)) ? Number(criticalThreshold) : 20,
  );
  const overMaximum = maximumStock != null && quantity > maximumStock;
  const healthTone = quantity <= 0
    ? "critical"
    : overMaximum
      ? "over"
      : reportedPercent == null
        ? "untracked"
        : reportedPercent <= criticalPct
          ? "critical"
          : reportedPercent <= lowPct
            ? "low"
            : reportedPercent <= 70
              ? "moderate"
              : "available";

  const urgencyTier = quantity <= 0 || healthTone === "critical"
    ? "critical"
    : healthTone === "low"
      ? "low"
      : rawAvgDailyUsage > 0 && rawDaysOfStockLeft !== null && rawDaysOfStockLeft < cleanCover
        ? "velocity_alert"
        : "ok";

  const shouldInclude = quantity <= 0
    || healthTone === "critical"
    || healthTone === "low"
    || (rawAvgDailyUsage > 0 && rawDaysOfStockLeft !== null && rawDaysOfStockLeft < cleanCover);

  const label = quantity <= 0
    ? "Out of stock"
    : urgencyTier === "critical"
      ? "Critical"
      : urgencyTier === "low"
        ? "Running low"
        : urgencyTier === "velocity_alert"
          ? "Fast moving"
          : "Healthy";

  const isDiscreteUnit = isDiscreteCountUnit(unit);
  let suggestedBuyQty;

  if (basis === "velocity") {
    const rawTarget = round6(rawAvgDailyUsage * cleanCover);
    const rawNeeded = Math.max(0, rawTarget - quantity);
    suggestedBuyQty = isDiscreteUnit
      ? (rawNeeded > 0 ? Math.ceil(rawNeeded - 1e-9) : 0)
      : round6(rawNeeded);
    if (quantity <= 0 && suggestedBuyQty <= 0 && rawAvgDailyUsage > 0) {
      suggestedBuyQty = isDiscreteUnit ? 1 : round6(Math.max(0.01, rawAvgDailyUsage));
    }
  } else {
    const maxRefill = maximumStock != null ? Math.max(0, round6(maximumStock - quantity)) : 0;
    suggestedBuyQty = isDiscreteUnit
      ? (maxRefill > 0 ? Math.ceil(maxRefill - 1e-9) : 0)
      : round6(maxRefill);
  }

  const exceedsMaxStock = maximumStock != null && round6(quantity + suggestedBuyQty) > maximumStock;
  const estimatedCost = costKnown ? round2(suggestedBuyQty * effectiveUnitCost) : null;

  let recommendedPacks = null;
  let packTotalQty = null;
  let packEstimatedCost = null;
  if (contentsPerPackage > 1 && purchasePrice > 0) {
    recommendedPacks = suggestedBuyQty > 0
      ? Math.ceil((suggestedBuyQty / contentsPerPackage) - 1e-9)
      : 0;
    packTotalQty = round6(recommendedPacks * contentsPerPackage);
    packEstimatedCost = round2(recommendedPacks * purchasePrice);
  }

  return {
    id,
    item: itemName,
    category,
    unit,
    isDiscreteUnit,
    quantity,
    maximumStock,
    reportedPercent,
    healthTone,
    label,
    unitCost: costKnown ? round6(effectiveUnitCost) : 0,
    purchasePrice,
    contentsPerPackage,
    packageUnit,
    costKnown,
    basis,
    lowData,
    observedDays,
    activeSaleDays: Number(activeSaleDays || 0),
    totalConsumed: cleanTotalConsumed,
    ordersUsingCount: Number(ordersUsingCount || 0),
    avgDailyUsage,
    daysOfStockLeft,
    rawDaysOfStockLeft,
    urgencyTier,
    shouldInclude,
    suggestedBuyQty,
    estimatedCost,
    recommendedPacks,
    packTotalQty,
    packEstimatedCost,
    exceedsMaxStock,
  };
}

/**
 * Strip internal sorting/inclusion helper fields when serializing API responses.
 */
export function serializeRestockPlanItem(plan) {
  if (!plan || typeof plan !== "object") return plan;
  const rest = { ...plan };
  delete rest.rawDaysOfStockLeft;
  delete rest.shouldInclude;
  return rest;
}

/**
 * Deterministic lexicographic ordering:
 * 1. Out of stock (quantity <= 0) first
 * 2. Urgency tier (critical -> low -> velocity_alert -> ok)
 * 3. daysOfStockLeft ascending (null treated as Infinity)
 * 4. ordersUsingCount descending
 * 5. id ascending
 */
export function sortRestockSuggestions(items = []) {
  return [...items].sort((a, b) => {
    const aOut = Number(a.quantity || 0) <= 0 ? 0 : 1;
    const bOut = Number(b.quantity || 0) <= 0 ? 0 : 1;
    if (aOut !== bOut) return aOut - bOut;

    const aTier = URGENCY_ORDER[a.urgencyTier] ?? 3;
    const bTier = URGENCY_ORDER[b.urgencyTier] ?? 3;
    if (aTier !== bTier) return aTier - bTier;

    const aDays = a.rawDaysOfStockLeft ?? a.daysOfStockLeft ?? Infinity;
    const bDays = b.rawDaysOfStockLeft ?? b.daysOfStockLeft ?? Infinity;
    if (aDays !== bDays) return aDays - bDays;

    const aOrders = Number(a.ordersUsingCount || 0);
    const bOrders = Number(b.ordersUsingCount || 0);
    if (aOrders !== bOrders) return bOrders - aOrders;

    return Number(a.id || 0) - Number(b.id || 0);
  });
}

/**
 * Build summary totals matching visible centavo-rounded item lines exactly.
 */
export function buildRestockSummary(items = []) {
  let costedItemsCount = 0;
  let uncostedItemsCount = 0;
  let totalSum = 0;

  for (const item of items) {
    if (item.costKnown && item.estimatedCost != null) {
      costedItemsCount += 1;
      totalSum = round2(totalSum + Number(item.estimatedCost));
    } else {
      uncostedItemsCount += 1;
    }
  }

  return {
    totalItemsCount: items.length,
    costedItemsCount,
    uncostedItemsCount,
    totalEstimatedCost: round2(totalSum),
  };
}

function isPackModeEligible(item, usePackMode) {
  return Boolean(
    usePackMode
    && Number(item.contentsPerPackage) > 1
    && item.packEstimatedCost != null
    && Number(item.recommendedPacks) > 0
    && Number(item.purchasePrice) > 0,
  );
}

function allocateItemUpTo(state, desiredTotalQty, remainingBudget) {
  if (remainingBudget <= 0 || desiredTotalQty <= state.qty + 1e-9) {
    return remainingBudget;
  }

  const { item, isPack, effectiveUnitCost } = state;

  if (isPack) {
    const stepQty = Number(item.contentsPerPackage);
    const packPrice = Number(item.purchasePrice);
    const maxPacks = Number(item.recommendedPacks);
    const currentPacks = Math.round(state.qty / stepQty);
    const desiredPacks = Math.min(
      maxPacks,
      Math.max(currentPacks, Math.ceil((desiredTotalQty - 1e-9) / stepQty)),
    );
    if (desiredPacks <= currentPacks) return remainingBudget;

    let addPacks = Math.min(
      desiredPacks - currentPacks,
      Math.max(0, Math.floor((remainingBudget + state.cost + 1e-9) / packPrice) - currentPacks),
    );
    while (addPacks > 0) {
      const candidateCost = round2((currentPacks + addPacks) * packPrice);
      const deltaCost = round2(candidateCost - state.cost);
      if (deltaCost <= remainingBudget + 1e-9) break;
      addPacks -= 1;
    }
    if (addPacks <= 0) return remainingBudget;

    const newPacks = currentPacks + addPacks;
    const newCost = round2(newPacks * packPrice);
    const deltaCost = round2(newCost - state.cost);
    if (deltaCost > remainingBudget + 1e-9) return remainingBudget;

    state.qty = round6(newPacks * stepQty);
    state.cost = newCost;
    state.packs = newPacks;
    return Math.max(0, round2(remainingBudget - deltaCost));
  }

  if (item.isDiscreteUnit) {
    const desiredInt = Math.max(state.qty, Math.round(desiredTotalQty));
    if (desiredInt <= state.qty) return remainingBudget;

    let candidateQty = Math.min(
      desiredInt,
      Math.max(state.qty, Math.floor((remainingBudget + state.cost + 1e-9) / effectiveUnitCost)),
    );
    while (candidateQty > state.qty) {
      const candidateCost = round2(candidateQty * effectiveUnitCost);
      const deltaCost = round2(candidateCost - state.cost);
      if (deltaCost <= remainingBudget + 1e-9) break;
      candidateQty -= 1;
    }
    if (candidateQty <= state.qty) return remainingBudget;

    const newCost = round2(candidateQty * effectiveUnitCost);
    const deltaCost = round2(newCost - state.cost);
    if (deltaCost > remainingBudget + 1e-9) return remainingBudget;

    state.qty = candidateQty;
    state.cost = newCost;
    return Math.max(0, round2(remainingBudget - deltaCost));
  }

  // Continuous unit
  const cappedDesired = Math.min(state.targetQty, round6(desiredTotalQty));
  if (cappedDesired <= state.qty + 1e-9) return remainingBudget;

  const fullDesiredCost = round2(cappedDesired * effectiveUnitCost);
  const fullDelta = round2(fullDesiredCost - state.cost);
  if (fullDelta <= remainingBudget + 1e-9) {
    state.qty = cappedDesired;
    state.cost = fullDesiredCost;
    return Math.max(0, round2(remainingBudget - fullDelta));
  }

  const affordableAdd = Math.floor(((remainingBudget / effectiveUnitCost) + 1e-12) * 100) / 100;
  let candidateQty = round6(Math.min(cappedDesired, state.qty + affordableAdd));
  if (candidateQty <= state.qty + 1e-9) return remainingBudget;

  let candidateCost = round2(candidateQty * effectiveUnitCost);
  let deltaCost = round2(candidateCost - state.cost);
  if (deltaCost > remainingBudget + 1e-9) {
    candidateQty = round6(Math.max(state.qty, candidateQty - 0.01));
    if (candidateQty <= state.qty + 1e-9) return remainingBudget;
    candidateCost = round2(candidateQty * effectiveUnitCost);
    deltaCost = round2(candidateCost - state.cost);
  }
  if (deltaCost > remainingBudget + 1e-9) return remainingBudget;

  state.qty = candidateQty;
  state.cost = candidateCost;
  return Math.max(0, round2(remainingBudget - deltaCost));
}

/**
 * Pure two-pass budget allocator (single source of truth for UI and tests):
 * Pass 1: 1-day urgent cover for out-of-stock / critical items.
 * Pass 2: Top-up remaining ranked demand in lexicographic order.
 */
export function allocateRestockBudget(rankedItems = [], budget, { usePackMode = false } = {}) {
  const hasBudgetInput = budget !== null && budget !== undefined && String(budget).trim() !== "";
  const numericBudget = hasBudgetInput ? Number(budget) : null;

  if (!hasBudgetInput || !Number.isFinite(numericBudget)) {
    const items = rankedItems.map((item) => {
      const isPack = isPackModeEligible(item, usePackMode);
      const targetQty = isPack ? Number(item.packTotalQty) : Number(item.suggestedBuyQty || 0);
      const allocatedCost = item.costKnown
        ? (isPack ? Number(item.packEstimatedCost) : item.estimatedCost)
        : null;
      return {
        ...item,
        targetQty,
        allocatedQty: targetQty,
        allocatedPacks: isPack ? Number(item.recommendedPacks) : (item.recommendedPacks ?? null),
        allocatedCost,
        allocationStatus: "unconstrained",
      };
    });
    const allocatedTotalCost = round2(
      items.reduce((sum, entry) => sum + (entry.allocatedCost ?? 0), 0),
    );
    return {
      budgetProvided: null,
      budgetRemaining: null,
      allocatedTotalCost,
      usePackMode: Boolean(usePackMode),
      items,
    };
  }

  if (numericBudget <= 0) {
    const items = rankedItems.map((item) => {
      const isPack = isPackModeEligible(item, usePackMode);
      const targetQty = isPack ? Number(item.packTotalQty) : Number(item.suggestedBuyQty || 0);
      const allocationStatus = !item.costKnown
        ? "uncosted"
        : targetQty <= 0
          ? "no_need"
          : "skipped_budget";
      return {
        ...item,
        targetQty,
        allocatedQty: 0,
        allocatedPacks: isPack ? 0 : null,
        allocatedCost: item.costKnown ? 0 : null,
        allocationStatus,
      };
    });
    return {
      budgetProvided: 0,
      budgetRemaining: 0,
      allocatedTotalCost: 0,
      usePackMode: Boolean(usePackMode),
      items,
    };
  }

  let remainingBudget = round2(numericBudget);
  const states = rankedItems.map((item) => {
    const isPack = isPackModeEligible(item, usePackMode);
    const targetQty = isPack ? Number(item.packTotalQty) : Number(item.suggestedBuyQty || 0);
    const effectiveUnitCost = getEffectiveUnitCost(item);
    const eligible = Boolean(item.costKnown) && effectiveUnitCost > 0 && targetQty > 0;
    return {
      item,
      isPack,
      targetQty,
      effectiveUnitCost,
      eligible,
      qty: 0,
      cost: 0,
      packs: isPack ? 0 : null,
    };
  });

  // Pass 1: 1-day survival cover for out-of-stock / critical items
  for (const state of states) {
    if (remainingBudget <= 0) break;
    if (!state.eligible) continue;
    const { item, isPack, targetQty } = state;
    const isUrgent = Number(item.quantity || 0) <= 0 || item.urgencyTier === "critical";
    if (!isUrgent) continue;

    const rawOneDay = Number(item.avgDailyUsage || 0) > 0
      ? Number(item.avgDailyUsage)
      : (item.isDiscreteUnit ? 1 : round6(targetQty * 0.25));

    let floorTarget;
    if (isPack) {
      const stepQty = Number(item.contentsPerPackage);
      const floorPacks = Math.min(
        Number(item.recommendedPacks),
        Math.max(1, Math.ceil((rawOneDay - 1e-9) / stepQty)),
      );
      floorTarget = round6(floorPacks * stepQty);
    } else if (item.isDiscreteUnit) {
      floorTarget = Math.min(targetQty, Math.max(1, Math.ceil(rawOneDay - 1e-9)));
    } else {
      floorTarget = Math.min(targetQty, round6(Math.max(0.01, rawOneDay)));
    }

    remainingBudget = allocateItemUpTo(state, floorTarget, remainingBudget);
  }

  // Pass 2: Top-up in lexicographic rank order
  for (const state of states) {
    if (remainingBudget <= 0) break;
    if (!state.eligible) continue;
    if (state.qty >= state.targetQty - 1e-9) continue;
    remainingBudget = allocateItemUpTo(state, state.targetQty, remainingBudget);
  }

  const items = states.map((state) => {
    const { item, targetQty, qty, cost, packs } = state;
    let allocationStatus;
    if (!item.costKnown) {
      allocationStatus = "uncosted";
    } else if (targetQty <= 0) {
      allocationStatus = "no_need";
    } else if (qty >= targetQty - 1e-9) {
      allocationStatus = "full";
    } else if (qty > 0) {
      allocationStatus = "partial";
    } else {
      allocationStatus = "skipped_budget";
    }

    return {
      ...item,
      targetQty,
      allocatedQty: round6(qty),
      allocatedPacks: packs,
      allocatedCost: item.costKnown ? round2(cost) : null,
      allocationStatus,
    };
  });

  const allocatedTotalCost = round2(
    items.reduce((sum, entry) => sum + (entry.allocatedCost ?? 0), 0),
  );

  return {
    budgetProvided: round2(numericBudget),
    budgetRemaining: round2(remainingBudget),
    allocatedTotalCost,
    usePackMode: Boolean(usePackMode),
    items,
  };
}
