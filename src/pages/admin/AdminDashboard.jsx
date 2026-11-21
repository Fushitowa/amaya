import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Clock,
  ChartNoAxesColumnIncreasing,
  Menu,
  CircleDollarSign,
  Coins,
  Plus,
  RotateCcw,
  ShoppingBag,
  Trash2,
  TrendingUp,
  Warehouse,
  UserRound,
  X,
} from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import PortalHero from "../../components/PortalHero.jsx";
import OrderDetailsModal from "../../components/OrderDetailsModal.jsx";
import StaffActivityModal from "../../components/StaffActivityModal.jsx";
import LogWasteModal from "../../components/LogWasteModal.jsx";
import StoreAssetsHeroCard from "../../components/StoreAssetsHeroCard.jsx";
import CostRatioTiles from "../../components/CostRatioTiles.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { isOrderPaid, isToday, useOrders } from "../../context/OrdersContext.jsx";
import { getInventoryStatus, useInventory } from "../../context/InventoryContext.jsx";
import { parseMenuPrice, useMenu } from "../../context/MenuContext.jsx";
import { useBusiness } from "../../context/BusinessContext.jsx";
import { formatManilaDate, getManilaDateString } from "../../../shared/manilaDate.js";
import { apiRequest } from "../../utils/api.js";
import IngredientCostFlowCard from "../../components/IngredientCostFlowCard.jsx";
import { getStockHealth } from "../../utils/stockHealth.js";
import { formatWasteQty, getWasteReasonMeta } from "../../utils/wasteMeasurement.js";
import "../../assets/css/admin/AdminDashboard.css";
import "../../assets/css/admin/AdminDashboardOffice.css";
import "../../assets/css/order-details-modal.css";
import "../../assets/css/portal-hero.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

function getSalesLogStatus(status) {
  const normalized = String(status || "pending").trim().toLowerCase();
  if (["cancelled", "canceled", "voided"].includes(normalized)) {
    return { label: "Voided", tone: "cancelled" };
  }
  if (normalized === "completed") {
    return { label: "Completed", tone: "completed" };
  }
  return { label: "Pending", tone: "pending" };
}

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="od-seg" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          className={value === key ? "is-on" : ""}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const ORDER_ROW_LIMIT = 100;

function AdminDashboard() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { orders, confirmOrder, voidOrder, revertOrderItem } = useOrders();
  const {
    inventory = [],
    loading: inventoryLoading,
    error: inventoryError,
    wasteLogs = [],
    wasteSummary = {},
    wasteLogsLoading = false,
    wasteLogsError = "",
    fetchWasteLogs,
    reverseWasteLog,
  } = useInventory() || {};
  const { products = [] } = useMenu() || {};
  const { businessSettings } = useBusiness() || {};
  const lowThreshold = businessSettings?.lowStockThresholdPercent ?? 40;
  const criticalThreshold = businessSettings?.criticalStockThresholdPercent ?? 20;
  const [salesRange, setSalesRange] = useState("today");
  const [serverTrendState, setServerTrendState] = useState({ range: null, series: null, error: false });
  const [serverAllProducts, setServerAllProducts] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [wasteScope, setWasteScope] = useState("today");
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseError, setReverseError] = useState("");
  const [reversingWaste, setReversingWaste] = useState(false);
  const [wasteStatusNote, setWasteStatusNote] = useState("");
  const [serverSummary, setServerSummary] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [staffPerformance, setStaffPerformance] = useState([]);
  const [selectedStaffMember, setSelectedStaffMember] = useState(null);
  const [confirmingStaffId, setConfirmingStaffId] = useState(null);
  const [cashierConfirmNotice, setCashierConfirmNotice] = useState("");
  const modalTriggerRef = useRef(null);
  const staffModalTriggerRef = useRef(null);
  const reverseDialogRef = useRef(null);
  const reverseTextareaRef = useRef(null);
  const reverseTriggerRef = useRef(null);
  const reversingWasteRef = useRef(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const sync = () => setIsMobile(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    fetchWasteLogs?.({ scope: "today", limit: 25 }).catch((err) => {
      console.warn("Could not load admin waste logs:", err?.message || err);
    });
  }, [fetchWasteLogs]);

  const loadServerSummary = useCallback(() => {
    return apiRequest("/orders/summary")
      .then((data) => {
        if (data && typeof data === "object") setServerSummary(data);
        return data;
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    let active = true;
    const syncSummary = () => {
      apiRequest("/orders/summary")
        .then((data) => {
          if (active && data && typeof data === "object") setServerSummary(data);
        })
        .catch(() => {});
      apiRequest("/reports/products?rangeKey=all")
        .then((data) => {
          if (active && Array.isArray(data?.items)) setServerAllProducts(data.items);
        })
        .catch(() => {});
      apiRequest("/reports/staff-performance?rangeKey=all")
        .then((data) => {
          if (active && Array.isArray(data?.staff)) setStaffPerformance(data.staff);
        })
        .catch(() => {});
    };
    syncSummary();
    window.addEventListener("amaya:stock-mutated", syncSummary);
    window.addEventListener("amaya:session-changed", syncSummary);
    return () => {
      active = false;
      window.removeEventListener("amaya:stock-mutated", syncSummary);
      window.removeEventListener("amaya:session-changed", syncSummary);
    };
  }, []);

  useEffect(() => {
    if (salesRange === "today") return undefined;
    let active = true;
    const loadTrend = async () => {
      try {
        const manilaTodayStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        let qs;
        if (salesRange === "week") {
          qs = "rangeKey=7d";
        } else if (salesRange === "month") {
          qs = "rangeKey=30d";
        } else {
          const [yStr, mStr] = manilaTodayStr.split("-");
          const y = Number(yStr);
          const m = Number(mStr);
          const startDate = new Date(Date.UTC(y, m - 12, 1));
          const fromStr = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, "0")}-01`;
          qs = `rangeKey=custom&from=${fromStr}&to=${manilaTodayStr}`;
        }
        const res = await apiRequest(`/reports/financial-summary?${qs}`);
        if (active && Array.isArray(res?.series)) {
          setServerTrendState({ range: salesRange, series: res.series, error: false });
        }
      } catch {
        if (active) setServerTrendState({ range: salesRange, series: null, error: true });
      }
    };
    loadTrend();
    window.addEventListener("amaya:stock-mutated", loadTrend);
    window.addEventListener("amaya:session-changed", loadTrend);
    return () => {
      active = false;
      window.removeEventListener("amaya:stock-mutated", loadTrend);
      window.removeEventListener("amaya:session-changed", loadTrend);
    };
  }, [salesRange]);

  // 1. Total Sales (strictly from non-cancelled verified Paid orders)
  const paidOrders = useMemo(() => orders.filter((order) => isOrderPaid(order)), [orders]);
  const allTimeSales = useMemo(() => paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0), [paidOrders]);

  const todaysPaidOrders = useMemo(() => paidOrders.filter((order) => isToday(order.createdAt)), [paidOrders]);
  const todaysSales = useMemo(() => todaysPaidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0), [todaysPaidOrders]);
  const todaysCogs = useMemo(
    () =>
      todaysPaidOrders.reduce(
        (sum, order) =>
          sum +
          (order.items || []).reduce(
            (itemSum, item) =>
              itemSum +
              (item.unitCost != null ? Number(item.unitCost) * Number(item.quantity || 0) : 0),
            0,
          ),
        0,
      ),
    [todaysPaidOrders],
  );
  const todaysProfit = todaysSales - todaysCogs;

  // 2. Products Sold (distinguishing completed orders count vs actual unit count)
  const allTimeUnitsSold = useMemo(
    () => paidOrders.reduce((sum, order) => sum + (order.items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0),
    [paidOrders],
  );
  const todaysUnitsSold = useMemo(
    () => todaysPaidOrders.reduce((sum, order) => sum + (order.items || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0),
    [todaysPaidOrders],
  );

  // 3. Inventory Value (Total remaining stock asset value = SUM(quantity * unitCost))
  const inventoryAssetValue = useMemo(() => {
    return (inventory || []).reduce(
      (sum, item) => sum + (Number(item.quantity || 0) * Number(item.unitCost || item.unit_cost || 0)),
      0,
    );
  }, [inventory]);

  // 4. Current Budget / Cash Drawer Float
  const todaysCashCollected = useMemo(() => {
    return todaysPaidOrders
      .filter((order) => (order.paymentMethod || "Cash").toLowerCase() === "cash")
      .reduce((sum, order) => sum + Number(order.total || 0), 0);
  }, [todaysPaidOrders]);

  const effectiveAllTimeSales = serverSummary?.allTimeSales ?? allTimeSales;
  const effectiveTodaysSales = serverSummary?.todaySales ?? todaysSales;
  const effectiveTodaysCogs = serverSummary?.todayCogs ?? todaysCogs;
  const effectiveTodaysProfit = serverSummary?.todayGrossProfit ?? todaysProfit;
  const effectiveAllTimeUnits = serverSummary?.allTimeUnitsSold ?? allTimeUnitsSold;
  const effectiveTodaysUnits = serverSummary?.todayUnitsSold ?? todaysUnitsSold;
  const effectiveTodaysPaidCount = serverSummary?.todayPaidOrders ?? todaysPaidOrders.length;
  const effectiveTodaysCashCollected = serverSummary?.todayCashCollected ?? todaysCashCollected;
  const effectiveTodaysMarginPercent = effectiveTodaysSales > 0 ? (effectiveTodaysProfit / effectiveTodaysSales) * 100 : 0;

  const productImageByName = useMemo(() => {
    const map = {};
    for (const product of products || []) {
      const key = String(product?.name || "").trim().toLowerCase();
      if (key && product?.image) map[key] = product.image;
    }
    return map;
  }, [products]);

  const openOrderModal = useCallback((order, event) => {
    if (!order) return;
    modalTriggerRef.current = event?.currentTarget || null;
    setSelectedOrder(order);
  }, []);

  const openStaffActivityModal = useCallback((staff, event) => {
    if (!staff) return;
    staffModalTriggerRef.current = event?.currentTarget || null;
    setSelectedStaffMember(staff);
  }, []);

  const handleDirectConfirmCashierSales = useCallback(async (staff) => {
    const uid = staff?.userId ?? staff?.id;
    if (!uid || confirmingStaffId) return;
    const orderIds = Array.isArray(staff?.unconfirmedOrderIds) ? staff.unconfirmedOrderIds : [];
    const inspectedBefore = staff?.inspectedBefore || null;
    if (!orderIds.length && !inspectedBefore) {
      setCashierConfirmNotice(`Inspect ${staff.displayName || "Cashier"}'s sales before confirming.`);
      return;
    }
    setConfirmingStaffId(uid);
    setCashierConfirmNotice("");
    try {
      const res = await apiRequest(`/reports/staff/${uid}/confirm-sales`, {
        method: "POST",
        body: JSON.stringify({
          ...(orderIds.length > 0 ? { orderIds } : {}),
          ...(inspectedBefore ? { inspectedBefore } : {}),
          note: `Owner confirmed cashier sales & counter cash for ${staff.displayName || "Cashier"}`,
        }),
      });
      const count = Number(res?.confirmedOrdersCount || 0);
      const total = Number(res?.confirmedSalesTotal || 0);
      if (count > 0) {
        setCashierConfirmNotice(
          `Confirmed ${count} order${count === 1 ? "" : "s"} (₱${total.toFixed(2)}) for ${staff.displayName}. Added to Store Total Asset Value!`,
        );
      } else {
        setCashierConfirmNotice(`All paid sales for ${staff.displayName} are already confirmed.`);
      }
      window.dispatchEvent(new CustomEvent("amaya:stock-mutated"));
      window.dispatchEvent(new CustomEvent("amaya:session-changed"));
    } catch (err) {
      setCashierConfirmNotice(err?.message || "Could not confirm cashier sales.");
    } finally {
      setConfirmingStaffId(null);
    }
  }, [confirmingStaffId]);

  const [stockFilter, setStockFilter] = useState("all");

  const lowStockReport = useMemo(() => {
    return (inventory || [])
      .map((entry) => {
        const status = getInventoryStatus(entry.quantity, entry.maximumStock);
        if (status === "Over Maximum") return null;
        const quantity = Number(entry.quantity || 0);
        const parsedMaximumStock = entry.maximumStock == null || entry.maximumStock === "" ? null : Number(entry.maximumStock);
        const maximumStock = Number.isFinite(parsedMaximumStock) && parsedMaximumStock > 0 ? parsedMaximumStock : null;
        const { capacityPercent, reportedPercent, tone: healthTone } = getStockHealth(
          quantity,
          maximumStock,
          { overMaximum: false, lowThreshold, criticalThreshold },
        );
        const isOutOfStock = status === "Out of Stock" || quantity <= 0;
        const effectiveTone = isOutOfStock ? "critical" : healthTone;
        if (!["critical", "low", "moderate"].includes(effectiveTone)) return null;

        const healthLabel = isOutOfStock
          ? "Out of stock"
          : effectiveTone === "critical"
            ? "Critical"
            : effectiveTone === "low"
              ? "Running low"
              : "Moderate";

        return {
          id: entry.id,
          item: entry.item,
          category: entry.category || "Uncategorized",
          quantity,
          unit: entry.unit || "units",
          maximumStock,
          capacityPercent: isOutOfStock && capacityPercent == null ? 0 : capacityPercent,
          reportedPercent: isOutOfStock && reportedPercent == null ? 0 : reportedPercent,
          healthTone: effectiveTone,
          label: healthLabel,
        };
      })
      .filter(Boolean);
  }, [criticalThreshold, inventory, lowThreshold]);

  const lowStockBreakdown = useMemo(() => ({
    total: lowStockReport.length,
    critical: lowStockReport.filter((item) => item.healthTone === "critical").length,
    low: lowStockReport.filter((item) => item.healthTone === "low").length,
    moderate: lowStockReport.filter((item) => item.healthTone === "moderate").length,
  }), [lowStockReport]);

  const visibleLowStock = useMemo(() => {
    const filtered = stockFilter === "all"
      ? lowStockReport
      : stockFilter === "lowest"
        ? lowStockReport.filter((item) => item.healthTone === "critical" || item.healthTone === "low")
        : lowStockReport.filter((item) => item.healthTone === "moderate");

    const byName = (a, b) => a.item.localeCompare(b.item, undefined, { sensitivity: "base" });
    const levelValue = (item) => (item.reportedPercent == null ? 0 : item.reportedPercent);
    return [...filtered].sort((a, b) => levelValue(a) - levelValue(b) || a.quantity - b.quantity || byName(a, b));
  }, [lowStockReport, stockFilter]);

  const [topProductsTab, setTopProductsTab] = useState("all");
  const allTimeRankedUnits = useMemo(() => {
    if (Array.isArray(serverAllProducts)) {
      return serverAllProducts.reduce((sum, row) => sum + Number(row.unitsSold || 0), 0);
    }
    return effectiveAllTimeUnits;
  }, [serverAllProducts, effectiveAllTimeUnits]);
  const rankedProducts = useMemo(() => {
    if (topProductsTab === "all" && Array.isArray(serverAllProducts)) {
      const byKey = new Map();
      products.forEach((product) => {
        const normName = String(product.name || "").trim().toLowerCase();
        byKey.set(`id:${product.id}`, {
          key: `id:${product.id}`,
          productId: product.id,
          name: product.name,
          category: product.category || "Menu item",
          basePrice: parseMenuPrice(product.price),
          image: product.image || "",
          inCatalog: true,
          unitsSold: 0,
          revenue: 0,
          cogs: 0,
          ordersCount: 0,
          profit: 0,
          topSize: null,
          _normName: normName,
        });
      });

      const mergedByProduct = new Map();
      for (const row of serverAllProducts) {
        const key = row.productId != null ? `id:${row.productId}` : `name:${String(row.productName || "").trim().toLowerCase()}`;
        const existing = mergedByProduct.get(key) || {
          key,
          productId: row.productId ?? null,
          name: row.productName || "Menu Item",
          category: row.category || "Archived item",
          basePrice: 0,
          image: productImageByName[String(row.productName || "").trim().toLowerCase()] || "",
          inCatalog: byKey.has(key),
          unitsSold: 0,
          revenue: 0,
          cogs: 0,
          ordersCount: 0,
          topSize: null,
          topSizeUnits: -1,
        };
        const units = Number(row.unitsSold || 0);
        existing.unitsSold += units;
        existing.revenue += Number(row.sales || 0);
        existing.cogs += Number(row.cogs || 0);
        existing.ordersCount += Number(row.ordersCount || 0);
        if (units > existing.topSizeUnits && row.sizeLabel) {
          existing.topSize = row.sizeLabel;
          existing.topSizeUnits = units;
        }
        mergedByProduct.set(key, existing);
      }
      for (const [key, base] of byKey.entries()) {
        if (!mergedByProduct.has(key)) mergedByProduct.set(key, base);
        else {
          const item = mergedByProduct.get(key);
          item.inCatalog = true;
          item.image = base.image || item.image;
          item.basePrice = base.basePrice;
          item.name = base.name;
          item.category = base.category;
        }
      }
      const list = [...mergedByProduct.values()].map((entry) => ({
        ...entry,
        profit: entry.revenue - entry.cogs,
      }));
      list.sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue || a.name.localeCompare(b.name));
      const totalUnits = list.reduce((sum, item) => sum + item.unitsSold, 0);
      const maxUnits = Math.max(1, list[0]?.unitsSold || 0);
      return list.map((item, idx) => ({
        ...item,
        rank: idx + 1,
        sharePercent: totalUnits > 0 ? (item.unitsSold / totalUnits) * 100 : 0,
        barPercent: item.unitsSold > 0 ? Math.max(6, (item.unitsSold / maxUnits) * 100) : 0,
      }));
    }

    const sourceOrders = topProductsTab === "today" ? todaysPaidOrders : paidOrders;
    const byKey = new Map();
    const nameToKey = new Map();

    products.forEach((product) => {
      const key = `id:${product.id}`;
      const normName = String(product.name || "").trim().toLowerCase();
      if (normName) nameToKey.set(normName, key);
      byKey.set(key, {
        key,
        productId: product.id,
        name: product.name,
        category: product.category || "Menu item",
        basePrice: parseMenuPrice(product.price),
        image: product.image || "",
        inCatalog: true,
        unitsSold: 0,
        revenue: 0,
        cogs: 0,
        orderIds: new Set(),
        sizes: {},
      });
    });

    sourceOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        const qty = Number(item.quantity || 0);
        if (qty <= 0) return;
        const unitPrice = Number(item.price || 0);
        const unitCost = item.unitCost != null ? Number(item.unitCost) : 0;
        const title = String(item.title || "Menu Item").trim();
        const normName = title.toLowerCase();
        let key = item.productId != null && byKey.has(`id:${item.productId}`)
          ? `id:${item.productId}`
          : nameToKey.get(normName) || (item.productId != null ? `id:${item.productId}` : `name:${normName}`);

        if (!byKey.has(key)) {
          byKey.set(key, {
            key,
            productId: item.productId ?? null,
            name: title,
            category: item.category || "Archived item",
            basePrice: unitPrice,
            image: "",
            inCatalog: false,
            unitsSold: 0,
            revenue: 0,
            cogs: 0,
            orderIds: new Set(),
            sizes: {},
          });
          if (normName) nameToKey.set(normName, key);
        }

        const entry = byKey.get(key);
        entry.unitsSold += qty;
        entry.revenue += qty * unitPrice;
        entry.cogs += qty * unitCost;
        entry.orderIds.add(order.id);
        const sizeLabel = String(item.size || "Regular").trim();
        entry.sizes[sizeLabel] = (entry.sizes[sizeLabel] || 0) + qty;
      });
    });

    const list = [...byKey.values()].map((entry) => {
      const topSizeEntry = Object.entries(entry.sizes).sort((a, b) => b[1] - a[1])[0];
      return {
        ...entry,
        ordersCount: entry.orderIds.size,
        profit: entry.revenue - entry.cogs,
        topSize: topSizeEntry ? topSizeEntry[0] : null,
      };
    });

    list.sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue || a.name.localeCompare(b.name));
    const totalUnits = list.reduce((sum, item) => sum + item.unitsSold, 0);
    const maxUnits = Math.max(1, list[0]?.unitsSold || 0);
    return list.map((item, idx) => ({
      ...item,
      rank: idx + 1,
      sharePercent: totalUnits > 0 ? (item.unitsSold / totalUnits) * 100 : 0,
      barPercent: item.unitsSold > 0 ? Math.max(6, (item.unitsSold / maxUnits) * 100) : 0,
    }));
  }, [paidOrders, products, productImageByName, serverAllProducts, todaysPaidOrders, topProductsTab]);
  const [ordersTab, setOrdersTab] = useState("today");
  const todaysOrders = useMemo(() => orders.filter((order) => isToday(order.createdAt)), [orders]);
  const displayOrders = ordersTab === "today" ? todaysOrders : orders;
  const visibleOrders = useMemo(() => displayOrders.slice(0, ORDER_ROW_LIMIT), [displayOrders]);

  const liveDate = formatManilaDate(new Date(), {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const salesBuckets = useMemo(() => {
    const manilaTodayStr = getManilaDateString(new Date());
    const [mYear, mMonth, mDay] = manilaTodayStr.split("-").map(Number);
    const manilaMidnight = new Date(`${manilaTodayStr}T00:00:00+08:00`);
    let buckets;

    if (salesRange === "today") {
      const hours = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
      buckets = hours.map((hour) => {
        const start = new Date(manilaMidnight.getTime() + hour * 3_600_000);
        const end = new Date(manilaMidnight.getTime() + (hour + 2) * 3_600_000);
        const formatHour = hour === 0 ? "12AM" : hour === 12 ? "12PM" : hour > 12 ? `${hour - 12}PM` : `${hour}AM`;
        return { start, end, label: formatHour };
      });
    } else if (salesRange === "year") {
      buckets = Array.from({ length: 12 }, (_, index) => {
        const dStart = new Date(Date.UTC(mYear, mMonth - 12 + index, 1));
        const dEnd = new Date(Date.UTC(mYear, mMonth - 11 + index, 1));
        const startStr = `${dStart.getUTCFullYear()}-${String(dStart.getUTCMonth() + 1).padStart(2, "0")}-01`;
        const endStr = `${dEnd.getUTCFullYear()}-${String(dEnd.getUTCMonth() + 1).padStart(2, "0")}-01`;
        const start = new Date(`${startStr}T00:00:00+08:00`);
        const end = new Date(`${endStr}T00:00:00+08:00`);
        const label = dStart.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
        return { start, end, label, ymKey: startStr.slice(0, 7) };
      });
    } else {
      const days = salesRange === "month" ? 30 : 7;
      const bucketDays = salesRange === "month" ? 5 : 1;
      const startBase = new Date(Date.UTC(mYear, mMonth - 1, mDay - days + 1));
      buckets = Array.from({ length: days / bucketDays }, (_, index) => {
        const bStartUtc = new Date(startBase.getTime() + index * bucketDays * 86_400_000);
        const bEndUtc = new Date(bStartUtc.getTime() + bucketDays * 86_400_000);
        const startIso = `${bStartUtc.getUTCFullYear()}-${String(bStartUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(bStartUtc.getUTCDate()).padStart(2, "0")}`;
        const endIso = `${bEndUtc.getUTCFullYear()}-${String(bEndUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(bEndUtc.getUTCDate()).padStart(2, "0")}`;
        return {
          start: new Date(`${startIso}T00:00:00+08:00`),
          end: new Date(`${endIso}T00:00:00+08:00`),
          startIso,
          endIso,
          label: salesRange === "week"
            ? bStartUtc.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
            : bStartUtc.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
        };
      });
    }

    const activeServerSeries = salesRange !== "today" && serverTrendState.range === salesRange && Array.isArray(serverTrendState.series)
      ? serverTrendState.series
      : null;

    if (activeServerSeries) {
      return buckets.map((bucket) => {
        let bucketTotal = 0;
        let bucketCogs = 0;
        let bucketProfit = 0;
        for (const dayRow of activeServerSeries) {
          if (salesRange === "year") {
            if (String(dayRow.date || "").startsWith(bucket.ymKey)) {
              bucketTotal += Number(dayRow.sales || 0);
              bucketCogs += Number(dayRow.cogs || 0);
              bucketProfit += Number(dayRow.profit ?? (Number(dayRow.sales || 0) - Number(dayRow.cogs || 0)));
            }
          } else if (dayRow.date >= bucket.startIso && dayRow.date < bucket.endIso) {
            bucketTotal += Number(dayRow.sales || 0);
            bucketCogs += Number(dayRow.cogs || 0);
            bucketProfit += Number(dayRow.profit ?? (Number(dayRow.sales || 0) - Number(dayRow.cogs || 0)));
          }
        }
        return { ...bucket, total: bucketTotal, cogs: bucketCogs, profit: bucketProfit };
      });
    }

    return buckets.map((bucket) => {
      let bucketTotal = 0;
      let bucketCogs = 0;
      orders.forEach((order) => {
        if (!isOrderPaid(order)) return;
        const createdAt = new Date(order.createdAt);
        if (createdAt >= bucket.start && createdAt < bucket.end) {
          bucketTotal += Number(order.total || 0);
          bucketCogs += (order.items || []).reduce(
            (itemSum, item) =>
              itemSum +
              (item.unitCost != null ? Number(item.unitCost) * Number(item.quantity || 0) : 0),
            0,
          );
        }
      });
      return {
        ...bucket,
        total: bucketTotal,
        cogs: bucketCogs,
        profit: bucketTotal - bucketCogs,
      };
    });
  }, [orders, salesRange, serverTrendState]);
  const usingCachedTrendFallback = salesRange !== "today" && serverTrendState.range === salesRange && serverTrendState.error;
  const periodSales = salesBuckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const periodProfit = salesBuckets.reduce((sum, bucket) => sum + (bucket.profit || 0), 0);
  const chartMaximum = Math.max(1, ...salesBuckets.map((bucket) => bucket.total));
  const chartRangeLabel = salesRange === "today" ? "today's session" : salesRange === "year" ? "this year" : salesRange === "month" ? "last 30 days" : "last 7 days";

  const contentRef = useRef(null);
  const headerRef = useRef(null);
  const [docked, setDocked] = useState(false);

  useEffect(() => {
    if (isMobile) return undefined;
    const content = contentRef.current;
    const header = headerRef.current;
    if (!content) return undefined;
    let rafId = 0;
    let cachedLimit = 36;

    const syncHeight = () => {
      if (!header) return;
      const h = header.offsetHeight;
      cachedLimit = Math.max(24, Math.min(54, h - 72));
      content.style.setProperty("--dash-header-h", `${h}px`);
    };

    const updateDock = () => {
      rafId = 0;
      const y = content.scrollTop;
      setDocked((prev) => (prev ? y > 10 : y > cachedLimit));
    };

    const onScroll = () => {
      if (!rafId) rafId = window.requestAnimationFrame(updateDock);
    };

    syncHeight();
    updateDock();
    content.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncHeight) : null;
    if (observer && header) observer.observe(header);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      content.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [isMobile]);

  const orderModalNode = selectedOrder ? (
    <OrderDetailsModal
      key={selectedOrder.id}
      order={selectedOrder}
      portal="admin"
      productImageByName={productImageByName}
      canVoid
      canViewCostBreakdown
      onConfirmOrder={async (ord) => {
        const updated = await confirmOrder(ord?.id ?? ord);
        loadServerSummary();
        if (updated) setSelectedOrder(updated);
        return updated;
      }}
      onVoidOrder={async (ord, payload) => {
        const updated = await voidOrder(ord?.id ?? ord, payload);
        loadServerSummary();
        if (updated) setSelectedOrder(updated);
        return updated;
      }}
      onRevertOrderItem={async (orderNumber, itemId, payload) => {
        const updated = await revertOrderItem(orderNumber, itemId, payload);
        loadServerSummary();
        if (updated) setSelectedOrder(updated);
        return updated;
      }}
      triggerRef={modalTriggerRef}
      onClosed={() => setSelectedOrder(null)}
    />
  ) : null;

  const handleWasteScopeSwitch = (nextScope) => {
    setWasteScope(nextScope);
    fetchWasteLogs?.({ scope: nextScope, limit: 25 }).catch((err) => {
      console.warn("Could not switch waste log scope:", err?.message || err);
    });
  };

  const closeReverseDialog = useCallback(() => {
    if (reversingWasteRef.current) return;
    setReverseTarget(null);
    const trigger = reverseTriggerRef.current;
    if (trigger && typeof trigger.focus === "function" && trigger.isConnected) {
      window.requestAnimationFrame(() => trigger.focus());
    }
  }, []);

  useEffect(() => {
    if (!reverseTarget) return undefined;
    window.requestAnimationFrame(() => {
      reverseTextareaRef.current?.focus();
    });
    const focusableSelector =
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeReverseDialog();
        return;
      }
      if (event.key === "Tab" && reverseDialogRef.current) {
        const focusable = Array.from(reverseDialogRef.current.querySelectorAll(focusableSelector));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeReverseDialog, reverseTarget]);

  const openReverseDialog = (entry, event) => {
    reverseTriggerRef.current = event?.currentTarget || null;
    setReverseTarget(entry);
    setReverseReason("");
    setReverseError("");
  };

  const handleConfirmReverse = async (event) => {
    event.preventDefault();
    if (reversingWasteRef.current || !reverseTarget) return;
    const clean = reverseReason.trim();
    if (clean.length < 3) {
      setReverseError("Enter a brief audit reason (at least 3 characters).");
      return;
    }
    reversingWasteRef.current = true;
    setReversingWaste(true);
    setReverseError("");
    try {
      const res = await reverseWasteLog(reverseTarget.id, clean);
      setWasteStatusNote(
        `Reversed waste #${reverseTarget.id} on ${reverseTarget.itemName} (+${formatWasteQty(res?.restoredQuantity, res?.unit)} restored).`,
      );
      setReverseTarget(null);
      setReverseReason("");
      loadServerSummary();
    } catch (err) {
      setReverseError(err?.message || "Could not reverse waste entry.");
    } finally {
      reversingWasteRef.current = false;
      setReversingWaste(false);
    }
  };

  const topWastedItem = Array.isArray(wasteSummary.topWastedItems) && wasteSummary.topWastedItems.length
    ? wasteSummary.topWastedItems[0]
    : null;

  const staffModalNode = selectedStaffMember ? (
    <StaffActivityModal
      staffMember={selectedStaffMember}
      rangeParams={{ rangeKey: "all", label: "All Sessions" }}
      productImageByName={productImageByName}
      triggerRef={staffModalTriggerRef}
      onClosed={() => setSelectedStaffMember(null)}
    />
  ) : null;

  const wasteModalNode = (
    <LogWasteModal
      isOpen={showWasteModal}
      onClose={() => setShowWasteModal(false)}
      onSuccess={(saved) => {
        if (saved) {
          setWasteStatusNote(
            `Logged -${formatWasteQty(saved.deductedQuantity, saved.unit)} on ${saved.itemName}.`,
          );
        }
        loadServerSummary();
      }}
    />
  );

  const reverseModalNode = reverseTarget ? (
    <div
      className="admin-waste-reverse-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeReverseDialog();
      }}
    >
      <div
        ref={reverseDialogRef}
        className="admin-waste-reverse-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reverse-waste-title"
      >
        <div className="admin-waste-reverse-head">
          <div>
            <h3 id="reverse-waste-title">Reverse Waste Entry #{reverseTarget.id}</h3>
            <p>
              Restores <strong>+{formatWasteQty(reverseTarget.deductedQuantity, reverseTarget.unit)}</strong> of{" "}
              <strong>{reverseTarget.itemName}</strong> and posts a reversing ledger journal entry.
            </p>
          </div>
          <button
            type="button"
            className="admin-waste-reverse-close"
            onClick={closeReverseDialog}
            aria-label="Close reversal dialog"
            disabled={reversingWaste}
          >
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleConfirmReverse} className="admin-waste-reverse-form">
          <label htmlFor="admin-waste-reverse-reason">
            Audit Reversal Reason (required)
          </label>
          <textarea
            ref={reverseTextareaRef}
            id="admin-waste-reverse-reason"
            rows={3}
            maxLength={255}
            value={reverseReason}
            onChange={(e) => {
              setReverseReason(e.target.value);
              setReverseError("");
            }}
            placeholder="e.g., Duplicate accidental waste entry or verified shelf count correction"
            required
          />
          {reverseError && (
            <p className="admin-waste-reverse-error" role="alert">
              {reverseError}
            </p>
          )}
          <div className="admin-waste-reverse-actions">
            <button
              type="button"
              className="admin-waste-btn-secondary"
              onClick={closeReverseDialog}
              disabled={reversingWaste}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="admin-waste-btn-danger"
              disabled={reversingWaste}
            >
              <RotateCcw size={15} aria-hidden="true" />
              {reversingWaste ? "Restoring stock..." : "Confirm Reversal"}
            </button>
          </div>
        </form>
      </div>
    </div>
  ) : null;

  if (isMobile) {
    const ranges = [["today", "Today"], ["week", "7 days"], ["month", "30 days"], ["year", "Year"]];
    const metrics = [
      { label: "Units sold", value: `${effectiveTodaysUnits}`, Icon: ShoppingBag, tone: "amber" },
      { label: "Cash today", value: `₱${effectiveTodaysCashCollected.toFixed(0)}`, Icon: Coins, tone: "green" },
      { label: "Inventory", value: `₱${inventoryAssetValue.toFixed(0)}`, Icon: Warehouse, tone: "blue" },
      { label: "Margin", value: `${effectiveTodaysMarginPercent.toFixed(0)}%`, Icon: TrendingUp, tone: "plum" },
    ];
    const topList = rankedProducts.filter((x) => x.unitsSold > 0).slice(0, 8);
    const recent = displayOrders.slice(0, 15);
    return (
      <div className={`admin-dashboard is-mobile ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
        {mobileNavOpen && <div className="ad-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />}
        <Sidebar role="admin" activeTab="dashboard" orderCount={orders.length} sidebarCollapsed={false} onToggle={() => setMobileNavOpen(false)} />

        <main className="ad-main">
          <header className="ad-appbar">
            <button type="button" className="ad-icon-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu"><Menu size={24} /></button>
            <div className="ad-appbar-title"><span>{liveDate}</span><h1>Admin Dashboard</h1></div>
          </header>

          <section className="ad-hero" aria-label="Today's sales">
            <span className="ad-hero-label">Today&apos;s sales (paid)</span>
            <strong className="ad-hero-amount">₱{effectiveTodaysSales.toFixed(2)}</strong>
            <span className="ad-hero-pill"><TrendingUp size={14} aria-hidden="true" />₱{effectiveTodaysProfit.toFixed(2)} profit</span>
            <span className="ad-hero-sub">{effectiveTodaysPaidCount} order{effectiveTodaysPaidCount === 1 ? "" : "s"} settled · All-time ₱{effectiveAllTimeSales.toFixed(2)}</span>
          </section>

          <section className="ad-metrics" aria-label="Key metrics">
            {metrics.map(({ label, value, Icon, tone }) => (
              <div key={label} className={`ad-metric ${tone}`}>
                <span className="ad-metric-icon"><Icon size={19} aria-hidden="true" /></span>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </section>

          <CostRatioTiles />

          <section className="ad-card">
            <div className="ad-card-head"><h2>Sales trend</h2><strong>₱{periodSales.toFixed(0)}</strong></div>
            <div className="ad-chips" role="tablist" aria-label="Sales range">
              {ranges.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={salesRange === key} className={salesRange === key ? "on" : ""} onClick={() => setSalesRange(key)}>{label}</button>
              ))}
            </div>
            <div className="ad-chart" role="img" aria-label={`Sales for ${chartRangeLabel}`}>
              {salesBuckets.map((b) => (
                <div key={b.label} className="ad-bar">
                  <i style={{ height: `${Math.max(b.total > 0 ? 6 : 2, (b.total / chartMaximum) * 100)}%` }} className={b.total > 0 ? "has" : ""} />
                  <span>{b.label}</span>
                </div>
              ))}
            </div>
            <small className="ad-note">Profit for {chartRangeLabel}: ₱{periodProfit.toFixed(2)}</small>
          </section>

          <section className="ad-card">
            <div className="ad-card-head">
              <h2>Top products</h2>
              <div className="ad-seg">
                <button type="button" className={topProductsTab === "all" ? "on" : ""} onClick={() => setTopProductsTab("all")}>All</button>
                <button type="button" className={topProductsTab === "today" ? "on" : ""} onClick={() => setTopProductsTab("today")}>Today</button>
              </div>
            </div>
            {topList.length ? (
              <ol className="ad-top">
                {topList.map((x) => (
                  <li key={x.key}>
                    <b className="ad-rank">{x.rank}</b>
                    <span className="ad-top-body">
                      <span className="ad-top-line"><strong>{x.name}</strong><em>{x.unitsSold} sold</em></span>
                      <span className="ad-top-track"><i style={{ width: `${x.barPercent}%` }} /></span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : <p className="ad-empty">No paid sales yet.</p>}
          </section>

          <section className="ad-card">
            <div className="ad-card-head">
              <h2>Orders</h2>
              <div className="ad-seg">
                <button type="button" className={ordersTab === "today" ? "on" : ""} onClick={() => setOrdersTab("today")}>Today</button>
                <button type="button" className={ordersTab === "all" ? "on" : ""} onClick={() => setOrdersTab("all")}>All</button>
              </div>
            </div>
            {recent.length ? (
              <ul className="ad-orders">
                {recent.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className="ad-order-btn"
                      onClick={(e) => openOrderModal(o, e)}
                      aria-label={`View details for order ${o.id}`}
                    >
                      <span className={`ad-dot ${String(o.status).toLowerCase()}`} aria-hidden="true" />
                      <span className="ad-order-text"><strong>#{o.id}</strong><small>{(o.items || []).reduce((n, i) => n + Number(i.quantity || 0), 0)} items · {o.type || "Counter"}</small></span>
                      <span className="ad-order-end"><b>₱{Number(o.total || 0).toFixed(2)}</b><em className={String(o.status).toLowerCase()}>{o.status}</em></span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="ad-empty">No orders to show.</p>}
          </section>

          <section className="ad-card" aria-label="Inventory stock watch">
            <div className="ad-card-head">
              <h2>Stock watchlist</h2>
              <Link to="/admin/inventory" className="ad-card-link">Inventory <ArrowUpRight size={14} aria-hidden="true" /></Link>
            </div>
            {lowStockReport.length ? (
              <ul className="ad-orders ad-stock-list">
                {lowStockReport.slice(0, 12).map((item) => (
                  <li key={item.id ?? item.item}>
                    <span className={`ad-dot ${item.healthTone}`} aria-hidden="true" />
                    <span className="ad-order-text">
                      <strong>{item.item}</strong>
                      <small>{item.category} · {item.quantity.toLocaleString()} {item.unit}{item.maximumStock ? ` / ${item.maximumStock.toLocaleString()} max` : ""}</small>
                    </span>
                    <span className="ad-order-end">
                      <b>{item.reportedPercent != null ? `${item.reportedPercent}%` : "0%"}</b>
                      <em className={item.healthTone}>{item.label}</em>
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="ad-empty">All inventory items are well stocked.</p>}
          </section>

          <IngredientCostFlowCard />

          <section className="ad-card ad-waste-card" aria-label="Waste and spoilage tracker">
            <div className="ad-card-head">
              <h2>Waste &amp; spoilage</h2>
              <button
                type="button"
                className="ad-waste-log-btn"
                onClick={() => setShowWasteModal(true)}
              >
                <Trash2 size={14} aria-hidden="true" />
                Log waste
              </button>
            </div>
            <div className="ad-waste-summary-strip">
              <div>
                <small>Loss today</small>
                <strong>₱{Number(wasteSummary.totalWasteLossToday || 0).toFixed(2)}</strong>
              </div>
              <div>
                <small>Events today</small>
                <strong>{wasteSummary.totalWasteEventsToday || 0}</strong>
              </div>
            </div>
            {wasteStatusNote && <p className="ad-waste-toast" role="status">{wasteStatusNote}</p>}
            {wasteLogsError && <p className="admin-waste-error-banner" role="alert">{wasteLogsError}</p>}
            {wasteLogs.length ? (
              <ul className="ad-orders ad-waste-list">
                {wasteLogs.slice(0, 10).map((entry) => {
                  const reasonMeta = getWasteReasonMeta(entry.wasteReason);
                  return (
                    <li key={entry.id} className={entry.isReversed ? "is-reversed" : ""}>
                      <span className="ad-dot critical" aria-hidden="true" />
                      <span className="ad-order-text">
                        <strong>{entry.itemName}</strong>
                        <small>
                          -{formatWasteQty(entry.deductedQuantity, entry.unit)} · {reasonMeta.shortLabel} · {entry.actor}
                        </small>
                      </span>
                      <span className="ad-order-end">
                        <b>₱{Number(entry.wasteValue || 0).toFixed(2)}</b>
                        {entry.isReversed ? (
                          <em className="neutral">Reversed</em>
                        ) : (
                          <button
                            type="button"
                            className="ad-waste-rev-btn"
                            onClick={(e) => openReverseDialog(entry, e)}
                          >
                            Reverse
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="ad-empty">
                {wasteLogsLoading
                  ? "Loading waste logs..."
                  : wasteLogsError
                    ? "Unable to load waste records right now."
                    : "No waste events recorded for this scope."}
              </p>
            )}
          </section>
        </main>

        <Link to="/admin/menu" className="ad-fab"><Plus size={22} strokeWidth={2.6} aria-hidden="true" />Add item</Link>
        {orderModalNode}
        {staffModalNode}
        {wasteModalNode}
        {reverseModalNode}
      </div>
    );
  }

  return (
    <div className={`admin-dashboard ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        role="admin"
        className="admin-dashboard-navigation"
        activeTab="dashboard" orderCount={orders.length}
        sidebarCollapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      <main className="admin-main">
        <div className={`admin-content${docked ? " is-docked" : ""}`} ref={contentRef}>
          <div className="admin-sticky-header" ref={headerRef}>
            <PortalHero
            label="Administrator"
            greeting="Welcome back"
            highlight="Admin!"
            subtitle="Here’s what’s happening with Amaya today."
            date={liveDate}
            statusTitle="System active"
            />
            <div className="admin-header-dock" aria-hidden={!docked}>
              <div className="dock-chip stat-card-sales"><CircleDollarSign size={15} strokeWidth={1.9} /><span>Sales</span><strong>₱{effectiveTodaysSales.toFixed(2)}</strong></div>
              <div className="dock-chip stat-card-orders"><ShoppingBag size={15} strokeWidth={1.9} /><span>Sold</span><strong>{effectiveTodaysUnits} units</strong></div>
              <div className="dock-chip stat-card-products"><Coins size={15} strokeWidth={1.9} /><span>Cash</span><strong>₱{effectiveTodaysCashCollected.toFixed(2)}</strong></div>
            </div>
          </div>

          <StoreAssetsHeroCard />

          <section className="admin-stats">
            <div className="admin-stat-card stat-card-sales">
              <div className="stat-icon"><CircleDollarSign size={21} strokeWidth={1.8} /></div>

              <div className="stat-info">
                <span>Today's Sales (Paid)</span>
                <div className="stat-metric-row">
                  <h3>₱{effectiveTodaysSales.toFixed(2)}</h3>
                  <div
                    className="stat-profit-pill"
                    title={`Today's COGS: ₱${effectiveTodaysCogs.toFixed(2)} • Margin: ${effectiveTodaysMarginPercent.toFixed(1)}%`}
                  >
                    <TrendingUp size={11} strokeWidth={2.4} />
                    <span className="profit-text">₱{effectiveTodaysProfit.toFixed(2)} profit</span>
                  </div>
                </div>
                <small>
                  {effectiveTodaysPaidCount
                    ? `${effectiveTodaysPaidCount} order${effectiveTodaysPaidCount === 1 ? "" : "s"} settled today`
                    : "0 orders settled today"}
                  {" • "}
                  <span title="All-time sales across all sessions">All-time: ₱{effectiveAllTimeSales.toFixed(2)}</span>
                </small>
              </div>
            </div>

            <div className="admin-stat-card stat-card-orders">
              <div className="stat-icon"><ShoppingBag size={21} strokeWidth={1.8} /></div>

              <div className="stat-info">
                <span>Today's Products Sold</span>
                <h3>{effectiveTodaysUnits} units</h3>
                <small>
                  {effectiveTodaysUnits > 0
                    ? `Sold across ${effectiveTodaysPaidCount} order${effectiveTodaysPaidCount === 1 ? "" : "s"} today`
                    : "0 units sold yet today"}
                  {" • "}
                  <span title="All-time units sold across all sessions">All-time: {effectiveAllTimeUnits} units</span>
                </small>
              </div>
            </div>
          </section>

          <CostRatioTiles />

          <section className="od-cashier" aria-labelledby="od-cashier-title">
            <header className="od-head">
              <div className="od-head-text">
                <h2 id="od-cashier-title">Cashier sales &amp; owner confirmation</h2>
                <p>
                  Check what each cashier sold, then confirm it. Counter cash is added to Store Total Asset Value only after you confirm.
                </p>
              </div>
              <Link to="/admin/reports" className="od-link">
                Full staff report <ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </header>

            {cashierConfirmNotice && (
              <div className="od-banner od-banner--ok" role="status">
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>{cashierConfirmNotice}</span>
              </div>
            )}

            {staffPerformance.length === 0 ? (
              <div className="od-empty">
                <strong>No cashier accounts yet</strong>
                <p>Sales handled by each cashier will show up here for you to confirm.</p>
              </div>
            ) : (
              <div className="od-notes">
                {staffPerformance.map((member) => {
                  const unconfirmedCount = Number(member.unconfirmedOrdersCount || 0);
                  const unconfirmedSales = Number(member.unconfirmedSales || 0);
                  const unconfirmedCash = Number(member.unconfirmedCashSales || 0);
                  const isBusy = confirmingStaffId === member.userId;
                  const tone = unconfirmedCount > 0 ? "pending" : member.ordersCount > 0 ? "done" : "idle";

                  return (
                    <article key={member.userId} className={`od-note od-note--${tone}`}>
                      <div className="od-note-top">
                        <span className="od-avatar" aria-hidden="true">
                          {String(member.displayName || "S").charAt(0).toUpperCase()}
                        </span>
                        <div className="od-note-who">
                          <strong>
                            {member.displayName}
                            {member.role === "admin" && <span className="od-tag">Admin</span>}
                          </strong>
                          <small>
                            {member.ordersCount} order{member.ordersCount === 1 ? "" : "s"} · {member.unitsSold} unit{member.unitsSold === 1 ? "" : "s"} sold
                          </small>
                        </div>
                      </div>

                      <span className={`od-badge od-badge--${tone}`}>
                        {tone === "pending" ? (
                          <><Clock size={13} aria-hidden="true" /> {unconfirmedCount} to confirm</>
                        ) : tone === "done" ? (
                          <><Check size={13} aria-hidden="true" /> Confirmed</>
                        ) : (
                          "No sales yet"
                        )}
                      </span>

                      <dl className="od-note-figures">
                        <div><dt>Total sales</dt><dd>₱{Number(member.grossSales || 0).toFixed(2)}</dd></div>
                        <div><dt>Cash waiting</dt><dd className={unconfirmedCash > 0 ? "is-amber" : ""}>₱{unconfirmedCash.toFixed(2)}</dd></div>
                        <div><dt>Confirmed</dt><dd className="is-green">₱{Number(member.confirmedSales || 0).toFixed(2)}</dd></div>
                      </dl>

                      <div className="od-note-actions">
                        <button type="button" className="od-btn od-btn--ghost" onClick={(e) => openStaffActivityModal(member, e)}>
                          View sales
                        </button>
                        {unconfirmedCount > 0 && (
                          <button
                            type="button"
                            className="od-btn od-btn--solid"
                            onClick={() => handleDirectConfirmCashierSales(member)}
                            disabled={isBusy}
                          >
                            {isBusy ? "Confirming…" : `Confirm ₱${unconfirmedSales.toFixed(2)}`}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="admin-middle-grid od-row od-row--middle">
            <section className="od-sheet od-sales" aria-labelledby="od-sales-title">
              <span className="od-tape" aria-hidden="true" />
              <header className="od-head">
                <div className="od-head-text">
                  <h2 id="od-sales-title">Sales overview</h2>
                  <p>
                    Paid sales for {chartRangeLabel}
                    {usingCachedTrendFallback ? " (using the latest 500 orders on this device)" : ""}
                  </p>
                </div>
                <div className="od-controls">
                  <span className="od-figure">
                    <ChartNoAxesColumnIncreasing size={14} aria-hidden="true" /> ₱{periodSales.toFixed(2)}
                  </span>
                  <span className="od-figure od-figure--profit" title="Gross profit for the selected range">
                    ₱{periodProfit.toFixed(2)} profit
                  </span>
                  <select
                    className="od-select"
                    value={salesRange}
                    onChange={(event) => setSalesRange(event.target.value)}
                    aria-label="Sales chart date range"
                  >
                    <option value="today">Today's session</option>
                    <option value="week">Last 7 days</option>
                    <option value="month">Last 30 days</option>
                    <option value="year">This year</option>
                  </select>
                </div>
              </header>

              <div className="od-chart">
                <div className="od-chart-bars" role="img" aria-label={`Sales total ₱${periodSales.toFixed(2)} for ${chartRangeLabel}`}>
                  {salesBuckets.map((bucket, idx) => (
                    <div className="od-col" key={`${salesRange}-${bucket.start.toISOString()}`} style={{ "--i": idx }}>
                      <div
                        className={`od-bar${bucket.total > 0 ? " has-sales" : ""}`}
                        title={`₱${bucket.total.toFixed(2)} sales (₱${(bucket.profit || 0).toFixed(2)} profit)`}
                        style={{ height: `${Math.max(bucket.total > 0 ? 6 : 2, (bucket.total / chartMaximum) * 100)}%` }}
                      />
                      <span>{bucket.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="od-sheet od-orders" aria-labelledby="od-orders-title">
              <header className="od-head">
                <div className="od-head-text">
                  <h2 id="od-orders-title">Orders &amp; transactions</h2>
                  <p>{ordersTab === "today" ? `Today's session, ${liveDate}` : "Most recent orders"}</p>
                </div>
                <Segmented
                  label="Order time range"
                  value={ordersTab}
                  onChange={setOrdersTab}
                  options={[
                    ["today", `Today (${todaysOrders.length})`],
                    ["all", `All recent (${orders.length})`],
                  ]}
                />
              </header>

              <div className="od-table-wrap">
                <table className="od-table">
                  <thead>
                    <tr>
                      <th scope="col">Order</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Cashier</th>
                      <th scope="col" className="is-num">Total</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOrders.length === 0 ? (
                      <tr>
                        <td colSpan="5">
                          <div className="od-empty">
                            <strong>{ordersTab === "today" ? "No orders yet today" : "No orders yet"}</strong>
                            <p>{ordersTab === "today" ? "Counter orders from today's session will appear here as they come in." : "New orders will appear here."}</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      visibleOrders.map((order) => (
                        <tr key={order.id} className="is-clickable" onClick={(e) => openOrderModal(order, e)}>
                          <td>
                            <button
                              type="button"
                              className="od-order-id"
                              onClick={(e) => {
                                e.stopPropagation();
                                openOrderModal(order, e);
                              }}
                              title={`Open order #${order.id}`}
                            >
                              #{order.id}
                            </button>
                          </td>
                          <td>{order.customer || "Walk-in customer"}</td>
                          <td>
                            <span className="od-cashier-tag">
                              <UserRound size={13} aria-hidden="true" /> {order.cashier || "Staff"}
                            </span>
                          </td>
                          <td className="is-num">₱{Number(order.total || 0).toFixed(2)}</td>
                          <td>
                            <span className={`od-status od-status--${getSalesLogStatus(order.status).tone}`}>
                              {getSalesLogStatus(order.status).label}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <footer className="od-foot" aria-live="polite">
                {displayOrders.length > visibleOrders.length
                  ? `Showing the latest ${visibleOrders.length} of ${displayOrders.length} orders`
                  : `${displayOrders.length} order${displayOrders.length === 1 ? "" : "s"} recorded`}
              </footer>
            </section>
          </section>

          <section className="admin-bottom-grid od-row od-row--bottom">
            <section className="od-sheet od-top" aria-labelledby="od-top-title">
              <header className="od-head">
                <div className="od-head-text">
                  <h2 id="od-top-title">Most bought menu products</h2>
                  <p>
                    {topProductsTab === "today"
                      ? `Today: ${todaysUnitsSold} unit${todaysUnitsSold === 1 ? "" : "s"} across ${rankedProducts.filter((p) => p.unitsSold > 0).length} items`
                      : `All time: ${allTimeRankedUnits} unit${allTimeRankedUnits === 1 ? "" : "s"} across ${rankedProducts.length} menu items`}
                  </p>
                </div>
                <Segmented
                  label="Product ranking period"
                  value={topProductsTab}
                  onChange={setTopProductsTab}
                  options={[
                    ["all", `All time (${allTimeRankedUnits})`],
                    ["today", `Today (${todaysUnitsSold})`],
                  ]}
                />
              </header>

              <ol className="od-top-list">
                {rankedProducts.length === 0 ? (
                  <li className="od-empty">
                    <strong>No menu products yet</strong>
                    <p>Add products in Menu Management to see how they rank.</p>
                  </li>
                ) : (
                  rankedProducts.map((product) => {
                    const hasSales = product.unitsSold > 0;
                    return (
                      <li
                        key={product.key}
                        className={`od-top-row${hasSales ? "" : " is-quiet"}${hasSales && product.rank <= 3 ? ` is-podium-${product.rank}` : ""}`}
                      >
                        <span className="od-rank">{product.rank}</span>
                        {product.image ? (
                          <img className="od-thumb" src={product.image} alt="" />
                        ) : (
                          <span className="od-thumb od-thumb--blank" aria-hidden="true">
                            {product.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="od-top-main">
                          <div className="od-top-title">
                            <strong>{product.name}</strong>
                            <span className="od-chip">{product.category}</span>
                            {!product.inCatalog && <span className="od-chip od-chip--warn">Archived</span>}
                            {product.topSize && <span className="od-chip">Top size: {product.topSize}</span>}
                          </div>
                          <div className="od-track" aria-hidden="true">
                            <span style={{ transform: `scaleX(${product.barPercent / 100})` }} />
                          </div>
                        </div>
                        <div className="od-top-nums">
                          <div>
                            <strong>{product.unitsSold} sold</strong>
                            <span>
                              {hasSales
                                ? `${product.sharePercent.toFixed(1)}% · ${product.ordersCount} order${product.ordersCount === 1 ? "" : "s"}`
                                : `Base ₱${product.basePrice.toFixed(2)}`}
                            </span>
                          </div>
                          <div>
                            <strong>₱{product.revenue.toFixed(2)}</strong>
                            <span className={product.profit > 0 ? "is-profit" : ""}>
                              {hasSales ? `₱${product.profit.toFixed(2)} profit` : "No sales yet"}
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })
                )}
              </ol>
            </section>

            <section className="od-sheet od-notebook" aria-labelledby="od-stock-title">
              <span className="od-spiral" aria-hidden="true" />
              <div className="od-notebook-page">
                <header className="od-head">
                  <div className="od-head-text">
                    <h2 id="od-stock-title">Stock watchlist</h2>
                    <p>
                      {lowStockBreakdown.total} item{lowStockBreakdown.total === 1 ? "" : "s"} at or below 70% of max stock · {liveDate}
                    </p>
                  </div>
                  <div className="od-controls">
                    <Segmented
                      label="Filter stock watchlist"
                      value={stockFilter}
                      onChange={setStockFilter}
                      options={[
                        ["all", `All (${lowStockBreakdown.total})`],
                        ["lowest", `Lowest (${lowStockBreakdown.critical + lowStockBreakdown.low})`],
                        ["moderate", `Moderate (${lowStockBreakdown.moderate})`],
                      ]}
                    />
                    <Link to="/admin/inventory" className="od-link" aria-label="Manage inventory">
                      Inventory <ArrowUpRight size={14} aria-hidden="true" />
                    </Link>
                  </div>
                </header>

                {inventoryLoading && inventory.length === 0 ? (
                  <div className="od-empty"><strong>Loading stock levels</strong><p>Fetching the latest inventory quantities.</p></div>
                ) : inventoryError && inventory.length === 0 ? (
                  <div className="od-empty" role="alert"><strong>Can't show stock levels</strong><p>{inventoryError}</p></div>
                ) : visibleLowStock.length ? (
                  <div className="od-stock">
                    <div className="od-stock-head" aria-hidden="true">
                      <span>Item</span>
                      <span>Stock level</span>
                      <span>Max stock</span>
                      <span>Status</span>
                    </div>
                    <ul className="od-stock-list">
                      {visibleLowStock.map((item) => (
                        <li key={item.id ?? item.item} className="od-stock-row">
                          <div className="od-stock-item">
                            <strong>{item.item}</strong>
                            <small>{item.category || "Uncategorized"}</small>
                          </div>
                          <div className="od-stock-level">
                            <div className="od-stock-qty">
                              <span>{item.quantity.toLocaleString()} {item.unit}</span>
                              {item.reportedPercent != null && (
                                <b className={`is-${item.healthTone}`}>{item.reportedPercent}%</b>
                              )}
                            </div>
                            <div
                              className="od-meter"
                              role="progressbar"
                              aria-label={`${item.item} stock level`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={item.reportedPercent ?? 0}
                            >
                              <span
                                className={`is-${item.healthTone}`}
                                style={{ width: `${Math.max(item.quantity > 0 ? 4 : 0, item.capacityPercent ?? 0)}%` }}
                              />
                            </div>
                          </div>
                          <div className="od-stock-max">
                            {item.maximumStock == null ? (
                              <span className="is-unset">Not set</span>
                            ) : (
                              <span>{item.maximumStock.toLocaleString()} {item.unit}</span>
                            )}
                          </div>
                          <div className="od-stock-status">
                            <span className={`od-pill od-pill--${item.healthTone}`}>{item.label}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="od-empty">
                    <strong>Everything is well stocked</strong>
                    <p>No items are in the moderate, running low, or critical range.</p>
                  </div>
                )}
              </div>
            </section>
          </section>

          <section className="od-waste" aria-labelledby="od-waste-title">
            <header className="od-head">
              <div className="od-head-text">
                <h2 id="od-waste-title">Waste &amp; spoilage tracker</h2>
                <p>Stock lost to spoilage or spills, with the reason and who recorded it.</p>
              </div>
              <div className="od-controls">
                <Segmented
                  label="Waste log time filter"
                  value={wasteScope}
                  onChange={handleWasteScopeSwitch}
                  options={[
                    ["today", "Today"],
                    ["shift", "Active shift"],
                    ["all", "All history"],
                  ]}
                />
                <button type="button" className="od-btn od-btn--solid" onClick={() => setShowWasteModal(true)}>
                  <Trash2 size={15} aria-hidden="true" />
                  Log waste
                </button>
              </div>
            </header>

            {wasteStatusNote && (
              <div className="od-banner od-banner--ok" role="status"><span>{wasteStatusNote}</span></div>
            )}
            {wasteLogsError && (
              <div className="od-banner od-banner--error" role="alert"><span>{wasteLogsError}</span></div>
            )}

            <div className="od-notes od-notes--kpi">
              <article className="od-note od-note--loss">
                <span className="od-kpi-label">Waste loss today</span>
                <strong>₱{Number(wasteSummary.totalWasteLossToday || 0).toFixed(2)}</strong>
                <small>Counted as a spoilage expense and taken off your inventory value</small>
              </article>
              <article className="od-note od-note--pending">
                <span className="od-kpi-label">Waste events today</span>
                <strong>{wasteSummary.totalWasteEventsToday || 0}</strong>
                <small>Entries logged today that haven't been reversed</small>
              </article>
              <article className="od-note od-note--done">
                <span className="od-kpi-label">Most wasted item today</span>
                <strong>{topWastedItem ? topWastedItem.itemName : "None today"}</strong>
                <small>
                  {topWastedItem
                    ? `${formatWasteQty(topWastedItem.totalDeductedQuantity, topWastedItem.unit)} · ₱${Number(topWastedItem.totalWasteValue || 0).toFixed(2)} loss`
                    : "No waste recorded today"}
                </small>
              </article>
            </div>

            {wasteLogs.length ? (
              <div className="od-table-wrap">
                <table className="od-table od-table--waste">
                  <thead>
                    <tr>
                      <th scope="col">Item</th>
                      <th scope="col">Deducted</th>
                      <th scope="col">Reason</th>
                      <th scope="col">Measured</th>
                      <th scope="col">Staff &amp; note</th>
                      <th scope="col" className="is-num">Loss</th>
                      <th scope="col">Audit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wasteLogs.slice(0, 15).map((entry) => {
                      const reasonMeta = getWasteReasonMeta(entry.wasteReason);
                      return (
                        <tr key={entry.id} className={entry.isReversed ? "is-reversed" : ""}>
                          <td>
                            <strong>{entry.itemName}</strong>
                            <small className="od-sub">
                              {formatWasteQty(entry.beforeQuantity, entry.unit)} → {formatWasteQty(entry.afterQuantity, entry.unit)}
                            </small>
                          </td>
                          <td><span className="od-chip od-chip--loss">-{formatWasteQty(entry.deductedQuantity, entry.unit)}</span></td>
                          <td><span className="od-chip">{reasonMeta.label}</span></td>
                          <td className="is-muted">
                            {entry.measurementMethod === "remaining_count"
                              ? `Left: ${formatWasteQty(entry.measuredInputQty, entry.measuredInputUnit)}${entry.tareWeight > 0 ? ` (tare ${formatWasteQty(entry.tareWeight, entry.measuredInputUnit || entry.unit)})` : ""}`
                              : `Direct: ${formatWasteQty(entry.measuredInputQty, entry.measuredInputUnit)}`}
                          </td>
                          <td>
                            <strong>{entry.actor}</strong>
                            <small className="od-sub">{entry.note}</small>
                          </td>
                          <td className="is-num">₱{Number(entry.wasteValue || 0).toFixed(2)}</td>
                          <td>
                            {entry.isReversed ? (
                              <span className="od-chip">Reversed</span>
                            ) : (
                              <button type="button" className="od-btn od-btn--ghost od-btn--sm" onClick={(e) => openReverseDialog(entry, e)}>
                                <RotateCcw size={13} aria-hidden="true" />
                                Reverse
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="od-empty">
                <strong>
                  {wasteLogsLoading
                    ? "Loading waste logs…"
                    : wasteLogsError
                      ? "Can't load waste logs"
                      : "No waste entries for this period"}
                </strong>
                <p>Use Log waste to record a weighed leftover or a measured spill.</p>
              </div>
            )}
          </section>

        </div>

      </main>
      {orderModalNode}
      {staffModalNode}
      {wasteModalNode}
      {reverseModalNode}
    </div>
  );
}

export default AdminDashboard;
