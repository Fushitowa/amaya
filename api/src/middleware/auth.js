import jwt from "jsonwebtoken";
import pool from "../database.js";

const tokenSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
  }
  return secret;
};

export function createAccessToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username, role: user.role, ver: Number(user.token_version || 1) },
    tokenSecret(),
    { expiresIn: "8h", issuer: "amaya-api", audience: "amaya-web", algorithm: "HS256" },
  );
}

export async function requireAuth(request, response, next) {
  const header = request.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return response.status(401).json({ message: "Sign in to continue." });
  }

  let claims;
  try {
    claims = jwt.verify(token, tokenSecret(), {
      issuer: "amaya-api",
      audience: "amaya-web",
      algorithms: ["HS256"],
    });
  } catch {
    return response.status(401).json({ message: "Your session has expired. Please sign in again." });
  }
  const [rows] = await pool.execute("SELECT id, username, role, is_active, token_version FROM users WHERE id = ? LIMIT 1", [claims.sub]);
  const user = rows[0];
  if (!user || !user.is_active) return response.status(401).json({ message: "Your account is inactive. Please contact an administrator." });
  const tokenVersion = claims.ver != null ? Number(claims.ver) : 1;
  if (tokenVersion !== Number(user.token_version || 1)) {
    return response.status(401).json({ message: "Your session has expired or was revoked. Please sign in again." });
  }
  request.authUser = { sub: String(user.id), username: user.username, role: user.role };
  return next();
}

export function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.authUser || !roles.includes(request.authUser.role)) {
      return response.status(403).json({ message: "You do not have permission to perform this action." });
    }
    return next();
  };
}

export async function optionalAuth(request, _response, next) {
  const header = request.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) {
    try {
      const claims = jwt.verify(token, tokenSecret(), {
        issuer: "amaya-api",
        audience: "amaya-web",
        algorithms: ["HS256"],
      });
      const [rows] = await pool.execute("SELECT id, username, role, is_active, token_version FROM users WHERE id = ? LIMIT 1", [claims.sub]);
      const user = rows[0];
      const tokenVersion = claims.ver != null ? Number(claims.ver) : 1;
      request.authUser = user && user.is_active && tokenVersion === Number(user.token_version || 1)
        ? { sub: String(user.id), username: user.username, role: user.role }
        : null;
    } catch {
      request.authUser = null;
    }
  }
  next();
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
