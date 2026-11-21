import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Flame, Plus, ReceiptText, TrendingDown, TrendingUp, X } from "lucide-react";
import { apiRequest } from "../utils/api.js";

/**
 * Utility page tools (payroll plan Phase 3B):
 *  - O3.4 bill form: provider, account no., service period, reading, amount, due date, paid now/later.
 *    The cost lands in the month(s) the service was used, split by days.
 *  - O3.5 estimate when this month's bill is not in yet (shown, not posted).
 *  - O3.9 insight: this month vs last month and last year, cost per unit, usage per ₱1,000 of sales.
 *  - O3.6 LPG: tanks taken from inventory, days per tank and cost per day.
 */

const UNIT_LABELS = { kWh: "kWh", m3: "m³", kg: "kg" };

function peso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function niceDate(value) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

function Change({ value, label }) {
  if (value == null) return <span className="ub-change">{label}: no data</span>;
  const up = value > 0;
  return (
    <span className={`ub-change ${up ? "is-up" : "is-down"}`}>
      {up ? <TrendingUp size={13} aria-hidden="true" /> : <TrendingDown size={13} aria-hidden="true" />}
      {up ? "+" : ""}{value.toLocaleString("en-PH", { maximumFractionDigits: 1 })}% {label}
    </span>
  );
}

const emptyForm = { provider: "", accountNumber: "", serviceFrom: "", serviceTo: "", reading: "", amount: "", dueDate: "", paidNow: false, channel: "store_bank", notes: "" };

export default function UtilityBillPanel({ category, month, onChanged }) {
  const unit = category.utility?.unit || null;
  const [bills, setBills] = useState([]);
  const [insight, setInsight] = useState(null);
  const [estimate, setEstimate] = useState(null);
  const [lpg, setLpg] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [voiding, setVoiding] = useState(null);

  const load = useCallback(async () => {
    try {
      const [billList, insightData, estimateData, lpgData] = await Promise.all([
        apiRequest(`/finances/utility-bills?utility=${category.slug}&limit=24`),
        apiRequest(`/finances/utility-bills/insights?utility=${category.slug}&month=${month}`),
        apiRequest(`/finances/utility-bills/estimates?month=${month}`),
        category.slug === "lpg" ? apiRequest("/finances/utility-bills/lpg-tanks") : Promise.resolve(null),
      ]);
      setBills(Array.isArray(billList?.items) ? billList.items : []);
      setInsight(insightData);
      setEstimate((estimateData?.items || []).find((item) => item.utility === category.slug) || null);
      setLpg(lpgData);
    } catch (loadError) {
      setError(loadError?.message || "Could not load the bills.");
    }
  }, [category.slug, month]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await apiRequest("/finances/utility-bills", {
        method: "POST",
        body: JSON.stringify({
          utility: category.slug,
          provider: form.provider,
          accountNumber: form.accountNumber,
          serviceFrom: form.serviceFrom,
          serviceTo: form.serviceTo,
          reading: unit ? form.reading : undefined,
          amount: Number(form.amount),
          dueDate: form.dueDate || undefined,
          paidNow: form.paidNow,
          channel: form.paidNow ? form.channel : undefined,
          notes: form.notes,
        }),
      });
      const split = (result.bill?.parts || []).map((part) => `${peso(part.amount)} in ${part.month} (${part.days} days)`).join(", ");
      setNotice(`${result.message} ${split ? `Split: ${split}.` : ""}`);
      setForm(emptyForm);
      setFormOpen(false);
      await load();
      onChanged?.();
    } catch (saveError) {
      setError(saveError?.message || "Could not record the bill.");
    } finally {
      setBusy(false);
    }
  };

  const voidBill = async (bill) => {
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest(`/finances/utility-bills/${bill.id}/void`, { method: "POST", body: JSON.stringify({ reason: "Entered by mistake" }) });
      setNotice(result.message);
      setVoiding(null);
      await load();
      onChanged?.();
    } catch (voidError) {
      setError(voidError?.message || "Could not void the bill.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ub-panel" aria-label={`${category.label} bills`}>
      <header className="ub-head">
        <div>
          <h3><ReceiptText size={16} aria-hidden="true" /> {category.label} bills</h3>
          <p>Enter the bill with its service period. Its cost goes to the month(s) the {category.label.toLowerCase()} was used, not the month the bill arrived.</p>
        </div>
        <button type="button" className="ec-btn ec-btn-solid" onClick={() => setFormOpen((open) => !open)} aria-expanded={formOpen}>
          {formOpen ? <X size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />} {formOpen ? "Close" : "Enter a bill"}
        </button>
      </header>

      {error && <div className="ec-alert" role="alert"><CircleAlert size={15} aria-hidden="true" /> {error}</div>}
      {notice && <p className="ub-notice" role="status">{notice}</p>}

      {estimate && (
        <p className="ub-estimate" role="note">
          Estimated {peso(estimate.estimatedAmount)} for {estimate.month}: bill not in yet ({estimate.uncoveredDays} days at {peso(estimate.dailyCost)} a day, from the last bill). Shown only; nothing is posted.
        </p>
      )}

      {insight && (
        <div className="ub-insight">
          <div><span>Spent in {insight.thisMonth.month}</span><strong>{peso(insight.thisMonth.spent)}</strong></div>
          <div><span>Last month</span><strong>{peso(insight.lastMonth.spent)}</strong><Change value={insight.vsLastMonthPercent} label="vs last month" /></div>
          <div><span>Same month last year</span><strong>{peso(insight.lastYear.spent)}</strong><Change value={insight.vsLastYearPercent} label="vs last year" /></div>
          {insight.thisMonth.costPerUnit != null && (
            <div><span>Cost per {UNIT_LABELS[insight.unit] || "unit"}</span><strong>{peso(insight.thisMonth.costPerUnit)}</strong><small>{insight.thisMonth.usage} {UNIT_LABELS[insight.unit]} used</small></div>
          )}
          {insight.usagePerThousandSales != null && (
            <div><span>kWh per ₱1,000 of sales</span><strong>{insight.usagePerThousandSales}</strong><small>Lower means less power for the same sales</small></div>
          )}
        </div>
      )}

      {formOpen && (
        <form className="ub-form" onSubmit={submit}>
          <label>Provider<input required maxLength={120} value={form.provider} onChange={set("provider")} placeholder={category.utility?.providerHint || "Provider"} /></label>
          <label>Account or meter no.<input maxLength={60} value={form.accountNumber} onChange={set("accountNumber")} placeholder="Optional" /></label>
          <label>Service from<input type="date" required value={form.serviceFrom} onChange={set("serviceFrom")} /></label>
          <label>Service to<input type="date" required value={form.serviceTo} min={form.serviceFrom || undefined} onChange={set("serviceTo")} /></label>
          {unit && <label>Usage ({UNIT_LABELS[unit]})<input type="number" min="0" step="0.001" value={form.reading} onChange={set("reading")} placeholder="Optional" /></label>}
          <label>Amount<span className="ec-money"><b>₱</b><input type="number" min="0.01" step="0.01" required value={form.amount} onChange={set("amount")} /></span></label>
          <label>Due date<input type="date" value={form.dueDate} onChange={set("dueDate")} /></label>
          <label className="ub-check"><input type="checkbox" checked={form.paidNow} onChange={set("paidNow")} /> Paid already</label>
          {form.paidNow && (
            <label>Paid from
              <select value={form.channel} onChange={set("channel")}>
                <option value="store_bank">Bank</option>
                <option value="gcash">GCash</option>
                <option value="cash_counter">Cash drawer</option>
              </select>
            </label>
          )}
          <label className="ub-wide">Notes<input maxLength={255} value={form.notes} onChange={set("notes")} placeholder="Optional" /></label>
          <p className="ub-wide ub-hint">{form.paidNow ? "The payment is recorded today." : "Unpaid bills wait in Finances → Payables with their due date."}</p>
          <div className="ub-wide ub-actions">
            <button type="button" className="ec-btn" onClick={() => setFormOpen(false)}>Cancel</button>
            <button type="submit" className="ec-btn ec-btn-solid" disabled={busy}>{busy ? "Saving…" : "Save bill"}</button>
          </div>
        </form>
      )}

      <div className="ec-table-wrap">
        <table className="ec-table">
          <thead>
            <tr><th>Service period</th><th>Provider</th><th>Months</th>{unit && <th className="ec-right">Usage</th>}<th className="ec-right">Amount</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {bills.map((bill) => (
              <tr key={bill.id} className={bill.status === "voided" ? "ub-voided" : ""}>
                <td>{niceDate(bill.serviceFrom)} – {niceDate(bill.serviceTo)}<small>{bill.serviceDays} days</small></td>
                <td>{bill.provider}{bill.accountNumber && <small>{bill.accountNumber}</small>}</td>
                <td>{bill.parts.map((part) => <span className="ec-kind" key={part.month}>{part.month}: {peso(part.amount)}</span>)}</td>
                {unit && <td className="ec-right">{bill.reading == null ? "—" : `${bill.reading} ${UNIT_LABELS[bill.readingUnit] || ""}`}</td>}
                <td className="ec-right ec-amount">{peso(bill.amount)}</td>
                <td>{bill.status === "voided" ? "Voided" : bill.payableStatus === "paid" ? "Paid" : `Unpaid${bill.dueDate ? `, due ${niceDate(bill.dueDate)}` : ""}`}</td>
                <td>
                  {bill.status !== "voided" && (voiding === bill.id ? (
                    <span className="ub-confirm">
                      Void this bill and its payment?
                      <button type="button" className="ec-btn" onClick={() => setVoiding(null)}>No</button>
                      <button type="button" className="ec-btn ec-btn-solid" disabled={busy} onClick={() => voidBill(bill)}>Yes, void</button>
                    </span>
                  ) : (
                    <button type="button" className="ec-btn" onClick={() => setVoiding(bill.id)}>Void</button>
                  ))}
                </td>
              </tr>
            ))}
            {!bills.length && (
              <tr><td colSpan={unit ? 7 : 6} className="ec-empty"><strong>No bills entered yet</strong><span>Enter your first {category.label.toLowerCase()} bill above.</span></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {lpg && (
        <div className="ub-lpg">
          <h4><Flame size={15} aria-hidden="true" /> LPG tanks from inventory</h4>
          <p>
            Tanks taken out as internal store use (Inventory → Internal use, account 6133).
            {lpg.averageDaysPerTank != null ? ` A tank lasts about ${lpg.averageDaysPerTank} days, about ${peso(lpg.averageCostPerDay)} a day.` : " Swap at least two tanks to see days per tank."}
          </p>
          {lpg.items.length > 0 && (
            <table className="ec-table">
              <thead><tr><th>Swapped in</th><th>Tank</th><th className="ec-right">Cost</th><th className="ec-right">Lasted</th><th className="ec-right">Cost per day</th></tr></thead>
              <tbody>
                {lpg.items.slice(0, 12).map((swap) => (
                  <tr key={swap.movementId}>
                    <td>{niceDate(swap.swapDate)}</td>
                    <td>{swap.item} · {swap.quantity} {swap.unit}</td>
                    <td className="ec-right">{peso(swap.cost)}</td>
                    <td className="ec-right">{swap.daysLasted != null ? `${swap.daysLasted} days` : `in use, ${swap.inUseFor} days so far`}</td>
                    <td className="ec-right">{swap.costPerDay != null ? peso(swap.costPerDay) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
