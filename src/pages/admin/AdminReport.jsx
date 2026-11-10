import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Sidebar from "../../components/Sidebar.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { isOrderPaid, useOrders } from "../../context/OrdersContext.jsx";
import { getInventoryStatus, useInventory } from "../../context/InventoryContext.jsx";
import { getStockHealth } from "../../utils/stockHealth.js";
import "../../assets/css/admin/AdminReport.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const rangeOptions = [
  { key: "1d", label: "Today (Session)", mode: "hourly" },
  { key: "7d", label: "7 days", mode: "daily", days: 7, bucketDays: 1, axisStep: 1 },
  { key: "30d", label: "30 days", mode: "daily", days: 30, bucketDays: 1, axisStep: 5 },
  { key: "all", label: "All Sessions", mode: "all" },
  { key: "custom", label: "Custom", mode: "custom" },
];

const stockFilters = ["all", "attention", "healthy"];

const orderStatuses = ["Pending", "Preparing", "Completed"];

const peso = (value) => `₱${Number(value || 0).toFixed(2)}`;

const compactPeso = (value) => `₱${Math.round(Number(value || 0)).toLocaleString("en-US")}`;

function startOfDay(date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function orderTotal(order) {
  return Number(order.total || 0);
}

function orderTimestamp(order) {
  const parsed = new Date(order.createdAt);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function orderItemList(order) {
  return Array.isArray(order.items) ? order.items : [];
}

function initials(name) {
  return String(name || "Staff")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "S";
}

function niceCeil(value) {
  if (!(value > 0)) return 0;

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;

  return step * magnitude;
}

function percentChange(current, previous) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function AdminReport() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { orders = [] } = useOrders() || {};
  const { inventory = [], loading: inventoryLoading, error: inventoryError } = useInventory() || {};

  const [rangeKey, setRangeKey] = useState("all");
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00`;
  });
  const [customEnd, setCustomEnd] = useState(() => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59`;
  });
  const [stockFilter, setStockFilter] = useState("all");
  const [stockSort, setStockSort] = useState("name");
  const [restockModalOpen, setRestockModalOpen] = useState(false);
  const [restockNotice, setRestockNotice] = useState("");
  const [exportNotice, setExportNotice] = useState(false);
  const noticeTimer = useRef(null);

  const range = rangeOptions.find((option) => option.key === rangeKey) || rangeOptions[0];

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    if (!restockModalOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setRestockModalOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [restockModalOpen]);

  const liveDate = useMemo(() => new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }), []);

  const generatedStamp = useMemo(() => new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }), []);

  const rangeBounds = useMemo(() => {
    if (rangeKey === "custom") {
      const start = new Date(customStart);
      const end = new Date(customEnd);
      const validStart = Number.isNaN(start.getTime()) ? startOfDay(new Date()) : start;
      const validEnd = Number.isNaN(end.getTime()) ? new Date() : end;
      const duration = Math.max(3600000, validEnd.getTime() - validStart.getTime());
      const previousStart = new Date(validStart.getTime() - duration);
      return { start: validStart, end: validEnd, previousStart, isCustom: true };
    }

    if (rangeKey === "1d") {
      const start = startOfDay(new Date());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const previousStart = new Date(start);
      previousStart.setDate(previousStart.getDate() - 1);
      return { start, end, previousStart, isHourly: true, days: 1 };
    }

    if (rangeKey === "all") {
      const end = startOfDay(new Date());
      end.setDate(end.getDate() + 1);
      let minTimestamp = end.getTime() - 365 * 24 * 3600000;
      if (orders.length > 0) {
        const orderTimes = orders.map((o) => orderTimestamp(o)).filter((t) => t > 0);
        if (orderTimes.length > 0) {
          minTimestamp = Math.min(...orderTimes);
        }
      }
      const start = startOfDay(new Date(minTimestamp));
      const duration = Math.max(24 * 3600000, end.getTime() - start.getTime());
      const previousStart = new Date(start.getTime() - duration);
      return { start, end, previousStart, isAll: true };
    }

    const end = startOfDay(new Date());
    end.setDate(end.getDate() + 1);
    const start = new Date(end);
    start.setDate(start.getDate() - (range.days || 7));
    const previousStart = new Date(start);
    previousStart.setDate(previousStart.getDate() - (range.days || 7));

    return { start, end, previousStart, isDaily: true };
  }, [rangeKey, range.days, customStart, customEnd, orders]);

  const periodOrders = useMemo(() => orders.filter((order) => {
    const timestamp = orderTimestamp(order);
    return timestamp >= rangeBounds.start.getTime() && timestamp < rangeBounds.end.getTime();
  }), [orders, rangeBounds]);

  const paidPeriodOrders = useMemo(
    () => periodOrders.filter((order) => isOrderPaid(order)),
    [periodOrders],
  );

  const previousOrders = useMemo(() => orders.filter((order) => {
    const timestamp = orderTimestamp(order);
    return timestamp >= rangeBounds.previousStart.getTime() && timestamp < rangeBounds.start.getTime();
  }), [orders, rangeBounds]);

  const paidPreviousOrders = useMemo(
    () => previousOrders.filter((order) => isOrderPaid(order)),
    [previousOrders],
  );

  const periodSales = useMemo(
    () => paidPeriodOrders.reduce((sum, order) => sum + orderTotal(order), 0),
    [paidPeriodOrders],
  );

  const previousSales = useMemo(
    () => paidPreviousOrders.reduce((sum, order) => sum + orderTotal(order), 0),
    [paidPreviousOrders],
  );

  const averageOrder = paidPeriodOrders.length ? periodSales / paidPeriodOrders.length : 0;
  const previousAverage = paidPreviousOrders.length ? previousSales / paidPreviousOrders.length : 0;

  const itemsSold = useMemo(() => paidPeriodOrders.reduce(
    (sum, order) => sum + orderItemList(order).reduce(
      (itemSum, item) => itemSum + Number(item.quantity || 0),
      0,
    ),
    0,
  ), [paidPeriodOrders]);

  const periodCogs = useMemo(
    () => paidPeriodOrders.reduce(
      (sum, order) => sum + orderItemList(order).reduce(
        (itemSum, item) => itemSum + (item.unitCost != null ? Number(item.unitCost) * Number(item.quantity || 0) : 0),
        0,
      ),
      0,
    ),
    [paidPeriodOrders],
  );
  const periodGrossProfit = periodSales - periodCogs;
  const periodMarginPercent = periodSales > 0 ? (periodGrossProfit / periodSales) * 100 : 0;

  const revenueSeries = useMemo(() => {
    const isHourly = rangeKey === "1d" || (rangeKey === "custom" && ((rangeBounds.end.getTime() - rangeBounds.start.getTime()) <= 48 * 3600000));

    if (isHourly) {
      const startMs = rangeBounds.start.getTime();
      const endMs = rangeBounds.end.getTime();
      const totalHours = Math.max(1, Math.ceil((endMs - startMs) / 3600000));
      const count = Math.min(48, totalHours);

      const buckets = Array.from({ length: count }, (_, index) => {
        const bStart = new Date(startMs + index * 3600000);
        const bEnd = new Date(startMs + (index + 1) * 3600000);
        return { start: bStart, end: bEnd, amount: 0, orders: 0, isHourly: true };
      });

      paidPeriodOrders.forEach((order) => {
        const timestamp = orderTimestamp(order);
        const bucket = buckets.find((entry) => timestamp >= entry.start.getTime() && timestamp < entry.end.getTime());
        if (bucket) {
          bucket.amount += orderTotal(order);
          bucket.orders += 1;
        }
      });

      return buckets;
    }

    const totalDays = Math.max(1, Math.ceil((rangeBounds.end.getTime() - rangeBounds.start.getTime()) / (24 * 3600000)));
    const bucketDays = rangeKey === "all" ? (totalDays > 60 ? 7 : totalDays > 14 ? 2 : 1) : (range.bucketDays || 1);
    const bucketCount = Math.max(1, Math.ceil(totalDays / bucketDays));

    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const start = new Date(rangeBounds.start);
      start.setDate(start.getDate() + index * bucketDays);

      const end = new Date(start);
      end.setDate(end.getDate() + bucketDays);

      return { start, end, amount: 0, orders: 0, isHourly: false };
    });

    paidPeriodOrders.forEach((order) => {
      const timestamp = orderTimestamp(order);
      const bucket = buckets.find((entry) => timestamp >= entry.start.getTime() && timestamp < entry.end.getTime());

      if (bucket) {
        bucket.amount += orderTotal(order);
        bucket.orders += 1;
      }
    });

    return buckets;
  }, [paidPeriodOrders, range.bucketDays, rangeBounds, rangeKey]);

  const trend = useMemo(() => {
    const width = 760;
    const height = 250;
    const padLeft = 62;
    const padRight = 14;
    const padTop = 18;
    const padBottom = 30;
    const innerWidth = width - padLeft - padRight;
    const innerHeight = height - padTop - padBottom;
    const slotWidth = revenueSeries.length ? innerWidth / revenueSeries.length : innerWidth;
    const barWidth = Math.min(44, Math.max(6, slotWidth * 0.65));
    const ceiling = niceCeil(Math.max(...revenueSeries.map((bucket) => bucket.amount), 0));

    const isHourly = revenueSeries[0]?.isHourly;

    const points = revenueSeries.map((bucket, index) => {
      const x = padLeft + (index + 0.5) * slotWidth;
      const y = padTop + innerHeight - (ceiling > 0 ? (bucket.amount / ceiling) * innerHeight : 0);

      let label;
      if (isHourly) {
        label = bucket.start.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
      } else if (range.days === 7 && range.bucketDays === 1) {
        label = bucket.start.toLocaleDateString("en-US", { weekday: "short" });
      } else {
        label = bucket.start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }

      return {
        ...bucket,
        x,
        y,
        barX: x - barWidth / 2,
        barWidth,
        barHeight: Math.max(0, padTop + innerHeight - y),
        label,
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

    let axisStep = range.axisStep || 1;
    if (isHourly) {
      axisStep = revenueSeries.length > 20 ? 3 : 2;
    } else if (points.length > 20) {
      axisStep = 5;
    }

    const lastIndex = points.length - 1;
    const labelledPoints = points.map((point, index) => ({
      ...point,
      showLabel: index % axisStep === 0 || index === lastIndex,
    }));

    const best = points.reduce((top, point) => (point.amount > (top?.amount || 0) ? point : top), points[0] || null);

    return {
      width,
      height,
      padLeft,
      padRight,
      padTop,
      padBottom,
      baseline,
      ceiling,
      points,
      labelledPoints,
      gridLines,
      best,
    };
  }, [revenueSeries, range]);

  const topProducts = useMemo(() => {
    const totals = new Map();

    paidPeriodOrders.forEach((order) => {
      orderItemList(order).forEach((item) => {
        const key = item.title || "Menu item";
        const current = totals.get(key) || { title: key, quantity: 0, revenue: 0, cogs: 0, profit: 0, category: item.category || "Menu item" };
        const quantity = Number(item.quantity || 0);
        const price = Number(item.price || 0);
        const itemRevenue = quantity * price;
        const itemCogs = item.unitCost != null ? quantity * Number(item.unitCost) : 0;

        current.quantity += quantity;
        current.revenue += itemRevenue;
        current.cogs += itemCogs;
        current.profit = current.revenue - current.cogs;
        totals.set(key, current);
      });
    });

    return [...totals.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  }, [paidPeriodOrders]);

  const cashierSales = useMemo(() => {
    const totals = new Map();
    paidPeriodOrders.forEach((order) => {
      const name = order.cashier || "Staff";
      const current = totals.get(name) || { name, orders: 0, revenue: 0 };
      current.orders += 1;
      current.revenue += orderTotal(order);
      totals.set(name, current);
    });
    return [...totals.values()].sort((a, b) => b.revenue - a.revenue);
  }, [paidPeriodOrders]);

  const cashierSummary = useMemo(() => {
    const orders = cashierSales.reduce((sum, cashier) => sum + cashier.orders, 0);
    const revenue = cashierSales.reduce((sum, cashier) => sum + cashier.revenue, 0);
    return { orders, revenue, averageTicket: orders ? revenue / orders : 0 };
  }, [cashierSales]);

  const channelMix = useMemo(() => {
    const totals = new Map();

    paidPeriodOrders.forEach((order) => {
      const key = order.type || "Counter";
      const current = totals.get(key) || { type: key, orders: 0, revenue: 0 };
      current.orders += 1;
      current.revenue += orderTotal(order);
      totals.set(key, current);
    });

    return [...totals.values()].sort((a, b) => b.revenue - a.revenue);
  }, [paidPeriodOrders]);

  const statusMix = useMemo(() => orderStatuses.map((status) => ({
    status,
    orders: periodOrders.filter((order) => order.status === status).length,
  })), [periodOrders]);

  const paidOrders = paidPeriodOrders;

  const unpaidExposure = useMemo(
    () => periodOrders.filter((order) => !isOrderPaid(order)).reduce((sum, order) => sum + orderTotal(order), 0),
    [periodOrders],
  );

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
      const healthLabel = status === "Over Maximum"
        ? "Above maximum"
        : status === "Out of Stock"
          ? "Out of stock"
          : healthTone === "untracked"
            ? "Maximum not set"
            : healthTone === "critical"
              ? "Critical"
              : healthTone === "low"
                ? "Running low"
                : healthTone === "moderate"
                  ? "Moderate"
                  : "Healthy";
      return {
        id: entry.id,
        item: entry.item,
        category: entry.category,
        quantity,
        unit: entry.unit,
        maximumStock,
        capacityPercent,
        reportedPercent,
        healthTone,
        tone: status === "In Stock" ? "available" : status === "Over Maximum" ? "over" : "critical",
        label: healthLabel,
      };
    });
  }, [inventory]);

  const stockBreakdown = useMemo(() => ({
    total: stockReport.length,
    over: stockReport.filter((item) => item.tone === "over").length,
    critical: stockReport.filter((item) => item.tone === "critical").length,
    healthy: stockReport.filter((item) => item.tone === "available").length,
  }), [stockReport]);

  const restockItems = useMemo(() => stockReport
    .filter((item) => item.tone === "critical" || item.healthTone === "critical" || item.healthTone === "low")
    .sort((a, b) => {
      const aPriority = a.quantity <= 0 ? 0 : a.healthTone === "critical" ? 1 : 2;
      const bPriority = b.quantity <= 0 ? 0 : b.healthTone === "critical" ? 1 : 2;
      return aPriority - bPriority || String(a.item || "").localeCompare(String(b.item || ""));
    }), [stockReport]);

  const visibleStock = useMemo(() => {
    const filtered = stockFilter === "attention"
      ? stockReport.filter((item) => item.tone !== "available")
      : stockFilter === "healthy"
        ? stockReport.filter((item) => item.tone === "available")
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
        return priority[a.healthTone] - priority[b.healthTone] || byName(a, b);
      },
    };
    return [...filtered].sort(sorters[stockSort] || byName);
  }, [stockFilter, stockReport, stockSort]);

  const revenueShare = useCallback(
    (amount) => (periodSales > 0 ? (amount / periodSales) * 100 : 0),
    [periodSales],
  );

  const channelShare = (amount) => (channelMix[0]?.revenue > 0 ? (amount / channelMix[0].revenue) * 100 : 0);

  const insights = useMemo(() => {
    const notes = [];

    if (trend.best?.amount > 0) {
      notes.push({
        tone: "positive",
        label: "Best day",
        value: `${trend.best.label} · ${peso(trend.best.amount)}`,
      });
    }

    if (channelMix[0]?.orders) {
      notes.push({
        tone: "neutral",
        label: "Top channel",
        value: `${channelMix[0].type} · ${Math.round(revenueShare(channelMix[0].revenue))}% of sales`,
      });
    }

    if (topProducts[0]) {
      notes.push({
        tone: "neutral",
        label: "Best seller",
        value: `${topProducts[0].title} · ${topProducts[0].quantity} sold`,
      });
    }

    if (stockBreakdown.critical || stockBreakdown.over) {
      notes.push({
        tone: "warning",
        label: "Stock alerts",
        value: `${stockBreakdown.critical + stockBreakdown.over} item${stockBreakdown.critical + stockBreakdown.over === 1 ? "" : "s"} need review`,
      });
    }

    return notes;
  }, [channelMix, revenueShare, stockBreakdown, topProducts, trend.best]);

  const salesDelta = percentChange(periodSales, previousSales);
  const orderDelta = percentChange(periodOrders.length, previousOrders.length);
  const averageDelta = percentChange(averageOrder, previousAverage);

  const deltaCopy = (delta) => {
    if (!Number.isFinite(delta) || delta === 0) return { text: "No change", tone: "flat" };
    return {
      text: `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}%`,
      tone: delta > 0 ? "up" : "down",
    };
  };

  const salesTrend = deltaCopy(salesDelta);
  const orderTrend = deltaCopy(orderDelta);
  const averageTrend = deltaCopy(averageDelta);

  const handleExport = () => {
    if (!periodOrders.length) return;

    const header = ["Order ID", "Date", "Customer", "Cashier in Charge", "Type", "Payment", "Status", "Items", "Total"];
    const rows = periodOrders.map((order) => [
      order.id,
      new Date(order.createdAt).toLocaleString(),
      order.customer,
      order.cashier || "Staff",
      order.type,
      order.payment,
      order.status,
      orderItemList(order).map((item) => `${item.quantity}x ${item.title}`).join(" | "),
      orderTotal(order).toFixed(2),
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");

    link.href = url;
    link.download = `amaya-sales-report-${range.key}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setExportNotice(true);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setExportNotice(false), 2600);
  };

  const handleCopyRestockList = async () => {
    if (!restockItems.length) return;

    const now = new Date();
    const dateStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
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

  return (
    <div className={`admin-report-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        role="admin"
        activeTab="reports" orderCount={pendingCount}
        sidebarCollapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      <main className="admin-report-main">
        <header className="admin-report-topbar">
          <div>
            <span className="admin-report-section-label">ADMIN PORTAL</span>
            <h1>Sales &amp; Inventory Reports</h1>
          </div>
          <div className="admin-report-topbar-actions">
            <div className="admin-report-date">
              <span>REPORT DATE</span>
              <strong>{liveDate}</strong>
              <small>Generated {generatedStamp}</small>
            </div>
          </div>
        </header>

        <div className="admin-report-content">
          <div className="admin-report-hero-grid">
            <section className="admin-report-panel trend-panel" aria-label="Revenue trend">
              <div className="panel-heading trend-heading">
                <div>
                  <h3>{rangeKey === "1d" ? "Today's Session (Hourly) performance" : rangeKey === "all" ? "All Sessions & Historical Sales performance" : rangeKey === "custom" ? "Custom range performance" : `Last ${range.label} performance`}</h3>
                  <span className="trend-hero-total">{peso(periodSales)}</span>
                </div>
                <div className="trend-heading-actions">
                  <div className="admin-report-range" role="tablist" aria-label="Reporting period" style={{ marginBottom: 0 }}>
                    {rangeOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        role="tab"
                        aria-selected={option.key === rangeKey}
                        className={option.key === rangeKey ? "active" : ""}
                        onClick={() => setRangeKey(option.key)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="admin-report-export"
                    onClick={handleExport}
                    disabled={!periodOrders.length}
                  >
                    ⎙ <span>{exportNotice ? "Exported" : "Export CSV"}</span>
                  </button>
                </div>
              </div>

              {rangeKey === "custom" && (
                <div className="admin-report-custom-row">
                  <div className="custom-input-group">
                    <label htmlFor="custom-report-start">From</label>
                    <input
                      id="custom-report-start"
                      type="datetime-local"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="admin-report-datetime-input"
                    />
                  </div>
                  <div className="custom-input-group">
                    <label htmlFor="custom-report-end">To</label>
                    <input
                      id="custom-report-end"
                      type="datetime-local"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="admin-report-datetime-input"
                    />
                  </div>
                  <span className="custom-range-hint">
                    {(new Date(customEnd) - new Date(customStart)) <= 48 * 3600000 ? "Hourly breakdown" : "Daily breakdown"}
                  </span>
                </div>
              )}

            {periodOrders.length ? (
              <div className="report-trend">
                <svg
                  className="report-trend-chart"
                  viewBox={`0 0 ${trend.width} ${trend.height}`}
                  role="img"
                  aria-label={`Revenue trend across ${trend.points.length} periods, totalling ${peso(periodSales)} and peaking at ${peso(trend.best?.amount || 0)}`}
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
                      key={point.start.toISOString()}
                      x={point.barX}
                      y={point.barHeight > 0 ? point.y : trend.baseline - 2}
                      width={point.barWidth}
                      height={Math.max(point.barHeight, 2)}
                      rx="4"
                      className={`report-trend-bar${index === trend.points.length - 1 ? " latest" : ""}${point.amount === 0 ? " zero" : ""}`}
                    >
                      <title>{`${point.label} · ${peso(point.amount)} · ${point.orders} order${point.orders === 1 ? "" : "s"}`}</title>
                    </rect>
                  ))}

                  {trend.labelledPoints.map((point) => point.showLabel ? (
                    <text
                      key={`x-${point.start.toISOString()}`}
                      x={point.x}
                      y={trend.height - 8}
                      className="report-trend-axis-label"
                      textAnchor="middle"
                    >
                      {point.label}
                    </text>
                  ) : null)}
                </svg>
              </div>
            ) : (
              <div className="admin-report-empty">
                <span>▥</span>
                <strong>No sales recorded for this period</strong>
                <p>Orders placed during {range.label.toLowerCase()} will appear here automatically.</p>
              </div>
            )}
          </section>

          <div className="admin-report-panel sales-summary">
            <div className="panel-heading">
              <div>
                <span className="admin-report-eyebrow">SALES SUMMARY</span>
                <h3>{rangeKey === "1d" ? "Today's Active Session" : rangeKey === "all" ? "All Sessions (All-Time)" : rangeKey === "custom" ? "Custom Range" : `Last ${range.label}`}</h3>
              </div>
              <span className="report-panel-icon">₱</span>
            </div>
            <div className="sales-metrics">
              <div>
                <span>Net sales</span>
                <strong>{peso(periodSales)}</strong>
              </div>
              <div>
                <span>Estimated COGS</span>
                <strong>{peso(periodCogs)}</strong>
              </div>
              <div>
                <span>Gross profit</span>
                <strong>{peso(periodGrossProfit)} <small style={{ fontSize: "0.75em", fontWeight: 600, color: "#5d9b69" }}>({periodMarginPercent.toFixed(1)}% margin)</small></strong>
              </div>
              <div>
                <span>Average order value</span>
                <strong>{peso(averageOrder)}</strong>
              </div>
              <div>
                <span>Items sold</span>
                <strong>{itemsSold}</strong>
              </div>
              <div>
                <span>Settled orders</span>
                <strong>{paidOrders.length}</strong>
              </div>
              <div>
                <span>Outstanding balance</span>
                <strong className={unpaidExposure > 0 ? "due" : ""}>{peso(unpaidExposure)}</strong>
              </div>
            </div>
          </div>

          <section className="admin-report-stats" aria-label="Summary metrics">
            <div>
              <span className="report-stat-mark green">✓</span>
              <div>
                <small>Items sold</small>
                <strong>{itemsSold}</strong>
                <span className="report-stat-note flat">
                  {paidOrders.length} of {periodOrders.length} settled
                </span>
              </div>
            </div>
            <div>
              <span className="report-stat-mark plum">₱</span>
              <div>
                <small>Net sales</small>
                <strong>{peso(periodSales)}</strong>
                <span className={`report-stat-note ${salesTrend.tone}`}>{salesTrend.text} vs prior period</span>
              </div>
            </div>
            <div>
              <span className="report-stat-mark amber">◷</span>
              <div>
                <small>Average order</small>
                <strong>{peso(averageOrder)}</strong>
                <span className={`report-stat-note ${averageTrend.tone}`}>{averageTrend.text} vs prior period</span>
              </div>
            </div>
            <div>
              <span className="report-stat-mark blue">▤</span>
              <div>
                <small>Orders placed</small>
                <strong>{periodOrders.length}</strong>
                <span className={`report-stat-note ${orderTrend.tone}`}>{orderTrend.text} vs prior period</span>
              </div>
            </div>
          </section>
        </div>

          <section className="admin-report-sales-layout" aria-label="Sales breakdown">
            <div className="admin-report-panel channel-panel">
              <div className="panel-heading">
                <div>
                  <span className="admin-report-eyebrow">CHANNEL MIX</span>
                  <h3>Where orders come from</h3>
                </div>
                <span className="inventory-count">{channelMix.length} channels</span>
              </div>

              <div className="report-breakdown">
                {channelMix.length ? channelMix.map((channel) => (
                  <div className="report-breakdown-row" key={channel.type}>
                    <div className="report-breakdown-head">
                      <strong>{channel.type}</strong>
                      <span>{channel.orders} order{channel.orders === 1 ? "" : "s"} · {peso(channel.revenue)}</span>
                    </div>
                    <div className="report-breakdown-track">
                      <div className="report-breakdown-bar" style={{ width: `${Math.max(6, channelShare(channel.revenue))}%` }}></div>
                    </div>
                    <small>{Math.round(revenueShare(channel.revenue))}% of sales</small>
                  </div>
                )) : (
                  <div className="admin-report-empty compact">
                    <strong>No channel data yet</strong>
                  </div>
                )}
              </div>

              <div className="report-status-row">
                {statusMix.map((entry) => (
                  <div key={entry.status} className={`report-status-pill ${entry.status.toLowerCase()}`}>
                    <strong>{entry.orders}</strong>
                    <span>{entry.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="admin-report-panel products-panel" aria-label="Top selling products">
            <div className="panel-heading">
              <div>
                <span className="admin-report-eyebrow">PRODUCT PERFORMANCE</span>
                <h3>Top selling items</h3>
              </div>
              <span className="inventory-count">{topProducts.length} of {new Set(periodOrders.flatMap((order) => orderItemList(order).map((item) => item.title))).size} items</span>
            </div>

            {topProducts.length ? (
              <div className="inventory-table-wrap">
                <table className="inventory-table report-products-table">
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Product</th>
                      <th scope="col">Category</th>
                      <th scope="col">Units sold</th>
                      <th scope="col">Revenue</th>
                      <th scope="col">COGS</th>
                      <th scope="col">Gross profit</th>
                      <th scope="col">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProducts.map((product, index) => (
                      <tr key={product.title}>
                        <td><span className="report-rank">{index + 1}</span></td>
                        <td>{product.title}</td>
                        <td>{product.category}</td>
                        <td>{product.quantity}</td>
                        <td>{peso(product.revenue)}</td>
                        <td>{peso(product.cogs)}</td>
                        <td>{peso(product.profit)}</td>
                        <td>
                          <span className="report-share">
                            <span className="report-share-track">
                              <span className="report-share-bar" style={{ width: `${Math.max(4, revenueShare(product.revenue))}%` }}></span>
                            </span>
                            {Math.round(revenueShare(product.revenue))}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="admin-report-empty">
                <span>◔</span>
                <strong>No product sales in this period</strong>
                <p>Once orders are placed, your best sellers will be ranked here.</p>
              </div>
            )}
          </section>

          <section className="admin-report-panel cashier-panel" aria-label="Cashier attribution report">
            <div className="panel-heading cashier-panel-heading">
              <div>
                <span className="admin-report-eyebrow">STAFF ATTRIBUTION</span>
                <h3>Cashiers in charge</h3>
                <p className="cashier-panel-description">Paid sales attributed to each cashier in the selected period.</p>
              </div>
              <span className="cashier-active-note"><span aria-hidden="true" />{cashierSales.length} {cashierSales.length === 1 ? "cashier" : "cashiers"} with sales</span>
            </div>

            {cashierSales.length ? (
              <>
                <div className="cashier-summary" aria-label="Cashier sales summary">
                  <div className="cashier-summary-card">
                    <span>Orders processed</span>
                    <strong>{cashierSummary.orders.toLocaleString()}</strong>
                  </div>
                  <div className="cashier-summary-card revenue">
                    <span>Attributed revenue</span>
                    <strong>{peso(cashierSummary.revenue)}</strong>
                  </div>
                  <div className="cashier-summary-card">
                    <span>Average ticket</span>
                    <strong>{peso(cashierSummary.averageTicket)}</strong>
                  </div>
                </div>
                <div className="cashier-table-heading">
                  <strong>Cashier performance</strong>
                  <span>Ranked by attributed sales</span>
                </div>
                <div className="inventory-table-wrap cashier-table-wrap">
                  <table className="inventory-table cashier-table">
                    <thead>
                      <tr>
                        <th scope="col">Rank</th>
                        <th scope="col">Cashier</th>
                        <th scope="col">Orders</th>
                        <th scope="col">Sales revenue</th>
                        <th scope="col">Average ticket</th>
                        <th scope="col">Sales share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashierSales.map((cashier, index) => (
                        <tr key={cashier.name}>
                          <td><span className="cashier-rank">{String(index + 1).padStart(2, "0")}</span></td>
                          <td><div className="cashier-person"><span aria-hidden="true">{initials(cashier.name)}</span><strong>{cashier.name}</strong></div></td>
                          <td>{cashier.orders}</td>
                          <td><strong>{peso(cashier.revenue)}</strong></td>
                          <td>{peso(cashier.orders ? cashier.revenue / cashier.orders : 0)}</td>
                          <td>
                            <div className="cashier-share">
                              <div
                                className="cashier-share-track"
                                role="progressbar"
                                aria-label={`${cashier.name} sales share`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(revenueShare(cashier.revenue))}
                              >
                                <span style={{ width: `${revenueShare(cashier.revenue)}%` }} />
                              </div>
                              <strong>{Math.round(revenueShare(cashier.revenue))}%</strong>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="admin-report-empty">
                <span>◎</span>
                <strong>No cashier sales in this period</strong>
                <p>Transactions processed at the counter will appear here attributed to the cashier in charge.</p>
              </div>
            )}
          </section>

          <section className="admin-report-panel inventory-panel" aria-label="Inventory report">
            <div className="panel-heading inventory-panel-heading">
              <div>
                <span className="admin-report-eyebrow">INVENTORY REPORT</span>
                <h3>Stock health</h3>
                <p className="inventory-panel-description">A live view of tracked ingredients and supplies.</p>
              </div>
              <div className="inventory-panel-actions">
                <button
                  type="button"
                  className="restock-open-button"
                  onClick={() => { setRestockNotice(""); setRestockModalOpen(true); }}
                  aria-haspopup="dialog"
                  aria-label={`View restock list, ${restockItems.length} items need attention`}
                >
                  View restock list <span>{restockItems.length}</span>
                </button>
                <span className="inventory-live-note"><span aria-hidden="true" /> Live inventory</span>
              </div>
            </div>

            <div className="stock-overview" aria-label="Inventory summary">
              <div className="stock-overview-card total">
                <span className="stock-overview-icon" aria-hidden="true">▤</span>
                <div><span>Tracked items</span><strong>{stockBreakdown.total}</strong></div>
              </div>
              <div className="stock-overview-card healthy">
                <span className="stock-overview-icon" aria-hidden="true">✓</span>
                <div><span>In stock</span><strong>{stockBreakdown.healthy}</strong></div>
              </div>
              <div className="stock-overview-card critical">
                <span className="stock-overview-icon" aria-hidden="true">!</span>
                <div><span>Out of stock</span><strong>{stockBreakdown.critical}</strong></div>
              </div>
              <div className="stock-overview-card over">
                <span className="stock-overview-icon" aria-hidden="true">↗</span>
                <div><span>Above maximum</span><strong>{stockBreakdown.over}</strong></div>
              </div>
            </div>

            <div className="stock-list-toolbar">
              <div>
                <strong>Inventory items</strong>
                <span>Health thresholds: red ≤20% · orange ≤40% · amber ≤70% · green above 70%.</span>
              </div>
              <div className="stock-toolbar-actions">
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
                <div className="stock-filter-tabs" role="tablist" aria-label="Filter stock report">
                  {stockFilters.map((filter) => {
                    const count = filter === "all"
                      ? stockReport.length
                      : filter === "attention"
                        ? stockBreakdown.critical + stockBreakdown.over
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
              </div>
            </div>

            {inventoryLoading && inventory.length === 0 ? (
              <div className="admin-report-empty"><strong>Loading stock levels</strong><p>Fetching the latest inventory quantities.</p></div>
            ) : inventoryError && inventory.length === 0 ? (
              <div className="admin-report-empty" role="alert"><strong>Inventory report unavailable</strong><p>{inventoryError}</p></div>
            ) : visibleStock.length ? (
              <div className="inventory-table-wrap stock-table-wrap">
                <table className="inventory-table stock-table">
                  <thead>
                    <tr>
                      <th scope="col">Inventory item</th>
                      <th scope="col">Category</th>
                      <th scope="col">Stock level</th>
                      <th scope="col">Maximum stock</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStock.map((item) => (
                      <tr key={item.id ?? item.product}>
                        <td>{item.item}</td>
                        <td>{item.category}</td>
                        <td>
                          <div className="stock-level-value">
                            <span>{item.quantity.toLocaleString()} {item.unit}</span>
                            {item.capacityPercent != null && (
                              <span className={`stock-level-percent ${item.healthTone}`}>
                                {item.reportedPercent}%
                              </span>
                            )}
                          </div>
                          <div
                            className={`stock-level-track${item.capacityPercent == null ? " untracked" : ""}`}
                            role={item.capacityPercent == null ? undefined : "progressbar"}
                            aria-label={item.capacityPercent == null ? undefined : `${item.item} stock level`}
                            aria-valuemin={item.capacityPercent == null ? undefined : 0}
                            aria-valuemax={item.capacityPercent == null ? undefined : 100}
                            aria-valuenow={item.reportedPercent ?? undefined}
                            aria-valuetext={item.reportedPercent == null ? undefined : `${item.reportedPercent}% of maximum stock${item.healthTone === "critical" ? ", critically low" : item.healthTone === "low" ? ", running low" : item.healthTone === "moderate" ? ", moderate stock" : item.healthTone === "over" ? ", above maximum" : ", healthy stock"}`}
                            title={item.reportedPercent == null ? "Maximum stock is not set" : `${item.reportedPercent}% of maximum stock`}
                          >
                            <span className={`stock-level-fill ${item.healthTone}`} style={{ width: `${item.capacityPercent ?? 0}%` }} />
                          </div>
                        </td>
                        <td>{item.maximumStock == null ? "Not set" : `${item.maximumStock} ${item.unit}`}</td>
                        <td>
                          <span className={`inventory-status ${item.healthTone}`}><span aria-hidden="true" />{item.label}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="admin-report-empty">
                <span>◔</span>
                <strong>Nothing to show for this filter</strong>
                <p>Switch filters to review the rest of your tracked ingredients and supplies.</p>
              </div>
            )}
          </section>

          {insights.length ? (
            <section className="admin-report-insights" aria-label="Report highlights">
              <div className="report-highlights-heading">
                <div>
                  <span className="admin-report-eyebrow">PERIOD SUMMARY</span>
                  <h3>Report highlights</h3>
                  <p>Key signals from the selected reporting period.</p>
                </div>
              </div>
              {insights.map((insight) => (
                <div key={insight.label} className={`admin-report-insight ${insight.tone}`}>
                  <span className="report-insight-icon" aria-hidden="true">
                    {insight.label === "Best day" ? "↗" : insight.label === "Top channel" ? "◉" : insight.label === "Best seller" ? "★" : "!"}
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
          className="restock-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRestockModalOpen(false);
          }}
        >
          <section
            className="restock-modal restock-notebook"
            role="dialog"
            aria-modal="true"
            aria-labelledby="restock-modal-title"
            aria-describedby="restock-modal-description"
          >
            {/* 3D Animated Leather Cover that slowly opens on mount */}
            <div className="restock-notebook-cover" aria-hidden="true">
              <div className="notebook-cover-Inner">
                <span className="notebook-cover-crest">AMAYA CAFE</span>
                <strong className="notebook-cover-title">RESTOCK LEDGER</strong>
                <span className="notebook-cover-sub">Inventory Refill Requisition</span>
              </div>
            </div>

            {/* Spiral Binding Spine + Perforated Holes */}
            <div className="restock-notebook-spine" aria-hidden="true">
              {Array.from({ length: 11 }).map((_, idx) => (
                <span key={idx} className="notebook-ring-pair">
                  <i className="notebook-ring-hole" />
                  <b className="notebook-ring-wire" />
                </span>
              ))}
            </div>

            {/* Bookmark Ribbon */}
            <div className="restock-notebook-ribbon" aria-hidden="true" />

            {/* Ruled Notebook Page Interior */}
            <div className="restock-notebook-page">
              <header className="restock-modal-header">
                <div className="restock-notebook-title-block">
                  <div className="restock-notebook-meta-row">
                    <span className="admin-report-eyebrow">INVENTORY REQUISITION NOTEBOOK</span>
                    <span className="restock-notebook-date">
                      {new Date().toLocaleDateString("en-US", {
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
                  onClick={() => setRestockModalOpen(false)}
                  aria-label="Close restock notebook"
                  autoFocus
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
                      const refillAmount =
                        item.maximumStock == null
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
                    onClick={() => setRestockModalOpen(false)}
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
    </div>
  );
}

export default AdminReport;
