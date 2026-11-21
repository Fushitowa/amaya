import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, HandCoins, Menu, Plus, RefreshCw, Search } from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import ExpenseCategoryBudget from "../../components/ExpenseCategoryBudget.jsx";
import LaborBudgetPlan from "../../components/LaborBudgetPlan.jsx";
import UtilityBillPanel from "../../components/UtilityBillPanel.jsx";
import "../../assets/css/admin/UtilityBills.css";
import { currentBudgetMonth } from "../../utils/expenseBudget.js";
import { useSidebar } from "../../context/useSidebar.jsx";
import { apiRequest } from "../../utils/api.js";
import { getExpenseNavCategory, PAYROLL_EXPENSE_ACCOUNT_CODES } from "../../config/expenseNavigation.js";
import "../../assets/css/admin/AdminReport.css";
import "../../assets/css/admin/FinancialManagement.css";
import "../../assets/css/admin/ExpenseCategoryPage.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const PAGE_SIZE = 25;

// Everyday names for the bookkeeping codes, so nobody needs to know the codes.
const KIND_NAMES = {
  6010: "Other operating expenses (older or stock adjustments)",
  6020: "Utilities (older records)",
  6040: "Cash over/short from shift close",
  6111: "Salaries (monthly-rated staff)",
  6112: "SSS, PhilHealth and Pag-IBIG",
  6113: "Staff meals",
  6114: "13th month pay",
  6115: "Wages (daily and hourly staff)",
  6116: "Overtime and premium pay",
  6130: "Utilities",
  6131: "Electricity",
  6132: "Water",
  6133: "LPG and cooking gas",
  6134: "Telephone and internet",
  6135: "Trash and garbage collection",
  6120: "Rent",
  6125: "Building insurance and property tax",
  6150: "Advertising and marketing",
  6140: "Operating supplies",
  6141: "Linens and uniforms",
  6142: "Dining supplies",
  6143: "Kitchen supplies",
  6144: "Sanitation supplies",
  6160: "Repairs and maintenance",
  6171: "Office expenses",
  6172: "Taxes and licenses",
  6173: "Professional and bank fees",
  6174: "Transportation",
  6179: "Miscellaneous",
};

function kindName(code) {
  return KIND_NAMES[code] || "Other expenses";
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function peso(value) {
  const amount = Number(value || 0);
  return `₱${(Number.isFinite(amount) ? amount : 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* A fountain pen drawn as SVG: brown barrel, brass trim, gold nib. Decoration only. */
function Pen() {
  return (
    <svg className="ec-pen-art" viewBox="0 0 48 360" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="ec-barrel" x1="0" x2="1">
          <stop offset="0" stopColor="#2a190f" /><stop offset=".35" stopColor="#6a452e" /><stop offset=".6" stopColor="#4a3022" /><stop offset="1" stopColor="#24150c" />
        </linearGradient>
        <linearGradient id="ec-brass" x1="0" x2="1">
          <stop offset="0" stopColor="#8f6431" /><stop offset=".45" stopColor="#e6c98f" /><stop offset="1" stopColor="#9a6c35" />
        </linearGradient>
        <linearGradient id="ec-nib" x1="0" x2="1">
          <stop offset="0" stopColor="#b98a43" /><stop offset=".5" stopColor="#f0d9a3" /><stop offset="1" stopColor="#b48540" />
        </linearGradient>
      </defs>
      <rect x="17" y="2" width="14" height="7" fill="url(#ec-brass)" />
      <rect x="14" y="9" width="20" height="104" fill="url(#ec-barrel)" />
      <rect x="31" y="18" width="4" height="72" fill="url(#ec-brass)" />
      <rect x="13" y="100" width="22" height="5" fill="url(#ec-brass)" />
      <rect x="13" y="108" width="22" height="2" fill="url(#ec-brass)" />
      <polygon points="14,113 34,113 31,262 17,262" fill="url(#ec-barrel)" />
      <rect x="16" y="262" width="16" height="4" fill="url(#ec-brass)" />
      <polygon points="17,266 31,266 27,306 21,306" fill="#2a190f" />
      <polygon points="21,306 27,306 24,352" fill="url(#ec-nib)" stroke="#8f6431" strokeWidth=".6" />
      <line x1="24" y1="322" x2="24" y2="352" stroke="#8f6431" strokeWidth=".7" />
      <circle cx="24" cy="322" r="1.6" fill="#8f6431" />
    </svg>
  );
}

function AdminExpenseCategory() {
  const { category: categorySlug } = useParams();
  const category = getExpenseNavCategory(categorySlug);
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [budgetMonth, setBudgetMonth] = useState(currentBudgetMonth);

  const loadEntries = useCallback(async () => {
    if (!category) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      // Read-only pages (cash over/short) list what shift close posts, so no type filter.
      ...(category.readOnly ? {} : { type: "operating_expense" }),
      expenseCategory: category.slug,
      page: String(page),
      limit: String(PAGE_SIZE),
    });
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    try {
      const response = await apiRequest(`/finances/journal-entries?${params.toString()}`);
      setEntries(Array.isArray(response?.items) ? response.items : []);
      setTotal(Number(response?.total || 0));
    } catch (requestError) {
      setError(requestError?.message || "We couldn't load these expenses. Please try again.");
      setEntries([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [category, fromDate, page, toDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadEntries(), 0);
    return () => window.clearTimeout(timer);
  }, [loadEntries]);

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => [
      entry.entryNumber,
      entry.memo,
      entry.referenceNumber,
      entry.creatorName,
      ...((entry.lines || []).map((line) => `${kindName(String(line.accountCode))} ${line.accountName} ${line.lineMemo}`)),
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [entries, search]);

  const pageAmount = useMemo(() => entries.reduce((sum, entry) => (
    sum + (entry.lines || []).reduce((lineSum, line) => (
      category?.accountCodes.includes(String(line.accountCode)) ? lineSum + Number(line.debit || 0) - (category?.readOnly ? Number(line.credit || 0) : 0) : lineSum
    ), 0)
  ), 0), [category, entries]);
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dateInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  if (!category) return <Navigate to="/admin/finances" replace />;
  // Salary, wages, overtime, contributions and 13th month come only from approved payroll runs.
  const fromPayroll = PAYROLL_EXPENSE_ACCOUNT_CODES.includes(category.accountCodes[0]);

  const kinds = [...new Set(category.accountCodes.map(kindName))];

  return (
    <div className={`admin-report-page expense-category-page${sidebarCollapsed ? " sidebar-collapsed" : ""}${mobileNavOpen ? " mobile-nav-open" : ""}`}>
      {mobileNavOpen && <button type="button" className="report-mobile-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <Sidebar
        role="admin"
        activeTab="expensesPayroll"
        sidebarCollapsed={mobileNavOpen ? false : sidebarCollapsed}
        onToggle={() => (mobileNavOpen ? setMobileNavOpen(false) : toggleSidebar())}
      />

      <main className="admin-report-main">
        <header className="admin-report-topbar">
          <div className="admin-report-topbar-title">
            <div className="report-topbar-title-row">
              <button type="button" className="report-mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu">
                <Menu size={21} aria-hidden="true" />
              </button>
              <span className="admin-report-section-label"><i className="topbar-label-pin" aria-hidden="true" /> ADMIN PORTAL</span>
            </div>
            <h1>Expenses and Payroll</h1>
          </div>
        </header>

        <div className="admin-report-content ec-content ec-desk">
          <section className="ec-notebook" aria-labelledby="ec-title">
            <div className="ec-spine" aria-hidden="true">
              <svg className="ec-spine-tail" viewBox="0 0 46 44" focusable="false">
                <path d="M23 2 V16" stroke="#a97a43" strokeWidth="2.4" strokeLinecap="round" />
                <circle cx="23" cy="18" r="4" fill="#c99a5b" stroke="#8f6431" strokeWidth="1" />
                <path d="M21 21 L14 42 M25 21 L33 42" stroke="#b8864f" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="ec-card">
            <header className="ec-hero">
              <Link className="ec-back" to="/admin/finances"><ArrowLeft size={15} aria-hidden="true" /> Back to Financial Center</Link>
              <div className="ec-hero-row">
                <div className="ec-hero-copy">
                  <h2 id="ec-title">{category.label}</h2>
                  <p>Every expense recorded for this category, newest first.</p>
                  <ul className="ec-kinds" aria-label="Kinds of expense included"><li className="ec-kinds-label">Includes</li>
                    {kinds.map((name) => <li key={name}>{name}</li>)}
                  </ul>
                  {category.accountNote && <p className="ec-note">{category.accountNote}</p>}
                </div>
                {category.readOnly ? (
                  <span className="ec-note">Recorded automatically when a shift is closed.</span>
                ) : fromPayroll ? (
                  <Link className="ec-btn ec-btn-solid ec-btn-lg" to="/admin/expenses-payroll/payroll"><HandCoins size={14} aria-hidden="true" /> Go to Payroll</Link>
                ) : (
                  <Link className="ec-btn ec-btn-solid ec-btn-lg" to="/admin/finances"><Plus size={14} aria-hidden="true" /> Record an expense</Link>
                )}
              </div>
            </header>

            <ExpenseCategoryBudget month={budgetMonth} onMonthChange={setBudgetMonth} categorySlug={category.slug} />
            {category.utility && (
              <UtilityBillPanel
                category={category}
                month={budgetMonth}
                onChanged={() => {
                  window.dispatchEvent(new Event("amaya:stock-mutated"));
                  loadEntries();
                }}
              />
            )}
            {category.slug === "labor-and-payroll" && (
              <LaborBudgetPlan month={budgetMonth} onApplied={() => window.dispatchEvent(new Event("amaya:stock-mutated"))} />
            )}

            <div className="ec-toolbar">
              <div className="ec-dates">
                <label>From <input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} /></label>
                <label>To <input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} /></label>
                <button type="button" className="ec-btn" onClick={() => { setFromDate(""); setToDate(""); setPage(1); }}>Clear dates</button>
              </div>
              <label className="ec-search">
                <Search size={15} aria-hidden="true" />
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search expenses" aria-label="Search expenses" />
              </label>
            </div>

            {dateInvalid && <div className="ec-alert ec-alert-inset" role="alert">Pick a start date that comes before the end date.</div>}
            {error && <div className="ec-alert ec-alert-inset" role="alert">{error}</div>}

            <div className="ec-table-wrap">
              <table className="ec-table">
                <thead>
                  <tr><th>Date</th><th>Reference</th><th>What it was for</th><th>Kind of expense</th><th className="ec-right">Amount</th><th>Added by</th></tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => {
                    const matchedLines = (entry.lines || []).filter((line) => category.accountCodes.includes(String(line.accountCode)) && (Number(line.debit || 0) > 0 || (category.readOnly && Number(line.credit || 0) > 0)));
                    const amount = matchedLines.reduce((sum, line) => sum + Number(line.debit || 0) - (category.readOnly ? Number(line.credit || 0) : 0), 0);
                    return (
                      <tr key={entry.id}>
                        <td>{formatDateTime(entry.entryDate)}</td>
                        <td><span className="ec-ref">{entry.entryNumber || `JE-${entry.id}`}</span></td>
                        <td>
                          <strong>{entry.memo || "Operating expense"}</strong>
                          {entry.referenceNumber && <small>{entry.referenceNumber}</small>}
                        </td>
                        <td>
                          {matchedLines.map((line) => <span className="ec-kind" key={line.id}>{kindName(String(line.accountCode))}</span>)}
                        </td>
                        <td className="ec-right ec-amount">{peso(amount)}</td>
                        <td>{entry.creatorName || "Admin"}</td>
                      </tr>
                    );
                  })}
                  {!filteredEntries.length && (
                    <tr><td colSpan={6} className="ec-empty">
                      <span className="ec-empty-mark" aria-hidden="true"><i /></span>
                      <strong>{loading ? "Loading expenses…" : search ? "Nothing matches your search" : "No expenses recorded here yet"}</strong>
                      <span>{search ? "Try a different word, or clear the search box." : fromPayroll ? "When you approve a payroll run, its cost will show up here." : "When you record an expense for this category, it will show up here."}</span>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <footer className="ec-footer">
              <span>{total ? `Total shown ${peso(pageAmount)}. Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total} ${total === 1 ? "expense" : "expenses"}` : "No expenses to show."}</span>
              <div>
                <button type="button" className="ec-btn" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
                <span>Page {page} of {maxPage}</span>
                <button type="button" className="ec-btn" disabled={page >= maxPage || loading} onClick={() => setPage((current) => Math.min(maxPage, current + 1))}>Next</button>
                <button type="button" className="ec-btn" disabled={loading} onClick={loadEntries}><RefreshCw size={13} aria-hidden="true" /> Refresh</button>
              </div>
            </footer>
            </div>
          </section>
          <aside className="ec-pen" aria-hidden="true"><Pen /></aside>
        </div>
      </main>
    </div>
  );
}

export default AdminExpenseCategory;
