import { Router } from "express";
import bcrypt from "bcryptjs";
import pool from "../database.js";
import { createAccessToken, requireAuth, requireRole } from "../middleware/auth.js";
import { addCashier, setCashierPassword, toggleCashier } from "../account-manager.js";

const router = Router();
const DUMMY_HASH = "$2a$12$e8Y5t1hKq9w2N7vU4jF.peGzL5fXb9qW0K8r3Z7Y2x8U1c4m6V8qS";

router.post("/login", async (request, response) => {
  const username = String(request.body?.username || "").trim();
  const password = String(request.body?.password || "");
  if (!username || !password) {
    return response.status(400).json({ message: "Enter your username and password." });
  }

  const cleanUser = username.toLowerCase();

  // 1. Staff Login: Username is 'staff' (case-insensitive: staff, STAFF, Staff)
  if (cleanUser === "staff") {
    const [staffRows] = await pool.execute(
      "SELECT id, username, display_name, password_hash, role, token_version, is_active FROM users WHERE role = 'staff' AND is_active = 1 ORDER BY id ASC"
    );

    let authenticatedStaff = null;
    for (const staff of staffRows) {
      const match = await bcrypt.compare(password, staff.password_hash);
      if (match) {
        authenticatedStaff = staff;
        break;
      }
    }

    if (!authenticatedStaff) {
      // Run dummy compare to mitigate timing attacks
      await bcrypt.compare(password, DUMMY_HASH);
      return response.status(401).json({ message: "Invalid username or password." });
    }

    const profile = {
      id: authenticatedStaff.id,
      username: "staff",
      displayName: authenticatedStaff.display_name || `Cashier ${authenticatedStaff.id}`,
      role: "staff",
      token_version: authenticatedStaff.token_version,
    };
    return response.json({ token: createAccessToken(profile), user: profile });
  }

  // 2. Admin Login: Username is 'admin' (case-insensitive)
  if (cleanUser === "admin") {
    const [adminRows] = await pool.execute(
      "SELECT id, username, display_name, password_hash, role, token_version, is_active FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1"
    );
    const admin = adminRows[0];
    const targetHash = admin ? admin.password_hash : DUMMY_HASH;
    const passwordValid = await bcrypt.compare(password, targetHash);
    if (!admin || !passwordValid) {
      return response.status(401).json({ message: "Invalid username or password." });
    }

    const profile = {
      id: admin.id,
      username: "admin",
      displayName: admin.display_name || "Admin (Owner)",
      role: "admin",
      token_version: admin.token_version,
    };
    return response.json({ token: createAccessToken(profile), user: profile });
  }

  // 3. Fallback: Lookup by specific username or display_name
  const [rows] = await pool.execute(
    "SELECT id, username, display_name, password_hash, role, token_version, is_active FROM users WHERE (LOWER(username) = ? OR LOWER(display_name) = ?) LIMIT 1",
    [cleanUser, cleanUser],
  );
  const user = rows[0];
  const targetHash = user ? user.password_hash : DUMMY_HASH;
  const passwordValid = await bcrypt.compare(password, targetHash);
  if (!user || !user.is_active || !passwordValid) {
    return response.status(401).json({ message: "Invalid username or password." });
  }

  const profile = {
    id: user.id,
    username: user.username,
    displayName: user.display_name || (user.role === "admin" ? "Admin (Owner)" : `Cashier ${user.id}`),
    role: user.role,
    token_version: user.token_version,
  };
  return response.json({ token: createAccessToken(profile), user: profile });
});

router.post("/change-password", requireAuth, async (request, response) => {
  const currentPassword = String(request.body?.currentPassword || "");
  const newPassword = String(request.body?.newPassword || "");
  if (newPassword.length < 8 || newPassword.length > 128) {
    return response.status(400).json({ message: "Your new password must be between 8 and 128 characters." });
  }
  if (currentPassword === newPassword) {
    return response.status(400).json({ message: "Choose a new password that differs from your current one." });
  }

  const [rows] = await pool.execute("SELECT id, password_hash FROM users WHERE id = ? LIMIT 1", [request.authUser.sub]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(currentPassword, user.password_hash))) {
    return response.status(400).json({ message: "Your current password is incorrect." });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.execute("UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?", [passwordHash, user.id]);
  response.json({ message: "Password updated successfully." });
});

router.get("/me", requireAuth, async (request, response) => {
  const [rows] = await pool.execute(
    "SELECT id, username, display_name, role, is_active FROM users WHERE id = ? LIMIT 1",
    [request.authUser.sub],
  );
  const user = rows[0];
  if (!user || !user.is_active) return response.status(401).json({ message: "Account is inactive." });
  response.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name || (user.role === "admin" ? "Admin (Owner)" : `Cashier ${user.id}`),
    role: user.role,
  });
});

// --- CASHIER TEAM MANAGEMENT (ADMIN ONLY) ---

router.get("/cashiers", requireAuth, requireRole("admin"), async (_request, response) => {
  const [rows] = await pool.execute(
    "SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users WHERE role = 'staff' ORDER BY id ASC"
  );
  response.json(
    rows.map((r) => ({
      id: r.id,
      username: "staff",
      displayName: r.display_name || `Cashier ${r.id}`,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  );
});

router.post("/cashiers", requireAuth, requireRole("admin"), async (request, response) => {
  try {
    const { displayName, password } = request.body || {};
    const res = await addCashier(displayName, password);
    response.status(201).json(res);
  } catch (err) {
    response.status(400).json({ message: err.message });
  }
});

router.put("/cashiers/:id/password", requireAuth, requireRole("admin"), async (request, response) => {
  try {
    const { id } = request.params;
    const { password } = request.body || {};
    const res = await setCashierPassword(id, password);
    response.json(res);
  } catch (err) {
    response.status(400).json({ message: err.message });
  }
});

router.post("/cashiers/:id/toggle", requireAuth, requireRole("admin"), async (request, response) => {
  try {
    const { id } = request.params;
    const res = await toggleCashier(id);
    response.json(res);
  } catch (err) {
    response.status(400).json({ message: err.message });
  }
});

export default router;
