/**
 * Cost targets as a share of net sales (Phase 3 / 3B of docs/PAYROLL_IMPLEMENTATION_PLAN.md).
 * Stored as ratios in business_settings, bounded like target_food_cost. Prime cost (COGS + labor)
 * has a fixed industry goal rather than a setting.
 */
export const COST_TARGETS = Object.freeze({
  targetLaborCost: Object.freeze({ column: "target_labor_cost", label: "Target labor cost", min: 0.05, max: 0.60, fallback: 0.30 }),
  targetUtilitiesCost: Object.freeze({ column: "target_utilities_cost", label: "Target utilities cost", min: 0.01, max: 0.30, fallback: 0.05 }),
  targetOccupancyCost: Object.freeze({ column: "target_occupancy_cost", label: "Target occupancy cost", min: 0.01, max: 0.40, fallback: 0.10 }),
});

// Prime cost (COGS + labor) at or under 60% of sales leaves room for profit (Toast / NRA).
export const PRIME_COST_GOAL = 0.60;

export const CONTRIBUTION_SPLITS = Object.freeze(["per_cutoff", "monthly"]);

/** Ratio within the target's bounds, or the fallback when missing or out of range. */
export function normalizeCostTarget(key, value) {
  const def = COST_TARGETS[key];
  if (!def) throw new Error(`Unknown cost target "${key}".`);
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "object") return def.fallback;
  if (typeof value === "string" && !value.trim()) return def.fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= def.min && parsed <= def.max ? Number(parsed.toFixed(4)) : def.fallback;
}

export function normalizeContributionSplit(value) {
  return value === "monthly" ? "monthly" : "per_cutoff";
}
