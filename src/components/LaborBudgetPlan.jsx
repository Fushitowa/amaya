import { useCallback, useEffect, useState } from "react";
import { CircleAlert, LockKeyhole, Sparkles } from "lucide-react";
import { apiRequest } from "../utils/api.js";
import { useNetIncomePin } from "../hooks/useNetIncomePin.js";
import NetIncomePinModal from "./NetIncomePinModal.jsx";

/**
 * Labor budget auto-fill (payroll plan P3.6) on the Labor and Payroll page. Salary, wages,
 * contributions and 13th month come from the staff list; the owner edits only the overtime cap and
 * the target labor %. The ceiling is that % of the last 3 months' average net sales.
 */

function peso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function LaborBudgetPlan({ month, onApplied }) {
  const pin = useNetIncomePin();
  const [plan, setPlan] = useState(null);
  const [overtime, setOvertime] = useState("");
  const [targetPct, setTargetPct] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!pin.unlocked) {
      setPlan(null);
      return;
    }
    setError("");
    try {
      const result = await apiRequest(`/finances/expense-budgets/labor-plan?month=${encodeURIComponent(month)}`, { headers: pin.financialHeaders });
      setPlan(result);
      setOvertime(String(result.overtimeBudget ?? 0));
      setTargetPct(String(Number((result.targetLaborCost * 100).toFixed(2))));
    } catch (loadError) {
      setError(loadError?.message || "Could not work out the labor plan.");
    }
  }, [month, pin.unlocked, pin.financialHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const apply = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest("/finances/expense-budgets/labor-plan/apply", {
        method: "POST",
        headers: pin.financialHeaders,
        body: JSON.stringify({ month, overtimeBudget: Number(overtime || 0), targetLaborCost: Number(targetPct) / 100 }),
      });
      setPlan(result.plan);
      setNotice(result.message);
      onApplied?.();
    } catch (applyError) {
      setError(applyError?.message || "Could not fill the labor budgets.");
    } finally {
      setBusy(false);
    }
  };

  const plannedNow = plan
    ? plan.salary + plan.wages + plan.governmentContributions + plan.thirteenthMonth + Number(overtime || 0) + plan.staffMealsBudget
    : 0;
  const ceilingNow = plan ? (Number(targetPct || 0) / 100) * plan.averageNetSales : 0;

  return (
    <section className="ec-budget ec-labor-plan" aria-label="Fill labor budgets from the staff list">
      <div className="ec-envelope tone-none" style={{ display: "block" }}>
        <div className="ec-envelope-line" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <span className="ec-envelope-label"><Sparkles size={14} aria-hidden="true" /> Fill this month&apos;s labor budgets from the staff list</span>
          {!pin.unlocked && (
            <button type="button" className="ec-btn" onClick={() => pin.setModalOpen(true)}>
              <LockKeyhole size={13} aria-hidden="true" /> Show with Owner PIN
            </button>
          )}
        </div>
        {error && <div className="ec-alert" role="alert"><CircleAlert size={15} aria-hidden="true" /> {error}</div>}
        {notice && <p className="ec-note" role="status">{notice}</p>}
        {pin.unlocked && plan && (
          <form className="ec-labor-plan-form" onSubmit={apply}>
            <table className="ec-table" style={{ marginTop: 8 }}>
              <tbody>
                <tr><td>Salary (monthly-rated staff)</td><td className="ec-right">{peso(plan.salary)}</td></tr>
                <tr><td>Wages (daily and hourly staff × scheduled days)</td><td className="ec-right">{peso(plan.wages)}</td></tr>
                <tr><td>Government contributions (employer share)</td><td className="ec-right">{peso(plan.governmentContributions)}</td></tr>
                <tr><td>13th month (basic pay ÷ 12)</td><td className="ec-right">{peso(plan.thirteenthMonth)}</td></tr>
                <tr>
                  <td><label htmlFor="labor-plan-ot">Overtime cap (you set this)</label></td>
                  <td className="ec-right"><span className="ec-money"><b>₱</b><input id="labor-plan-ot" type="number" min="0" step="0.01" value={overtime} onChange={(event) => setOvertime(event.target.value)} /></span></td>
                </tr>
                <tr><td>Staff meals (its own budget)</td><td className="ec-right">{peso(plan.staffMealsBudget)}</td></tr>
                <tr><td><strong>Planned labor</strong> ({plan.employeesCounted} on the staff list)</td><td className="ec-right"><strong>{peso(plannedNow)}</strong></td></tr>
                <tr>
                  <td>
                    <label htmlFor="labor-plan-target">Labor ceiling: target</label>{" "}
                    <span className="ec-money" style={{ display: "inline-flex", width: 90 }}><input id="labor-plan-target" type="number" min="5" max="60" step="0.5" value={targetPct} onChange={(event) => setTargetPct(event.target.value)} /><b>%</b></span>{" "}
                    of average net sales {peso(plan.averageNetSales)} ({plan.salesMonths.map((row) => row.month).join(", ")})
                  </td>
                  <td className="ec-right"><strong>{peso(ceilingNow)}</strong></td>
                </tr>
              </tbody>
            </table>
            {ceilingNow > 0 && plannedNow > ceilingNow && (
              <p className="ec-alert" role="alert"><CircleAlert size={15} aria-hidden="true" /> Planned labor is {peso(plannedNow - ceilingNow)} over the ceiling. Lower the overtime cap or review the staff list.</p>
            )}
            {!(plan.averageNetSales > 0) && <p className="ec-note">No sales in the last 3 months yet, so there is no ceiling to compare with.</p>}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button type="submit" className="ec-btn ec-btn-solid" disabled={busy}>{busy ? "Saving…" : "Use these as this month's budgets"}</button>
            </div>
          </form>
        )}
      </div>
      <NetIncomePinModal open={pin.modalOpen} hasPin={pin.hasPin} onClose={() => pin.setModalOpen(false)} onUnlocked={(token) => pin.unlock(token)} purpose="Labor Budget" />
    </section>
  );
}
