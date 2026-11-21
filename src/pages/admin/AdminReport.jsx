import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Download,
  Filter,
  Menu,
  Receipt,
  Search,
  X,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import StaffActivityModal from "../../components/StaffActivityModal.jsx";
import OrderDetailsModal from "../../components/OrderDetailsModal.jsx";
import { ReportRestockModal } from "../../components/admin/reports/ReportRestockModal.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import {
  getPaymentMethodLabel,
  getPaymentStatusLabel,
  useOrders,
} from "../../context/OrdersContext.jsx";
import { getInventoryStatus, useInventory } from "../../context/InventoryContext.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import { useBusiness } from "../../context/BusinessContext.jsx";
import { apiRequest } from "../../utils/api.js";
import { useNetIncomePin } from "../../hooks/useNetIncomePin.js";
import NetIncomePinModal from "../../components/NetIncomePinModal.jsx";
import { getStockHealth } from "../../utils/stockHealth.js";
import {
  compactPeso,
  downloadAuthenticatedCsv,
  getManilaDateInputValue,
  getMovementTone,
  initials,
  peso,
} from "../../utils/staffActivityFormatters.js";
import { usePrefersReducedMotion } from "../../utils/usePrefersReducedMotion.js";
import { DEFAULT_TARGET_FOOD_COST, normalizeTargetFoodCost } from "../../utils/menuCosting.js";
import {
  allocateRestockBudget,
  buildRestockSummary,
  computeRestockItemPlan,
  serializeRestockPlanItem,
  sortRestockSuggestions,
} from "../../../shared/restockSuggestion.js";
import "../../assets/css/admin/AdminReport.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const RANGE_OPTIONS = [
  { key: "today", label: "Today (Session)", bookmark: "TODAY" },
  { key: "7d", label: "7 days", bookmark: "7D" },
  { key: "30d", label: "30 days", bookmark: "30D" },
  { key: "all", label: "All Sessions", bookmark: "ALL TIME" },
  { key: "custom", label: "Custom", bookmark: "CUSTOM" },
];

const STOCK_FILTERS = ["all", "attention", "healthy"];

const ROSTER_FILTERS = [
  { key: "all", label: "All Staff" },
  { key: "with_sales", label: "With Sales" },
  { key: "inactive", label: "Inactive" },
];

const ROSTER_SORTS = [
  { key: "grossSales", label: "Sales (High -> Low)" },
  { key: "ordersCount", label: "Number of orders" },
  { key: "attributedGrossProfit", label: "Profit" },
  { key: "averageTicket", label: "Average order" },
  { key: "displayName", label: "Staff Name (A-Z)" },
];

const MOVEMENT_FILTERS = [
  { key: "", label: "All" },
  { key: "restock", label: "Restocked" },
  { key: "usage", label: "Used in orders" },
  { key: "spoilage", label: "Wasted" },
  { key: "adjustment", label: "Adjusted" },
  { key: "internal_use", label: "Store use" },
  { key: "void_restore", label: "Returned" },
];

const ORDER_STATUS_FILTERS = ["All", "Pending", "Preparing", "Completed", "Cancelled"];
const PAYMENT_METHOD_FILTERS = ["All", "Cash", "GCash", "Card"];

// Rows per page in the two history panels. Used for both the request and the page count.
const LEDGER_PAGE_SIZE = 10;

const MOVEMENT_PLAIN_LABELS = {
  restock: "Restocked",
  usage: "Used in an order",
  spoilage: "Wasted",
  adjustment: "Adjusted",
  internal_use: "Store use",
  void_restore: "Returned to stock",
};

function getMovementPlainLabel(mov) {
  const key = String(mov?.type || "").toLowerCase().trim();
  if (key === "spoilage" && (mov.orderId || mov.orderNumber)) return "Wasted (cancelled order)";
  return MOVEMENT_PLAIN_LABELS[key] || "Stock change";
}

// "Nov 18" and "7:25 PM" in Manila time. The year only appears when it is not the current year.
function splitLedgerDate(iso) {
  const parsed = iso ? new Date(iso) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return { day: "—", time: "" };
  const zone = { timeZone: "Asia/Manila" };
  const year = (value) => value.toLocaleDateString("en-US", { ...zone, year: "numeric" });
  const showYear = year(parsed) !== year(new Date());
  return {
    day: parsed.toLocaleDateString("en-US", { ...zone, month: "short", day: "numeric", ...(showYear ? { year: "numeric" } : {}) }),
    time: parsed.toLocaleTimeString("en-US", { ...zone, hour: "numeric", minute: "2-digit" }),
  };
}

function LedgerPager({ page, total, onPage, noun }) {
  if (!(total > 0)) return null;
  const pages = Math.max(1, Math.ceil(total / LEDGER_PAGE_SIZE));
  const from = (page - 1) * LEDGER_PAGE_SIZE + 1;
  const to = Math.min(total, page * LEDGER_PAGE_SIZE);
  return (
    <nav className="lg-pager" aria-label={`${noun} pages`}>
      <span>Showing {from}–{to} of {total.toLocaleString()}</span>
      {pages > 1 && (
        <div className="lg-pager-buttons">
          <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
          <span aria-current="page">Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
        </div>
      )}
    </nav>
  );
}

const RESTOCK_FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function niceCeil(value) {
  if (!(value > 0)) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function formatHourLabel(hour) {
  const normalized = ((hour % 24) + 24) % 24;
  if (normalized === 0) return "12 AM";
  if (normalized === 12) return "12 PM";
  return normalized < 12 ? `${normalized} AM` : `${normalized - 12} PM`;
}

function buildRangeSearchParams({ rangeKey, from, to, staffId, extra = {} }) {
  const params = new URLSearchParams();
  params.set("rangeKey", rangeKey);
  if (rangeKey === "custom") {
    if (from) params.set("from", from);
    if (to) params.set("to", to);
  }
  if (staffId) params.set("staffId", String(staffId));
  Object.entries(extra).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      params.set(k, String(v));
    }
  });
  return params;
}

function formatDeltaBadge(deltaObj, rangeKey) {
  if (rangeKey === "all" || !deltaObj) {
    return { text: "All-time total", tone: "flat" };
  }
  if (deltaObj.percent === null) {
    if (deltaObj.change > 0) return { text: "New vs ₱0.00 prior", tone: "up" };
    return { text: "No change", tone: "flat" };
  }
  if (deltaObj.percent === 0) return { text: "No change", tone: "flat" };
  return {
    text: `${deltaObj.percent > 0 ? "▲" : "▼"} ${Math.abs(deltaObj.percent).toFixed(1)}% vs prior`,
    tone: deltaObj.percent > 0 ? "up" : "down",
  };
}

function AdminReport() {
  const netIncomePin = useNetIncomePin();
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { orders = [], confirmOrder, voidOrder, revertOrderItem } = useOrders() || {};
  const { inventory = [], loading: inventoryLoading, error: inventoryError } = useInventory() || {};
  const { products: menuProducts = [] } = useMenu() || {};
  const { businessSettings } = useBusiness() || {};
  const lowThreshold = businessSettings?.lowStockThresholdPercent ?? 40;
  const criticalThreshold = businessSettings?.criticalStockThresholdPercent ?? 20;
  const prefersReducedMotion = usePrefersReducedMotion();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Period + Staff Filter State
  const [rangeKey, setRangeKey] = useState("all");
  const [customStart, setCustomStart] = useState(() => getManilaDateInputValue(-6));
  const [customEnd, setCustomEnd] = useState(() => getManilaDateInputValue(0));
  const [staffFilterId, setStaffFilterId] = useState(null);

  // Refresh nonce triggered by socketless mutation events or Confirm/Void actions
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Stock Section State
  const [stockFilter, setStockFilter] = useState("all");
  const [stockSort, setStockSort] = useState("name");

  // Restock Requisition Notebook Modal
  const [restockModalOpen, setRestockModalOpen] = useState(false);
  const [restockClosing, setRestockClosing] = useState(false);
  const [restockNotice, setRestockNotice] = useState("");
  const [restockLookbackDays, setRestockLookbackDays] = useState(14);
  const [restockCoverDays, setRestockCoverDays] = useState(7);
  const [restockBudget, setRestockBudget] = useState("");
  const [restockPackMode, setRestockPackMode] = useState(false);
  const [smartRestockState, setSmartRestockState] = useState({
    queryKey: "",
    data: null,
    error: "",
  });
  const restockTriggerRef = useRef(null);
  const restockDialogRef = useRef(null);
  const restockCloseTimerRef = useRef(null);

  // Products Show-All Toggle
  const [productsShowAll, setProductsShowAll] = useState(false);

  // Staff Attribution Roster Filters
  const [rosterFilter, setRosterFilter] = useState("all");
  const [rosterSort, setRosterSort] = useState("grossSales");

  // Modals State + Focus Triggers
  const [selectedStaffMember, setSelectedStaffMember] = useState(null);
  const staffTriggerRef = useRef(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const orderTriggerRef = useRef(null);

  // Export CSV state
  const [exportType, setExportType] = useState("orders");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportNotice, setExportNotice] = useState("");
  const [exportError, setExportError] = useState("");
  const exportTimerRef = useRef(null);

  // Period Inventory Activity Ledger Filters & Pagination
  const [movTypeFilter, setMovTypeFilter] = useState("");
  const [movSearch, setMovSearch] = useState("");
  const [movPage, setMovPage] = useState(1);

  // Period Order Ledger Filters & Pagination
  const [ordersSearch, setOrdersSearch] = useState("");
  const [ordersStatusFilter, setOrdersStatusFilter] = useState("All");
  const [ordersPaymentFilter, setOrdersPaymentFilter] = useState("All");
  const [ordersPage, setOrdersPage] = useState(1);

  // Core Summary + Staff + Products + Hourly State (keyed to eliminate sync setState in effect)
  const [coreState, setCoreState] = useState({
    queryKey: "",
    financial: null,
    staffPerf: null,
    productsData: null,
    hourlySalesData: null,
    error: "",
  });
  const [incomeStatementSummary, setIncomeStatementSummary] = useState(null);

  // Movements State
  const [movState, setMovState] = useState({
    queryKey: "",
    data: null,
    error: "",
  });

  // Orders Ledger State
  const [ordersState, setOrdersState] = useState({
    queryKey: "",
    data: null,
    error: "",
  });

  const customRangeInvalid = rangeKey === "custom" && Boolean(customStart && customEnd && customStart > customEnd);
  const rangeOption = RANGE_OPTIONS.find((option) => option.key === rangeKey) || RANGE_OPTIONS[0];

  const activeRangeParams = useMemo(() => ({
    rangeKey,
    from: rangeKey === "custom" ? customStart : undefined,
    to: rangeKey === "custom" ? customEnd : undefined,
    label: rangeKey === "custom" && customStart && customEnd ? `${customStart} to ${customEnd}` : rangeOption.label,
  }), [rangeKey, customStart, customEnd, rangeOption.label]);

  const coreQueryKey = `${rangeKey}|${customStart}|${customEnd}|${staffFilterId ?? "all"}|${refreshNonce}`;
  const movQueryKey = `${rangeKey}|${customStart}|${customEnd}|${staffFilterId ?? "all"}|${movTypeFilter}|${movSearch.trim()}|${movPage}|${refreshNonce}`;
  const ordersQueryKey = `${rangeKey}|${customStart}|${customEnd}|${staffFilterId ?? "all"}|${ordersStatusFilter}|${ordersPaymentFilter}|${ordersSearch.trim()}|${ordersPage}|${refreshNonce}`;
  const smartRestockQueryKey = `${restockLookbackDays}|${restockCoverDays}|${refreshNonce}`;
  const smartRestockLoading = restockModalOpen && smartRestockState.queryKey !== smartRestockQueryKey;

  useEffect(() => {
    if (customRangeInvalid) return undefined;
    let active = true;
    const params = new URLSearchParams();
    if (rangeKey === "today") {
      params.set("from", getManilaDateInputValue(0));
      params.set("to", getManilaDateInputValue(0));
    } else if (rangeKey === "7d") {
      params.set("from", getManilaDateInputValue(-6));
      params.set("to", getManilaDateInputValue(0));
    } else if (rangeKey === "30d") {
      params.set("from", getManilaDateInputValue(-29));
      params.set("to", getManilaDateInputValue(0));
    } else if (rangeKey === "custom") {
      if (customStart) params.set("from", customStart);
      if (customEnd) params.set("to", customEnd);
    }
    apiRequest(`/finances/accounts${params.size ? `?${params.toString()}` : ""}`, { headers: netIncomePin.financialHeaders })
      .then((data) => { if (active) setIncomeStatementSummary(data?.summary || null); })
      .catch(() => { if (active) setIncomeStatementSummary(null); });
    return () => { active = false; };
  }, [customEnd, customRangeInvalid, customStart, rangeKey, netIncomePin.financialHeaders]);

  const productImageByName = useMemo(() => {
    const map = new Map();
    (menuProducts || []).forEach((product) => {
      if (product?.name && product?.image) {
        map.set(String(product.name).trim().toLowerCase(), product.image);
      }
    });
    return map;
  }, [menuProducts]);

  // Listen to stock/order/session mutations across portal
  useEffect(() => {
    const bump = () => setRefreshNonce((n) => n + 1);
    window.addEventListener("amaya:stock-mutated", bump);
    window.addEventListener("amaya:session-changed", bump);
    return () => {
      window.removeEventListener("amaya:stock-mutated", bump);
      window.removeEventListener("amaya:session-changed", bump);
    };
  }, []);

  useEffect(() => () => {
    if (exportTimerRef.current) window.clearTimeout(exportTimerRef.current);
    if (restockCloseTimerRef.current) window.clearTimeout(restockCloseTimerRef.current);
  }, []);

  // Load Financial Summary, Staff Performance, Products, and Intra-day Hourly Orders for "today"
  useEffect(() => {
    if (customRangeInvalid) return undefined;
    let active = true;

    const summaryParams = buildRangeSearchParams({
      rangeKey,
      from: customStart,
      to: customEnd,
      staffId: staffFilterId,
    });
    const staffParams = buildRangeSearchParams({
      rangeKey,
      from: customStart,
      to: customEnd,
    });
    const productParams = buildRangeSearchParams({
      rangeKey,
      from: customStart,
      to: customEnd,
      staffId: staffFilterId,
      extra: { limit: 200, sortBy: "sales", sortDir: "desc" },
    });

    const isHourlyDay = rangeKey === "today" || (rangeKey === "custom" && customStart === customEnd);

    Promise.all([
      apiRequest(`/reports/financial-summary?${summaryParams.toString()}`),
      // Labor columns (payroll plan P3.4) need the Owner PIN; without it they come back empty.
      apiRequest(`/reports/staff-performance?${staffParams.toString()}`, { headers: netIncomePin.financialHeaders }),
      apiRequest(`/reports/products?${productParams.toString()}`),
      isHourlyDay
        ? apiRequest(`/reports/hourly-sales?${summaryParams.toString()}`)
        : Promise.resolve(null),
    ])
      .then(([financial, staffPerf, productsData, hourlySalesData]) => {
        if (!active) return;
        setCoreState({
          queryKey: coreQueryKey,
          financial,
          staffPerf,
          productsData,
          hourlySalesData,
          error: "",
        });
      })
      .catch((err) => {
        if (!active) return;
        setCoreState((prev) => ({
          ...prev,
          queryKey: coreQueryKey,
          error: err?.message || "Failed to load report metrics.",
        }));
      });

    return () => {
      active = false;
    };
  }, [coreQueryKey, customEnd, customRangeInvalid, customStart, rangeKey, staffFilterId, netIncomePin.financialHeaders]);

  // Load Period Inventory Activity Ledger
  useEffect(() => {
    if (customRangeInvalid) return undefined;
    let active = true;
    const params = buildRangeSearchParams({
      rangeKey,
      from: customStart,
      to: customEnd,
      staffId: staffFilterId,
      extra: {
        type: movTypeFilter || undefined,
        search: movSearch.trim() || undefined,
        page: movPage,
        limit: LEDGER_PAGE_SIZE,
      },
    });

    apiRequest(`/reports/inventory-activity?${params.toString()}`)
      .then((data) => {
        if (!active) return;
        setMovState({ queryKey: movQueryKey, data, error: "" });
      })
      .catch((err) => {
        if (!active) return;
        setMovState((prev) => ({
          ...prev,
          queryKey: movQueryKey,
          error: err?.message || "Failed to load inventory activity.",
        }));
      });

    return () => {
      active = false;
    };
  }, [customEnd, customRangeInvalid, customStart, movPage, movQueryKey, movSearch, movTypeFilter, rangeKey, staffFilterId]);

  // Load Period Order Ledger
  useEffect(() => {
    if (customRangeInvalid) return undefined;
    let active = true;
    const params = buildRangeSearchParams({
      rangeKey,
      from: customStart,
      to: customEnd,
      staffId: staffFilterId,
      extra: {
        status: ordersStatusFilter !== "All" ? ordersStatusFilter : undefined,
        paymentMethod: ordersPaymentFilter !== "All" ? ordersPaymentFilter : undefined,
        search: ordersSearch.trim() || undefined,
        page: ordersPage,
        limit: LEDGER_PAGE_SIZE,
      },
    });

    apiRequest(`/reports/orders?${params.toString()}`)
      .then((data) => {
        if (!active) return;
        setOrdersState({ queryKey: ordersQueryKey, data, error: "" });
      })
      .catch((err) => {
        if (!active) return;
        setOrdersState((prev) => ({
          ...prev,
          queryKey: ordersQueryKey,
          error: err?.message || "Failed to load period orders.",
        }));
      });

    return () => {
      active = false;
    };
  }, [customEnd, customRangeInvalid, customStart, ordersPage, ordersPaymentFilter, ordersQueryKey, ordersSearch, ordersStatusFilter, rangeKey, staffFilterId]);

  // Load Smart Restock Suggestions when Requisition Notebook is open
  useEffect(() => {
    if (!restockModalOpen) return undefined;
    let active = true;
    const controller = new AbortController();
    const params = new URLSearchParams({
      lookbackDays: String(restockLookbackDays),
      coverDays: String(restockCoverDays),
    });

    apiRequest(`/reports/restock-suggestions?${params.toString()}`, { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setSmartRestockState({
          queryKey: smartRestockQueryKey,
          data,
          error: "",
        });
      })
      .catch((err) => {
        if (!active || err?.name === "AbortError") return;
        setSmartRestockState({
          queryKey: smartRestockQueryKey,
          data: null,
          error: err?.message || "Smart forecast unavailable — showing static low-stock refills.",
        });
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [restockCoverDays, restockLookbackDays, restockModalOpen, smartRestockQueryKey]);

  // Mobile nav Escape dismiss
  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  // Restock Notebook Modal focus management & trap
  const closeRestockModal = useCallback(() => {
    if (!restockModalOpen || restockClosing) return;
    setRestockClosing(true);
    restockCloseTimerRef.current = window.setTimeout(() => {
      setRestockClosing(false);
      setRestockModalOpen(false);
      const trigger = restockTriggerRef.current;
      if (trigger && typeof trigger.focus === "function") {
        window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
      }
    }, prefersReducedMotion ? 125 : 165);
  }, [prefersReducedMotion, restockClosing, restockModalOpen]);

  useEffect(() => {
    if (!restockModalOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = window.requestAnimationFrame(() => {
      restockDialogRef.current?.focus({ preventScroll: true });
    });

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRestockModal();
        return;
      }
      if (event.key !== "Tab" || !restockDialogRef.current) return;
      const focusables = [...restockDialogRef.current.querySelectorAll(RESTOCK_FOCUSABLE)]
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusables.length) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === restockDialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeRestockModal, restockModalOpen]);

  const liveDate = useMemo(() => new Date().toLocaleDateString("en-US", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "numeric",
    year: "numeric",
  }), []);

  const generatedStamp = useMemo(() => new Date().toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }), []);

  const summary = coreState.financial?.summary || {
    grossCollectedSales: 0,
    grossSales: 0,
    discountTotal: 0,
    taxCollected: 0,
    netSales: 0,
    cogs: 0,
    spoilageCost: 0,
    salesCogs: 0,
    totalCogs: 0,
    grossProfit: 0,
    reconciledGrossProfit: 0,
    marginPercent: 0,
    paidOrdersCount: 0,
    unpaidOrdersCount: 0,
    voidedOrdersCount: 0,
    voidedSalesTotal: 0,
    unitsSold: 0,
    averageOrderValue: 0,
    cashCollected: 0,
    gcashCollected: 0,
    cardCollected: 0,
    uncostedItemsCount: 0,
    inventoryExpenditure: 0,
    inventoryRestockCount: 0,
    inventoryAssetValue: 0,
    targetFoodCost: 0.3,
  };

  const deltas = coreState.financial?.deltas ?? null;
  const isCoreLoading = !customRangeInvalid && coreState.queryKey !== coreQueryKey && !coreState.error;

  const foodCostAnalysis = useMemo(() => {
    const grossSales = Number(summary.netSales ?? summary.grossCollectedSales ?? 0);
    const cogs = Number(summary.cogs || 0);
    const normalizedTarget = normalizeTargetFoodCost(
      summary.targetFoodCost,
      DEFAULT_TARGET_FOOD_COST,
    );
    const targetPct = normalizedTarget * 100;
    const hasSales = Number.isFinite(grossSales) && grossSales > 0;
    const rawActualPct = hasSales && Number.isFinite(cogs) ? (cogs / grossSales) * 100 : null;
    const actualPct = rawActualPct !== null ? Number(rawActualPct.toFixed(1)) : null;
    const rawDiffPts = rawActualPct !== null ? rawActualPct - targetPct : null;
    const variancePts = rawDiffPts !== null ? Number(rawDiffPts.toFixed(1)) : null;
    const hasUncosted = Number(summary.uncostedItemsCount || 0) > 0;

    let varianceLabel = "";
    let isOverTarget = false;
    if (rawDiffPts !== null) {
      if (Math.abs(rawDiffPts) < 0.05 || Math.abs(variancePts) === 0) {
        varianceLabel = "On target";
      } else if (variancePts > 0) {
        varianceLabel = `${variancePts.toFixed(1)}% above goal`;
        isOverTarget = true;
      } else {
        varianceLabel = `${Math.abs(variancePts).toFixed(1)}% below goal`;
      }
    }

    return {
      targetPct,
      actualPct,
      variancePts,
      varianceLabel,
      isOverTarget,
      hasUncosted,
    };
  }, [summary.cogs, summary.netSales, summary.grossCollectedSales, summary.targetFoodCost, summary.uncostedItemsCount]);

  const staffList = useMemo(
    () => (Array.isArray(coreState.staffPerf?.staff) ? coreState.staffPerf.staff : []),
    [coreState.staffPerf],
  );

  const selectedFilterStaff = useMemo(
    () => (staffFilterId ? staffList.find((s) => Number(s.userId) === Number(staffFilterId)) || null : null),
    [staffFilterId, staffList],
  );

  const staffById = useMemo(() => {
    const map = new Map();
    staffList.forEach((member) => {
      map.set(Number(member.userId), member);
    });
    return map;
  }, [staffList]);

  // Filtered & sorted staff roster
  const visibleStaffRoster = useMemo(() => {
    const filtered = staffList.filter((member) => {
      if (rosterFilter === "with_sales") return member.ordersCount > 0 || member.grossSales > 0;
      if (rosterFilter === "inactive") return !member.isActive;
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      if (rosterSort === "displayName") {
        return String(a.displayName || "").localeCompare(String(b.displayName || ""));
      }
      const diff = Number(b[rosterSort] || 0) - Number(a[rosterSort] || 0);
      return diff !== 0 ? diff : Number(a.userId || 0) - Number(b.userId || 0);
    });
    return sorted;
  }, [rosterFilter, rosterSort, staffList]);

  const staffRosterTotals = useMemo(() => {
    const t = coreState.staffPerf?.totals;
    if (t) {
      return {
        ordersCount: Number(t.ordersCount || 0),
        grossSales: Number(t.grossSales || 0),
        averageTicket: t.ordersCount > 0 ? Number(t.grossSales || 0) / Number(t.ordersCount) : 0,
        activeWithSales: staffList.filter((m) => m.ordersCount > 0).length,
      };
    }
    return { ordersCount: 0, grossSales: 0, averageTicket: 0, activeWithSales: 0 };
  }, [coreState.staffPerf, staffList]);

  // Trend chart series: intra-day hourly for today/single-day custom, server series otherwise
  const trendSeries = useMemo(() => {
    const isHourlyDay = rangeKey === "today" || (rangeKey === "custom" && customStart === customEnd);
    if (isHourlyDay) {
      const hourBuckets = Array.from({ length: 24 }, (_, hr) => ({
        key: `hr-${hr}`,
        label: formatHourLabel(hr),
        sales: 0,
        orders: 0,
        isHourly: true,
      }));
      const hours = Array.isArray(coreState.hourlySalesData?.hours) ? coreState.hourlySalesData.hours : [];
      hours.forEach((entry) => {
        const hr = Number(entry?.hour);
        if (Number.isInteger(hr) && hr >= 0 && hr < 24) {
          hourBuckets[hr].sales += Number(entry.sales || 0);
          hourBuckets[hr].orders += Number(entry.ordersCount || 0);
        }
      });
      return hourBuckets;
    }

    const rawSeries = Array.isArray(coreState.financial?.series) ? coreState.financial.series : [];
    if (rawSeries.length <= 45) {
      return rawSeries.map((pt) => ({
        key: pt.date,
        label: pt.label || pt.date,
        sales: Number(pt.sales || 0),
        orders: Number(pt.orders || 0),
        isHourly: false,
      }));
    }

    // Group long All-Time timelines cleanly so SVG bars remain crisp
    const chunkSize = Math.ceil(rawSeries.length / 36);
    const grouped = [];
    for (let i = 0; i < rawSeries.length; i += chunkSize) {
      const slice = rawSeries.slice(i, i + chunkSize);
      const sales = slice.reduce((sum, s) => sum + Number(s.sales || 0), 0);
      const ordersCnt = slice.reduce((sum, s) => sum + Number(s.orders || 0), 0);
      grouped.push({
        key: slice[0].date,
        label: slice[0].label || slice[0].date,
        sales,
        orders: ordersCnt,
        isHourly: false,
      });
    }
    return grouped;
  }, [coreState.financial, coreState.hourlySalesData, customEnd, customStart, rangeKey]);

  const trend = useMemo(() => {
    const width = 760;
    const height = 250;
    const padLeft = 62;
    const padRight = 14;
    const padTop = 18;
    const padBottom = 30;
    const innerWidth = width - padLeft - padRight;
    const innerHeight = height - padTop - padBottom;
    const slotWidth = trendSeries.length ? innerWidth / trendSeries.length : innerWidth;
    const barWidth = Math.min(44, Math.max(6, slotWidth * 0.65));
    const ceiling = niceCeil(Math.max(...trendSeries.map((bucket) => bucket.sales), 0));

    const isHourly = trendSeries[0]?.isHourly;
    const points = trendSeries.map((bucket, index) => {
      const x = padLeft + (index + 0.5) * slotWidth;
      const y = padTop + innerHeight - (ceiling > 0 ? (bucket.sales / ceiling) * innerHeight : 0);
      return {
        ...bucket,
        x,
        y,
        barX: x - barWidth / 2,
        barWidth,
        barHeight: Math.max(0, padTop + innerHeight - y),
      };
    });

    const baseline = padTop + innerHeight;
    const gridLines = Array.from({ length: 4 }, (_, index) => {
      const ratio = index / 3;
      return {
        y: padTop + innerHeight - ratio * innerHeight,
        value: ceiling * ratio,
        isBaseline: index === 0,
      };
    });

    let axisStep = 1;
    if (isHourly) axisStep = 3;
    else if (points.length > 24) axisStep = 5;
    else if (points.length > 14) axisStep = 3;

    const lastIndex = points.length - 1;
    const labelledPoints = points.map((point, index) => ({
      ...point,
      showLabel: index % axisStep === 0 || index === lastIndex,
    }));

    const best = points.reduce((top, pt) => (pt.sales > (top?.sales || 0) ? pt : top), points[0] || null);
    return { width, height, padLeft, padRight, baseline, points, labelledPoints, gridLines, best };
  }, [trendSeries]);

  const channels = useMemo(
    () => (Array.isArray(coreState.financial?.channels) ? coreState.financial.channels : []),
    [coreState.financial],
  );
  const topChannelSales = channels[0]?.sales || 0;

  const rankedProducts = useMemo(
    () => (Array.isArray(coreState.productsData?.items) ? coreState.productsData.items : []),
    [coreState.productsData],
  );
  const displayedProducts = useMemo(
    () => (productsShowAll ? rankedProducts : rankedProducts.slice(0, 8)),
    [productsShowAll, rankedProducts],
  );

  // Stock Health Live Snapshot
  const pendingCount = useMemo(
    () => orders.filter((order) => order.status === "Pending").length,
    [orders],
  );

  const stockReport = useMemo(() => {
    return inventory.map((entry) => {
      const status = getInventoryStatus(entry.quantity, entry.maximumStock);
      const quantity = Number(entry.quantity || 0);
      const parsedMaximumStock = entry.maximumStock == null || entry.maximumStock === "" ? null : Number(entry.maximumStock);
      const maximumStock = Number.isFinite(parsedMaximumStock) && parsedMaximumStock > 0 ? parsedMaximumStock : null;
      const { capacityPercent, reportedPercent, tone: healthTone } = getStockHealth(
        quantity,
        maximumStock,
        { overMaximum: status === "Over Maximum", lowThreshold, criticalThreshold },
      );
      const isOut = status === "Out of Stock" || quantity <= 0;
      const effectiveHealthTone = isOut ? "critical" : healthTone;
      const healthLabel = status === "Over Maximum"
        ? "Above maximum"
        : status === "Out of Stock"
          ? "Out of stock"
          : effectiveHealthTone === "untracked"
            ? "Maximum not set"
            : effectiveHealthTone === "critical"
              ? "Critical"
              : effectiveHealthTone === "low"
                ? "Running low"
                : effectiveHealthTone === "moderate"
                  ? "Moderate"
                  : "Healthy";
      const needsAttention = status !== "In Stock" || effectiveHealthTone === "critical" || effectiveHealthTone === "low";
      return {
        id: entry.id,
        item: entry.item,
        category: entry.category,
        quantity,
        unit: entry.unit,
        maximumStock,
        capacityPercent: isOut && capacityPercent == null ? 0 : capacityPercent,
        reportedPercent: isOut && reportedPercent == null ? 0 : reportedPercent,
        healthTone: effectiveHealthTone,
        tone: status === "In Stock" ? "available" : status === "Over Maximum" ? "over" : "critical",
        needsAttention,
        label: healthLabel,
      };
    });
  }, [criticalThreshold, inventory, lowThreshold]);

  const restockItems = useMemo(() => stockReport
    .filter((item) => item.tone === "critical" || item.healthTone === "critical" || item.healthTone === "low")
    .sort((a, b) => {
      const aPriority = a.quantity <= 0 ? 0 : a.healthTone === "critical" ? 1 : 2;
      const bPriority = b.quantity <= 0 ? 0 : b.healthTone === "critical" ? 1 : 2;
      return aPriority - bPriority || String(a.item || "").localeCompare(String(b.item || ""));
    }), [stockReport]);

  const inventoryById = useMemo(() => {
    const map = new Map();
    (inventory || []).forEach((entry) => {
      map.set(Number(entry.id), entry);
    });
    return map;
  }, [inventory]);

  const isSmartRestockActive = Boolean(smartRestockState.data && !smartRestockState.error);

  const baseModalRestockItems = useMemo(() => {
    if (isSmartRestockActive && Array.isArray(smartRestockState.data?.items)) {
      return smartRestockState.data.items;
    }
    const fallbackPlans = restockItems.map((item) => {
      const rawEntry = inventoryById.get(Number(item.id)) || item;
      return computeRestockItemPlan({
        item: rawEntry,
        totalConsumed: 0,
        lookbackDays: restockLookbackDays,
        coverDays: restockCoverDays,
        lowThreshold,
        criticalThreshold,
      });
    });
    return sortRestockSuggestions(fallbackPlans).map(serializeRestockPlanItem);
  }, [
    criticalThreshold,
    inventoryById,
    isSmartRestockActive,
    lowThreshold,
    restockCoverDays,
    restockItems,
    restockLookbackDays,
    smartRestockState.data,
  ]);

  const hasPackItems = useMemo(
    () => baseModalRestockItems.some(
      (item) => Number(item.contentsPerPackage) > 1 && Number(item.purchasePrice) > 0,
    ),
    [baseModalRestockItems],
  );
  const effectivePackMode = hasPackItems && restockPackMode;

  const smartRestockSummary = useMemo(() => {
    if (isSmartRestockActive && smartRestockState.data?.summary && !effectivePackMode) {
      return smartRestockState.data.summary;
    }
    if (effectivePackMode) {
      const packAdjusted = baseModalRestockItems.map((item) => {
        const hasPack = Number(item.contentsPerPackage) > 1 && item.packEstimatedCost != null && Number(item.recommendedPacks) > 0;
        return hasPack ? { ...item, estimatedCost: item.packEstimatedCost } : item;
      });
      return buildRestockSummary(packAdjusted);
    }
    return buildRestockSummary(baseModalRestockItems);
  }, [baseModalRestockItems, effectivePackMode, isSmartRestockActive, smartRestockState.data]);

  const budgetAllocation = useMemo(
    () => allocateRestockBudget(baseModalRestockItems, restockBudget, { usePackMode: effectivePackMode }),
    [baseModalRestockItems, effectivePackMode, restockBudget],
  );

  const modalRestockItems = budgetAllocation.items;

  const stockBreakdown = useMemo(() => ({
    total: stockReport.length,
    over: stockReport.filter((item) => item.tone === "over").length,
    critical: stockReport.filter((item) => item.tone === "critical").length,
    attention: stockReport.filter((item) => item.needsAttention).length,
    healthy: stockReport.filter((item) => !item.needsAttention).length,
  }), [stockReport]);

  const visibleStock = useMemo(() => {
    const filtered = stockFilter === "attention"
      ? stockReport.filter((item) => item.needsAttention)
      : stockFilter === "healthy"
        ? stockReport.filter((item) => !item.needsAttention)
        : stockReport;
    const byName = (a, b) => String(a.item || "").localeCompare(String(b.item || ""));
    const sorters = {
      name: byName,
      category: (a, b) => String(a.category || "").localeCompare(String(b.category || "")) || byName(a, b),
      low: (a, b) => {
        if (a.reportedPercent == null) return b.reportedPercent == null ? byName(a, b) : 1;
        if (b.reportedPercent == null) return -1;
        return a.reportedPercent - b.reportedPercent || byName(a, b);
      },
      high: (a, b) => {
        if (a.reportedPercent == null) return b.reportedPercent == null ? byName(a, b) : 1;
        if (b.reportedPercent == null) return -1;
        return b.reportedPercent - a.reportedPercent || byName(a, b);
      },
      status: (a, b) => {
        const priority = { critical: 0, low: 1, over: 2, moderate: 3, available: 4, untracked: 5 };
        return (priority[a.healthTone] ?? 6) - (priority[b.healthTone] ?? 6) || byName(a, b);
      },
    };
    return [...filtered].sort(sorters[stockSort] || byName);
  }, [stockFilter, stockReport, stockSort]);

  const insights = useMemo(() => {
    const notes = [];
    if (trend.best?.sales > 0) {
      notes.push({
        tone: "positive",
        label: trend.best.isHourly ? "Peak hour" : "Best day",
        value: `${trend.best.label} · ${peso(trend.best.sales)}`,
      });
    }
    if (channels[0]?.ordersCount) {
      notes.push({
        tone: "neutral",
        label: "Top channel",
        value: `${channels[0].type} · ${Math.round(channels[0].sharePercent)}% of sales`,
      });
    }
    if (rankedProducts[0]) {
      const p = rankedProducts[0];
      notes.push({
        tone: "neutral",
        label: "Best seller",
        value: `${p.productName}${p.sizeLabel ? ` (${p.sizeLabel})` : ""} · ${p.unitsSold} sold`,
      });
    }
    if (foodCostAnalysis.actualPct != null) {
      notes.push({
        tone: foodCostAnalysis.hasUncosted || foodCostAnalysis.isOverTarget ? "warning" : "positive",
        label: "Ingredient cost target",
        value: `${foodCostAnalysis.actualPct.toFixed(1)}% actual vs ${Number(foodCostAnalysis.targetPct.toFixed(2))}% goal (${foodCostAnalysis.varianceLabel}${foodCostAnalysis.hasUncosted ? " · missing some unit costs" : ""})`,
      });
    }
    if (restockItems.length || stockBreakdown.over) {
      notes.push({
        tone: "warning",
        label: "Stock alerts",
        value: `${stockBreakdown.attention} item${stockBreakdown.attention === 1 ? "" : "s"} need review`,
      });
    }
    return notes;
  }, [channels, foodCostAnalysis, rankedProducts, restockItems.length, stockBreakdown.attention, stockBreakdown.over, trend.best]);

  const salesTrend = formatDeltaBadge(deltas?.grossCollectedSales, rangeKey);
  const avgTrend = formatDeltaBadge(deltas?.averageOrderValue, rangeKey);
  const orderTrend = formatDeltaBadge(deltas?.paidOrdersCount, rangeKey);

  const handleExportCsv = async (typeToExport) => {
    if (exportBusy || customRangeInvalid) return;
    setExportBusy(true);
    setExportError("");
    const extra = { type: typeToExport };
    if (typeToExport === "orders") {
      if (ordersStatusFilter && ordersStatusFilter !== "All") extra.status = ordersStatusFilter;
      if (ordersPaymentFilter && ordersPaymentFilter !== "All") extra.paymentMethod = ordersPaymentFilter;
      if (ordersSearch.trim()) extra.search = ordersSearch.trim();
    } else if (typeToExport === "inventory") {
      if (movTypeFilter) extra.movementType = movTypeFilter;
      if (movSearch.trim()) extra.search = movSearch.trim();
    }
    const params = buildRangeSearchParams({
      rangeKey,
      from: customStart,
      to: customEnd,
      staffId: staffFilterId,
      extra,
    });
    const stamp = getManilaDateInputValue(0);
    const filename = `amaya-${typeToExport}-report-${rangeKey}-${stamp}.csv`;

    try {
      const meta = await downloadAuthenticatedCsv(`/reports/export.csv?${params.toString()}`, filename);
      if (meta?.truncated) {
        setExportNotice(`Exported first ${meta.exportedCount} of ${meta.totalCount} rows (5,000-row cap)`);
      } else {
        setExportNotice(`Exported ${typeToExport} CSV`);
      }
      if (exportTimerRef.current) window.clearTimeout(exportTimerRef.current);
      exportTimerRef.current = window.setTimeout(() => setExportNotice(""), 4500);
    } catch (err) {
      setExportError(err?.message || "Failed to download CSV export.");
    } finally {
      setExportBusy(false);
    }
  };

  const handleCopyRestockList = async () => {
    if (!modalRestockItems.length) return;
    const now = new Date();
    const dateStamp = getManilaDateInputValue(0);
    const hasBudget = budgetAllocation.budgetProvided != null;
    const lines = [
      isSmartRestockActive ? "AMAYA SMART RESTOCK LIST" : "AMAYA RESTOCK LIST (STATIC FALLBACK)",
      `Generated: ${now.toLocaleString()}`,
      `Sales window: Last ${restockLookbackDays} days | Cover target: ${restockCoverDays} days | Unit mode: ${effectivePackMode ? "Full Packs" : "Stock Units"}`,
      hasBudget
        ? `Budget today: ₱${budgetAllocation.budgetProvided.toFixed(2)} | Allocated: ₱${budgetAllocation.allocatedTotalCost.toFixed(2)} | Remaining: ₱${budgetAllocation.budgetRemaining.toFixed(2)}`
        : `Total estimated cost: ₱${smartRestockSummary.totalEstimatedCost.toFixed(2)}${smartRestockSummary.uncostedItemsCount ? ` (${smartRestockSummary.uncostedItemsCount} uncosted)` : ""}`,
      `Items needing restock: ${modalRestockItems.length}`,
      "",
      ...modalRestockItems.flatMap((item, index) => {
        const displayCost = hasBudget ? item.allocatedCost : (effectivePackMode && item.packEstimatedCost != null && item.recommendedPacks > 0 ? item.packEstimatedCost : item.estimatedCost);
        const packNote = item.recommendedPacks != null && item.recommendedPacks > 0
          ? ` (${item.recommendedPacks} ${item.packageUnit || "pack"}${item.recommendedPacks === 1 ? "" : "s"} = ${item.packTotalQty.toLocaleString()} ${item.unit})`
          : "";
        return [
          `${index + 1}. ${item.item} [${item.label}]`,
          `   Category: ${item.category || "Uncategorized"} | Basis: ${item.basis === "velocity" ? "Velocity" : "Max Refill"}${item.lowData ? " | Low data" : ""}${item.exceedsMaxStock ? " | Exceeds max" : ""}`,
          `   On hand: ${item.quantity.toLocaleString()} ${item.unit} | Max: ${item.maximumStock == null ? "Not set" : `${item.maximumStock.toLocaleString()} ${item.unit}`}`,
          `   Avg daily usage: ${item.avgDailyUsage > 0 ? `${item.avgDailyUsage.toLocaleString()} ${item.unit}/day` : "0"}${item.daysOfStockLeft != null ? ` (~${item.daysOfStockLeft}d left)` : ""}`,
          `   Suggested buy: +${item.suggestedBuyQty.toLocaleString()} ${item.unit}${packNote}`,
          ...(hasBudget ? [`   Budget allocation: +${item.allocatedQty.toLocaleString()} ${item.unit} (${item.allocationStatus})`] : []),
          `   Estimated cost: ${item.costKnown && displayCost != null ? `₱${Number(displayCost).toFixed(2)}` : "No cost set"}`,
          "",
        ];
      }),
    ];
    const restockText = lines.join("\n");
    const url = URL.createObjectURL(new Blob([restockText], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `amaya-restock-list-${dateStamp}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    try {
      await navigator.clipboard.writeText(restockText);
      setRestockNotice("Restock list copied and downloaded as a .txt file for Notepad.");
    } catch {
      setRestockNotice("Restock list downloaded as a .txt file for Notepad. Clipboard access was unavailable.");
    }
  };

  const handleRangeChange = (nextKey) => {
    setRangeKey(nextKey);
    setOrdersPage(1);
    setMovPage(1);
  };

  const handleOpenStaffModal = (member, event) => {
    if (!member) return;
    staffTriggerRef.current = event?.currentTarget || null;
    setSelectedStaffMember(member);
  };

  const handleOpenOrderModal = (orderRow, event) => {
    if (!orderRow) return;
    orderTriggerRef.current = event?.currentTarget || null;
    setSelectedOrder(orderRow);
  };

  const movSummary = movState.data?.summary || {
    totalMovements: 0,
    totalRestockCost: 0,
    totalRestockCount: 0,
    totalAdjustmentCount: 0,
    totalUsageCount: 0,
    totalSpoilageCount: 0,
    totalVoidRestoreCount: 0,
    totalInternalUseCount: 0,
  };
  const movItems = Array.isArray(movState.data?.items) ? movState.data.items : [];
  const movTotal = Number(movState.data?.total || 0);

  const ledgerOrders = Array.isArray(ordersState.data?.items) ? ordersState.data.items : [];
  const ledgerOrdersTotal = Number(ordersState.data?.total || 0);

  return (
    <div className={`admin-report-page ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
      {mobileNavOpen && (
        <div
          className="report-mobile-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        role="admin"
        activeTab="reports"
        orderCount={pendingCount}
        sidebarCollapsed={mobileNavOpen ? false : sidebarCollapsed}
        onToggle={() => {
          if (mobileNavOpen) {
            setMobileNavOpen(false);
          } else {
            toggleSidebar();
          }
        }}
      />

      <main className="admin-report-main">
        <header className="admin-report-topbar">
          <div className="admin-report-topbar-title">
            <div className="report-topbar-title-row">
              <button
                type="button"
                className="report-mobile-menu-btn"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation menu"
              >
                <Menu size={21} aria-hidden="true" />
              </button>
              <span className="admin-report-section-label">
                <i className="topbar-label-pin" aria-hidden="true" />
                ADMIN PORTAL
              </span>
            </div>
            <h1>Sales &amp; Inventory Reports</h1>
          </div>
          <div className="admin-report-topbar-actions">
            <div className="admin-report-date report-pinned-date">
              <span className="report-date-pin" aria-hidden="true" />
              <span>REPORT DATE</span>
              <strong>{liveDate}</strong>
              <small>Generated {generatedStamp}</small>
            </div>
          </div>
        </header>

        <div className="admin-report-content">
          {selectedFilterStaff && (
            <div className="report-cross-filter-banner" role="region" aria-label="Staff cross-filter">
              <div className="report-cross-filter-copy">
                <Filter size={15} aria-hidden="true" />
                <span>
                  Filtered to <strong>{selectedFilterStaff.displayName}</strong>
                  {" "}
                  ({selectedFilterStaff.role === "admin" ? "Admin" : "Cashier"})
                </span>
              </div>
              <div className="report-cross-filter-actions">
                <button
                  type="button"
                  className="report-cross-filter-btn secondary"
                  onClick={(e) => handleOpenStaffModal(selectedFilterStaff, e)}
                >
                  Inspect Activity Logbook
                </button>
                <button
                  type="button"
                  className="report-cross-filter-btn"
                  onClick={() => {
                    setStaffFilterId(null);
                    setOrdersPage(1);
                    setMovPage(1);
                  }}
                >
                  <X size={14} aria-hidden="true" />
                  Clear Filter
                </button>
              </div>
            </div>
          )}

          {coreState.error && (
            <div className="report-inline-alert" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{coreState.error}</span>
            </div>
          )}

          <div className="admin-report-hero-grid">
            <section className="admin-report-panel trend-panel report-notebook-sheet" aria-label="Revenue trend">
              <div className="report-notebook-spine" aria-hidden="true">
                {Array.from({ length: 8 }).map((_, idx) => (
                  <span key={idx} className="report-spine-ring">
                    <i className="report-spine-hole" />
                    <b className="report-spine-wire" />
                  </span>
                ))}
              </div>

              <div className="report-notebook-bookmark" aria-hidden="true">
                <span className="report-bookmark-eyelet" />
                <span className="report-bookmark-text">{rangeOption.bookmark}</span>
              </div>

              <div className="report-notebook-page">
                <div className="panel-heading trend-heading">
                  <div>
                    <span className="admin-report-eyebrow">SALES CHART</span>
                    <h2>
                      {rangeKey === "today"
                        ? "Today's Hourly Sales"
                        : rangeKey === "all"
                          ? "All-Time Sales"
                          : rangeKey === "custom"
                            ? "Custom Date Sales"
                            : `Last ${rangeOption.label} Sales`}
                    </h2>
                    <span className="trend-hero-total">{peso(summary.grossCollectedSales)}</span>
                  </div>
                  <div className="trend-heading-actions">
                    <div className="admin-report-range" role="tablist" aria-label="Reporting period">
                      {RANGE_OPTIONS.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          role="tab"
                          aria-selected={option.key === rangeKey}
                          className={option.key === rangeKey ? "active" : ""}
                          onClick={() => handleRangeChange(option.key)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    <div className="report-export-group">
                      <select
                        value={exportType}
                        onChange={(e) => setExportType(e.target.value)}
                        aria-label="CSV export report type"
                        className="report-export-select"
                      >
                        <option value="orders">Orders CSV</option>
                        <option value="staff">Staff CSV</option>
                        <option value="products">Products CSV</option>
                        <option value="inventory">Inventory CSV</option>
                      </select>
                      <button
                        type="button"
                        className="admin-report-export"
                        onClick={() => handleExportCsv(exportType)}
                        disabled={exportBusy || customRangeInvalid}
                      >
                        <Download size={14} aria-hidden="true" />
                        <span>{exportBusy ? "Exporting..." : exportNotice || "Export CSV"}</span>
                      </button>
                    </div>
                  </div>
                </div>

                {exportError && (
                  <div className="report-inline-alert compact" role="alert">
                    <AlertTriangle size={14} aria-hidden="true" />
                    <span>{exportError}</span>
                  </div>
                )}

                {rangeKey === "custom" && (
                  <div className="admin-report-custom-row">
                    <div className="custom-input-group">
                      <label htmlFor="custom-report-start">From</label>
                      <input
                        id="custom-report-start"
                        type="date"
                        value={customStart}
                        onChange={(e) => {
                          setCustomStart(e.target.value);
                          setOrdersPage(1);
                          setMovPage(1);
                        }}
                        className="admin-report-datetime-input"
                      />
                    </div>
                    <div className="custom-input-group">
                      <label htmlFor="custom-report-end">To</label>
                      <input
                        id="custom-report-end"
                        type="date"
                        value={customEnd}
                        onChange={(e) => {
                          setCustomEnd(e.target.value);
                          setOrdersPage(1);
                          setMovPage(1);
                        }}
                        className="admin-report-datetime-input"
                      />
                    </div>
                    <span className="custom-range-hint">
                      {customRangeInvalid
                        ? "Start date must be on or before end date"
                        : customStart === customEnd
                          ? "Single-day hourly breakdown (Manila)"
                          : "Daily Manila breakdown"}
                    </span>
                  </div>
                )}

                {customRangeInvalid ? (
                  <div className="admin-report-empty" role="alert">
                    <span>!</span>
                    <strong>Invalid custom date range</strong>
                    <p>Ensure the &ldquo;From&rdquo; date is on or before the &ldquo;To&rdquo; date.</p>
                  </div>
                ) : isCoreLoading ? (
                  <div className="admin-report-empty">
                    <span>▥</span>
                    <strong>Loading period ledger...</strong>
                    <p>Fetching server-computed financials across settled orders.</p>
                  </div>
                ) : summary.paidOrdersCount > 0 ? (
                  <div className="report-trend" key={`${rangeKey}-${staffFilterId ?? "all"}`}>
                    <svg
                      className="report-trend-chart"
                      viewBox={`0 0 ${trend.width} ${trend.height}`}
                      role="img"
                      aria-label={`Revenue trend across ${trend.points.length} periods, totalling ${peso(summary.grossCollectedSales)} and peaking at ${peso(trend.best?.sales || 0)}`}
                    >
                      {trend.gridLines.map((line) => (
                        <line
                          key={line.y}
                          x1={trend.padLeft}
                          y1={line.y}
                          x2={trend.width - trend.padRight}
                          y2={line.y}
                          className={line.isBaseline ? "report-trend-grid baseline" : "report-trend-grid"}
                        />
                      ))}

                      {trend.gridLines.map((line) => (
                        <text
                          key={`label-${line.y}`}
                          x={trend.padLeft - 10}
                          y={line.y}
                          className="report-trend-axis-label"
                          textAnchor="end"
                          dominantBaseline="middle"
                        >
                          {compactPeso(line.value)}
                        </text>
                      ))}

                      {trend.points.map((point, index) => (
                        <rect
                          key={point.key}
                          x={point.barX}
                          y={point.barHeight > 0 ? point.y : trend.baseline - 2}
                          width={point.barWidth}
                          height={Math.max(point.barHeight, 2)}
                          rx="4"
                          style={{ "--bar-index": Math.min(index, 24) }}
                          className={`report-trend-bar${index === trend.points.length - 1 ? " latest" : ""}${point.sales === 0 ? " zero" : ""}`}
                        >
                          <title>{`${point.label} · ${peso(point.sales)} · ${point.orders} order${point.orders === 1 ? "" : "s"}`}</title>
                        </rect>
                      ))}

                      {trend.labelledPoints.map((point) => (point.showLabel ? (
                        <text
                          key={`x-${point.key}`}
                          x={point.x}
                          y={trend.height - 8}
                          className="report-trend-axis-label"
                          textAnchor="middle"
                        >
                          {point.label}
                        </text>
                      ) : null))}
                    </svg>
                  </div>
                ) : (
                  <div className="admin-report-empty">
                    <span>▥</span>
                    <strong>No collected sales recorded for this period</strong>
                    <p>Settled orders placed during {rangeOption.label.toLowerCase()} will appear here automatically.</p>
                  </div>
                )}
              </div>
            </section>

            <div className="admin-report-panel sales-summary report-pinned-paper">
              <div className="report-paper-pin crimson" aria-hidden="true">
                <span className="pin-shadow" />
                <span className="pin-needle" />
                <span className="pin-collar" />
                <span className="pin-head">
                  <span className="pin-glint" />
                </span>
              </div>

              <div className="report-paper-bookmark" aria-hidden="true">
                <span className="paper-bookmark-hole" />
                <span className="paper-bookmark-label">LEDGER</span>
              </div>

              <div className="report-paper-inner">
                <div className="panel-heading">
                  <div>
                    <span className="admin-report-eyebrow">SALES SUMMARY</span>
                    <h2>
                      {rangeKey === "today"
                        ? "Today's Active Session"
                        : rangeKey === "all"
                          ? "All Sessions (All-Time)"
                          : rangeKey === "custom"
                            ? "Custom Range"
                            : `Last ${rangeOption.label}`}
                    </h2>
                  </div>
                  <span className="report-panel-icon">₱</span>
                </div>

                {summary.uncostedItemsCount > 0 && (
                  <div className="report-uncosted-warning" role="status">
                    <AlertTriangle size={13} aria-hidden="true" />
                    <span>
                      {summary.uncostedItemsCount} unit{summary.uncostedItemsCount === 1 ? "" : "s"} missing ingredient cost · cost is incomplete
                    </span>
                  </div>
                )}

                <div className="sales-metrics">
                  <div>
                    <span>
                      Total Sales
                      {(Number(summary.taxCollected || 0) > 0 || Number(summary.discountTotal || 0) > 0) && (
                        <small style={{ display: "block", fontSize: "10.5px", fontWeight: 600, color: "#85776c" }}>
                          Before tax: {peso(summary.netSales)} · Tax: {peso(summary.taxCollected)}
                        </small>
                      )}
                    </span>
                    <strong>{peso(summary.grossCollectedSales)}</strong>
                  </div>
                  <div>
                    <span title="Cost of goods sold (COGS): ingredient cost of what you sold, plus the cost of wasted stock">
                      Cost to make (sales + waste)
                      <small style={{ display: "block", fontSize: "10.5px", fontWeight: 600, color: "#85776c" }}>
                        Ingredients: {peso(summary.salesCogs)} · Wasted stock: {peso(summary.spoilageCost)}
                      </small>
                    </span>
                    <strong>{peso(summary.totalCogs ?? summary.cogs)}</strong>
                  </div>
                  <div>
                    <span className="sales-metric-label-with-badge" title="COGS %: how much of every peso of sales goes to cost to make, including waste. Lower is better">
                      Cost to make % (including waste)
                      {foodCostAnalysis.hasUncosted && (
                        <span
                          className="report-partial-cogs-badge"
                          title="One or more sold units are missing Inventory or Menu unit costs"
                        >
                          Incomplete cost
                        </span>
                      )}
                    </span>
                    <strong>
                      {foodCostAnalysis.actualPct != null ? (
                        <>
                          {foodCostAnalysis.actualPct.toFixed(1)}% (Goal: {Number(foodCostAnalysis.targetPct.toFixed(2))}%){" "}
                          <small
                            className={`sales-cost-variance-tag ${
                              foodCostAnalysis.isOverTarget ? "is-over-target" : "is-on-target"
                            }`}
                          >
                            ({foodCostAnalysis.varianceLabel})
                          </small>
                        </>
                      ) : (
                        "—"
                      )}
                    </strong>
                  </div>
                  <div>
                    <span title="Gross profit: total sales minus the cost to make, before other expenses">
                      Profit after cost to make
                    </span>
                    <strong>
                      {peso(summary.grossProfit)}
                      {" "}
                      <small className="sales-margin-tag">({Number(summary.marginPercent || 0).toFixed(1)}%)</small>
                    </strong>
                  </div>
                  <div>
                    <span title="Total sales divided by the number of paid orders">Average order</span>
                    <strong>{peso(summary.averageOrderValue)}</strong>
                  </div>
                  <div>
                    <span>Cash / GCash / Card</span>
                    <strong>
                      {compactPeso(summary.cashCollected)} · {compactPeso(summary.gcashCollected)} · {compactPeso(summary.cardCollected)}
                    </strong>
                  </div>
                  <div>
                    <span>Cancelled Orders</span>
                    <strong className={summary.voidedOrdersCount > 0 ? "due" : ""}>
                      {summary.voidedOrdersCount} ({peso(summary.voidedSalesTotal)})
                    </strong>
                  </div>
                  <div>
                    <span>Stock Purchases ({summary.inventoryRestockCount})</span>
                    <strong>{peso(summary.inventoryExpenditure)}</strong>
                  </div>
                </div>
              </div>
            </div>

            <section className="admin-report-stats" aria-label="Summary metrics">
              <div className="report-kpi-slip tone-green">
                <span className="kpi-slip-pin green" aria-hidden="true" />
                <span className="report-stat-mark green">✓</span>
                <div>
                  <small>Items Sold</small>
                  <strong>{Number(summary.unitsSold || 0).toLocaleString()}</strong>
                  <span className="report-stat-note flat">
                    {`Across ${summary.paidOrdersCount} paid order${summary.paidOrdersCount === 1 ? "" : "s"}${summary.unpaidOrdersCount > 0 ? ` · ${summary.unpaidOrdersCount} unpaid` : ""}`}
                  </span>
                </div>
              </div>
              <div className="report-kpi-slip tone-plum">
                <span className="kpi-slip-pin plum" aria-hidden="true" />
                <span className="report-stat-mark plum">₱</span>
                <div>
                  <small>Total Sales</small>
                  <strong>{peso(summary.grossCollectedSales)}</strong>
                  <span className={`report-stat-note ${salesTrend.tone}`}>{salesTrend.text}</span>
                  {Number(summary.taxCollected || 0) > 0 && (
                    <span className="report-stat-note flat">
                      Before tax: {peso(summary.netSales)} · Tax: {peso(summary.taxCollected)}
                    </span>
                  )}
                </div>
              </div>
              <div className="report-kpi-slip tone-amber">
                <span className="kpi-slip-pin amber" aria-hidden="true" />
                <span className="report-stat-mark amber">◷</span>
                <div>
                  <small title="Total sales divided by the number of paid orders">Average order</small>
                  <strong>{peso(summary.averageOrderValue)}</strong>
                  <span className={`report-stat-note ${avgTrend.tone}`}>{avgTrend.text}</span>
                </div>
              </div>
              <div className="report-kpi-slip tone-blue">
                <span className="kpi-slip-pin blue" aria-hidden="true" />
                <span className="report-stat-mark blue">▤</span>
                <div>
                  <small>Completed Orders</small>
                  <strong>{Number(summary.paidOrdersCount || 0).toLocaleString()}</strong>
                  <span className={`report-stat-note ${orderTrend.tone}`}>{orderTrend.text}</span>
                </div>
              </div>
            </section>
            <section className="report-income-statement report-income-statement--wide" aria-label="Income Statement Preparation">
                <div>
                  <span className="admin-report-eyebrow" title="Income statement: a summary of what the store earned and spent">YOUR PROFIT, STEP BY STEP</span>
                  <h3>How much did the store earn?</h3>
                </div>
                <div className="report-income-formula">
                  <span>Total Sales <strong>{peso(incomeStatementSummary?.netSalesRevenue ?? summary.netSales ?? 0)}</strong></span>
                  <b aria-hidden="true">−</b>
                  <span title="Cost of goods sold (COGS): ingredient cost of items sold, plus wasted stock">Cost to make, including waste <strong>{incomeStatementSummary?.profitLocked ? "₱••••••" : peso(incomeStatementSummary?.cogs ?? summary.totalCogs ?? summary.cogs ?? 0)}</strong></span>
                  <b aria-hidden="true">=</b>
                  <span title="Gross profit: sales minus cost to make, before other expenses">Profit before expenses <strong>{incomeStatementSummary?.profitLocked ? "₱••••••" : peso(incomeStatementSummary?.grossProfit ?? summary.grossProfit ?? 0)}</strong></span>
                  <b aria-hidden="true">−</b>
                  <span title="Operating expenses: everyday costs of running the store, such as rent, salaries and utilities">Running costs <strong>{incomeStatementSummary?.profitLocked ? "₱••••••" : peso(incomeStatementSummary?.totalOperatingExpenses ?? incomeStatementSummary?.operatingExpenses ?? 0)}</strong></span>
                  <b aria-hidden="true">−</b>
                  <span title="Depreciation: equipment losing value over time. Income tax: tax on the store's profit">Equipment wear &amp; tax <strong>{incomeStatementSummary?.profitLocked ? "₱••••••" : peso(Number(incomeStatementSummary?.depreciation || 0) + Number(incomeStatementSummary?.tax || 0))}</strong></span>
                  <b aria-hidden="true">=</b>
                  <span className="report-income-net" title="Net income: what the store keeps after all costs and tax">Take-home profit <strong>{netIncomePin.unlocked && incomeStatementSummary?.netIncome != null ? peso(incomeStatementSummary.netIncome) : "₱••••••"}</strong></span>
                </div>
                <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.unlocked ? netIncomePin.lock() : netIncomePin.setModalOpen(true)}>
                  {netIncomePin.unlocked ? "🔒 Lock / Hide Net Income" : "🔒 View Net Income"}
                </button>
                {netIncomePin.unlocked && <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.setModalOpen(true)}>Change PIN</button>}
                </section>
          </div>

          <div className="admin-report-middle-grid">
            <section className="admin-report-sales-layout" aria-label="Sales breakdown">
              <div className="admin-report-panel channel-panel report-folio-sheet">
                <div className="report-paper-pin amber compact" aria-hidden="true">
                  <span className="pin-shadow" />
                  <span className="pin-needle" />
                  <span className="pin-collar" />
                  <span className="pin-head">
                    <span className="pin-glint" />
                  </span>
                </div>
                <div className="panel-heading">
                  <div>
                    <span className="admin-report-eyebrow" title="How customers ordered, such as dine-in or take-out">ORDER TYPES</span>
                    <h2>Where orders come from</h2>
                  </div>
                  <span className="inventory-count">{channels.length} {channels.length === 1 ? "type" : "types"}</span>
                </div>

                <div className="report-breakdown" key={`mix-${rangeKey}-${staffFilterId ?? "all"}`}>
                  {channels.length ? channels.map((channel, idx) => {
                    const relPct = topChannelSales > 0 ? Math.max(6, Math.min(100, (channel.sales / topChannelSales) * 100)) : 0;
                    const clipRight = Math.max(0, 100 - relPct);
                    return (
                      <div className="report-breakdown-row" key={channel.type} style={{ "--bar-index": idx }}>
                        <div className="report-breakdown-head">
                          <strong>{channel.type}</strong>
                          <span>
                            {channel.ordersCount} order{channel.ordersCount === 1 ? "" : "s"} · {peso(channel.sales)}
                          </span>
                        </div>
                        <div className="report-breakdown-track">
                          <div
                            className="report-breakdown-bar"
                            style={{ clipPath: `inset(0 ${clipRight.toFixed(2)}% 0 0 round 999px)` }}
                          />
                        </div>
                        <small>{Math.round(channel.sharePercent || 0)}% of sales</small>
                      </div>
                    );
                  }) : (
                    <div className="admin-report-empty compact">
                      <strong>No channel data yet</strong>
                    </div>
                  )}
                </div>

                <div className="report-status-row">
                  <div className="report-status-pill completed">
                    <strong>{summary.paidOrdersCount}</strong>
                    <span>Paid</span>
                  </div>
                  <div className="report-status-pill pending">
                    <strong>{summary.unpaidOrdersCount}</strong>
                    <span>Unpaid</span>
                  </div>
                  <div className="report-status-pill voided">
                    <strong>{summary.voidedOrdersCount}</strong>
                    <span>Cancelled</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="admin-report-panel products-panel report-folio-sheet" aria-label="Ranked product performance">
              <div className="report-folio-bookmark amber" aria-hidden="true">
                <span className="folio-bookmark-hole" />
                <span className="folio-bookmark-label">TOP</span>
              </div>
              <div className="panel-heading folio-heading-padded">
                <div>
                  <span className="admin-report-eyebrow">PRODUCT SALES</span>
                  <h2 title="Items ranked by how much they earned, with the profit on each">Best sellers</h2>
                </div>
                <div className="report-panel-head-actions">
                  <span className="inventory-count">{rankedProducts.length} items</span>
                  {rankedProducts.length > 8 && (
                    <button
                      type="button"
                      className="report-toggle-all-btn"
                      onClick={() => setProductsShowAll((v) => !v)}
                    >
                      {productsShowAll ? "Show Top 8" : `Show all ${rankedProducts.length}`}
                    </button>
                  )}
                </div>
              </div>

              {displayedProducts.length ? (
                <div className="inventory-table-wrap">
                  <table className="inventory-table report-products-table">
                    <thead>
                      <tr>
                        <th scope="col" title="Rank by sales, highest first">Rank</th>
                        <th scope="col">Product</th>
                        <th scope="col">Category</th>
                        <th scope="col" title="How many were sold in this period">Sold</th>
                        <th scope="col" title="Menu price of the item, plus the price of any add-ons">Price + add-ons</th>
                        <th scope="col" title="Money collected from selling this item">Sales</th>
                        <th scope="col" title="Cost of goods sold: the ingredient and packaging cost of the items sold">Cost to make</th>
                        <th scope="col" title="Gross profit: sales minus cost to make. The percentage is profit out of sales">Profit</th>
                        <th scope="col" title="How much of your total sales this item brought in">% of sales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedProducts.map((product, index) => {
                        const sharePct = summary.grossCollectedSales > 0
                          ? (product.sales / summary.grossCollectedSales) * 100
                          : 0;
                        const clipRight = Math.max(0, 100 - Math.max(4, Math.min(100, sharePct)));
                        return (
                          <tr key={`${product.productId || product.productName}-${product.sizeLabel}`}>
                            <td><span className="report-rank">{index + 1}</span></td>
                            <td>
                              <div className="report-product-title-cell">
                                <span>{product.productName}</span>
                                <small>{product.sizeLabel || "Regular"}</small>
                              </div>
                            </td>
                            <td>{product.category}</td>
                            <td>{product.unitsSold}</td>
                            <td>
                              {peso(product.baseSales)}
                              {product.addonSales > 0 && (
                                <small className="report-sub-addon"> +{peso(product.addonSales)}</small>
                              )}
                            </td>
                            <td>{peso(product.sales)}</td>
                            <td>
                              {peso(product.cogs)}
                              {product.uncostedItemsCount > 0 && (
                                <span
                                  className="report-uncosted-mini"
                                  title={`${product.uncostedItemsCount} sold unit(s) missing cost data`}
                                >
                                  Partial
                                </span>
                              )}
                            </td>
                            <td>
                              {peso(product.grossProfit)}
                              <small className="report-margin-mini"> ({Number(product.marginPercent || 0).toFixed(1)}%)</small>
                            </td>
                            <td>
                              <span className="report-share">
                                <span className="report-share-track">
                                  <span
                                    className="report-share-bar"
                                    style={{ clipPath: `inset(0 ${clipRight.toFixed(2)}% 0 0 round 999px)` }}
                                  />
                                </span>
                                {Math.round(sharePct)}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="admin-report-empty">
                  <span>◔</span>
                  <strong>No product sales in this period</strong>
                  <p>Once paid orders are placed, your best sellers and their profit will appear here.</p>
                </div>
              )}
            </section>
          </div>

          {/* Operations Spread: Cashier Shift Logbook (Left) + Stock Health Notebook (Right) */}
          <div className="admin-report-ops-spread">
            <section className="admin-report-panel cashier-panel report-folio-sheet" aria-label="Cashier attribution report">
            <div className="cashier-logbook-spine" aria-hidden="true">
              <span className="logbook-spine-rivet" />
              <span className="logbook-spine-stamp">LOG · STAFF</span>
              <span className="logbook-spine-rivet" />
            </div>

            <div className="report-folio-bookmark sage" aria-hidden="true">
              <span className="folio-bookmark-hole" />
              <span className="folio-bookmark-label">STAFF</span>
            </div>

            <div className="cashier-logbook-page">
              <div className="panel-heading cashier-panel-heading folio-heading-padded">
                <div>
                  <span className="admin-report-eyebrow" title="Sales and profit credited to each staff member who handled the order">STAFF SALES · SHIFT LOGBOOK</span>
                  <h2>Cashiers &amp; Staff Activity</h2>
                  <p className="cashier-panel-description">
                    Click any team member to see their shifts, sales, cost to make, orders, and stock changes.
                  </p>
                  {coreState.staffPerf?.laborLocked ? (
                    <p className="cashier-panel-description">
                      🔒 Wages, sales per labor hour and profit after wages are hidden.{" "}
                      <button type="button" className="net-income-gate-button" onClick={() => netIncomePin.setModalOpen(true)}>Show with Owner PIN</button>
                    </p>
                  ) : coreState.staffPerf?.totals?.laborCost != null && (
                    <p className="cashier-panel-description">
                      Wages of staff linked to a POS login: {peso(coreState.staffPerf.totals.laborCost)} · profit after wages {peso(coreState.staffPerf.totals.profitAfterWages)}.
                    </p>
                  )}
                </div>
                <span className="cashier-active-note">
                  {staffRosterTotals.activeWithSales} {staffRosterTotals.activeWithSales === 1 ? "member" : "members"} with sales
                </span>
              </div>

              <div className="cashier-summary-bar" aria-label="Cashier sales summary">
                <div className="cashier-summary-item">
                  <span className="cashier-summary-label">Orders</span>
                  <strong className="cashier-summary-val">{staffRosterTotals.ordersCount.toLocaleString()}</strong>
                </div>
                <div className="cashier-summary-item revenue">
                  <span className="cashier-summary-label" title="Total sales credited to staff who handled the orders">Staff sales</span>
                  <strong className="cashier-summary-val">{peso(staffRosterTotals.grossSales)}</strong>
                </div>
                <div className="cashier-summary-item">
                  <span className="cashier-summary-label" title="Average amount per order">Average order</span>
                  <strong className="cashier-summary-val">{peso(staffRosterTotals.averageTicket)}</strong>
                </div>
              </div>

              <div className="cashier-roster-toolbar">
                <div className="cashier-filter-group" role="group" aria-label="Filter staff roster">
                  {ROSTER_FILTERS.map((rf) => (
                    <button
                      key={rf.key}
                      type="button"
                      className={`cashier-filter-pill ${rosterFilter === rf.key ? "is-active" : ""}`}
                      aria-pressed={rosterFilter === rf.key}
                      onClick={() => setRosterFilter(rf.key)}
                    >
                      {rf.label}
                    </button>
                  ))}
                </div>
                <label className="cashier-sort-control">
                  <span>Sort by</span>
                  <select
                    value={rosterSort}
                    onChange={(e) => setRosterSort(e.target.value)}
                    aria-label="Sort staff roster"
                  >
                    {ROSTER_SORTS.map((rs) => (
                      <option key={rs.key} value={rs.key}>{rs.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              {visibleStaffRoster.length ? (
                <div className="cashier-table-wrap">
                  <div className="cashier-bar-list" key={`cashier-bars-${rangeKey}-${rosterFilter}-${rosterSort}`}>
                    <div className="cashier-bar-ruler" aria-hidden="true">
                      <div className="cashier-bar-ruler-label">SHIFT LEDGER · SHARE OF SALES</div>
                      <div className="cashier-bar-ruler-scale">
                        <div>0%</div>
                        <div>25%</div>
                        <div>50%</div>
                        <div>75%</div>
                        <div>100%</div>
                      </div>
                    </div>

                    {visibleStaffRoster.map((cashier, index) => {
                      const sharePct = Math.round(Number(cashier.sharePercent || 0));
                      const barWidth = cashier.grossSales > 0 ? Math.max(4, Math.min(100, Number(cashier.sharePercent || 0))) : 0;
                      const clipRight = Math.max(0, 100 - barWidth);
                      const rankNum = String(index + 1).padStart(2, "0");
                      const isZero = !(cashier.grossSales > 0);
                      const tone = !cashier.isActive
                        ? "inactive"
                        : isZero
                          ? "zero-sales"
                          : index === 0
                            ? "lead"
                            : index === 1
                              ? "second"
                              : "standard";
                      const isFilteredHere = Number(staffFilterId) === Number(cashier.userId);

                      return (
                        <button
                          type="button"
                          className={`cashier-bar-row ${tone}${isFilteredHere ? " is-filtered" : ""}`}
                          key={cashier.userId}
                          style={{ "--bar-index": Math.min(index, 5) }}
                          onClick={(e) => handleOpenStaffModal(cashier, e)}
                          aria-label={`Inspect ${cashier.displayName} activity logs (${peso(cashier.grossSales)}, ${cashier.ordersCount} orders)`}
                        >
                          <span className="cashier-bar-top">
                            <span className="cashier-bar-identity">
                              <span className="cashier-crest">
                                <span className="cashier-rank" title={isZero ? "No sales in this period" : `Ranked #${index + 1} by sales`}>{isZero ? "–" : rankNum}</span>
                                <span className="cashier-avatar" aria-hidden="true">{initials(cashier.displayName)}</span>
                              </span>
                              <span className="cashier-name-group">
                                <span className="cashier-name-line">
                                  <span className="cashier-name">{cashier.displayName}</span>
                                  {tone === "lead" && <span className="cashier-lead-seal">Top Cashier</span>}
                                  {!cashier.isActive && <span className="cashier-status-pill inactive">Inactive</span>}
                                  {cashier.role === "admin" && <span className="cashier-status-pill role">Admin</span>}
                                  {isFilteredHere && <span className="cashier-status-pill filtered">Filtered</span>}
                                  {cashier.ordersCount > 0 && (
                                    Number(cashier.unconfirmedOrdersCount || 0) > 0 ? (
                                      <span
                                        className="cashier-status-pill unconfirmed"
                                        title="Paid orders the owner has not yet confirmed"
                                        style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #f59e0b" }}
                                      >
                                        ⏳ {cashier.unconfirmedOrdersCount} to confirm ({peso(cashier.unconfirmedSales)})
                                      </span>
                                    ) : (
                                      <span
                                        className="cashier-status-pill confirmed"
                                        title="The owner has confirmed all of this person's paid orders"
                                        style={{ background: "#dcfce7", color: "#166534", border: "1px solid #86efac" }}
                                      >
                                        ✓ All confirmed
                                      </span>
                                    )
                                  )}
                                </span>
                                <span className="cashier-meta-inline">
                                  <span>{cashier.ordersCount} {cashier.ordersCount === 1 ? "order" : "orders"}</span>
                                  <span className="cashier-meta-dot" aria-hidden="true">·</span>
                                  <span title="Average amount per order">Average order {peso(cashier.averageTicket)}</span>
                                  <span className="cashier-meta-dot" aria-hidden="true">·</span>
                                  <span>Profit {peso(cashier.attributedGrossProfit)} ({Number(cashier.marginPercent || 0).toFixed(1)}%)</span>
                                  {cashier.laborCost != null && (
                                    <>
                                      <span className="cashier-meta-dot" aria-hidden="true">·</span>
                                      <span title="Employer cost of payroll runs ending in this range: gross pay, employer contributions and 13th month">Wages {peso(cashier.laborCost)}</span>
                                      {cashier.salesPerLaborHour != null && (
                                        <>
                                          <span className="cashier-meta-dot" aria-hidden="true">·</span>
                                          <span title="Sales on this person's orders divided by the hours paid">{peso(cashier.salesPerLaborHour)} per labor hour</span>
                                        </>
                                      )}
                                      <span className="cashier-meta-dot" aria-hidden="true">·</span>
                                      <span title="Profit on this person's orders minus their wages" style={{ color: cashier.profitAfterWages < 0 ? "#b91c1c" : undefined }}>After wages {peso(cashier.profitAfterWages)}</span>
                                    </>
                                  )}
                                  {cashier.voidedOrdersCount > 0 && (
                                    <>
                                      <span className="cashier-meta-dot" aria-hidden="true">·</span>
                                      <span className="cashier-void-flag">{cashier.voidedOrdersCount} cancelled</span>
                                    </>
                                  )}
                                </span>
                              </span>
                            </span>
                            <span className="cashier-bar-figures">
                              <span className="cashier-bar-revenue">{peso(cashier.grossSales)}</span>
                              <span className="cashier-bar-pct-badge">{sharePct}%</span>
                              <span className="cashier-inspect-chip">
                                Inspect logs
                                <ArrowRight size={12} aria-hidden="true" />
                              </span>
                            </span>
                          </span>

                          <span
                            className="cashier-bar-track"
                            aria-hidden="true"
                          >
                            <span className="cashier-bar-ticks" aria-hidden="true">
                              <span />
                              <span />
                              <span />
                            </span>
                            <span
                              className={`cashier-bar-fill ${tone}`}
                              style={{ clipPath: `inset(0 ${clipRight.toFixed(2)}% 0 0 round 999px)` }}
                            />
                            {barWidth > 0 && (
                              <span
                                className="cashier-bar-pip-carrier"
                                aria-hidden="true"
                                style={{ transform: `translateX(${(barWidth - 100).toFixed(2)}%)` }}
                              >
                                <span className="cashier-bar-pip" />
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="admin-report-empty">
                  <span>◎</span>
                  <strong>No matching staff accounts</strong>
                  <p>Switch roster filters above or reset to view inactive and zero-sales cashiers.</p>
                </div>
              )}
            </div>
          </section>

          {/* Right: Live Inventory Stock Health Notebook */}
          <section className="admin-report-panel inventory-panel report-notebook-sheet" aria-label="Inventory report">
            <div className="report-notebook-spine" aria-hidden="true">
              {Array.from({ length: 10 }).map((_, idx) => (
                <span key={idx} className="report-spine-ring">
                  <i className="report-spine-hole" />
                  <b className="report-spine-wire" />
                </span>
              ))}
            </div>

            <div className="report-notebook-bookmark" aria-hidden="true">
              <span className="report-bookmark-eyelet" />
              <span className="report-bookmark-text">STOCK</span>
            </div>

            <div className="report-notebook-page">
              <div className="panel-heading inventory-panel-heading">
                <div>
                  <span className="admin-report-eyebrow">INVENTORY REPORT</span>
                  <h2>Stock health</h2>
                  <p className="inventory-panel-description">
                    Live ingredient stock · Total stock value {peso(summary.inventoryAssetValue)}.
                  </p>
                </div>
                <div className="inventory-panel-actions">
                  <button
                    type="button"
                    className="restock-open-button"
                    onClick={(e) => {
                      restockTriggerRef.current = e.currentTarget;
                      setRestockNotice("");
                      setRestockClosing(false);
                      setRestockModalOpen(true);
                    }}
                    aria-haspopup="dialog"
                    aria-label={`View restock list, ${restockItems.length} items need restock`}
                  >
                    View restock list <span>{restockItems.length}</span>
                  </button>
                </div>
              </div>

              {/* Little Straight Overview Bar (4 Metrics) */}
              <div className="stock-overview-bar" aria-label="Inventory summary">
                <div className="stock-overview-item">
                  <span className="stock-overview-label">Tracked</span>
                  <strong className="stock-overview-val">{stockBreakdown.total}</strong>
                </div>
                <div className="stock-overview-item healthy" title="Items that are not low, out of stock, or above the maximum. Moderate counts as healthy.">
                  <span className="stock-overview-dot healthy" aria-hidden="true" />
                  <span className="stock-overview-label">Healthy</span>
                  <strong className="stock-overview-val">{stockBreakdown.healthy}</strong>
                </div>
                <div className="stock-overview-item critical" title="Items that are low or out of stock and need restocking">
                  <span className="stock-overview-dot critical" aria-hidden="true" />
                  <span className="stock-overview-label">Low &amp; Out</span>
                  <strong className="stock-overview-val">{restockItems.length}</strong>
                </div>
                <div className="stock-overview-item over">
                  <span className="stock-overview-dot over" aria-hidden="true" />
                  <span className="stock-overview-label">Above Max</span>
                  <strong className="stock-overview-val">{stockBreakdown.over}</strong>
                </div>
              </div>

              {/* Minimal Toolbar (Controls only, legend moved to ruler) */}
              <div className="stock-list-toolbar">
                <div className="stock-filter-tabs" role="tablist" aria-label="Filter stock report">
                  {STOCK_FILTERS.map((filter) => {
                    const count = filter === "all"
                      ? stockBreakdown.total
                      : filter === "attention"
                        ? stockBreakdown.attention
                        : stockBreakdown.healthy;

                    return (
                      <button
                        key={filter}
                        type="button"
                        role="tab"
                        aria-selected={filter === stockFilter}
                        className={filter === stockFilter ? "active" : ""}
                        onClick={() => setStockFilter(filter)}
                      >
                        {filter === "all" ? "All items" : filter === "attention" ? "Needs attention" : "Healthy"}
                        <span>{count}</span>
                      </button>
                    );
                  })}
                </div>

                <label className="stock-sort-control">
                  <span>Sort by</span>
                  <select value={stockSort} onChange={(event) => setStockSort(event.target.value)} aria-label="Sort inventory items">
                    <option value="name">Item name</option>
                    <option value="category">Category</option>
                    <option value="low">Stock level: low to high</option>
                    <option value="high">Stock level: high to low</option>
                    <option value="status">Health status</option>
                  </select>
                </label>
              </div>

              {inventoryLoading && inventory.length === 0 ? (
                <div className="admin-report-empty"><strong>Loading stock levels</strong><p>Fetching the latest inventory quantities.</p></div>
              ) : inventoryError && inventory.length === 0 ? (
                <div className="admin-report-empty" role="alert"><strong>Inventory report unavailable</strong><p>{inventoryError}</p></div>
              ) : visibleStock.length ? (
                <div className="stock-table-wrap">
                  <div className="stock-bar-list" key={`stock-bars-${stockFilter}-${stockSort}`}>
                    {/* Logbook Scale Ruler Header with Integrated Health Legend */}
                    <div className="stock-bar-ruler" aria-hidden="true">
                      <div className="stock-bar-ruler-top">
                        <div className="stock-bar-ruler-label">STOCK LEVEL · % OF MAXIMUM</div>
                        <div className="stock-bar-ruler-legend" title="Bar colour shows how full the stock is: red up to 20%, orange up to 40%, yellow up to 70%, green above 70%">
                          <span className="stock-ruler-dot critical" /> ≤20%
                          <span className="stock-ruler-dot low" /> ≤40%
                          <span className="stock-ruler-dot moderate" /> ≤70%
                          <span className="stock-ruler-dot available" /> &gt;70%
                        </div>
                      </div>
                      <div className="stock-bar-ruler-scale">
                        <div>0%</div>
                        <div>25%</div>
                        <div>50%</div>
                        <div>75%</div>
                        <div>100%</div>
                      </div>
                    </div>

                    {/* Integrated One-Bar Cards */}
                    {visibleStock.map((item, index) => {
                      const pct = item.capacityPercent ?? 0;
                      const hasMax = item.maximumStock != null;
                      const barWidth = hasMax ? Math.max(0, Math.min(100, pct)) : 0;
                      const rankNum = String(index + 1).padStart(2, "0");

                      return (
                        <div
                          className={`stock-bar-row ${item.healthTone}`}
                          key={item.id ?? item.item}
                          tabIndex={0}
                          aria-label={`${item.item}: ${item.quantity.toLocaleString()} ${item.unit}, status: ${item.label}`}
                        >
                          {/* Top Row: Identity & Status Meta */}
                          <div className="stock-bar-top">
                            <div className="stock-bar-identity">
                              <span className="stock-bar-pin-tag">
                                <span className="stock-bar-pin-dot" />
                                #{rankNum}
                              </span>
                              <div className="stock-bar-name-group">
                                <span className="stock-bar-name">{item.item}</span>
                                <span className="stock-bar-category-pill">{item.category}</span>
                              </div>
                            </div>

                            <div className="stock-bar-figures">
                              <div className="stock-bar-quantity-stack">
                                <span className="stock-bar-qty-current">
                                  {item.quantity.toLocaleString()} <span className="stock-bar-unit">{item.unit}</span>
                                </span>
                                <span className="stock-bar-qty-max">
                                  {hasMax ? `/ ${Number(item.maximumStock).toLocaleString()} ${item.unit} max` : "No ceiling set"}
                                </span>
                              </div>

                              {item.capacityPercent != null && (
                                <span className={`stock-bar-pct-badge ${item.healthTone}`} title={`${item.reportedPercent}% of the maximum stock`}>
                                  {item.reportedPercent}%
                                </span>
                              )}

                              <span className={`inventory-status ${item.healthTone}`}>
                                <span aria-hidden="true" />
                                {item.label}
                              </span>
                            </div>
                          </div>

                          {/* Bottom Row: Recessed Visual Progress Track */}
                          <div
                            className={`stock-bar-track${item.capacityPercent == null ? " untracked" : ""}`}
                            role={item.capacityPercent == null ? undefined : "progressbar"}
                            aria-label={`${item.item} stock capacity`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={item.reportedPercent ?? undefined}
                            aria-valuetext={item.reportedPercent == null ? "Maximum stock is not set" : `${item.reportedPercent}% of target maximum`}
                            title={item.reportedPercent == null ? "Maximum stock is not set" : `${item.reportedPercent}% of target maximum`}
                          >
                            <span className="stock-bar-ticks" aria-hidden="true">
                              <span />
                              <span />
                              <span />
                              <span />
                            </span>

                            {hasMax ? (
                              <span
                                className={`stock-bar-fill ${item.healthTone}`}
                                style={{ width: `${barWidth}%` }}
                              >
                                {barWidth > 10 && (
                                  <span className="stock-bar-pip-carrier">
                                    <span className="stock-bar-pip" />
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="stock-bar-fill untracked" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="admin-report-empty">
                  <span>◔</span>
                  <strong>Nothing to show for this filter</strong>
                  <p>Switch filters to review the rest of your tracked ingredients and supplies.</p>
                </div>
              )}
            </div>
          </section>
        </div>

          {/* Stock & restock history: one entry per stock change, newest first */}
          <section className="admin-report-panel report-folio-sheet report-ledger-panel lg-panel" aria-label="Stock and restock history">
            <header className="lg-head">
              <div className="lg-head-copy">
                <h2>Stock &amp; restock history</h2>
                <p>Every time an ingredient was restocked, used, wasted or adjusted.</p>
              </div>
              <div className="lg-head-stat">
                <strong>{movTotal.toLocaleString()}</strong>
                <span>{movTotal === 1 ? "entry" : "entries"}</span>
                {movSummary.totalRestockCount > 0 && (
                  <small>
                    {peso(movSummary.totalRestockCost)} spent on {movSummary.totalRestockCount} {movSummary.totalRestockCount === 1 ? "restock" : "restocks"}
                  </small>
                )}
              </div>
            </header>

            <div className="lg-controls">
              <div className="lg-chips" role="group" aria-label="Show these stock changes">
                {MOVEMENT_FILTERS.map((mf) => (
                  <button
                    key={mf.key || "all"}
                    type="button"
                    className={`lg-chip${movTypeFilter === mf.key ? " is-active" : ""}`}
                    aria-pressed={movTypeFilter === mf.key}
                    onClick={() => {
                      setMovTypeFilter(mf.key);
                      setMovPage(1);
                    }}
                  >
                    {mf.label}
                  </button>
                ))}
              </div>
              <label className="lg-search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search ingredient, supplier or note"
                  value={movSearch}
                  onChange={(e) => {
                    setMovSearch(e.target.value);
                    setMovPage(1);
                  }}
                  aria-label="Search stock history"
                />
              </label>
            </div>

            {movState.error && (
              <div className="report-inline-alert compact" role="alert">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{movState.error}</span>
              </div>
            )}

            {movItems.length ? (
              <>
                <ul className="lg-list">
                  {movItems.map((mov) => {
                    const tone = getMovementTone(mov.type);
                    const linkedStaff = mov.actorId ? staffById.get(Number(mov.actorId)) : null;
                    const when = splitLedgerDate(mov.timestamp);
                    const change = Number(mov.quantityChange);
                    const hasLevels = mov.beforeQuantity != null && mov.afterQuantity != null;
                    const source = [mov.supplierName, mov.referenceNo].filter(Boolean).join(" · ");
                    return (
                      <li key={mov.id} className={`lg-row tone-${tone}`}>
                        <div className="lg-when">
                          <strong>{when.day}</strong>
                          <span>{when.time}</span>
                        </div>
                        <div className="lg-main">
                          <div className="lg-title">
                            <span className="lg-name">{mov.itemName}</span>
                            <span className={`lg-tag tone-${tone}`}>{getMovementPlainLabel(mov)}</span>
                          </div>
                          <div className="lg-meta">
                            {hasLevels && (
                              <span title="Stock before and after this change">
                                {mov.beforeQuantity} → {mov.afterQuantity} {mov.unit || ""}
                              </span>
                            )}
                            {source && <span>{source}</span>}
                            {mov.note && <span>{mov.note}</span>}
                            {mov.orderNumber && (
                              <button
                                type="button"
                                className="lg-link"
                                onClick={(e) => handleOpenOrderModal({ id: mov.orderNumber }, e)}
                              >
                                Order #{mov.orderNumber}
                              </button>
                            )}
                            <span>
                              by{" "}
                              {linkedStaff ? (
                                <button
                                  type="button"
                                  className="lg-link"
                                  onClick={(e) => handleOpenStaffModal(linkedStaff, e)}
                                >
                                  {mov.actor}
                                </button>
                              ) : (
                                mov.actor || "System"
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="lg-amount">
                          <strong className={change >= 0 ? "is-up" : "is-down"}>
                            {change > 0 ? "+" : ""}{mov.quantityChange} {mov.unit || ""}
                          </strong>
                          {mov.batchCost != null && <span title="What this restock cost">{peso(mov.batchCost)}</span>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <LedgerPager page={movPage} total={movTotal} onPage={setMovPage} noun="stock history" />
              </>
            ) : (
              <div className="admin-report-empty compact">
                <strong>No stock changes found</strong>
                <p>
                  {movTypeFilter || movSearch.trim()
                    ? "Try a different filter or search."
                    : "Restocks, ingredients used in orders, waste and adjustments will show up here."}
                </p>
              </div>
            )}
          </section>

          {/* Order history: one entry per order, newest first */}
          <section className="admin-report-panel report-folio-sheet report-ledger-panel lg-panel" aria-label="Order history">
            <header className="lg-head">
              <div className="lg-head-copy">
                <h2>Order history</h2>
                <p>Every order in this period, including cancelled ones.</p>
              </div>
              <div className="lg-head-stat">
                <strong>{ledgerOrdersTotal.toLocaleString()}</strong>
                <span>{ledgerOrdersTotal === 1 ? "order" : "orders"}</span>
              </div>
            </header>

            <div className="lg-controls">
              <div className="lg-chips" role="group" aria-label="Show orders by status">
                {ORDER_STATUS_FILTERS.map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`lg-chip${ordersStatusFilter === st ? " is-active" : ""}`}
                    aria-pressed={ordersStatusFilter === st}
                    onClick={() => {
                      setOrdersStatusFilter(st);
                      setOrdersPage(1);
                    }}
                  >
                    {st}
                  </button>
                ))}
              </div>
              <label className="lg-select">
                <span>Paid by</span>
                <select
                  value={ordersPaymentFilter}
                  onChange={(e) => {
                    setOrdersPaymentFilter(e.target.value);
                    setOrdersPage(1);
                  }}
                  aria-label="Show orders by payment method"
                >
                  {PAYMENT_METHOD_FILTERS.map((pm) => (
                    <option key={pm} value={pm}>{pm === "All" ? "Any method" : pm}</option>
                  ))}
                </select>
              </label>
              <label className="lg-search">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search order number or customer"
                  value={ordersSearch}
                  onChange={(e) => {
                    setOrdersSearch(e.target.value);
                    setOrdersPage(1);
                  }}
                  aria-label="Search order history"
                />
              </label>
            </div>

            {ordersState.error && (
              <div className="report-inline-alert compact" role="alert">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{ordersState.error}</span>
              </div>
            )}

            {ledgerOrders.length ? (
              <>
                <ul className="lg-list">
                  {ledgerOrders.map((ord) => {
                    const statusClass = String(ord.status || "Pending").toLowerCase();
                    const when = splitLedgerDate(ord.createdAt);
                    return (
                      <li key={ord.id} className={`lg-row order-${statusClass}`}>
                        <div className="lg-when">
                          <strong>{when.day}</strong>
                          <span>{when.time}</span>
                        </div>
                        <div className="lg-main">
                          <div className="lg-title">
                            <span className="lg-name">{ord.customer || "Walk-in customer"}</span>
                            <span className={`lg-tag order-${statusClass}`}>{ord.status}</span>
                          </div>
                          <div className="lg-meta">
                            <span>Order #{ord.id}</span>
                            <span>{getPaymentMethodLabel(ord.paymentMethod)}, {getPaymentStatusLabel(ord)}</span>
                            <span>by {ord.cashier || "Staff"}</span>
                          </div>
                        </div>
                        <div className="lg-amount">
                          <strong>{peso(ord.total)}</strong>
                          <button
                            type="button"
                            className="lg-action"
                            onClick={(e) => handleOpenOrderModal(ord, e)}
                            aria-label={`View order ${ord.id}`}
                          >
                            <Receipt size={13} aria-hidden="true" />
                            View
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <LedgerPager page={ordersPage} total={ledgerOrdersTotal} onPage={setOrdersPage} noun="order history" />
              </>
            ) : (
              <div className="admin-report-empty compact">
                <strong>No orders found</strong>
                <p>Try a different status, payment method or search.</p>
              </div>
            )}
          </section>

          {insights.length ? (
            <section className="admin-report-insights" aria-label="Report highlights">
              <div className="report-highlights-heading">
                <div>
                  <span className="admin-report-eyebrow">PERIOD SUMMARY</span>
                  <h2>Report highlights</h2>
                  <p>Key signals from the selected reporting period.</p>
                </div>
              </div>
              {insights.map((insight) => (
                <div key={insight.label} className={`admin-report-insight report-pinned-note ${insight.tone}`}>
                  <div className={`report-paper-pin mini ${insight.tone === "positive" ? "sage" : insight.tone === "warning" ? "crimson" : "amber"}`} aria-hidden="true">
                    <span className="pin-shadow" />
                    <span className="pin-needle" />
                    <span className="pin-collar" />
                    <span className="pin-head">
                      <span className="pin-glint" />
                    </span>
                  </div>
                  <span className="report-insight-icon" aria-hidden="true">
                    {insight.label === "Best day" || insight.label === "Peak hour"
                      ? "↗"
                      : insight.label === "Top channel"
                        ? "◉"
                        : insight.label === "Best seller"
                          ? "★"
                          : insight.label === "Ingredient cost target" || insight.label === "Food cost target"
                            ? "%"
                            : "!"}
                  </span>
                  <div className="report-insight-copy">
                    <span>{insight.label}</span>
                    <strong>{insight.value}</strong>
                  </div>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </main>

      <ReportRestockModal
        isOpen={restockModalOpen}
        restockClosing={restockClosing}
        restockDialogRef={restockDialogRef}
        closeRestockModal={closeRestockModal}
        lowThreshold={lowThreshold}
        restockItems={modalRestockItems}
        restockSummary={smartRestockSummary}
        budgetAllocation={budgetAllocation}
        lookbackDays={restockLookbackDays}
        onLookbackDaysChange={setRestockLookbackDays}
        coverDays={restockCoverDays}
        onCoverDaysChange={setRestockCoverDays}
        budgetValue={restockBudget}
        onBudgetChange={setRestockBudget}
        packMode={effectivePackMode}
        hasPackItems={hasPackItems}
        onTogglePackMode={() => setRestockPackMode((prev) => !prev)}
        smartLoading={smartRestockLoading}
        smartError={smartRestockState.error}
        restockNotice={restockNotice}
        handleCopyRestockList={handleCopyRestockList}
      />

      {selectedStaffMember && (
        <StaffActivityModal
          staffMember={selectedStaffMember}
          rangeParams={activeRangeParams}
          onFilterReportByStaff={(uid) => {
            const cleanId = typeof uid === "object" && uid !== null ? (uid.userId ?? uid.id ?? null) : uid;
            setStaffFilterId(cleanId);
            setOrdersPage(1);
            setMovPage(1);
          }}
          productImageByName={productImageByName}
          triggerRef={staffTriggerRef}
          onClosed={() => setSelectedStaffMember(null)}
        />
      )}

      {selectedOrder && (
        <OrderDetailsModal
          order={selectedOrder}
          portal="admin"
          productImageByName={productImageByName}
          canVoid
          canViewCostBreakdown
          onConfirmOrder={async (ord) => {
            const updated = confirmOrder ? await confirmOrder(ord.id) : null;
            setRefreshNonce((n) => n + 1);
            return updated;
          }}
          onVoidOrder={async (ord, payload) => {
            const updated = voidOrder ? await voidOrder(ord.id, payload) : null;
            setRefreshNonce((n) => n + 1);
            return updated;
          }}
          onRevertOrderItem={async (orderNumber, itemId, payload) => {
            const updated = revertOrderItem ? await revertOrderItem(orderNumber, itemId, payload) : null;
            setRefreshNonce((n) => n + 1);
            if (updated) setSelectedOrder(updated);
            return updated;
          }}
          triggerRef={orderTriggerRef}
          onClosed={() => setSelectedOrder(null)}
        />
      )}
      <NetIncomePinModal
        open={netIncomePin.modalOpen}
        hasPin={netIncomePin.hasPin}
        onClose={() => netIncomePin.setModalOpen(false)}
        onUnlocked={(accessToken) => netIncomePin.unlock(accessToken)}
      />
    </div>
  );
}

export default AdminReport;
