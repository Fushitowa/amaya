import "./loadEnv.js";
import http from "node:http";
import express from "../../api/node_modules/express/index.js";
import bcrypt from "../../api/node_modules/bcryptjs/index.js";
import pool from "../../api/src/database.js";
import { createAccessToken } from "../../api/src/middleware/auth.js";
import authRoutes from "../../api/src/routes/auth.js";
import menuRoutes from "../../api/src/routes/menu.js";
import orderRoutes from "../../api/src/routes/orders.js";
import inventoryRoutes from "../../api/src/routes/inventory.js";
import sessionRoutes from "../../api/src/routes/sessions.js";
import reportRoutes from "../../api/src/routes/reports.js";
import settingsRoutes from "../../api/src/routes/settings.js";

export function makeUniqueTag(prefix = "Tala") {
  const rand = Math.floor(Math.random() * 1_000_000);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function createTestApp() {
  const app = express();
  app.use(express.json({ limit: "9mb" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/menu", menuRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/inventory", inventoryRoutes);
  app.use("/api/sessions", sessionRoutes);
  app.use("/api/reports", reportRoutes);
  app.use("/api/settings", settingsRoutes);

  app.use((request, response) => {
    response.status(404).json({ message: `Route not found: ${request.method} ${request.path}` });
  });

  app.use((error, request, response, next) => {
    void request;
    void next;
    const status = Number(error.status) || 500;
    response.status(status).json({
      message: status < 500 ? error.message : "An unexpected server error occurred.",
    });
  });

  return app;
}

export async function startTestServer() {
  const app = createTestApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function requestRaw(pathname, { method = "GET", token = null, body = undefined } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const buffer = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer);
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, headers: response.headers, text, buffer, json };
  }

  async function requestJson(pathname, options = {}) {
    const res = await requestRaw(pathname, options);
    return { status: res.status, headers: res.headers, data: res.json, text: res.text };
  }

  async function close() {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  return { baseUrl, requestRaw, requestJson, close };
}

export function createCleanupTracker() {
  const userIds = new Set();
  const sessionIds = new Set();
  const orderIds = new Set();
  const productIds = new Set();
  const inventoryItemIds = new Set();
  const menuCategoryIds = new Set();
  const inventoryCategoryIds = new Set();
  let businessSettingsSnapshot = null;

  async function trackBusinessSettings() {
    if (businessSettingsSnapshot) return businessSettingsSnapshot;
    const [[row]] = await pool.execute(
      `SELECT id, business_name, email, phone, address, opening_time, closing_time, target_food_cost, updated_at
         FROM business_settings
        WHERE id = 1
        LIMIT 1`,
    );
    businessSettingsSnapshot = row ? { hadRow: true, row: { ...row } } : { hadRow: false, row: null };
    return businessSettingsSnapshot;
  }

  async function restoreBusinessSettings() {
    if (!businessSettingsSnapshot) return;
    if (businessSettingsSnapshot.hadRow) {
      const orig = businessSettingsSnapshot.row;
      await pool.execute(
        `INSERT INTO business_settings
           (id, business_name, email, phone, address, opening_time, closing_time, target_food_cost, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           business_name = VALUES(business_name),
           email = VALUES(email),
           phone = VALUES(phone),
           address = VALUES(address),
           opening_time = VALUES(opening_time),
           closing_time = VALUES(closing_time),
           target_food_cost = VALUES(target_food_cost),
           updated_at = VALUES(updated_at)`,
        [
          orig.business_name,
          orig.email,
          orig.phone,
          orig.address,
          orig.opening_time,
          orig.closing_time,
          orig.target_food_cost,
          orig.updated_at,
        ],
      );
    } else {
      await pool.execute("DELETE FROM business_settings WHERE id = 1");
    }
  }

  async function createUser({
    role = "staff",
    displayName,
    username = role === "staff" ? "staff" : makeUniqueTag("tala_admin").toLowerCase(),
    password = makeUniqueTag("Pass"),
    isActive = true,
  } = {}) {
    const cleanDisplay = displayName || makeUniqueTag(role === "admin" ? "Tala Admin" : "Tala Cashier");
    const passwordHash = await bcrypt.hash(password, 4);
    const [result] = await pool.execute(
      `INSERT INTO users (username, display_name, password_hash, role, is_active, token_version)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [username, cleanDisplay, passwordHash, role, isActive ? 1 : 0],
    );
    const id = Number(result.insertId);
    userIds.add(id);
    const token = createAccessToken({
      id,
      username,
      displayName: cleanDisplay,
      role,
      token_version: 1,
    });
    return { id, username, displayName: cleanDisplay, role, password, isActive, token };
  }

  async function refreshToken(userId) {
    const [[row]] = await pool.execute(
      "SELECT id, username, display_name, role, token_version FROM users WHERE id = ? LIMIT 1",
      [userId],
    );
    if (!row) return null;
    return createAccessToken({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      token_version: row.token_version,
    });
  }

  async function cleanup() {
    try {
      const uIds = [...userIds];
    const sIds = [...sessionIds];
    const pIds = [...productIds];
    const invIds = [...inventoryItemIds];
    const mCatIds = [...menuCategoryIds];
    const iCatIds = [...inventoryCategoryIds];

    const orderConditions = [];
    const orderParams = [];
    if (orderIds.size > 0) {
      const list = [...orderIds];
      orderConditions.push(`id IN (${list.map(() => "?").join(",")})`);
      orderParams.push(...list);
    }
    if (uIds.length > 0) {
      orderConditions.push(`created_by IN (${uIds.map(() => "?").join(",")})`);
      orderParams.push(...uIds);
    }
    if (sIds.length > 0) {
      orderConditions.push(`session_id IN (${sIds.map(() => "?").join(",")})`);
      orderParams.push(...sIds);
    }
    if (orderConditions.length > 0) {
      const [foundOrders] = await pool.execute(
        `SELECT id FROM orders WHERE ${orderConditions.join(" OR ")}`,
        orderParams,
      );
      for (const row of foundOrders) orderIds.add(Number(row.id));
    }

    const oIds = [...orderIds];

    const consConds = [];
    const consParams = [];
    if (oIds.length > 0) {
      consConds.push(`order_id IN (${oIds.map(() => "?").join(",")})`);
      consParams.push(...oIds);
    }
    if (invIds.length > 0) {
      consConds.push(`inventory_item_id IN (${invIds.map(() => "?").join(",")})`);
      consParams.push(...invIds);
    }
    if (consConds.length > 0) {
      await pool.execute(`DELETE FROM order_inventory_consumptions WHERE ${consConds.join(" OR ")}`, consParams);
    }

    const movConds = [];
    const movParams = [];
    if (invIds.length > 0) {
      movConds.push(`inventory_item_id IN (${invIds.map(() => "?").join(",")})`);
      movParams.push(...invIds);
    }
    if (uIds.length > 0) {
      movConds.push(`user_id IN (${uIds.map(() => "?").join(",")})`);
      movParams.push(...uIds);
    }
    if (oIds.length > 0) {
      movConds.push(`order_id IN (${oIds.map(() => "?").join(",")})`);
      movParams.push(...oIds);
    }
    if (sIds.length > 0) {
      movConds.push(`session_id IN (${sIds.map(() => "?").join(",")})`);
      movParams.push(...sIds);
    }
    if (movConds.length > 0) {
      await pool.execute(`DELETE FROM inventory_movements WHERE ${movConds.join(" OR ")}`, movParams);
    }

    const evtConds = [];
    const evtParams = [];
    if (oIds.length > 0) {
      evtConds.push(`order_id IN (${oIds.map(() => "?").join(",")})`);
      evtParams.push(...oIds);
    }
    if (uIds.length > 0) {
      evtConds.push(`changed_by IN (${uIds.map(() => "?").join(",")})`);
      evtParams.push(...uIds);
    }
    if (evtConds.length > 0) {
      await pool.execute(`DELETE FROM order_status_events WHERE ${evtConds.join(" OR ")}`, evtParams);
    }

    if (oIds.length > 0) {
      await pool.execute(`DELETE FROM orders WHERE id IN (${oIds.map(() => "?").join(",")})`, oIds);
    }

    const auditConds = [];
    const auditParams = [];
    if (uIds.length > 0) {
      auditConds.push(`actor_id IN (${uIds.map(() => "?").join(",")})`);
      auditParams.push(...uIds);
    }
    if (pIds.length > 0) {
      auditConds.push(`(entity_type = 'menu_product' AND entity_id IN (${pIds.map(() => "?").join(",")}))`);
      auditParams.push(...pIds);
    }
    if (invIds.length > 0) {
      auditConds.push(`(entity_type = 'inventory_item' AND entity_id IN (${invIds.map(() => "?").join(",")}))`);
      auditParams.push(...invIds);
    }
    if (auditConds.length > 0) {
      await pool.execute(`DELETE FROM archive_audit_logs WHERE ${auditConds.join(" OR ")}`, auditParams);
    }

    if (pIds.length > 0) {
      await pool.execute(`DELETE FROM menu_products WHERE id IN (${pIds.map(() => "?").join(",")})`, pIds);
    }
    if (invIds.length > 0) {
      await pool.execute(`DELETE FROM inventory_items WHERE id IN (${invIds.map(() => "?").join(",")})`, invIds);
    }

    const sessConds = [];
    const sessParams = [];
    if (sIds.length > 0) {
      sessConds.push(`id IN (${sIds.map(() => "?").join(",")})`);
      sessParams.push(...sIds);
    }
    if (uIds.length > 0) {
      sessConds.push(`user_id IN (${uIds.map(() => "?").join(",")})`);
      sessParams.push(...uIds);
    }
    if (sessConds.length > 0) {
      await pool.execute(`DELETE FROM cashier_sessions WHERE ${sessConds.join(" OR ")}`, sessParams);
    }

    if (mCatIds.length > 0) {
      await pool.execute(`DELETE FROM menu_categories WHERE id IN (${mCatIds.map(() => "?").join(",")})`, mCatIds);
    }
    if (iCatIds.length > 0) {
      await pool.execute(`DELETE FROM inventory_categories WHERE id IN (${iCatIds.map(() => "?").join(",")})`, iCatIds);
    }
      if (uIds.length > 0) {
        await pool.execute(`DELETE FROM users WHERE id IN (${uIds.map(() => "?").join(",")})`, uIds);
      }
    } finally {
      try {
        await restoreBusinessSettings();
      } finally {
        businessSettingsSnapshot = null;
      }
    }
  }

  return {
    userIds,
    sessionIds,
    orderIds,
    productIds,
    inventoryItemIds,
    menuCategoryIds,
    inventoryCategoryIds,
    createUser,
    refreshToken,
    trackBusinessSettings,
    restoreBusinessSettings,
    cleanup,
  };
}
