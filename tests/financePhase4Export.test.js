import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCsv, csvCell } from "../src/utils/financeCsv.js";
import { balanceSheetRows, cashFlowRows, journalRows, profitReportRows, reconRows } from "../src/utils/financeExport.js";
import { drawerVarianceStatus, entryTypeLabel, monthLabel } from "../src/config/financeLabels.js";

describe("Finance CSV export", () => {
  it("quotes commas, quotes and line breaks, and keeps numbers as numbers", () => {
    assert.equal(csvCell('Rent, "main" shop'), '"Rent, ""main"" shop"');
    assert.equal(csvCell("two\nlines"), '"two\nlines"');
    assert.equal(csvCell(12.5), "12.5");
    assert.equal(csvCell(-3), "-3");
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
    assert.equal(csvCell(Number.NaN), "");
  });

  it("defuses text a spreadsheet would run as a formula", () => {
    assert.equal(csvCell("=HYPERLINK(\"http://x\")"), "\"'=HYPERLINK(\"\"http://x\"\")\"");
    assert.equal(csvCell("+1+1"), "'+1+1");
    assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(csvCell("-cmd"), "'-cmd");
    assert.equal(csvCell("Normal note"), "Normal note");
  });

  it("starts with a byte order mark and ends rows with CRLF", () => {
    const csv = buildCsv([["a", "b"], [1, 2]]);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(csv.slice(1), "a,b\r\n1,2\r\n");
  });
});

describe("Finance export rows", () => {
  it("leaves hidden journal amounts blank and writes one row per line", () => {
    const rows = journalRows([
      {
        entryNumber: "JE-1", entryDate: "2026-11-01T10:00:00", entryType: "operating_expense", memo: "Rent", creatorName: "Admin",
        amountsLocked: false, isReversal: false, isAlreadyReversed: true,
        lines: [{ accountName: "Rent", debit: 100, credit: 0 }, { accountName: "Cash Drawer", debit: 0, credit: 100 }],
      },
      {
        entryNumber: "JE-2", entryType: "capital_injection", memo: "Capital", amountsLocked: true,
        lines: [{ accountName: "Bank", debit: null, credit: null }],
      },
    ]);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows[1].slice(2, 9), ["Expense", "Rent", "Rent", "Goes to", 100, "Admin", "Cancelled"]);
    assert.equal(rows[2][5], "Comes from");
    assert.equal(rows[3][5], "");
    assert.equal(rows[3][6], "");
  });

  it("writes plain-language headings and keeps null (locked) figures blank", () => {
    assert.equal(reconRows([])[0][2], "Value at Opening");
    const pnl = profitReportRows({ grossSales: 1000, discounts: 50, netSales: 950, cogs: null, netIncome: null, usarGroups: [] });
    assert.deepEqual(pnl.find((r) => r[0] === "Total Sales (before VAT)"), ["Total Sales (before VAT)", 1000]);
    assert.deepEqual(pnl.find((r) => r[0] === "Less: Cost of Ingredients Sold"), ["Less: Cost of Ingredients Sold", ""]);
    assert.equal(cashFlowRows(null).length, 1);
    const bs = balanceSheetRows({ asOfDate: "2026-11-01", assets: { current: [{ accountName: "Cash", amount: 5 }], nonCurrent: [{ accountName: "Wear", amount: 2, isContra: true }] }, totalAssets: 3, liabilities: { current: [] }, equity: { capital: null } });
    assert.deepEqual(bs.find((r) => r[1] === "Wear"), ["What We Own", "Wear", -2]);
    assert.deepEqual(bs.find((r) => r[1] === "Owner's Money Put In"), ["Owner's Share", "Owner's Money Put In", ""]);
  });
});

describe("Finance wording helpers", () => {
  it("turns entry types and months into words", () => {
    assert.equal(entryTypeLabel("ap_settlement"), "Paid a bill");
    assert.equal(entryTypeLabel("some_new_type"), "Some new type");
    assert.equal(entryTypeLabel(""), "Other");
    assert.equal(monthLabel("2026-11"), "November 2026");
  });

  it("grades the cash drawer difference in tiers, short or over alike", () => {
    assert.equal(drawerVarianceStatus(null), null);
    assert.equal(drawerVarianceStatus(0).key, "ok");
    assert.equal(drawerVarianceStatus(-50).key, "ok");
    assert.equal(drawerVarianceStatus(75).key, "review");
    assert.equal(drawerVarianceStatus(-200).key, "review");
    assert.equal(drawerVarianceStatus(-200.01).key, "investigate");
  });
});
