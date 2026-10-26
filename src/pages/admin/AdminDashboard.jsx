import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  ChartNoAxesColumnIncreasing,
  CircleDollarSign,
  Coins,
  Plus,
  ReceiptText,
  ShoppingBag,
  TrendingUp,
  Warehouse,
} from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import PortalHero from "../../components/PortalHero.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import adminAvatar from "../../assets/images/icon/admin1.svg";
import { useSidebar } from "../../context/useSidebar.jsx";
import { isToday, useOrders } from "../../context/OrdersContext.jsx";
import { useInventory } from "../../context/InventoryContext.jsx";
import "../../assets/css/admin/AdminDashboard.css";
import "../../assets/css/portal-hero.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

function AdminDashboard() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { orders } = useOrders();
  const { inventory } = useInventory() || { inventory: [] };
  const [salesRange, setSalesRange] = useState("week");

  // 1. Total Sales (strictly from verified Paid orders)
  const paidOrders = useMemo(() => orders.filter((order) => order.payment === "Paid"), [orders]);
  const allTimeSales = useMemo(() => paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0), [paidOrders]);
  const allTimeCogs = useMemo(
    () =>
      paidOrders.reduce(
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
    [paidOrders],
  );
  const allTimeProfit = allTimeSales - allTimeCogs;
  const allTimeMarginPercent = allTimeSales > 0 ? (allTimeProfit / allTimeSales) * 100 : 0;

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
  // Note: Operating cash float requires End-of-Day cash reconciliation record. We report real cash collected today.
  const todaysCashCollected = useMemo(() => {
    return todaysPaidOrders
      .filter((order) => (order.paymentMethod || "Cash").toLowerCase() === "cash")
      .reduce((sum, order) => sum + Number(order.total || 0), 0);
  }, [todaysPaidOrders]);

  const liveDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const salesBuckets = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let buckets;

    if (salesRange === "year") {
      buckets = Array.from({ length: 12 }, (_, index) => {
        const start = new Date(today.getFullYear(), today.getMonth() - 11 + index, 1);
        const end = new Date(today.getFullYear(), today.getMonth() - 10 + index, 1);
        return { start, end, label: start.toLocaleDateString("en-US", { month: "short" }) };
      });
    } else {
      const days = salesRange === "month" ? 30 : 7;
      const bucketDays = salesRange === "month" ? 5 : 1;
      const start = new Date(today);
      start.setDate(start.getDate() - days + 1);
      buckets = Array.from({ length: days / bucketDays }, (_, index) => {
        const bucketStart = new Date(start);
        bucketStart.setDate(bucketStart.getDate() + index * bucketDays);
        const end = new Date(bucketStart);
        end.setDate(end.getDate() + bucketDays);
        return {
          start: bucketStart,
          end,
          label: salesRange === "week"
            ? bucketStart.toLocaleDateString("en-US", { weekday: "short" })
            : bucketStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        };
      });
    }

    return buckets.map((bucket) => {
      let bucketTotal = 0;
      let bucketCogs = 0;
      orders.forEach((order) => {
        if (order.payment !== "Paid") return;
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
  }, [orders, salesRange]);
  const periodSales = salesBuckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const periodProfit = salesBuckets.reduce((sum, bucket) => sum + (bucket.profit || 0), 0);
  const chartMaximum = Math.max(1, ...salesBuckets.map((bucket) => bucket.total));
  const chartRangeLabel = salesRange === "year" ? "this year" : salesRange === "month" ? "last 30 days" : "last 7 days";

  return (
    <div className={`admin-dashboard ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        role="admin"
        activeTab="dashboard" orderCount={orders.length}
        sidebarCollapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-page-title">
            <h1>Dashboard</h1>
            <p>Overview of your Amaya business</p>
          </div>

          <div className="admin-topbar-right">
            <PortalNotificationButton />

            <div className="admin-user">
              <div className="amaya-admin-avatar"><img src={adminAvatar} alt="" aria-hidden="true" /></div>

              <div className="admin-user-info">
                <strong>Administrator</strong>
                <span>Admin</span>
              </div>
            </div>
          </div>
        </header>

        <div className="admin-content">
          <PortalHero
            label="Administrator"
            greeting="Welcome back"
            highlight="Admin!"
            subtitle="Here’s what’s happening with Amaya today."
            date={liveDate}
            statusTitle="System active"
          />

          <section className="admin-stats">
            <div className="admin-stat-card stat-card-sales">
              <div className="stat-icon"><CircleDollarSign size={21} strokeWidth={1.8} /></div>

              <div className="stat-info">
                <span>Total Sales (Paid)</span>
                <div className="stat-metric-row">
                  <h3>₱{allTimeSales.toFixed(2)}</h3>
                  <div
                    className="stat-profit-pill"
                    title={`COGS: ₱${allTimeCogs.toFixed(2)} • Margin: ${allTimeMarginPercent.toFixed(1)}%`}
                  >
                    <TrendingUp size={11} strokeWidth={2.4} />
                    <span className="profit-text">₱{allTimeProfit.toFixed(2)} profit</span>
                  </div>
                </div>
                <small>
                  {todaysPaidOrders.length
                    ? `₱${todaysSales.toFixed(2)} from ${todaysPaidOrders.length} paid today (₱${todaysProfit.toFixed(2)} profit)`
                    : "No paid sales recorded today"}
                </small>
              </div>
            </div>

            <div className="admin-stat-card stat-card-orders">
              <div className="stat-icon"><ShoppingBag size={21} strokeWidth={1.8} /></div>

              <div className="stat-info">
                <span>Products Sold</span>
                <h3>{allTimeUnitsSold} units</h3>
                <small>
                  {paidOrders.length
                    ? `Across ${paidOrders.length} orders (${todaysUnitsSold} units today)`
                    : "No sales transactions completed"}
                </small>
              </div>
            </div>

            <div className="admin-stat-card stat-card-pending">
              <div className="stat-icon"><Warehouse size={21} strokeWidth={1.8} /></div>

              <div className="stat-info">
                <span>Inventory Value</span>
                <h3>₱{inventoryAssetValue.toFixed(2)}</h3>
                <small>
                  {(inventory || []).length
                    ? `Asset value across ${inventory.length} ingredients`
                    : "No inventory stock recorded"}
                </small>
              </div>
            </div>

            <div className="admin-stat-card stat-card-products">
              <div className="stat-icon"><Coins size={21} strokeWidth={1.8} /></div>

              <div className="stat-info">
                <span>Cash Drawer / Float</span>
                <h3>Float Unset</h3>
                <small className="metric-note">
                  {todaysCashCollected > 0
                    ? `₱${todaysCashCollected.toFixed(2)} cash collected today`
                    : "Awaiting End-of-Day reconciliation"}
                </small>
              </div>
            </div>
          </section>


          
          <section className="admin-middle-grid">

            
            <div className="admin-panel sales-panel">

              <div className="panel-header sales-panel-header">

                <div>
                  <h3>Sales Overview</h3>
                  <p>Sales performance for {chartRangeLabel}</p>
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
                    <option value="week">Last 7 days</option>
                    <option value="month">Last 30 days</option>
                    <option value="year">This year</option>
                  </select>
                </div>

              </div>

              <div className="sales-chart">
                <div className="chart-bars" role="img" aria-label={`Sales total ₱${periodSales.toFixed(2)} for ${chartRangeLabel}`}>
                  {salesBuckets.map((bucket) => (
                    <div className="chart-column" key={`${salesRange}-${bucket.start.toISOString()}`}>
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


            
            <div className="admin-panel quick-panel">

              <div className="panel-header">
                <div>
                  <h3>Quick Actions</h3>
                  <p>Manage your business</p>
                </div>
              </div>

              <div className="quick-actions">

                <Link
                  to="/admin/menu"
                  className="quick-action"
                >
                  <span className="quick-icon"><Plus size={19} /></span>

                  <div>
                    <strong>Add Product</strong>
                    <span>Add a new menu item</span>
                  </div>

                  <span className="quick-arrow"><ArrowUpRight size={16} /></span>
                </Link>


                <Link
                  to="/admin/orders"
                  className="quick-action"
                >
                  <span className="quick-icon"><ReceiptText size={18} /></span>

                  <div>
                    <strong>View Orders</strong>
                    <span>Manage customer orders</span>
                  </div>

                  <span className="quick-arrow"><ArrowUpRight size={16} /></span>
                </Link>


                <Link
                  to="/admin/reports"
                  className="quick-action"
                >
                  <span className="quick-icon"><ChartNoAxesColumnIncreasing size={18} /></span>

                  <div>
                    <strong>View Reports</strong>
                    <span>Check sales reports</span>
                  </div>

                  <span className="quick-arrow"><ArrowUpRight size={16} /></span>
                </Link>

              </div>

            </div>

          </section>


          
          <section className="admin-bottom-grid">

            
            <div className="admin-panel orders-panel">

              <div className="panel-header">

                <div>
                  <h3>Recent Orders</h3>
                  <p>Latest customer orders</p>
                </div>

                <Link
                  to="/admin/orders"
                  className="view-all"
                >
                  View All →
                </Link>

              </div>

              <div className="orders-table-wrapper">

                <table className="admin-orders-table">

                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {orders.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="empty-orders-cell">
                          <div className="empty-orders-state">
                            <strong>No orders yet</strong>
                            <span>New customer orders will appear here.</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      orders.slice(0, 5).map((order) => (
                        <tr key={order.id}>
                          <td><strong>{order.id}</strong></td>
                          <td>{order.customer || "Walk-in Customer"}</td>
                          <td>₱{Number(order.total || 0).toFixed(2)}</td>
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

            </div>

          </section>

        </div>

      </main>

    </div>
  );
}

export default AdminDashboard;
