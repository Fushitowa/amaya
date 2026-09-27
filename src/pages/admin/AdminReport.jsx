import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Sidebar from "../../components/Sidebar.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import adminAvatar from "../../assets/images/icon/admin1.svg";
import { useSidebar } from "../../context/useSidebar.jsx";
import { isOrderPaid, useOrders } from "../../context/OrdersContext.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import "../../assets/css/admin/AdminReport.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const LOW_STOCK_THRESHOLD = 5;

const rangeOptions = [
  { key: "7d", label: "Last 7 days", days: 7, bucketDays: 1, axisStep: 1 },
  { key: "30d", label: "Last 30 days", days: 30, bucketDays: 1, axisStep: 5 },
  { key: "90d", label: "Last 90 days", days: 90, bucketDays: 7, axisStep: 2 },
];

const stockFilters = ["all", "attention", "healthy"];

const orderStatuses = ["Pending", "Preparing", "Ready", "Completed"];

const lowStockTone = (stock) => {
  if (stock <= 0) return { label: "Out of Stock", tone: "critical" };
  if (stock <= LOW_STOCK_THRESHOLD) return { label: "Low Stock", tone: "low" };
  return { label: "In Stock", tone: "available" };
};

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
  const { products = [] } = useMenu() || {};

  const [rangeKey, setRangeKey] = useState("7d");
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
    const end = startOfDay(new Date());
    end.setDate(end.getDate() + 1);

    const start = new Date(end);
    start.setDate(start.getDate() - range.days);

    const previousStart = new Date(start);
    previousStart.setDate(previousStart.getDate() - range.days);

    return { start, end, previousStart };
  }, [range]);

  const periodOrders = useMemo(() => orders.filter((order) => {
    const timestamp = orderTimestamp(order);
    return timestamp >= rangeBounds.start.getTime() && timestamp < rangeBounds.end.getTime();
  }), [orders, rangeBounds]);

  const previousOrders = useMemo(() => orders.filter((order) => {
    const timestamp = orderTimestamp(order);
    return timestamp >= rangeBounds.previousStart.getTime() && timestamp < rangeBounds.start.getTime();
  }), [orders, rangeBounds]);

  const periodSales = useMemo(
    () => periodOrders.reduce((sum, order) => sum + orderTotal(order), 0),
    [periodOrders],
  );

  const previousSales = useMemo(
    () => previousOrders.reduce((sum, order) => sum + orderTotal(order), 0),
    [previousOrders],
  );

  const averageOrder = periodOrders.length ? periodSales / periodOrders.length : 0;
  const previousAverage = previousOrders.length ? previousSales / previousOrders.length : 0;

  const itemsSold = useMemo(() => periodOrders.reduce(
    (sum, order) => sum + orderItemList(order).reduce(
      (itemSum, item) => itemSum + Number(item.quantity || 0),
      0,
    ),
    0,
  ), [periodOrders]);

  const revenueSeries = useMemo(() => {
    const bucketCount = Math.ceil(range.days / range.bucketDays);
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
      const start = new Date(rangeBounds.start);
      start.setDate(start.getDate() + index * range.bucketDays);

      const end = new Date(start);
      end.setDate(end.getDate() + range.bucketDays);

      return { start, end, amount: 0, orders: 0 };
    });

    periodOrders.forEach((order) => {
      const timestamp = orderTimestamp(order);
      const bucket = buckets.find((entry) => timestamp >= entry.start.getTime() && timestamp < entry.end.getTime());

      if (bucket) {
        bucket.amount += orderTotal(order);
        bucket.orders += 1;
      }
    });

    return buckets;
  }, [periodOrders, range, rangeBounds]);

  const trend = useMemo(() => {
    const width = 760;
    const height = 250;
    const padLeft = 62;
    const padRight = 14;
    const padTop = 18;
    const padBottom = 30;
    const innerWidth = width - padLeft - padRight;
    const innerHeight = height - padTop - padBottom;
    const ceiling = niceCeil(Math.max(...revenueSeries.map((bucket) => bucket.amount), 0));
    const labelFormat = range.days === 7 && range.bucketDays === 1
      ? { weekday: "short" }
      : { month: "short", day: "numeric" };

    const points = revenueSeries.map((bucket, index) => {
      const x = revenueSeries.length === 1
        ? padLeft + innerWidth / 2
        : padLeft + (index / (revenueSeries.length - 1)) * innerWidth;
      const y = padTop + innerHeight - (ceiling > 0 ? (bucket.amount / ceiling) * innerHeight : 0);

      return {
        ...bucket,
        x,
        y,
        label: bucket.start.toLocaleDateString("en-US", labelFormat),
      };
    });

    const baseline = padTop + innerHeight;
    const linePath = points.map((point, index) => (
      `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    )).join(" ");

    const areaPath = points.length
      ? `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${baseline} L ${points[0].x.toFixed(2)} ${baseline} Z`
      : "";

    const gridLines = Array.from({ length: 4 }, (_, index) => {
      const ratio = index / 3;

      return {
        y: padTop + innerHeight - ratio * innerHeight,
        value: ceiling * ratio,
        isBaseline: index === 0,
      };
    });

    const lastIndex = points.length - 1;
    const labelledPoints = points.map((point, index) => ({
      ...point,
      showLabel: index % range.axisStep === 0 || index === lastIndex,
    }));

    const best = points.reduce((top, point) => (point.amount > top.amount ? point : top), points[0]);

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
      linePath,
      areaPath,
      gridLines,
      best,
    };
  }, [revenueSeries, range]);

  const topProducts = useMemo(() => {
    const totals = new Map();

    periodOrders.forEach((order) => {
      orderItemList(order).forEach((item) => {
        const key = item.title || "Menu item";
        const current = totals.get(key) || { title: key, quantity: 0, revenue: 0, category: item.category || "Menu item" };
        const quantity = Number(item.quantity || 0);
        const price = Number(item.price || 0);

        current.quantity += quantity;
        current.revenue += quantity * price;
        totals.set(key, current);
      });
    });

    return [...totals.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  }, [periodOrders]);

  const channelMix = useMemo(() => {
    const totals = new Map();

    periodOrders.forEach((order) => {
      const key = order.type || "Counter";
      const current = totals.get(key) || { type: key, orders: 0, revenue: 0 };
      current.orders += 1;
      current.revenue += orderTotal(order);
      totals.set(key, current);
    });

    return [...totals.values()].sort((a, b) => b.revenue - a.revenue);
  }, [periodOrders]);

  const statusMix = useMemo(() => orderStatuses.map((status) => ({
    status,
    orders: periodOrders.filter((order) => order.status === status).length,
  })), [periodOrders]);

  const paidOrders = useMemo(
    () => periodOrders.filter(isOrderPaid),
    [periodOrders],
  );

  const unpaidExposure = useMemo(
    () => periodOrders.filter((order) => !isOrderPaid(order)).reduce((sum, order) => sum + orderTotal(order), 0),
    [periodOrders],
  );

  const pendingCount = useMemo(
    () => orders.filter((order) => order.status === "Pending").length,
    [orders],
  );

  const stockReport = useMemo(() => {
    const soldByProduct = new Map();

    orders.forEach((order) => {
      orderItemList(order).forEach((item) => {
        soldByProduct.set(item.title, (soldByProduct.get(item.title) || 0) + Number(item.quantity || 0));
      });
    });

    return products.map((product) => {
      const sold = soldByProduct.get(product.name) || 0;
      const stock = Math.max(0, Number(product.stock || 0) - sold);

      return {
        id: product.id,
        product: product.name,
        category: product.category,
        stock,
        sold,
        ...lowStockTone(stock),
      };
    });
  }, [orders, products]);

  const stockBreakdown = useMemo(() => ({
    total: stockReport.length,
    low: stockReport.filter((item) => item.tone === "low").length,
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

    if (stockBreakdown.critical || stockBreakdown.low) {
      notes.push({
        tone: "warning",
        label: "Stock alerts",
        value: `${stockBreakdown.critical + stockBreakdown.low} item${stockBreakdown.critical + stockBreakdown.low === 1 ? "" : "s"} need restocking`,
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

    const header = ["Order ID", "Date", "Customer", "Type", "Payment", "Status", "Items", "Total"];
    const rows = periodOrders.map((order) => [
      order.id,
      new Date(order.createdAt).toLocaleString(),
      order.customer,
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
            <PortalNotificationButton count={pendingCount} />
            <div className="admin-report-user">
              <div className="amaya-admin-avatar"><img src={adminAvatar} alt="" aria-hidden="true" /></div>
              <div>
                <strong>Administrator</strong>
                <span>Store Supervisor</span>
              </div>
            </div>
          </div>
        </header>

        <div className="admin-report-content">
          <section className="admin-report-heading">
            <div>
              <span className="admin-report-eyebrow">PERFORMANCE ANALYTICS</span>
              <h2>Reports at a glance</h2>
              <p>Track sales performance, product demand, and stock health for Amaya&apos;s Drinks and Bites.</p>
            </div>
            <div className="admin-report-heading-actions">
              <div className="admin-report-date">
                <span>REPORT DATE</span>
                <strong>{liveDate}</strong>
                <small>Generated {generatedStamp}</small>
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
          </section>

          <div className="admin-report-range" role="tablist" aria-label="Reporting period">
            {rangeOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={option.key === range.key}
                className={option.key === range.key ? "active" : ""}
                onClick={() => setRangeKey(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <section className="admin-report-stats" aria-label="Summary metrics">
            <div>
              <span className="report-stat-mark plum">₱</span>
              <div>
                <small>Net sales</small>
                <strong>{peso(periodSales)}</strong>
                <span className={`report-stat-note ${salesTrend.tone}`}>{salesTrend.text} vs prior period</span>
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
            <div>
              <span className="report-stat-mark amber">◷</span>
              <div>
                <small>Average order</small>
                <strong>{peso(averageOrder)}</strong>
                <span className={`report-stat-note ${averageTrend.tone}`}>{averageTrend.text} vs prior period</span>
              </div>
            </div>
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
          </section>

          <section className="admin-report-panel trend-panel" aria-label="Revenue trend">
            <div className="panel-heading">
              <div>
                <span className="admin-report-eyebrow">REVENUE TREND</span>
                <h3>{range.label} performance</h3>
              </div>
              <span className="weekly-total">{peso(periodSales)}</span>
            </div>

            {periodOrders.length ? (
              <div className="report-trend">
                <svg
                  className="report-trend-chart"
                  viewBox={`0 0 ${trend.width} ${trend.height}`}
                  role="img"
                  aria-label={`Revenue trend across ${trend.points.length} periods, totalling ${peso(periodSales)} and peaking at ${peso(trend.best?.amount || 0)}`}
                >
                  <defs>
                    <linearGradient id="reportTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8b5e3c" stopOpacity="0.26" />
                      <stop offset="100%" stopColor="#8b5e3c" stopOpacity="0.02" />
                    </linearGradient>
                  </defs>

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

                  <path d={trend.areaPath} fill="url(#reportTrendFill)" />
                  <path d={trend.linePath} className="report-trend-line" />

                  {trend.points.map((point, index) => (
                    <circle
                      key={point.start.toISOString()}
                      cx={point.x}
                      cy={point.y}
                      r={index === trend.points.length - 1 ? 4.5 : 3}
                      className="report-trend-dot"
                    >
                      <title>{`${point.label} · ${peso(point.amount)} · ${point.orders} order${point.orders === 1 ? "" : "s"}`}</title>
                    </circle>
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

          <section className="admin-report-sales-layout" aria-label="Sales breakdown">
            <div className="admin-report-panel sales-summary">
              <div className="panel-heading">
                <div>
                  <span className="admin-report-eyebrow">SALES SUMMARY</span>
                  <h3>{range.label}</h3>
                </div>
                <span className="report-panel-icon">₱</span>
              </div>
              <div className="sales-metrics">
                <div>
                  <span>Net sales</span>
                  <strong>{peso(periodSales)}</strong>
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

          <section className="admin-report-panel inventory-panel" aria-label="Inventory report">
            <div className="panel-heading">
              <div>
                <span className="admin-report-eyebrow">INVENTORY REPORT</span>
                <h3>Stock health</h3>
              </div>
              <span className="inventory-count">
                {stockBreakdown.critical} critical · {stockBreakdown.low} low
              </span>
            </div>

            <div className="admin-report-range subtle" role="tablist" aria-label="Filter stock report">
              {stockFilters.map((filter) => {
                const count = filter === "all"
                  ? stockReport.length
                  : filter === "attention"
                    ? stockBreakdown.critical + stockBreakdown.low
                    : stockReport.length - stockBreakdown.critical - stockBreakdown.low;

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

            {visibleStock.length ? (
              <div className="inventory-table-wrap">
                <table className="inventory-table">
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">Category</th>
                      <th scope="col">Sold</th>
                      <th scope="col">Remaining</th>
                      <th scope="col">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleStock.map((item) => (
                      <tr key={item.id ?? item.product}>
                        <td>{item.product}</td>
                        <td>{item.category}</td>
                        <td>{item.sold}</td>
                        <td>{item.stock}</td>
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
                <p>Switch filters to review the rest of your product stock.</p>
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
