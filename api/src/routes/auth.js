import { Router } from "express";
import bcrypt from "bcryptjs";
import pool from "../database.js";
import { createAccessToken, requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/login", async (request, response) => {
  const username = String(request.body?.username || "").trim();
  const password = String(request.body?.password || "");
  if (!username || !password) {
    return response.status(400).json({ message: "Enter your username and password." });
  }

  const [rows] = await pool.execute(
    "SELECT id, username, password_hash, role, is_active FROM users WHERE username = ? LIMIT 1",
    [username],
  );
  const user = rows[0];
  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    return response.status(401).json({ message: "Invalid username or password." });
  }

  const profile = { id: user.id, username: user.username, role: user.role };
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
  await pool.execute("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, user.id]);
  response.json({ message: "Password updated successfully." });
});

router.get("/me", requireAuth, async (request, response) => {
  const [rows] = await pool.execute(
    "SELECT id, username, role, is_active FROM users WHERE id = ? LIMIT 1",
    [request.authUser.sub],
  );
  const user = rows[0];
  if (!user || !user.is_active) return response.status(401).json({ message: "Account is inactive." });
  response.json({ id: user.id, username: user.username, role: user.role });
});

export default router;
