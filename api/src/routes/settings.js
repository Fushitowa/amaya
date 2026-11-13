import { Router } from "express";
import pool from "../database.js";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth.js";
import {
  DEFAULT_TARGET_FOOD_COST,
  MIN_TARGET_FOOD_COST,
  MAX_TARGET_FOOD_COST,
  normalizeTargetFoodCost,
} from "../utils/costing.js";

const router = Router();
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const TIME_FORMAT_RE = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export const DEFAULT_DISCOUNT_PRESETS = [
  { label: "Senior Citizen (20%)", pct: 20 },
  { label: "PWD (20%)", pct: 20 },
  { label: "Student (10%)", pct: 10 },
];

export const DEFAULT_BUSINESS_SETTINGS = {
  businessName: "Amaya's Drinks and Bites",
  email: "jessiecataya25@gmail.com",
  phone: "09636017184",
  address: "Barangay Lilingayon, Valencia City, Bukidnon",
  openingTime: "09:00",
  closingTime: "19:00",
  isTemporarilyClosed: false,
  receiptFooter: "Thank you for supporting local craft!",
  targetFoodCost: DEFAULT_TARGET_FOOD_COST,
  lowStockThresholdPercent: 40,
  criticalStockThresholdPercent: 20,
  inactivityAlertDays: 30,
  archiveRetentionDays: 30,
  maxInventoryAdjustmentPct: 200,
  vatEnabled: false,
  vatRatePercent: 12,
  discountPresets: DEFAULT_DISCOUNT_PRESETS,
  enforceShiftGate: false,
  autoPrintReceipt: true,
  defaultVoidStockAction: "restore",
  requireKitchenNoteApproval: false,
  idleLockMinutes: 15,
  exportRowLimit: 5000,
  notifyAllEnabled: true,
  notifyOrderAlerts: true,
  notifyInventoryAlerts: true,
};

const isInvalidOptionalString = (value) =>
  value !== undefined && value !== null && typeof value !== "string";

export function parseDiscountPresets(raw) {
  if (!raw) return DEFAULT_DISCOUNT_PRESETS.map((p) => ({ ...p }));
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return DEFAULT_DISCOUNT_PRESETS.map((p) => ({ ...p }));
    }
  }
  if (!Array.isArray(parsed)) {
    return DEFAULT_DISCOUNT_PRESETS.map((p) => ({ ...p }));
  }
  const clean = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const label = String(item.label || "").trim().slice(0, 50);
    const pct = Number(item.pct);
    if (!label || !Number.isFinite(pct) || pct <= 0 || pct > 100) continue;
    clean.push({ label, pct: Number(pct.toFixed(2)) });
    if (clean.length >= 10) break;
  }
  return clean;
}

function parseIntBound(raw, fallback, min, max, fieldLabel) {
  if (raw === undefined) return fallback;
  if (typeof raw === "boolean" || typeof raw === "object" || raw === null || String(raw).trim() === "") {
    throw new Error(`${fieldLabel} must be a whole number between ${min} and ${max}.`);
  }
  const num = Number(raw);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new Error(`${fieldLabel} must be a whole number between ${min} and ${max}.`);
  }
  return num;
}

function parseBoolStrict(raw, fallback, fieldLabel) {
  if (raw === undefined) return fallback;
  if (typeof raw !== "boolean") {
    throw new Error(`${fieldLabel} must be a true/false value.`);
  }
  return raw;
}

function mapSettings(row, role = null) {
  const mapped = row
    ? {
        businessName: row.business_name,
        email: row.email || "",
        phone: row.phone || "",
        address: row.address || "",
        openingTime: String(row.opening_time || "09:00:00").slice(0, 5),
        closingTime: String(row.closing_time || "19:00:00").slice(0, 5),
        isTemporarilyClosed: Boolean(row.is_temporarily_closed),
        receiptFooter: row.receipt_footer ?? DEFAULT_BUSINESS_SETTINGS.receiptFooter,
      }
    : {
        businessName: DEFAULT_BUSINESS_SETTINGS.businessName,
        email: DEFAULT_BUSINESS_SETTINGS.email,
        phone: DEFAULT_BUSINESS_SETTINGS.phone,
        address: DEFAULT_BUSINESS_SETTINGS.address,
        openingTime: DEFAULT_BUSINESS_SETTINGS.openingTime,
        closingTime: DEFAULT_BUSINESS_SETTINGS.closingTime,
        isTemporarilyClosed: DEFAULT_BUSINESS_SETTINGS.isTemporarilyClosed,
        receiptFooter: DEFAULT_BUSINESS_SETTINGS.receiptFooter,
      };

  const isStaffOrAdmin = role === "staff" || role === "admin";
  if (isStaffOrAdmin) {
    mapped.lowStockThresholdPercent = Number(row?.low_stock_threshold_pct ?? DEFAULT_BUSINESS_SETTINGS.lowStockThresholdPercent);
    mapped.criticalStockThresholdPercent = Number(row?.critical_stock_threshold_pct ?? DEFAULT_BUSINESS_SETTINGS.criticalStockThresholdPercent);
    mapped.vatEnabled = Boolean(row?.vat_enabled ?? DEFAULT_BUSINESS_SETTINGS.vatEnabled);
    mapped.vatRatePercent = Number(row?.vat_rate_pct ?? DEFAULT_BUSINESS_SETTINGS.vatRatePercent);
    mapped.discountPresets = parseDiscountPresets(row?.discount_presets_json);
    mapped.enforceShiftGate = row ? Boolean(row.enforce_shift_gate) : DEFAULT_BUSINESS_SETTINGS.enforceShiftGate;
    mapped.autoPrintReceipt = row ? Boolean(row.auto_print_receipt) : DEFAULT_BUSINESS_SETTINGS.autoPrintReceipt;
    mapped.defaultVoidStockAction = row?.default_void_stock_action === "spoilage" ? "spoilage" : "restore";
    mapped.requireKitchenNoteApproval = Boolean(row?.require_kitchen_note_approval ?? DEFAULT_BUSINESS_SETTINGS.requireKitchenNoteApproval);
    mapped.idleLockMinutes = Number(row?.idle_lock_minutes ?? DEFAULT_BUSINESS_SETTINGS.idleLockMinutes);
    mapped.notifyAllEnabled = row ? Boolean(row.notify_all_enabled) : DEFAULT_BUSINESS_SETTINGS.notifyAllEnabled;
    mapped.notifyOrderAlerts = row ? Boolean(row.notify_order_alerts) : DEFAULT_BUSINESS_SETTINGS.notifyOrderAlerts;
    mapped.notifyInventoryAlerts = row ? Boolean(row.notify_inventory_alerts) : DEFAULT_BUSINESS_SETTINGS.notifyInventoryAlerts;
  }

  if (role === "admin") {
    mapped.targetFoodCost = normalizeTargetFoodCost(row?.target_food_cost);
    mapped.inactivityAlertDays = Number(row?.inactivity_alert_days ?? DEFAULT_BUSINESS_SETTINGS.inactivityAlertDays);
    mapped.archiveRetentionDays = Number(row?.archive_retention_days ?? DEFAULT_BUSINESS_SETTINGS.archiveRetentionDays);
    mapped.maxInventoryAdjustmentPct = Number(row?.max_inventory_adjustment_pct ?? DEFAULT_BUSINESS_SETTINGS.maxInventoryAdjustmentPct);
    mapped.exportRowLimit = Number(row?.export_row_limit ?? DEFAULT_BUSINESS_SETTINGS.exportRowLimit);
  }

  return mapped;
}

export async function loadBusinessSettings(db = pool) {
  const [[row]] = await db.execute("SELECT * FROM business_settings WHERE id = 1 LIMIT 1");
  return mapSettings(row, "admin");
}

router.get("/", optionalAuth, async (request, response) => {
  const [[row]] = await pool.execute("SELECT * FROM business_settings WHERE id = 1");
  response.set("Cache-Control", "private, no-store");
  response.set("Vary", "Authorization");
  response.json(mapSettings(row, request.authUser?.role || null));
});

router.put("/", requireAuth, requireRole("admin"), async (request, response) => {
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return response.status(400).json({ message: "Invalid business settings payload." });
  }
  if (typeof body.businessName !== "string") {
    return response.status(400).json({ message: "Business name is required." });
  }
  const businessName = body.businessName.trim();
  if (!businessName || businessName.length > 160) {
    return response.status(400).json({ message: "Business name is required." });
  }
  if (
    isInvalidOptionalString(body.email) ||
    isInvalidOptionalString(body.phone) ||
    isInvalidOptionalString(body.address) ||
    isInvalidOptionalString(body.openingTime) ||
    isInvalidOptionalString(body.closingTime) ||
    isInvalidOptionalString(body.receiptFooter)
  ) {
    return response.status(400).json({ message: "Settings fields must be valid text values." });
  }
  const rawOpeningTime = (body.openingTime ?? "").trim() || "09:00";
  const rawClosingTime = (body.closingTime ?? "").trim() || "19:00";
  const email = (body.email ?? "").trim();
  if (email && (email.length > 254 || !EMAIL_FORMAT_RE.test(email))) {
    return response.status(400).json({ message: "Enter a valid email address." });
  }
  if (!TIME_FORMAT_RE.test(rawOpeningTime) || !TIME_FORMAT_RE.test(rawClosingTime)) {
    return response.status(400).json({ message: "Enter valid opening and closing times." });
  }
  const openingTime = rawOpeningTime.slice(0, 5);
  const closingTime = rawClosingTime.slice(0, 5);

  let targetFoodCost = null;
  if (Object.hasOwn(body, "targetFoodCost") && body.targetFoodCost !== undefined) {
    const rawTarget = body.targetFoodCost;
    if (
      rawTarget === null ||
      typeof rawTarget === "boolean" ||
      typeof rawTarget === "object" ||
      (typeof rawTarget === "string" && !rawTarget.trim())
    ) {
      return response.status(400).json({
        message: "Target food cost ratio must be between 0.10 (10%) and 0.90 (90%).",
      });
    }
    const parsed = typeof rawTarget === "number" || typeof rawTarget === "string"
      ? Number(rawTarget)
      : Number.NaN;
    if (!Number.isFinite(parsed) || parsed < MIN_TARGET_FOOD_COST || parsed > MAX_TARGET_FOOD_COST) {
      return response.status(400).json({
        message: "Target food cost ratio must be between 0.10 (10%) and 0.90 (90%).",
      });
    }
    targetFoodCost = Number(parsed.toFixed(4));
  }

  const [[existingRow]] = await pool.execute("SELECT * FROM business_settings WHERE id = 1 LIMIT 1");
  const current = mapSettings(existingRow, "admin");

  let next;
  try {
    const isTemporarilyClosed = parseBoolStrict(
      body.isTemporarilyClosed,
      current.isTemporarilyClosed,
      "Store temporary closure flag",
    );
    const lowStockThresholdPercent = parseIntBound(
      body.lowStockThresholdPercent,
      current.lowStockThresholdPercent,
      5,
      90,
      "Low stock threshold",
    );
    const criticalStockThresholdPercent = parseIntBound(
      body.criticalStockThresholdPercent,
      current.criticalStockThresholdPercent,
      1,
      85,
      "Critical stock threshold",
    );
    if (criticalStockThresholdPercent >= lowStockThresholdPercent) {
      throw new Error("Critical stock threshold must be strictly lower than low stock threshold.");
    }
    const inactivityAlertDays = parseIntBound(
      body.inactivityAlertDays,
      current.inactivityAlertDays,
      1,
      365,
      "Inventory inactivity window",
    );
    const archiveRetentionDays = parseIntBound(
      body.archiveRetentionDays,
      current.archiveRetentionDays,
      1,
      365,
      "Archive retention window",
    );
    const maxInventoryAdjustmentPct = parseIntBound(
      body.maxInventoryAdjustmentPct,
      current.maxInventoryAdjustmentPct,
      25,
      1000,
      "Max inventory adjustment guard",
    );
    const vatEnabled = parseBoolStrict(body.vatEnabled, current.vatEnabled, "VAT toggle");

    let vatRatePercent = current.vatRatePercent;
    if (body.vatRatePercent !== undefined) {
      if (
        body.vatRatePercent === null ||
        typeof body.vatRatePercent === "boolean" ||
        typeof body.vatRatePercent === "object" ||
        String(body.vatRatePercent).trim() === ""
      ) {
        throw new Error("VAT rate must be between 0% and 30%.");
      }
      const parsedVat = Number(body.vatRatePercent);
      if (!Number.isFinite(parsedVat) || parsedVat < 0 || parsedVat > 30) {
        throw new Error("VAT rate must be between 0% and 30%.");
      }
      vatRatePercent = Number(parsedVat.toFixed(2));
    }

    let discountPresets = current.discountPresets;
    if (body.discountPresets !== undefined) {
      if (!Array.isArray(body.discountPresets) || body.discountPresets.length > 10) {
        throw new Error("Discount presets must be a list of up to 10 items.");
      }
      const validated = [];
      for (const preset of body.discountPresets) {
        if (!preset || typeof preset !== "object" || Array.isArray(preset)) {
          throw new Error("Each discount preset must contain a label and percentage.");
        }
        const label = typeof preset.label === "string" ? preset.label.trim().slice(0, 50) : "";
        const pct = Number(preset.pct);
        if (!label || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
          throw new Error("Each discount preset needs a label and a percentage between 0.01% and 100%.");
        }
        validated.push({ label, pct: Number(pct.toFixed(2)) });
      }
      discountPresets = validated;
    }

    const enforceShiftGate = parseBoolStrict(
      body.enforceShiftGate,
      current.enforceShiftGate,
      "Enforce cashier shift gate",
    );
    const autoPrintReceipt = parseBoolStrict(
      body.autoPrintReceipt,
      current.autoPrintReceipt,
      "Auto-print receipt toggle",
    );

    let defaultVoidStockAction = current.defaultVoidStockAction;
    if (body.defaultVoidStockAction !== undefined) {
      if (body.defaultVoidStockAction !== "restore" && body.defaultVoidStockAction !== "spoilage") {
        throw new Error("Default void stock action must be 'restore' or 'spoilage'.");
      }
      defaultVoidStockAction = body.defaultVoidStockAction;
    }

    const requireKitchenNoteApproval = parseBoolStrict(
      body.requireKitchenNoteApproval,
      current.requireKitchenNoteApproval,
      "Kitchen note confirmation toggle",
    );
    const idleLockMinutes = parseIntBound(
      body.idleLockMinutes,
      current.idleLockMinutes,
      0,
      240,
      "Idle auto-lock timeout",
    );
    const receiptFooter = body.receiptFooter !== undefined
      ? (body.receiptFooter ?? "").trim().slice(0, 255) || null
      : (current.receiptFooter ? String(current.receiptFooter).slice(0, 255) : null);
    const exportRowLimit = parseIntBound(
      body.exportRowLimit,
      current.exportRowLimit,
      100,
      25000,
      "CSV export row cap",
    );
    const notifyAllEnabled = parseBoolStrict(
      body.notifyAllEnabled,
      current.notifyAllEnabled,
      "All notifications toggle",
    );
    const notifyOrderAlerts = parseBoolStrict(
      body.notifyOrderAlerts,
      current.notifyOrderAlerts,
      "Order alerts toggle",
    );
    const notifyInventoryAlerts = parseBoolStrict(
      body.notifyInventoryAlerts,
      current.notifyInventoryAlerts,
      "Inventory alerts toggle",
    );

    next = {
      isTemporarilyClosed,
      lowStockThresholdPercent,
      criticalStockThresholdPercent,
      inactivityAlertDays,
      archiveRetentionDays,
      maxInventoryAdjustmentPct,
      vatEnabled,
      vatRatePercent,
      discountPresetsJson: JSON.stringify(discountPresets),
      enforceShiftGate,
      autoPrintReceipt,
      defaultVoidStockAction,
      requireKitchenNoteApproval,
      idleLockMinutes,
      receiptFooter,
      exportRowLimit,
      notifyAllEnabled,
      notifyOrderAlerts,
      notifyInventoryAlerts,
    };
  } catch (validationErr) {
    return response.status(400).json({ message: validationErr.message || "Invalid business settings value." });
  }

  await pool.execute(
    `INSERT INTO business_settings (
       id, business_name, email, phone, address, opening_time, closing_time, is_temporarily_closed,
       target_food_cost, low_stock_threshold_pct, critical_stock_threshold_pct,
       inactivity_alert_days, archive_retention_days, max_inventory_adjustment_pct,
       vat_enabled, vat_rate_pct, discount_presets_json,
       enforce_shift_gate, auto_print_receipt, default_void_stock_action,
       require_kitchen_note_approval, idle_lock_minutes, receipt_footer, export_row_limit,
       notify_all_enabled, notify_order_alerts, notify_inventory_alerts
     )
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0.3000), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       business_name = VALUES(business_name),
       email = VALUES(email),
       phone = VALUES(phone),
       address = VALUES(address),
       opening_time = VALUES(opening_time),
       closing_time = VALUES(closing_time),
       is_temporarily_closed = VALUES(is_temporarily_closed),
       target_food_cost = COALESCE(?, target_food_cost),
       low_stock_threshold_pct = VALUES(low_stock_threshold_pct),
       critical_stock_threshold_pct = VALUES(critical_stock_threshold_pct),
       inactivity_alert_days = VALUES(inactivity_alert_days),
       archive_retention_days = VALUES(archive_retention_days),
       max_inventory_adjustment_pct = VALUES(max_inventory_adjustment_pct),
       vat_enabled = VALUES(vat_enabled),
       vat_rate_pct = VALUES(vat_rate_pct),
       discount_presets_json = VALUES(discount_presets_json),
       enforce_shift_gate = VALUES(enforce_shift_gate),
       auto_print_receipt = VALUES(auto_print_receipt),
       default_void_stock_action = VALUES(default_void_stock_action),
       require_kitchen_note_approval = VALUES(require_kitchen_note_approval),
       idle_lock_minutes = VALUES(idle_lock_minutes),
       receipt_footer = VALUES(receipt_footer),
       export_row_limit = VALUES(export_row_limit),
       notify_all_enabled = VALUES(notify_all_enabled),
       notify_order_alerts = VALUES(notify_order_alerts),
       notify_inventory_alerts = VALUES(notify_inventory_alerts)`,
    [
      businessName,
      email || null,
      (body.phone ?? "").trim().slice(0, 40) || null,
      (body.address ?? "").trim().slice(0, 500) || null,
      openingTime,
      closingTime,
      next.isTemporarilyClosed ? 1 : 0,
      targetFoodCost ?? current.targetFoodCost,
      next.lowStockThresholdPercent,
      next.criticalStockThresholdPercent,
      next.inactivityAlertDays,
      next.archiveRetentionDays,
      next.maxInventoryAdjustmentPct,
      next.vatEnabled ? 1 : 0,
      next.vatRatePercent,
      next.discountPresetsJson,
      next.enforceShiftGate ? 1 : 0,
      next.autoPrintReceipt ? 1 : 0,
      next.defaultVoidStockAction,
      next.requireKitchenNoteApproval ? 1 : 0,
      next.idleLockMinutes,
      next.receiptFooter,
      next.exportRowLimit,
      next.notifyAllEnabled ? 1 : 0,
      next.notifyOrderAlerts ? 1 : 0,
      next.notifyInventoryAlerts ? 1 : 0,
      targetFoodCost,
    ],
  );
  const [[row]] = await pool.execute("SELECT * FROM business_settings WHERE id = 1");
  response.json(mapSettings(row, "admin"));
});

export default router;
