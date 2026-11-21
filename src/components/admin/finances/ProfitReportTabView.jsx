import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import { peso, lockedPeso, round2, LOCKED_TEXT } from "../../../utils/financeFormat.js";
import { PNL_TERMS } from "../../../config/financeLabels.js";

const PNL_DISPLAY_GROUPS = [
  { key: "Labor & Payroll", label: "1. Labor & Payroll" },
  { key: "Rent & Occupancy", label: "2. Rent & Occupancy" },
  { key: "Utilities", label: "3. Utilities" },
  { key: "Operating Supplies", label: "4. Operating Supplies" },
  { key: "Advertising & Marketing", label: "5. Advertising & Marketing" },
  { key: "Repairs & Maintenance", label: "6. Repairs & Maintenance" },
  { key: "General & Administrative (G&A)", label: "7. General & Administrative (G&A)" },
  { key: "Others & Legacy", label: "8. Others & Legacy" },
];

function buildPnlOpexWaterfallGroups(items = []) {
  const byDisplayKey = new Map(PNL_DISPLAY_GROUPS.map((g) => [g.key, []]));
  for (const item of items) {
    const rawGroup = item.expenseGroup || "Others";
    const key = (rawGroup === "Others" || rawGroup === "Utilities & Rent (Legacy)")
      ? "Others & Legacy"
      : (byDisplayKey.has(rawGroup) ? rawGroup : "Others & Legacy");
    byDisplayKey.get(key).push(item);
  }
  return PNL_DISPLAY_GROUPS.map((g) => {
    const rows = [...(byDisplayKey.get(g.key) || [])].sort((a, b) =>
      String(a.accountCode).localeCompare(String(b.accountCode)),
    );
    const subtotal = round2(rows.reduce((sum, r) => sum + Number(r.amount || 0), 0));
    return {
      key: g.key,
      label: g.label,
      rows,
      subtotal,
    };
  });
}


/** The Profit Report: sales, costs and profit as a step-by-step waterfall. */
export default function ProfitReportTabView({ pnlData, netIncomePin, withCode, openActionModal }) {
  // Collapse / zero-group controls for the cost groups.
  const [expandedOpexGroups, setExpandedOpexGroups] = useState({});
  const [showZeroOpexGroups, setShowZeroOpexGroups] = useState(true);


  // USAR groups from the server (Labor / Controllable / Occupancy); older responses fall back to
  // the expense-group waterfall, all treated as controllable.
  const pnlOpexWaterfall = useMemo(() => {
    if (Array.isArray(pnlData?.usarGroups) && pnlData.usarGroups.length) {
      return pnlData.usarGroups.map((group) => ({
        key: group.key,
        label: group.label,
        section: group.section,
        rows: group.accounts || [],
        subtotal: round2(group.amount),
      }));
    }
    return buildPnlOpexWaterfallGroups(pnlData?.operatingExpenses || []).map((group) => ({ ...group, section: "controllable" }));
  }, [pnlData]);

  const nibtValue = round2(pnlData?.netIncomeBeforeTax ?? (Number(pnlData?.ebitdaOperatingIncome ?? 0) - Number(pnlData?.depreciation ?? 0)));
  const netIncomeValue = round2(pnlData?.netIncome ?? pnlData?.netOperatingProfit ?? 0);
  const netMarginPercent = Number(pnlData?.netSales || 0) > 0
    ? round2((netIncomeValue / Number(pnlData.netSales)) * 100)
    : 0;

  const isGroupExpanded = (grp) => expandedOpexGroups[grp.key] ?? (grp.rows.length > 1);
  const allPnlGroupsExpanded = pnlOpexWaterfall.every((g) => isGroupExpanded(g));

  // One USAR block of the P&L (labor, controllable or occupancy) with expandable groups.
  const renderUsarSection = (section, title) => {
    const groups = pnlOpexWaterfall.filter((grp) => grp.section === section);
    const total = round2(groups.reduce((sum, grp) => sum + grp.subtotal, 0));
    const shown = groups.filter((grp) => showZeroOpexGroups || grp.rows.length > 0 || grp.subtotal !== 0);
    // A section with a single group (labor, occupancy) lists its accounts directly.
    const flat = groups.length === 1;
    return (
      <div className="fin-statement-card">
        <div className="fin-statement-card-total" style={{ marginTop: 0, paddingTop: 0, borderTop: "none" }}>
          <span>{title}</span>
          <span>{pnlData?.profitLocked ? LOCKED_TEXT : total >= 0 ? `- ${peso(total)}` : `+ ${peso(Math.abs(total))}`}</span>
        </div>
        {shown.map((grp) => {
          const isExpanded = isGroupExpanded(grp);
          const isZero = grp.rows.length === 0 && grp.subtotal === 0;
          return (
            <div key={grp.key} className="fin-opex-group">
              {!flat && (
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  className={`fin-opex-group-toggle ${isZero ? "is-zero" : ""}`}
                  onClick={() => setExpandedOpexGroups((prev) => ({ ...prev, [grp.key]: !(prev[grp.key] ?? (grp.rows.length > 1)) }))}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                    {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                    {grp.label}
                  </span>
                  <span>{peso(grp.subtotal)}</span>
                </button>
              )}
              {(flat || isExpanded) && (
                <div className="fin-opex-sublist">
                  {grp.rows.length === 0 ? (
                    <div className="fin-statement-line" style={{ fontSize: "0.79rem", color: "#6b5847" }}>
                      <span>Nothing recorded in this period</span>
                      <span>{peso(0)}</span>
                    </div>
                  ) : (
                    grp.rows.map((exp) => (
                      <div key={exp.accountCode} className="fin-statement-line" style={{ fontSize: "0.82rem", color: "#4a2c11" }}>
                        <span>{withCode(exp.accountCode, exp.accountName)}</span>
                        <span>{peso(exp.amount)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
          <div className="fin-statement-stack">
            {pnlData.profitLocked && (
              <div className="fin-statement-row" role="note" style={{ alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
                <span><Lock size={14} aria-hidden="true" style={{ verticalAlign: "middle" }} /> Costs, expenses and profit are hidden until you enter the Net Income PIN.</span>
                <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.setModalOpen(true)}>
                  <Lock size={14} aria-hidden="true" /> View Net Income
                </button>
              </div>
            )}
            <div className="fin-statement-row">
              <span title="Gross Sales">{withCode("4010", "Total Sales (before VAT)")}</span>
              <strong>{peso(pnlData.grossSales)}</strong>
            </div>

            <div className="fin-statement-row is-deduction">
              <span title="Sales discounts and promos">Less: {withCode("4020", "Discounts & Promos")}</span>
              <span>- {peso(pnlData.discounts)}</span>
            </div>

            <div className="fin-statement-row is-subtotal">
              <span title="Net Revenue">Sales After Discounts</span>
              <span>{peso(pnlData.netSales)}</span>
            </div>

            <div className="fin-statement-card">
              <div className="fin-statement-card-total" style={{ marginTop: 0, paddingTop: 0, borderTop: "none", color: "#b91c1c" }}>
                <span title="Cost of Goods Sold (COGS)">Less: Cost of Ingredients Sold</span>
                <span>- {lockedPeso(pnlData.cogs)}</span>
              </div>
              <div className="fin-statement-line" style={{ fontSize: "0.82rem", color: "#6b5847" }}>
                <span>{withCode("5010", "Ingredients Used in Sales")}</span>
                <span>{lockedPeso(pnlData.customerSalesCogs ?? pnlData.cogs)}</span>
              </div>
              <div className="fin-statement-line" style={{ fontSize: "0.82rem", color: "#6b5847" }}>
                <span>{withCode("6030", "Waste (Spoiled Stock)")}</span>
                <span>{pnlData.profitLocked ? LOCKED_TEXT : peso(pnlData.wasteCost ?? pnlData.foodSpoilageCogs ?? 0)}</span>
              </div>
              <div className="fin-statement-line" style={{ fontSize: "0.82rem", color: "#6b5847" }}>
                <span title="Inventory shrinkage">{withCode("6031", "Missing Stock (Count Differences)")}</span>
                <span>{pnlData.profitLocked ? LOCKED_TEXT : peso(pnlData.inventoryShrinkage ?? 0)}</span>
              </div>
            </div>

            <div className="fin-statement-row is-profit-band">
              <span title="Gross Profit">Profit After Ingredients{pnlData.grossMarginPercent != null ? ` (Margin: ${pnlData.grossMarginPercent}%)` : ""}</span>
              <span>{lockedPeso(pnlData.grossProfit)}</span>
            </div>

            <div className="fin-opex-head-bar" style={{ justifyContent: "flex-end" }}>
              <div className="fin-opex-head-actions">
                <button
                  type="button"
                  className="fin-inline-cta"
                  onClick={() => {
                    const targetState = !allPnlGroupsExpanded;
                    const next = {};
                    for (const g of pnlOpexWaterfall) next[g.key] = targetState;
                    setExpandedOpexGroups(next);
                  }}
                >
                  {allPnlGroupsExpanded ? "Collapse All" : "Expand All"}
                </button>
                <button
                  type="button"
                  className="fin-inline-cta"
                  onClick={() => setShowZeroOpexGroups((prev) => !prev)}
                >
                  {showZeroOpexGroups ? "Hide ₱0 Groups" : "Show ₱0 Groups"}
                </button>
              </div>
            </div>

            {renderUsarSection("labor", "Less: Staff Pay & Benefits")}

            <div className="fin-statement-row is-subtotal" title="Prime cost: ingredients and waste (COGS) plus labor. Under 60% of sales leaves room for profit.">
              <span>Ingredients + Staff Pay (Prime Cost){pnlData.primeCostPercent != null ? ` · ${pnlData.primeCostPercent}% of sales, goal under 60%` : ""}</span>
              <span>{lockedPeso(pnlData.primeCost)}</span>
            </div>

            {renderUsarSection("controllable", "Less: Running Costs You Can Control")}

            <div className="fin-statement-row is-profit-band" title="Controllable income: what is left after the costs a manager can influence, before rent and building costs.">
              <span>Profit Before Rent &amp; Building Costs{pnlData.controllableIncomePercent != null ? ` (${pnlData.controllableIncomePercent}% of sales)` : ""}</span>
              <span>{lockedPeso(pnlData.controllableIncome)}</span>
            </div>

            {renderUsarSection("occupancy", "Less: Rent & Building Costs")}

            {Array.isArray(pnlData.utilityEstimates) && pnlData.utilityEstimates.length > 0 && (
              <div className="fin-statement-row" role="note" style={{ fontSize: "0.8rem", color: "#8a5a12", background: "#fff6e6" }}>
                <span>
                  Bills not in yet (estimates, not posted):{" "}
                  {pnlData.utilityEstimates.map((estimate) => `${estimate.label} about ${peso(estimate.estimatedAmount)} for ${estimate.month}`).join(" · ")}
                </span>
                <span>about {peso(pnlData.utilityEstimates.reduce((sum, estimate) => sum + Number(estimate.estimatedAmount || 0), 0))}</span>
              </div>
            )}

            <div className="fin-statement-row is-ebitda">
              <span title="EBITDA-style operating income">Operating Profit, Before Equipment Wear &amp; Tear</span>
              <span>{netIncomePin.unlocked && pnlData.ebitdaOperatingIncome != null ? peso(pnlData.ebitdaOperatingIncome) : "₱••••••"}</span>
            </div>

            <div className="fin-statement-row is-deduction">
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
                <span title="Depreciation and amortization">Less: {withCode("6210", "Equipment Wear & Tear")}</span>
                <button
                  type="button"
                  className="fin-inline-cta"
                  onClick={() => openActionModal("depreciation")}
                >
                  Record Wear &amp; Tear
                </button>
              </span>
              <span>- {lockedPeso(pnlData.depreciation)}</span>
            </div>

            <div className="fin-statement-row is-subtotal">
              <span title={PNL_TERMS.profitBeforeTax.term}>{PNL_TERMS.profitBeforeTax.label}</span>
              <span>{netIncomePin.unlocked && pnlData.netIncomeBeforeTax != null ? peso(nibtValue) : "₱••••••"}</span>
            </div>

            <div className="fin-statement-row is-deduction">
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap" }}>
                <span title="Income tax expense">Less: {withCode("6310", "Income Tax")}</span>
                <button
                  type="button"
                  className="fin-inline-cta"
                  onClick={() => openActionModal("income_tax")}
                >
                  Record Income Tax
                </button>
              </span>
              <span>- {lockedPeso(pnlData.tax)}</span>
            </div>

            <div className="fin-summary-hero">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.18rem" }}>
                <span title={PNL_TERMS.netIncome.term}>NET INCOME</span>
                <small style={{ fontSize: "0.73rem", fontWeight: 500, color: "#e6d7c4" }}>
                  Your final profit: profit before rent − rent &amp; building costs − equipment wear − income tax{netIncomePin.unlocked ? ` · Profit margin: ${netMarginPercent}%` : ""}
                </small>
              </div>
              <span style={{ color: netIncomeValue >= 0 ? "#92e0be" : "#fca5a5" }}>
                {netIncomePin.unlocked && pnlData.netIncome != null ? peso(netIncomeValue) : "₱••••••"}
              </span>
              <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.unlocked ? netIncomePin.lock() : netIncomePin.setModalOpen(true)}>
                <Lock size={14} aria-hidden="true" /> {netIncomePin.unlocked ? "Hide Net Income" : "View Net Income"}
              </button>
              {netIncomePin.unlocked && <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.setModalOpen(true)}>Change PIN</button>}
            </div>
          </div>
  );
}
