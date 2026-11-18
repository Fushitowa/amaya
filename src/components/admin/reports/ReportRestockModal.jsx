import { formatManilaDate } from "../../../../shared/manilaDate.js";

const LOOKBACK_OPTIONS = [7, 14, 30];
const COVER_OPTIONS = [3, 7, 14];

function formatPeso(value) {
  const num = Number(value || 0);
  return `₱${num.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatQty(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function getAllocationBadgeLabel(status) {
  if (status === "full") return "Funded";
  if (status === "partial") return "Partial";
  if (status === "skipped_budget") return "Skipped";
  if (status === "uncosted") return "No cost";
  if (status === "no_need") return "No refill";
  return "";
}

export function ReportRestockModal({
  isOpen,
  restockClosing,
  restockDialogRef,
  closeRestockModal,
  lowThreshold,
  restockItems,
  restockSummary,
  budgetAllocation,
  lookbackDays = 14,
  onLookbackDaysChange,
  coverDays = 7,
  onCoverDaysChange,
  budgetValue = "",
  onBudgetChange,
  packMode = false,
  hasPackItems = false,
  onTogglePackMode,
  smartLoading = false,
  smartError = "",
  restockNotice,
  handleCopyRestockList,
}) {
  if (!isOpen) return null;

  const hasBudget = budgetAllocation?.budgetProvided != null;
  const totalEstimatedCost = Number(restockSummary?.totalEstimatedCost || 0);
  const uncostedCount = Number(restockSummary?.uncostedItemsCount || 0);

  return (
    <div
      className={`restock-modal-backdrop ${restockClosing ? "is-closing" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRestockModal();
      }}
    >
      <section
        ref={restockDialogRef}
        tabIndex={-1}
        className="restock-modal restock-notebook"
        role="dialog"
        aria-modal="true"
        aria-labelledby="restock-modal-title"
        aria-describedby="restock-modal-description"
      >
        <div className="restock-notebook-spine" aria-hidden="true">
          {Array.from({ length: 11 }).map((_, idx) => (
            <span key={idx} className="notebook-ring-pair">
              <i className="notebook-ring-hole" />
              <b className="notebook-ring-wire" />
            </span>
          ))}
        </div>

        <div className="restock-notebook-ribbon" aria-hidden="true" />

        <div className="restock-notebook-page">
          <header className="restock-modal-header">
            <div className="restock-notebook-title-block">
              <div className="restock-notebook-meta-row">
                <span className="admin-report-eyebrow">INVENTORY REQUISITION NOTEBOOK</span>
                <span className="restock-notebook-date">
                  {formatManilaDate(new Date())}
                </span>
              </div>
              <h2 id="restock-modal-title">Smart Restock &amp; Purchase Planner</h2>
              <p id="restock-modal-description">
                Prioritized by stockout risk, sales velocity over the last {lookbackDays} days, and {coverDays}-day target cover (or {lowThreshold}% low-stock fallback).
              </p>
            </div>
            <button
              type="button"
              className="restock-modal-close"
              onClick={closeRestockModal}
              aria-label="Close restock notebook"
            >
              ×
            </button>
          </header>

          <div className="restock-smart-controls">
            <div className="restock-control-group">
              <span className="restock-control-label">Sales Window</span>
              <div className="restock-pill-row" role="group" aria-label="Sales window">
                {LOOKBACK_OPTIONS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={`restock-pill-btn ${lookbackDays === days ? "is-active" : ""}`}
                    onClick={() => onLookbackDaysChange?.(days)}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>

            <div className="restock-control-group">
              <span className="restock-control-label">Cover Target</span>
              <div className="restock-pill-row" role="group" aria-label="Cover target">
                {COVER_OPTIONS.map((days) => (
                  <button
                    key={days}
                    type="button"
                    className={`restock-pill-btn ${coverDays === days ? "is-active" : ""}`}
                    onClick={() => onCoverDaysChange?.(days)}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>

            <div className="restock-control-group restock-budget-group">
              <label htmlFor="restock-budget-input" className="restock-control-label">
                Budget Today (₱)
              </label>
              <div className="restock-budget-input-wrap">
                <span className="restock-budget-prefix" aria-hidden="true">₱</span>
                <input
                  id="restock-budget-input"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  className="restock-budget-input"
                  placeholder="No limit"
                  value={budgetValue}
                  onChange={(e) => onBudgetChange?.(e.target.value)}
                />
                {String(budgetValue).trim() !== "" && (
                  <button
                    type="button"
                    className="restock-budget-clear"
                    onClick={() => onBudgetChange?.("")}
                    aria-label="Clear budget"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {hasPackItems && (
              <div className="restock-control-group">
                <span className="restock-control-label">Purchase Mode</span>
                <button
                  type="button"
                  className={`restock-pack-toggle ${packMode ? "is-active" : ""}`}
                  aria-pressed={packMode}
                  onClick={onTogglePackMode}
                >
                  {packMode ? "✓ Buy in Full Packs" : "Buy in Full Packs"}
                </button>
              </div>
            )}
          </div>

          {smartError ? (
            <div className="restock-fallback-banner" role="status">
              <span aria-hidden="true">!</span>
              <span>Smart forecast unavailable — showing static low-stock refills.</span>
            </div>
          ) : null}

          <div className="restock-modal-summary">
            <div className="restock-summary-badge">
              <strong>{restockItems.length}</strong>
              <span>
                {restockItems.length === 1 ? "line item needs" : "line items need"} restocking
              </span>
              {smartLoading && <em className="restock-loading-pill">Updating forecast…</em>}
            </div>
            <div className="restock-summary-legend">
              <span className="legend-chip critical">
                <i /> Out / Critical
              </span>
              <span className="legend-chip low">
                <i /> Low (≤{lowThreshold}%)
              </span>
              <span className="legend-chip velocity">
                <i /> Fast Moving (&lt;{coverDays}d)
              </span>
            </div>
          </div>

          {restockItems.length ? (
            <div className="restock-notebook-body">
              <div className="restock-notebook-col-head" aria-hidden="true">
                <span># / Ingredient &amp; Signals</span>
                <span>Status</span>
                <span>Stock &amp; Burn</span>
                <span>Suggested Buy</span>
                <span>Est. Cost</span>
              </div>

              <ol className="restock-notebook-list">
                {restockItems.map((item, idx) => {
                  const isPackActive = packMode
                    && Number(item.contentsPerPackage) > 1
                    && item.packEstimatedCost != null
                    && Number(item.recommendedPacks) > 0;
                  const targetQty = item.targetQty ?? (isPackActive ? item.packTotalQty : item.suggestedBuyQty);
                  const targetCost = isPackActive ? item.packEstimatedCost : item.estimatedCost;
                  const displayQty = hasBudget ? item.allocatedQty : targetQty;
                  const displayCost = hasBudget ? item.allocatedCost : targetCost;
                  const statusTone = item.urgencyTier === "velocity_alert"
                    ? "velocity"
                    : item.urgencyTier === "critical" || item.healthTone === "critical"
                      ? "critical"
                      : "low";
                  const allocationBadge = hasBudget ? getAllocationBadgeLabel(item.allocationStatus) : "";

                  return (
                    <li
                      key={item.id}
                      className={`restock-notebook-line ${hasBudget && item.allocationStatus === "skipped_budget" ? "is-skipped" : ""}`}
                      style={{ "--line-index": idx }}
                    >
                      <div className="notebook-line-main">
                        <span className="notebook-line-check" aria-hidden="true">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <div className="notebook-line-item">
                          <strong>{item.item}</strong>
                          <small>{item.category || "Uncategorized"}</small>
                          <div className="notebook-line-chips">
                            <span className={`restock-chip basis-${item.basis}`}>
                              {item.basis === "velocity" ? "Velocity" : "Max Refill"}
                            </span>
                            {item.lowData && (
                              <span className="restock-chip warn">Low data</span>
                            )}
                            {!item.costKnown && (
                              <span className="restock-chip muted">No cost set</span>
                            )}
                            {item.exceedsMaxStock && (
                              <span className="restock-chip over">Exceeds max</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="notebook-line-status">
                        <span className={`restock-status ${statusTone}`}>
                          <span aria-hidden="true" />
                          {item.label}
                        </span>
                      </div>

                      <div className="notebook-line-stock-burn">
                        <div className="notebook-line-stock">
                          <span className="stock-current">
                            {formatQty(item.quantity)} {item.unit}
                          </span>
                          <span className="stock-divider">/</span>
                          <span className="stock-max">
                            {item.maximumStock == null
                              ? "No max"
                              : `${formatQty(item.maximumStock)} ${item.unit}`}
                          </span>
                        </div>
                        <div className="notebook-line-burn">
                          {item.avgDailyUsage > 0 ? (
                            <>
                              <span>{formatQty(item.avgDailyUsage)} {item.unit}/day</span>
                              {item.daysOfStockLeft != null && (
                                <strong>~{item.daysOfStockLeft}d left</strong>
                              )}
                            </>
                          ) : (
                            <span className="burn-idle">No recent sales</span>
                          )}
                        </div>
                      </div>

                      <div className="notebook-line-refill">
                        {item.basis === "fallback" && item.maximumStock == null ? (
                          <span className="refill-unset">Set max first</span>
                        ) : (
                          <>
                            <strong className={`refill-tag ${hasBudget && item.allocatedQty === 0 ? "is-zero" : ""}`}>
                              +{formatQty(displayQty)} {item.unit}
                            </strong>
                            {isPackActive && (hasBudget ? item.allocatedPacks > 0 : item.recommendedPacks > 0) ? (
                              <small className="refill-subnote">
                                {hasBudget ? item.allocatedPacks : item.recommendedPacks}{" "}
                                {item.packageUnit || "pack"}
                                {(hasBudget ? item.allocatedPacks : item.recommendedPacks) === 1 ? "" : "s"}
                              </small>
                            ) : !isPackActive && item.recommendedPacks > 0 ? (
                              <small className="refill-subnote">
                                ≈ {item.recommendedPacks} {item.packageUnit || "pack"}
                                {item.recommendedPacks === 1 ? "" : "s"}
                              </small>
                            ) : null}
                            {hasBudget && allocationBadge && (
                              <span className={`restock-alloc-badge status-${item.allocationStatus}`}>
                                {allocationBadge}
                                {item.allocationStatus === "partial" ? ` / ${formatQty(targetQty)}` : ""}
                              </span>
                            )}
                          </>
                        )}
                      </div>

                      <div className="notebook-line-cost">
                        {!item.costKnown ? (
                          <span className="refill-unset">No cost set</span>
                        ) : (
                          <>
                            <strong className="cost-amount">{formatPeso(displayCost ?? 0)}</strong>
                            {hasBudget && item.allocationStatus === "partial" && targetCost != null && (
                              <small className="cost-target-note">of {formatPeso(targetCost)}</small>
                            )}
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : (
            <div className="restock-empty-state">
              <span aria-hidden="true">✓</span>
              <strong>All pages clear — stock is healthy</strong>
              <p>No ingredients are below {lowThreshold}% of maximum stock or within {coverDays} days of stockout.</p>
            </div>
          )}

          <footer className="restock-modal-footer">
            <div className="restock-footer-meta">
              <div className="restock-footer-totals">
                <span>
                  Total Est. Cost: <strong>{formatPeso(totalEstimatedCost)}</strong>
                </span>
                {hasBudget && (
                  <>
                    <span>
                      Allocated: <strong>{formatPeso(budgetAllocation.allocatedTotalCost)}</strong>
                    </span>
                    <span>
                      Remaining: <strong>{formatPeso(budgetAllocation.budgetRemaining)}</strong>
                    </span>
                  </>
                )}
                {uncostedCount > 0 && (
                  <span className="restock-uncosted-note">
                    {uncostedCount} {uncostedCount === 1 ? "item has" : "items have"} no cost set
                  </span>
                )}
              </div>
              <p role="status" aria-live="polite">
                {restockNotice ||
                  "Copying also downloads a .txt checklist that can be opened in Notepad."}
              </p>
            </div>
            <div className="restock-footer-actions">
              <button
                type="button"
                className="restock-secondary-button"
                onClick={closeRestockModal}
              >
                Close Notebook
              </button>
              <button
                type="button"
                className="restock-copy-button"
                onClick={handleCopyRestockList}
                disabled={!restockItems.length}
              >
                Copy &amp; Download .txt
              </button>
            </div>
          </footer>
        </div>
      </section>
    </div>
  );
}
