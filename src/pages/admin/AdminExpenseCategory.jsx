import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, FileText, Menu, RefreshCw, Wallet } from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { apiRequest } from "../../utils/api.js";
import { getExpenseNavCategory } from "../../config/expenseNavigation.js";
import "../../assets/css/admin/AdminReport.css";
import "../../assets/css/admin/FinancialManagement.css";
import "../../assets/css/admin/AdminExpenseCategory.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const PAGE_SIZE = 25;

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

  const loadEntries = useCallback(async () => {
    if (!category) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      type: "operating_expense",
      accountCodes: category.accountCodes.join(","),
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
      setError(requestError?.message || "Could not load expense entries.");
      setEntries([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [category, fromDate, page, toDate]);

  useEffect(() => {
    loadEntries();
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
      ...((entry.lines || []).map((line) => `${line.accountCode} ${line.accountName} ${line.lineMemo}`)),
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [entries, search]);

  const pageAmount = useMemo(() => entries.reduce((sum, entry) => (
    sum + (entry.lines || []).reduce((lineSum, line) => (
      category?.accountCodes.includes(String(line.accountCode)) ? lineSum + Number(line.debit || 0) : lineSum
    ), 0)
  ), 0), [category, entries]);
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const dateInvalid = Boolean(fromDate && toDate && fromDate > toDate);

  if (!category) return <Navigate to="/admin/finances" replace />;

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

        <div className="admin-report-content admin-finances-content expense-category-content">
          <section className="expense-category-panel" aria-label={`${category.label} expense records`}>
            <div className="expense-category-header">
              <div>
                <Link className="expense-back-link" to="/admin/finances"><ArrowLeft size={15} aria-hidden="true" /> Financial Center</Link>
                <span className="expense-category-eyebrow"><Wallet size={14} aria-hidden="true" /> EXPENSE CATEGORY</span>
                <h2>{category.label}</h2>
                <p>Posted operating expense transactions linked to this category.</p>
                <div className="expense-account-codes">
                  <span>Accounts</span>
                  {category.accountCodes.map((code) => <code key={code}>{code}</code>)}
                </div>
                {category.accountNote && <p className="expense-category-note">{category.accountNote}</p>}
              </div>
              <Link className="expense-record-link" to="/admin/finances">
                Record an expense <ExternalLink size={14} aria-hidden="true" />
              </Link>
            </div>

            <div className="expense-category-summary">
              <article>
                <span>Matching Transactions</span>
                <strong>{total.toLocaleString()}</strong>
              </article>
              <article>
                <span>Amount on This Page</span>
                <strong>{peso(pageAmount)}</strong>
              </article>
              <article>
                <span>Accounts Included</span>
                <strong>{category.accountCodes.length}</strong>
              </article>
            </div>

            <div className="expense-list-toolbar">
              <div className="expense-date-filters">
                <label>From <input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} /></label>
                <label>To <input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} /></label>
                <button type="button" onClick={() => { setFromDate(""); setToDate(""); setPage(1); }}>Clear dates</button>
              </div>
              <label className="expense-entry-search">
                <FileText size={15} aria-hidden="true" />
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search entries" aria-label="Search expense entries" />
              </label>
            </div>

            {dateInvalid && <div className="expense-category-error" role="alert">The start date must be on or before the end date.</div>}
            {error && <div className="expense-category-error" role="alert">{error}</div>}

            <div className="expense-entry-table-wrap">
              <table className="expense-entry-table">
                <thead>
                  <tr><th>Date</th><th>Entry #</th><th>Description</th><th>Expense Account</th><th>Amount</th><th>Recorded By</th></tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => {
                    const matchedLines = (entry.lines || []).filter((line) => category.accountCodes.includes(String(line.accountCode)) && Number(line.debit || 0) > 0);
                    const amount = matchedLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
                    return (
                      <tr key={entry.id}>
                        <td>{formatDateTime(entry.entryDate)}</td>
                        <td><code>{entry.entryNumber || `JE-${entry.id}`}</code></td>
                        <td>
                          <strong>{entry.memo || "Operating expense"}</strong>
                          {entry.referenceNumber && <small>{entry.referenceNumber}</small>}
                        </td>
                        <td>
                          {matchedLines.map((line) => <span className="expense-account-line" key={line.id}>{line.accountCode} · {line.accountName}</span>)}
                        </td>
                        <td className="expense-entry-amount">{peso(amount)}</td>
                        <td>{entry.creatorName || "Admin"}</td>
                      </tr>
                    );
                  })}
                  {!filteredEntries.length && (
                    <tr><td colSpan={6} className="expense-entry-empty">
                      <strong>{loading ? "Loading expense entries..." : search ? "No matching entries" : "No posted entries for this category"}</strong>
                      <span>{search ? "Try another description, reference, or account." : "Use the Financial Center to record an expense; matching ledger entries will appear here."}</span>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <footer className="expense-entry-footer">
              <span>{total ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total} transactions` : "0 transactions"}</span>
              <div>
                <button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button>
                <span>Page {page} of {maxPage}</span>
                <button type="button" disabled={page >= maxPage || loading} onClick={() => setPage((current) => Math.min(maxPage, current + 1))}>Next</button>
                <button type="button" className="expense-refresh-btn" disabled={loading} onClick={loadEntries}><RefreshCw size={13} aria-hidden="true" /> Refresh</button>
              </div>
            </footer>
          </section>
        </div>
      </main>
    </div>
  );
}

export default AdminExpenseCategory;
