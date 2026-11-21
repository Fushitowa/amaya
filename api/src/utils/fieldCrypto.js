import crypto from "node:crypto";

/**
 * Encrypts sensitive text fields (employee SSS / PhilHealth / Pag-IBIG / TIN numbers) at rest with
 * AES-256-GCM. Stored format: "v1:<iv>:<tag>:<ciphertext>" (base64 parts).
 *
 * Key: PAYROLL_DATA_KEY (32 bytes as 64 hex chars or base64) when set. Otherwise a key is derived
 * from JWT_SECRET with HKDF. Set PAYROLL_DATA_KEY in production: if the key ever changes, stored IDs
 * can no longer be read (they show as "unreadable" and must be re-entered).
 */
function dataKey() {
  const explicit = String(process.env.PAYROLL_DATA_KEY || "").trim();
  if (explicit) {
    const key = /^[0-9a-f]{64}$/i.test(explicit) ? Buffer.from(explicit, "hex") : Buffer.from(explicit, "base64");
    if (key.length !== 32) throw new Error("PAYROLL_DATA_KEY must be 32 bytes (64 hex characters or base64).");
    return key;
  }
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (secret.length < 32) throw new Error("Set PAYROLL_DATA_KEY (or a 32+ character JWT_SECRET) to store employee IDs.");
  return Buffer.from(crypto.hkdfSync("sha256", secret, "amaya-payroll", "employee-government-ids", 32));
}

export function encryptField(plain) {
  if (plain == null || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Returns the plain text, null for an empty field, or undefined when it cannot be decrypted. */
export function decryptField(stored) {
  if (stored == null || stored === "") return null;
  const [version, iv, tag, ciphertext] = String(stored).split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) return undefined;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

/** "•••• 1234" style mask: only the last 4 characters are ever sent to the browser. */
export function maskField(stored) {
  const plain = decryptField(stored);
  if (plain === null) return null;
  if (plain === undefined) return "unreadable";
  const compact = plain.replace(/[^0-9A-Za-z]/g, "");
  return `•••• ${compact.slice(-4)}`;
}
