# Amaya API

Express API for the Amaya React application. MySQL access stays on the server; the browser only talks to this API.

## Local setup

1. Create an empty MySQL database named `amaya` in Workbench.
2. Run `npm install` from this `api` folder.
3. Copy `.env.example` to `.env` and set `DB_PASSWORD`. Set `JWT_SECRET` to a random secret of at least 32 characters. Never commit `.env`.
4. Run `npm run db:migrate`. This creates the schema, tracks applied migrations across all 34 migration files (001 through 029), expands image storage, and seeds the bundled menu catalog while preserving existing products.
5. Create an administrator account with `npm run user:create -- admin <username>`. The CLI asks for a password without echoing it; use at least 12 characters. Create staff accounts with the same command and `staff` as the role.
6. Start the API with `npm run dev`. It listens on `http://localhost:3001`.
7. Start the Vite frontend separately from the project root with `npm run dev`.

The health endpoint is `GET /api/health`. The API's login, menu, orders, inventory, and settings routes live under `/api`.

## Access rules & Security Gates

- **Public Visitors:** Can read available menu items (`GET /api/menu`) and general business info (`GET /api/settings`). Menu responses are strictly cost-blind (no ingredient costs, margin, or profit numbers exposed), and settings responses omit `targetFoodCost` completely.
- **Counter Staff (`staff`):** Can access counter POS, search products, read orders, record cashier shifts, and submit orders. Staff requests to `GET /api/settings` strip financial targets (`targetFoodCost`), ensuring sensitive margin ratios remain confidential.
- **Administrators (`admin`):** Full management access. Only admins receive `targetFoodCost` on `GET /api/settings` (served with `Cache-Control: private, no-store` and `Vary: Authorization`). Only admins can modify settings (`PUT /api/settings`), modify menu products, manage inventory restocks, or view comprehensive financial reports.
- **Login Session Lifespan:** Login tokens expire after 8 hours. Instant token versioning (`token_version` in Migration 015) revokes compromised or changed credentials immediately across active sessions.

## Settings & Costing Engine Endpoints

- **`GET /api/settings`:**
  - Public / Staff: returns store identity (`businessName`, `email`, `phone`, `address`, `openingTime`, `closingTime`).
  - Admin: returns full configuration including `targetFoodCost` (`0.1000` to `0.9000`, default `0.3000`). Emits private cache control headers so shared intermediaries never cache financial targets.
- **`PUT /api/settings` (Admin Only):**
  - Strict input validation: rejects non-object root payloads (`400`), rejects object/array type coercions, enforces string length limits, applies ReDoS-safe email validation (`<= 254` characters before regex), validates `HH:MM` 24-hour time formats, and enforces `[0.10, 0.90]` bounds on `targetFoodCost`.
  - Database integrity is backed by MariaDB `CHECK (target_food_cost >= 0.1000 AND target_food_cost <= 0.9000)` (Migration 029).
- **`GET /api/menu`:**
  - Dynamically calculates `suggestedPrice` using the store's authoritative `target_food_cost` (rounded to nearest ₱5) for authenticated admin requests.
- **`GET /api/reports/financial-summary` (Admin Only):**
  - Includes `summary.targetFoodCost` for live food cost variance calculations (`actualPct` vs `targetPct`) in Admin Reports.

For deployment, use a dedicated MySQL user with only the privileges the API needs. Do not run the public API with the MySQL `root` account, expose `JWT_SECRET`, or place database credentials in the React app.
