import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  Award,
  CheckCircle2,
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
import { useSidebar } from "../../context/useSidebar.jsx";
import { isOrderPaid, isToday, useOrders } from "../../context/OrdersContext.jsx";
import { getInventoryStatus, useInventory } from "../../context/InventoryContext.jsx";
import { parseMenuPrice, useMenu } from "../../context/MenuContext.jsx";
import { useBusiness } from "../../context/BusinessContext.jsx";
import { formatManilaDate, getManilaDateString } from "../../../shared/manilaDate.js";
import { apiRequest } from "../../utils/api.js";
import { getStockHealth } from "../../utils/stockHealth.js";
import { formatWasteQty, getWasteReasonMeta } from "../../utils/wasteMeasurement.js";
import "../../assets/css/admin/AdminDashboard.css";
import "../../assets/css/order-details-modal.css";
import "../../assets/css/portal-hero.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

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

          <section className="admin-panel admin-cashier-confirm-panel" aria-label="Cashier Sales and Owner Confirmation">
            <div className="admin-cashier-confirm-head">
              <div>
                <span className="admin-cashier-eyebrow">OWNER REMITTANCE &amp; COUNTER CASH GATE</span>
                <h3>Cashier Sales &amp; Owner Confirmation</h3>
                <p>
                  Inspect transactions and product sales handled by each assigned cashier. Unconfirmed counter cash is added to Store Total Asset Value once confirmed by the Owner.
                </p>
              </div>
              <Link to="/admin/reports" className="restock-open-button">
                Full Staff Report <ArrowUpRight size={13} aria-hidden="true" />
              </Link>
            </div>

            {cashierConfirmNotice && (
              <div className="admin-cashier-confirm-toast" role="status">
                <CheckCircle2 size={15} aria-hidden="true" />
                <span>{cashierConfirmNotice}</span>
              </div>
            )}

            {staffPerformance.length === 0 ? (
              <div className="admin-waste-empty">
                <strong>No active cashier accounts found</strong>
                <p>Assigned cashier orders and product sales will appear here for Owner verification.</p>
              </div>
            ) : (
              <div className="admin-cashier-confirm-grid">
                {staffPerformance.map((member) => {
                  const unconfirmedCount = Number(member.unconfirmedOrdersCount || 0);
                  const unconfirmedSales = Number(member.unconfirmedSales || 0);
                  const unconfirmedCash = Number(member.unconfirmedCashSales || 0);
                  const isBusy = confirmingStaffId === member.userId;

                  return (
                    <article
                      key={member.userId}
                      className={`admin-cashier-confirm-card ${unconfirmedCount > 0 ? "has-pending" : "is-confirmed"}`}
                    >
                      <div className="admin-cashier-card-top">
                        <div className="admin-cashier-identity">
                          <span className="admin-cashier-avatar" aria-hidden="true">
                            {String(member.displayName || "S").charAt(0).toUpperCase()}
                          </span>
                          <div>
                            <strong>
                              {member.displayName}
                              {member.role === "admin" && (
                                <span style={{ marginLeft: "6px", fontSize: "10.5px", fontWeight: 700, padding: "2px 6px", borderRadius: "999px", background: "#f3ebe2", color: "#5a3e2b" }}>
                                  Admin
                                </span>
                              )}
                            </strong>
                            <small>
                              {member.ordersCount} order{member.ordersCount === 1 ? "" : "s"} · {member.unitsSold} product unit{member.unitsSold === 1 ? "" : "s"} sold
                            </small>
                          </div>
                        </div>

                        {unconfirmedCount > 0 ? (
                          <span className="admin-cashier-badge is-pending">
                            ⏳ {unconfirmedCount} Unconfirmed
                          </span>
                        ) : member.ordersCount > 0 ? (
                          <span className="admin-cashier-badge is-confirmed">
                            ✓ Sales Confirmed
                          </span>
                        ) : (
                          <span className="admin-cashier-badge is-neutral">
                            No Sales Yet
                          </span>
                        )}
                      </div>

                      <div className="admin-cashier-metrics-row">
                        <div>
                          <span>Total Sales</span>
                          <strong>₱{Number(member.grossSales || 0).toFixed(2)}</strong>
                        </div>
                        <div>
                          <span>Pending Counter Cash</span>
                          <strong className={unconfirmedCash > 0 ? "is-amber" : ""}>
                            ₱{unconfirmedCash.toFixed(2)}
                          </strong>
                        </div>
                        <div>
                          <span>Confirmed Sales</span>
                          <strong className="is-green">
                            ₱{Number(member.confirmedSales || 0).toFixed(2)}
                          </strong>
                        </div>
                      </div>

                      <div className="admin-cashier-card-actions">
                        <button
                          type="button"
                          className="admin-cashier-inspect-btn"
                          onClick={(e) => openStaffActivityModal(member, e)}
                        >
                          Inspect Sales &amp; Products
                        </button>
                        {unconfirmedCount > 0 && (
                          <button
                            type="button"
                            className="admin-cashier-confirm-btn"
                            onClick={() => handleDirectConfirmCashierSales(member)}
                            disabled={isBusy}
                          >
                            {isBusy
                              ? "Confirming..."
                              : `✓ Confirm Sales (₱${unconfirmedSales.toFixed(2)})`}
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>


          
          <section className="admin-middle-grid">

            
            <div className="admin-panel sales-panel sales-paper-sheet">
              {/* Top Pushpin / Thumbtack holding the paper sheet */}
              <div className="sales-paper-pin" aria-hidden="true">
                <span className="sales-pin-shadow" />
                <span className="sales-pin-needle" />
                <span className="sales-pin-collar" />
                <span className="sales-pin-head">
                  <i className="sales-pin-glint" />
                </span>
              </div>

              {/* Little Bookmark Flag Tag on the Top-Right Paper Edge */}
              <div className="sales-paper-bookmark" aria-hidden="true">
                <span className="sales-bookmark-hole" />
                <span className="sales-bookmark-label">{salesRange.toUpperCase()}</span>
              </div>

              {/* Paper Sheet Interior */}
              <div className="sales-paper-inner">
                <div className="panel-header sales-panel-header sales-paper-header">
                  <div className="sales-paper-title-block">
                    <div className="sales-paper-meta-row">
                      <span className="sales-paper-eyebrow">PINNED REVENUE MEMO</span>
                      <span className="sales-paper-stamp">VERIFIED</span>
                    </div>
                    <h3>Sales Overview</h3>
                    <p>
                      Sales performance for {chartRangeLabel}
                      {usingCachedTrendFallback ? " (showing cached latest 500 orders)" : ""}
                    </p>
                  </div>

                  <div className="sales-header-controls">
                    <span className="sales-total"><ChartNoAxesColumnIncreasing size={14} /> ₱{periodSales.toFixed(2)}</span>
                    <span className="sales-profit-badge" title="Gross Profit for selected range">
                      ₱{periodProfit.toFixed(2)} profit
                    </span>
                    <select
                      className="sales-filter"
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
                </div>

                <div className="sales-chart sales-paper-chart">
                  <div className="chart-bars" role="img" aria-label={`Sales total ₱${periodSales.toFixed(2)} for ${chartRangeLabel}`}>
                    {salesBuckets.map((bucket, idx) => (
                      <div
                        className="chart-column"
                        key={`${salesRange}-${bucket.start.toISOString()}`}
                        style={{ "--bar-index": idx }}
                      >
                        <div
                          className="chart-bar"
                          title={`₱${bucket.total.toFixed(2)} sales (₱${(bucket.profit || 0).toFixed(2)} profit)`}
                          style={{ height: `${Math.max(bucket.total > 0 ? 6 : 2, (bucket.total / chartMaximum) * 100)}%` }}
                        />
                        <span>{bucket.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>


            
            <div className="admin-panel orders-panel orders-ticket-rail-panel">
              {/* Aluminum Ticket Grabber Rail along Top Edge */}
              <div className="orders-rail-bar" aria-hidden="true">
                <span className="orders-rail-screw left" />
                <div className="orders-rail-groove">
                  <span className="orders-rail-label">AMAYA POS • ORDER SLIP RAIL</span>
                  <div className="orders-rail-marbles">
                    <i /><i /><i /><i /><i /><i /><i />
                  </div>
                </div>
                <span className="orders-rail-screw right" />
              </div>

              {/* Thermal Receipt Slip Suspended Under the Rail */}
              <div className="orders-receipt-slip">
                <div className="panel-header orders-receipt-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" }}>
                  <div className="orders-receipt-title-block">
                    <div className="orders-receipt-meta">
                      <span className="orders-live-led" aria-hidden="true" />
                      <span className="orders-receipt-eyebrow">
                        {ordersTab === "today" ? "LIVE REGISTER FEED" : "TRANSACTION ARCHIVE"}
                      </span>
                      <span className="orders-receipt-serial">#REG-01</span>
                    </div>
                    <h3>{ordersTab === "today" ? "Today's Orders & Transactions" : "All Recent Orders"}</h3>
                    <p>{ordersTab === "today" ? `Active daily session (${liveDate})` : "All customer orders across sessions"}</p>
                  </div>

                  <div className="orders-receipt-tabs" style={{ display: "inline-flex", background: "#F5EFE9", padding: "3px", borderRadius: "8px", gap: "3px" }}>
                    <button
                      type="button"
                      onClick={() => setOrdersTab("today")}
                      style={{
                        padding: "5px 12px",
                        borderRadius: "6px",
                        border: "none",
                        background: ordersTab === "today" ? "#8B5E3C" : "transparent",
                        color: ordersTab === "today" ? "#FFFFFF" : "#6B5548",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: "pointer",
                        transition: "background-color 150ms ease, color 150ms ease",
                      }}
                    >
                      Today's Session ({todaysOrders.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrdersTab("all")}
                      style={{
                        padding: "5px 12px",
                        borderRadius: "6px",
                        border: "none",
                        background: ordersTab === "all" ? "#8B5E3C" : "transparent",
                        color: ordersTab === "all" ? "#FFFFFF" : "#6B5548",
                        fontSize: "11px",
                        fontWeight: "700",
                        cursor: "pointer",
                        transition: "background-color 150ms ease, color 150ms ease",
                      }}
                    >
                      All Recent ({orders.length})
                    </button>
                  </div>
                </div>

                <div className="orders-table-wrapper orders-receipt-body">
                  <table className="admin-orders-table orders-receipt-table">
                    <thead>
                      <tr>
                        <th>Ticket #</th>
                        <th>Customer</th>
                        <th>Cashier in Charge</th>
                        <th>Total</th>
                        <th>Status</th>
                      </tr>
                    </thead>

                    <tbody>
                      {displayOrders.length === 0 ? (
                        <tr>
                          <td colSpan="5" className="empty-orders-cell">
                            <div className="empty-orders-state">
                              <strong>{ordersTab === "today" ? "No orders placed today yet" : "No orders yet"}</strong>
                              <span>{ordersTab === "today" ? "Counter transactions from today's session will appear here in real time." : "New customer orders will appear here."}</span>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        displayOrders.slice(0, ordersTab === "today" ? 30 : 10).map((order, idx) => (
                          <tr
                            key={order.id}
                            className="orders-receipt-row is-clickable"
                            style={{ "--ticket-index": idx }}
                            onClick={(e) => openOrderModal(order, e)}
                          >
                            <td>
                              <button
                                type="button"
                                className="orders-ticket-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openOrderModal(order, e);
                                }}
                                title={`Inspect order #${order.id}`}
                              >
                                <strong className="orders-ticket-code">{order.id}</strong>
                              </button>
                            </td>
                            <td>{order.customer || "Walk-in Customer"}</td>
                            <td>
                              <span className="orders-cashier-tag" style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 8px", background: "rgba(139, 94, 60, 0.12)", border: "1px solid rgba(139, 94, 60, 0.25)", borderRadius: "6px", fontSize: "12px", fontWeight: "600", color: "#8B5E3C" }}>
                                <UserRound size={13} aria-hidden="true" /> {order.cashier || "Staff"}
                              </span>
                            </td>
                            <td className="orders-ticket-amount">₱{Number(order.total || 0).toFixed(2)}</td>
                            <td>
                              <span className={`order-status-pill status-${String(order.status || "pending").toLowerCase()}`}>
                                {order.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Thermal Receipt Barcode & Zigzag Serrated Tear Footer */}
                <div className="orders-receipt-footer" aria-hidden="true">
                  <div className="orders-receipt-barcode" />
                  <span className="orders-receipt-cut-note">
                    THERMAL LOG • {displayOrders.length} RECORDED TRANSACTION{displayOrders.length === 1 ? "" : "S"}
                  </span>
                </div>
              </div>
            </div>

          </section>



          <section className="admin-bottom-grid">
            <div className="admin-panel top-products-panel top-products-showcase">
              {/* Brass Hanging Chain & Cafe Medallion Crest */}
              <div className="showcase-hanging-hardware" aria-hidden="true">
                <span className="showcase-nail" />
                <span className="showcase-chain left" />
                <span className="showcase-chain right" />
                <span className="showcase-medallion">★ TOP SELLERS</span>
              </div>

              {/* Corner Brass Rivets */}
              <span className="showcase-rivet tl" aria-hidden="true" />
              <span className="showcase-rivet tr" aria-hidden="true" />
              <span className="showcase-rivet bl" aria-hidden="true" />
              <span className="showcase-rivet br" aria-hidden="true" />

              {/* Inner Velvet/Parchment Menu Display Board */}
              <div className="showcase-board-inner">
                <div className="panel-header top-products-header showcase-board-header">
                  <div className="showcase-title-block">
                    <div className="showcase-meta-row">
                      <span className="showcase-eyebrow">CURATED MENU HALL OF FAME</span>
                    </div>
                    <h3>Most Bought Menu Products</h3>
                    <p>
                      {topProductsTab === "today"
                        ? `Ranked by paid units sold today (${todaysUnitsSold} units across ${rankedProducts.filter((p) => p.unitsSold > 0).length} items)`
                        : `All-time paid product rankings (${allTimeRankedUnits} units across ${rankedProducts.length} menu items)`}
                    </p>
                  </div>
                  <div className="top-products-tabs showcase-tabs" role="tablist" aria-label="Product ranking period">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={topProductsTab === "all"}
                      className={topProductsTab === "all" ? "active" : ""}
                      onClick={() => setTopProductsTab("all")}
                    >
                      All-Time ({allTimeRankedUnits})
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={topProductsTab === "today"}
                      className={topProductsTab === "today" ? "active" : ""}
                      onClick={() => setTopProductsTab("today")}
                    >
                      Today ({todaysUnitsSold})
                    </button>
                  </div>
                </div>

                <div className="top-products-list showcase-plaque-list">
                  {rankedProducts.length === 0 ? (
                    <div className="empty-orders-state">
                      <strong>No menu products found</strong>
                      <span>Add products in Menu Management to track their sales ranking.</span>
                    </div>
                  ) : (
                    rankedProducts.map((product, idx) => (
                      <div
                        key={product.key}
                        style={{ "--plaque-index": idx }}
                        className={`top-product-row showcase-plaque-row${product.unitsSold > 0 ? " has-sales" : " no-sales"}${product.rank <= 3 && product.unitsSold > 0 ? ` is-top-${product.rank}` : ""}`}
                      >
                        <span className="top-product-rank showcase-rank-seal">
                          {product.rank <= 3 && product.unitsSold > 0 ? (
                            <Award size={13} aria-hidden="true" />
                          ) : null}
                          #{product.rank}
                        </span>

                        <div className="showcase-thumb-frame">
                          {product.image ? (
                            <img className="top-product-thumb" src={product.image} alt={product.name} />
                          ) : (
                            <div className="top-product-thumb top-product-thumb-fallback" aria-hidden="true">
                              {product.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>

                        <div className="top-product-main">
                          <div className="top-product-title-row">
                            <strong className="top-product-name">{product.name}</strong>
                            <span className="top-product-category">{product.category}</span>
                            {!product.inCatalog && (
                              <span className="top-product-archived-tag">Archived</span>
                            )}
                            {product.topSize && (
                              <span className="top-product-size-tag">Top: {product.topSize}</span>
                            )}
                          </div>

                          <div className="top-product-bar-track showcase-bar-track" aria-hidden="true">
                            <div
                              className="top-product-bar-fill showcase-bar-fill"
                              style={{ transform: `scaleX(${product.barPercent / 100})` }}
                            />
                          </div>
                        </div>

                        <div className="top-product-metrics showcase-plaque-metrics">
                          <div className="top-product-units">
                            <strong>{product.unitsSold} sold</strong>
                            <span>
                              {product.unitsSold > 0
                                ? `${product.sharePercent.toFixed(1)}% · ${product.ordersCount} order${product.ordersCount === 1 ? "" : "s"}`
                                : `Base ₱${product.basePrice.toFixed(2)}`}
                            </span>
                          </div>
                          <div className="top-product-revenue">
                            <strong>₱{product.revenue.toFixed(2)}</strong>
                            <span className={product.profit > 0 ? "is-profit" : ""}>
                              {product.unitsSold > 0 ? `₱${product.profit.toFixed(2)} profit` : "No sales yet"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
            <section className="admin-panel admin-report-panel inventory-panel low-stock-panel low-stock-notebook" aria-label="Moderate and lowest stock inventory report">
              {/* 3D Animated Leather Cover that slowly swings open on mount */}
              <div className="low-stock-notebook-cover" aria-hidden="true">
                <div className="low-stock-cover-inner">
                  <span className="low-stock-cover-crest">AMAYA CAFE</span>
                  <strong className="low-stock-cover-title">STOCK WATCHLIST</strong>
                  <span className="low-stock-cover-sub">Inventory Capacity Ledger</span>
                </div>
              </div>

              {/* Spiral Wire Binding Spine + Perforated Holes */}
              <div className="low-stock-notebook-spine" aria-hidden="true">
                {Array.from({ length: 10 }).map((_, idx) => (
                  <span key={idx} className="low-stock-ring-pair">
                    <i className="low-stock-ring-hole" />
                    <b className="low-stock-ring-wire" />
                  </span>
                ))}
              </div>

              {/* Bookmark Ribbon */}
              <div className="low-stock-notebook-ribbon" aria-hidden="true" />

              {/* Ruled Notebook Page Interior */}
              <div className="low-stock-notebook-page">
                <div className="panel-header top-products-header inventory-panel-heading low-stock-notebook-header">
                  <div className="low-stock-title-block">
                    <div className="low-stock-meta-row">
                      <span className="low-stock-eyebrow">INVENTORY LEDGER</span>
                      <span className="low-stock-date-chip">{liveDate}</span>
                    </div>
                    <h3>Stock Watchlist</h3>
                    <p>
                      {lowStockBreakdown.total} item{lowStockBreakdown.total === 1 ? "" : "s"} at or below 70% capacity
                    </p>
                  </div>
                  <div className="inventory-panel-actions">
                    <div className="top-products-tabs" role="tablist" aria-label="Filter stock watchlist">
                      {[
                        ["all", `All (${lowStockBreakdown.total})`],
                        ["lowest", `Lowest (${lowStockBreakdown.critical + lowStockBreakdown.low})`],
                        ["moderate", `Moderate (${lowStockBreakdown.moderate})`],
                      ].map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          role="tab"
                          aria-selected={stockFilter === key}
                          className={stockFilter === key ? "active" : ""}
                          onClick={() => setStockFilter(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <Link to="/admin/inventory" className="restock-open-button" aria-label="Manage inventory">
                      Inventory <ArrowUpRight size={13} aria-hidden="true" />
                    </Link>
                  </div>
                </div>

                {inventoryLoading && inventory.length === 0 ? (
                  <div className="admin-report-empty compact"><strong>Loading stock levels</strong><p>Fetching the latest inventory quantities.</p></div>
                ) : inventoryError && inventory.length === 0 ? (
                  <div className="admin-report-empty compact" role="alert"><strong>Inventory report unavailable</strong><p>{inventoryError}</p></div>
                ) : visibleLowStock.length ? (
                  <div className="low-stock-notebook-body stock-table-wrap">
                    <div className="low-stock-notebook-col-head" aria-hidden="true">
                      <span># / Inventory Item &amp; Category</span>
                      <span>Stock Level</span>
                      <span>Max Stock</span>
                      <span>Status</span>
                    </div>
                    <ol className="low-stock-notebook-list">
                      {visibleLowStock.map((item, idx) => (
                        <li
                          key={item.id ?? item.item}
                          className="low-stock-notebook-line"
                          style={{ "--line-index": idx }}
                        >
                          <div className="low-stock-line-main">
                            <span className="low-stock-line-num" aria-hidden="true">
                              {String(idx + 1).padStart(2, "0")}
                            </span>
                            <div className="low-stock-line-item">
                              <strong>{item.item}</strong>
                              <small>{item.category || "Uncategorized"}</small>
                            </div>
                          </div>

                          <div className="low-stock-line-level">
                            <div className="stock-level-value">
                              <span>{item.quantity.toLocaleString()} {item.unit}</span>
                              {item.reportedPercent != null && (
                                <span className={`stock-level-percent ${item.healthTone}`}>
                                  {item.reportedPercent}%
                                </span>
                              )}
                            </div>
                            <div
                              className="stock-level-track"
                              role="progressbar"
                              aria-label={`${item.item} stock level`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={item.reportedPercent ?? 0}
                            >
                              <span
                                className={`stock-level-fill ${item.healthTone}`}
                                style={{ width: `${Math.max(item.quantity > 0 ? 4 : 0, item.capacityPercent ?? 0)}%` }}
                              />
                            </div>
                          </div>

                          <div className="low-stock-line-max">
                            {item.maximumStock == null ? (
                              <span className="max-unset">Not set</span>
                            ) : (
                              <span>{item.maximumStock.toLocaleString()} {item.unit}</span>
                            )}
                          </div>

                          <div className="low-stock-line-status">
                            <span className={`inventory-status ${item.healthTone}`}>
                              <span aria-hidden="true" />
                              {item.label}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <div className="admin-report-empty compact low-stock-notebook-empty">
                    <strong>All pages clear — inventory is healthy</strong>
                    <p>No items are currently in the moderate, running low, or critical range.</p>
                  </div>
                )}
              </div>
            </section>

          </section>

          <section className="admin-panel admin-waste-tracker" aria-label="Zero-Guesswork Waste and Spoilage Tracker">
            <div className="admin-waste-header">
              <div>
                <h2>Waste &amp; Spoilage Tracker</h2>
                <p>Verified stock shrinkage, standardized reasons, and GL spoilage ledger reconciliation</p>
              </div>
              <div className="admin-waste-toolbar">
                <div className="admin-waste-scopes" role="group" aria-label="Waste log time filter">
                  {[
                    ["today", "Today"],
                    ["shift", "Active Shift"],
                    ["all", "All History"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={wasteScope === key}
                      className={`admin-waste-scope-btn${wasteScope === key ? " is-active" : ""}`}
                      onClick={() => handleWasteScopeSwitch(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="admin-waste-cta-btn"
                  onClick={() => setShowWasteModal(true)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  Log Waste / Spoilage
                </button>
              </div>
            </div>

            {wasteStatusNote && (
              <div className="admin-waste-status-banner" role="status">
                <span>{wasteStatusNote}</span>
              </div>
            )}

            {wasteLogsError && (
              <div className="admin-waste-error-banner" role="alert">
                <span>{wasteLogsError}</span>
              </div>
            )}

            <div className="admin-waste-kpis">
              <article className="admin-waste-kpi-card is-danger">
                <span>Waste Loss Today</span>
                <strong>₱{Number(wasteSummary.totalWasteLossToday || 0).toFixed(2)}</strong>
                <small>Credited from 1050 Inventory Asset → DR 6030 Spoilage</small>
              </article>
              <article className="admin-waste-kpi-card">
                <span>Waste Events Today</span>
                <strong>{wasteSummary.totalWasteEventsToday || 0}</strong>
                <small>Unreversed verified waste entries logged today</small>
              </article>
              <article className="admin-waste-kpi-card">
                <span>Top Wasted Item Today</span>
                <strong>{topWastedItem ? topWastedItem.itemName : "None today"}</strong>
                <small>
                  {topWastedItem
                    ? `${formatWasteQty(topWastedItem.totalDeductedQuantity, topWastedItem.unit)} · ₱${Number(topWastedItem.totalWasteValue || 0).toFixed(2)} loss`
                    : "Zero waste deductions recorded today"}
                </small>
              </article>
            </div>

            {wasteLogs.length ? (
              <div className="admin-waste-table-wrap">
                <table className="admin-waste-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Deducted</th>
                      <th>Reason</th>
                      <th>Measured Input</th>
                      <th>Staff &amp; Note</th>
                      <th>Loss Value</th>
                      <th>Audit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wasteLogs.slice(0, 15).map((entry) => {
                      const reasonMeta = getWasteReasonMeta(entry.wasteReason);
                      return (
                        <tr key={entry.id} className={entry.isReversed ? "is-reversed" : ""}>
                          <td>
                            <strong>{entry.itemName}</strong>
                            <small className="admin-waste-cell-sub">
                              {formatWasteQty(entry.beforeQuantity, entry.unit)} → {formatWasteQty(entry.afterQuantity, entry.unit)}
                            </small>
                          </td>
                          <td>
                            <span className="admin-waste-qty-pill">
                              -{formatWasteQty(entry.deductedQuantity, entry.unit)}
                            </span>
                          </td>
                          <td>
                            <span className="admin-waste-reason-pill">{reasonMeta.label}</span>
                          </td>
                          <td className="admin-waste-cell-muted">
                            {entry.measurementMethod === "remaining_count"
                              ? `Left: ${formatWasteQty(entry.measuredInputQty, entry.measuredInputUnit)}${entry.tareWeight > 0 ? ` (tare ${formatWasteQty(entry.tareWeight, entry.measuredInputUnit || entry.unit)})` : ""}`
                              : `Direct: ${formatWasteQty(entry.measuredInputQty, entry.measuredInputUnit)}`}
                          </td>
                          <td>
                            <div className="admin-waste-note-col">
                              <strong>{entry.actor}</strong>
                              <span>{entry.note}</span>
                            </div>
                          </td>
                          <td className="admin-waste-value-cell">
                            ₱{Number(entry.wasteValue || 0).toFixed(2)}
                          </td>
                          <td>
                            {entry.isReversed ? (
                              <span className="admin-waste-reversed-tag">Reversed</span>
                            ) : (
                              <button
                                type="button"
                                className="admin-waste-rev-action"
                                onClick={(e) => openReverseDialog(entry, e)}
                              >
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
              <div className="admin-waste-empty">
                <strong>
                  {wasteLogsLoading
                    ? "Loading waste logs..."
                    : wasteLogsError
                      ? "Unable to load waste logs"
                      : "No waste entries in this scope"}
                </strong>
                <p>Use Log Waste / Spoilage to record weighed remaining counts or measured spills.</p>
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
