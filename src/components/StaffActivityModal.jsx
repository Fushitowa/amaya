import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart2,
  ClipboardList,
  Clock,
  Download,
  ExternalLink,
  Filter,
  Package,
  Receipt,
  X,
} from "lucide-react";

import { useOrders } from "../context/OrdersContext.jsx";
import { apiRequest } from "../utils/api.js";
import {
  compactPeso,
  downloadAuthenticatedCsv,
  formatDateTime,
  getMovementLabel,
  getMovementTone,
  initials,
  peso,
} from "../utils/staffActivityFormatters.js";
import { usePrefersReducedMotion } from "../utils/usePrefersReducedMotion.js";
import OrderDetailsModal from "./OrderDetailsModal.jsx";

import "../assets/css/admin/StaffActivityModal.css";

const TABS = [
  { key: "orders", label: "Transactions & Orders", Icon: Receipt },
  { key: "products", label: "Products Sold & Trend", Icon: BarChart2 },
  { key: "sessions", label: "Cashier Sessions", Icon: Clock },
  { key: "logs", label: "Inventory & Activity Logs", Icon: ClipboardList },
];

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

const RING_INDICES = [0, 1, 2, 3, 4, 5, 6];

function buildStaffQueryString({ rangeParams, page, limit, search, status, paymentMethod }) {
  const params = new URLSearchParams();
  if (rangeParams?.rangeKey) params.set("rangeKey", rangeParams.rangeKey);
  if (rangeParams?.rangeKey === "custom") {
    if (rangeParams.from) params.set("from", rangeParams.from);
    if (rangeParams.to) params.set("to", rangeParams.to);
  }
  if (page) params.set("page", String(page));
  if (limit) params.set("limit", String(limit));
  if (search) params.set("search", search);
  if (status && status !== "All") params.set("status", status);
  if (paymentMethod && paymentMethod !== "All") params.set("paymentMethod", paymentMethod);
  return params.toString();
}

function StaffActivityModal({
  staffMember,
  rangeParams,
  onFilterReportByStaff,
  productImageByName,
  darkMode = false,
  triggerRef,
  onClosed,
}) {
  const { confirmOrder, voidOrder } = useOrders() || {};
  const prefersReducedMotion = usePrefersReducedMotion();

  const dialogRef = useRef(null);
  const closeTimerRef = useRef(null);
  const orderTriggerRef = useRef(null);

  const [isClosing, setIsClosing] = useState(false);
  const [openAnimSettled, setOpenAnimSettled] = useState(false);
  const [activeTab, setActiveTab] = useState("orders");
  const [tabDirection, setTabDirection] = useState("forward");

  // Order list filters
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("All");
  const [orderPaymentFilter, setOrderPaymentFilter] = useState("All");
  const [orderPage, setOrderPage] = useState(1);

  // Activity log filter
  const [logTypeFilter, setLogTypeFilter] = useState("all");

  // Data state keyed so stale staff responses never leak
  const [activityState, setActivityState] = useState({
    staffId: null,
    data: null,
    loading: false,
    error: "",
  });

  // Session expansion state
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [sessionDetailsById, setSessionDetailsById] = useState({});
  const [loadingSessionId, setLoadingSessionId] = useState(null);

  // Stacked OrderDetailsModal state
  const [activeOrder, setActiveOrder] = useState(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [csvError, setCsvError] = useState("");

  const staffId = staffMember?.userId ?? staffMember?.id ?? null;

  const finishClose = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    const el = triggerRef?.current;
    if (el && typeof el.focus === "function") {
      window.requestAnimationFrame(() => el.focus({ preventScroll: true }));
    }
    onClosed?.();
  }, [onClosed, triggerRef]);

  const requestClose = useCallback(() => {
    if (isClosing || activeOrder) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(
      finishClose,
      prefersReducedMotion ? 125 : 165,
    );
  }, [activeOrder, finishClose, isClosing, prefersReducedMotion]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  // Double-rAF + entrance settle gate so heavy activity payloads never fight the 240ms sheet entrance
  useEffect(() => {
    if (!staffId) return undefined;
    let raf1 = 0;
    let raf2 = 0;
    let timer = 0;

    raf1 = window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
      raf2 = window.requestAnimationFrame(() => {
        timer = window.setTimeout(
          () => setOpenAnimSettled(true),
          prefersReducedMotion ? 16 : 210,
        );
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(timer);
    };
  }, [prefersReducedMotion, staffId]);

  const fetchActivity = useCallback(async () => {
    if (!staffId) return;
    const qs = buildStaffQueryString({
      rangeParams,
      page: orderPage,
      limit: 15,
      search: orderSearch.trim(),
      status: orderStatusFilter,
      paymentMethod: orderPaymentFilter,
    });
    try {
      const data = await apiRequest(`/reports/staff/${staffId}/activity?${qs}`);
      setActivityState({ staffId, data, loading: false, error: "" });
    } catch (err) {
      setActivityState({
        staffId,
        data: null,
        loading: false,
        error: err?.message || "Failed to load staff activity.",
      });
    }
  }, [orderPage, orderPaymentFilter, orderSearch, orderStatusFilter, rangeParams, staffId]);

  useEffect(() => {
    if (!staffId || !openAnimSettled) return undefined;
    let active = true;
    const qs = buildStaffQueryString({
      rangeParams,
      page: orderPage,
      limit: 15,
      search: orderSearch.trim(),
      status: orderStatusFilter,
      paymentMethod: orderPaymentFilter,
    });

    apiRequest(`/reports/staff/${staffId}/activity?${qs}`)
      .then((data) => {
        if (!active) return;
        setActivityState({ staffId, data, loading: false, error: "" });
      })
      .catch((err) => {
        if (!active) return;
        setActivityState({
          staffId,
          data: null,
          loading: false,
          error: err?.message || "Failed to load staff activity.",
        });
      });

    return () => {
      active = false;
    };
  }, [openAnimSettled, orderPage, orderPaymentFilter, orderSearch, orderStatusFilter, rangeParams, staffId]);

  // Reload activity when an order void or stock mutation happens underneath
  useEffect(() => {
    if (!staffId || !openAnimSettled) return undefined;
    const onMutated = () => {
      fetchActivity();
    };
    window.addEventListener("amaya:stock-mutated", onMutated);
    return () => window.removeEventListener("amaya:stock-mutated", onMutated);
  }, [fetchActivity, openAnimSettled, staffId]);

  // Keyboard focus trap + Escape close
  useEffect(() => {
    if (!staffId || activeOrder) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
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
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeOrder, requestClose, staffId]);

  const activity = activityState.staffId === staffId ? activityState.data : null;
  const isWaitingActivity = !openAnimSettled || (activityState.staffId !== staffId && !activityState.error);

  const summary = useMemo(() => {
    const base = activity?.summary || {};
    return {
      ordersCount: base.paidOrdersCount ?? staffMember?.ordersCount ?? 0,
      voidedOrdersCount: base.voidedOrdersCount ?? staffMember?.voidedOrdersCount ?? 0,
      grossCollectedSales: base.grossCollectedSales ?? staffMember?.grossSales ?? 0,
      cogs: base.cogs ?? staffMember?.cogs ?? 0,
      grossProfit: base.grossProfit ?? staffMember?.attributedGrossProfit ?? 0,
      marginPercent: base.marginPercent ?? staffMember?.marginPercent ?? 0,
      averageOrderValue: base.averageOrderValue ?? staffMember?.averageTicket ?? 0,
      unitsSold: base.unitsSold ?? staffMember?.unitsSold ?? 0,
      uncostedItemsCount: base.uncostedItemsCount ?? staffMember?.uncostedItemsCount ?? 0,
    };
  }, [activity?.summary, staffMember]);

  const displayName = activity?.user?.displayName || staffMember?.displayName || "Staff";
  const firstName = displayName.split(/\s+/)[0] || displayName;
  const role = activity?.user?.role || staffMember?.role || "staff";
  const isActive = activity?.user ? activity.user.isActive : (staffMember?.isActive !== false);

  const selectTab = (nextKey) => {
    if (nextKey === activeTab) return;
    const oldIdx = TABS.findIndex((t) => t.key === activeTab);
    const newIdx = TABS.findIndex((t) => t.key === nextKey);
    setTabDirection(newIdx >= oldIdx ? "forward" : "backward");
    setActiveTab(nextKey);
  };

  const handleTabKeyDown = (event, index) => {
    let nextIdx;
    if (event.key === "ArrowRight") nextIdx = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") nextIdx = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIdx = 0;
    else if (event.key === "End") nextIdx = TABS.length - 1;
    else return;

    event.preventDefault();
    const targetTab = TABS[nextIdx];
    selectTab(targetTab.key);
    window.requestAnimationFrame(() => {
      document.getElementById(`sam-tab-${targetTab.key}`)?.focus();
    });
  };

  const handleToggleSession = async (sessionId) => {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      return;
    }
    setExpandedSessionId(sessionId);
    if (sessionDetailsById[sessionId]) return;
    setLoadingSessionId(sessionId);
    try {
      const detail = await apiRequest(`/sessions/${sessionId}`);
      setSessionDetailsById((prev) => ({ ...prev, [sessionId]: detail }));
    } catch {
      setSessionDetailsById((prev) => ({ ...prev, [sessionId]: { error: "Could not load session details." } }));
    } finally {
      setLoadingSessionId(null);
    }
  };

  const handleOpenOrder = (orderObj, event) => {
    orderTriggerRef.current = event?.currentTarget || null;
    setActiveOrder(orderObj);
  };

  const handleOpenOrderByNumber = async (orderNumber, event) => {
    if (!orderNumber) return;
    orderTriggerRef.current = event?.currentTarget || null;
    const localMatch = activity?.orders?.items?.find((o) => o.id === orderNumber);
    setActiveOrder(localMatch || { id: orderNumber, customer: "Loading...", status: "Pending", items: [] });
  };

  const handleDownloadCsv = async () => {
    if (csvBusy || !staffId) return;
    setCsvBusy(true);
    setCsvError("");
    try {
      const qs = new URLSearchParams();
      qs.set("type", "orders");
      qs.set("staffId", String(staffId));
      if (rangeParams?.rangeKey) qs.set("rangeKey", rangeParams.rangeKey);
      if (rangeParams?.rangeKey === "custom") {
        if (rangeParams.from) qs.set("from", rangeParams.from);
        if (rangeParams.to) qs.set("to", rangeParams.to);
      }
      const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      await downloadAuthenticatedCsv(
        `/reports/export.csv?${qs.toString()}`,
        `amaya-${slug || "staff"}-orders-${rangeParams?.rangeKey || "report"}.csv`,
      );
    } catch (err) {
      setCsvError(err?.message || "CSV download failed.");
    } finally {
      setCsvBusy(false);
    }
  };

  const mergedLogs = useMemo(() => {
    const invItems = (activity?.inventoryActivity || []).map((entry) => ({
      kind: "inventory",
      key: `inv-${entry.id}`,
      timestamp: entry.timestamp,
      entry,
    }));
    const stageItems = (activity?.stageActions || []).map((entry) => ({
      kind: "stage",
      key: `stage-${entry.id}`,
      timestamp: entry.createdAt,
      entry,
    }));
    const combined = [...invItems, ...stageItems].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    if (logTypeFilter === "inventory") return combined.filter((item) => item.kind === "inventory");
    if (logTypeFilter === "stage") return combined.filter((item) => item.kind === "stage");
    return combined;
  }, [activity?.inventoryActivity, activity?.stageActions, logTypeFilter]);

  const productsSold = useMemo(() => activity?.productBreakdown || [], [activity?.productBreakdown]);
  const maxProductSales = useMemo(
    () => Math.max(1, ...productsSold.map((p) => Number(p.sales || 0))),
    [productsSold],
  );
  const seriesPoints = useMemo(() => activity?.series || [], [activity?.series]);
  const maxSeriesSales = useMemo(
    () => Math.max(1, ...seriesPoints.map((s) => Number(s.sales || 0))),
    [seriesPoints],
  );

  const ordersPageData = activity?.orders || { items: [], total: 0, page: 1, limit: 15 };
  const totalOrderPages = Math.max(1, Math.ceil((ordersPageData.total || 0) / (ordersPageData.limit || 15)));

  if (!staffMember) return null;

  return (
    <>
      <div
        className={`sam-backdrop ${darkMode ? "dark-mode" : ""} ${isClosing ? "is-closing" : ""}`}
        onClick={requestClose}
        role="presentation"
        inert={Boolean(activeOrder)}
      >
        <div
          ref={dialogRef}
          className="sam-notebook"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sam-modal-title"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sam-ribbon" aria-hidden="true" />

          <div className="sam-notebook-spine" aria-hidden="true">
            {RING_INDICES.map((idx) => (
              <div className="sam-ring-pair" key={idx}>
                <span className="sam-ring-wire" />
                <span className="sam-ring-hole" />
              </div>
            ))}
          </div>

          <div className="sam-page">
            <header className="sam-header">
              <div className="sam-identity">
                <span className="sam-avatar" aria-hidden="true">{initials(displayName)}</span>
                <div className="sam-identity-text">
                  <div className="sam-title-row">
                    <h2 id="sam-modal-title">{displayName}</h2>
                    <span className={`sam-pill ${role === "admin" ? "role-admin" : "role-staff"}`}>
                      {role === "admin" ? "Admin" : "Cashier & Barista"}
                    </span>
                    <span className={`sam-pill ${isActive ? "status-active" : "status-inactive"}`}>
                      {isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="sam-range-sub">
                    Activity Ledger · {rangeParams?.label || "Selected Period"}
                  </p>
                </div>
              </div>

              <div className="sam-header-actions">
                {typeof onFilterReportByStaff === "function" && (
                  <button
                    type="button"
                    className="sam-action-btn primary"
                    onClick={() => {
                      onFilterReportByStaff(staffId);
                      requestClose();
                    }}
                  >
                    <Filter size={14} strokeWidth={2.2} aria-hidden="true" />
                    Filter Report by {firstName}
                  </button>
                )}

                <button
                  type="button"
                  className="sam-action-btn"
                  onClick={handleDownloadCsv}
                  disabled={csvBusy}
                >
                  <Download size={14} strokeWidth={2.2} aria-hidden="true" />
                  {csvBusy ? "Exporting..." : "Export CSV"}
                </button>

                <button
                  type="button"
                  className="sam-close-btn"
                  onClick={requestClose}
                  aria-label="Close staff activity"
                >
                  <X size={18} strokeWidth={2.3} aria-hidden="true" />
                </button>
              </div>
            </header>

            <div className="sam-scroll-body">
              {csvError && (
                <div className="odm-alert error" role="alert" style={{ marginBottom: "12px" }}>
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{csvError}</span>
                </div>
              )}

              <div className="sam-kpi-disclaimer">
                <span>
                  <strong>Attributed Business KPI · Not Cashier Earnings</strong> — Measures store sales, COGS, and profit handled by {displayName}.
                </span>
                {summary.uncostedItemsCount > 0 && (
                  <span className="sam-uncosted-badge">
                    <AlertTriangle size={13} aria-hidden="true" />
                    {summary.uncostedItemsCount} uncosted unit{summary.uncostedItemsCount === 1 ? "" : "s"} · partial COGS
                  </span>
                )}
              </div>

              <section className="sam-kpi-grid" aria-label="Staff activity KPIs">
                <div className="sam-kpi-card">
                  <span>Orders Handled</span>
                  <strong>{summary.ordersCount}</strong>
                  <small>
                    Avg ticket {peso(summary.averageOrderValue)}
                    {summary.voidedOrdersCount > 0 ? ` · ${summary.voidedOrdersCount} voided` : ""}
                  </small>
                </div>
                <div className="sam-kpi-card">
                  <span>Attributed Revenue</span>
                  <strong>{peso(summary.grossCollectedSales)}</strong>
                  <small>{summary.unitsSold} units sold</small>
                </div>
                <div className="sam-kpi-card">
                  <span>Estimated COGS</span>
                  <strong>{peso(summary.cogs)}</strong>
                  <small>{summary.uncostedItemsCount > 0 ? "Includes uncosted items" : "Recipe & item cost basis"}</small>
                </div>
                <div className="sam-kpi-card">
                  <span>Gross Profit &amp; Margin</span>
                  <strong>{peso(summary.grossProfit)}</strong>
                  <small>{Number(summary.marginPercent || 0).toFixed(1)}% attributed margin</small>
                </div>
              </section>

              <div className="sam-tablist" role="tablist" aria-label="Staff activity sections">
                {TABS.map((tab, idx) => {
                  const selected = activeTab === tab.key;
                  const TabIcon = tab.Icon;
                  return (
                    <button
                      key={tab.key}
                      id={`sam-tab-${tab.key}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls={`sam-panel-${tab.key}`}
                      tabIndex={selected ? 0 : -1}
                      className="sam-tab-btn"
                      onClick={() => selectTab(tab.key)}
                      onKeyDown={(e) => handleTabKeyDown(e, idx)}
                    >
                      <TabIcon size={15} strokeWidth={2.2} aria-hidden="true" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {activityState.error && (
                <div className="sam-empty-box" role="alert">
                  {activityState.error}
                </div>
              )}

              {!activityState.error && (
                <div
                  key={activeTab}
                  id={`sam-panel-${activeTab}`}
                  role="tabpanel"
                  aria-labelledby={`sam-tab-${activeTab}`}
                  className={`sam-tab-panel dir-${tabDirection}`}
                >
                  {activeTab === "orders" && (
                    <div>
                      <div className="sam-controls-row">
                        <input
                          type="search"
                          className="sam-search-input"
                          placeholder="Search order #, customer, or item..."
                          aria-label="Search staff transactions"
                          value={orderSearch}
                          onChange={(e) => {
                            setOrderSearch(e.target.value);
                            setOrderPage(1);
                          }}
                        />
                        <select
                          className="sam-select"
                          aria-label="Filter by status"
                          value={orderStatusFilter}
                          onChange={(e) => {
                            setOrderStatusFilter(e.target.value);
                            setOrderPage(1);
                          }}
                        >
                          <option value="All">All Statuses</option>
                          <option value="Pending">Pending</option>
                          <option value="Preparing">Preparing</option>
                          <option value="Completed">Completed</option>
                          <option value="Cancelled">Cancelled (Voided)</option>
                        </select>
                        <select
                          className="sam-select"
                          aria-label="Filter by payment method"
                          value={orderPaymentFilter}
                          onChange={(e) => {
                            setOrderPaymentFilter(e.target.value);
                            setOrderPage(1);
                          }}
                        >
                          <option value="All">All Payments</option>
                          <option value="Cash">Cash</option>
                          <option value="GCash">GCash</option>
                          <option value="Card">Card</option>
                        </select>
                      </div>

                      {isWaitingActivity ? (
                        <div className="sam-empty-box">Loading {firstName}&apos;s transactions...</div>
                      ) : ordersPageData.items.length === 0 ? (
                        <div className="sam-empty-box">
                          No orders matched these filters in {rangeParams?.label || "this period"}.
                        </div>
                      ) : (
                        <>
                          <div className="sam-table-wrap">
                            <table className="sam-table">
                              <thead>
                                <tr>
                                  <th>Order #</th>
                                  <th>Date &amp; Time</th>
                                  <th>Customer</th>
                                  <th>Items</th>
                                  <th>Payment</th>
                                  <th>Status</th>
                                  <th style={{ textAlign: "right" }}>Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ordersPageData.items.map((order) => (
                                  <tr key={order.id}>
                                    <td>
                                      <button
                                        type="button"
                                        className="sam-order-row-btn"
                                        onClick={(e) => handleOpenOrder(order, e)}
                                      >
                                        #{order.id}
                                        <ExternalLink size={12} aria-hidden="true" />
                                      </button>
                                    </td>
                                    <td>{formatDateTime(order.createdAt)}</td>
                                    <td>{order.customer}</td>
                                    <td>
                                      {(order.items || []).length
                                        ? order.items.map((i) => `${i.quantity}× ${i.title}`).join(", ")
                                        : "—"}
                                    </td>
                                    <td>{order.paymentMethod || "Cash"}</td>
                                    <td>
                                      <span className={`sam-status-tag ${String(order.status || "").toLowerCase()}`}>
                                        {order.status}
                                      </span>
                                    </td>
                                    <td style={{ textAlign: "right", fontWeight: 700 }}>
                                      {peso(order.total)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div className="sam-pagination">
                            <span>
                              Showing page {ordersPageData.page} of {totalOrderPages} ({ordersPageData.total} total)
                            </span>
                            <div style={{ display: "flex", gap: "6px" }}>
                              <button
                                type="button"
                                className="sam-action-btn"
                                disabled={orderPage <= 1}
                                onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
                              >
                                Previous
                              </button>
                              <button
                                type="button"
                                className="sam-action-btn"
                                disabled={orderPage >= totalOrderPages}
                                onClick={() => setOrderPage((p) => Math.min(totalOrderPages, p + 1))}
                              >
                                Next
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {activeTab === "products" && (
                    <div>
                      {isWaitingActivity ? (
                        <div className="sam-empty-box">Loading product and trend breakdown...</div>
                      ) : (
                        <>
                          {(activity?.paymentBreakdown || []).length > 0 && (
                            <div className="sam-payment-chips">
                              {activity.paymentBreakdown.map((pm) => (
                                <div className="sam-payment-chip" key={pm.method}>
                                  <span>{pm.method} ({pm.ordersCount} orders)</span>
                                  <strong>{peso(pm.sales)}</strong>
                                </div>
                              ))}
                            </div>
                          )}

                          {seriesPoints.length > 0 && (
                            <div className="sam-series-bars" aria-label="Daily sales trend">
                              {seriesPoints.map((pt) => {
                                const heightPct = Math.max(4, Math.round((Number(pt.sales || 0) / maxSeriesSales) * 100));
                                return (
                                  <div className="sam-series-col" key={pt.date} title={`${pt.label}: ${peso(pt.sales)} (${pt.orders} orders)`}>
                                    <strong style={{ fontSize: "0.7rem" }}>{compactPeso(pt.sales)}</strong>
                                    <div className="sam-series-track">
                                      <div
                                        className="sam-series-fill"
                                        style={{ clipPath: `inset(${100 - heightPct}% 0 0 0 round 8px)` }}
                                      />
                                    </div>
                                    <span>{pt.label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {productsSold.length === 0 ? (
                            <div className="sam-empty-box">No paid items sold by {firstName} in this period.</div>
                          ) : (
                            <div className="sam-table-wrap">
                              <table className="sam-table">
                                <thead>
                                  <tr>
                                    <th>Product &amp; Size</th>
                                    <th>Units</th>
                                    <th>Sales</th>
                                    <th>Est. COGS</th>
                                    <th>Profit</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {productsSold.map((row, idx) => {
                                    const pct = Math.max(4, Math.round((Number(row.sales || 0) / maxProductSales) * 100));
                                    return (
                                      <tr key={`${row.productName}-${row.sizeLabel}-${idx}`}>
                                        <td style={{ minWidth: "180px" }}>
                                          <strong>{row.productName}</strong>
                                          <small style={{ color: "#7b6659", marginLeft: "6px" }}>({row.sizeLabel})</small>
                                          <div className="sam-gpu-bar-track">
                                            <div
                                              className="sam-gpu-bar-fill"
                                              style={{ clipPath: `inset(0 ${100 - pct}% 0 0 round 999px)` }}
                                            />
                                          </div>
                                        </td>
                                        <td>{row.unitsSold}</td>
                                        <td><strong>{peso(row.sales)}</strong></td>
                                        <td>{peso(row.cogs)}</td>
                                        <td>{peso(row.grossProfit)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {activeTab === "sessions" && (
                    <div>
                      {isWaitingActivity ? (
                        <div className="sam-empty-box">Loading register shifts...</div>
                      ) : !(activity?.sessions || []).length ? (
                        <div className="sam-empty-box">No cashier register shifts opened during this period.</div>
                      ) : (
                        <div className="sam-session-list">
                          {activity.sessions.map((sess) => {
                            const isOpen = sess.status === "open";
                            const hasVariance = sess.variance != null && Math.abs(sess.variance) >= 0.01;
                            const isExpanded = expandedSessionId === sess.id;
                            const details = sessionDetailsById[sess.id];

                            return (
                              <div className="sam-session-card" key={sess.id}>
                                <div className="sam-session-top">
                                  <div>
                                    <strong>Session #{sess.id} · {sess.terminalLabel || "Counter"}</strong>
                                    <div style={{ fontSize: "0.76rem", color: "#7b6659", marginTop: "2px" }}>
                                      Opened {formatDateTime(sess.openedAt)}
                                      {sess.closedAt ? ` · Closed ${formatDateTime(sess.closedAt)}` : " · Still Open"}
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span className={`sam-pill ${isOpen ? "status-active" : "role-staff"}`}>
                                      {isOpen ? "Open Shift" : "Closed"}
                                    </span>
                                    {!isOpen && sess.variance != null && (
                                      <span className={`sam-pill ${hasVariance ? "status-inactive" : "status-active"}`}>
                                        {hasVariance
                                          ? `Variance ${sess.variance > 0 ? "+" : ""}${peso(sess.variance)}`
                                          : "Balanced"}
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      className="sam-action-btn"
                                      onClick={() => handleToggleSession(sess.id)}
                                      aria-expanded={isExpanded}
                                    >
                                      {isExpanded ? "Hide Details" : "Inspect Shift"}
                                    </button>
                                  </div>
                                </div>

                                <div className="sam-session-metrics">
                                  <div><span>Opening Float</span><strong>{peso(sess.openingFloat)}</strong></div>
                                  <div><span>Expected Cash</span><strong>{peso(sess.expectedCash)}</strong></div>
                                  <div><span>Counted Cash</span><strong>{sess.countedCash != null ? peso(sess.countedCash) : "—"}</strong></div>
                                  <div><span>Orders</span><strong>{sess.ordersCount}</strong></div>
                                  <div><span>Paid Sales</span><strong>{peso(sess.paidSales)}</strong></div>
                                </div>

                                {isExpanded && (
                                  <div className="sam-session-inspector">
                                    {loadingSessionId === sess.id ? (
                                      <p style={{ margin: 0, fontSize: "0.8rem", color: "#7b6659" }}>Loading shift breakdown...</p>
                                    ) : details?.error ? (
                                      <p style={{ margin: 0, fontSize: "0.8rem", color: "#991b1b" }}>{details.error}</p>
                                    ) : (
                                      <>
                                        {details?.paymentBreakdown?.length > 0 && (
                                          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "10px", fontSize: "0.78rem" }}>
                                            {details.paymentBreakdown.map((pm) => (
                                              <span key={pm.method} className="sam-pill role-staff">
                                                {pm.method}: {peso(pm.sales)} ({pm.ordersCount})
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                        {details?.orders?.length > 0 ? (
                                          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                            {details.orders.map((ord) => (
                                              <button
                                                key={ord.id}
                                                type="button"
                                                className="sam-order-row-btn"
                                                onClick={(e) => handleOpenOrder(ord, e)}
                                              >
                                                #{ord.id} · {peso(ord.total)} ({ord.status})
                                              </button>
                                            ))}
                                          </div>
                                        ) : (
                                          <p style={{ margin: 0, fontSize: "0.78rem", color: "#7b6659" }}>
                                            No orders recorded during this shift.
                                          </p>
                                        )}
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {activeTab === "logs" && (
                    <div>
                      <div className="sam-filter-pills" role="group" aria-label="Filter activity log types">
                        {[
                          { key: "all", label: "All Logs" },
                          { key: "inventory", label: "Inventory Movements" },
                          { key: "stage", label: "Order Stage Actions" },
                        ].map((pill) => (
                          <button
                            key={pill.key}
                            type="button"
                            className={`sam-filter-pill ${logTypeFilter === pill.key ? "is-active" : ""}`}
                            aria-pressed={logTypeFilter === pill.key}
                            onClick={() => setLogTypeFilter(pill.key)}
                          >
                            {pill.label}
                          </button>
                        ))}
                      </div>

                      {isWaitingActivity ? (
                        <div className="sam-empty-box">Loading audit trail...</div>
                      ) : mergedLogs.length === 0 ? (
                        <div className="sam-empty-box">No inventory or order stage actions recorded in this period.</div>
                      ) : (
                        <ul className="sam-feed">
                          {mergedLogs.map((item) => {
                            if (item.kind === "inventory") {
                              const inv = item.entry;
                              const tone = getMovementTone(inv.type);
                              return (
                                <li className="sam-feed-item" key={item.key}>
                                  <div>
                                    <div>
                                      <span className={`sam-feed-badge ${tone}`}>
                                        <Package size={11} style={{ marginRight: "3px", verticalAlign: "-1px" }} aria-hidden="true" />
                                        {getMovementLabel(inv.type)}
                                      </span>
                                      <strong>{inv.itemName}</strong>
                                      {" "}
                                      <span>
                                        ({inv.quantityChange >= 0 ? "+" : ""}{inv.quantityChange} {inv.unit || ""})
                                      </span>
                                    </div>
                                    <div style={{ color: "#6b5447", marginTop: "4px", fontSize: "0.78rem" }}>
                                      {inv.beforeQuantity != null && inv.afterQuantity != null && (
                                        <span>Stock: {inv.beforeQuantity} → {inv.afterQuantity} {inv.unit || ""} · </span>
                                      )}
                                      {inv.batchCost != null && <span>Spend: {peso(inv.batchCost)} · </span>}
                                      {inv.supplierName && <span>Supplier: {inv.supplierName} · </span>}
                                      {inv.referenceNo && <span>Ref: {inv.referenceNo} · </span>}
                                      {inv.note}
                                      {inv.orderNumber && (
                                        <>
                                          {" "}
                                          <button
                                            type="button"
                                            className="sam-inline-link"
                                            onClick={(e) => handleOpenOrderByNumber(inv.orderNumber, e)}
                                          >
                                            Order #{inv.orderNumber}
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                  <small style={{ color: "#7b6659", whiteSpace: "nowrap" }}>
                                    {formatDateTime(item.timestamp)}
                                  </small>
                                </li>
                              );
                            }

                            const stg = item.entry;
                            const isCancelled = stg.toStatus === "Cancelled";
                            return (
                              <li className="sam-feed-item" key={item.key}>
                                <div>
                                  <div>
                                    <span className={`sam-feed-badge ${isCancelled ? "warning" : "neutral"}`}>
                                      Order Stage
                                    </span>
                                    <strong>
                                      {stg.fromStatus ? `${stg.fromStatus} -> ${stg.toStatus}` : stg.toStatus}
                                    </strong>
                                    {" "}
                                    <button
                                      type="button"
                                      className="sam-inline-link"
                                      onClick={(e) => handleOpenOrderByNumber(stg.orderNumber, e)}
                                    >
                                      #{stg.orderNumber}
                                    </button>
                                  </div>
                                  {stg.reason && (
                                    <div style={{ color: "#6b5447", marginTop: "4px", fontSize: "0.78rem" }}>
                                      {stg.reason}
                                    </div>
                                  )}
                                </div>
                                <small style={{ color: "#7b6659", whiteSpace: "nowrap" }}>
                                  {formatDateTime(item.timestamp)}
                                </small>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {activeOrder && (
        <OrderDetailsModal
          order={activeOrder}
          portal="admin"
          darkMode={darkMode}
          productImageByName={productImageByName}
          canVoid
          canViewCostBreakdown
          onConfirmOrder={async (ord) => {
            const updated = confirmOrder ? await confirmOrder(ord.id) : null;
            fetchActivity();
            return updated;
          }}
          onVoidOrder={async (ord, payload) => {
            const updated = voidOrder ? await voidOrder(ord.id, payload) : null;
            fetchActivity();
            return updated;
          }}
          triggerRef={orderTriggerRef}
          onClosed={() => setActiveOrder(null)}
        />
      )}
    </>
  );
}

export default StaffActivityModal;
