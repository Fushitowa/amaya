import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import dotenv from "../../api/node_modules/dotenv/lib/main.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../api/.env") });

process.env.DB_NAME = process.env.TEST_DB_NAME || "amaya_test";

if (!process.env.DB_NAME || process.env.DB_NAME === "amaya" || !process.env.DB_NAME.endsWith("_test")) {
  throw new Error(`Refusing to run tests against non-test database "${process.env.DB_NAME}". Set TEST_DB_NAME to a *_test schema.`);
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = "tala-test-jwt-secret-key-minimum-32-chars";
}
