import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, ChefHat, Clock, LockKeyhole, PlugZap, RefreshCw, TrendingUp, Users } from "lucide-react";
import { apiRequest } from "../utils/api.js";
import { useNetIncomePin } from "../hooks/useNetIncomePin.js";
import NetIncomePinModal from "./NetIncomePinModal.jsx";
import { getManilaDateString } from "../../shared/manilaDate.js";
import "../assets/css/admin/CostRatioTiles.css";

/**
 * Month-to-date running-cost ratios on the dashboard (payroll plan P3.3 / O3.8): labor %, prime
 * cost %, utilities %, occupancy % and controllable income %, each against its target. Figures come
 * from the ledger P&L, so they match Finances → Profit & Loss, and stay hidden until the Owner PIN
 * is entered.
 */

function pct(value) {
  return value == null ? "—" : `${Number(value).toLocaleString("en-PH", { maximumFractionDigits: 1 })}%`;
}

function peso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Lower is better for costs: on/under target = ok, up to 10% (relative) over = warn, else over.
function costTone(actual, target) {
  if (actual == null || target == null) return "none";
  if (actual <= target) return "ok";
  return actual <= target * 1.1 ? "warn" : "over";
}

function monthStartOf(isoDate) {
  return `${isoDate.slice(0, 7)}-01`;
}

export default function CostRatioTiles() {
  const pin = useNetIncomePin();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const today = getManilaDateString();
  const from = monthStartOf(today);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest(`/reports/financial-summary?rangeKey=custom&from=${from}&to=${today}`, { headers: pin.financialHeaders });
      setData(result?.summary || null);
    } catch (loadError) {
      setError(loadError?.message || "Could not load the cost ratios.");
    } finally {
      setLoading(false);
    }
  }, [from, today, pin.financialHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const locked = !data || data.laborLocked;
  const target = (ratio) => (ratio == null ? null : Number(ratio) * 100);
  const tiles = data && !locked ? [
    {
      key: "labor",
      Icon: Users,
      label: "Labor cost",
      value: data.laborPercent,
      target: target(data.targetLaborCost),
      tone: costTone(data.laborPercent, target(data.targetLaborCost)),
      detail: `${peso(data.laborCost)} · target ${pct(target(data.targetLaborCost))}`,
    },
    {
      key: "prime",
      Icon: ChefHat,
      label: "Prime cost",
      value: data.primeCostPercent,
      target: target(data.primeCostGoal),
      tone: costTone(data.primeCostPercent, target(data.primeCostGoal)),
      detail: `Ingredients + labor ${peso(data.primeCost)} · goal under ${pct(target(data.primeCostGoal))}`,
    },
    {
      key: "utilities",
      Icon: PlugZap,
      label: "Utilities",
      value: data.utilitiesPercent,
      target: target(data.targetUtilitiesCost),
      tone: costTone(data.utilitiesPercent, target(data.targetUtilitiesCost)),
      detail: `${peso(data.utilitiesCost)} · target ${pct(target(data.targetUtilitiesCost))}`,
    },
    {
      key: "occupancy",
      Icon: Building2,
      label: "Occupancy",
      value: data.occupancyPercent,
      target: target(data.targetOccupancyCost),
      tone: costTone(data.occupancyPercent, target(data.targetOccupancyCost)),
      detail: `Rent & building ${peso(data.totalOccupancy)} · target ${pct(target(data.targetOccupancyCost))}`,
    },
    {
      key: "controllable",
      Icon: TrendingUp,
      label: "Controllable income",
      value: data.controllableIncomePercent,
      target: null,
      tone: data.controllableIncomePercent == null ? "none" : data.controllableIncomePercent > 0 ? "ok" : "over",
      detail: `${peso(data.controllableIncome)} left before rent`,
    },
  ] : [];

  return (
    <section className="crt-panel" aria-label="Running cost ratios this month">
      <header className="crt-head">
        <div>
          <span className="crt-eyebrow">THIS MONTH · SHARE OF SALES</span>
          <h3>Running cost ratios</h3>
          <p>From the Profit &amp; Loss for {from} to {today}. Set the targets in <Link to="/admin/settings">Settings</Link>.</p>
        </div>
        <div className="crt-actions">
          {!locked && data?.salesPerLaborHour != null && (
            <span className="crt-chip" title="Net sales divided by the hours paid in payroll runs ending this month">
              <Clock size={13} aria-hidden="true" /> {peso(data.salesPerLaborHour)} per labor hour
            </span>
          )}
          <button type="button" className="crt-btn" onClick={load} disabled={loading} aria-label="Refresh cost ratios">
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button type="button" className="crt-btn" onClick={() => (pin.unlocked ? pin.lock() : pin.setModalOpen(true))}>
            <LockKeyhole size={14} aria-hidden="true" /> {pin.unlocked ? "Hide" : "Show ratios"}
          </button>
        </div>
      </header>

      {error && <p className="crt-error" role="alert">{error}</p>}
      {locked ? (
        <p className="crt-locked">🔒 Labor and running-cost figures are private. Enter the Owner PIN to see them.</p>
      ) : (
        <div className="crt-grid">
          {tiles.map(({ key, Icon, label, value, target: goal, tone, detail }) => (
            <article key={key} className={`crt-tile tone-${tone}`}>
              <span className="crt-icon"><Icon size={17} aria-hidden="true" /></span>
              <span className="crt-label">{label}</span>
              <strong>{pct(value)}</strong>
              {goal != null && (
                <span className="crt-meter" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, ((value || 0) / Math.max(goal, 0.01)) * 50)}%` }} />
                  <b style={{ left: "50%" }} />
                </span>
              )}
              <small>{detail}</small>
            </article>
          ))}
        </div>
      )}
      <NetIncomePinModal open={pin.modalOpen} hasPin={pin.hasPin} onClose={() => pin.setModalOpen(false)} onUnlocked={(token) => pin.unlock(token)} purpose="Cost Ratios" />
    </section>
  );
}
