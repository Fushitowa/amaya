import "dotenv/config";
import bcrypt from "bcryptjs";
import { stdin, stdout } from "node:process";
import pool from "./database.js";

function askHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.reject(new Error("Run this command in an interactive terminal so the password can be entered safely."));
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (buffer) => {
      for (const character of buffer.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("Cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    stdin.on("data", onData);
  });
}

const [role, ...usernameParts] = process.argv.slice(2);
const username = usernameParts.join(" ").trim();
if (!['admin', 'staff'].includes(role) || !username || username.length > 80) {
  console.error("Usage: npm run user:create -- <admin|staff> <username>");
  process.exitCode = 1;
} else {
  try {
    const password = await askHidden("Choose a password (input hidden): ");
    if (password.length < 12) throw new Error("Use a password with at least 12 characters.");
    const confirmation = await askHidden("Confirm password (input hidden): ");
    if (password !== confirmation) throw new Error("Passwords did not match.");
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)", [username, passwordHash, role]);
    console.log(`${role} account created for ${username}.`);
  } catch (error) {
    console.error(error.code === "ER_DUP_ENTRY" ? "That username already exists." : error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
