import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Sidebar from "../../components/Sidebar.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { isOrderPaid, useOrders } from "../../context/OrdersContext.jsx";
import { getInventoryStatus, useInventory } from "../../context/InventoryContext.jsx";
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

  const [rangeKey, setRangeKey] = useState("1d");
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
  const [exportNotice, setExportNotice] = useState(false);
  const noticeTimer = useRef(null);

  const range = rangeOptions.find((option) => option.key === rangeKey) || rangeOptions[0];

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

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
  }, [rangeKey, range.days, customStart, customEnd]);

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
      return {
        id: entry.id,
        item: entry.item,
        category: entry.category,
        quantity: entry.quantity,
        unit: entry.unit,
        maximumStock: entry.maximumStock,
        tone: status === "In Stock" ? "available" : status === "Over Maximum" ? "over" : "critical",
        label: status,
      };
    });
  }, [inventory]);

  const stockBreakdown = useMemo(() => ({
    total: stockReport.length,
    over: stockReport.filter((item) => item.tone === "over").length,
    critical: stockReport.filter((item) => item.tone === "critical").length,
  }), [stockReport]);

  const visibleStock = useMemo(() => {
    if (stockFilter === "attention") return stockReport.filter((item) => item.tone !== "available");
    if (stockFilter === "healthy") return stockReport.filter((item) => item.tone === "available");
    return stockReport;
  }, [stockFilter, stockReport]);

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
            <PortalNotificationButton />
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

          <section className="admin-report-panel" aria-label="Cashier attribution report">
            <div className="panel-heading">
              <div>
                <span className="admin-report-eyebrow">STAFF ATTRIBUTION</span>
                <h3>Cashiers in charge</h3>
              </div>
              <span className="inventory-count">{cashierSales.length} {cashierSales.length === 1 ? "cashier" : "cashiers"} active</span>
            </div>

            {cashierSales.length ? (
              <div className="inventory-table-wrap">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th scope="col">Cashier in Charge</th>
                      <th scope="col">Orders Processed</th>
                      <th scope="col">Total Sales Revenue</th>
                      <th scope="col">Average Ticket</th>
                      <th scope="col">Sales Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashierSales.map((cashier) => (
                      <tr key={cashier.name}>
                        <td>
                          <strong style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                            👤 {cashier.name}
                          </strong>
                        </td>
                        <td>{cashier.orders}</td>
                        <td><strong>{peso(cashier.revenue)}</strong></td>
                        <td>{peso(cashier.orders ? cashier.revenue / cashier.orders : 0)}</td>
                        <td>
                          <span className="report-share">
                            <span className="report-share-track">
                              <span
                                className="report-share-bar"
                                style={{ width: `${Math.max(4, revenueShare(cashier.revenue))}%` }}
                              ></span>
                            </span>
                            {Math.round(revenueShare(cashier.revenue))}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="admin-report-empty">
                <span>👤</span>
                <strong>No cashier sales in this period</strong>
                <p>Transactions processed at the counter will appear here attributed to the cashier in charge.</p>
              </div>
            )}
          </section>

          <section className="admin-report-panel inventory-panel" aria-label="Inventory report">
            <div className="panel-heading">
              <div>
                <span className="admin-report-eyebrow">INVENTORY REPORT</span>
                <h3>Stock health</h3>
              </div>
              <span className="inventory-count">
                {stockBreakdown.critical} out of stock · {stockBreakdown.over} above maximum
              </span>
            </div>

            <div className="admin-report-range subtle" role="tablist" aria-label="Filter stock report">
              {stockFilters.map((filter) => {
                const count = filter === "all"
                  ? stockReport.length
                  : filter === "attention"
                    ? stockBreakdown.critical + stockBreakdown.over
                    : stockReport.length - stockBreakdown.critical - stockBreakdown.over;

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

            {inventoryLoading && inventory.length === 0 ? (
              <div className="admin-report-empty"><strong>Loading stock levels</strong><p>Fetching the latest inventory quantities.</p></div>
            ) : inventoryError && inventory.length === 0 ? (
              <div className="admin-report-empty" role="alert"><strong>Inventory report unavailable</strong><p>{inventoryError}</p></div>
            ) : visibleStock.length ? (
              <div className="inventory-table-wrap">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th scope="col">Inventory item</th>
                      <th scope="col">Category</th>
                      <th scope="col">Current quantity</th>
                      <th scope="col">Maximum stock</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStock.map((item) => (
                      <tr key={item.id ?? item.product}>
                        <td>{item.item}</td>
                        <td>{item.category}</td>
                        <td>{item.quantity} {item.unit}</td>
                        <td>{item.maximumStock == null ? "Not set" : `${item.maximumStock} ${item.unit}`}</td>
                        <td>
                          <span className={`inventory-status ${item.tone}`}>{item.label}</span>
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
              {insights.map((insight) => (
                <div key={insight.label} className={`admin-report-insight ${insight.tone}`}>
                  <span>{insight.label}</span>
                  <strong>{insight.value}</strong>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export default AdminReport;
