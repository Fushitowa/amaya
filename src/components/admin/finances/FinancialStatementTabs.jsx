import { CheckCircle2, AlertCircle, Lock, RotateCcw } from "lucide-react";
import { entryTypeLabel } from "../../../config/financeLabels.js";
import { formatManilaDateTime } from "../../../../shared/manilaDate.js";

export function CashFlowTabView({ cfData, peso }) {
  if (!cfData) return null;
  return (
    <div className="fin-statement-stack">
      <div className="fin-statement-card">
        <h4 className="fin-statement-card-title">Day-to-Day Business (cash, GCash, bank)</h4>
        <div className="fin-statement-line">
          <span>Sales Received (cash &amp; wallets)</span>
          <strong>{peso(cfData.operatingActivities?.cashSalesInflow)}</strong>
        </div>
        {Number(cfData.operatingActivities?.otherOperatingCashNet || 0) !== 0 && (
          <div className="fin-statement-line">
            <span>Other Cash In / Out (net)</span>
            <strong>{peso(cfData.operatingActivities?.otherOperatingCashNet)}</strong>
          </div>
        )}
        <div className="fin-statement-line is-negative">
          <span>Less: Stock Bought with Cash</span>
          <span>- {peso(cfData.operatingActivities?.restockCashOutflow)}</span>
        </div>
        <div className="fin-statement-line is-negative">
          <span>Less: Expenses Paid</span>
          <span>- {peso(cfData.operatingActivities?.opexCashOutflow)}</span>
        </div>
        {cfData.operatingActivities?.payrollCashOutflow !== undefined && (
          <div className="fin-statement-line" style={{ fontSize: "0.8rem", color: "#6b5847", paddingLeft: "1.1rem" }}>
            <span>of which: Staff pay &amp; 13th month</span>
            <span>{cfData.operatingActivities.payrollCashOutflow == null ? "₱•••••• (enter the Net Income PIN)" : peso(cfData.operatingActivities.payrollCashOutflow)}</span>
          </div>
        )}
        <div className="fin-statement-line is-negative">
          <span>Less: Income Tax Paid</span>
          <span>- {peso(cfData.operatingActivities?.taxCashOutflow)}</span>
        </div>
        <div className="fin-statement-card-total">
          <span>Cash from Daily Business</span>
          <span>{peso(cfData.operatingActivities?.netOperatingCashFlow)}</span>
        </div>
      </div>

      <div className="fin-statement-card">
        <h4 className="fin-statement-card-title">Equipment &amp; Fixtures</h4>
        <div className="fin-statement-line is-negative">
          <span>Equipment &amp; Fixtures Bought with Cash</span>
          <span>- {peso(cfData.investingActivities?.equipmentPurchased)}</span>
        </div>
        <div className="fin-statement-card-total">
          <span>Cash Spent on Equipment</span>
          <span>{peso(cfData.investingActivities?.netInvestingCashFlow)}</span>
        </div>
      </div>

      <div className="fin-statement-card">
        <h4 className="fin-statement-card-title">Owner&apos;s Money</h4>
        <div className="fin-statement-line is-positive">
          <span>Owner Put In (opening &amp; added money)</span>
          <span>+ {peso(cfData.financingActivities?.capitalInjected)}</span>
        </div>
        <div className="fin-statement-line is-negative">
          <span>Less: Owner Withdrawals</span>
          <span>- {peso(cfData.financingActivities?.drawingsWithdrawn)}</span>
        </div>
        <div className="fin-statement-card-total">
          <span>Net Owner&apos;s Money</span>
          <span>{peso(cfData.financingActivities?.netFinancingCashFlow)}</span>
        </div>
      </div>

      <div className="fin-summary-hero">
        <span>Total Change in Cash &amp; Bank Balances</span>
        <span style={{ color: Number(cfData.netCashFlow || 0) >= 0 ? "#92e0be" : "#fca5a5" }}>
          {peso(cfData.netCashFlow)}
        </span>
      </div>
    </div>
  );
}

export function BalanceSheetTabView({ bsData, peso, showCodes = false, openActionModal, netIncomeUnlocked = false, onRequestNetIncome }) {
  if (!bsData) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {bsData.asOfDate && (
        <div className="fin-bs-meta">
          As of <strong>{bsData.asOfDate}</strong> (Asia/Manila){bsData.isHistoric ? " · end of that day, from the ledger. The live stock-count check is only available for today." : ""}
        </div>
      )}
      <div className="fin-bs-grid">
        <div className="fin-bs-card">
          <h4 title="Assets">WHAT WE OWN</h4>
          <span className="fin-bs-section-label" title="Current assets">Cash &amp; Short-Term</span>
          {bsData.assets?.current?.map((a) => (
            <div key={a.accountCode} className="fin-statement-line">
              <span>{showCodes ? `${a.accountCode} - ` : ""}{a.accountName}</span>
              <strong>{peso(a.amount)}</strong>
            </div>
          ))}
          <span className="fin-bs-section-label" title="Non-current assets">Equipment &amp; Long-Term</span>
          {bsData.assets?.nonCurrent?.map((a) => (
            <div
              key={a.accountCode}
              className={`fin-statement-line ${a.isContra ? "fin-bs-contra-line" : ""}`}
            >
              <span>{showCodes ? `${a.accountCode} - ` : ""}{a.accountName}</span>
              <strong>{a.isContra ? `(${peso(a.amount)})` : peso(a.amount)}</strong>
            </div>
          ))}
          <div className="fin-bs-net-equip-row">
            <span title="Net book value">Equipment Value After Wear &amp; Tear</span>
            <span>{peso(bsData.assets?.netEquipment ?? bsData.netEquipment)}</span>
          </div>
          <div className="fin-bs-total-row">
            <span>TOTAL WE OWN</span>
            <span>{peso(bsData.totalAssets)}</span>
          </div>
          {bsData.liveInventoryValue != null && (
            <div
              className="fin-subledger-box"
              style={{ background: Math.abs(Number(bsData.inventoryValuationVariance || 0)) >= 0.01 ? "#fff8eb" : "#f8f4ef" }}
            >
              <div>Stock value from the Inventory page: <strong>{peso(bsData.liveInventoryValue)}</strong></div>
              <div>Stock value in the books: <strong>{peso(bsData.ledgerInventoryValue)}</strong></div>
              <div>
                Difference:{" "}
                <strong style={{ color: Math.abs(Number(bsData.inventoryValuationVariance || 0)) >= 0.01 ? "#92400e" : "#1e7047" }}>
                  {peso(bsData.inventoryValuationVariance)}
                </strong>
              </div>
            </div>
          )}
        </div>

        <div className="fin-bs-card">
          <h4 title="Liabilities and owner equity">WHAT WE OWE &amp; OWNER&apos;S SHARE</h4>
          <span className="fin-bs-section-label" title="Current liabilities">What We Owe Soon</span>
          {bsData.liabilities?.current?.map((l) => (
            <div key={l.accountCode} className="fin-bs-liab-row">
              <div className="fin-bs-liab-main">
                <span>
                  {l.accountCode === "2020"
                    ? `${showCodes ? "2020 - " : ""}VAT Collected (to be paid to the government)`
                    : `${showCodes ? `${l.accountCode} - ` : ""}${l.accountName}`}
                </span>
                <strong>{peso(l.amount)}</strong>
              </div>
              {!bsData.isHistoric && l.accountCode === "2010" && Number(l.amount) > 0 && (
                <div>
                  <button
                    type="button"
                    className="fin-inline-cta"
                    onClick={() => openActionModal("settle", { liabilityCode: "2010" })}
                  >
                    Pay Bill&hellip;
                  </button>
                </div>
              )}
              {!bsData.isHistoric && l.accountCode === "2030" && Number(l.amount) > 0 && (
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

          <span className="fin-bs-section-label" title="Owner's equity">Owner&apos;s Share</span>
          <div className="fin-statement-line">
            <span>{showCodes ? "3010 " : ""}Owner&apos;s Money Put In</span>
            <strong>{bsData.equity?.capital == null ? "₱••••••" : peso(bsData.equity.capital)}</strong>
          </div>
          <div className="fin-statement-line is-negative">
            <span>Less: {showCodes ? "3020 " : ""}Owner Withdrawals</span>
            <span>- {bsData.equity?.drawings == null ? "₱••••••" : peso(bsData.equity.drawings)}</span>
          </div>
          <div className="fin-statement-line">
            <span title="Retained earnings">Store Earnings Kept</span>
            <strong>{netIncomeUnlocked && bsData.equity?.retainedEarnings != null ? peso(bsData.equity.retainedEarnings) : "₱••••••"}</strong>
          </div>
          <button type="button" className="net-income-gate-button" onClick={onRequestNetIncome}>
            <Lock size={14} aria-hidden="true" /> {netIncomeUnlocked ? "Hide Net Income" : "View Net Income"}
          </button>

          <div className="fin-bs-total-row">
            <span>TOTAL WE OWE &amp; OWNER&apos;S SHARE</span>
            <span>{bsData.totalEquity == null ? "₱••••••" : peso(Number(bsData.totalLiabilities) + Number(bsData.totalEquity))}</span>
          </div>

          <div className={`fin-bs-status-pill ${bsData.isBalanced ? "is-balanced" : "is-imbalanced"}`}>
            {bsData.isBalanced ? <CheckCircle2 size={14} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
            <span title="Assets = Liabilities + Equity">
              {bsData.isBalanced
                ? "The books are balanced: what we own equals what we owe plus the owner's share."
                : `The books are off by ${peso(Math.abs(bsData.balanceDifference))}. Please tell your developer or accountant.`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function JournalAuditTabView({
  journalData,
  showCodes = false,
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
              <th>Reference</th>
              <th>Date &amp; Time</th>
              <th>What It Was</th>
              <th>Description</th>
              <th title="Debit / credit lines">Where the Money Went</th>
              <th>Amount</th>
              <th>Recorded By</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {journalData.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "#8b5e3c", padding: "4rem 2rem" }}>
                  No transactions recorded yet.
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
                          Cancellation
                        </span>
                      )}
                      {isAlreadyReversed && (
                        <span style={{ marginLeft: "6px", fontSize: "0.7rem", color: "#8b5e3c", fontWeight: 700 }}>
                          Cancelled
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: "0.8rem", color: "#6b5847" }}>{formatManilaDateTime(e.entryDate)}</td>
                    <td><span style={{ fontSize: "0.78rem", background: "#f0e9df", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>{entryTypeLabel(e.entryType)}</span></td>
                    <td style={{ maxWidth: "240px", textDecoration: isAlreadyReversed ? "line-through" : "none" }}>{e.memo}</td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.78rem" }}>
                        {e.lines?.map((l) => (
                          <div key={l.id}>
                            {e.amountsLocked ? (
                              <span style={{ color: "#8b5e3c" }}>{showCodes ? `${l.accountCode} ` : ""}{l.accountName}: ₱••••••</span>
                            ) : l.debit > 0 ? (
                              <span style={{ color: isAlreadyReversed ? "#8b5e3c" : "#1e7047" }}>Goes to {showCodes ? `${l.accountCode} ` : ""}{l.accountName}: {peso(l.debit)}</span>
                            ) : (
                              <span style={{ color: "#8b5e3c" }}>Comes from {showCodes ? `${l.accountCode} ` : ""}{l.accountName}: {peso(l.credit)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontWeight: 700 }}>{e.amountsLocked ? "₱••••••" : peso(e.totalDebit)}</td>
                    <td style={{ fontSize: "0.8rem" }}>{e.creatorName || "System"}</td>
                    <td>
                      {!e.isReversal && !isAlreadyReversed && (
                        <button
                          type="button"
                          onClick={() => onSelectReverse(e)}
                          style={{ background: "#f7d2a5", border: "1px solid #8b5e3c", padding: "0.35rem 0.65rem", borderRadius: "6px", fontSize: "0.75rem", cursor: "pointer", fontWeight: 600, color: "#3d230e", minHeight: "32px" }}
                        >
                          <RotateCcw size={11} aria-hidden="true" style={{ display: "inline", verticalAlign: "middle", marginRight: "3px" }} />
                          Cancel
                        </button>
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
