import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const testsDir = path.join(rootDir, "tests");

const entries = await fs.readdir(testsDir, { withFileTypes: true });
const testFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
  .map((entry) => `tests/${entry.name}`)
  .sort();

if (testFiles.length === 0) {
  console.error("No *.test.js files found in tests/.");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1", ...testFiles],
  {
    cwd: rootDir,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
