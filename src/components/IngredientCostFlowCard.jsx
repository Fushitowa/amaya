import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiRequest } from "../utils/api.js";
import "../assets/css/admin/IngredientCostFlow.css";

function peso(value) {
  const number = Number(value || 0);
  const sign = number < 0 ? "-" : "";
  return `${sign}₱${Math.abs(number).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function percent(value) {
  return value == null ? "n/a" : `${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 1 })}%`;
}

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" }).format(new Date());
}

function monthRange(month) {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

function monthLabel(month) {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, number - 1, 1)));
}

export default function IngredientCostFlowCard() {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { from, to } = monthRange(month);
      setData(await apiRequest(`/inventory/cost-flow?from=${from}&to=${to}`));
    } catch (loadError) {
      setError(loadError?.message || "Could not load the ingredient costs.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    window.addEventListener("amaya:stock-mutated", load);
    return () => window.removeEventListener("amaya:stock-mutated", load);
  }, [load]);

  const rows = useMemo(() => {
    if (!data) return [];
    const { flow } = data;
    return [
      { key: "sold", label: "Used in drinks you sold", note: "Cost of the ingredients in each recipe", value: flow.soldInDrinks, tone: "sold" },
      { key: "waste", label: "Thrown away", note: "Spoiled, expired, spilled or trimmed", value: flow.waste, tone: "waste" },
      { key: "use", label: "Used in the shop", note: "Cleaning supplies, staff meals and gas", value: flow.storeUse, tone: "use" },
      { key: "short", label: flow.shrinkage < 0 ? "Found extra at a recount" : "Missing at a recount", note: "Stock count was different from the records", value: flow.shrinkage, tone: "short" },
    ];
  }, [data]);

  const biggest = rows.reduce((max, row) => Math.max(max, Math.abs(row.value)), 0) || 1;

  return (
    <section className="icf-card" aria-label="Where your ingredient money went">
      <header className="icf-head">
        <div>
          <h2>Where your ingredient money went</h2>
          <p>Follows the cost of your stock from the start of the month to today.</p>
        </div>
        <div className="icf-controls">
          <label>
            <span className="icf-sr">Month</span>
            <input type="month" value={month} max={currentMonth()} onChange={(event) => setMonth(event.target.value || month)} />
          </label>
          <button type="button" onClick={load} disabled={loading} aria-label="Refresh"><RefreshCw size={14} aria-hidden="true" /></button>
        </div>
      </header>

      {error && <p className="icf-error" role="alert">{error}</p>}
      {!data && loading && <p className="icf-empty">Loading {monthLabel(month)}...</p>}

      {data && (
        <>
          <div className="icf-ledger">
            <div className="icf-line is-edge"><span>You had at the start</span><b>{peso(data.flow.opening)}</b></div>
            <div className="icf-line is-edge is-plus"><span>You bought</span><b>+ {peso(data.flow.bought)}</b></div>
            {rows.map((row) => (
              <div className={`icf-line tone-${row.tone}`} key={row.key}>
                <div className="icf-line-text">
                  <span>{row.label}</span>
                  <small>{row.note}</small>
                </div>
                <div className="icf-line-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (Math.abs(row.value) / biggest) * 100)}%` }} /></div>
                <b>{row.value > 0 ? "- " : row.value < 0 ? "+ " : ""}{peso(Math.abs(row.value))}</b>
              </div>
            ))}
            <div className="icf-line is-edge is-total"><span>You have now</span><b>{peso(data.flow.closing)}</b></div>
          </div>

          <div className="icf-compare">
            <div>
              <small>Cost of drinks sold, by recipe</small>
              <strong>{percent(data.foodCost.theoreticalPercent)}</strong>
              <span>of your sales ({peso(data.foodCost.theoretical)})</span>
            </div>
            <div className={data.foodCost.gap > 0 ? "is-warn" : ""}>
              <small>Real cost, with waste and missing stock</small>
              <strong>{percent(data.foodCost.actualPercent)}</strong>
              <span>of your sales ({peso(data.foodCost.actual)})</span>
            </div>
          </div>
          <p className="icf-sentence">
            {data.foodCost.gap > 0.005
              ? `Waste and missing stock cost you ${peso(data.foodCost.gap)} this month. That is what the recipes do not explain.`
              : data.foodCost.gap < -0.005
                ? `Your stock counts found ${peso(Math.abs(data.foodCost.gap))} more than the records, so real cost is lower than the recipes say.`
                : "Your real cost matches what the recipes say. Nothing extra is being lost."}
          </p>

          {data.waste.byReason.length > 0 && (
            <div className="icf-reasons">
              <h3>What was thrown away</h3>
              <ul>
                {data.waste.byReason.map((entry) => (
                  <li key={entry.reason}>
                    <span>{entry.label}</span>
                    <em className={entry.kind === "normal" ? "is-normal" : "is-avoidable"}>{entry.kind === "normal" ? "Expected" : "Avoidable"}</em>
                    <b>{peso(entry.value)}</b>
                  </li>
                ))}
                {data.waste.voidedOrders > 0 && (
                  <li><span>Voided orders</span><em className="is-avoidable">Avoidable</em><b>{peso(data.waste.voidedOrders)}</b></li>
                )}
              </ul>
              <p>Waste is {percent(data.waste.percentOfSales)} of your sales.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
