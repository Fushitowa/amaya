import { Router } from "express";
import pool from "../database.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const defaults = {
  businessName: "Amaya's Drinks and Bites",
  email: "jessiecataya25@gmail.com",
  phone: "09636017184",
  address: "Barangay Lilingayon, Valencia City, Bukidnon",
  openingTime: "09:00",
  closingTime: "19:00",
  targetFoodCost: 0.3,
};
const mapSettings = (row) => row ? ({
  businessName: row.business_name,
  email: row.email || "",
  phone: row.phone || "",
  address: row.address || "",
  openingTime: String(row.opening_time || "09:00:00").slice(0, 5),
  closingTime: String(row.closing_time || "19:00:00").slice(0, 5),
  targetFoodCost: Number(row.target_food_cost ?? 0.3),
}) : defaults;

router.get("/", async (_request, response) => {
  const [[row]] = await pool.execute("SELECT * FROM business_settings WHERE id = 1");
  response.json(mapSettings(row));
});

router.put("/", requireAuth, requireRole("admin"), async (request, response) => {
  const body = request.body || {};
  const businessName = String(body.businessName || "").trim();
  if (!businessName || businessName.length > 160) return response.status(400).json({ message: "Business name is required." });
  const openingTime = String(body.openingTime || "09:00").slice(0, 5);
  const closingTime = String(body.closingTime || "19:00").slice(0, 5);
  const email = String(body.email || "").trim();
  if (email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254)) {
    return response.status(400).json({ message: "Enter a valid email address." });
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(openingTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(closingTime)) {
    return response.status(400).json({ message: "Enter valid opening and closing times." });
  }
  let targetFoodCost = null;
  if (body.targetFoodCost !== undefined && body.targetFoodCost !== null && body.targetFoodCost !== "") {
    const parsed = Number(body.targetFoodCost);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 1) {
      return response.status(400).json({ message: "Target food cost ratio must be greater than 0 and less than 1." });
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
      String(body.phone || "").trim().slice(0, 40) || null,
      String(body.address || "").trim().slice(0, 500) || null,
      openingTime,
      closingTime,
      targetFoodCost,
      targetFoodCost,
    ],
  );
  const [[row]] = await pool.execute("SELECT * FROM business_settings WHERE id = 1");
  response.json(mapSettings(row));
});

export default router;
