import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban, CheckCircle2, FileText, LockKeyhole, Menu, Plus, RefreshCw, RotateCcw, Trash2, Undo2, Wallet } from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import NetIncomePinModal from "../../components/NetIncomePinModal.jsx";
import PayslipView from "../../components/PayslipView.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useBusiness } from "../../context/BusinessContext.jsx";
import { useNetIncomePin } from "../../hooks/useNetIncomePin.js";
import { apiRequest } from "../../utils/api.js";
import "../../assets/css/admin/AdminReport.css";
import "../../assets/css/admin/FinancialManagement.css";
import "../../assets/css/admin/ExpenseCategoryPage.css";
import "../../assets/css/admin/StaffRoster.css";
import "../../assets/css/admin/PayrollRuns.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const BASE = "/admin/expenses-payroll/payroll";
const STATUS = {
  draft: { label: "Draft", tone: "draft" },
  approved: { label: "Approved — to pay", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  voided: { label: "Voided", tone: "void" },
};
const CHANNELS = [
  { value: "store_bank", label: "Bank" },
  { value: "gcash", label: "GCash" },
  { value: "cash_counter", label: "Cash drawer" },
];
const CHANNEL_CODES = { cash_counter: "1010", gcash: "1020", store_bank: "1030" };
const PAID_FROM = { 1010: "Cash drawer", 1020: "GCash", 1030: "Bank", 1040: "Owner reserve" };
const PER = { monthly: "mo", daily: "day", hourly: "hr" };

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const peso = (value) => `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function niceDate(value, withYear = true) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
const periodLabel = (run) => `${niceDate(run.periodStart, false)} – ${niceDate(run.periodEnd)}`;

export default function AdminPayroll() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pin = useNetIncomePin();
  const [tab, setTab] = useState("runs");
  const [notice, setNotice] = useState("");

  return (
    <div className={`admin-report-page expense-category-page staff-roster-page payroll-page${sidebarCollapsed ? " sidebar-collapsed" : ""}${mobileNavOpen ? " mobile-nav-open" : ""}`}>
      {mobileNavOpen && <button type="button" className="report-mobile-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <Sidebar role="admin" activeTab="expensesPayroll" sidebarCollapsed={mobileNavOpen ? false : sidebarCollapsed} onToggle={() => (mobileNavOpen ? setMobileNavOpen(false) : toggleSidebar())} />
      <main className="admin-report-main">
        <header className="admin-report-topbar"><div className="admin-report-topbar-title"><div className="report-topbar-title-row"><button type="button" className="report-mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu"><Menu size={21} aria-hidden="true" /></button><span className="admin-report-section-label"><i className="topbar-label-pin" aria-hidden="true" /> ADMIN PORTAL</span></div><h1>Expenses and Payroll</h1></div></header>
        <div className="ec-content">
          <div className="ec-card sr-card">
            {!pin.unlocked ? (
              <Locked onUnlock={() => pin.setModalOpen(true)} />
            ) : runId ? (
              <RunDetail key={runId} runId={runId} headers={pin.financialHeaders} onBack={() => navigate(BASE)} onDeleted={(message) => { setNotice(message); navigate(BASE); }} />
            ) : (
              <>
                <header className="ec-hero">
                  <Link className="ec-back" to="/admin/expenses-payroll/staff"><ArrowLeft size={15} aria-hidden="true" /> Staff</Link>
                  <div className="ec-hero-row">
                    <div className="ec-hero-copy">
                      <h2>Payroll</h2>
                      <p>Pay your staff every cut-off: 1st–15th and 16th–end of the month.</p>
                    </div>
                  </div>
                  <div className="sr-tabs pr-main-tabs" role="tablist" aria-label="Payroll sections">
                    {[["runs", "Payroll Runs"], ["thirteenth", "13th Month"], ["owner", "Owner's Pay"]].map(([value, label]) => (
                      <button key={value} type="button" role="tab" aria-selected={tab === value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>{label}</button>
                    ))}
                  </div>
                </header>
                {notice && <div className="sr-notice" role="status">{notice}<button type="button" className="sr-icon-btn" onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}
                {tab === "runs" && <RunList headers={pin.financialHeaders} onOpen={(id) => navigate(`${BASE}/${id}`)} />}
                {tab === "thirteenth" && <ThirteenthMonth headers={pin.financialHeaders} />}
                {tab === "owner" && <OwnerPay headers={pin.financialHeaders} />}
              </>
            )}
          </div>
        </div>
      </main>
      <NetIncomePinModal open={pin.modalOpen} hasPin={pin.hasPin} onClose={() => pin.setModalOpen(false)} onUnlocked={(token) => pin.unlock(token)} purpose="Payroll" />
    </div>
  );
}

function Locked({ onUnlock }) {
  return (
    <div className="pr-locked">
      <LockKeyhole size={28} aria-hidden="true" />
      <h2>Payroll is private</h2>
      <p>Pay amounts show how much the store spends on labor, so payroll opens with the Owner PIN.</p>
      <button type="button" className="ec-btn ec-btn-solid ec-btn-lg" onClick={onUnlock}>Enter Owner PIN</button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function RunList({ headers, onOpen }) {
  const [data, setData] = useState({ items: [], suggestedCutoff: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [cutoffDate, setCutoffDate] = useState(today());

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await apiRequest("/payroll/runs", { headers }));
    } catch (loadError) {
      setError(loadError?.message || "Could not load payroll runs.");
    } finally {
      setLoading(false);
    }
  }, [headers]);
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const create = async (event) => {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const result = await apiRequest("/payroll/runs", { method: "POST", headers, body: JSON.stringify({ periodStart: cutoffDate }) });
      onOpen(result.run.id);
    } catch (createError) {
      setError(createError?.message || "Could not start a payroll run.");
      setCreating(false);
    }
  };

  return (
    <>
      <form className="pr-start" onSubmit={create}>
        <label>Start payroll for the cut-off that includes
          <input type="date" required max={today()} value={cutoffDate} onChange={(event) => setCutoffDate(event.target.value)} />
        </label>
        <button type="submit" className="ec-btn ec-btn-solid ec-btn-lg" disabled={creating}><Plus size={14} aria-hidden="true" /> {creating ? "Preparing…" : "Start payroll run"}</button>
        <button type="button" className="sr-icon-btn" onClick={load} aria-label="Refresh"><RefreshCw size={15} /></button>
      </form>
      {error && <div className="sr-alert" role="alert">{error}</div>}
      <div className="sr-table-wrap">
        <table className="sr-table">
          <thead>
            <tr>
              <th scope="col">Cut-off</th>
              <th scope="col">Status</th>
              <th scope="col" className="sr-num">Staff</th>
              <th scope="col" className="sr-num">Gross pay</th>
              <th scope="col" className="sr-num">Net pay</th>
              <th scope="col" className="sr-num">Labor cost</th>
              <th scope="col"><span className="sr-sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && !data.items.length && <tr><td colSpan={7} className="sr-empty">Loading…</td></tr>}
            {!loading && !data.items.length && <tr><td colSpan={7} className="sr-empty">No payroll runs yet. Pick a date above and start your first one.</td></tr>}
            {data.items.map((run) => (
              <tr key={run.id} className={run.status === "voided" ? "is-archived" : ""}>
                <td><strong className="sr-name">{periodLabel(run)}</strong><small>Pay date {niceDate(run.payDate)}</small></td>
                <td><span className={`pr-status tone-${STATUS[run.status].tone}`}>{STATUS[run.status].label}</span>{run.status === "approved" && <small>{run.paidCount} of {run.headcount} paid</small>}</td>
                <td className="sr-num">{run.headcount}</td>
                <td className="sr-num">{peso(run.totals.gross)}</td>
                <td className="sr-num">{peso(run.totals.net)}</td>
                <td className="sr-num" title="Gross pay + employer contributions + 13th month">{peso(run.totals.laborCost)}</td>
                <td className="sr-actions"><button type="button" className="ec-btn sr-small-btn" onClick={() => onOpen(run.id)}>Open</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="sr-footer">Labor cost = gross pay + employer SSS / PhilHealth / Pag-IBIG + 13th month. It shows under Labor and Payroll in the P&amp;L.</footer>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function NumberCell({ value, disabled, onSave, label, max }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(String(value)), 0);
    return () => window.clearTimeout(timer);
  }, [value]);
  if (disabled) return <span>{value}</span>;
  const commit = () => {
    if (draft === String(value)) return;
    const num = Number(draft);
    if (!Number.isFinite(num) || num < 0 || num > max) {
      setDraft(String(value));
      return;
    }
    onSave(num);
  };
  return (
    <input className="pr-num-input" type="number" min="0" max={max} step="0.25" aria-label={label} value={draft}
      onChange={(event) => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
  );
}

function RunDetail({ runId, headers, onBack, onDeleted }) {
  const { businessSettings } = useBusiness() || {};
  const [run, setRun] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState("store_bank");
  const [selected, setSelected] = useState(() => new Set());
  const [payslip, setPayslip] = useState(null);
  const [confirm, setConfirm] = useState(null); // "approve" | "void" | "delete"
  const [voidReason, setVoidReason] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await apiRequest(`/payroll/runs/${runId}`, { headers });
      setRun(result.run);
    } catch (loadError) {
      setError(loadError?.message || "Could not load this payroll run.");
    }
  }, [runId, headers]);
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const act = async (path, options = {}, success) => {
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest(`/payroll/runs/${runId}${path}`, { method: "POST", headers, body: JSON.stringify(options.body || {}), ...(options.method ? { method: options.method } : {}) });
      if (result?.run) setRun(result.run);
      if (success || result?.message) setNotice(success || result.message);
      setSelected(new Set());
      setConfirm(null);
      return result;
    } catch (actionError) {
      setError(actionError?.message || "That did not go through.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const editLine = (line, field, value) => act(`/lines/${line.id}`, { method: "PATCH", body: { [field]: value } }, "");

  const unpaid = useMemo(() => (run ? run.lines.filter((l) => !l.paidAt) : []), [run]);
  const payTotal = useMemo(() => {
    const pool = selected.size ? unpaid.filter((l) => selected.has(l.id)) : unpaid;
    return pool.reduce((sum, l) => sum + l.netPay, 0);
  }, [unpaid, selected]);

  if (!run) {
    return <div className="pr-loading">{error ? <div className="sr-alert" role="alert">{error}</div> : "Loading payroll…"}</div>;
  }
  const draft = run.status === "draft";
  const approved = run.status === "approved";
  const t = run.totals;

  return (
    <>
      <header className="ec-hero">
        <button type="button" className="ec-back pr-back" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" /> All payroll runs</button>
        <div className="ec-hero-row">
          <div className="ec-hero-copy">
            <h2>Payroll {periodLabel(run)}</h2>
            <p>{draft ? "Check each person's days and hours, then approve." : approved ? "Approved and posted. Pay your staff below." : run.status === "paid" ? "Everyone is paid." : `Voided: ${run.voidReason || ""}`}</p>
            <p className="ec-note"><span className={`pr-status tone-${STATUS[run.status].tone}`}>{STATUS[run.status].label}</span> Pay date {niceDate(run.payDate)}{run.rateTableYear ? ` · ${run.rateTableYear} contribution tables` : ""}{run.contributionSplit === "monthly" ? " · contributions deducted monthly (2nd cut-off)" : " · contributions split half per cut-off"}{run.approvedBy ? ` · approved by ${run.approvedBy}` : ""}</p>
          </div>
          <div className="sr-hero-actions">
            {draft && <button type="button" className="ec-btn" disabled={busy} onClick={() => act("/rebuild")}><RotateCcw size={14} aria-hidden="true" /> Rebuild from staff list</button>}
            {draft && <button type="button" className="ec-btn" disabled={busy} onClick={() => setConfirm("delete")}><Trash2 size={14} aria-hidden="true" /> Delete draft</button>}
            {draft && <button type="button" className="ec-btn ec-btn-solid ec-btn-lg" disabled={busy || !run.lines.length} onClick={() => setConfirm("approve")}><CheckCircle2 size={14} aria-hidden="true" /> Approve payroll</button>}
            {(approved || run.status === "paid") && <button type="button" className="ec-btn" disabled={busy} onClick={() => setConfirm("void")}><Ban size={14} aria-hidden="true" /> Void run</button>}
          </div>
        </div>
      </header>

      {error && <div className="sr-alert" role="alert">{error}</div>}
      {notice && !error && <div className="sr-notice" role="status">{notice}<button type="button" className="sr-icon-btn" onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}

      {confirm === "approve" && (
        <div className="pr-confirm" role="alertdialog" aria-label="Approve payroll">
          <p><strong>Approve this payroll?</strong> It posts {peso(t.laborCost)} of labor cost to the ledger and locks the days and hours. Mistakes are fixed by voiding, not editing.</p>
          <div><button type="button" className="ec-btn" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="ec-btn ec-btn-solid" disabled={busy} onClick={() => act("/approve")}>Yes, approve</button></div>
        </div>
      )}
      {confirm === "delete" && (
        <div className="pr-confirm" role="alertdialog" aria-label="Delete draft">
          <p><strong>Delete this draft?</strong> Nothing was posted yet, so nothing else changes.</p>
          <div><button type="button" className="ec-btn" onClick={() => setConfirm(null)}>Cancel</button><button type="button" className="ec-btn ec-btn-solid" disabled={busy} onClick={async () => { const r = await act("", { method: "DELETE" }); if (r) onDeleted("Draft payroll deleted."); }}>Delete draft</button></div>
        </div>
      )}
      {confirm === "void" && (
        <form className="pr-confirm" onSubmit={(event) => { event.preventDefault(); act("/void", { body: { reason: voidReason } }); }}>
          <p><strong>Void this run?</strong> Its ledger entry is reversed and its payables are cancelled. Undo any staff payments first.</p>
          <label>Reason<input required maxLength={255} value={voidReason} onChange={(event) => setVoidReason(event.target.value)} placeholder="e.g. Wrong hours for Maria" /></label>
          <div><button type="button" className="ec-btn" onClick={() => setConfirm(null)}>Cancel</button><button type="submit" className="ec-btn ec-btn-solid" disabled={busy}>Void run</button></div>
        </form>
      )}

      <dl className="pr-totals">
        <div><dt>Gross pay</dt><dd>{peso(t.gross)}</dd></div>
        <div><dt>Staff deductions</dt><dd>{peso(t.employeeContributions + t.withholdingTax)}</dd></div>
        <div><dt>Net pay to staff</dt><dd>{peso(t.net)}</dd></div>
        <div><dt>Employer contributions</dt><dd>{peso(t.employerContributions)}</dd></div>
        <div><dt>13th month accrued</dt><dd>{peso(t.thirteenthMonth)}</dd></div>
        <div className="is-strong"><dt>Labor cost</dt><dd>{peso(t.laborCost)}</dd></div>
      </dl>

      {approved && unpaid.length > 0 && (
        <div className="pr-paybar">
          <span>{selected.size ? `${selected.size} selected` : `Everyone not yet paid (${unpaid.length})`}: <strong>{peso(payTotal)}</strong></span>
          <label>Paid from
            <select value={channel} onChange={(event) => setChannel(event.target.value)}>
              {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <button type="button" className="ec-btn ec-btn-solid" disabled={busy} onClick={() => act("/pay", { body: { channel, ...(selected.size ? { lineIds: [...selected] } : {}) } })}><Wallet size={14} aria-hidden="true" /> {selected.size ? "Pay selected" : "Pay everyone"}</button>
        </div>
      )}

      <div className="sr-table-wrap">
        <table className="sr-table pr-lines">
          <thead>
            <tr>
              {approved && <th scope="col"><span className="sr-sr-only">Select</span></th>}
              <th scope="col">Employee</th>
              <th scope="col" className="sr-num">Rate</th>
              <th scope="col" className="sr-num">Days</th>
              <th scope="col" className="sr-num">Hours</th>
              <th scope="col" className="sr-num">Absent</th>
              <th scope="col" className="sr-num">OT hrs</th>
              <th scope="col" className="sr-num">Gross</th>
              <th scope="col" className="sr-num">Deductions</th>
              <th scope="col" className="sr-num">Net pay</th>
              <th scope="col"><span className="sr-sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {!run.lines.length && <tr><td colSpan={11} className="sr-empty">No one in this run. Use “Rebuild from staff list”.</td></tr>}
            {run.lines.map((line) => {
              const deductions = line.sssEe + line.philhealthEe + line.pagibigEe + line.withholdingTax;
              return (
                <tr key={line.id}>
                  {approved && (
                    <td>{!line.paidAt && <input type="checkbox" aria-label={`Select ${line.employeeName}`} checked={selected.has(line.id)} onChange={(event) => setSelected((prev) => { const next = new Set(prev); if (event.target.checked) next.add(line.id); else next.delete(line.id); return next; })} />}</td>
                  )}
                  <td>
                    <strong className="sr-name">{line.employeeName}</strong>
                    <small>{line.position}{line.prefillNote && draft ? ` · ${line.prefillNote}` : ""}{line.prorationNote ? ` · ${line.prorationNote}` : ""}</small>
                  </td>
                  <td className="sr-num">{peso(line.rate)}<small>per {PER[line.payBasis]}</small></td>
                  <td className="sr-num">{line.payBasis === "daily" ? <NumberCell value={line.daysWorked} max={16} label={`Days worked by ${line.employeeName}`} disabled={!draft || busy} onSave={(v) => editLine(line, "daysWorked", v)} /> : "—"}</td>
                  <td className="sr-num">{line.payBasis === "hourly" ? <NumberCell value={line.hoursWorked} max={384} label={`Hours worked by ${line.employeeName}`} disabled={!draft || busy} onSave={(v) => editLine(line, "hoursWorked", v)} /> : "—"}</td>
                  <td className="sr-num">{line.payBasis === "monthly" ? <NumberCell value={line.daysAbsent} max={16} label={`Days absent for ${line.employeeName}`} disabled={!draft || busy} onSave={(v) => editLine(line, "daysAbsent", v)} /> : "—"}</td>
                  <td className="sr-num"><NumberCell value={line.otHours} max={256} label={`Overtime hours for ${line.employeeName}`} disabled={!draft || busy} onSave={(v) => editLine(line, "otHours", v)} /></td>
                  <td className="sr-num">{peso(line.grossPay)}</td>
                  <td className="sr-num">{peso(deductions)}</td>
                  <td className="sr-num"><strong>{peso(line.netPay)}</strong>{line.paidAt && <small className="pr-paid">Paid</small>}</td>
                  <td className="sr-actions">
                    <button type="button" className="sr-icon-btn" title="Payslip" aria-label={`Payslip for ${line.employeeName}`} onClick={() => setPayslip(line)}><FileText size={14} /></button>
                    {draft && <button type="button" className="sr-icon-btn" title="Remove from this run" aria-label={`Remove ${line.employeeName}`} disabled={busy} onClick={() => act(`/lines/${line.id}`, { method: "DELETE" })}><Trash2 size={14} /></button>}
                    {line.paidAt && line.netPay > 0 && run.status !== "voided" && <button type="button" className="sr-icon-btn" title="Undo payment" aria-label={`Undo payment for ${line.employeeName}`} disabled={busy} onClick={() => act(`/lines/${line.id}/unpay`)}><Undo2 size={14} /></button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {run.payables.length > 0 && (
        <section className="pr-payables">
          <h4>What this run owes</h4>
          <ul>
            {run.payables.map((p) => (
              <li key={p.id}>
                <span>{p.payee}</span>
                <strong>{peso(p.amount)}</strong>
                <em className={`pr-status tone-${p.status === "paid" ? "ok" : p.status === "voided" ? "void" : "warn"}`}>{p.status === "unpaid" ? "Not paid" : p.status === "partial" ? `${peso(p.paid)} paid` : p.status === "paid" ? "Paid" : "Voided"}</em>
                {p.accountCode !== "2040" && p.status !== "voided" && p.status !== "paid" && <small>Remit from Finances → Payables{p.dueDate ? `, due ${niceDate(p.dueDate)}` : ""}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {payslip && <PayslipView run={run} line={payslip} businessName={businessSettings?.businessName || "Amaya"} onClose={() => setPayslip(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function ThirteenthMonth({ headers }) {
  const [year, setYear] = useState(() => Number(today().slice(0, 4)));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [channel, setChannel] = useState("store_bank");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setData(await apiRequest(`/payroll/thirteenth-month?year=${year}`, { headers }));
    } catch (loadError) {
      setError(loadError?.message || "Could not load the 13th month.");
    }
  }, [year, headers]);
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const run = async (path, employeeId) => {
    setBusy(true);
    setError("");
    try {
      const result = await apiRequest(`/payroll/thirteenth-month/${path}`, { method: "POST", headers, body: JSON.stringify({ year, employeeId, channel }) });
      setNotice(result.message);
      await load();
    } catch (actionError) {
      setError(actionError?.message || "That did not go through.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="pr-start">
        <p className="sr-help">13th month = total basic pay earned in the year ÷ 12 (overtime not included). It builds up with every approved run and must be paid by <strong>December 24</strong>.</p>
        <label>Year<select value={year} onChange={(event) => setYear(Number(event.target.value))}>{[0, 1, 2].map((back) => { const y = Number(today().slice(0, 4)) - back; return <option key={y} value={y}>{y}</option>; })}</select></label>
        <label>Pay from<select value={channel} onChange={(event) => setChannel(event.target.value)}>{CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
      </div>
      {error && <div className="sr-alert" role="alert">{error}</div>}
      {notice && !error && <div className="sr-notice" role="status">{notice}</div>}
      <div className="sr-table-wrap">
        <table className="sr-table">
          <thead><tr><th scope="col">Employee</th><th scope="col" className="sr-num">Basic pay earned</th><th scope="col" className="sr-num">13th month</th><th scope="col" className="sr-num">Paid</th><th scope="col" className="sr-num">Still owed</th><th scope="col"><span className="sr-sr-only">Actions</span></th></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={6} className="sr-empty">Loading…</td></tr>}
            {data && !data.items.length && <tr><td colSpan={6} className="sr-empty">No approved payroll in {year} yet.</td></tr>}
            {data?.items.map((item) => (
              <tr key={item.employeeId}>
                <td><strong className="sr-name">{item.employeeName}</strong>{item.status === "resigned" && <small>Resigned {niceDate(item.endDate)} — pay with final pay</small>}</td>
                <td className="sr-num">{peso(item.basicPayEarned)}</td>
                <td className="sr-num">{peso(item.accrued)}</td>
                <td className="sr-num">{peso(item.paid)}</td>
                <td className="sr-num"><strong>{peso(item.unpaid)}</strong></td>
                <td className="sr-actions">
                  {item.unpaid > 0 && <button type="button" className="ec-btn sr-small-btn" disabled={busy} onClick={() => run("pay", item.employeeId)}>Pay {peso(item.unpaid)}</button>}
                  {item.paid > 0 && <button type="button" className="sr-icon-btn" title="Undo 13th month payment" aria-label={`Undo 13th month payment for ${item.employeeName}`} disabled={busy} onClick={() => run("undo", item.employeeId)}><Undo2 size={14} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function OwnerPay({ headers }) {
  const year = Number(today().slice(0, 4));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [amount, setAmount] = useState("");
  const [channel, setChannel] = useState("store_bank");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiRequest(`/payroll/owner-pay?year=${year}`, { headers }));
    } catch (loadError) {
      setError(loadError?.message || "Could not load owner's pay.");
    }
  }, [year, headers]);
  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest("/finances/journal-entries", {
        method: "POST",
        body: JSON.stringify({
          entryType: "owner_withdrawal",
          amount: Number(amount),
          debitAccountCode: "3020",
          creditAccountCode: CHANNEL_CODES[channel],
          memo: note.trim() || "Owner's pay",
        }),
      });
      setNotice(`Owner's pay of ${peso(amount)} recorded as Owner's Drawings.`);
      setAmount("");
      setNote("");
      await load();
    } catch (saveError) {
      setError(saveError?.message || "Could not record owner's pay.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="pr-owner-explain">
        <p><strong>Why the owner isn&apos;t on payroll:</strong> a sole proprietor can&apos;t pay themselves a salary. Money you take out is <em>Owner&apos;s Drawings</em>. It lowers the store&apos;s cash and your equity, but it is <strong>not an expense</strong>, so it never lowers net income or shows in the P&amp;L.</p>
      </div>
      <form className="sr-form pr-owner-form" onSubmit={submit}>
        <fieldset>
          <legend>Take owner&apos;s pay</legend>
          <label>Amount (₱)<input type="number" min="0.01" step="0.01" required value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>Taken from<select value={channel} onChange={(event) => setChannel(event.target.value)}>{CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
          <label className="sr-span-2">Note (optional)<input maxLength={200} placeholder="e.g. Owner's pay for November" value={note} onChange={(event) => setNote(event.target.value)} /></label>
        </fieldset>
        {error && <div className="sr-alert" role="alert">{error}</div>}
        {notice && !error && <div className="sr-notice" role="status">{notice}</div>}
        <div className="sr-form-actions"><button type="submit" className="ec-btn ec-btn-solid" disabled={busy}>{busy ? "Saving…" : "Record owner's pay"}</button></div>
      </form>
      <section className="pr-payables">
        <h4>Owner&apos;s pay in {year}: {data ? peso(data.total) : "…"}</h4>
        <ul>
          {data?.items.slice(0, 12).map((item) => (
            <li key={item.id}><span>{niceDate(item.date)} · {item.memo}</span><strong>{peso(item.amount)}</strong><small>{PAID_FROM[item.paidFrom] || ""}</small></li>
          ))}
          {data && !data.items.length && <li><span>No owner&apos;s pay recorded this year.</span></li>}
        </ul>
      </section>
    </>
  );
}
