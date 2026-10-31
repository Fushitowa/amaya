import "dotenv/config";
import bcrypt from "bcryptjs";
import pool from "./database.js";

export async function listAccounts() {
  const [rows] = await pool.execute(
    "SELECT id, username, display_name, role, is_active, created_at, updated_at FROM users ORDER BY role ASC, id ASC"
  );
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name || (r.role === "admin" ? "Admin (Owner)" : `Cashier ${r.id}`),
    role: r.role,
    isActive: Boolean(r.is_active),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function setAdminPassword(newPassword) {
  const pass = String(newPassword || "");
  if (pass.length < 8 || pass.length > 128) {
    throw new Error("Admin password must be between 8 and 128 characters.");
  }
  const passwordHash = await bcrypt.hash(pass, 12);
  const [res] = await pool.execute(
    "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE role = 'admin' LIMIT 1",
    [passwordHash]
  );
  if (res.affectedRows === 0) {
    // If admin record does not exist for some reason, create it
    await pool.execute(
      "INSERT INTO users (username, display_name, password_hash, role) VALUES ('admin', 'Admin (Owner)', ?, 'admin')",
      [passwordHash]
    );
  }
  return { success: true, message: "Admin (Owner) password updated successfully." };
}

export async function addCashier(displayName, password) {
  const name = String(displayName || "").trim();
  const pass = String(password || "");
  if (!name || name.length > 80) {
    throw new Error("Cashier display name is required (max 80 characters).");
  }
  if (pass.length < 6 || pass.length > 128) {
    throw new Error("Cashier password must be between 6 and 128 characters.");
  }

  // Check if display name already taken
  const [existingNames] = await pool.execute(
    "SELECT id FROM users WHERE LOWER(display_name) = LOWER(?) LIMIT 1",
    [name]
  );
  if (existingNames.length > 0) {
    throw new Error(`A cashier with the name '${name}' already exists.`);
  }

  // Check password uniqueness across active staff
  const [staffRows] = await pool.execute(
    "SELECT id, display_name, password_hash FROM users WHERE role = 'staff' AND is_active = 1"
  );
  for (const staff of staffRows) {
    const isMatch = await bcrypt.compare(pass, staff.password_hash);
    if (isMatch) {
      throw new Error(`That password is already assigned to ${staff.display_name}. Choose a unique password for this cashier.`);
    }
  }

  const passwordHash = await bcrypt.hash(pass, 12);
  const [result] = await pool.execute(
    "INSERT INTO users (username, display_name, password_hash, role) VALUES ('staff', ?, ?, 'staff')",
    [name, passwordHash]
  );
  return {
    success: true,
    id: result.insertId,
    displayName: name,
    message: `Cashier '${name}' created successfully with login username 'staff'.`,
  };
}

export async function setCashierPassword(identifier, newPassword) {
  const pass = String(newPassword || "");
  if (pass.length < 6 || pass.length > 128) {
    throw new Error("Cashier password must be between 6 and 128 characters.");
  }

  // Identify cashier by id or display_name
  const isNumeric = /^\d+$/.test(String(identifier).trim());
  const query = isNumeric
    ? "SELECT id, display_name FROM users WHERE id = ? AND role = 'staff' LIMIT 1"
    : "SELECT id, display_name FROM users WHERE LOWER(display_name) = LOWER(?) AND role = 'staff' LIMIT 1";
  const [rows] = await pool.execute(query, [identifier]);
  const cashier = rows[0];
  if (!cashier) {
    throw new Error(`Cashier '${identifier}' not found.`);
  }

  // Check that new password doesn't collide with other active staff
  const [staffRows] = await pool.execute(
    "SELECT id, display_name, password_hash FROM users WHERE role = 'staff' AND is_active = 1 AND id != ?",
    [cashier.id]
  );
  for (const staff of staffRows) {
    if (await bcrypt.compare(pass, staff.password_hash)) {
      throw new Error(`That password is already assigned to ${staff.display_name}. Choose a unique password.`);
    }
  }

  const passwordHash = await bcrypt.hash(pass, 12);
  await pool.execute(
    "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
    [passwordHash, cashier.id]
  );
  return {
    success: true,
    id: cashier.id,
    displayName: cashier.display_name,
    message: `Password for '${cashier.display_name}' updated successfully.`,
  };
}

export async function toggleCashier(cashierId) {
  const [rows] = await pool.execute("SELECT id, display_name, is_active FROM users WHERE id = ? AND role = 'staff' LIMIT 1", [cashierId]);
  const cashier = rows[0];
  if (!cashier) throw new Error("Cashier not found.");
  const nextState = cashier.is_active ? 0 : 1;
  await pool.execute("UPDATE users SET is_active = ?, token_version = token_version + 1 WHERE id = ?", [nextState, cashier.id]);
  return {
    success: true,
    id: cashier.id,
    isActive: Boolean(nextState),
    message: `Cashier '${cashier.display_name}' is now ${nextState ? "Active" : "Deactivated"}.`,
  };
}

// CLI handler if invoked directly
const isDirectRun = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("src/account-manager.js");
if (isDirectRun) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "list") {
      const accounts = await listAccounts();
      console.log("ACCOUNTS_JSON:" + JSON.stringify(accounts));
    } else if (command === "set-admin-password") {
      const [pwd] = args;
      const res = await setAdminPassword(pwd);
      console.log(JSON.stringify(res));
    } else if (command === "add-cashier") {
      const [name, pwd] = args;
      const res = await addCashier(name, pwd);
      console.log(JSON.stringify(res));
    } else if (command === "set-cashier-password") {
      const [idOrName, pwd] = args;
      const res = await setCashierPassword(idOrName, pwd);
      console.log(JSON.stringify(res));
    } else if (command === "toggle-cashier") {
      const [id] = args;
      const res = await toggleCashier(id);
      console.log(JSON.stringify(res));
    } else {
      console.log("Usage: node src/account-manager.js <list|set-admin-password|add-cashier|set-cashier-password|toggle-cashier> [args]");
    }
  } catch (err) {
    console.error("ERROR:" + err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
