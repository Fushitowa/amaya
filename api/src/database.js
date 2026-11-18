import mysql from "mysql2/promise";

const dbUser = process.env.DB_USER || "root";
const dbPassword = process.env.DB_PASSWORD || "";

if (process.env.NODE_ENV === "production" && (dbUser === "root" || !dbPassword)) {
  throw new Error(
    "Refusing to connect in production with root or empty DB_PASSWORD. Configure a dedicated least-privilege DB_USER and DB_PASSWORD.",
  );
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: dbUser,
  password: dbPassword,
  database: process.env.DB_NAME || "amaya",
  timezone: "+08:00",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+08:00'", (err) => {
    if (err) {
      console.warn("Could not set MariaDB session time_zone:", err.message);
    }
  });
});

export default pool;
