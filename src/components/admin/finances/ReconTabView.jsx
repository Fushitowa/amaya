import { Lock } from "lucide-react";
import { peso, lockedPeso, describeVariance } from "../../../utils/financeFormat.js";
import { FIN_RECON_COLUMNS, drawerVarianceStatus } from "../../../config/financeLabels.js";
import DrawerHistoryPanel from "./DrawerHistoryPanel.jsx";

/** Daily Cash & Stock Check: one row per business day, plus drawer history by cashier and weekday. */
export default function ReconTabView({ reconData, reconPage, reconMaxPage, setReconPage, netIncomePin, thresholds, onThresholdsSaved, fromDate, toDate }) {
  return (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: ".5rem", marginBottom: ".6rem" }}>
              <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.unlocked ? netIncomePin.lock() : netIncomePin.setModalOpen(true)}>
                <Lock size={14} aria-hidden="true" /> {netIncomePin.unlocked ? "Hide Net Income" : "View Net Income"}
              </button>
              {netIncomePin.unlocked && <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.setModalOpen(true)}>Change PIN</button>}
            </div>
            <div className="fin-table-wrap">
              <table className="fin-table">
                <thead>
                  <tr>
                    {FIN_RECON_COLUMNS.map((col) => (
                      <th key={col.label} title={col.term}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reconData.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: "center", color: "#8b5e3c", padding: "4rem 2rem" }}>
                        Nothing recorded yet. Open a cashier shift and today&apos;s opening cash and stock value will be saved here.
                      </td>
                    </tr>
                  ) : (
                    reconData.map((row) => (
                      <tr key={row.id}>
                        <td><strong>{row.businessDate}</strong></td>
                        <td>
                          <span className={row.status === "open" ? "status-badge-open" : "status-badge-closed"}>
                            {row.status === "open" ? "Open" : "Closed"}
                          </span>
                        </td>
                        <td>{peso(row.openingTotalAssets)}</td>
                        <td>{row.closingTotalAssets != null ? peso(row.closingTotalAssets) : "Shift still open"}</td>
                        <td style={{ fontWeight: 700, color: row.netAssetDelta == null ? "#5a4029" : Number(row.netAssetDelta) >= 0 ? "#1e7047" : "#c53030" }}>
                          {row.netAssetDelta != null ? `${Number(row.netAssetDelta) >= 0 ? "+" : "-"}${peso(Math.abs(Number(row.netAssetDelta)))}` : "—"}
                        </td>
                        <td>{peso(row.grossSales)}</td>
                        <td>{lockedPeso(row.cogsConsumed)}</td>
                        <td style={{ fontWeight: 600 }}>{netIncomePin.unlocked && row.netOperatingProfit != null ? peso(row.netOperatingProfit) : "₱••••••"}</td>
                        <td style={{ color: Number(row.drawerVariance || 0) === 0 ? "#5a4029" : (Number(row.drawerVariance) < 0 ? "#c53030" : "#1e7047") }}>
                          {describeVariance(row.drawerVariance)}
                          {row.status !== "open" && drawerVarianceStatus(row.drawerVariance, thresholds) && (
                            <small style={{ display: "block", fontWeight: 600 }}>{drawerVarianceStatus(row.drawerVariance, thresholds).label}</small>
                          )}
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
              <div className="fin-pagination">
                <button type="button" disabled={reconPage <= 1} onClick={() => setReconPage((p) => Math.max(1, p - 1))}>Previous</button>
                <span>Page {reconPage} of {reconMaxPage}</span>
                <button type="button" disabled={reconPage >= reconMaxPage} onClick={() => setReconPage((p) => Math.min(reconMaxPage, p + 1))}>Next</button>
              </div>
            )}
            <DrawerHistoryPanel
              thresholds={thresholds}
              onThresholdsSaved={onThresholdsSaved}
              financialHeaders={netIncomePin.financialHeaders}
              unlocked={netIncomePin.unlocked}
              onRequestPin={() => netIncomePin.setModalOpen(true)}
              fromDate={fromDate}
              toDate={toDate}
            />
          </>
  );
}
