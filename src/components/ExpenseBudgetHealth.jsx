import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../utils/api.js";

function peso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthLabel(month) {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(Date.UTC(year, number - 1, 1)));
}

export default function ExpenseBudgetHealth({ month, onMonthChange, categorySlug = null, compact = false }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest(`/finances/expense-budgets/health?month=${encodeURIComponent(month)}`);
      setItems(Array.isArray(result?.items) ? result.items : []);
    } catch (loadError) {
      setError(loadError?.message || "Could not load expense budgets.");
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

  const saveBudget = async (event, item) => {
    event.preventDefault();
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Enter a budget amount of zero or more.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/finances/expense-budgets/${item.category}`, {
        method: "PUT",
        body: JSON.stringify({ month, amount: parsed }),
      });
      setEditing("");
      setAmount("");
      await load();
    } catch (saveError) {
      setError(saveError?.message || "Could not save the monthly budget.");
    } finally {
      setSaving(false);
    }
  };

  const shownItems = categorySlug ? items.filter((item) => item.category === categorySlug) : items;
  return (
    <section className={`expense-budget-section${compact ? " is-compact" : ""}`} aria-label="Expense budget health">
      <div className="expense-budget-section-heading">
        <div>
          <span className="expense-budget-kicker">MONTHLY BUDGET HEALTH</span>
          <h3>{categorySlug ? "Category budget" : "Budget overview"}</h3>
          <p>Spent is calculated from posted operating expenses. Reversed entries are excluded.</p>
        </div>
        <label className="expense-budget-month">Month
          <input type="month" value={month} onChange={(event) => onMonthChange(event.target.value || month)} />
        </label>
      </div>
      {error && <div className="expense-budget-error" role="alert">{error}</div>}
      {loading && <div className="expense-budget-loading">Loading budget health…</div>}
      {!loading && !shownItems.length && <div className="expense-budget-loading">No category budget data is available.</div>}
      <div className={`expense-budget-grid${categorySlug ? " one-category" : ""}`}>
        {shownItems.map((item) => {
          const percent = item.percentUsed == null ? 0 : Math.max(0, Number(item.percentUsed));
          const statusClass = item.status === "over_budget" ? "over" : item.status;
          return (
            <article className={`expense-budget-card status-${statusClass}`} key={item.category}>
              <div className="expense-budget-card-head">
                <div><strong>{item.label}</strong><span>{monthLabel(month)}</span></div>
                {item.status === "no_budget" ? <span className="expense-budget-pill none">No budget set</span> : <span className={`expense-budget-pill ${statusClass}`}>{item.status === "over_budget" ? "Over budget" : item.status === "green" ? "Healthy" : item.status === "yellow" ? "Getting close" : "Almost used"}</span>}
              </div>
              {item.budget == null ? (
                <div className="expense-budget-unset">
                  <div><span>Actual spent</span><strong>{peso(item.spent)}</strong></div>
                  <button type="button" onClick={() => { setEditing(item.category); setAmount(""); }}>Set Budget</button>
                </div>
              ) : (
                <>
                  <div className="expense-budget-bar" role="progressbar" aria-label={`${item.label} budget used`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, percent)}>
                    <span style={{ width: `${Math.min(100, percent)}%` }} />
                  </div>
                  <div className="expense-budget-numbers">
                    <div><span>Budget</span><strong>{peso(item.budget)}</strong></div>
                    <div><span>Spent</span><strong>{peso(item.spent)}</strong></div>
                    <div><span>Remaining</span><strong className={item.remaining < 0 ? "is-negative" : ""}>{peso(item.remaining)}</strong></div>
                    <div><span>Used</span><strong>{Number(item.percentUsed || 0).toLocaleString("en-PH", { maximumFractionDigits: 1 })}%</strong></div>
                  </div>
                  {item.status === "over_budget" && <p className="expense-budget-over-note">Over budget by {peso(Math.abs(item.remaining))}</p>}
                  <button className="expense-budget-change" type="button" onClick={() => { setEditing(item.category); setAmount(String(item.budget)); }}>Change Budget</button>
                </>
              )}
              {item.accountNote && <p className="expense-budget-account-note">{item.accountNote}</p>}
              {editing === item.category && (
                <form className="expense-budget-edit" onSubmit={(event) => saveBudget(event, item)}>
                  <label>Budget for {monthLabel(month)} <span><b>₱</b><input autoFocus type="number" min="0" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></span></label>
                  <div><button type="button" onClick={() => setEditing("")}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Budget"}</button></div>
                </form>
              )}
              {!categorySlug && <Link className="expense-budget-view-link" to={`/admin/expenses-payroll/${item.category}`}>View expense records <span aria-hidden="true">→</span></Link>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

