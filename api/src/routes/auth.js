import { Router } from "express";
import bcrypt from "bcryptjs";
import pool from "../database.js";
import { createAccessToken, requireAuth, requireRole } from "../middleware/auth.js";
import { addCashier, renameCashier, setCashierPassword, toggleCashier } from "../account-manager.js";

const router = Router();
const DUMMY_HASH = "$2a$12$e8Y5t1hKq9w2N7vU4jF.peGzL5fXb9qW0K8r3Z7Y2x8U1c4m6V8qS";

function isWithinBcryptLimit(password) {
  return Buffer.byteLength(String(password || ""), "utf8") <= 72;
}

function hasTargetedCashierLookup(body = {}) {
  return [body?.cashierId, body?.displayName, body?.identifier].some(
    (val) => val !== undefined && val !== null && String(val).trim() !== ""
  );
}

async function findActiveStaffTarget({ cashierId, displayName, identifier }) {
  if (cashierId !== undefined && cashierId !== null && String(cashierId).trim() !== "") {
    const idNum = Number(cashierId);
    if (!Number.isSafeInteger(idNum) || idNum <= 0) return null;
    const [rows] = await pool.execute(
      "SELECT id, username, display_name, password_hash, role, token_version, is_active FROM users WHERE id = ? AND role = 'staff' AND is_active = 1 LIMIT 1",
      [idNum]
    );
    return rows[0] || null;
  }

  const target = String(displayName ?? identifier ?? "").trim();
  if (!target) return null;
  if (/^\d+$/.test(target)) {
    const idNum = Number(target);
    const [rows] = await pool.execute(
      "SELECT id, username, display_name, password_hash, role, token_version, is_active FROM users WHERE role = 'staff' AND is_active = 1 AND (id = ? OR LOWER(display_name) = LOWER(?)) LIMIT 1",
      [Number.isSafeInteger(idNum) && idNum > 0 ? idNum : -1, target]
    );
    return rows[0] || null;
  }

  const [rows] = await pool.execute(
    "SELECT id, username, display_name, password_hash, role, token_version, is_active FROM users WHERE role = 'staff' AND is_active = 1 AND (LOWER(display_name) = LOWER(?) OR LOWER(username) = LOWER(?)) LIMIT 1",
    [target, target]
  );
  return rows[0] || null;
}

router.post("/login", async (request, response) => {
  const username = String(request.body?.username || "").trim();
  const password = String(request.body?.password || "");
  if (!username || !password) {
    return response.status(400).json({ message: "Enter your username and password." });
  }
  if (!isWithinBcryptLimit(password)) {
    return response.status(400).json({ message: "Password must not exceed 72 bytes." });
  }

  const cleanUser = username.toLowerCase();

  // 1. Staff Login: Username is 'staff' (case-insensitive: staff, STAFF, Staff)
  if (cleanUser === "staff") {
    let authenticatedStaff = null;
    if (hasTargetedCashierLookup(request.body)) {
      const target = await findActiveStaffTarget(request.body || {});
      const targetHash = target ? target.password_hash : DUMMY_HASH;
      const match = await bcrypt.compare(password, targetHash);
      if (target && match) {
        authenticatedStaff = target;
      }
    } else {
      const [staffRows] = await pool.execute(
        "SELECT id, username, display_name, password_hash, role, token_version, is_active FROM users WHERE role = 'staff' AND is_active = 1 ORDER BY id ASC"
      );

      for (const staff of staffRows) {
        const match = await bcrypt.compare(password, staff.password_hash);
        if (match) {
          authenticatedStaff = staff;
          break;
        }
      }

      if (!authenticatedStaff) {
        await bcrypt.compare(password, DUMMY_HASH);
      }
    }

    if (!authenticatedStaff) {
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

router.post("/switch-cashier", requireAuth, async (request, response) => {
  const password = String(request.body?.password || "");
  if (!password) {
    return response.status(400).json({ message: "Enter your cashier password." });
  }
  if (!isWithinBcryptLimit(password)) {
    return response.status(400).json({ message: "Password must not exceed 72 bytes." });
  }

  let authenticatedStaff = null;
  if (hasTargetedCashierLookup(request.body)) {
    const target = await findActiveStaffTarget(request.body || {});
    const targetHash = target ? target.password_hash : DUMMY_HASH;
    const match = await bcrypt.compare(password, targetHash);
    if (target && match) {
      authenticatedStaff = target;
    }
  } else {
    const [staffRows] = await pool.execute(
      "SELECT id, username, display_name, password_hash, role, token_version, is_active FROM users WHERE role = 'staff' AND is_active = 1 ORDER BY id ASC"
    );

    for (const staff of staffRows) {
      if (await bcrypt.compare(password, staff.password_hash)) {
        authenticatedStaff = staff;
        break;
      }
    }

    if (!authenticatedStaff) {
      await bcrypt.compare(password, DUMMY_HASH);
    }
  }

  if (!authenticatedStaff) {
    return response.status(403).json({ message: "Invalid cashier password." });
  }

  const profile = {
    id: authenticatedStaff.id,
    username: "staff",
    displayName: authenticatedStaff.display_name || `Cashier ${authenticatedStaff.id}`,
    role: "staff",
    token_version: authenticatedStaff.token_version,
  };
  return response.json({ token: createAccessToken(profile), user: profile });
});

router.post("/logout", requireAuth, async (request, response) => {
  await pool.execute(
    "UPDATE users SET token_version = token_version + 1 WHERE id = ?",
    [request.authUser.sub]
  );
  return response.json({ loggedOut: true });
});

router.post("/change-password", requireAuth, async (request, response) => {
  // Cashiers are identified by password alone (login and Switch Cashier), so cashier
  // passwords must stay unique. Letting a cashier choose their own password would
  // reveal whether a guess belongs to a coworker. Only the owner sets cashier passwords
  // (PUT /api/auth/cashiers/:id/password or the control panel's account manager).
  if (request.authUser.role !== "admin") {
    return response.status(403).json({ message: "Ask the owner to change your cashier password." });
  }
  const currentPassword = String(request.body?.currentPassword || "");
  const newPassword = String(request.body?.newPassword || "");

  if (!isWithinBcryptLimit(currentPassword) || !isWithinBcryptLimit(newPassword)) {
    return response.status(400).json({ message: "Passwords must not exceed 72 bytes." });
  }
  if (currentPassword === newPassword) {
    return response.status(400).json({ message: "Choose a new password that differs from your current one." });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT id, role, password_hash FROM users WHERE id = ? LIMIT 1 FOR UPDATE",
      [request.authUser.sub]
    );
    const user = rows[0];
    if (!user) {
      await connection.rollback();
      return response.status(401).json({ message: "Account not found." });
    }

    const minLen = 8; // only the owner (admin) can reach this point
    if (newPassword.length < minLen) {
      await connection.rollback();
      return response.status(400).json({
        message: `Your new password must be at least ${minLen} characters and at most 72 bytes.`,
      });
    }

    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      await connection.rollback();
      return response.status(400).json({ message: "Your current password is incorrect." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await connection.execute(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
      [passwordHash, user.id]
    );
    await connection.commit();
    return response.json({ message: "Password updated successfully." });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
    response.status(err.status || 400).json({ message: err.message });
  }
});

router.put("/cashiers/:id", requireAuth, requireRole("admin"), async (request, response) => {
  try {
    const { id } = request.params;
    const { displayName } = request.body || {};
    const res = await renameCashier(id, displayName);
    response.json(res);
  } catch (err) {
    response.status(err.status || 400).json({ message: err.message });
  }
});

router.put("/cashiers/:id/password", requireAuth, requireRole("admin"), async (request, response) => {
  try {
    const { id } = request.params;
    const { password } = request.body || {};
    const res = await setCashierPassword(id, password);
    response.json(res);
  } catch (err) {
    response.status(err.status || 400).json({ message: err.message });
  }
});

router.post("/cashiers/:id/toggle", requireAuth, requireRole("admin"), async (request, response) => {
  try {
    const { id } = request.params;
    const res = await toggleCashier(id);
    response.json(res);
  } catch (err) {
    response.status(err.status || 400).json({ message: err.message });
  }
});

export default router;
