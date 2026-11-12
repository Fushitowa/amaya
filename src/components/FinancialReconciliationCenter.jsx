import { useEffect, useState, useCallback } from "react";
import {
  Calendar,
  Scale,
  RotateCcw,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  BookOpen,
} from "lucide-react";
import { apiRequest } from "../utils/api.js";
import "../assets/css/admin/FinancialManagement.css";

function peso(val) {
  const num = Number(val || 0);
  return `₱${num.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FinancialReconciliationCenter() {
  const [activeTab, setActiveTab] = useState("recon"); // 'recon', 'pnl', 'balancesheet', 'journal'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Data states
  const [reconData, setReconData] = useState([]);
  const [pnlData, setPnlData] = useState(null);
  const [bsData, setBsData] = useState(null);
  const [journalData, setJournalData] = useState([]);

  const fetchJournalEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiRequest("/finances/journal-entries");
      setJournalData(res.items || []);
    } catch (err) {
      setError(err?.message || "Failed to load journal entries.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    if (activeTab === "recon") {
      apiRequest("/finances/reports/daily-reconciliation")
        .then((res) => {
          if (!active) return;
          setReconData(res.items || []);
        })
        .catch((err) => {
          if (!active) return;
          setError(err?.message || "Failed to load daily reconciliation ledger.");
        });
    } else if (activeTab === "pnl") {
      apiRequest("/finances/reports/profit-and-loss")
        .then((res) => {
          if (!active) return;
          setPnlData(res);
        })
        .catch((err) => {
          if (!active) return;
          setError(err?.message || "Failed to load P&L statement.");
        });
    } else if (activeTab === "balancesheet") {
      apiRequest("/finances/reports/balance-sheet")
        .then((res) => {
          if (!active) return;
          setBsData(res);
        })
        .catch((err) => {
          if (!active) return;
          setError(err?.message || "Failed to load Balance Sheet.");
        });
    } else if (activeTab === "journal") {
      apiRequest("/finances/journal-entries")
        .then((res) => {
          if (!active) return;
          setJournalData(res.items || []);
        })
        .catch((err) => {
          if (!active) return;
          setError(err?.message || "Failed to load journal entries.");
        });
    }

    return () => {
      active = false;
    };
  }, [activeTab]);

  const handleReverseEntry = async (entryId) => {
    const reason = window.prompt("Enter an audited reason for this transaction reversal:");
    if (!reason || !reason.trim()) return;

    try {
      setLoading(true);
      await apiRequest(`/finances/journal-entries/${entryId}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      alert("Traceable reversal posted successfully! Ledger is balanced.");
      fetchJournalEntries();
    } catch (err) {
      alert(`Reversal failed: ${err?.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="financial-center-panel" aria-label="Financial Management & Asset Reconciliation Center">
      <div className="financial-center-header">
        <div className="financial-center-title">
          <h3>
            <Scale size={20} />
            Double-Entry Financial Management & Asset Reconciliation
          </h3>
          <p>Full audit trail of store assets, operating profit, balance sheet equilibrium, and shift reconciliations</p>
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
        {loading && <div style={{ padding: "1.5rem", textAlign: "center", color: "#8b5e3c" }}>Loading financial records...</div>}

        {error && (
          <div style={{ padding: "1rem", color: "#c53030", background: "#fff5f5", borderRadius: "8px", marginBottom: "1rem" }}>
            <AlertCircle size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
            {error}
          </div>
        )}

        {/* TAB 1: DAILY ASSET RECONCILIATION */}
        {!loading && activeTab === "recon" && (
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
                    <td colSpan={10} style={{ textAlign: "center", color: "#8b5e3c", padding: "2rem" }}>
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
                        {row.netAssetDelta != null ? `${(row.netAssetDelta >= 0 ? "+" : "")}${peso(row.netAssetDelta)}` : "—"}
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
                <span>- {peso(pnlData.totalOperatingExpenses)}</span>
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

        {/* TAB 3: BALANCE SHEET */}
        {!loading && activeTab === "balancesheet" && bsData && (
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
                  <span>{bsData.isBalanced ? "Fundamental Accounting Equation Satisfied: Assets === Liabilities + Equity" : "Imbalance detected in ledger!"}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: JOURNAL AUDIT */}
        {!loading && activeTab === "journal" && (
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
                    <td colSpan={8} style={{ textAlign: "center", color: "#8b5e3c", padding: "2rem" }}>
                      No double-entry journal transactions recorded yet.
                    </td>
                  </tr>
                ) : (
                  journalData.map((e) => (
                    <tr key={e.id} style={{ background: e.isReversal ? "#fdf8f8" : "transparent" }}>
                      <td>
                        <strong>{e.entryNumber}</strong>
                        {e.isReversal && <span style={{ marginLeft: "6px", fontSize: "0.7rem", color: "#c53030", fontWeight: 700 }}>[REVERSAL]</span>}
                      </td>
                      <td style={{ fontSize: "0.8rem", color: "#6b5847" }}>{new Date(e.entryDate).toLocaleString()}</td>
                      <td><span style={{ fontSize: "0.78rem", background: "#f0e9df", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>{e.entryType}</span></td>
                      <td style={{ maxWidth: "240px" }}>{e.memo}</td>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.78rem" }}>
                          {e.lines?.map((l) => (
                            <div key={l.id}>
                              {l.debit > 0 ? (
                                <span style={{ color: "#1e7047" }}>DR {l.accountCode} ({l.accountName}): {peso(l.debit)}</span>
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
                        {!e.isReversal && (
                          <button
                            type="button"
                            onClick={() => handleReverseEntry(e.id)}
                            style={{ background: "#f7d2a5", border: "none", padding: "0.3rem 0.6rem", borderRadius: "6px", fontSize: "0.75rem", cursor: "pointer", fontWeight: 600, color: "#3d230e" }}
                          >
                            <RotateCcw size={11} style={{ display: "inline", verticalAlign: "middle", marginRight: "3px" }} />
                            Reverse
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
