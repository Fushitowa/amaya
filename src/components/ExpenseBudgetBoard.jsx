import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CircleAlert, FileText, Pencil, Plus, RefreshCw, Search, Wallet, X } from "lucide-react";
import { apiRequest } from "../utils/api.js";
import { EXPENSE_NAV_TREE as GROUPS } from "../config/expenseNavigation.js";

const STATUS = {
  green: { tone: "ok", label: "Healthy" },
  yellow: { tone: "warn", label: "Getting close" },
  red: { tone: "high", label: "Almost used" },
  over_budget: { tone: "over", label: "Over budget" },
  no_budget: { tone: "none", label: "No budget set" },
};

// One ink colour per expense group, used for its tab dot, its share of the month's spending and its sheet edge.
const GROUP_COLORS = ["#7a4a2b", "#c08a2e", "#4f7a62", "#9a5b6b", "#3f6b73", "#6b5b8a", "#a9693a", "#7d8a52", "#8a6f5a"];

function peso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthLabel(month) {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "long", year: "numeric", timeZone: "Asia/Manila" }).format(new Date(Date.UTC(year, number - 1, 1)));
}

export default function ExpenseBudgetBoard({ month, onMonthChange }) {
  const [items, setItems] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await apiRequest(`/finances/expense-budgets/health?month=${encodeURIComponent(month)}`);
      setItems(Array.isArray(result?.items) ? result.items : []);
      setEstimates(Array.isArray(result?.estimates) ? result.estimates : []);
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

  const { sections, summary } = useMemo(() => {
    const bySlug = new Map(items.map((item) => [item.category, item]));
    const placed = new Set();
    const built = GROUPS.flatMap((group) => {
      const head = bySlug.get(group.slug);
      if (!head) return [];
      placed.add(group.slug);
      const kids = group.children.flatMap((slug) => {
        const child = bySlug.get(slug);
        if (!child) return [];
        placed.add(slug);
        return [child];
      });
      return [{ head, kids }];
    });
    items.forEach((item) => {
      if (!placed.has(item.category)) built.push({ head: item, kids: [] });
    });
    const leaves = built.flatMap((section) => (section.kids.length ? section.kids : [section.head]));
    return {
      sections: built,
      summary: {
        total: leaves.length,
        withBudget: leaves.filter((item) => item.budget != null).length,
        attention: leaves.filter((item) => item.status === "over_budget" || item.status === "red").length,
        // A group's spend is its pages plus records tagged with the group itself, so the grand total
        // adds up the groups (heads), not just the pages (payroll plan O3.3).
        spent: built.reduce((sum, section) => sum + Number(section.head.spent || 0), 0),
      },
    };
  }, [items]);

  const needle = query.trim().toLowerCase();
  const visibleSections = useMemo(() => {
    return sections
      .filter((section) => tab === "all" || section.head.category === tab)
      .map((section) => {
        // A group with sub-items shows only those items; the group itself is just the heading.
        const all = section.kids.length ? section.kids : [section.head];
        const spent = Number(section.head.spent || 0);
        const budgeted = all.filter((item) => item.budget != null);
        const budget = budgeted.reduce((sum, item) => sum + Number(item.budget || 0), 0);
        return { ...section, cards: needle ? all.filter((item) => item.label.toLowerCase().includes(needle) || section.head.label.toLowerCase().includes(needle)) : all, total: all.length, spent, budget, hasBudget: budgeted.length > 0 };
      })
      .filter((section) => section.cards.length);
  }, [sections, tab, needle]);
  const shownCount = visibleSections.reduce((sum, section) => sum + section.cards.length, 0);
  const activeLabel = tab === "all" ? "All categories" : sections.find((section) => section.head.category === tab)?.head.label || "Budgets";

  const renderRow = (item, isHead) => {
    const status = STATUS[item.status] || STATUS.no_budget;
    const hasBudget = item.budget != null;
    const percent = item.percentUsed == null ? 0 : Math.max(0, Number(item.percentUsed));
    const open = editing === item.category;
    const over = hasBudget && item.remaining < 0;
    return (
      <div className={`eb-row tone-${status.tone}${isHead ? " is-head" : ""}`} role="row" key={item.category}>
        <div className="eb-cell eb-name" role="cell">
          <Link to={`/admin/expenses-payroll/${item.category}`} title={`View expense records for ${item.label}`}>{item.label}</Link>
          {item.accountNote && <small title={item.accountNote}>{item.accountNote}</small>}
        </div>
        <div className="eb-cell eb-status" role="cell"><span className={`eb-chip tone-${status.tone}`}><i aria-hidden="true" />{status.label}</span></div>
        <div className="eb-cell eb-num" role="cell" data-label="Spent"><strong>{peso(item.spent)}</strong></div>
        <div className="eb-cell eb-num" role="cell" data-label="Budget">{hasBudget ? <strong>{peso(item.budget)}</strong> : <span className="eb-dash">Not set</span>}</div>
        <div className="eb-cell eb-usage" role="cell">
          {hasBudget ? (
            <>
              <div className="eb-meter" role="progressbar" aria-label={`${item.label} budget used`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, Math.round(percent))}>
                <span style={{ width: `${Math.min(100, percent)}%` }} />
              </div>
              <small className={over ? "is-over" : ""}>
                {over ? `${peso(Math.abs(item.remaining))} over` : `${peso(item.remaining)} left`} · {Number(percent).toLocaleString("en-PH", { maximumFractionDigits: 1 })}%
              </small>
            </>
          ) : (
            <small className="eb-dash">Set a budget to track usage</small>
          )}
        </div>
        <div className="eb-cell eb-actions" role="cell">
          <button type="button" className="eb-btn eb-btn-soft" onClick={() => { setEditing(open ? "" : item.category); setAmount(hasBudget ? String(item.budget) : ""); }} aria-expanded={open}>
            {hasBudget ? <Pencil size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            {hasBudget ? "Edit" : "Set budget"}
          </button>
          <Link className="eb-icon-btn" to={`/admin/expenses-payroll/${item.category}`} aria-label={`View expense records for ${item.label}`} title="View expense records">
            <FileText size={15} aria-hidden="true" />
          </Link>
        </div>
        {open && (
          <form className="eb-edit" onSubmit={(event) => saveBudget(event, item)}>
            <label>Budget for {monthLabel(month)}
              <span className="eb-money"><b>₱</b><input autoFocus type="number" min="0" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></span>
            </label>
            <button type="button" className="eb-btn" onClick={() => setEditing("")}>Cancel</button>
            <button type="submit" className="eb-btn eb-btn-primary" disabled={saving}>{saving ? "Saving…" : "Save budget"}</button>
          </form>
        )}
      </div>
    );
  };

  const colorOf = (category) => GROUP_COLORS[Math.max(0, sections.findIndex((section) => section.head.category === category)) % GROUP_COLORS.length];
  const spread = sections.map((section) => ({ category: section.head.category, label: section.head.label, spent: Number(section.head.spent || 0) })).filter((part) => part.spent > 0);
  const spreadTotal = spread.reduce((sum, part) => sum + part.spent, 0);
  const coverage = summary.total ? Math.round((summary.withBudget / summary.total) * 100) : 0;

  return (
    <section className="eb-panel" aria-label="Expense budget overview">
      <header className="eb-head">
        <span className="eb-crest" aria-hidden="true"><Wallet size={20} /></span>
        <div className="eb-head-copy">
          <h2>Monthly budget overview</h2>
          <p>Spent comes from posted operating expenses; reversed entries are excluded.</p>
        </div>
        <div className="eb-head-actions">
          <label className="eb-field eb-month"><span>Month</span>
            <input type="month" value={month} onChange={(event) => onMonthChange(event.target.value || month)} />
          </label>
          <button type="button" className="eb-btn" onClick={load} disabled={loading}><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
        </div>
      </header>

      <div className={`eb-summary${estimates.length ? " has-estimate" : ""}`}>
        <div className="eb-hero">
          <span className="eb-stat-label">Total spent in {monthLabel(month)}</span>
          <strong>{peso(summary.spent)}</strong>
          <small>Posted operating expenses</small>
        </div>
        {estimates.length > 0 && (
          <div className="eb-stat" title="Estimated from each utility's latest bill. Shown only; nothing is posted until the real bill is entered.">
            <span className="eb-stat-label">Bills not in yet</span>
            <strong>≈ {peso(estimates.reduce((sum, estimate) => sum + Number(estimate.estimatedAmount || 0), 0))}</strong>
            <small>{estimates.map((estimate) => `${estimate.label} ≈ ${peso(estimate.estimatedAmount)}`).join(" · ")}</small>
          </div>
        )}
        <div className="eb-stat">
          <span className="eb-stat-label">Budgets set</span>
          <strong>{summary.withBudget}<em> of {summary.total}</em></strong>
          <div className="eb-meter eb-meter-thin" aria-hidden="true"><span style={{ width: `${coverage}%` }} /></div>
        </div>
        <div className="eb-stat">
          <span className="eb-stat-label">Without a budget</span>
          <strong>{summary.total - summary.withBudget}</strong>
          <small>Set one to start tracking</small>
        </div>
        <div className={`eb-stat${summary.attention ? " is-alert" : ""}`}>
          <span className="eb-stat-label">Needs attention</span>
          <strong>{summary.attention}</strong>
          <small>{summary.attention ? "Over or almost at budget" : "Nothing close to its limit"}</small>
        </div>
      </div>

      <div className="eb-spread">
        <p className="eb-spread-title">Where the month's money went</p>
        {spreadTotal > 0 ? (
          <>
            <div className="eb-spread-bar" role="group" aria-label="Share of spending by group">
              {spread.map((part) => (
                <button type="button" key={part.category} className="eb-spread-seg" style={{ flexGrow: part.spent, "--g": colorOf(part.category) }} onClick={() => setTab(part.category)} title={`${part.label}: ${peso(part.spent)}`} aria-label={`${part.label}, ${peso(part.spent)}, show this group`} />
              ))}
            </div>
            <ul className="eb-spread-key">
              {spread.map((part) => (
                <li key={part.category} style={{ "--g": colorOf(part.category) }}>
                  <i aria-hidden="true" />{part.label} <b>{Math.round((part.spent / spreadTotal) * 100)}%</b>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="eb-spread-bar is-empty" aria-hidden="true" />
        )}
        {spreadTotal === 0 && <p className="eb-spread-empty">Nothing has been spent in {monthLabel(month)} yet. Posted expenses will fill this bar.</p>}
      </div>

      <div className="eb-toolbar">
        <div className="eb-tabs" role="tablist" aria-label="Budget groups">
          <button type="button" role="tab" aria-selected={tab === "all"} className={`eb-tab${tab === "all" ? " is-active" : ""}`} onClick={() => setTab("all")}>
            All <span className="eb-tab-count">{items.length}</span>
          </button>
          {sections.map(({ head, kids }) => (
            <button type="button" role="tab" aria-selected={tab === head.category} key={head.category} className={`eb-tab${tab === head.category ? " is-active" : ""}`} onClick={() => setTab(head.category)}>
              <i className="eb-tab-dot" style={{ background: colorOf(head.category) }} aria-hidden="true" />{head.label} <span className="eb-tab-count">{kids.length + 1}</span>
            </button>
          ))}
        </div>
        <label className="eb-field eb-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search categories" aria-label="Search categories" />
          {query && <button type="button" className="eb-search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={14} aria-hidden="true" /></button>}
        </label>
      </div>

      <div className="eb-body">
        <div className="eb-body-title">
          <h3>{activeLabel}</h3>
          <span>{shownCount} {shownCount === 1 ? "category" : "categories"}</span>
        </div>
        {error && <div className="eb-error" role="alert"><CircleAlert size={16} aria-hidden="true" /> {error}</div>}
        {loading && <div className="eb-empty"><Wallet size={24} aria-hidden="true" /><strong>Loading budgets…</strong><span>Fetching spending for {monthLabel(month)}.</span></div>}
        {!loading && !visibleSections.length && !error && (
          <div className="eb-empty">
            <Search size={24} aria-hidden="true" />
            <strong>{needle ? "No categories match" : "No categories yet"}</strong>
            <span>{needle ? "Try a different name or clear the search." : "Budget data will appear here once expense categories are available."}</span>
          </div>
        )}
        {visibleSections.map((section) => (
          <div className="eb-group" key={section.head.category} role="table" aria-label={section.head.label} style={{ "--g": colorOf(section.head.category) }}>
            <div className="eb-group-head">
              <div className="eb-group-title">
                <h4>{section.head.label}</h4>
                {section.kids.length ? (
                  <span>{section.hasBudget ? `Budgeted ${peso(section.budget)}` : "No budgets set yet"} · <Link to={`/admin/expenses-payroll/${section.head.category}`}>View all records</Link></span>
                ) : (
                  <span>{section.total} {section.total === 1 ? "category" : "categories"}</span>
                )}
              </div>
              <div className="eb-group-spent"><small>Spent</small><strong>{peso(section.spent)}</strong></div>
            </div>
            <div className="eb-cols" role="row">
              <span role="columnheader">Category</span><span role="columnheader">Status</span><span role="columnheader" className="eb-r">Spent</span><span role="columnheader" className="eb-r">Budget</span><span role="columnheader">Usage</span><span role="columnheader" className="eb-sr">Actions</span>
            </div>
            {section.cards.map((item) => renderRow(item, item.category === section.head.category))}
          </div>
        ))}
      </div>
    </section>
  );
}
