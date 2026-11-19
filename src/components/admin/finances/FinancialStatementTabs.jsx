import { CheckCircle2, RotateCcw } from "lucide-react";
import { formatManilaDateTime } from "../../../../shared/manilaDate.js";

export function CashFlowTabView({ cfData, peso }) {
  if (!cfData) return null;
  return (
    <div className="fin-statement-stack">
      <div className="fin-statement-card">
        <h4 className="fin-statement-card-title">Operating Activities (Liquid Accounts 1010–1040)</h4>
        <div className="fin-statement-line">
          <span>Cash / Wallet Sales Inflows</span>
          <strong>{peso(cfData.operatingActivities?.cashSalesInflow)}</strong>
        </div>
        {Number(cfData.operatingActivities?.otherOperatingCashNet || 0) !== 0 && (
          <div className="fin-statement-line">
            <span>Adjustments &amp; Other Operating Cash (Net)</span>
            <strong>{peso(cfData.operatingActivities?.otherOperatingCashNet)}</strong>
          </div>
        )}
        <div className="fin-statement-line is-negative">
          <span>Less: Cash Inventory Restocks Paid</span>
          <span>- {peso(cfData.operatingActivities?.restockCashOutflow)}</span>
        </div>
        <div className="fin-statement-line is-negative">
          <span>Less: Operating Expenses (OPEX) Paid</span>
          <span>- {peso(cfData.operatingActivities?.opexCashOutflow)}</span>
        </div>
        <div className="fin-statement-line is-negative">
          <span>Less: Business Income Tax Paid</span>
          <span>- {peso(cfData.operatingActivities?.taxCashOutflow)}</span>
        </div>
        <div className="fin-statement-card-total">
          <span>Net Operating Cash Flow</span>
          <span>{peso(cfData.operatingActivities?.netOperatingCashFlow)}</span>
        </div>
      </div>

      <div className="fin-statement-card">
        <h4 className="fin-statement-card-title">Investing Activities</h4>
        <div className="fin-statement-line is-negative">
          <span>Cash Equipment &amp; Fixtures Purchases</span>
          <span>- {peso(cfData.investingActivities?.equipmentPurchased)}</span>
        </div>
        <div className="fin-statement-card-total">
          <span>Net Investing Cash Flow</span>
          <span>{peso(cfData.investingActivities?.netInvestingCashFlow)}</span>
        </div>
      </div>

      <div className="fin-statement-card">
        <h4 className="fin-statement-card-title">Financing Activities</h4>
        <div className="fin-statement-line is-positive">
          <span>Owner Opening &amp; Capital Injections</span>
          <span>+ {peso(cfData.financingActivities?.capitalInjected)}</span>
        </div>
        <div className="fin-statement-line is-negative">
          <span>Less: Owner Drawings / Withdrawals</span>
          <span>- {peso(cfData.financingActivities?.drawingsWithdrawn)}</span>
        </div>
        <div className="fin-statement-card-total">
          <span>Net Financing Cash Flow</span>
          <span>{peso(cfData.financingActivities?.netFinancingCashFlow)}</span>
        </div>
      </div>

      <div className="fin-summary-hero">
        <span>Net Change in Cash &amp; Liquid Balances</span>
        <span style={{ color: Number(cfData.netCashFlow || 0) >= 0 ? "#92e0be" : "#fca5a5" }}>
          {peso(cfData.netCashFlow)}
        </span>
      </div>
    </div>
  );
}

export function BalanceSheetTabView({ bsData, peso, openActionModal, netIncomeUnlocked = false, onRequestNetIncome }) {
  if (!bsData) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {bsData.asOfDate && (
        <div className="fin-bs-meta">
          As of <strong>{bsData.asOfDate}</strong> (Asia/Manila)
        </div>
      )}
      <div className="fin-bs-grid">
        <div className="fin-bs-card">
          <h4>ASSETS</h4>
          <span className="fin-bs-section-label">Current Assets</span>
          {bsData.assets?.current?.map((a) => (
            <div key={a.accountCode} className="fin-statement-line">
              <span>{a.accountCode} - {a.accountName}</span>
              <strong>{peso(a.amount)}</strong>
            </div>
          ))}
          <span className="fin-bs-section-label">Non-Current Assets</span>
          {bsData.assets?.nonCurrent?.map((a) => (
            <div
              key={a.accountCode}
              className={`fin-statement-line ${a.isContra ? "fin-bs-contra-line" : ""}`}
            >
              <span>{a.accountCode} - {a.accountName}</span>
              <strong>{a.isContra ? `(${peso(a.amount)})` : peso(a.amount)}</strong>
            </div>
          ))}
          <div className="fin-bs-net-equip-row">
            <span>Net Equipment (Book Value)</span>
            <span>{peso(bsData.assets?.netEquipment ?? bsData.netEquipment)}</span>
          </div>
          <div className="fin-bs-total-row">
            <span>TOTAL ASSETS</span>
            <span>{peso(bsData.totalAssets)}</span>
          </div>
          {bsData.liveInventoryValue != null && (
            <div
              className="fin-subledger-box"
              style={{ background: Math.abs(Number(bsData.inventoryValuationVariance || 0)) >= 0.01 ? "#fff8eb" : "#f8f4ef" }}
            >
              <div>Live Subledger Stock Value: <strong>{peso(bsData.liveInventoryValue)}</strong></div>
              <div>GL Account 1050 Value: <strong>{peso(bsData.ledgerInventoryValue)}</strong></div>
              <div>
                Subledger Variance:{" "}
                <strong style={{ color: Math.abs(Number(bsData.inventoryValuationVariance || 0)) >= 0.01 ? "#92400e" : "#1e7047" }}>
                  {peso(bsData.inventoryValuationVariance)}
                </strong>
              </div>
            </div>
          )}
        </div>

        <div className="fin-bs-card">
          <h4>LIABILITIES &amp; OWNER EQUITY</h4>
          <span className="fin-bs-section-label">Current Liabilities</span>
          {bsData.liabilities?.current?.map((l) => (
            <div key={l.accountCode} className="fin-bs-liab-row">
              <div className="fin-bs-liab-main">
                <span>
                  {l.accountCode === "2020"
                    ? "2020 - Sales Tax / VAT Payable (Collected on Orders)"
                    : `${l.accountCode} - ${l.accountName}`}
                </span>
                <strong>{peso(l.amount)}</strong>
              </div>
              {l.accountCode === "2010" && Number(l.amount) > 0 && (
                <div>
                  <button
                    type="button"
                    className="fin-inline-cta"
                    onClick={() => openActionModal("settle", { liabilityCode: "2010" })}
                  >
                    Settle Bill&hellip;
                  </button>
                </div>
              )}
              {l.accountCode === "2030" && Number(l.amount) > 0 && (
                <div>
                  <button
                    type="button"
                    className="fin-inline-cta"
                    onClick={() => openActionModal("settle", { liabilityCode: "2030" })}
                  >
                    Pay Tax&hellip;
                  </button>
                </div>
              )}
            </div>
          ))}

          <span className="fin-bs-section-label">Owner&apos;s Equity</span>
          <div className="fin-statement-line">
            <span>3010 Owner&apos;s Capital</span>
            <strong>{peso(bsData.equity?.capital)}</strong>
          </div>
          <div className="fin-statement-line is-negative">
            <span>Less: 3020 Owner Drawings</span>
            <span>- {peso(bsData.equity?.drawings)}</span>
          </div>
          <div className="fin-statement-line">
            <span>Store Earnings</span>
            <strong>{netIncomeUnlocked && bsData.equity?.retainedEarnings != null ? peso(bsData.equity.retainedEarnings) : "₱••••••"}</strong>
          </div>
          <button type="button" className="net-income-gate-button" onClick={onRequestNetIncome}>
            {netIncomeUnlocked ? "🔒 Lock / Hide Net Income" : "🔒 View Net Income"}
          </button>

          <div className="fin-bs-total-row">
            <span>TOTAL LIABILITIES &amp; EQUITY</span>
            <span>{peso(Number(bsData.totalLiabilities) + Number(bsData.totalEquity))}</span>
          </div>

          <div className={`fin-bs-status-pill ${bsData.isBalanced ? "is-balanced" : "is-imbalanced"}`}>
            <CheckCircle2 size={14} aria-hidden="true" />
            <span>
              {bsData.isBalanced
                ? "Fundamental Accounting Equation Satisfied: Assets === Liabilities + Equity"
                : `Ledger imbalance detected (${peso(bsData.balanceDifference)}). Run reconciliation backfill.`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function JournalAuditTabView({
  journalData,
  journalPage,
  journalMaxPage,
  setJournalPage,
  peso,
  onSelectReverse,
}) {
  return (
    <>
      <div className="fin-table-wrap">
        <table className="fin-table">
          <thead>
            <tr>
              <th>Entry Number</th>
              <th>Date &amp; Time</th>
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
                    <td style={{ fontSize: "0.8rem", color: "#6b5847" }}>{formatManilaDateTime(e.entryDate)}</td>
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
                          onClick={() => onSelectReverse(e)}
                          style={{ background: "#f7d2a5", border: "1px solid #8b5e3c", padding: "0.35rem 0.65rem", borderRadius: "6px", fontSize: "0.75rem", cursor: "pointer", fontWeight: 600, color: "#3d230e", minHeight: "32px" }}
                        >
                          <RotateCcw size={11} aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: "3px" }} />
                          Reverse
                        </button>
                      )}
                      {isAlreadyReversed && (
                        <span style={{ fontSize: "0.72rem", color: "#6b5847", fontStyle: "italic", background: "#f0e9df", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>
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
        <div className="fin-pagination">
          <button type="button" disabled={journalPage <= 1} onClick={() => setJournalPage((p) => Math.max(1, p - 1))}>Previous</button>
          <span>Page {journalPage} of {journalMaxPage}</span>
          <button type="button" disabled={journalPage >= journalMaxPage} onClick={() => setJournalPage((p) => Math.min(journalMaxPage, p + 1))}>Next</button>
        </div>
      )}
    </>
  );
}
