import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Sidebar from "../../components/Sidebar.jsx";
import PortalHero from "../../components/PortalHero.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import adminAvatar from "../../assets/images/icon/admin1.svg";
import { useSidebar } from "../../context/useSidebar.jsx";
import { isToday, useOrders } from "../../context/OrdersContext.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import "../../assets/css/admin/AdminDashboard.css";
import "../../assets/css/portal-hero.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

function AdminDashboard() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { orders } = useOrders();
  const { products } = useMenu();
  const [salesRange, setSalesRange] = useState("week");
  const todaysOrders = orders.filter((order) => isToday(order.createdAt));
  const todaysSales = todaysOrders.reduce((sum, order) => sum + order.total, 0);
  const pendingOrders = orders.filter((order) => order.status === "Pending");
  const lowStockProducts = products.filter((product) => Number(product.stock || 0) <= 5);
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

    return buckets.map((bucket) => ({
      ...bucket,
      total: orders.reduce((sum, order) => {
        const createdAt = new Date(order.createdAt);
        return createdAt >= bucket.start && createdAt < bucket.end ? sum + Number(order.total || 0) : sum;
      }, 0),
    }));
  }, [orders, salesRange]);
  const periodSales = salesBuckets.reduce((sum, bucket) => sum + bucket.total, 0);
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

            
            <div className="admin-stat-card">

              <div className="stat-icon">
                ₱
              </div>

              <div className="stat-info">
                <span>Total Sales</span>
                <h3>₱{todaysSales.toFixed(2)}</h3>
                <small>
                  {todaysOrders.length ? "Updated from today's orders" : "No sales recorded yet"}
                </small>
              </div>

            </div>


            
            <div className="admin-stat-card">

              <div className="stat-icon">
                ▤
              </div>

              <div className="stat-info">
                <span>Today's Orders</span>
                <h3>{todaysOrders.length}</h3>
                <small>
                  {todaysOrders.length ? "Orders recorded today" : "No orders yet"}
                </small>
              </div>

            </div>


            
            <div className="admin-stat-card">

              <div className="stat-icon">
                ◷
              </div>

              <div className="stat-info">
                <span>Pending Orders</span>
                <h3>{pendingOrders.length}</h3>
                <small>
                  {pendingOrders.length ? "Awaiting preparation" : "No pending orders"}
                </small>
              </div>

            </div>


            
            <div className="admin-stat-card">

              <div className="stat-icon">
                ☷
              </div>

              <div className="stat-info">
                <span>Total Products</span>
                <h3>{products.length}</h3>
                <small>
                  {lowStockProducts.length} low-stock items
                </small>
              </div>

            </div>

          </section>


          
          <section className="admin-middle-grid">

            
            <div className="admin-panel sales-panel">

              <div className="panel-header">

                <div>
                  <h3>Sales Overview</h3>
                  <p>Sales performance for {chartRangeLabel}</p>
                </div>

                <select
                  className="sales-filter"
                  value={salesRange}
                  onChange={(event) => setSalesRange(event.target.value)}
                >
                  <option value="week">
                    This Week
                  </option>

                  <option value="month">
                    This Month
                  </option>

                  <option value="year">
                    This Year
                  </option>
                </select>

              </div>

              <div className="sales-chart">
                <div className="chart-value">
                  ₱{periodSales.toFixed(2)}
                </div>

                <div className="chart-bars" role="img" aria-label={`Sales total ₱${periodSales.toFixed(2)} for ${chartRangeLabel}`}>
                  {salesBuckets.map((bucket) => (
                    <div className="chart-column" key={`${salesRange}-${bucket.start.toISOString()}`}>
                      <div className="chart-bar" title={`₱${bucket.total.toFixed(2)}`} style={{ height: `${Math.max(bucket.total > 0 ? 6 : 2, (bucket.total / chartMaximum) * 100)}%` }} />
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
                  <span className="quick-icon">
                    +
                  </span>

                  <div>
                    <strong>Add Product</strong>
                    <span>Add a new menu item</span>
                  </div>

                  <span className="quick-arrow">
                    →
                  </span>
                </Link>


                <Link
                  to="/admin/orders"
                  className="quick-action"
                >
                  <span className="quick-icon">
                    ▤
                  </span>

                  <div>
                    <strong>View Orders</strong>
                    <span>Manage customer orders</span>
                  </div>

                  <span className="quick-arrow">
                    →
                  </span>
                </Link>


                <Link
                  to="/admin/reports"
                  className="quick-action"
                >
                  <span className="quick-icon">
                    ▥
                  </span>

                  <div>
                    <strong>View Reports</strong>
                    <span>Check sales reports</span>
                  </div>

                  <span className="quick-arrow">
                    →
                  </span>
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
                    <tr>
                      <td colSpan="4" className="empty-orders-cell">
                        <div className="empty-orders-state">
                          <strong>No orders yet</strong>
                          <span>New customer orders will appear here.</span>
                        </div>
                      </td>
                    </tr>
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
