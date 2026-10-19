import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pool from "./database.js";
import authRoutes from "./routes/auth.js";
import menuRoutes from "./routes/menu.js";
import orderRoutes from "./routes/orders.js";
import inventoryRoutes from "./routes/inventory.js";
import settingsRoutes from "./routes/settings.js";
import notificationRoutes, { runInventoryAlertCheck } from "./routes/notifications.js";
import archiveRoutes, { runArchivePurgeCheck } from "./routes/archive.js";

const app = express();
const port = Number(process.env.PORT || 3001);

const configuredOrigins = (process.env.WEB_ORIGIN || "").split(",").map((origin) => origin.trim()).filter(Boolean);
const devOrigins = process.env.NODE_ENV === "production" ? [] : ["http://localhost:5173", "http://localhost:5174"];
const allowedOrigins = [...new Set([...configuredOrigins, ...devOrigins])];
app.use(helmet());
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "9mb" }));

app.get("/", (_request, response) => {
  response.json({ name: "Amaya API", status: "running", health: "/api/health" });
});

app.get("/api/health", async (_request, response) => {
  try {
    const [rows] = await pool.query("SELECT DATABASE() AS databaseName, 1 AS connected");
    response.json({
      status: "ok",
      database: rows[0].databaseName,
      connected: Boolean(rows[0].connected),
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);
    response.status(503).json({ status: "error", message: "Could not connect to the database." });
  }
});

app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false }));
app.use("/api/auth", authRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/archive", archiveRoutes);

app.use((request, response) => {
  response.status(404).json({ message: `Route not found: ${request.method} ${request.path}` });
});

app.use((error, _request, response, _next) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error("API request failed:", error);
  response.status(status).json({ message: status < 500 ? error.message : "An unexpected server error occurred." });
});

app.listen(port, () => {
  console.log(`Amaya API listening at http://localhost:${port}`);
  const runBackgroundMonitors = () => {
    runInventoryAlertCheck()
      .then(({ inactiveAlerts }) => {
        if (inactiveAlerts) console.log(`Inventory inactivity monitor found ${inactiveAlerts} newly inactive item(s).`);
      })
      .catch((error) => console.warn("Inventory inactivity monitor check failed:", error.message));
    runArchivePurgeCheck()
      .then(({ purgedMenuCount = 0, purgedInventoryCount = 0 } = {}) => {
        const purgedCount = purgedMenuCount + purgedInventoryCount;
        if (purgedCount) console.log(`Archive auto-purge removed ${purgedCount} expired item(s) older than 30 days.`);
      })
      .catch((error) => console.warn("Archive auto-purge check failed:", error.message));
  };
  runBackgroundMonitors();
  const monitorInterval = setInterval(runBackgroundMonitors, 60_000);
  monitorInterval.unref();
});

async function closeDatabasePool() {
  await pool.end();
}

process.on("SIGINT", closeDatabasePool);
process.on("SIGTERM", closeDatabasePool);
