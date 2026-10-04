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
    { sub: String(user.id), username: user.username, role: user.role },
    tokenSecret(),
    { expiresIn: "8h", issuer: "amaya-api", audience: "amaya-web" },
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
    });
  } catch {
    return response.status(401).json({ message: "Your session has expired. Please sign in again." });
  }
  const [rows] = await pool.execute("SELECT id, username, role, is_active FROM users WHERE id = ? LIMIT 1", [claims.sub]);
  const user = rows[0];
  if (!user || !user.is_active) return response.status(401).json({ message: "Your account is inactive. Please contact an administrator." });
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

export function optionalAuth(request, _response, next) {
  const header = request.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) {
    try {
      request.authUser = jwt.verify(token, tokenSecret(), {
        issuer: "amaya-api",
        audience: "amaya-web",
      });
    } catch {
      request.authUser = null;
    }
  }
  next();
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
