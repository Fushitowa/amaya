import "dotenv/config";
import bcrypt from "bcryptjs";
import pool from "./database.js";

function statusError(status, message) {
  return Object.assign(new Error(message), { status });
}

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
  if (pass.length < 8 || Buffer.byteLength(pass, "utf8") > 72) {
    throw statusError(400, "Admin password must be at least 8 characters and at most 72 bytes.");
  }
  const passwordHash = await bcrypt.hash(pass, 12);
  const [res] = await pool.execute(
    "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE role = 'admin' LIMIT 1",
    [passwordHash]
  );
  if (res.affectedRows === 0) {
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
  if (!name || name.length > 100) {
    throw statusError(400, "Cashier display name is required (max 100 characters).");
  }
  if (pass.length < 6 || Buffer.byteLength(pass, "utf8") > 72) {
    throw statusError(400, "Cashier password must be at least 6 characters and at most 72 bytes.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Lock existing users with matching name or staff role to prevent TOCTOU password/name collisions
    const [existingNames] = await connection.execute(
      "SELECT id FROM users WHERE LOWER(display_name) = LOWER(?) LIMIT 1 FOR UPDATE",
      [name]
    );
    if (existingNames.length > 0) {
      throw statusError(409, `A cashier with the name '${name}' already exists.`);
    }

    const [staffRows] = await connection.execute(
      "SELECT id, display_name, password_hash FROM users WHERE role = 'staff' FOR UPDATE"
    );
    for (const staff of staffRows) {
      const isMatch = await bcrypt.compare(pass, staff.password_hash);
      if (isMatch) {
        throw statusError(409, `That password is already assigned to ${staff.display_name || `Cashier ${staff.id}`}. Choose a unique password for this cashier.`);
      }
    }

    const passwordHash = await bcrypt.hash(pass, 12);
    const [result] = await connection.execute(
      "INSERT INTO users (username, display_name, password_hash, role) VALUES ('staff', ?, ?, 'staff')",
      [name, passwordHash]
    );
    await connection.commit();
    return {
      success: true,
      id: result.insertId,
      displayName: name,
      message: `Cashier '${name}' created successfully with login username 'staff'.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function setCashierPassword(identifier, newPassword) {
  const pass = String(newPassword || "");
  if (pass.length < 6 || Buffer.byteLength(pass, "utf8") > 72) {
    throw statusError(400, "Cashier password must be at least 6 characters and at most 72 bytes.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const isNumeric = /^\d+$/.test(String(identifier).trim());
    const query = isNumeric
      ? "SELECT id, display_name FROM users WHERE id = ? AND role = 'staff' LIMIT 1 FOR UPDATE"
      : "SELECT id, display_name FROM users WHERE LOWER(display_name) = LOWER(?) AND role = 'staff' LIMIT 1 FOR UPDATE";
    const [rows] = await connection.execute(query, [identifier]);
    const cashier = rows[0];
    if (!cashier) {
      throw statusError(404, `Cashier '${identifier}' not found.`);
    }

    // Check against all other staff accounts (including inactive) so reactivation never causes login collisions
    const [staffRows] = await connection.execute(
      "SELECT id, display_name, password_hash FROM users WHERE role = 'staff' AND id != ? FOR UPDATE",
      [cashier.id]
    );
    for (const staff of staffRows) {
      if (await bcrypt.compare(pass, staff.password_hash)) {
        throw statusError(409, `That password is already assigned to ${staff.display_name || `Cashier ${staff.id}`}. Choose a unique password.`);
      }
    }

    const passwordHash = await bcrypt.hash(pass, 12);
    await connection.execute(
      "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
      [passwordHash, cashier.id]
    );
    await connection.commit();
    return {
      success: true,
      id: cashier.id,
      displayName: cashier.display_name,
      message: `Password for '${cashier.display_name}' updated successfully.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function renameCashier(cashierId, displayName) {
  const id = Number(cashierId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw statusError(400, "Invalid cashier ID.");
  }
  const cleanName = String(displayName || "").trim();
  if (!cleanName || cleanName.length > 100) {
    throw statusError(400, "Cashier display name must be between 1 and 100 characters.");
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT id, display_name, is_active FROM users WHERE id = ? AND role = 'staff' LIMIT 1 FOR UPDATE",
      [id]
    );
    const cashier = rows[0];
    if (!cashier) {
      throw statusError(404, "Cashier not found.");
    }

    const [duplicates] = await connection.execute(
      "SELECT id FROM users WHERE LOWER(display_name) = LOWER(?) AND id != ? LIMIT 1 FOR UPDATE",
      [cleanName, id]
    );
    if (duplicates.length > 0) {
      throw statusError(409, `A user with the display name '${cleanName}' already exists.`);
    }

    await connection.execute(
      "UPDATE users SET display_name = ? WHERE id = ?",
      [cleanName, id]
    );
    await connection.commit();
    return {
      id: Number(cashier.id),
      displayName: cleanName,
      isActive: Boolean(cashier.is_active),
      message: `Cashier renamed to '${cleanName}'.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function toggleCashier(cashierId) {
  const id = Number(cashierId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw statusError(400, "Invalid cashier ID.");
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT id, display_name, is_active FROM users WHERE id = ? AND role = 'staff' LIMIT 1 FOR UPDATE",
      [id]
    );
    const cashier = rows[0];
    if (!cashier) throw statusError(404, "Cashier not found.");
    const nextState = cashier.is_active ? 0 : 1;
    await connection.execute(
      "UPDATE users SET is_active = ?, token_version = token_version + 1 WHERE id = ?",
      [nextState, cashier.id]
    );
    await connection.commit();
    return {
      success: true,
      id: cashier.id,
      isActive: Boolean(nextState),
      message: `Cashier '${cashier.display_name}' is now ${nextState ? "Active" : "Deactivated"}.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
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
