import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Menu, ReceiptText } from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { apiRequest } from "../../utils/api.js";
import { EXPENSE_NAV_CATEGORIES } from "../../config/expenseNavigation.js";
import { currentBudgetMonth } from "../../utils/expenseBudget.js";
import "../../assets/css/admin/AdminReport.css";
import "../../assets/css/admin/AdminExpenseCategory.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

// Computed on demand so a tab left open past midnight never records yesterday's date.
const manilaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
// Staff may only pay from the counter drawer, for today, during their open shift.
// GCash, bank, and owner reserve payments are recorded by the owner.
const STAFF_CHANNEL = "cash_counter";

function StaffExpenseRecord() {
  const navigate = useNavigate();
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { darkMode } = useTheme();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [category, setCategory] = useState(EXPENSE_NAV_CATEGORIES.at(-1)?.slug || "miscellaneous");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(manilaToday);
  const [receiptReference, setReceiptReference] = useState("");
  const [notes, setNotes] = useState("");
  const [health, setHealth] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const month = useMemo(() => (date ? date.slice(0, 7) : currentBudgetMonth()), [date]);

  useEffect(() => {
    let active = true;
    apiRequest(`/finances/expense-budgets/health?month=${encodeURIComponent(month)}`)
      .then((result) => { if (active) setHealth(result?.items?.find((item) => item.category === category) || null); })
      .catch(() => { if (active) setHealth(null); });
    return () => { active = false; };
  }, [category, month]);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter the exact expense amount.");
      return;
    }
    if (health?.budget != null && health.remaining != null && value > health.remaining) {
      const overBy = value - health.remaining;
      if (!window.confirm(`This expense will exceed the ${health.label} budget by ₱${overBy.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Continue and record it? The owner will be notified by the budget health bar.`)) return;
    }
    const recordDate = manilaToday();
    setDate(recordDate);
    setSaving(true);
    try {
      const result = await apiRequest("/finances/expense-records", {
        method: "POST",
        body: JSON.stringify({ category, description, amount: value, date: recordDate, channel: STAFF_CHANNEL, receiptReference, notes }),
      });
      try {
        const updatedHealth = await apiRequest(`/finances/expense-budgets/health?month=${encodeURIComponent(month)}`);
        setHealth(updatedHealth?.items?.find((item) => item.category === category) || null);
      } catch {
        setHealth(null);
      }
      setSuccess(`Recorded ${result?.message || "expense"}.`);
      setDescription("");
      setAmount("");
      setReceiptReference("");
      setNotes("");
      window.dispatchEvent(new Event("amaya:stock-mutated"));
    } catch (submitError) {
      setError(submitError?.message || "Could not record the expense.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`admin-report-page expense-category-page staff-expense-record-page${darkMode ? " dark-mode" : ""}${sidebarCollapsed ? " sidebar-collapsed" : ""}${mobileNavOpen ? " mobile-nav-open" : ""}`}>
      {mobileNavOpen && <button type="button" className="report-mobile-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <Sidebar role="staff" activeTab="dashboard" sidebarCollapsed={mobileNavOpen ? false : sidebarCollapsed} onToggle={() => (mobileNavOpen ? setMobileNavOpen(false) : toggleSidebar())} />
      <main className="admin-report-main">
        <header className="admin-report-topbar"><div className="admin-report-topbar-title"><div className="report-topbar-title-row"><button type="button" className="report-mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu"><Menu size={21} /></button><span className="admin-report-section-label"><i className="topbar-label-pin" aria-hidden="true" /> STAFF PORTAL</span></div><h1>Record an Expense</h1></div></header>
        <div className="admin-report-content admin-finances-content expense-category-content">
          <section className="staff-expense-form-panel">
            <Link className="expense-back-link" to="/staff/dashboard"><ArrowLeft size={15} /> Staff dashboard</Link>
            <div className="staff-expense-form-title"><span><ReceiptText size={20} /></span><div><h2>Business expense</h2><p>Enter the actual amount paid from the counter cash. It is deducted from your shift&apos;s expected cash.</p></div></div>
            {health?.budget != null && <div className={`staff-expense-budget-hint status-${health.status === "over_budget" ? "over" : health.status}`}><strong>{health.label} · {month}</strong><span>Budget {`₱${Number(health.budget).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`} · Spent {`₱${Number(health.spent).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`} · Remaining {`₱${Number(health.remaining).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`}</span></div>}
            {health?.budget == null && <div className="staff-expense-budget-hint status-none">No budget is set for this category and month.</div>}
            {error && <div className="expense-budget-error" role="alert">{error}</div>}
            {success && <div className="staff-expense-success" role="status">{success}</div>}
            <form className="staff-expense-form" onSubmit={submit}>
              <label>Item or description<input required maxLength={180} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="e.g. Faucet replacement parts" /></label>
              <div className="staff-expense-form-row">
                <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>{EXPENSE_NAV_CATEGORIES.map((item) => <option value={item.slug} key={item.slug}>{item.label}</option>)}</select></label>
                <label>Amount (₱)<input required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label>
              </div>
              <div className="staff-expense-form-row">
                <label>Date<input type="date" value={date} readOnly aria-readonly="true" title="Staff expenses are recorded for today" /></label>
                <label>Paid from<input type="text" value="Cash in Counter (your open shift)" readOnly aria-readonly="true" /></label>
              </div>
              <label>Receipt reference (optional)<input maxLength={100} value={receiptReference} onChange={(event) => setReceiptReference(event.target.value)} placeholder="Receipt number or saved receipt reference" /></label>
              <label>Notes (optional)<textarea maxLength={150} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Add context for the owner" /></label>
              <div className="staff-expense-form-footer"><span>Recorded by your signed-in staff account.</span><button type="submit" disabled={saving}>{saving ? "Recording…" : "Record Expense"}</button></div>
            </form>
            <button className="staff-expense-back-button" type="button" onClick={() => navigate(-1)}>Cancel</button>
          </section>
        </div>
      </main>
    </div>
  );
}

export default StaffExpenseRecord;
