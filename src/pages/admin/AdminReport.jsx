import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Download,
  Filter,
  Menu,
  Package,
  Receipt,
  Search,
  User,
  X,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import StaffActivityModal from "../../components/StaffActivityModal.jsx";
import OrderDetailsModal from "../../components/OrderDetailsModal.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import {
  getPaymentMethodLabel,
  getPaymentStatusLabel,
  useOrders,
} from "../../context/OrdersContext.jsx";
import { getInventoryStatus, useInventory } from "../../context/InventoryContext.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import { apiRequest } from "../../utils/api.js";
import { getStockHealth } from "../../utils/stockHealth.js";
import {
  compactPeso,
  downloadAuthenticatedCsv,
  formatDateTime,
  getManilaDateInputValue,
  getMovementLabel,
  getMovementTone,
  initials,
  peso,
} from "../../utils/staffActivityFormatters.js";
import { usePrefersReducedMotion } from "../../utils/usePrefersReducedMotion.js";
import { DEFAULT_TARGET_FOOD_COST, normalizeTargetFoodCost } from "../../utils/menuCosting.js";
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
  { key: "grossSales", label: "Revenue (High -> Low)" },
  { key: "ordersCount", label: "Orders Count" },
  { key: "attributedGrossProfit", label: "Gross Profit" },
  { key: "averageTicket", label: "Average Ticket" },
  { key: "displayName", label: "Staff Name (A-Z)" },
];

const MOVEMENT_FILTERS = [
  { key: "", label: "All Movements" },
  { key: "restock", label: "Restock" },
  { key: "usage", label: "Order Usage" },
  { key: "adjustment", label: "Adjustment" },
  { key: "spoilage", label: "Void Spoilage" },
  { key: "void_restore", label: "Void Restore" },
];

const ORDER_STATUS_FILTERS = ["All", "Pending", "Preparing", "Completed", "Cancelled"];
const PAYMENT_METHOD_FILTERS = ["All", "Cash", "GCash", "Card"];

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

function getManilaHour(iso) {
  if (!iso) return 0;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 0;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    hour12: false,
  }).format(parsed);
  const hour = Number.parseInt(formatted, 10);
  return Number.isFinite(hour) ? hour % 24 : 0;
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
    return { text: "All-time cumulative total", tone: "flat" };
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

async function fetchAllTodayPaidOrders({ from, to, rangeKey, staffId }) {
  const baseParams = buildRangeSearchParams({
    rangeKey,
    from,
    to,
    staffId,
    extra: { page: 1, limit: 200 },
  });
  const first = await apiRequest(`/reports/orders?${baseParams.toString()}`);
  const items = Array.isArray(first?.items) ? [...first.items] : [];
  const total = Number(first?.total || items.length);
  const totalPages = Math.min(15, Math.ceil(total / 200));
  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => {
        const p = buildRangeSearchParams({
          rangeKey,
          from,
          to,
          staffId,
          extra: { page: i + 2, limit: 200 },
        });
        return apiRequest(`/reports/orders?${p.toString()}`);
      }),
    );
    rest.forEach((chunk) => {
      if (Array.isArray(chunk?.items)) items.push(...chunk.items);
    });
  }
  return items;
}

function AdminReport() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { orders = [], confirmOrder, voidOrder } = useOrders() || {};
  const { inventory = [], loading: inventoryLoading, error: inventoryError } = useInventory() || {};
  const { products: menuProducts = [] } = useMenu() || {};
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
    todayOrdersForHourly: [],
    error: "",
  });

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
      apiRequest(`/reports/staff-performance?${staffParams.toString()}`),
      apiRequest(`/reports/products?${productParams.toString()}`),
      isHourlyDay
        ? fetchAllTodayPaidOrders({ rangeKey, from: customStart, to: customEnd, staffId: staffFilterId })
        : Promise.resolve([]),
    ])
      .then(([financial, staffPerf, productsData, todayOrdersForHourly]) => {
        if (!active) return;
        setCoreState({
          queryKey: coreQueryKey,
          financial,
          staffPerf,
          productsData,
          todayOrdersForHourly,
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
  }, [coreQueryKey, customEnd, customRangeInvalid, customStart, rangeKey, staffFilterId]);

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
        limit: 15,
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
        limit: 15,
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
    cogs: 0,
    grossProfit: 0,
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
    const grossSales = Number(summary.grossCollectedSales || 0);
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
        varianceLabel = `+${variancePts.toFixed(1)} pts over`;
        isOverTarget = true;
      } else {
        varianceLabel = `${Math.abs(variancePts).toFixed(1)} pts under`;
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
  }, [summary.cogs, summary.grossCollectedSales, summary.targetFoodCost, summary.uncostedItemsCount]);

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
      (coreState.todayOrdersForHourly || []).forEach((order) => {
        if (order.status === "Cancelled" || order.payment !== "Paid") return;
        const hr = getManilaHour(order.createdAt);
        hourBuckets[hr].sales += Number(order.total || 0);
        hourBuckets[hr].orders += 1;
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
  }, [coreState.financial, coreState.todayOrdersForHourly, customEnd, customStart, rangeKey]);

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
        { overMaximum: status === "Over Maximum" },
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
  }, [inventory]);

  const restockItems = useMemo(() => stockReport
    .filter((item) => item.tone === "critical" || item.healthTone === "critical" || item.healthTone === "low")
    .sort((a, b) => {
      const aPriority = a.quantity <= 0 ? 0 : a.healthTone === "critical" ? 1 : 2;
      const bPriority = b.quantity <= 0 ? 0 : b.healthTone === "critical" ? 1 : 2;
      return aPriority - bPriority || String(a.item || "").localeCompare(String(b.item || ""));
    }), [stockReport]);

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
        label: "Food cost target",
        value: `${foodCostAnalysis.actualPct.toFixed(1)}% actual vs ${Number(foodCostAnalysis.targetPct.toFixed(2))}% target (${foodCostAnalysis.varianceLabel}${foodCostAnalysis.hasUncosted ? " · partial COGS" : ""})`,
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
    const params = buildRangeSearchParams({
      rangeKey,
      from: customStart,
      to: customEnd,
      staffId: staffFilterId,
      extra: { type: typeToExport },
    });
    const stamp = getManilaDateInputValue(0);
    const filename = `amaya-${typeToExport}-report-${rangeKey}-${stamp}.csv`;

    try {
      await downloadAuthenticatedCsv(`/reports/export.csv?${params.toString()}`, filename);
      setExportNotice(`Exported ${typeToExport} CSV`);
      if (exportTimerRef.current) window.clearTimeout(exportTimerRef.current);
      exportTimerRef.current = window.setTimeout(() => setExportNotice(""), 3000);
    } catch (err) {
      setExportError(err?.message || "Failed to download CSV export.");
    } finally {
      setExportBusy(false);
    }
  };

  const handleCopyRestockList = async () => {
    if (!restockItems.length) return;
    const now = new Date();
    const dateStamp = getManilaDateInputValue(0);
    const lines = [
      "AMAYA RESTOCK LIST",
      `Generated: ${now.toLocaleString()}`,
      `Items needing restock: ${restockItems.length}`,
      "",
      ...restockItems.flatMap((item, index) => [
        `${index + 1}. ${item.item}`,
        `   Status: ${item.label}${item.reportedPercent == null ? "" : ` (${item.reportedPercent}% of maximum stock)`}`,
        `   Category: ${item.category || "Uncategorized"}`,
        `   On hand: ${item.quantity.toLocaleString()} ${item.unit}`,
        `   Maximum stock: ${item.maximumStock == null ? "Not set" : `${item.maximumStock.toLocaleString()} ${item.unit}`}`,
        `   Estimated refill to maximum: ${item.maximumStock == null ? "Set maximum stock first" : `${Math.max(0, item.maximumStock - item.quantity).toLocaleString()} ${item.unit}`}`,
        "",
      ]),
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
  };
  const movItems = Array.isArray(movState.data?.items) ? movState.data.items : [];
  const movTotal = Number(movState.data?.total || 0);
  const movTotalPages = Math.max(1, Math.ceil(movTotal / 15));

  const ledgerOrders = Array.isArray(ordersState.data?.items) ? ordersState.data.items : [];
  const ledgerOrdersTotal = Number(ordersState.data?.total || 0);
  const ledgerOrdersPages = Math.max(1, Math.ceil(ledgerOrdersTotal / 15));

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
                    <span className="admin-report-eyebrow">REVENUE LEDGER</span>
                    <h2>
                      {rangeKey === "today"
                        ? "Today's Session (Hourly) performance"
                        : rangeKey === "all"
                          ? "All Sessions & Historical Sales performance"
                          : rangeKey === "custom"
                            ? "Custom range performance"
                            : `Last ${rangeOption.label} performance`}
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
                      {summary.uncostedItemsCount} unit{summary.uncostedItemsCount === 1 ? "" : "s"} missing unit cost · COGS is partial
                    </span>
                  </div>
                )}

                <div className="sales-metrics">
                  <div>
                    <span>Gross collected sales</span>
                    <strong>{peso(summary.grossCollectedSales)}</strong>
                  </div>
                  <div>
                    <span>Estimated COGS</span>
                    <strong>{peso(summary.cogs)}</strong>
                  </div>
                  <div>
                    <span className="sales-metric-label-with-badge">
                      Food cost vs target
                      {foodCostAnalysis.hasUncosted && (
                        <span
                          className="report-partial-cogs-badge"
                          title="One or more sold units are missing Inventory or Menu unit costs"
                        >
                          Partial COGS
                        </span>
                      )}
                    </span>
                    <strong>
                      {foodCostAnalysis.actualPct != null ? (
                        <>
                          {foodCostAnalysis.actualPct.toFixed(1)}% vs {Number(foodCostAnalysis.targetPct.toFixed(2))}%{" "}
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
                    <span>Gross profit</span>
                    <strong>
                      {peso(summary.grossProfit)}
                      {" "}
                      <small className="sales-margin-tag">({Number(summary.marginPercent || 0).toFixed(1)}%)</small>
                    </strong>
                  </div>
                  <div>
                    <span>Average order value</span>
                    <strong>{peso(summary.averageOrderValue)}</strong>
                  </div>
                  <div>
                    <span>Cash / GCash / Card</span>
                    <strong>
                      {compactPeso(summary.cashCollected)} · {compactPeso(summary.gcashCollected)} · {compactPeso(summary.cardCollected)}
                    </strong>
                  </div>
                  <div>
                    <span>Voided / Cancelled</span>
                    <strong className={summary.voidedOrdersCount > 0 ? "due" : ""}>
                      {summary.voidedOrdersCount} ({peso(summary.voidedSalesTotal)})
                    </strong>
                  </div>
                  <div>
                    <span>Restock spend ({summary.inventoryRestockCount})</span>
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
                  <small>Units sold</small>
                  <strong>{Number(summary.unitsSold || 0).toLocaleString()}</strong>
                  <span className="report-stat-note flat">
                    {summary.paidOrdersCount} paid · {summary.unpaidOrdersCount} unpaid
                  </span>
                </div>
              </div>
              <div className="report-kpi-slip tone-plum">
                <span className="kpi-slip-pin plum" aria-hidden="true" />
                <span className="report-stat-mark plum">₱</span>
                <div>
                  <small>Gross collected sales</small>
                  <strong>{peso(summary.grossCollectedSales)}</strong>
                  <span className={`report-stat-note ${salesTrend.tone}`}>{salesTrend.text}</span>
                </div>
              </div>
              <div className="report-kpi-slip tone-amber">
                <span className="kpi-slip-pin amber" aria-hidden="true" />
                <span className="report-stat-mark amber">◷</span>
                <div>
                  <small>Average ticket</small>
                  <strong>{peso(summary.averageOrderValue)}</strong>
                  <span className={`report-stat-note ${avgTrend.tone}`}>{avgTrend.text}</span>
                </div>
              </div>
              <div className="report-kpi-slip tone-blue">
                <span className="kpi-slip-pin blue" aria-hidden="true" />
                <span className="report-stat-mark blue">▤</span>
                <div>
                  <small>Settled orders</small>
                  <strong>{Number(summary.paidOrdersCount || 0).toLocaleString()}</strong>
                  <span className={`report-stat-note ${orderTrend.tone}`}>{orderTrend.text}</span>
                </div>
              </div>
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
                    <span className="admin-report-eyebrow">CHANNEL MIX</span>
                    <h2>Where orders come from</h2>
                  </div>
                  <span className="inventory-count">{channels.length} channels</span>
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
                  <span className="admin-report-eyebrow">PRODUCT PERFORMANCE</span>
                  <h2>Ranked items &amp; margins</h2>
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
                        <th scope="col">#</th>
                        <th scope="col">Product</th>
                        <th scope="col">Category</th>
                        <th scope="col">Units</th>
                        <th scope="col">Base / Add-ons</th>
                        <th scope="col">Revenue</th>
                        <th scope="col">COGS</th>
                        <th scope="col">Gross profit</th>
                        <th scope="col">Share</th>
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
                  <p>Once paid orders are placed, your best sellers and COGS margins will appear here.</p>
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
                  <span className="admin-report-eyebrow">STAFF ATTRIBUTION · SHIFT LOGBOOK</span>
                  <h2>Cashiers &amp; Staff Activity</h2>
                  <p className="cashier-panel-description">
                    Click any team member to inspect shift logs, attributed revenue &amp; COGS, orders, sessions, and inventory movements.
                  </p>
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
                  <span className="cashier-summary-label">Attributed</span>
                  <strong className="cashier-summary-val">{peso(staffRosterTotals.grossSales)}</strong>
                </div>
                <div className="cashier-summary-item">
                  <span className="cashier-summary-label">Avg Ticket</span>
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
                      <div className="cashier-bar-ruler-label">SHIFT LEDGER · REVENUE SHARE</div>
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
                                <span className="cashier-rank">{rankNum}</span>
                                <span className="cashier-avatar" aria-hidden="true">{initials(cashier.displayName)}</span>
                              </span>
                              <span className="cashier-name-group">
                                <span className="cashier-name-line">
                                  <span className="cashier-name">{cashier.displayName}</span>
                                  {tone === "lead" && <span className="cashier-lead-seal">Top Cashier</span>}
                                  {!cashier.isActive && <span className="cashier-status-pill inactive">Inactive</span>}
                                  {cashier.role === "admin" && <span className="cashier-status-pill role">Admin</span>}
                                  {isFilteredHere && <span className="cashier-status-pill filtered">Filtered</span>}
                                </span>
                                <span className="cashier-meta-inline">
                                  <span>{cashier.ordersCount} {cashier.ordersCount === 1 ? "order" : "orders"}</span>
                                  <span className="cashier-meta-dot" aria-hidden="true">·</span>
                                  <span>Avg ticket {peso(cashier.averageTicket)}</span>
                                  <span className="cashier-meta-dot" aria-hidden="true">·</span>
                                  <span>Profit {peso(cashier.attributedGrossProfit)} ({Number(cashier.marginPercent || 0).toFixed(1)}%)</span>
                                  {cashier.voidedOrdersCount > 0 && (
                                    <>
                                      <span className="cashier-meta-dot" aria-hidden="true">·</span>
                                      <span className="cashier-void-flag">{cashier.voidedOrdersCount} voided</span>
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
                    Live ingredient snapshot · Asset valuation {peso(summary.inventoryAssetValue)}.
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
                <div className="stock-overview-item healthy">
                  <span className="stock-overview-dot healthy" aria-hidden="true" />
                  <span className="stock-overview-label">Healthy</span>
                  <strong className="stock-overview-val">{stockBreakdown.healthy}</strong>
                </div>
                <div className="stock-overview-item critical">
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
                        <div className="stock-bar-ruler-label">CAPACITY LEDGER · STOCK LEVEL vs TARGET</div>
                        <div className="stock-bar-ruler-legend">
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
                                <span className={`stock-bar-pct-badge ${item.healthTone}`}>
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

          {/* Period Inventory Activity & Expenditure Ledger (Pillar F) */}
          <section className="admin-report-panel report-folio-sheet report-ledger-panel" aria-label="Period inventory activity and expenditure">
            <div className="panel-heading">
              <div>
                <span className="admin-report-eyebrow">INVENTORY MOVEMENTS &amp; EXPENDITURE</span>
                <h2>Period Inventory Activity Log</h2>
              </div>
              <span className="inventory-count">
                Spend: {peso(movSummary.totalRestockCost)} ({movSummary.totalRestockCount} restocks)
              </span>
            </div>

            <div className="report-mov-kpis">
              <div className="report-mov-kpi positive">
                <span>Restocks</span>
                <strong>{movSummary.totalRestockCount}</strong>
              </div>
              <div className="report-mov-kpi neutral">
                <span>Order Usage</span>
                <strong>{movSummary.totalUsageCount}</strong>
              </div>
              <div className="report-mov-kpi">
                <span>Adjustments</span>
                <strong>{movSummary.totalAdjustmentCount}</strong>
              </div>
              <div className="report-mov-kpi warning">
                <span>Spoilage</span>
                <strong>{movSummary.totalSpoilageCount}</strong>
              </div>
              <div className="report-mov-kpi positive">
                <span>Void Restored</span>
                <strong>{movSummary.totalVoidRestoreCount}</strong>
              </div>
            </div>

            <div className="report-ledger-toolbar">
              <div className="report-filter-pills" role="group" aria-label="Movement type filter">
                {MOVEMENT_FILTERS.map((mf) => (
                  <button
                    key={mf.key || "all"}
                    type="button"
                    className={`report-filter-pill ${movTypeFilter === mf.key ? "is-active" : ""}`}
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
              <label className="report-search-input-wrap">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search item, supplier, ref..."
                  value={movSearch}
                  onChange={(e) => {
                    setMovSearch(e.target.value);
                    setMovPage(1);
                  }}
                  aria-label="Search inventory movements"
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
                <div className="inventory-table-wrap">
                  <table className="inventory-table report-movements-table">
                    <thead>
                      <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Ingredient</th>
                        <th scope="col">Type</th>
                        <th scope="col">Change</th>
                        <th scope="col">Stock Transition</th>
                        <th scope="col">Spend / Ref</th>
                        <th scope="col">Order</th>
                        <th scope="col">Actor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movItems.map((mov) => {
                        const tone = getMovementTone(mov.type);
                        const linkedStaff = mov.actorId ? staffById.get(Number(mov.actorId)) : null;
                        return (
                          <tr key={mov.id}>
                            <td className="report-nowrap">{formatDateTime(mov.timestamp)}</td>
                            <td>
                              <div className="report-product-title-cell">
                                <span>{mov.itemName}</span>
                                {mov.note && <small>{mov.note}</small>}
                              </div>
                            </td>
                            <td>
                              <span className={`report-mov-badge ${tone}`}>
                                <Package size={11} aria-hidden="true" />
                                {getMovementLabel(mov.type)}
                              </span>
                            </td>
                            <td className="report-num">
                              {mov.quantityChange >= 0 ? "+" : ""}{mov.quantityChange} {mov.unit || ""}
                            </td>
                            <td className="report-num">
                              {mov.beforeQuantity != null && mov.afterQuantity != null
                                ? `${mov.beforeQuantity} → ${mov.afterQuantity} ${mov.unit || ""}`
                                : "—"}
                            </td>
                            <td>
                              {mov.batchCost != null ? <strong>{peso(mov.batchCost)}</strong> : "—"}
                              {(mov.supplierName || mov.referenceNo) && (
                                <small className="report-mov-meta">
                                  {[mov.supplierName, mov.referenceNo].filter(Boolean).join(" · ")}
                                </small>
                              )}
                            </td>
                            <td>
                              {mov.orderNumber ? (
                                <button
                                  type="button"
                                  className="report-inline-action-btn"
                                  onClick={(e) => handleOpenOrderModal({ id: mov.orderNumber }, e)}
                                >
                                  #{mov.orderNumber}
                                </button>
                              ) : "—"}
                            </td>
                            <td>
                              {linkedStaff ? (
                                <button
                                  type="button"
                                  className="report-inline-action-btn"
                                  onClick={(e) => handleOpenStaffModal(linkedStaff, e)}
                                >
                                  <User size={12} aria-hidden="true" />
                                  {mov.actor}
                                </button>
                              ) : (
                                mov.actor || "System"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {movTotalPages > 1 && (
                  <div className="report-pagination">
                    <button
                      type="button"
                      disabled={movPage <= 1}
                      onClick={() => setMovPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <span>Page {movPage} of {movTotalPages} ({movTotal} movements)</span>
                    <button
                      type="button"
                      disabled={movPage >= movTotalPages}
                      onClick={() => setMovPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="admin-report-empty compact">
                <strong>No inventory movements in this period</strong>
                <p>Restocks, order usage deductions, void restorations, and adjustments will appear here.</p>
              </div>
            )}
          </section>

          {/* Period Order Ledger Folio (Pillar B) */}
          <section className="admin-report-panel report-folio-sheet report-ledger-panel" aria-label="Period order ledger">
            <div className="panel-heading">
              <div>
                <span className="admin-report-eyebrow">PERIOD ORDER LEDGER</span>
                <h2>Order Audit &amp; Void Management</h2>
              </div>
              <span className="inventory-count">{ledgerOrdersTotal} orders</span>
            </div>

            <div className="report-ledger-toolbar">
              <div className="report-ledger-selects">
                <label className="report-inline-select">
                  <span>Status</span>
                  <select
                    value={ordersStatusFilter}
                    onChange={(e) => {
                      setOrdersStatusFilter(e.target.value);
                      setOrdersPage(1);
                    }}
                    aria-label="Filter order ledger by status"
                  >
                    {ORDER_STATUS_FILTERS.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </label>

                <label className="report-inline-select">
                  <span>Payment</span>
                  <select
                    value={ordersPaymentFilter}
                    onChange={(e) => {
                      setOrdersPaymentFilter(e.target.value);
                      setOrdersPage(1);
                    }}
                    aria-label="Filter order ledger by payment method"
                  >
                    {PAYMENT_METHOD_FILTERS.map((pm) => (
                      <option key={pm} value={pm}>{pm}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="report-search-input-wrap">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="Search order # or customer..."
                  value={ordersSearch}
                  onChange={(e) => {
                    setOrdersSearch(e.target.value);
                    setOrdersPage(1);
                  }}
                  aria-label="Search period order ledger"
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
                <div className="inventory-table-wrap">
                  <table className="inventory-table report-orders-table">
                    <thead>
                      <tr>
                        <th scope="col">Order #</th>
                        <th scope="col">Date &amp; Time</th>
                        <th scope="col">Customer</th>
                        <th scope="col">Cashier</th>
                        <th scope="col">Payment</th>
                        <th scope="col">Status</th>
                        <th scope="col">Total</th>
                        <th scope="col">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerOrders.map((ord) => {
                        const statusClass = String(ord.status || "Pending").toLowerCase();
                        return (
                          <tr key={ord.id}>
                            <td className="report-nowrap"><strong>#{ord.id}</strong></td>
                            <td className="report-nowrap">{formatDateTime(ord.createdAt)}</td>
                            <td>{ord.customer || "Walk-in Customer"}</td>
                            <td>{ord.cashier || "Staff"}</td>
                            <td>
                              {getPaymentMethodLabel(ord.paymentMethod)}
                              {" "}
                              <small className="report-payment-tag">({getPaymentStatusLabel(ord)})</small>
                            </td>
                            <td>
                              <span className={`report-order-status-pill ${statusClass}`}>
                                {ord.status}
                              </span>
                            </td>
                            <td className="report-num"><strong>{peso(ord.total)}</strong></td>
                            <td>
                              <button
                                type="button"
                                className="report-inline-action-btn"
                                onClick={(e) => handleOpenOrderModal(ord, e)}
                              >
                                <Receipt size={13} aria-hidden="true" />
                                Inspect
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {ledgerOrdersPages > 1 && (
                  <div className="report-pagination">
                    <button
                      type="button"
                      disabled={ordersPage <= 1}
                      onClick={() => setOrdersPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </button>
                    <span>Page {ordersPage} of {ledgerOrdersPages} ({ledgerOrdersTotal} orders)</span>
                    <button
                      type="button"
                      disabled={ordersPage >= ledgerOrdersPages}
                      onClick={() => setOrdersPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="admin-report-empty compact">
                <strong>No matching orders in this period</strong>
                <p>Try adjusting the search text, status, or payment method filters above.</p>
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
                          : insight.label === "Food cost target"
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

      {restockModalOpen && (
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
                      {new Date().toLocaleDateString("en-US", {
                        timeZone: "Asia/Manila",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  <h2 id="restock-modal-title">Out of Stock &amp; Running Low</h2>
                  <p id="restock-modal-description">
                    Items at 40% stock or below. Suggested refill quantities restore each ingredient to its target maximum.
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

              <div className="restock-modal-summary">
                <div className="restock-summary-badge">
                  <strong>{restockItems.length}</strong>
                  <span>
                    {restockItems.length === 1 ? "line item needs" : "line items need"} restocking
                  </span>
                </div>
                <div className="restock-summary-legend">
                  <span className="legend-chip critical">
                    <i /> Out / Critical
                  </span>
                  <span className="legend-chip low">
                    <i /> Running Low (≤40%)
                  </span>
                </div>
              </div>

              {restockItems.length ? (
                <div className="restock-notebook-body">
                  <div className="restock-notebook-col-head" aria-hidden="true">
                    <span># / Ingredient &amp; Category</span>
                    <span>Status</span>
                    <span>On Hand / Max</span>
                    <span>Refill Needed</span>
                  </div>

                  <ol className="restock-notebook-list">
                    {restockItems.map((item, idx) => {
                      const refillAmount = item.maximumStock == null
                        ? null
                        : Math.max(0, item.maximumStock - item.quantity);

                      return (
                        <li
                          key={item.id}
                          className="restock-notebook-line"
                          style={{ "--line-index": idx }}
                        >
                          <div className="notebook-line-main">
                            <span className="notebook-line-check" aria-hidden="true">
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                            <div className="notebook-line-item">
                              <strong>{item.item}</strong>
                              <small>{item.category || "Uncategorized"}</small>
                            </div>
                          </div>

                          <div className="notebook-line-status">
                            <span className={`restock-status ${item.healthTone}`}>
                              <span aria-hidden="true" />
                              {item.label}
                            </span>
                          </div>

                          <div className="notebook-line-stock">
                            <span className="stock-current">
                              {item.quantity.toLocaleString()} {item.unit}
                            </span>
                            <span className="stock-divider">/</span>
                            <span className="stock-max">
                              {item.maximumStock == null
                                ? "No max"
                                : `${item.maximumStock.toLocaleString()} ${item.unit}`}
                            </span>
                          </div>

                          <div className="notebook-line-refill">
                            {refillAmount == null ? (
                              <span className="refill-unset">Set max first</span>
                            ) : (
                              <strong className="refill-tag">
                                +{refillAmount.toLocaleString()} {item.unit}
                              </strong>
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
                  <p>No ingredients are out of stock or below 40% of their maximum level.</p>
                </div>
              )}

              <footer className="restock-modal-footer">
                <p role="status" aria-live="polite">
                  {restockNotice ||
                    "Copying also downloads a .txt checklist that can be opened in Notepad."}
                </p>
                <div>
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
      )}

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
          triggerRef={orderTriggerRef}
          onClosed={() => setSelectedOrder(null)}
        />
      )}
    </div>
  );
}

export default AdminReport;
