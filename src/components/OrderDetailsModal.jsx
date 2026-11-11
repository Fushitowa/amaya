import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CalendarDays,
  Check,
  Clock,
  CreditCard,
  Hash,
  MessageSquare,
  Printer,
  ShieldAlert,
  User,
  Utensils,
  Wallet,
  X,
} from "lucide-react";

import {
  getPaymentMethodLabel,
  getPaymentStatusLabel,
  useOrders,
  WALK_IN_CUSTOMER_NAME,
} from "../context/OrdersContext.jsx";
import { findProductById, resolveProductSizes, useMenu } from "../context/MenuContext.jsx";
import { apiRequest } from "../utils/api.js";
import {
  formatAuditTimestamp,
  formatConsumptionQuantity,
  getDefaultVoidStockAction,
  VOID_REASON_PRESETS,
} from "../utils/orderDetailsHelpers.js";
import { peso } from "../utils/staffActivityFormatters.js";
import { usePrefersReducedMotion } from "../utils/usePrefersReducedMotion.js";

import "../assets/css/order-details-modal.css";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function OrderDetailsModal({
  order,
  portal = "admin",
  darkMode = false,
  productImageByName,
  canVoid = false,
  canViewCostBreakdown = false,
  onConfirmOrder,
  onVoidOrder,
  onPrintReceipt,
  triggerRef,
  onClosed,
}) {
  const { products = [] } = useMenu() || {};
  const ordersContext = useOrders();
  const prefersReducedMotion = usePrefersReducedMotion();

  const dialogRef = useRef(null);
  const closeTimerRef = useRef(null);

  const [isClosing, setIsClosing] = useState(false);
  const [viewMode, setViewMode] = useState("details");
  const [voidReason, setVoidReason] = useState("");
  const [stockAction, setStockAction] = useState(() => getDefaultVoidStockAction(order?.status));
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [fetchedState, setFetchedState] = useState({
    orderId: null,
    data: null,
    loading: false,
    error: "",
  });

  const orderId = order?.id || null;

  const finishClose = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    const triggerEl = triggerRef?.current;
    if (triggerEl && typeof triggerEl.focus === "function") {
      window.requestAnimationFrame(() => triggerEl.focus({ preventScroll: true }));
    }
    onClosed?.();
  }, [onClosed, triggerRef]);

  const requestClose = useCallback(() => {
    if (isClosing || actionBusy) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(
      finishClose,
      prefersReducedMotion ? 125 : 155,
    );
  }, [actionBusy, finishClose, isClosing, prefersReducedMotion]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  // Set focus inside dialog cleanly after mount without setting autoFocus on the close button
  useEffect(() => {
    if (!orderId) return undefined;
    const raf = window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [orderId]);

  // Double-rAF + entrance settle gating before loading deep audit details & consumptions
  useEffect(() => {
    if (!orderId) return undefined;
    let active = true;
    let raf1 = 0;
    let raf2 = 0;
    let settleTimer = 0;

    const loadDetails = async () => {
      try {
        const loader = ordersContext?.fetchOrderDetails
          ? ordersContext.fetchOrderDetails
          : (id) => apiRequest(`/orders/${encodeURIComponent(id)}`);
        const data = await loader(orderId);
        if (!active) return;
        setFetchedState({ orderId, data, loading: false, error: "" });
      } catch (err) {
        if (!active) return;
        setFetchedState({
          orderId,
          data: null,
          loading: false,
          error: err?.message || "Could not load full audit trail.",
        });
      }
    };

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        settleTimer = window.setTimeout(
          loadDetails,
          prefersReducedMotion ? 16 : 190,
        );
      });
    });

    return () => {
      active = false;
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(settleTimer);
    };
  }, [orderId, ordersContext, prefersReducedMotion]);

  // Escape & focus trap
  useEffect(() => {
    if (!orderId) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusables = [...dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)]
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusables.length) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [orderId, requestClose]);

  const resolvedDetails = fetchedState.orderId === orderId ? fetchedState.data : null;
  const displayOrder = useMemo(() => {
    if (!order) return null;
    return resolvedDetails ? { ...order, ...resolvedDetails } : order;
  }, [order, resolvedDetails]);

  if (!displayOrder) return null;

  const isCancelled = displayOrder.status === "Cancelled";
  const isConfirmed = Boolean(displayOrder.confirmed || displayOrder.confirmedAt || displayOrder.confirmedByName);
  const orderItems = displayOrder.items || [];
  const totalUnits = orderItems.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
  const orderTotal = Number(displayOrder.total || 0);
  const paymentMethod = displayOrder.paymentMethod || "Cash";
  const statusEvents = Array.isArray(displayOrder.statusEvents) ? displayOrder.statusEvents : [];
  const consumptions = Array.isArray(displayOrder.consumptions) ? displayOrder.consumptions : [];

  const totalCost = orderItems.reduce((sum, item) => {
    const unitCost = Number(item.unitCost ?? item.unitCostSnapshot ?? 0);
    return sum + unitCost * Number(item.quantity || 0);
  }, 0);
  const uncostedLineCount = orderItems.filter(
    (item) => item.unitCost === null && item.unitCostSnapshot === null,
  ).length;
  const grossProfit = Math.max(0, orderTotal - totalCost);
  const marginPct = orderTotal > 0 ? (grossProfit / orderTotal) * 100 : 0;

  const handleConfirmOrderClick = async () => {
    if (!onConfirmOrder || actionBusy) return;
    setActionBusy(true);
    setActionError("");
    setActionNotice("");
    try {
      const updated = await onConfirmOrder(displayOrder);
      if (updated) {
        setFetchedState({ orderId, data: updated, loading: false, error: "" });
      }
      setActionNotice(`Order ${displayOrder.id} confirmed.`);
    } catch (err) {
      setActionError(err?.message || "Could not confirm order.");
    } finally {
      setActionBusy(false);
    }
  };

  const handleEnterVoidMode = () => {
    setActionError("");
    setActionNotice("");
    setStockAction(getDefaultVoidStockAction(displayOrder.status));
    setVoidReason("");
    setViewMode("void-confirm");
  };

  const handleVoidSubmit = async (event) => {
    event.preventDefault();
    if (!onVoidOrder || actionBusy) return;
    const trimmed = voidReason.trim();
    if (trimmed.length < 3 || trimmed.length > 255) {
      setActionError("Enter a void reason between 3 and 255 characters.");
      return;
    }
    setActionBusy(true);
    setActionError("");
    try {
      const updated = await onVoidOrder(displayOrder, {
        reason: trimmed,
        restoreStock: stockAction === "restore",
      });
      if (updated) {
        setFetchedState({ orderId, data: updated, loading: false, error: "" });
      }
      setViewMode("details");
      setActionNotice(
        stockAction === "restore"
          ? `Order ${displayOrder.id} cancelled and stock restored.`
          : `Order ${displayOrder.id} cancelled with spoilage recorded.`,
      );
    } catch (err) {
      setActionError(err?.message || "Failed to void order.");
    } finally {
      setActionBusy(false);
    }
  };

  const statusClass = String(displayOrder.status || "Pending").toLowerCase();
  const isWaitingDetails = fetchedState.orderId !== orderId;

  return (
    <div
      className={`odm-backdrop ${darkMode ? "dark-mode" : ""} ${isClosing ? "is-closing" : ""}`}
      onClick={requestClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="odm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="odm-dialog-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="odm-header">
          <div className="odm-header-left">
            {viewMode === "void-confirm" && (
              <button
                type="button"
                className="odm-icon-btn"
                onClick={() => {
                  setViewMode("details");
                  setActionError("");
                }}
                aria-label="Back to order details"
              >
                <ArrowLeft size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
            )}
            <div className="odm-title-wrap">
              <div className="odm-title-row">
                <h3 id="odm-dialog-title">
                  {viewMode === "void-confirm"
                    ? `Void / Cancel Order #${displayOrder.id}`
                    : `Order #${displayOrder.id}`}
                </h3>
                <span className={`odm-status-pill ${statusClass}`}>{displayOrder.status}</span>
              </div>
              <p className="odm-subtitle">
                {displayOrder.customer || displayOrder.customerName || WALK_IN_CUSTOMER_NAME}
                {" · "}
                {formatAuditTimestamp(displayOrder.createdAt)}
              </p>
            </div>
          </div>

          <button
            type="button"
            className="odm-icon-btn"
            onClick={requestClose}
            aria-label="Close order details"
            disabled={actionBusy}
          >
            <X size={18} strokeWidth={2.3} aria-hidden="true" />
          </button>
        </header>

        <div className="odm-body">
          {actionError && (
            <div className="odm-alert error" role="alert">
              <AlertTriangle size={17} aria-hidden="true" />
              <span>{actionError}</span>
            </div>
          )}

          {actionNotice && (
            <div className="odm-alert success" role="status">
              <Check size={17} aria-hidden="true" />
              <span>{actionNotice}</span>
            </div>
          )}

          {isCancelled && viewMode === "details" && (
            <div className="odm-alert void-banner">
              <ShieldAlert size={18} aria-hidden="true" />
              <div>
                <strong>Order Cancelled (Voided)</strong>
                {displayOrder.voidReason ? ` — Reason: ${displayOrder.voidReason}` : ""}
                {displayOrder.voidedByName ? ` · Voided by ${displayOrder.voidedByName}` : ""}
                {displayOrder.voidedAt ? ` on ${formatAuditTimestamp(displayOrder.voidedAt)}` : ""}
              </div>
            </div>
          )}

          {viewMode === "void-confirm" ? (
            <form className="odm-void-panel" onSubmit={handleVoidSubmit}>
              <div className="odm-void-summary">
                <div>
                  <span>ORDER NUMBER</span>
                  <strong>#{displayOrder.id}</strong>
                </div>
                <div>
                  <span>CURRENT STATUS</span>
                  <strong>{displayOrder.status}</strong>
                </div>
                <div>
                  <span>RECORDED AMOUNT</span>
                  <strong>{peso(orderTotal)}</strong>
                </div>
              </div>

              <div>
                <div className="odm-section-head">
                  <h4>Select Void Reason</h4>
                </div>
                <div className="odm-preset-group" role="group" aria-label="Common void reasons">
                  {VOID_REASON_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`odm-chip-btn ${voidReason === preset ? "is-active" : ""}`}
                      onClick={() => setVoidReason(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 700 }}>
                  Void Reason (Required, 3–255 characters)
                </span>
                <textarea
                  className="odm-textarea"
                  value={voidReason}
                  maxLength={255}
                  placeholder="Explain why this order is being cancelled..."
                  onChange={(e) => setVoidReason(e.target.value)}
                  required
                />
                <small style={{ color: "#7b6659", fontSize: "0.74rem", textAlign: "right" }}>
                  {voidReason.trim().length} / 255
                </small>
              </label>

              <div>
                <div className="odm-section-head">
                  <h4>Inventory Handling</h4>
                </div>
                <div className="odm-radio-grid">
                  <label className={`odm-radio-card ${stockAction === "restore" ? "is-selected" : ""}`}>
                    <input
                      type="radio"
                      name="voidStockAction"
                      value="restore"
                      checked={stockAction === "restore"}
                      onChange={() => setStockAction("restore")}
                    />
                    <div>
                      <strong>Restore Stock to Inventory</strong>
                      <small>
                        Best for unprepped Pending orders. Returns deducted recipe ingredients back to inventory.
                      </small>
                    </div>
                  </label>

                  <label className={`odm-radio-card ${stockAction === "spoilage" ? "is-selected" : ""}`}>
                    <input
                      type="radio"
                      name="voidStockAction"
                      value="spoilage"
                      checked={stockAction === "spoilage"}
                      onChange={() => setStockAction("spoilage")}
                    />
                    <div>
                      <strong>Record Spoilage (Keep Deducted)</strong>
                      <small>
                        Best when drink/food was already prepared. Logs a spoilage entry without adding stock back.
                      </small>
                    </div>
                  </label>
                </div>
              </div>

              <div className="odm-void-footer">
                <button
                  type="button"
                  className="odm-btn neutral"
                  onClick={() => {
                    setViewMode("details");
                    setActionError("");
                  }}
                  disabled={actionBusy}
                >
                  Back to Order
                </button>
                <button
                  type="submit"
                  className="odm-btn danger-solid"
                  disabled={actionBusy || voidReason.trim().length < 3}
                >
                  {actionBusy ? "Voiding Order..." : "Confirm Void Order"}
                </button>
              </div>
            </form>
          ) : (
            <div className="odm-layout">
              <div>
                <div className="odm-section-head">
                  <h4>Ordered Items</h4>
                  <span className="odm-count-badge">
                    {totalUnits} {totalUnits === 1 ? "unit" : "units"}
                  </span>
                </div>

                <ul className="odm-item-list">
                  {orderItems.length ? orderItems.map((item, index) => {
                    const normTitle = String(item.title || "").trim().toLowerCase();
                    const image = productImageByName instanceof Map
                      ? (productImageByName.get(item.title) ?? productImageByName.get(normTitle))
                      : (productImageByName?.[item.title] ?? productImageByName?.[normTitle]);
                    const unitPrice = Number(item.price || 0);
                    const qty = Number(item.quantity || 0);
                    const lineTotal = unitPrice * qty;
                    const catalogItem =
                      (item.productId != null && findProductById(products, item.productId)) ||
                      products.find((p) => (p.name || p.title) === item.title);
                    const fallbackSizeLabel = catalogItem
                      ? resolveProductSizes(catalogItem)[0]?.label
                      : null;
                    const description = [
                      item.size && item.size !== "Regular"
                        ? item.size
                        : fallbackSizeLabel || item.size || "Regular",
                      item.sugarLevel || null,
                      item.addons?.length ? `+${item.addons.join(", ")}` : null,
                    ].filter(Boolean).join(" · ");

                    return (
                      <li className="odm-item" key={`${item.id || item.title}-${index}`}>
                        <span className="odm-item-thumb" aria-hidden="true">
                          {image ? (
                            <img src={image} alt="" />
                          ) : (
                            <span className="odm-item-thumb-fallback">
                              {String(item.title || "?").charAt(0)}
                            </span>
                          )}
                        </span>

                        <div className="odm-item-text">
                          <strong>{item.title}</strong>
                          <span className="odm-item-desc">{description}</span>
                          <span className="odm-item-unit">{peso(unitPrice)} each</span>
                          {(item.notes || item.instructions) && (
                            <span className="odm-item-note">Note: {item.notes || item.instructions}</span>
                          )}
                        </div>

                        <span className="odm-qty-pill" aria-label={`Quantity ${qty}`}>
                          {qty}×
                        </span>

                        <strong className="odm-item-total">{peso(lineTotal)}</strong>
                      </li>
                    );
                  }) : (
                    <li className="odm-item">
                      <span className="odm-item-desc">No items recorded for this order.</span>
                    </li>
                  )}
                </ul>

                <div className="odm-costs">
                  <div className="odm-cost-row">
                    <span>Subtotal</span>
                    <strong>{peso(displayOrder.subtotal ?? orderTotal)}</strong>
                  </div>
                  <div className="odm-cost-row">
                    <span>Tax (VAT 0%)</span>
                    <strong>₱0.00</strong>
                  </div>
                  <div className="odm-cost-row">
                    <span>Payment Method</span>
                    <span className="odm-method-pill">
                      {paymentMethod === "GCash" ? (
                        <Wallet size={12} strokeWidth={2.2} aria-hidden="true" />
                      ) : paymentMethod === "Card" ? (
                        <CreditCard size={12} strokeWidth={2.2} aria-hidden="true" />
                      ) : (
                        <Banknote size={12} strokeWidth={2.2} aria-hidden="true" />
                      )}
                      {getPaymentMethodLabel(displayOrder)} · {getPaymentStatusLabel(displayOrder)}
                    </span>
                  </div>
                  {String(paymentMethod).toLowerCase() === "cash" ? (
                    <>
                      <div className="odm-cost-row">
                        <span>Cash Tendered</span>
                        <strong>{peso(displayOrder.cashTendered ?? displayOrder.cash_tendered ?? orderTotal)}</strong>
                      </div>
                      <div className="odm-cost-row">
                        <span>Change Due</span>
                        <strong>
                          {Number(displayOrder.changeDue ?? displayOrder.change_due ?? 0) === 0 &&
                          Math.abs(Number(displayOrder.cashTendered ?? displayOrder.cash_tendered ?? orderTotal) - Number(orderTotal)) < 0.01 ? (
                            <>
                              ₱0.00 <span className="odm-tag-exact">(Exact Cash)</span>
                            </>
                          ) : (
                            peso(displayOrder.changeDue ?? displayOrder.change_due ?? 0)
                          )}
                        </strong>
                      </div>
                    </>
                  ) : (
                    <div className="odm-cost-row">
                      <span>Settlement</span>
                      <strong style={{ fontSize: "0.82rem", color: "#6b7280" }}>Exact · Electronic (No change)</strong>
                    </div>
                  )}
                </div>

                <div className={`odm-total-banner ${isCancelled ? "is-voided" : ""}`}>
                  <span className="odm-total-label">
                    <Wallet size={16} strokeWidth={2.2} aria-hidden="true" />
                    {isCancelled ? "Voided Order Amount" : "Collected Total"}
                  </span>
                  <strong>{peso(orderTotal)}</strong>
                </div>

                {canViewCostBreakdown && (
                  <section className="odm-cogs-card" aria-label="Ingredient COGS and Margin Breakdown">
                    <div className="odm-section-head">
                      <h4>Cost &amp; Ingredient Breakdown ({portal === "admin" ? "Admin" : ""})</h4>
                      {uncostedLineCount > 0 && (
                        <span className="odm-status-pill pending">
                          {uncostedLineCount} uncosted item{uncostedLineCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>

                    <div className="odm-cogs-grid">
                      <div className="odm-cogs-stat">
                        <span>Estimated COGS</span>
                        <strong>{peso(totalCost)}</strong>
                      </div>
                      <div className="odm-cogs-stat">
                        <span>Gross Profit</span>
                        <strong>{isCancelled ? "₱0.00" : peso(grossProfit)}</strong>
                      </div>
                      <div className="odm-cogs-stat">
                        <span>Gross Margin</span>
                        <strong>{isCancelled ? "0.0%" : `${marginPct.toFixed(1)}%`}</strong>
                      </div>
                    </div>

                    {isWaitingDetails ? (
                      <p className="odm-subtitle">Loading ingredient deduction ledger...</p>
                    ) : consumptions.length > 0 ? (
                      <div className="odm-consumption-bars-wrap">
                        <div className="odm-consumption-ruler" aria-hidden="true">
                          <span>Ingredient</span>
                          <span>Source</span>
                          <span>Used Amount</span>
                          <span>Line Cost</span>
                        </div>
                        <div className="odm-consumption-bar-list" role="list" aria-label="Ingredient deductions">
                          {consumptions.map((entry, idx) => {
                            const ingredientName =
                              entry.inventoryName ||
                              entry.itemName ||
                              entry.productName ||
                              entry.name ||
                              "Ingredient";
                            const rawCost = entry.totalCost ?? entry.lineCost ?? 0;
                            const costDisplay =
                              rawCost > 0 && rawCost < 0.01
                                ? "<₱0.01"
                                : peso(rawCost);
                            return (
                              <div className="odm-consumption-bar-row" key={entry.id || idx} role="listitem">
                                <div className="odm-consumption-bar-main">
                                  <span className="odm-consumption-bar-idx">#{String(idx + 1).padStart(2, "0")}</span>
                                  <div className="odm-consumption-bar-info">
                                    <strong className="odm-consumption-bar-title">{ingredientName}</strong>
                                    {entry.reversedAt && <span className="odm-tag-reversed">Restored</span>}
                                  </div>
                                </div>
                                <div className="odm-consumption-bar-source">
                                  <span className="odm-consumption-source-tag">{entry.source || "Recipe"}</span>
                                </div>
                                <div className="odm-consumption-bar-qty">
                                  <span className="odm-consumption-qty-chip">
                                    {formatConsumptionQuantity(entry.quantityUsed ?? entry.quantity, entry.unit)}
                                  </span>
                                </div>
                                <div className="odm-consumption-bar-cost">
                                  <strong>{costDisplay}</strong>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <p className="odm-subtitle">No ingredient deductions recorded for this order.</p>
                    )}
                  </section>
                )}
              </div>

              <aside className="odm-aside">
                {isCancelled ? (
                  <span className="odm-confirm-badge cancelled">
                    <ShieldAlert size={15} strokeWidth={2.4} aria-hidden="true" />
                    Order Cancelled / Voided
                  </span>
                ) : isConfirmed ? (
                  <span className="odm-confirm-badge confirmed">
                    <Check size={15} strokeWidth={3} aria-hidden="true" />
                    Order Confirmed
                  </span>
                ) : (
                  <span className="odm-confirm-badge pending">
                    <Clock size={15} strokeWidth={2.4} aria-hidden="true" />
                    Pending Confirmation
                  </span>
                )}

                {!isCancelled && !isConfirmed && typeof onConfirmOrder === "function" && (
                  <button
                    type="button"
                    className="odm-btn secondary"
                    onClick={handleConfirmOrderClick}
                    disabled={actionBusy}
                  >
                    <Check size={15} strokeWidth={2.4} aria-hidden="true" />
                    {actionBusy ? "Confirming..." : "Confirm Order"}
                  </button>
                )}

                <dl className="odm-meta">
                  <div>
                    <dt><Hash size={13} strokeWidth={2.2} aria-hidden="true" /> Order ID</dt>
                    <dd>{displayOrder.id}</dd>
                  </div>
                  <div>
                    <dt><User size={13} strokeWidth={2.2} aria-hidden="true" /> Customer</dt>
                    <dd>{displayOrder.customer || displayOrder.customerName || WALK_IN_CUSTOMER_NAME}</dd>
                  </div>
                  <div>
                    <dt><User size={13} strokeWidth={2.2} aria-hidden="true" /> Created By</dt>
                    <dd>{displayOrder.createdBy || displayOrder.cashier || "Staff"}</dd>
                  </div>
                  {displayOrder.confirmedByName && (
                    <div>
                      <dt><Check size={13} strokeWidth={2.2} aria-hidden="true" /> Confirmed By</dt>
                      <dd>{displayOrder.confirmedByName}</dd>
                    </div>
                  )}
                  {displayOrder.paidByName && (
                    <div>
                      <dt><Wallet size={13} strokeWidth={2.2} aria-hidden="true" /> Paid By</dt>
                      <dd>{displayOrder.paidByName}</dd>
                    </div>
                  )}
                  {displayOrder.completedByName && (
                    <div>
                      <dt><Check size={13} strokeWidth={2.2} aria-hidden="true" /> Completed By</dt>
                      <dd>{displayOrder.completedByName}</dd>
                    </div>
                  )}
                  <div>
                    <dt><Utensils size={13} strokeWidth={2.2} aria-hidden="true" /> Order Type</dt>
                    <dd>{displayOrder.type || "Counter"}</dd>
                  </div>
                  <div>
                    <dt><CalendarDays size={13} strokeWidth={2.2} aria-hidden="true" /> Created</dt>
                    <dd>{formatAuditTimestamp(displayOrder.createdAt)}</dd>
                  </div>
                  {displayOrder.sessionId != null && (
                    <div>
                      <dt><Clock size={13} strokeWidth={2.2} aria-hidden="true" /> Shift Session</dt>
                      <dd>#{displayOrder.sessionId}</dd>
                    </div>
                  )}
                  <div>
                    <dt><MessageSquare size={13} strokeWidth={2.2} aria-hidden="true" /> Notes</dt>
                    <dd>{displayOrder.notes || "None"}</dd>
                  </div>
                </dl>

                <div className="odm-timeline">
                  <div className="odm-section-head">
                    <h4>Status Audit Trail</h4>
                  </div>
                  {isWaitingDetails ? (
                    <p className="odm-subtitle">Loading status events...</p>
                  ) : statusEvents.length > 0 ? (
                    <ul className="odm-timeline-list">
                      {statusEvents.map((ev) => (
                        <li
                          key={ev.id}
                          className={`odm-timeline-item ${ev.toStatus === "Cancelled" ? "is-cancelled" : ""}`}
                        >
                          <strong>
                            {ev.fromStatus ? `${ev.fromStatus} -> ${ev.toStatus}` : `Created (${ev.toStatus})`}
                          </strong>
                          <span>
                            {ev.actorName}
                            {ev.reason ? ` · ${ev.reason}` : ""}
                          </span>
                          <small>{formatAuditTimestamp(ev.createdAt)}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="odm-subtitle">
                      {fetchedState.error || "Order status history will appear as transitions occur."}
                    </p>
                  )}
                </div>

                <div className="odm-actions">
                  {typeof onPrintReceipt === "function" && (
                    <button
                      type="button"
                      className="odm-btn primary"
                      onClick={() => onPrintReceipt(displayOrder)}
                    >
                      <Printer size={15} strokeWidth={2.2} aria-hidden="true" />
                      Print Receipt
                    </button>
                  )}

                  {canVoid && !isCancelled && typeof onVoidOrder === "function" && (
                    <button
                      type="button"
                      className="odm-btn danger-outline"
                      onClick={handleEnterVoidMode}
                    >
                      <ShieldAlert size={15} strokeWidth={2.2} aria-hidden="true" />
                      Void / Cancel Order
                    </button>
                  )}

                  <button
                    type="button"
                    className="odm-btn neutral"
                    onClick={requestClose}
                  >
                    Close
                  </button>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default OrderDetailsModal;
