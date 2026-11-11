import { Router } from "express";
import pool from "../database.js";
import { optionalAuth, requireAuth, requireRole } from "../middleware/auth.js";
import {
  MIN_TARGET_FOOD_COST,
  MAX_TARGET_FOOD_COST,
  normalizeTargetFoodCost,
} from "../utils/costing.js";

const router = Router();
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const TIME_FORMAT_RE = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const defaults = {
  businessName: "Amaya's Drinks and Bites",
  email: "jessiecataya25@gmail.com",
  phone: "09636017184",
  address: "Barangay Lilingayon, Valencia City, Bukidnon",
  openingTime: "09:00",
  closingTime: "19:00",
};
const isInvalidOptionalString = (value) =>
  value !== undefined && value !== null && typeof value !== "string";

const mapSettings = (row, includeCostTargets = false) => {
  const mapped = row
    ? {
        businessName: row.business_name,
        email: row.email || "",
        phone: row.phone || "",
        address: row.address || "",
        openingTime: String(row.opening_time || "09:00:00").slice(0, 5),
        closingTime: String(row.closing_time || "19:00:00").slice(0, 5),
      }
    : { ...defaults };

  if (includeCostTargets) {
    mapped.targetFoodCost = normalizeTargetFoodCost(row?.target_food_cost);
  }
  return mapped;
};

router.get("/", optionalAuth, async (request, response) => {
  const [[row]] = await pool.execute("SELECT * FROM business_settings WHERE id = 1");
  response.set("Cache-Control", "private, no-store");
  response.set("Vary", "Authorization");
  response.json(mapSettings(row, request.authUser?.role === "admin"));
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
    isInvalidOptionalString(body.closingTime)
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
  await pool.execute(
    `INSERT INTO business_settings (id, business_name, email, phone, address, opening_time, closing_time, target_food_cost)
     VALUES (1, ?, ?, ?, ?, ?, ?, COALESCE(?, 0.3000))
     ON DUPLICATE KEY UPDATE
       business_name = VALUES(business_name),
       email = VALUES(email),
       phone = VALUES(phone),
       address = VALUES(address),
       opening_time = VALUES(opening_time),
       closing_time = VALUES(closing_time),
       target_food_cost = COALESCE(?, target_food_cost)`,
    [
      businessName,
      email || null,
      (body.phone ?? "").trim().slice(0, 40) || null,
      (body.address ?? "").trim().slice(0, 500) || null,
      openingTime,
      closingTime,
      targetFoodCost,
      targetFoodCost,
    ],
  );
  const [[row]] = await pool.execute("SELECT * FROM business_settings WHERE id = 1");
  response.json(mapSettings(row, true));
});

export default router;
