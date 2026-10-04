# Amaya API

Express API for the Amaya React application. MySQL access stays on the server; the browser only talks to this API.

## Local setup

1. Create an empty MySQL database named `amaya` in Workbench.
2. Run `npm install` from this `api` folder.
3. Copy `.env.example` to `.env` and set `DB_PASSWORD`. Set `JWT_SECRET` to a random secret of at least 32 characters. Never commit `.env`.
4. Run `npm run db:migrate`. This creates the schema, tracks applied migrations, expands image storage, and seeds the bundled menu catalog while preserving existing products.
5. Create an administrator account with `npm run user:create -- admin <username>`. The CLI asks for a password without echoing it; use at least 12 characters. Create staff accounts with the same command and `staff` as the role.
6. Start the API with `npm run dev`. It listens on `http://localhost:3001`.
7. Start the Vite frontend separately from the project root with `npm run dev`.

The health endpoint is `GET /api/health`. The API's login, menu, orders, inventory, and settings routes live under `/api`.

## Access rules

- Public visitors can read available menu items and business settings.
- Signed-in staff and admins can read orders and inventory.
- Only admins can change menu items, inventory, or business settings.
- Staff and admins can create and process orders.
- Login tokens expire after eight hours. Staff and admin pages are also protected in the React router.

For deployment, use a dedicated MySQL user with only the privileges the API needs. Do not run the public API with the MySQL `root` account, expose `JWT_SECRET`, or place database credentials in the React app.
