import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Archive, History, LockKeyhole, Menu, Pencil, Plus, RefreshCw, Search, UnlockKeyhole, UserMinus, UserPlus, X } from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import NetIncomePinModal from "../../components/NetIncomePinModal.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useNetIncomePin } from "../../hooks/useNetIncomePin.js";
import { apiRequest } from "../../utils/api.js";
import "../../assets/css/admin/AdminReport.css";
import "../../assets/css/admin/FinancialManagement.css";
import "../../assets/css/admin/ExpenseCategoryPage.css";
import "../../assets/css/admin/StaffRoster.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const EMPLOYMENT_LABELS = { regular: "Regular", probationary: "Probationary", part_time: "Part-time", contractual: "Contractual" };
const BASIS_LABELS = { monthly: "Monthly (Salary)", daily: "Daily (Wages)", hourly: "Hourly (Wages)" };
const PER = { monthly: "month", daily: "day", hourly: "hour" };
const DIVISORS = [
  { value: 313, label: "313 — works 6 days a week" },
  { value: 261, label: "261 — works 5 days a week" },
  { value: 365, label: "365 — paid every day, incl. rest days" },
];
const ID_FIELDS = [
  { key: "sss", label: "SSS number", hint: "10 digits" },
  { key: "philhealth", label: "PhilHealth number", hint: "12 digits" },
  { key: "pagibig", label: "Pag-IBIG MID number", hint: "12 digits" },
  { key: "tin", label: "TIN", hint: "9 or 12 digits" },
];

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

function peso(value) {
  return `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function niceDate(value) {
  if (!value) return "—";
  const [y, m, d] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

const emptyForm = () => ({
  fullName: "",
  position: "",
  employmentStatus: "probationary",
  payBasis: "monthly",
  dailyDivisor: 313,
  startDate: today(),
  rate: "",
  userId: "",
  governmentIds: { sss: "", philhealth: "", pagibig: "", tin: "" },
  clearIds: {},
});

function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="sr-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`sr-modal${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="sr-modal-head">
          <h3>{title}</h3>
          <button type="button" className="sr-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function AdminStaff() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pin = useNetIncomePin();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusTab, setStatusTab] = useState("active");
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(null); // { kind: "add" | "edit" | "rate" | "resign", employee }

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status: statusTab });
      if (showArchived) params.set("includeArchived", "1");
      const result = await apiRequest(`/payroll/employees?${params}`, { headers: pin.financialHeaders });
      setItems(Array.isArray(result?.items) ? result.items : []);
    } catch (loadError) {
      setError(loadError?.message || "Could not load the staff list.");
    } finally {
      setLoading(false);
    }
  }, [statusTab, showArchived, pin.financialHeaders]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => (needle ? items.filter((item) => `${item.fullName} ${item.position} ${item.linkedUser?.name || ""}`.toLowerCase().includes(needle)) : items),
    [items, needle],
  );

  const done = (message) => {
    setDialog(null);
    setNotice(message);
    load();
  };

  const runAction = async (path, message) => {
    setError("");
    try {
      await apiRequest(path, { method: "POST", body: JSON.stringify({}) });
      done(message);
    } catch (actionError) {
      setError(actionError?.message || "That action did not go through.");
    }
  };

  return (
    <div className={`admin-report-page expense-category-page staff-roster-page${sidebarCollapsed ? " sidebar-collapsed" : ""}${mobileNavOpen ? " mobile-nav-open" : ""}`}>
      {mobileNavOpen && <button type="button" className="report-mobile-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <Sidebar role="admin" activeTab="expensesPayroll" sidebarCollapsed={mobileNavOpen ? false : sidebarCollapsed} onToggle={() => (mobileNavOpen ? setMobileNavOpen(false) : toggleSidebar())} />
      <main className="admin-report-main">
        <header className="admin-report-topbar"><div className="admin-report-topbar-title"><div className="report-topbar-title-row"><button type="button" className="report-mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu"><Menu size={21} aria-hidden="true" /></button><span className="admin-report-section-label"><i className="topbar-label-pin" aria-hidden="true" /> ADMIN PORTAL</span></div><h1>Expenses and Payroll</h1></div></header>
        <div className="ec-content">
          <div className="ec-card sr-card">
            <header className="ec-hero">
              <Link className="ec-back" to="/admin/expenses-payroll"><ArrowLeft size={15} aria-hidden="true" /> Budget Overview</Link>
              <div className="ec-hero-row">
                <div className="ec-hero-copy">
                  <h2>Staff</h2>
                  <p>Everyone you pay, with their pay basis and rate.</p>
                  <p className="ec-note">The owner is not listed here. Money the owner takes out is Owner&apos;s Drawings, not salary.</p>
                </div>
                <div className="sr-hero-actions">
                  {pin.unlocked ? (
                    <button type="button" className="ec-btn" onClick={pin.lock}><UnlockKeyhole size={14} aria-hidden="true" /> Hide pay rates</button>
                  ) : (
                    <button type="button" className="ec-btn" onClick={() => pin.setModalOpen(true)}><LockKeyhole size={14} aria-hidden="true" /> Show pay rates</button>
                  )}
                  <button type="button" className="ec-btn ec-btn-solid ec-btn-lg" onClick={() => setDialog({ kind: "add" })}><Plus size={14} aria-hidden="true" /> Add Employee</button>
                </div>
              </div>
            </header>

            <div className="sr-toolbar">
              <div className="sr-tabs" role="tablist" aria-label="Employee status">
                {[["active", "Active"], ["resigned", "Resigned"], ["all", "All"]].map(([value, label]) => (
                  <button key={value} type="button" role="tab" aria-selected={statusTab === value} className={statusTab === value ? "is-active" : ""} onClick={() => setStatusTab(value)}>{label}</button>
                ))}
              </div>
              <label className="sr-check"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Show archived</label>
              <label className="sr-search"><Search size={14} aria-hidden="true" /><input type="search" placeholder="Search name, position or login" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
              <button type="button" className="sr-icon-btn" onClick={load} aria-label="Refresh"><RefreshCw size={15} /></button>
            </div>

            {error && <div className="sr-alert" role="alert">{error}</div>}
            {notice && !error && <div className="sr-notice" role="status">{notice}<button type="button" className="sr-icon-btn" onClick={() => setNotice("")} aria-label="Dismiss"><X size={13} /></button></div>}

            <div className="sr-table-wrap">
              <table className="sr-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Position</th>
                    <th scope="col">Status</th>
                    <th scope="col">Pay basis</th>
                    <th scope="col" className="sr-num">Rate</th>
                    <th scope="col">Started</th>
                    <th scope="col"><span className="sr-sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !items.length && <tr><td colSpan={7} className="sr-empty">Loading staff…</td></tr>}
                  {!loading && !visible.length && (
                    <tr><td colSpan={7} className="sr-empty">{items.length ? "No one matches that search." : statusTab === "active" ? "No active employees. Add an employee to start payroll." : statusTab === "resigned" ? "No resigned employees." : "No employees here yet. Add your first employee to start payroll."}</td></tr>
                  )}
                  {visible.map((employee) => (
                    <tr key={employee.id} className={employee.isArchived ? "is-archived" : ""}>
                      <td>
                        <strong className="sr-name">{employee.fullName}</strong>
                        <small>{employee.linkedUser ? `POS login: ${employee.linkedUser.name}` : "No POS login"}</small>
                      </td>
                      <td>{employee.position}<small>{EMPLOYMENT_LABELS[employee.employmentStatus]}</small></td>
                      <td>
                        <span className={`sr-chip is-${employee.status}`}>{employee.status === "active" ? "Active" : "Resigned"}</span>
                        {employee.isArchived && <span className="sr-chip is-archived">Archived</span>}
                        {employee.endDate && <small>Last day {niceDate(employee.endDate)}</small>}
                      </td>
                      <td>{BASIS_LABELS[employee.payBasis]}</td>
                      <td className="sr-num">
                        {employee.ratesLocked ? (
                          <button type="button" className="sr-locked" onClick={() => pin.setModalOpen(true)} title="Enter the Owner PIN to see pay rates"><LockKeyhole size={12} aria-hidden="true" /> Hidden</button>
                        ) : employee.currentRate == null ? "—" : (
                          <><strong>{peso(employee.currentRate)}</strong><small>per {PER[employee.payBasis]}</small></>
                        )}
                      </td>
                      <td>{niceDate(employee.startDate)}</td>
                      <td className="sr-actions">
                        <button type="button" className="sr-icon-btn" title="Edit details" aria-label={`Edit ${employee.fullName}`} onClick={() => setDialog({ kind: "edit", employee })}><Pencil size={14} /></button>
                        {employee.status === "active" && (
                          <button type="button" className="sr-icon-btn" title="Change rate / rate history" aria-label={`Change rate for ${employee.fullName}`} onClick={() => setDialog({ kind: "rate", employee })}><History size={14} /></button>
                        )}
                        {employee.status === "active" ? (
                          <button type="button" className="sr-icon-btn" title="Mark as resigned" aria-label={`Mark ${employee.fullName} as resigned`} onClick={() => setDialog({ kind: "resign", employee })}><UserMinus size={14} /></button>
                        ) : (
                          <button type="button" className="sr-icon-btn" title="Reactivate" aria-label={`Reactivate ${employee.fullName}`} onClick={() => runAction(`/payroll/employees/${employee.id}/reactivate`, `${employee.fullName} is active again.`)}><UserPlus size={14} /></button>
                        )}
                        {employee.status === "resigned" && !employee.isArchived && (
                          <button type="button" className="sr-icon-btn" title="Archive (hide from list)" aria-label={`Archive ${employee.fullName}`} onClick={() => runAction(`/payroll/employees/${employee.id}/archive`, `${employee.fullName} archived. Their payroll history is kept.`)}><Archive size={14} /></button>
                        )}
                        {employee.isArchived && (
                          <button type="button" className="ec-btn sr-small-btn" onClick={() => runAction(`/payroll/employees/${employee.id}/unarchive`, `${employee.fullName} is back on the list.`)}>Restore</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer className="sr-footer">{visible.length} {visible.length === 1 ? "employee" : "employees"} shown · Government ID numbers are stored encrypted and shown with only the last 4 digits.</footer>
          </div>
        </div>
      </main>

      {(dialog?.kind === "add" || dialog?.kind === "edit") && (
        <EmployeeForm employee={dialog.employee} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "rate" && (
        <RateDialog employeeId={dialog.employee.id} pin={pin} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.kind === "resign" && (
        <ResignDialog employee={dialog.employee} onClose={() => setDialog(null)} onSaved={done} />
      )}
      <NetIncomePinModal
        open={pin.modalOpen}
        hasPin={pin.hasPin}
        onClose={() => pin.setModalOpen(false)}
        onUnlocked={(accessToken) => pin.unlock(accessToken)}
        purpose="Pay Rates"
      />
    </div>
  );
}

function EmployeeForm({ employee, onClose, onSaved }) {
  const editing = Boolean(employee);
  const [form, setForm] = useState(() => (editing ? {
    ...emptyForm(),
    fullName: employee.fullName,
    position: employee.position,
    employmentStatus: employee.employmentStatus,
    payBasis: employee.payBasis,
    dailyDivisor: employee.dailyDivisor,
    startDate: employee.startDate,
    userId: employee.linkedUser ? String(employee.linkedUser.id) : "",
  } : emptyForm()));
  const [logins, setLogins] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest(`/payroll/linkable-users${editing ? `?employeeId=${employee.id}` : ""}`)
      .then((result) => { if (active) setLogins(result?.items || []); })
      .catch(() => {});
    return () => { active = false; };
  }, [editing, employee]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
  const setId = (key) => (event) => setForm((prev) => ({ ...prev, governmentIds: { ...prev.governmentIds, [key]: event.target.value } }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const governmentIds = {};
    for (const { key } of ID_FIELDS) {
      const typed = form.governmentIds[key].trim();
      if (typed) governmentIds[key] = typed;
      else if (form.clearIds[key]) governmentIds[key] = "";
    }
    const body = {
      fullName: form.fullName,
      position: form.position,
      employmentStatus: form.employmentStatus,
      dailyDivisor: Number(form.dailyDivisor),
      startDate: form.startDate,
      userId: form.userId ? Number(form.userId) : null,
      governmentIds,
    };
    if (!editing) {
      body.payBasis = form.payBasis;
      body.rate = Number(form.rate);
    }
    try {
      if (editing) {
        await apiRequest(`/payroll/employees/${employee.id}`, { method: "PATCH", body: JSON.stringify(body) });
        onSaved(`${form.fullName} updated.`);
      } else {
        await apiRequest("/payroll/employees", { method: "POST", body: JSON.stringify(body) });
        onSaved(`${form.fullName} added to the staff list.`);
      }
    } catch (saveError) {
      setError(saveError?.message || "Could not save this employee.");
      setSaving(false);
    }
  };

  return (
    <Modal title={editing ? `Edit ${employee.fullName}` : "Add Employee"} onClose={onClose} wide>
      <form className="sr-form" onSubmit={submit}>
        <fieldset>
          <legend>Who</legend>
          <label>Full name<input required maxLength={120} value={form.fullName} onChange={set("fullName")} autoFocus /></label>
          <label>Position<input required maxLength={80} placeholder="e.g. Barista, Kitchen crew" value={form.position} onChange={set("position")} /></label>
          <label>Employment status
            <select value={form.employmentStatus} onChange={set("employmentStatus")}>
              {Object.entries(EMPLOYMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Start date<input type="date" required value={form.startDate} onChange={set("startDate")} /></label>
          <label className="sr-span-2">POS login (optional)
            <select value={form.userId} onChange={set("userId")}>
              <option value="">No login — kitchen crew and others can still be paid</option>
              {logins.map((login) => <option key={login.id} value={login.id}>{login.name}</option>)}
            </select>
            <small>Linking a login lets payroll fill in days worked from closed cashier shifts.</small>
          </label>
        </fieldset>

        <fieldset>
          <legend>Pay</legend>
          {editing ? (
            <p className="sr-help sr-span-2">Pay basis: <strong>{BASIS_LABELS[form.payBasis]}</strong>. To change the rate or basis, use <em>Change rate</em> so the old rate stays in the history.</p>
          ) : (
            <>
              <label>Pay basis
                <select value={form.payBasis} onChange={set("payBasis")}>
                  {Object.entries(BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>Starting rate (₱ per {PER[form.payBasis]})<input type="number" min="0.01" step="0.01" required value={form.rate} onChange={set("rate")} /></label>
            </>
          )}
          <label className="sr-span-2">Paid days per year
            <select value={form.dailyDivisor} onChange={set("dailyDivisor")}>
              {DIVISORS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <small>Used to turn a monthly rate into a daily rate (monthly × 12 ÷ days) for absences and overtime.</small>
          </label>
        </fieldset>

        <fieldset>
          <legend>Government IDs <span>(optional, stored encrypted)</span></legend>
          {ID_FIELDS.map(({ key, label, hint }) => {
            const saved = editing ? employee.governmentIds?.[key] : null;
            return (
              <label key={key}>{label}
                <input inputMode="numeric" autoComplete="off" placeholder={saved ? `${saved} — type to replace` : hint} value={form.governmentIds[key]} onChange={setId(key)} />
                {saved && (
                  <span className="sr-inline-check">
                    <input type="checkbox" checked={Boolean(form.clearIds[key])} onChange={(event) => setForm((prev) => ({ ...prev, clearIds: { ...prev.clearIds, [key]: event.target.checked } }))} /> Remove saved number
                  </span>
                )}
              </label>
            );
          })}
        </fieldset>

        {error && <div className="sr-alert" role="alert">{error}</div>}
        <div className="sr-form-actions">
          <button type="button" className="ec-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ec-btn ec-btn-solid" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add Employee"}</button>
        </div>
      </form>
    </Modal>
  );
}

function RateDialog({ employeeId, pin, onClose, onSaved }) {
  const [employee, setEmployee] = useState(null);
  const [form, setForm] = useState({ rate: "", payBasis: "", effectiveFrom: today(), note: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiRequest(`/payroll/employees/${employeeId}`, { headers: pin.financialHeaders })
      .then((result) => {
        if (!active) return;
        setEmployee(result.employee);
        setForm((prev) => ({ ...prev, payBasis: prev.payBasis || result.employee.payBasis }));
      })
      .catch((loadError) => { if (active) setError(loadError?.message || "Could not load this employee."); });
    return () => { active = false; };
  }, [employeeId, pin.financialHeaders]);

  const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/payroll/employees/${employeeId}/rates`, {
        method: "POST",
        body: JSON.stringify({ rate: Number(form.rate), payBasis: form.payBasis, effectiveFrom: form.effectiveFrom, note: form.note }),
      });
      onSaved(`New rate saved for ${employee?.fullName || "the employee"}.`);
    } catch (saveError) {
      setError(saveError?.message || "Could not save the new rate.");
      setSaving(false);
    }
  };

  return (
    <Modal title={employee ? `Pay rate — ${employee.fullName}` : "Pay rate"} onClose={onClose} wide>
      <form className="sr-form" onSubmit={submit}>
        <fieldset>
          <legend>New rate</legend>
          <label>Pay basis
            <select value={form.payBasis} onChange={set("payBasis")}>
              {Object.entries(BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Rate (₱ per {PER[form.payBasis] || "period"})<input type="number" min="0.01" step="0.01" required value={form.rate} onChange={set("rate")} autoFocus /></label>
          <label>Takes effect on<input type="date" required value={form.effectiveFrom} onChange={set("effectiveFrom")} /></label>
          <label>Reason (optional)<input maxLength={160} placeholder="e.g. Regularization, annual increase" value={form.note} onChange={set("note")} /></label>
        </fieldset>
        <section className="sr-history">
          <h4>Rate history</h4>
          {!employee ? <p className="sr-help">Loading…</p> : employee.rateHistory == null ? (
            <p className="sr-help"><button type="button" className="sr-locked" onClick={() => pin.setModalOpen(true)}><LockKeyhole size={12} aria-hidden="true" /> Enter the Owner PIN</button> to see past rates.</p>
          ) : (
            <ol>
              {employee.rateHistory.map((row) => (
                <li key={row.id}>
                  <strong>{peso(row.rate)}</strong>
                  <span>from {niceDate(row.effectiveFrom)}</span>
                  {row.note && <em>{row.note}</em>}
                  {row.setBy && <small>set by {row.setBy}</small>}
                </li>
              ))}
            </ol>
          )}
          <p className="sr-help">Old rates are never changed or deleted, so past payroll can always be checked.</p>
        </section>
        {error && <div className="sr-alert" role="alert">{error}</div>}
        <div className="sr-form-actions">
          <button type="button" className="ec-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ec-btn ec-btn-solid" disabled={saving || !employee}>{saving ? "Saving…" : "Save new rate"}</button>
        </div>
      </form>
    </Modal>
  );
}

function ResignDialog({ employee, onClose, onSaved }) {
  const [endDate, setEndDate] = useState(today());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await apiRequest(`/payroll/employees/${employee.id}/resign`, { method: "POST", body: JSON.stringify({ endDate }) });
      onSaved(`${employee.fullName} marked as resigned.`);
    } catch (saveError) {
      setError(saveError?.message || "Could not update this employee.");
      setSaving(false);
    }
  };
  return (
    <Modal title={`Mark ${employee.fullName} as resigned`} onClose={onClose}>
      <form className="sr-form" onSubmit={submit}>
        <fieldset>
          <label className="sr-span-2">Last working day<input type="date" required min={employee.startDate} value={endDate} onChange={(event) => setEndDate(event.target.value)} autoFocus /></label>
          <p className="sr-help sr-span-2">They stay on record for final pay and the 13th month. You can reactivate them later if this was a mistake.</p>
        </fieldset>
        {error && <div className="sr-alert" role="alert">{error}</div>}
        <div className="sr-form-actions">
          <button type="button" className="ec-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="ec-btn ec-btn-solid" disabled={saving}>{saving ? "Saving…" : "Mark as resigned"}</button>
        </div>
      </form>
    </Modal>
  );
}
