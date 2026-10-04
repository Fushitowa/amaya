# Amaya Drinks & Bites

Amaya is a React/Vite cafe ordering and management app with a MySQL-backed Express API. The public site contains the menu and business pages. Staff can create and process orders; administrators manage the menu, inventory, reports, and business settings.

## Local setup

### 1. Create the database

Create an empty MySQL database named `amaya` in MySQL Workbench. The migration command below creates the tables and starter catalog.

### 2. Configure the API

In a terminal, move into `api` and install its dependencies:

```powershell
cd api
npm install
```

Copy `.env.example` to `.env` from inside the `api` folder, then set the local MySQL password and a random `JWT_SECRET` of at least 32 characters. Keep `.env` private; Git ignores it.

Run the catalog migration and create an administrator account:

```powershell
npm run db:migrate
npm run user:create -- admin your-admin-username
```

The user command prompts for a password without displaying it. Use at least 12 characters. Create staff accounts the same way, replacing `admin` with `staff`.

Start the API and keep that terminal open:

```powershell
npm run dev
```

The API runs at `http://localhost:3001`; its health check is `http://localhost:3001/api/health`.

### 3. Start the frontend

Open a second terminal in the project root (`amaya-web`) and run:

```powershell
npm install
npm run dev
```

Vite runs at `http://localhost:5173`. Sign in with the administrator or staff account you created in the API step.

## API and access

- Public: `GET /api/menu`, `GET /api/settings`, `GET /api/health`
- Authentication: `POST /api/auth/login`, `GET /api/auth/me`
- Menu: authenticated admin create, update, and delete operations
- Orders: authenticated staff and admin create, read, status, payment, confirmation, and delete operations
- Inventory: authenticated staff/admin read; admin create, update, restock, and delete operations
- Settings: public read and authenticated admin update

The API hashes passwords, rate-limits login attempts, validates order prices against the menu, tracks stock changes, and checks user roles server-side. Tokens expire after eight hours. The browser stores the current session token in session storage; database credentials remain in the API environment file.

The menu migration seeds the starter products from the assets already in the frontend. Demo orders are not inserted. Recipe ingredients can be linked to inventory, but automatic ingredient consumption needs a quantity per recipe ingredient; the current menu form only collects ingredient names.

Before deploying, create a dedicated MySQL account with only the permissions the API needs. Do not run the deployed API as MySQL `root` or expose `JWT_SECRET`.
