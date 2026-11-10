import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "../api/node_modules/bcryptjs/index.js";
import pool from "../api/src/database.js";
import { addCashier, setCashierPassword, listAccounts } from "../api/src/account-manager.js";

test("Cashier Multi-User & Shared 'staff' Username System", async (t) => {
  try {
    await t.test("lists active accounts with Admin and Staff cashiers", async () => {
      const accounts = await listAccounts();
      const admin = accounts.find((a) => a.role === "admin");
      const staff = accounts.find((a) => a.role === "staff");

      assert.ok(admin, "Admin account must exist");
      assert.equal(admin.username, "admin");

      assert.ok(staff, "Staff account must exist");
      assert.equal(staff.username, "staff");
      assert.ok(staff.displayName, "Staff must have a cashier display name");
    });

    await t.test("authenticates different cashiers using the same username 'staff'", async () => {
      // Look up Cashier 1 and Cashier 2
      const [staffRows] = await pool.execute(
        "SELECT id, username, display_name, password_hash FROM users WHERE role = 'staff' AND is_active = 1"
      );
      assert.ok(staffRows.length >= 2, "Should have at least 2 cashiers for this test");

      // Test resolving Cashier 2 by entering 'staff 2'
      let resolvedCashier = null;
      for (const staff of staffRows) {
        if (await bcrypt.compare("staff 2", staff.password_hash)) {
          resolvedCashier = staff;
          break;
        }
      }
      assert.ok(resolvedCashier, "Must resolve cashier with password 'staff 2'");
      assert.equal(resolvedCashier.display_name, "Cashier 2");
      assert.equal(resolvedCashier.username, "staff");
    });

    await t.test("prevents duplicate passwords among active cashiers", async () => {
      await assert.rejects(
        async () => {
          // Attempting to add a new cashier with an already-used password 'staff 2'
          await addCashier("Duplicate Cashier", "staff 2");
        },
        /already assigned to/
      );
    });

    await t.test("enforces length bounds and active password uniqueness in setCashierPassword", async () => {
      const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      const tempName = `Temp Cashier ${uniqueSuffix}`;
      let tempCashierId = null;

      try {
        const created = await addCashier(tempName, `init_${uniqueSuffix}`);
        tempCashierId = created.id;

        await assert.rejects(
          async () => setCashierPassword(tempCashierId, "12345"),
          (err) => err.status === 400 && /at least 6 characters/i.test(err.message)
        );

        await assert.rejects(
          async () => setCashierPassword(tempCashierId, "x".repeat(73)),
          (err) => err.status === 400 && /72 bytes/i.test(err.message)
        );

        await assert.rejects(
          async () => setCashierPassword(tempCashierId, "staff 2"),
          (err) => err.status === 409 && /already assigned to/i.test(err.message)
        );

        const updated = await setCashierPassword(tempCashierId, `next_${uniqueSuffix}`);
        assert.equal(updated.success, true);
        assert.equal(updated.id, tempCashierId);

        const [[row]] = await pool.execute("SELECT password_hash FROM users WHERE id = ?", [tempCashierId]);
        assert.equal(await bcrypt.compare(`next_${uniqueSuffix}`, row.password_hash), true);
      } finally {
        if (tempCashierId) {
          await pool.execute("DELETE FROM users WHERE id = ?", [tempCashierId]);
        }
      }
    });
  } finally {
    await pool.end();
  }
});
