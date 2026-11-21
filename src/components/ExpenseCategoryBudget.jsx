import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Pencil, Plus } from "lucide-react";
import { apiRequest } from "../utils/api.js";

const STATUS = {
  green: { tone: "ok", label: "On track" },
  yellow: { tone: "warn", label: "Getting close" },
  red: { tone: "high", label: "Almost used up" },
  over_budget: { tone: "over", label: "Over budget" },
  no_budget: { tone: "none", label: "No budget yet" },
};

function peso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthLabel(month) {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(Date.UTC(year, number - 1, 1)));
}

export default function ExpenseCategoryBudget({ month, onMonthChange, categorySlug }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest(`/finances/expense-budgets/health?month=${encodeURIComponent(month)}`);
      const list = Array.isArray(result?.items) ? result.items : [];
      setItem(list.find((entry) => entry.category === categorySlug) || null);
    } catch (loadError) {
      setError(loadError?.message || "We couldn't load this budget. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [month, categorySlug]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    window.addEventListener("amaya:stock-mutated", load);
    return () => window.removeEventListener("amaya:stock-mutated", load);
  }, [load]);

  const save = async (event) => {
    event.preventDefault();
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Enter an amount of zero or more.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/finances/expense-budgets/${categorySlug}`, {
        method: "PUT",
        body: JSON.stringify({ month, amount: parsed }),
      });
      setEditing(false);
      setAmount("");
      await load();
    } catch (saveError) {
      setError(saveError?.message || "We couldn't save the budget. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const hasBudget = item?.budget != null;
  const status = STATUS[item?.status] || STATUS.no_budget;
  const percent = hasBudget && item.percentUsed != null ? Math.max(0, Number(item.percentUsed)) : 0;
  const over = hasBudget && item.remaining < 0;

  let sentence = "Loading this month's spending…";
  if (!loading && item) {
    if (!hasBudget) sentence = "No limit set for this month. Add one to see how much is left.";
    else if (over) sentence = `${peso(Math.abs(item.remaining))} over the ${peso(item.budget)} budget.`;
    else sentence = `${peso(item.remaining)} left of the ${peso(item.budget)} budget (${Number(percent).toLocaleString("en-PH", { maximumFractionDigits: 1 })}% used).`;
  } else if (!loading) {
    sentence = "There is no budget information for this category yet.";
  }

  return (
    <section className="ec-budget" aria-label="Monthly budget">
      {error && <div className="ec-alert" role="alert"><CircleAlert size={15} aria-hidden="true" /> {error}</div>}
      <div className={`ec-envelope tone-${status.tone}`}>
        <div className="ec-envelope-main">
          <span className="ec-envelope-label">Spent in {monthLabel(month)}</span>
          <strong className="ec-envelope-figure">{peso(item?.spent)}</strong>
        </div>

        <div className="ec-envelope-mid">
          <div className="ec-envelope-line">
            <span className={`ec-status tone-${status.tone}`}><i aria-hidden="true" />{status.label}</span>
            <span className="ec-envelope-sentence">{sentence}</span>
          </div>
          <div
            className={`ec-track${hasBudget ? "" : " is-empty"}`}
            role={hasBudget ? "progressbar" : undefined}
            aria-label={hasBudget ? "Share of the budget already spent" : undefined}
            aria-valuemin={hasBudget ? 0 : undefined}
            aria-valuemax={hasBudget ? 100 : undefined}
            aria-valuenow={hasBudget ? Math.min(100, Math.round(percent)) : undefined}
            aria-hidden={hasBudget ? undefined : true}
          >
            <span style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
        </div>

        <div className="ec-envelope-side">
          <label className="ec-month">
            <span>Month</span>
            <input type="month" value={month} onChange={(event) => onMonthChange(event.target.value || month)} />
          </label>
          {item && (
            <button type="button" className="ec-btn ec-btn-solid" aria-expanded={editing} onClick={() => { setEditing((open) => !open); setAmount(hasBudget ? String(item.budget) : ""); }}>
              {hasBudget ? <Pencil size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
              {hasBudget ? "Change budget" : "Set a budget"}
            </button>
          )}
        </div>

        {editing && (
          <form className="ec-edit" onSubmit={save}>
            <label>
              <span>Budget for {monthLabel(month)}</span>
              <span className="ec-money"><b>₱</b><input autoFocus type="number" min="0" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></span>
            </label>
            <button type="button" className="ec-btn" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="ec-btn ec-btn-solid" disabled={saving}>{saving ? "Saving…" : "Save budget"}</button>
          </form>
        )}
      </div>
    </section>
  );
}
