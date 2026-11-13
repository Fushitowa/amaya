import { useEffect, useState, useCallback } from "react";
import {
  Calendar,
  Scale,
  RotateCcw,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  BookOpen,
  ArrowLeftRight,
  PlusCircle,
  Wallet,
  X,
} from "lucide-react";
import { apiRequest } from "../utils/api.js";
import "../assets/css/admin/FinancialManagement.css";

function peso(val) {
  const num = Number(val || 0);
  const safe = Number.isFinite(num) ? num : 0;
  return `₱${safe.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const LIQUID_ACCOUNT_OPTIONS = [
  { code: "1010", label: "1010 - Cash Drawer (Counter 1)" },
  { code: "1020", label: "1020 - GCash Official Wallet" },
  { code: "1030", label: "1030 - Store Bank Account" },
  { code: "1040", label: "1040 - Owner Capital Reserve" },
];

export default function FinancialReconciliationCenter() {
  const [activeTab, setActiveTab] = useState("recon"); // 'recon', 'pnl', 'cashflow', 'balancesheet', 'journal'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Filters & Pagination
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reconPage, setReconPage] = useState(1);
  const [reconTotal, setReconTotal] = useState(0);
  const [journalPage, setJournalPage] = useState(1);
  const [journalTotal, setJournalTotal] = useState(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Data states
  const [reconData, setReconData] = useState([]);
  const [pnlData, setPnlData] = useState(null);
  const [cfData, setCfData] = useState(null);
  const [bsData, setBsData] = useState(null);
  const [journalData, setJournalData] = useState([]);

  // Reversal & Manual Entry Modals (non-blocking UI)
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reverseReason, setReverseReason] = useState("");
  const [actionModal, setActionModal] = useState(null); // null | 'opex' | 'drawing' | 'capital' | 'transfer'
  const [formAmount, setFormAmount] = useState("");
  const [formMemo, setFormMemo] = useState("");
  const [formExpenseCode, setFormExpenseCode] = useState("6010");
  const [formPrimaryAccount, setFormPrimaryAccount] = useState("1010");
  const [formSecondaryAccount, setFormSecondaryAccount] = useState("1030");
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  const buildDateParams = useCallback((extra = {}) => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [fromDate, toDate]);

  useEffect(() => {
    let active = true;

    const loadTab = async () => {
      setLoading(true);
      setError(null);
      try {
        if (activeTab === "recon") {
          const res = await apiRequest(`/finances/reports/daily-reconciliation${buildDateParams({ page: reconPage, limit: 25 })}`);
          if (!active) return;
          setReconData(res.items || []);
          setReconTotal(Number(res.total || 0));
        } else if (activeTab === "pnl") {
          const res = await apiRequest(`/finances/reports/profit-and-loss${buildDateParams()}`);
          if (!active) return;
          setPnlData(res);
        } else if (activeTab === "cashflow") {
          const res = await apiRequest(`/finances/reports/cash-flow${buildDateParams()}`);
          if (!active) return;
          setCfData(res);
        } else if (activeTab === "balancesheet") {
          const res = await apiRequest("/finances/reports/balance-sheet");
          if (!active) return;
          setBsData(res);
        } else if (activeTab === "journal") {
          const res = await apiRequest(`/finances/journal-entries${buildDateParams({ page: journalPage, limit: 25 })}`);
          if (!active) return;
          setJournalData(res.items || []);
          setJournalTotal(Number(res.total || 0));
        }
      } catch (err) {
        if (!active) return;
        setError(err?.message || "Failed to load financial records.");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadTab();
    const onExternalUpdate = () => loadTab();
    window.addEventListener("amaya:stock-mutated", onExternalUpdate);
    window.addEventListener("amaya:session-changed", onExternalUpdate);
    return () => {
      active = false;
      window.removeEventListener("amaya:stock-mutated", onExternalUpdate);
      window.removeEventListener("amaya:session-changed", onExternalUpdate);
    };
  }, [activeTab, buildDateParams, journalPage, reconPage, reloadNonce]);

  const openActionModal = (mode) => {
    setActionModal(mode);
    setFormAmount("");
    setFormError(null);
    setFormExpenseCode("6010");
    setFormPrimaryAccount("1010");
    setFormSecondaryAccount(mode === "transfer" ? "1030" : "1010");
    if (mode === "opex") setFormMemo("Store Operating Expense");
    else if (mode === "drawing") setFormMemo("Owner Drawing / Withdrawal");
    else if (mode === "capital") setFormMemo("Owner Capital Injection");
    else setFormMemo("Internal Treasury Fund Transfer");
  };

  const handleActionSubmit = async (e) => {
    e.preventDefault();
    const amount = Number(formAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError("Please enter a valid positive amount.");
      return;
    }
    const cleanMemo = formMemo.trim();
    if (cleanMemo.length < 3) {
      setFormError("Please provide a short memo describing this transaction.");
      return;
    }

    let entryType = "adjustment";
    let lines = [];
    if (actionModal === "opex") {
      entryType = "operating_expense";
      lines = [
        { accountCode: formExpenseCode, debit: amount, credit: 0, lineMemo: cleanMemo },
        { accountCode: formPrimaryAccount, debit: 0, credit: amount, lineMemo: cleanMemo },
      ];
    } else if (actionModal === "drawing") {
      entryType = "owner_withdrawal";
      lines = [
        { accountCode: "3020", debit: amount, credit: 0, lineMemo: cleanMemo },
        { accountCode: formPrimaryAccount, debit: 0, credit: amount, lineMemo: cleanMemo },
      ];
    } else if (actionModal === "capital") {
      entryType = "capital_injection";
      lines = [
        { accountCode: formPrimaryAccount, debit: amount, credit: 0, lineMemo: cleanMemo },
        { accountCode: "3010", debit: 0, credit: amount, lineMemo: cleanMemo },
      ];
    } else if (actionModal === "transfer") {
      if (formPrimaryAccount === formSecondaryAccount) {
        setFormError("Source and destination accounts must be different.");
        return;
      }
      entryType = "adjustment";
      lines = [
        { accountCode: formSecondaryAccount, debit: amount, credit: 0, lineMemo: `Transfer from ${formPrimaryAccount}` },
        { accountCode: formPrimaryAccount, debit: 0, credit: amount, lineMemo: `Transfer to ${formSecondaryAccount}` },
      ];
    }

    try {
      setFormSubmitting(true);
      setFormError(null);
      await apiRequest("/finances/journal-entries", {
        method: "POST",
        body: JSON.stringify({ entryType, memo: cleanMemo, lines }),
      });
      setActionModal(null);
      setNotice(`Posted ${peso(amount)} journal entry: ${cleanMemo}`);
      setReloadNonce((n) => n + 1);
      window.dispatchEvent(new Event("amaya:stock-mutated"));
    } catch (err) {
      setFormError(err?.message || "Failed to post journal entry.");
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleConfirmReverse = async (e) => {
    e.preventDefault();
    if (!reverseTarget) return;
    const reason = reverseReason.trim();
    if (reason.length < 3) {
      setFormError("Please enter an audit reason (at least 3 characters).");
      return;
    }

    try {
      setFormSubmitting(true);
      setFormError(null);
      await apiRequest(`/finances/journal-entries/${reverseTarget.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      setReverseTarget(null);
      setReverseReason("");
      setNotice(`Traceable reversal posted for ${reverseTarget.entryNumber}.`);
      setReloadNonce((n) => n + 1);
      window.dispatchEvent(new Event("amaya:stock-mutated"));
    } catch (err) {
      setFormError(err?.message || "Reversal failed.");
    } finally {
      setFormSubmitting(false);
    }
  };

  const dateInvalid = Boolean(fromDate && toDate && fromDate > toDate);
  const reconMaxPage = Math.max(1, Math.ceil(reconTotal / 25));
  const journalMaxPage = Math.max(1, Math.ceil(journalTotal / 25));

  return (
    <section className="financial-center-panel" aria-label="Financial Management & Asset Reconciliation Center">
      <div className="financial-center-header">
        <div className="financial-center-title">
          <h3>
            <Scale size={20} />
            Double-Entry Financial Management & Asset Reconciliation
          </h3>
          <p>Full audit trail of store assets, operating profit, cash flows, balance sheet equilibrium, and shift reconciliations</p>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", marginBottom: "0.75rem" }}>
          <button
            type="button"
            className="financial-tab-btn"
            onClick={() => openActionModal("opex")}
            style={{ background: "#fff7ed", border: "1px solid #f0cba4" }}
          >
            <PlusCircle size={14} /> Record OPEX
          </button>
          <button
            type="button"
            className="financial-tab-btn"
            onClick={() => openActionModal("drawing")}
            style={{ background: "#fff7ed", border: "1px solid #f0cba4" }}
          >
            <Wallet size={14} /> Owner Drawing
          </button>
          <button
            type="button"
            className="financial-tab-btn"
            onClick={() => openActionModal("capital")}
            style={{ background: "#fff7ed", border: "1px solid #f0cba4" }}
          >
            <PlusCircle size={14} /> Capital Injection
          </button>
          <button
            type="button"
            className="financial-tab-btn"
            onClick={() => openActionModal("transfer")}
            style={{ background: "#fff7ed", border: "1px solid #f0cba4" }}
          >
            <ArrowLeftRight size={14} /> Transfer Funds
          </button>

          {activeTab !== "balancesheet" && (
            <div style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.45rem", fontSize: "0.8rem" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "#6b5847" }}>
                From
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => {
                    setFromDate(e.target.value);
                    setReconPage(1);
                    setJournalPage(1);
                  }}
                  style={{ border: "1px solid #dfd3c5", borderRadius: "6px", padding: "0.25rem 0.4rem", fontSize: "0.8rem" }}
                />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "#6b5847" }}>
                To
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => {
                    setToDate(e.target.value);
                    setReconPage(1);
                    setJournalPage(1);
                  }}
                  style={{ border: "1px solid #dfd3c5", borderRadius: "6px", padding: "0.25rem 0.4rem", fontSize: "0.8rem" }}
                />
              </label>
              {(fromDate || toDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setFromDate("");
                    setToDate("");
                    setReconPage(1);
                    setJournalPage(1);
                  }}
                  style={{ border: "1px solid #dfd3c5", background: "#fff", borderRadius: "6px", padding: "0.25rem 0.55rem", fontSize: "0.76rem", cursor: "pointer" }}
                >
                  Clear Dates
                </button>
              )}
            </div>
          )}
        </div>

        <div className="financial-tabs-nav" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "recon"}
            className={`financial-tab-btn ${activeTab === "recon" ? "active" : ""}`}
            onClick={() => setActiveTab("recon")}
          >
            <Calendar size={14} />
            Daily Asset Reconciliation
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "pnl"}
            className={`financial-tab-btn ${activeTab === "pnl" ? "active" : ""}`}
            onClick={() => setActiveTab("pnl")}
          >
            <TrendingUp size={14} />
            Profit & Loss (P&L)
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "cashflow"}
            className={`financial-tab-btn ${activeTab === "cashflow" ? "active" : ""}`}
            onClick={() => setActiveTab("cashflow")}
          >
            <Wallet size={14} />
            Cash Flow
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "balancesheet"}
            className={`financial-tab-btn ${activeTab === "balancesheet" ? "active" : ""}`}
            onClick={() => setActiveTab("balancesheet")}
          >
            <Scale size={14} />
            Balance Sheet
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "journal"}
            className={`financial-tab-btn ${activeTab === "journal" ? "active" : ""}`}
            onClick={() => setActiveTab("journal")}
          >
            <BookOpen size={14} />
            Journal Audit
          </button>
        </div>
      </div>

      <div className="financial-tab-content">
        {notice && (
          <div style={{ padding: "0.75rem 1rem", color: "#1e7047", background: "#eef8f2", borderRadius: "8px", marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>
              <CheckCircle2 size={15} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
              {notice}
            </span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice" style={{ border: "none", background: "transparent", cursor: "pointer", color: "#1e7047" }}>
              <X size={14} />
            </button>
          </div>
        )}

        {dateInvalid && (
          <div style={{ padding: "0.75rem 1rem", color: "#c53030", background: "#fff5f5", borderRadius: "8px", marginBottom: "1rem" }}>
            <AlertCircle size={15} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
            The start date cannot be later than the end date.
          </div>
        )}

        {loading && <div style={{ padding: "1.5rem", textAlign: "center", color: "#8b5e3c" }}>Loading financial records...</div>}

        {error && (
          <div style={{ padding: "1rem", color: "#c53030", background: "#fff5f5", borderRadius: "8px", marginBottom: "1rem" }}>
            <AlertCircle size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
            {error}
          </div>
        )}

        {/* TAB 1: DAILY ASSET RECONCILIATION */}
        {!loading && activeTab === "recon" && (
          <>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Business Date</th>
                    <th>Shift Status</th>
                    <th>BOD Open Assets</th>
                    <th>EOD Close Assets</th>
                    <th>Net Asset Delta</th>
                    <th>Gross Sales</th>
                    <th>COGS</th>
                    <th>Net Profit</th>
                    <th>Drawer Variance</th>
                    <th>Opened / Closed By</th>
                  </tr>
                </thead>
                <tbody>
                  {reconData.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: "center", color: "#8b5e3c", padding: "4rem 2rem" }}>
                        No daily asset snapshots recorded yet. Open a cashier shift to record today's BOD snapshot.
                      </td>
                    </tr>
                  ) : (
                    reconData.map((row) => (
                      <tr key={row.id}>
                        <td><strong>{row.businessDate}</strong></td>
                        <td>
                          <span className={row.status === "open" ? "status-badge-open" : "status-badge-closed"}>
                            {row.status}
                          </span>
                        </td>
                        <td>{peso(row.openingTotalAssets)}</td>
                        <td>{row.closingTotalAssets != null ? peso(row.closingTotalAssets) : "— In Progress —"}</td>
                        <td style={{ fontWeight: 700, color: (row.netAssetDelta || 0) >= 0 ? "#1e7047" : "#c53030" }}>
                          {row.netAssetDelta != null ? `${row.netAssetDelta >= 0 ? "+" : ""}${peso(row.netAssetDelta)}` : "—"}
                        </td>
                        <td>{peso(row.grossSales)}</td>
                        <td>{peso(row.cogsConsumed)}</td>
                        <td style={{ fontWeight: 600 }}>{peso(row.netOperatingProfit)}</td>
                        <td style={{ color: Number(row.drawerVariance || 0) === 0 ? "#5a4029" : (row.drawerVariance < 0 ? "#c53030" : "#1e7047") }}>
                          {row.drawerVariance != null ? peso(row.drawerVariance) : "—"}
                        </td>
                        <td style={{ fontSize: "0.8rem", color: "#6b5847" }}>
                          {row.openedByName || "System"}{row.closedByName ? ` / ${row.closedByName}` : ""}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {reconMaxPage > 1 && (
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.8rem" }}>
                <button type="button" disabled={reconPage <= 1} onClick={() => setReconPage((p) => Math.max(1, p - 1))} style={{ padding: "0.3rem 0.6rem", borderRadius: "6px", border: "1px solid #dfd3c5", background: "#fff", cursor: "pointer" }}>Previous</button>
                <span>Page {reconPage} of {reconMaxPage}</span>
                <button type="button" disabled={reconPage >= reconMaxPage} onClick={() => setReconPage((p) => Math.min(reconMaxPage, p + 1))} style={{ padding: "0.3rem 0.6rem", borderRadius: "6px", border: "1px solid #dfd3c5", background: "#fff", cursor: "pointer" }}>Next</button>
              </div>
            )}
          </>
        )}

        {/* TAB 2: PROFIT & LOSS WATERFALL */}
        {!loading && activeTab === "pnl" && pnlData && (
          <div style={{ maxWidth: "700px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.75rem 1rem", background: "#fbf8f5", borderRadius: "8px" }}>
              <span>Gross Sales (Counter & Online)</span>
              <strong>{peso(pnlData.grossSales)}</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.75rem 1rem", background: "#fbf8f5", borderRadius: "8px", color: "#c53030" }}>
              <span>Less: Sales Discounts & Promos</span>
              <span>- {peso(pnlData.discounts)}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.85rem 1rem", background: "#f4ede4", borderRadius: "8px", fontWeight: 700 }}>
              <span>Net Revenue / Sales</span>
              <span>{peso(pnlData.netSales)}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.75rem 1rem", background: "#fbf8f5", borderRadius: "8px", color: "#c53030" }}>
              <span>Less: Cost of Goods Sold (COGS - Ingredients Consumed)</span>
              <span>- {peso(pnlData.cogs)}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", padding: "0.85rem 1rem", background: "#eef8f2", borderRadius: "8px", color: "#1e7047", fontWeight: 700 }}>
              <span>Gross Operating Profit (Margin: {pnlData.grossMarginPercent}%)</span>
              <span>{peso(pnlData.grossProfit)}</span>
            </div>

            <div style={{ padding: "0.75rem 1rem", background: "#fbf8f5", borderRadius: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, marginBottom: "0.5rem" }}>
                <span>Operating Expenses (OPEX)</span>
                <span>{pnlData.totalOperatingExpenses >= 0 ? `- ${peso(pnlData.totalOperatingExpenses)}` : `+ ${peso(Math.abs(pnlData.totalOperatingExpenses))}`}</span>
              </div>
              {pnlData.operatingExpenses.length === 0 ? (
                <div style={{ fontSize: "0.8rem", color: "#8b5e3c" }}>Zero operating expenses posted for period.</div>
              ) : (
                pnlData.operatingExpenses.map((exp, idx) => (
                  <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", color: "#6b5847", padding: "0.2rem 0" }}>
                    <span>{exp.accountCode} - {exp.accountName}</span>
                    <span>{peso(exp.amount)}</span>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", padding: "1.1rem 1.25rem", background: "#3d230e", color: "#ffffff", borderRadius: "10px", fontWeight: 800, fontSize: "1.15rem" }}>
              <span>Net Operating Profit</span>
              <span style={{ color: pnlData.netOperatingProfit >= 0 ? "#92e0be" : "#ffb0b0" }}>
                {peso(pnlData.netOperatingProfit)}
              </span>
            </div>
          </div>
        )}

        {/* TAB 3: CASH FLOW STATEMENT */}
        {!loading && activeTab === "cashflow" && cfData && (
          <div style={{ maxWidth: "700px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <div style={{ padding: "0.9rem 1rem", background: "#fbf8f5", borderRadius: "8px" }}>
              <h4 style={{ margin: "0 0 0.5rem 0", color: "#3d230e" }}>Operating Activities (Liquid Accounts 1010–1040)</h4>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.88rem" }}>
                <span>Cash / Wallet Sales Inflows</span>
                <strong>{peso(cfData.operatingActivities?.cashSalesInflow)}</strong>
              </div>
              {Number(cfData.operatingActivities?.otherOperatingCashNet || 0) !== 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.88rem" }}>
                  <span>Void Reversals & Adjustments (Net)</span>
                  <strong>{peso(cfData.operatingActivities?.otherOperatingCashNet)}</strong>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.88rem", color: "#c53030" }}>
                <span>Less: Cash Inventory Restocks Paid</span>
                <span>- {peso(cfData.operatingActivities?.restockCashOutflow)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.88rem", color: "#c53030" }}>
                <span>Less: Operating Expenses (OPEX) Paid</span>
                <span>- {peso(cfData.operatingActivities?.opexCashOutflow)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.4rem", paddingTop: "0.4rem", borderTop: "1px solid #e5d8c8", fontWeight: 700 }}>
                <span>Net Operating Cash Flow</span>
                <span>{peso(cfData.operatingActivities?.netOperatingCashFlow)}</span>
              </div>
            </div>

            <div style={{ padding: "0.9rem 1rem", background: "#fbf8f5", borderRadius: "8px" }}>
              <h4 style={{ margin: "0 0 0.5rem 0", color: "#3d230e" }}>Investing Activities</h4>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.88rem", color: "#c53030" }}>
                <span>Cash Equipment & Fixtures Purchases</span>
                <span>- {peso(cfData.investingActivities?.equipmentPurchased)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.4rem", paddingTop: "0.4rem", borderTop: "1px solid #e5d8c8", fontWeight: 700 }}>
                <span>Net Investing Cash Flow</span>
                <span>{peso(cfData.investingActivities?.netInvestingCashFlow)}</span>
              </div>
            </div>

            <div style={{ padding: "0.9rem 1rem", background: "#fbf8f5", borderRadius: "8px" }}>
              <h4 style={{ margin: "0 0 0.5rem 0", color: "#3d230e" }}>Financing Activities</h4>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.88rem", color: "#1e7047" }}>
                <span>Owner Opening & Capital Injections</span>
                <span>+ {peso(cfData.financingActivities?.capitalInjected)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.88rem", color: "#c53030" }}>
                <span>Less: Owner Drawings / Withdrawals</span>
                <span>- {peso(cfData.financingActivities?.drawingsWithdrawn)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.4rem", paddingTop: "0.4rem", borderTop: "1px solid #e5d8c8", fontWeight: 700 }}>
                <span>Net Financing Cash Flow</span>
                <span>{peso(cfData.financingActivities?.netFinancingCashFlow)}</span>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", padding: "1.1rem 1.25rem", background: "#3d230e", color: "#ffffff", borderRadius: "10px", fontWeight: 800, fontSize: "1.15rem" }}>
              <span>Net Change in Cash & Liquid Balances</span>
              <span style={{ color: Number(cfData.netCashFlow || 0) >= 0 ? "#92e0be" : "#ffb0b0" }}>
                {peso(cfData.netCashFlow)}
              </span>
            </div>
          </div>
        )}

        {/* TAB 4: BALANCE SHEET */}
        {!loading && activeTab === "balancesheet" && bsData && (
          <div>
            {bsData.asOfDate && (
              <div style={{ fontSize: "0.8rem", color: "#6b5847", marginBottom: "0.75rem" }}>
                As of <strong>{bsData.asOfDate}</strong> (Asia/Manila)
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
              {/* ASSETS */}
              <div style={{ border: "1px solid #e8dfd5", borderRadius: "10px", padding: "1.25rem" }}>
                <h4 style={{ margin: "0 0 1rem 0", color: "#3d230e", borderBottom: "2px solid #3d230e", paddingBottom: "0.5rem" }}>
                  ASSETS
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.86rem" }}>
                  {bsData.assets?.current?.map((a) => (
                    <div key={a.accountCode} style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0" }}>
                      <span>{a.accountName}</span>
                      <strong>{peso(a.amount)}</strong>
                    </div>
                  ))}
                  {bsData.assets?.nonCurrent?.map((a) => (
                    <div key={a.accountCode} style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0" }}>
                      <span>{a.accountName}</span>
                      <strong>{peso(a.amount)}</strong>
                    </div>
                  ))}
                  <div style={{ borderTop: "2px solid #3d230e", marginTop: "0.75rem", paddingTop: "0.75rem", display: "flex", justifyContent: "space-between", fontSize: "1.05rem", fontWeight: 800 }}>
                    <span>TOTAL ASSETS</span>
                    <span>{peso(bsData.totalAssets)}</span>
                  </div>
                  {bsData.liveInventoryValue != null && (
                    <div style={{
                      marginTop: "0.75rem",
                      padding: "0.5rem 0.75rem",
                      background: Math.abs(Number(bsData.inventoryValuationVariance || 0)) >= 0.01 ? "#fff8eb" : "#f8f4ef",
                      border: "1px solid #e8dfd5",
                      borderRadius: "8px",
                      fontSize: "0.78rem",
                      color: "#5a4029",
                    }}>
                      <div>Live Subledger Stock Value: <strong>{peso(bsData.liveInventoryValue)}</strong></div>
                      <div>GL Account 1050 Value: <strong>{peso(bsData.ledgerInventoryValue)}</strong></div>
                      <div>
                        Subledger Variance:{" "}
                        <strong style={{ color: Math.abs(Number(bsData.inventoryValuationVariance || 0)) >= 0.01 ? "#b7791f" : "#1e7047" }}>
                          {peso(bsData.inventoryValuationVariance)}
                        </strong>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* LIABILITIES & EQUITY */}
              <div style={{ border: "1px solid #e8dfd5", borderRadius: "10px", padding: "1.25rem" }}>
                <h4 style={{ margin: "0 0 1rem 0", color: "#3d230e", borderBottom: "2px solid #3d230e", paddingBottom: "0.5rem" }}>
                  LIABILITIES & OWNER EQUITY
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.86rem" }}>
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#8b5e3c", textTransform: "uppercase" }}>Current Liabilities</span>
                  {bsData.liabilities?.current?.map((l) => (
                    <div key={l.accountCode} style={{ display: "flex", justifyContent: "space-between", padding: "0.2rem 0" }}>
                      <span>{l.accountName}</span>
                      <strong>{peso(l.amount)}</strong>
                    </div>
                  ))}

                  <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#8b5e3c", textTransform: "uppercase", marginTop: "0.5rem" }}>Owner's Equity</span>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "0.2rem 0" }}>
                    <span>3010 Owner's Capital</span>
                    <strong>{peso(bsData.equity?.capital)}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "0.2rem 0", color: "#c53030" }}>
                    <span>Less: 3020 Owner Drawings</span>
                    <span>- {peso(bsData.equity?.drawings)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "0.2rem 0" }}>
                    <span>Retained Earnings (Operating Profit)</span>
                    <strong>{peso(bsData.equity?.retainedEarnings)}</strong>
                  </div>

                  <div style={{ borderTop: "2px solid #3d230e", marginTop: "0.75rem", paddingTop: "0.75rem", display: "flex", justifyContent: "space-between", fontSize: "1.05rem", fontWeight: 800 }}>
                    <span>TOTAL LIABILITIES & EQUITY</span>
                    <span>{peso(Number(bsData.totalLiabilities) + Number(bsData.totalEquity))}</span>
                  </div>

                  <div style={{ marginTop: "1rem", padding: "0.5rem 0.75rem", background: bsData.isBalanced ? "#eef8f2" : "#fdf2f2", color: bsData.isBalanced ? "#1e7047" : "#c53030", borderRadius: "8px", fontSize: "0.8rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <CheckCircle2 size={14} />
                    <span>
                      {bsData.isBalanced
                        ? "Fundamental Accounting Equation Satisfied: Assets === Liabilities + Equity"
                        : `Ledger imbalance detected (${peso(bsData.balanceDifference)}). Run reconciliation backfill.`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: JOURNAL AUDIT */}
        {!loading && activeTab === "journal" && (
          <>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Entry Number</th>
                    <th>Date & Time</th>
                    <th>Type</th>
                    <th>Memo / Description</th>
                    <th>Debit / Credit Lines</th>
                    <th>Total Amount</th>
                    <th>Created By</th>
                    <th>Audit Action</th>
                  </tr>
                </thead>
                <tbody>
                  {journalData.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: "center", color: "#8b5e3c", padding: "4rem 2rem" }}>
                        No double-entry journal transactions recorded yet.
                      </td>
                    </tr>
                  ) : (
                    journalData.map((e) => {
                      const isAlreadyReversed = Boolean(e.isAlreadyReversed) || journalData.some(
                        (item) => Number(item.reversesEntryId) === Number(e.id),
                      );
                      return (
                        <tr
                          key={e.id}
                          style={{
                            background: e.isReversal
                              ? "#fdf8f8"
                              : isAlreadyReversed
                                ? "#faf7f4"
                                : "transparent",
                            opacity: isAlreadyReversed ? 0.78 : 1,
                          }}
                        >
                          <td>
                            <strong>{e.entryNumber}</strong>
                            {e.isReversal && (
                              <span style={{ marginLeft: "6px", fontSize: "0.7rem", color: "#c53030", fontWeight: 700 }}>
                                [REVERSAL]
                              </span>
                            )}
                            {isAlreadyReversed && (
                              <span style={{ marginLeft: "6px", fontSize: "0.7rem", color: "#8b5e3c", fontWeight: 700 }}>
                                [VOIDED]
                              </span>
                            )}
                          </td>
                          <td style={{ fontSize: "0.8rem", color: "#6b5847" }}>{new Date(e.entryDate).toLocaleString()}</td>
                          <td><span style={{ fontSize: "0.78rem", background: "#f0e9df", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>{e.entryType}</span></td>
                          <td style={{ maxWidth: "240px", textDecoration: isAlreadyReversed ? "line-through" : "none" }}>{e.memo}</td>
                          <td>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.78rem" }}>
                              {e.lines?.map((l) => (
                                <div key={l.id}>
                                  {l.debit > 0 ? (
                                    <span style={{ color: isAlreadyReversed ? "#8b5e3c" : "#1e7047" }}>DR {l.accountCode} ({l.accountName}): {peso(l.debit)}</span>
                                  ) : (
                                    <span style={{ color: "#8b5e3c" }}>CR {l.accountCode} ({l.accountName}): {peso(l.credit)}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                          <td style={{ fontWeight: 700 }}>{peso(e.totalDebit)}</td>
                          <td style={{ fontSize: "0.8rem" }}>{e.creatorName || "System"}</td>
                          <td>
                            {!e.isReversal && !isAlreadyReversed && (
                              <button
                                type="button"
                                onClick={() => {
                                  setReverseTarget(e);
                                  setReverseReason("");
                                  setFormError(null);
                                }}
                                style={{ background: "#f7d2a5", border: "none", padding: "0.3rem 0.6rem", borderRadius: "6px", fontSize: "0.75rem", cursor: "pointer", fontWeight: 600, color: "#3d230e" }}
                              >
                                <RotateCcw size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: "3px" }} />
                                Reverse
                              </button>
                            )}
                            {isAlreadyReversed && (
                              <span style={{ fontSize: "0.72rem", color: "#8b5e3c", fontStyle: "italic", background: "#f0e9df", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>
                                Voided
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {journalMaxPage > 1 && (
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.8rem" }}>
                <button type="button" disabled={journalPage <= 1} onClick={() => setJournalPage((p) => Math.max(1, p - 1))} style={{ padding: "0.3rem 0.6rem", borderRadius: "6px", border: "1px solid #dfd3c5", background: "#fff", cursor: "pointer" }}>Previous</button>
                <span>Page {journalPage} of {journalMaxPage}</span>
                <button type="button" disabled={journalPage >= journalMaxPage} onClick={() => setJournalPage((p) => Math.min(journalMaxPage, p + 1))} style={{ padding: "0.3rem 0.6rem", borderRadius: "6px", border: "1px solid #dfd3c5", background: "#fff", cursor: "pointer" }}>Next</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* MANUAL JOURNAL ACTION MODAL */}
      {actionModal && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(35, 22, 12, 0.48)", display: "grid", placeItems: "center", zIndex: 1200, padding: "1rem" }}>
          <form onSubmit={handleActionSubmit} style={{ background: "#fff", borderRadius: "14px", padding: "1.4rem", width: "100%", maxWidth: "460px", boxShadow: "0 20px 50px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0, color: "#3d230e" }}>
                {actionModal === "opex" && "Record Operating Expense (OPEX)"}
                {actionModal === "drawing" && "Record Owner Drawing"}
                {actionModal === "capital" && "Record Capital Injection"}
                {actionModal === "transfer" && "Transfer Between Liquid Accounts"}
              </h4>
              <button type="button" onClick={() => setActionModal(null)} style={{ border: "none", background: "transparent", cursor: "pointer" }} aria-label="Close modal">
                <X size={18} />
              </button>
            </div>

            {formError && (
              <div style={{ padding: "0.6rem 0.8rem", background: "#fff5f5", color: "#c53030", borderRadius: "8px", fontSize: "0.82rem" }}>
                {formError}
              </div>
            )}

            {actionModal === "opex" && (
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.84rem" }}>
                Expense Account
                <select value={formExpenseCode} onChange={(e) => setFormExpenseCode(e.target.value)} style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid #dfd3c5" }}>
                  <option value="6010">6010 - Operating Expenses (General OPEX)</option>
                  <option value="6020">6020 - Utilities & Rent Expense</option>
                </select>
              </label>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.84rem" }}>
              {actionModal === "capital" ? "Deposit Into Account" : actionModal === "transfer" ? "Transfer From Account" : "Paid From Account"}
              <select value={formPrimaryAccount} onChange={(e) => setFormPrimaryAccount(e.target.value)} style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid #dfd3c5" }}>
                {LIQUID_ACCOUNT_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>{opt.label}</option>
                ))}
              </select>
            </label>

            {actionModal === "transfer" && (
              <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.84rem" }}>
                Transfer Into Account
                <select value={formSecondaryAccount} onChange={(e) => setFormSecondaryAccount(e.target.value)} style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid #dfd3c5" }}>
                  {LIQUID_ACCOUNT_OPTIONS.map((opt) => (
                    <option key={opt.code} value={opt.code}>{opt.label}</option>
                  ))}
                </select>
              </label>
            )}

            <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.84rem" }}>
              Amount (₱)
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={formAmount}
                onChange={(e) => setFormAmount(e.target.value)}
                placeholder="0.00"
                style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid #dfd3c5" }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.84rem" }}>
              Audit Memo
              <input
                type="text"
                required
                maxLength={255}
                value={formMemo}
                onChange={(e) => setFormMemo(e.target.value)}
                style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid #dfd3c5" }}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem", marginTop: "0.4rem" }}>
              <button type="button" onClick={() => setActionModal(null)} style={{ padding: "0.5rem 0.9rem", borderRadius: "8px", border: "1px solid #dfd3c5", background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
              <button type="submit" disabled={formSubmitting} style={{ padding: "0.5rem 1rem", borderRadius: "8px", border: "none", background: "#3d230e", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {formSubmitting ? "Posting..." : "Post Balanced Entry"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* REVERSAL REASON MODAL */}
      {reverseTarget && (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(35, 22, 12, 0.48)", display: "grid", placeItems: "center", zIndex: 1200, padding: "1rem" }}>
          <form onSubmit={handleConfirmReverse} style={{ background: "#fff", borderRadius: "14px", padding: "1.4rem", width: "100%", maxWidth: "440px", boxShadow: "0 20px 50px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0, color: "#3d230e" }}>Reverse Journal Entry {reverseTarget.entryNumber}</h4>
              <button type="button" onClick={() => setReverseTarget(null)} style={{ border: "none", background: "transparent", cursor: "pointer" }} aria-label="Close reversal modal">
                <X size={18} />
              </button>
            </div>
            {formError && (
              <div style={{ padding: "0.6rem 0.8rem", background: "#fff5f5", color: "#c53030", borderRadius: "8px", fontSize: "0.82rem" }}>
                {formError}
              </div>
            )}
            <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.84rem" }}>
              Audited Reversal Reason (min 3 characters)
              <textarea
                rows={3}
                required
                maxLength={255}
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="Explain why this entry is being reversed..."
                style={{ padding: "0.5rem", borderRadius: "8px", border: "1px solid #dfd3c5" }}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
              <button type="button" onClick={() => setReverseTarget(null)} style={{ padding: "0.5rem 0.9rem", borderRadius: "8px", border: "1px solid #dfd3c5", background: "#fff", cursor: "pointer" }}>
                Cancel
              </button>
              <button type="submit" disabled={formSubmitting} style={{ padding: "0.5rem 1rem", borderRadius: "8px", border: "none", background: "#c53030", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                {formSubmitting ? "Reversing..." : "Post Reversal"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
