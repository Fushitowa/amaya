import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ChartColumn,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  Download,
  Filter,
  History,
  Lock,
  LockOpen,
  Menu,
  Package,
  Receipt,
  Search,
  ShoppingBag,
  Trophy,
  Users,
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
import "../../assets/css/admin/MenuNotebook.css";
import "../../assets/css/admin/InventoryNotebook.css";
import "../../assets/css/admin/ReportNotebook.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

// Best sellers card: three per page, up to three pages (top 9).
const BEST_PAGE_SIZE = 3;
const BEST_PAGE_COUNT = 3;

// Same shape as a real best-seller row, but invisible: it holds the row's height
// so the card never shrinks when a page has fewer than three items.
// With `blank`, it shows as an empty numbered write-in line instead (used when nothing sold).
function BestSellerGhostRow({ rank = 0, blank = false }) {
  return (
    <li className={`rp-best-row ${blank ? "rp-best-blank" : "rp-best-ghost"}`} aria-hidden="true">
      <span className="rp-best-rank"><small>No.</small><span>{rank}</span></span>
      <div className="rp-best-body">
        <div className="rp-best-name"><strong>Item</strong><small>Size</small></div>
        <dl className="rp-best-figs">
          <div><dt>Sales</dt><dd>₱0.00</dd></div>
          <div><dt>Cost to make</dt><dd>₱0.00</dd></div>
          <div><dt>Profit</dt><dd>₱0.00 <em>0%</em></dd></div>
        </dl>
        <div className="rp-best-share"><span className="nbi-gauge" /><span>0% of all sales</span></div>
      </div>
      <div className="rp-best-sold"><span className="rp-hl">0</span><small>sold</small></div>
    </li>
  );
}

// Binder divider tabs on the notebook's edge, one per report section.
const REPORT_SECTIONS = [
  { id: "rp-sales", label: "Sales", tone: "butter" },
  { id: "rp-profit", label: "Profit", tone: "sage" },
  { id: "rp-products", label: "Products", tone: "peach" },
  { id: "rp-staff", label: "Staff", tone: "sky" },
  { id: "rp-stock", label: "Stock", tone: "rose" },
  { id: "rp-history", label: "History", tone: "lilac" },
];

// Hidden amount on the profit receipt until the owner PIN is entered.
function Masked() {
  return <span className="rp-masked" title="Enter the owner PIN to see this">₱ • • • •</span>;
}

// Hand-drawn ink arrow that points at the amount beside it.
function InkArrow() {
  return (
    <svg className="rp-arrow" viewBox="0 0 120 56" aria-hidden="true" focusable="false">
      <path className="rp-arrow-line" pathLength="1" d="M6 44c12 9 34 11 52 3 14-6 26-17 37-19 6-1 11 0 15 2" />
      <path className="rp-arrow-head" pathLength="1" d="M97 17c5 4 10 8 14 13-6 2-12 3-18 6" />
    </svg>
  );
}

// One bar split into cash, GCash and card, with the amounts underneath.
function PaymentSplit({ cash, gcash, card }) {
  const parts = [
    { key: "cash", label: "Cash", value: Number(cash || 0) },
    { key: "gcash", label: "GCash", value: Number(gcash || 0) },
    { key: "card", label: "Card", value: Number(card || 0) },
  ];
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  return (
    <span className="rp-pay">
      <span className="rp-pay-bar" aria-hidden="true">
        {total > 0 && parts.map((part) => (part.value > 0 ? (
          <span key={part.key} className={`is-${part.key}`} style={{ flexGrow: part.value }} />
        ) : null))}
      </span>
      <span className="rp-pay-legend">
        {parts.map((part) => (
          <span key={part.key}>
            <i className={`is-${part.key}`} aria-hidden="true" />
            {part.label} {compactPeso(part.value)}
          </span>
        ))}
      </span>
    </span>
  );
}

const RANGE_OPTIONS = [
  { key: "today", label: "Today (Session)", bookmark: "TODAY" },
  { key: "7d", label: "7 days", bookmark: "7D" },
  { key: "30d", label: "30 days", bookmark: "30D" },
  { key: "all", label: "All Sessions", bookmark: "ALL TIME" },
  { key: "custom", label: "Custom", bookmark: "CUSTOM" },
];

const STOCK_FILTERS = ["all", "attention", "healthy"];

const ROSTER_FILTERS = [
  { key: "all", label: "Everyone" },
  { key: "with_sales", label: "Made sales" },
  { key: "inactive", label: "Inactive" },
];

const ROSTER_SORTS = [
  { key: "grossSales", label: "Most money first" },
  { key: "ordersCount", label: "Most orders first" },
  { key: "attributedGrossProfit", label: "Most profit first" },
  { key: "averageTicket", label: "Biggest average order" },
  { key: "displayName", label: "Name, A to Z" },
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
  const sheetRef = useRef(null);
  const [activeSection, setActiveSection] = useState(REPORT_SECTIONS[0].id);

  // Light up the divider tab of the section nearest the top of the page.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    // Viewport root: works whether the sheet scrolls (desktop) or the window does (narrow screens).
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActiveSection(visible[0].target.id);
    }, { rootMargin: "0px 0px -65% 0px" });
    REPORT_SECTIONS.forEach((sec) => {
      const node = document.getElementById(sec.id);
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, []);

  const jumpToSection = (id) => {
    const node = document.getElementById(id);
    if (!node) return;
    setActiveSection(id);
    node.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  };

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
  const [bestPageRaw, setBestPage] = useState(0);

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
  // Best sellers: the top 9, three to a page.
  const bestTotal = Math.min(rankedProducts.length, BEST_PAGE_SIZE * BEST_PAGE_COUNT);
  const bestPageCount = Math.max(1, Math.ceil(bestTotal / BEST_PAGE_SIZE));
  const bestPage = Math.min(bestPageRaw, bestPageCount - 1);
  const pagedProducts = rankedProducts.slice(bestPage * BEST_PAGE_SIZE, Math.min(bestTotal, (bestPage + 1) * BEST_PAGE_SIZE));

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
    setBestPage(0);
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

  const periodTitle = rangeKey === "today"
    ? "Today's session"
    : rangeKey === "all"
      ? "All sessions"
      : rangeKey === "custom"
        ? "Custom dates"
        : `Last ${rangeOption.label}`;
  const chartTitle = rangeKey === "today"
    ? "Sales by hour, today"
    : rangeKey === "custom" && customStart === customEnd
      ? "Sales by hour"
      : rangeKey === "all"
        ? "Sales over all time"
        : `Sales, ${periodTitle.toLowerCase()}`;
  const profitLocked = Boolean(incomeStatementSummary?.profitLocked);

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

      <main className="admin-report-main nb-main rp-main">
        <div className="nb-desk rp-desk">
          <section className="nb-notebook rp-notebook" aria-label="Sales and inventory report">
            <div className="nb-spiral" aria-hidden="true" />

            <div className="nb-page">
              <header className="nb-head rp-head">
                <button
                  type="button"
                  className="report-mobile-menu-btn rp-menu-btn"
                  onClick={() => setMobileNavOpen(true)}
                  aria-label="Open navigation menu"
                >
                  <Menu size={20} aria-hidden="true" />
                </button>
                <span className="nb-crest" aria-hidden="true">
                  <ChartColumn size={20} strokeWidth={2} />
                </span>
                <div className="nb-head-copy">
                  <h1>Sales &amp; inventory report</h1>
                  <p>
                    {periodTitle}, as of {liveDate}
                    <span className="nb-live">
                      <span className="nb-live-dot" aria-hidden="true" />
                      {Number(summary.paidOrdersCount || 0).toLocaleString()} paid {summary.paidOrdersCount === 1 ? "order" : "orders"}
                    </span>
                  </p>
                </div>
                <div className="nb-head-actions">
                  <label className="nb-field nb-sort">
                    <span className="rp-field-label">Export</span>
                    <select
                      value={exportType}
                      onChange={(e) => setExportType(e.target.value)}
                      aria-label="Which report to export as CSV"
                    >
                      <option value="orders">Orders</option>
                      <option value="staff">Staff</option>
                      <option value="products">Products</option>
                      <option value="inventory">Inventory</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="nb-btn nb-btn-primary"
                    onClick={() => handleExportCsv(exportType)}
                    disabled={exportBusy || customRangeInvalid}
                  >
                    <Download size={15} strokeWidth={2.2} aria-hidden="true" />
                    {exportBusy ? "Exporting…" : "Download CSV"}
                  </button>
                </div>
              </header>

              {exportNotice && (
                <div className="nbi-banner ok" role="status">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{exportNotice}</span>
                </div>
              )}
              {exportError && (
                <div className="nbi-banner warn" role="alert">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{exportError}</span>
                </div>
              )}
              {coreState.error && (
                <div className="nbi-banner warn" role="alert">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>{coreState.error}</span>
                </div>
              )}
              {selectedFilterStaff && (
                <div className="nbi-banner rp-filter-banner" role="region" aria-label="Staff filter">
                  <Filter size={15} aria-hidden="true" />
                  <span>
                    Showing only orders handled by <strong>{selectedFilterStaff.displayName}</strong>
                    {" "}({selectedFilterStaff.role === "admin" ? "Admin" : "Cashier"})
                  </span>
                  <button type="button" onClick={(e) => handleOpenStaffModal(selectedFilterStaff, e)}>
                    Open activity log
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStaffFilterId(null);
                      setOrdersPage(1);
                      setMovPage(1);
                    }}
                  >
                    <X size={13} aria-hidden="true" /> Show everyone
                  </button>
                </div>
              )}

              <div className="nb-toolbar rp-toolbar">
                <div className="nb-tabs" role="tablist" aria-label="Reporting period">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      role="tab"
                      aria-selected={option.key === rangeKey}
                      className={`nb-tab ${option.key === rangeKey ? "is-active" : ""}`}
                      onClick={() => handleRangeChange(option.key)}
                    >
                      {option.key === "custom" && <CalendarDays size={14} strokeWidth={2.2} aria-hidden="true" />}
                      {option.label}
                    </button>
                  ))}
                </div>
                {rangeKey === "custom" && (
                  <div className="nb-tools rp-dates">
                    <label className="nb-field">
                      <span className="rp-field-label">From</span>
                      <input
                        type="date"
                        value={customStart}
                        onChange={(e) => {
                          setCustomStart(e.target.value);
                          setOrdersPage(1);
                          setMovPage(1);
                        }}
                      />
                    </label>
                    <label className="nb-field">
                      <span className="rp-field-label">To</span>
                      <input
                        type="date"
                        value={customEnd}
                        onChange={(e) => {
                          setCustomEnd(e.target.value);
                          setOrdersPage(1);
                          setMovPage(1);
                        }}
                      />
                    </label>
                  </div>
                )}
              </div>

              <div className="nb-sheet rp-sheet" ref={sheetRef} role="region" aria-label="Report pages" tabIndex={0}>
                {/* ---------- Sales ---------- */}
                <section id="rp-sales" className="rp-section" aria-labelledby="rp-sales-title">
                  <div className="nb-sheet-title">
                    <h2 id="rp-sales-title">{chartTitle}</h2>
                    <span className="nb-sheet-note">
                      {peso(summary.grossCollectedSales)} collected
                    </span>
                  </div>

                  {customRangeInvalid ? (
                    <div className="nb-empty" role="alert">
                      <CalendarDays size={24} aria-hidden="true" />
                      <strong>The dates are the wrong way round</strong>
                      <span>Pick a “From” date that is on or before the “To” date.</span>
                    </div>
                  ) : isCoreLoading ? (
                    <div className="nb-empty" role="status">
                      <ChartColumn size={24} aria-hidden="true" />
                      <strong>Loading sales</strong>
                      <span>Adding up the paid orders for this period.</span>
                    </div>
                  ) : summary.paidOrdersCount > 0 ? (
                    <div className="rp-chart" key={`${rangeKey}-${staffFilterId ?? "all"}`}>
                      <svg
                        viewBox={`0 0 ${trend.width} ${trend.height}`}
                        role="img"
                        aria-label={`Sales across ${trend.points.length} periods, totalling ${peso(summary.grossCollectedSales)} and peaking at ${peso(trend.best?.sales || 0)}`}
                      >
                        {trend.gridLines.map((line) => (
                          <line
                            key={line.y}
                            x1={trend.padLeft}
                            y1={line.y}
                            x2={trend.width - trend.padRight}
                            y2={line.y}
                            className={line.isBaseline ? "rp-grid is-base" : "rp-grid"}
                          />
                        ))}
                        {trend.gridLines.map((line) => (
                          <text
                            key={`label-${line.y}`}
                            x={trend.padLeft - 10}
                            y={line.y}
                            className="rp-axis"
                            textAnchor="end"
                            dominantBaseline="middle"
                          >
                            {compactPeso(line.value)}
                          </text>
                        ))}
                        {trend.points.map((point, index) => {
                          const isBest = trend.best && point.key === trend.best.key && point.sales > 0;
                          return (
                            <rect
                              key={point.key}
                              x={point.barX}
                              y={point.barHeight > 0 ? point.y : trend.baseline - 2}
                              width={point.barWidth}
                              height={Math.max(point.barHeight, 2)}
                              rx="4"
                              style={{ "--bar-index": Math.min(index, 24) }}
                              className={`rp-bar${isBest ? " is-best" : ""}${point.sales === 0 ? " is-zero" : ""}`}
                            >
                              <title>{`${point.label}: ${peso(point.sales)}, ${point.orders} order${point.orders === 1 ? "" : "s"}`}</title>
                            </rect>
                          );
                        })}
                        {trend.best && trend.best.sales > 0 && trend.points.length > 1 && (
                          <text
                            x={trend.best.x}
                            y={Math.max(14, trend.best.y - 10)}
                            className="rp-best-note"
                            textAnchor="middle"
                          >
                            best
                          </text>
                        )}
                        {trend.labelledPoints.map((point) => (point.showLabel ? (
                          <text
                            key={`x-${point.key}`}
                            x={point.x}
                            y={trend.height - 8}
                            className="rp-axis"
                            textAnchor="middle"
                          >
                            {point.label}
                          </text>
                        ) : null))}
                      </svg>
                    </div>
                  ) : (
                    <div className="nb-empty">
                      <ChartColumn size={24} aria-hidden="true" />
                      <strong>No paid orders in this period</strong>
                      <span>Choose a longer period above, or check back after the next sale.</span>
                    </div>
                  )}
                </section>

                {/* ---------- Profit: receipt + cost ledger ---------- */}
                <section id="rp-profit" className="rp-section" aria-labelledby="rp-profit-title">
                  <div className="nb-sheet-title">
                    <h2 id="rp-profit-title">How much did the store earn?</h2>
                    <span className="nb-sheet-note">read it top to bottom</span>
                  </div>

                  <div className="rp-profit-grid">
                    <article className="rp-receipt" aria-label="Profit, step by step">
                      <span className="nb-tape" aria-hidden="true" />
                      <div className="rp-receipt-paper">
                        <header className="rp-receipt-head">
                          <strong>Amaya</strong>
                          <span>Profit slip, {periodTitle.toLowerCase()}</span>
                        </header>

                        <dl className="rp-receipt-lines">
                          <div title="Sales after discounts, before tax">
                            <dt>Total sales</dt>
                            <dd>{peso(incomeStatementSummary?.netSalesRevenue ?? summary.netSales ?? 0)}</dd>
                          </div>
                          <div className="is-less" title="Cost of goods sold: ingredients of items sold, plus wasted stock">
                            <dt>Cost to make, with waste</dt>
                            <dd>{profitLocked ? <Masked /> : `−${peso(incomeStatementSummary?.cogs ?? summary.totalCogs ?? summary.cogs ?? 0)}`}</dd>
                          </div>
                          <div className="is-subtotal" title="Gross profit: sales minus cost to make">
                            <dt>Profit before expenses</dt>
                            <dd>{profitLocked ? <Masked /> : peso(incomeStatementSummary?.grossProfit ?? summary.grossProfit ?? 0)}</dd>
                          </div>
                          <div className="is-less" title="Operating expenses such as rent, salaries and utilities">
                            <dt>Running costs</dt>
                            <dd>{profitLocked ? <Masked /> : `−${peso(incomeStatementSummary?.totalOperatingExpenses ?? incomeStatementSummary?.operatingExpenses ?? 0)}`}</dd>
                          </div>
                          <div className="is-less" title="Depreciation (equipment losing value) and income tax">
                            <dt>Equipment wear &amp; tax</dt>
                            <dd>{profitLocked ? <Masked /> : `−${peso(Number(incomeStatementSummary?.depreciation || 0) + Number(incomeStatementSummary?.tax || 0))}`}</dd>
                          </div>
                          <div className="is-total" title="Net income: what the store keeps after all costs and tax">
                            <dt>Take-home profit</dt>
                            <dd>
                              {netIncomePin.unlocked && incomeStatementSummary?.netIncome != null
                                ? peso(incomeStatementSummary.netIncome)
                                : <Masked />}
                            </dd>
                          </div>
                        </dl>

                        <div className="rp-receipt-actions">
                          <button
                            type="button"
                            className="rp-receipt-btn"
                            onClick={() => (netIncomePin.unlocked ? netIncomePin.lock() : netIncomePin.setModalOpen(true))}
                          >
                            {netIncomePin.unlocked
                              ? <><Lock size={14} aria-hidden="true" /> Hide profit</>
                              : <><LockOpen size={14} aria-hidden="true" /> Show profit with PIN</>}
                          </button>
                          {netIncomePin.unlocked && (
                            <button type="button" className="rp-receipt-link" onClick={() => netIncomePin.setModalOpen(true)}>
                              Change PIN
                            </button>
                          )}
                        </div>

                        <footer className="rp-receipt-foot">Printed {generatedStamp}</footer>
                      </div>
                    </article>

                    <article className="rp-ledger" aria-label="Costs and payments">
                      <svg className="rp-clip" viewBox="0 0 24 64" aria-hidden="true">
                        <path d="M8 46V12a5 5 0 0 1 10 0v38a8 8 0 0 1-16 0V16" />
                      </svg>
                      <header className="rp-ledger-head">
                        <h3 className="rp-sub">Costs &amp; payments</h3>
                        <span className="rp-ledger-stamp">{periodTitle}</span>
                      </header>
                      {summary.uncostedItemsCount > 0 && (
                        <p className="rp-flag" role="status">
                          <AlertTriangle size={14} aria-hidden="true" />
                          {summary.uncostedItemsCount} sold unit{summary.uncostedItemsCount === 1 ? " has" : "s have"} no ingredient cost yet, so costs below are too low.
                        </p>
                      )}
                      <dl className="rp-ledger-rows">
                        <div>
                          <dt title="Cost of goods sold: ingredients of what you sold, plus wasted stock">
                            Cost to make
                            <small>Ingredients {peso(summary.salesCogs)}, wasted stock {peso(summary.spoilageCost)}</small>
                          </dt>
                          <dd>{peso(summary.totalCogs ?? summary.cogs)}</dd>
                        </div>
                        <div>
                          <dt title="How much of every peso of sales goes to cost to make. Lower is better">
                            Cost as % of sales
                            <small>Goal: {Number(foodCostAnalysis.targetPct.toFixed(2))}% or less</small>
                          </dt>
                          <dd>
                            {foodCostAnalysis.actualPct != null ? `${foodCostAnalysis.actualPct.toFixed(1)}%` : "—"}
                            {foodCostAnalysis.varianceLabel && (
                              <span className={`rp-tag ${foodCostAnalysis.isOverTarget ? "is-bad" : "is-good"}`}>
                                {foodCostAnalysis.varianceLabel}
                              </span>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt title="Gross profit: total sales minus the cost to make">Profit after cost to make</dt>
                          <dd>
                            {peso(summary.grossProfit)}
                            <span className="rp-tag is-good">{Number(summary.marginPercent || 0).toFixed(1)}% margin</span>
                          </dd>
                        </div>
                        <div className="rp-ledger-pay">
                          <dt>Paid by</dt>
                          <dd>
                            <PaymentSplit cash={summary.cashCollected} gcash={summary.gcashCollected} card={summary.cardCollected} />
                          </dd>
                        </div>
                        <div>
                          <dt>Cancelled orders</dt>
                          <dd className={summary.voidedOrdersCount > 0 ? "is-bad" : ""}>
                            {summary.voidedOrdersCount}
                            <small>{peso(summary.voidedSalesTotal)}</small>
                          </dd>
                        </div>
                        <div className="rp-ledger-spent">
                          <dt>Stock bought <small>{summary.inventoryRestockCount} {summary.inventoryRestockCount === 1 ? "restock" : "restocks"}</small></dt>
                          <dd>
                            <InkArrow />
                            <span className="rp-hl">{peso(summary.inventoryExpenditure)}</span>
                          </dd>
                        </div>
                      </dl>
                      <span className="rp-dogear" aria-hidden="true" />
                    </article>
                  </div>
                </section>

                {/* ---------- Products ---------- */}
                <section id="rp-products" className="rp-section" aria-labelledby="rp-products-title">
                  <div className="nb-sheet-title">
                    <h2 id="rp-products-title">What sold, and how</h2>
                    <span className="nb-sheet-note">{rankedProducts.length} {rankedProducts.length === 1 ? "item" : "items"} sold</span>
                  </div>

                  <div className="rp-products-grid">
                    <article className="nb-card rp-card" aria-label="Order types">
                      <span className="nb-tape" aria-hidden="true" />
                      <h3 className="rp-sub">Where orders come from</h3>
                      <div className="rp-channels" key={`mix-${rangeKey}-${staffFilterId ?? "all"}`}>
                        {channels.length ? channels.map((channel) => {
                          const relPct = topChannelSales > 0 ? Math.max(4, Math.min(100, (channel.sales / topChannelSales) * 100)) : 0;
                          return (
                            <div className="rp-channel" key={channel.type}>
                              <div className="rp-channel-head">
                                <strong>{channel.type}</strong>
                                <span>{Math.round(channel.sharePercent || 0)}%</span>
                              </div>
                              <div className="nbi-gauge"><span style={{ width: `${relPct}%` }} /></div>
                              <small>{channel.ordersCount} order{channel.ordersCount === 1 ? "" : "s"}, {peso(channel.sales)}</small>
                            </div>
                          );
                        }) : (
                          <p className="rp-muted">No orders in this period yet.</p>
                        )}
                      </div>
                      <div className="rp-status-row">
                        <span className="nb-chip nb-chip-ok">{summary.paidOrdersCount} paid</span>
                        <span className="nb-chip nb-chip-warn">{summary.unpaidOrdersCount} unpaid</span>
                        <span className="nb-chip nb-chip-alert">{summary.voidedOrdersCount} cancelled</span>
                      </div>
                    </article>

                    <article className="rp-best" aria-labelledby="rp-best-title">
                      <span className="nb-tape rp-best-tape" aria-hidden="true" />
                      <header className="rp-best-head">
                        <svg className="rp-rosette" viewBox="0 0 64 80" aria-hidden="true" focusable="false">
                          <path d="M22 44 12 76l11-6 7 9 6-30z" fill="#8f3322" />
                          <path d="M42 44l10 32-11-6-7 9-6-30z" fill="#b0412c" />
                          <path d="M32 4l5 4 6-1 2 6 6 3-1 6 4 5-4 5 1 6-6 3-2 6-6-1-5 4-5-4-6 1-2-6-6-3 1-6-4-5 4-5-1-6 6-3 2-6 6 1z" fill="#e2b867" stroke="#9c6b26" strokeWidth="1" />
                          <circle cx="32" cy="28" r="13" fill="#fff6dc" stroke="#9c6b26" strokeWidth="1.2" />
                          <path d="M32 20.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" fill="#b0412c" />
                        </svg>
                        <div>
                          <h3 id="rp-best-title">Best sellers</h3>
                          <p>
                            {bestTotal ? `Top ${bestTotal} by sales` : "Ranked by sales"}, {periodTitle.toLowerCase()}
                          </p>
                        </div>
                      </header>

                      <div className="rp-best-page">
                          <ol className="rp-best-list" key={`best-${bestPage}-${rangeKey}`}>
                            {pagedProducts.map((product, index) => {
                              const rank = bestPage * BEST_PAGE_SIZE + index + 1;
                              const medal = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "plain";
                              const sharePct = summary.grossCollectedSales > 0
                                ? (product.sales / summary.grossCollectedSales) * 100
                                : 0;
                              return (
                                <li key={`${product.productId || product.productName}-${product.sizeLabel}`} className={`rp-best-row medal-${medal}`}>
                                  <span className="rp-best-rank" aria-label={`Rank ${rank}`}>
                                    <small aria-hidden="true">No.</small>
                                    <span aria-hidden="true">{rank}</span>
                                  </span>
                                  <div className="rp-best-body">
                                    <div className="rp-best-name">
                                      <strong>{product.productName}</strong>
                                      <small>{product.sizeLabel || "Regular"}, {product.category}</small>
                                    </div>
                                    <dl className="rp-best-figs">
                                      <div>
                                        <dt>Sales</dt>
                                        <dd>{peso(product.sales)}</dd>
                                      </div>
                                      <div>
                                        <dt title="Ingredient and packaging cost of the items sold">Cost to make</dt>
                                        <dd>
                                          {peso(product.cogs)}
                                          {product.uncostedItemsCount > 0 && (
                                            <em className="is-bad" title={`${product.uncostedItemsCount} sold unit(s) missing cost data`}>incomplete</em>
                                          )}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt>Profit</dt>
                                        <dd className="is-good">{peso(product.grossProfit)} <em>{Number(product.marginPercent || 0).toFixed(1)}%</em></dd>
                                      </div>
                                    </dl>
                                    <div className="rp-best-share" title={product.addonSales > 0 ? `Includes ${peso(product.addonSales)} from add-ons` : undefined}>
                                      <span className="nbi-gauge" aria-hidden="true"><span style={{ width: `${Math.max(3, Math.min(100, sharePct))}%` }} /></span>
                                      <span>{Math.round(sharePct)}% of all sales</span>
                                    </div>
                                  </div>
                                  <div className="rp-best-sold">
                                    <span className="rp-hl">{Number(product.unitsSold || 0).toLocaleString()}</span>
                                    <small>sold</small>
                                  </div>
                                </li>
                              );
                            })}
                            {/* Invisible stand-ins keep the card three rows tall on short pages and when empty */}
                            {Array.from({ length: BEST_PAGE_SIZE - pagedProducts.length }).map((_, i) => (
                              <BestSellerGhostRow
                                key={`ghost-${i}`}
                                blank={!pagedProducts.length}
                                rank={pagedProducts.length + i + 1}
                              />
                            ))}
                          </ol>

                          {!pagedProducts.length && (
                            <div className="rp-best-empty" role="status">
                              <div className="rp-best-slip">
                                <strong>Nothing sold yet</strong>
                                <span>The first paid order {rangeKey === "today" ? "today " : ""}gets written on line 1.</span>
                              </div>
                              <svg className="rp-pencil" viewBox="0 0 240 40" aria-hidden="true" focusable="false">
                                <defs>
                                  <linearGradient id="rp-pencil-body" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0" stopColor="#ffd86b" />
                                    <stop offset="0.34" stopColor="#f4b630" />
                                    <stop offset="0.36" stopColor="#ffcf4d" />
                                    <stop offset="0.66" stopColor="#e9a521" />
                                    <stop offset="0.68" stopColor="#f6bb3a" />
                                    <stop offset="1" stopColor="#c9851a" />
                                  </linearGradient>
                                  <linearGradient id="rp-pencil-metal" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0" stopColor="#eef0f2" />
                                    <stop offset="0.45" stopColor="#a9adb3" />
                                    <stop offset="0.55" stopColor="#d8dbdf" />
                                    <stop offset="1" stopColor="#7d838a" />
                                  </linearGradient>
                                  <linearGradient id="rp-pencil-wood" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0" stopColor="#f6dcb6" />
                                    <stop offset="1" stopColor="#d8ae7c" />
                                  </linearGradient>
                                  <linearGradient id="rp-pencil-eraser" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0" stopColor="#f6a7a0" />
                                    <stop offset="1" stopColor="#d26e66" />
                                  </linearGradient>
                                </defs>
                                <ellipse cx="122" cy="33" rx="108" ry="4" fill="#3b2619" opacity="0.14" />
                                <rect x="6" y="8" width="26" height="22" rx="6" fill="url(#rp-pencil-eraser)" />
                                <rect x="26" y="7" width="22" height="24" fill="url(#rp-pencil-metal)" />
                                <path d="M31 7v24M36 7v24M41 7v24" stroke="#7d838a" strokeOpacity="0.6" />
                                <rect x="48" y="8" width="146" height="22" fill="url(#rp-pencil-body)" />
                                <path d="M194 8l30 11-30 11z" fill="url(#rp-pencil-wood)" />
                                <path d="M194 8c2 3 2 19 0 22" fill="none" stroke="#c9851a" strokeWidth="1.2" />
                                <path d="M214 15.4l12 3.6-12 3.6z" fill="#3d3a38" />
                                <text x="74" y="22.5" fill="#6b4a0f" fontSize="8.5" fontWeight="700" letterSpacing="1.5" opacity="0.75">AMAYA · HB</text>
                              </svg>
                            </div>
                          )}
                      </div>

                          {bestPageCount > 1 && (
                            <nav className="rp-best-pager" aria-label="Best seller pages">
                              <button type="button" onClick={() => setBestPage(Math.max(0, bestPage - 1))} disabled={bestPage === 0}>
                                <ChevronLeft size={15} aria-hidden="true" /> Previous
                              </button>
                              <span className="rp-best-dots">
                                {Array.from({ length: bestPageCount }).map((_, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    className={i === bestPage ? "is-active" : ""}
                                    aria-label={`Show ranks ${i * BEST_PAGE_SIZE + 1} to ${Math.min(bestTotal, (i + 1) * BEST_PAGE_SIZE)}`}
                                    aria-current={i === bestPage ? "page" : undefined}
                                    onClick={() => setBestPage(i)}
                                  />
                                ))}
                                <small>{bestPage * BEST_PAGE_SIZE + 1}–{Math.min(bestTotal, (bestPage + 1) * BEST_PAGE_SIZE)} of {bestTotal}</small>
                              </span>
                              <button type="button" onClick={() => setBestPage(Math.min(bestPageCount - 1, bestPage + 1))} disabled={bestPage >= bestPageCount - 1}>
                                Next <ChevronRight size={15} aria-hidden="true" />
                              </button>
                            </nav>
                          )}
                    </article>
                  </div>
                </section>

                {/* ---------- Staff: a log sheet on a clipboard ---------- */}
                <section id="rp-staff" className="rp-section" aria-labelledby="rp-staff-title">
                  <div className="rp-clipboard">
                    <svg className="rp-clip-holder" viewBox="0 0 220 76" aria-hidden="true" focusable="false">
                      <defs>
                        <linearGradient id="rp-clip-brass" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0" stopColor="#fff0c4" />
                          <stop offset="0.18" stopColor="#e6bf6c" />
                          <stop offset="0.5" stopColor="#b98a3a" />
                          <stop offset="0.72" stopColor="#d9ae5a" />
                          <stop offset="1" stopColor="#7d5520" />
                        </linearGradient>
                        <linearGradient id="rp-clip-wire" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0" stopColor="#8a6024" />
                          <stop offset="0.5" stopColor="#f7dc98" />
                          <stop offset="1" stopColor="#8a6024" />
                        </linearGradient>
                      </defs>
                      <ellipse cx="110" cy="70" rx="92" ry="5" fill="#1d120a" opacity="0.35" />
                      <path d="M66 32c2-20 18-28 44-28s42 8 44 28" fill="none" stroke="url(#rp-clip-wire)" strokeWidth="5" strokeLinecap="round" />
                      <path d="M14 66V44c0-9 6-14 16-14h44c6-14 18-20 36-20s30 6 36 20h44c10 0 16 5 16 14v22z" fill="url(#rp-clip-brass)" stroke="#6b4614" strokeWidth="1.2" />
                      <path d="M22 60V46c0-6 4-9 10-9h46c5-12 15-18 32-18s27 6 32 18h46c6 0 10 3 10 9v14" fill="none" stroke="#fff3cf" strokeOpacity="0.55" strokeWidth="1" />
                      <rect x="94" y="26" width="32" height="9" rx="4.5" fill="#4a300c" opacity="0.75" />
                      <circle cx="36" cy="52" r="5" fill="url(#rp-clip-wire)" stroke="#6b4614" strokeWidth="0.8" />
                      <circle cx="184" cy="52" r="5" fill="url(#rp-clip-wire)" stroke="#6b4614" strokeWidth="0.8" />
                      <path d="M34.5 50.5l3 3M182.5 50.5l3 3" stroke="#6b4614" strokeWidth="0.9" />
                    </svg>

                    <article className="rp-attend">
                      <span className="rp-attend-ribbon" aria-hidden="true"><span>Team</span></span>

                      <header className="rp-attend-head">
                        <h2 id="rp-staff-title">Cashiers &amp; staff</h2>
                        <p>
                          {periodTitle}, as of {liveDate}
                          <span className="rp-attend-note">
                            {staffRosterTotals.activeWithSales} {staffRosterTotals.activeWithSales === 1 ? "person" : "people"} made sales
                          </span>
                        </p>
                      </header>

                      <dl className="rp-attend-fields" aria-label="Staff sales summary">
                        <div><dt>Orders</dt><dd>{staffRosterTotals.ordersCount.toLocaleString()}</dd></div>
                        <div><dt title="Money from the orders your staff handled">Money taken in</dt><dd>{peso(staffRosterTotals.grossSales)}</dd></div>
                        <div><dt>Average order</dt><dd>{peso(staffRosterTotals.averageTicket)}</dd></div>
                        <div>
                          <dt>Wages paid</dt>
                          <dd>
                            {coreState.staffPerf?.laborLocked ? (
                              <button type="button" className="rp-receipt-link" onClick={() => netIncomePin.setModalOpen(true)}>
                                <LockOpen size={13} aria-hidden="true" /> Enter PIN to see
                              </button>
                            ) : coreState.staffPerf?.totals?.laborCost != null ? (
                              <>
                                {peso(coreState.staffPerf.totals.laborCost)}
                                <small>{peso(coreState.staffPerf.totals.profitAfterWages)} left after wages</small>
                              </>
                            ) : "—"}
                          </dd>
                        </div>
                      </dl>

                      <div className="rp-controls rp-attend-controls">
                        <div className="rp-pills" role="group" aria-label="Filter staff">
                          {ROSTER_FILTERS.map((rf) => (
                            <button
                              key={rf.key}
                              type="button"
                              className={`rp-pill${rosterFilter === rf.key ? " is-active" : ""}`}
                              aria-pressed={rosterFilter === rf.key}
                              onClick={() => setRosterFilter(rf.key)}
                            >
                              {rf.label}
                            </button>
                          ))}
                        </div>
                        <label className="nb-field nb-sort">
                          <span className="rp-field-label">Sort</span>
                          <select value={rosterSort} onChange={(e) => setRosterSort(e.target.value)} aria-label="Sort staff">
                            {ROSTER_SORTS.map((rs) => (
                              <option key={rs.key} value={rs.key}>{rs.label}</option>
                            ))}
                          </select>
                        </label>
                      </div>

                      {visibleStaffRoster.length ? (
                        <div className="rp-attend-table" key={`staff-${rangeKey}-${rosterFilter}-${rosterSort}`}>
                          <div className="rp-attend-cols" aria-hidden="true">
                            <span>No.</span>
                            <span>Staff member</span>
                            <span className="is-num">Orders</span>
                            <span className="is-num">Average order</span>
                            <span className="is-num">Profit</span>
                            <span className="is-num">Sales</span>
                            <span>Orders checked</span>
                            <span />
                          </div>
                          <ol className="rp-attend-rows">
                            {visibleStaffRoster.map((cashier, index) => {
                              const sharePct = Number(cashier.sharePercent || 0);
                              const isZero = !(cashier.grossSales > 0);
                              const isLead = index === 0 && !isZero && cashier.isActive;
                              const isFilteredHere = Number(staffFilterId) === Number(cashier.userId);
                              const toConfirm = Number(cashier.unconfirmedOrdersCount || 0);
                              return (
                                <li key={cashier.userId}>
                                  <button
                                    type="button"
                                    className={`rp-attend-row${isLead ? " is-lead" : ""}${isFilteredHere ? " is-filtered" : ""}${!cashier.isActive ? " is-inactive" : ""}${isZero ? " is-zero" : ""}`}
                                    onClick={(e) => handleOpenStaffModal(cashier, e)}
                                    aria-label={`See what ${cashier.displayName} did: ${peso(cashier.grossSales)} from ${cashier.ordersCount} orders`}
                                  >
                                    <span className="rp-attend-no">{String(index + 1).padStart(2, "0")}</span>

                                    <span className="rp-attend-who">
                                      <span className="rp-attend-initials" aria-hidden="true">{initials(cashier.displayName)}</span>
                                      <span className="rp-attend-name">
                                        <strong>{cashier.displayName}</strong>
                                        <span className="rp-attend-tags">
                                          <span>{cashier.role === "admin" ? "Admin" : "Cashier"}</span>
                                          {isLead && <span className="rp-attend-top"><Trophy size={11} aria-hidden="true" /> Top seller</span>}
                                          {!cashier.isActive && <span className="is-muted">Inactive</span>}
                                          {isFilteredHere && <span className="is-ink">Filtered</span>}
                                          {cashier.voidedOrdersCount > 0 && <span className="is-bad">{cashier.voidedOrdersCount} cancelled</span>}
                                        </span>
                                        {cashier.laborCost != null && (
                                          <span className="rp-attend-wages">
                                            Wages {peso(cashier.laborCost)}
                                            {cashier.salesPerLaborHour != null && `, earns ${peso(cashier.salesPerLaborHour)} in sales per hour`}
                                            , <span className={cashier.profitAfterWages < 0 ? "is-bad" : ""}>{peso(cashier.profitAfterWages)} after wages</span>
                                          </span>
                                        )}
                                      </span>
                                    </span>

                                    <span className="rp-attend-cell is-num" data-label="Orders">{cashier.ordersCount}</span>
                                    <span className="rp-attend-cell is-num" data-label="Average order">{peso(cashier.averageTicket)}</span>
                                    <span className="rp-attend-cell is-num" data-label="Profit">
                                      {peso(cashier.attributedGrossProfit)}
                                      <small>{Number(cashier.marginPercent || 0).toFixed(1)}% of their sales</small>
                                    </span>
                                    <span className="rp-attend-cell is-num rp-attend-sales" data-label="Sales">
                                      <strong>{peso(cashier.grossSales)}</strong>
                                      <span className="rp-attend-share" aria-hidden="true">
                                        <span style={{ width: `${isZero ? 0 : Math.max(3, Math.min(100, sharePct))}%` }} />
                                      </span>
                                      <small>{Math.round(sharePct)}% of sales</small>
                                    </span>

                                    <span className="rp-attend-cell rp-attend-status" data-label="Orders checked">
                                      {cashier.ordersCount > 0 ? (toConfirm > 0 ? (
                                        <span className="rp-stamp is-warn" title="Paid orders the owner still needs to check">
                                          {toConfirm} still to check
                                          <small>{peso(cashier.unconfirmedSales)}</small>
                                        </span>
                                      ) : (
                                        <span className="rp-stamp is-good" title="The owner checked all of this person's paid orders">
                                          <CheckCircle2 size={12} aria-hidden="true" /> All checked
                                        </span>
                                      )) : (
                                        <span className="rp-stamp is-none">No sales</span>
                                      )}
                                    </span>

                                    <span className="rp-attend-open" aria-hidden="true">
                                      Details <ArrowRight size={13} />
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ol>
                        </div>
                      ) : (
                        <div className="rp-attend-empty">
                          <Users size={22} aria-hidden="true" />
                          <strong>No staff match this filter</strong>
                          <span>Choose “Everyone” to see the whole team.</span>
                        </div>
                      )}

                      <footer className="rp-attend-foot">
                        <span>Click anyone on the list to see everything they did.</span>
                        <span className="rp-attend-sign">Checked by <i aria-hidden="true" /></span>
                      </footer>
                    </article>
                  </div>
                </section>

                {/* ---------- Stock ---------- */}
                <section id="rp-stock" className="rp-section" aria-labelledby="rp-stock-title">
                  <div className="nb-sheet-title">
                    <h2 id="rp-stock-title">Stock right now</h2>
                    <span className="nb-sheet-note">worth {peso(summary.inventoryAssetValue)}</span>
                  </div>

                  <div className="rp-strip" aria-label="Stock summary">
                    <div><span>Tracked</span><strong>{stockBreakdown.total}</strong></div>
                    <div className="is-good" title="Not low, not out, and not above the maximum"><span>Healthy</span><strong>{stockBreakdown.healthy}</strong></div>
                    <div className="is-bad" title="Low or out of stock"><span>Low or out</span><strong>{restockItems.length}</strong></div>
                    <div className="is-over"><span>Above maximum</span><strong>{stockBreakdown.over}</strong></div>
                    <div className="rp-strip-action">
                      <button
                        type="button"
                        className="nb-btn nb-btn-primary"
                        onClick={(e) => {
                          restockTriggerRef.current = e.currentTarget;
                          setRestockNotice("");
                          setRestockClosing(false);
                          setRestockModalOpen(true);
                        }}
                        aria-haspopup="dialog"
                      >
                        <ClipboardList size={15} aria-hidden="true" />
                        Restock list
                        <span className="rp-count">{restockItems.length}</span>
                      </button>
                    </div>
                  </div>

                  <div className="rp-controls">
                    <div className="rp-pills" role="tablist" aria-label="Filter stock">
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
                            className={`rp-pill${filter === stockFilter ? " is-active" : ""}`}
                            onClick={() => setStockFilter(filter)}
                          >
                            {filter === "all" ? "All items" : filter === "attention" ? "Needs attention" : "Healthy"}
                            <span>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                    <label className="nb-field nb-sort">
                      <span className="rp-field-label">Sort</span>
                      <select value={stockSort} onChange={(event) => setStockSort(event.target.value)} aria-label="Sort stock">
                        <option value="name">Item name</option>
                        <option value="category">Category</option>
                        <option value="low">Fullness: low to high</option>
                        <option value="high">Fullness: high to low</option>
                        <option value="status">Needs attention first</option>
                      </select>
                    </label>
                  </div>

                  {inventoryLoading && inventory.length === 0 ? (
                    <div className="nb-empty" role="status"><Package size={24} aria-hidden="true" /><strong>Loading stock</strong><span>Getting the latest quantities.</span></div>
                  ) : inventoryError && inventory.length === 0 ? (
                    <div className="nb-empty" role="alert"><AlertTriangle size={24} aria-hidden="true" /><strong>Stock couldn’t load</strong><span>{inventoryError}</span></div>
                  ) : visibleStock.length ? (
                    <>
                      <p className="rp-legend" aria-hidden="true">
                        Bar shows how full each item is compared to its maximum:
                        <i className="health-critical" /> 20% or less
                        <i className="health-low" /> 40% or less
                        <i className="health-moderate" /> 70% or less
                        <i className="health-available" /> above 70%
                      </p>
                      <ul className="rp-stock-grid" key={`stock-${stockFilter}-${stockSort}`}>
                        {visibleStock.map((item) => {
                          const hasMax = item.maximumStock != null;
                          const barWidth = hasMax ? Math.max(0, Math.min(100, item.capacityPercent ?? 0)) : 0;
                          return (
                            <li
                              key={item.id ?? item.item}
                              className={`rp-stock tone-${item.healthTone}`}
                              aria-label={`${item.item}: ${item.quantity.toLocaleString()} ${item.unit}, ${item.label}`}
                            >
                              <div className="rp-stock-top">
                                <span className="rp-item">
                                  <strong>{item.item}</strong>
                                  <small>{item.category}</small>
                                </span>
                                <span className={`rp-health tone-${item.healthTone}`}>{item.label}</span>
                              </div>
                              <div className="rp-stock-qty">
                                <strong>{item.quantity.toLocaleString()}</strong> {item.unit}
                                <span>
                                  {hasMax ? `of ${Number(item.maximumStock).toLocaleString()} max` : "no maximum set"}
                                  {item.reportedPercent != null && hasMax ? ` · ${item.reportedPercent}%` : ""}
                                </span>
                              </div>
                              <div
                                className={`nbi-gauge health-${item.healthTone === "available" ? "ok" : item.healthTone}${hasMax ? "" : " no-maximum"}`}
                                role={hasMax ? "progressbar" : undefined}
                                aria-label={hasMax ? `${item.item} fullness` : undefined}
                                aria-valuemin={hasMax ? 0 : undefined}
                                aria-valuemax={hasMax ? 100 : undefined}
                                aria-valuenow={hasMax ? item.reportedPercent ?? undefined : undefined}
                              >
                                {hasMax && <span style={{ width: `${barWidth}%` }} />}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : (
                    <div className="nb-empty">
                      <Package size={24} aria-hidden="true" />
                      <strong>Nothing here for this filter</strong>
                      <span>Choose “All items” to see everything you track.</span>
                    </div>
                  )}
                </section>

                {/* ---------- History ---------- */}
                <section id="rp-history" className="rp-section" aria-labelledby="rp-history-title">
                  <div className="nb-sheet-title">
                    <h2 id="rp-history-title">History</h2>
                    <span className="nb-sheet-note">newest first</span>
                  </div>

                  <div className="rp-history">
                    <div className="rp-log" aria-label="Stock and restock history">
                      <div className="rp-block-head">
                        <h3 className="rp-sub">Stock changes <span>{movTotal.toLocaleString()}</span></h3>
                        {movSummary.totalRestockCount > 0 && (
                          <small className="rp-muted">
                            {peso(movSummary.totalRestockCost)} spent on {movSummary.totalRestockCount} {movSummary.totalRestockCount === 1 ? "restock" : "restocks"}
                          </small>
                        )}
                      </div>
                      <div className="rp-controls">
                        <div className="rp-pills" role="group" aria-label="Show these stock changes">
                          {MOVEMENT_FILTERS.map((mf) => (
                            <button
                              key={mf.key || "all"}
                              type="button"
                              className={`rp-pill${movTypeFilter === mf.key ? " is-active" : ""}`}
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
                        <label className="nb-field nb-search rp-search">
                          <Search size={14} aria-hidden="true" />
                          <input
                            type="search"
                            placeholder="Ingredient, supplier or note"
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
                        <p className="rp-flag" role="alert"><AlertTriangle size={14} aria-hidden="true" />{movState.error}</p>
                      )}

                      {movItems.length ? (
                        <>
                          <ul className="lg-list rp-log-list">
                            {movItems.map((mov) => {
                              const tone = getMovementTone(mov.type);
                              const linkedStaff = mov.actorId ? staffById.get(Number(mov.actorId)) : null;
                              const when = splitLedgerDate(mov.timestamp);
                              const change = Number(mov.quantityChange);
                              const hasLevels = mov.beforeQuantity != null && mov.afterQuantity != null;
                              const source = [mov.supplierName, mov.referenceNo].filter(Boolean).join(", ");
                              return (
                                <li key={mov.id} className={`rp-log-row tone-${tone}`}>
                                  <div className="rp-when">
                                    <strong>{when.day}</strong>
                                    <span>{when.time}</span>
                                  </div>
                                  <div className="rp-log-main">
                                    <div className="rp-log-title">
                                      <strong>{mov.itemName}</strong>
                                      <span className={`rp-move tone-${tone}`}>{getMovementPlainLabel(mov)}</span>
                                    </div>
                                    <div className="rp-log-meta">
                                      {hasLevels && <span title="Stock before and after">{mov.beforeQuantity} → {mov.afterQuantity} {mov.unit || ""}</span>}
                                      {source && <span>{source}</span>}
                                      {mov.note && <span>{mov.note}</span>}
                                      {mov.orderNumber && (
                                        <button type="button" className="rp-link" onClick={(e) => handleOpenOrderModal({ id: mov.orderNumber }, e)}>
                                          Order #{mov.orderNumber}
                                        </button>
                                      )}
                                      <span>
                                        by{" "}
                                        {linkedStaff ? (
                                          <button type="button" className="rp-link" onClick={(e) => handleOpenStaffModal(linkedStaff, e)}>{mov.actor}</button>
                                        ) : (mov.actor || "System")}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="rp-log-amount">
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
                        <div className="nb-empty">
                          <History size={22} aria-hidden="true" />
                          <strong>No stock changes found</strong>
                          <span>
                            {movTypeFilter || movSearch.trim()
                              ? "Try another filter or search."
                              : "Restocks, ingredients used in orders, waste and adjustments appear here."}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="rp-log" aria-label="Order history">
                      <div className="rp-block-head">
                        <h3 className="rp-sub">Orders <span>{ledgerOrdersTotal.toLocaleString()}</span></h3>
                        <small className="rp-muted">Cancelled orders included</small>
                      </div>
                      <div className="rp-controls">
                        <div className="rp-pills" role="group" aria-label="Show orders by status">
                          {ORDER_STATUS_FILTERS.map((st) => (
                            <button
                              key={st}
                              type="button"
                              className={`rp-pill${ordersStatusFilter === st ? " is-active" : ""}`}
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
                        <div className="rp-control-pair">
                          <label className="nb-field nb-sort">
                            <span className="rp-field-label">Paid by</span>
                            <select
                              value={ordersPaymentFilter}
                              onChange={(e) => {
                                setOrdersPaymentFilter(e.target.value);
                                setOrdersPage(1);
                              }}
                              aria-label="Show orders by payment method"
                            >
                              {PAYMENT_METHOD_FILTERS.map((pm) => (
                                <option key={pm} value={pm}>{pm === "All" ? "Any" : pm}</option>
                              ))}
                            </select>
                          </label>
                          <label className="nb-field nb-search rp-search">
                            <Search size={14} aria-hidden="true" />
                            <input
                              type="search"
                              placeholder="Order number or customer"
                              value={ordersSearch}
                              onChange={(e) => {
                                setOrdersSearch(e.target.value);
                                setOrdersPage(1);
                              }}
                              aria-label="Search order history"
                            />
                          </label>
                        </div>
                      </div>

                      {ordersState.error && (
                        <p className="rp-flag" role="alert"><AlertTriangle size={14} aria-hidden="true" />{ordersState.error}</p>
                      )}

                      {ledgerOrders.length ? (
                        <>
                          <ul className="lg-list rp-log-list">
                            {ledgerOrders.map((ord) => {
                              const statusClass = String(ord.status || "Pending").toLowerCase();
                              const when = splitLedgerDate(ord.createdAt);
                              return (
                                <li key={ord.id} className={`rp-log-row order-${statusClass}`}>
                                  <div className="rp-when">
                                    <strong>{when.day}</strong>
                                    <span>{when.time}</span>
                                  </div>
                                  <div className="rp-log-main">
                                    <div className="rp-log-title">
                                      <strong>{ord.customer || "Walk-in customer"}</strong>
                                      <span className={`rp-move order-${statusClass}`}>{ord.status}</span>
                                    </div>
                                    <div className="rp-log-meta">
                                      <span>Order #{ord.id}</span>
                                      <span>{getPaymentMethodLabel(ord.paymentMethod)}, {getPaymentStatusLabel(ord)}</span>
                                      <span>by {ord.cashier || "Staff"}</span>
                                    </div>
                                  </div>
                                  <div className="rp-log-amount">
                                    <strong>{peso(ord.total)}</strong>
                                    <button
                                      type="button"
                                      className="rp-view"
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
                        <div className="nb-empty">
                          <Receipt size={22} aria-hidden="true" />
                          <strong>No orders found</strong>
                          <span>Try another status, payment method or search.</span>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </section>

          <nav className="rp-dividers" aria-label="Jump to a section">
            {REPORT_SECTIONS.map((sec) => (
              <button
                key={sec.id}
                type="button"
                className={`rp-divider tone-${sec.tone}${activeSection === sec.id ? " is-active" : ""}`}
                aria-current={activeSection === sec.id ? "true" : undefined}
                onClick={() => jumpToSection(sec.id)}
              >
                {sec.label}
              </button>
            ))}
          </nav>

          <aside className="nb-notes rp-notes" aria-label="Report overview">
            <h2 className="nb-notes-title">At a glance</h2>
            <article className="nb-note nb-note-butter">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><Coins size={16} strokeWidth={2} aria-hidden="true" /><span>Total sales</span></div>
              <strong className="rp-note-money">{peso(summary.grossCollectedSales)}</strong>
              <small className={`rp-delta ${salesTrend.tone}`}>{salesTrend.text}</small>
              {Number(summary.taxCollected || 0) > 0 && (
                <small className="rp-note-sub">{peso(summary.netSales)} before {peso(summary.taxCollected)} tax</small>
              )}
            </article>
            <article className="nb-note nb-note-sage">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" /><span>Completed orders</span></div>
              <strong>{Number(summary.paidOrdersCount || 0).toLocaleString()}</strong>
              <small className={`rp-delta ${orderTrend.tone}`}>{orderTrend.text}</small>
              {summary.unpaidOrdersCount > 0 && <small className="rp-note-sub">{summary.unpaidOrdersCount} still unpaid</small>}
            </article>
            <article className="nb-note nb-note-peach">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><Receipt size={16} strokeWidth={2} aria-hidden="true" /><span>Average order</span></div>
              <strong className="rp-note-money">{peso(summary.averageOrderValue)}</strong>
              <small className={`rp-delta ${avgTrend.tone}`}>{avgTrend.text}</small>
            </article>
            <article className="nb-note nb-note-rose">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><ShoppingBag size={16} strokeWidth={2} aria-hidden="true" /><span>Items sold</span></div>
              <strong>{Number(summary.unitsSold || 0).toLocaleString()}</strong>
              <small>Across {summary.paidOrdersCount} paid {summary.paidOrdersCount === 1 ? "order" : "orders"}</small>
            </article>

            {insights.length > 0 && (
              <article className="rp-index-card" aria-label="Things to notice">
                <h3>Worth noticing</h3>
                <ul>
                  {insights.map((insight) => (
                    <li key={insight.label} className={`tone-${insight.tone}`}>
                      <span>{insight.label}</span>
                      {insight.value}
                    </li>
                  ))}
                </ul>
              </article>
            )}
          </aside>
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
