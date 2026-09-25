import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { getOrderTime, isToday, useOrders } from "../../context/OrdersContext.jsx";

import "../../assets/css/staff/staff-dashboard.css";
import "../../assets/css/sidebar-collapse.css";

function StaffDashboard() {
  const { darkMode } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { orders = [] } = useOrders() || {};

  // Formatted date and time-of-day greeting
  const liveDate = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  const greetingTime = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  // Real-time KPI calculations
  const todaysOrders = useMemo(() => orders.filter((order) => isToday(order.createdAt)), [orders]);
  const pendingOrders = useMemo(() => orders.filter((order) => order.status === "Pending"), [orders]);
  const preparingOrders = useMemo(() => orders.filter((order) => order.status === "Preparing"), [orders]);
  const completedToday = useMemo(() => todaysOrders.filter((order) => order.status === "Completed"), [todaysOrders]);
  const todaysRevenue = useMemo(() => todaysOrders.reduce((sum, order) => sum + Number(order.total || 0), 0), [todaysOrders]);

  const recentOrders = useMemo(() => orders.slice(0, 6), [orders]);

  return (
    <div className={`staff-dashboard ${darkMode ? "dark-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {/* Staff Sidebar Navigation */}
      <aside className="staff-sidebar">
        <div className="staff-brand">
          <SidebarLogoButton
            logo={amayaLogo}
            alt="Amaya Logo"
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
          />
          <div>
            <h2>Amaya</h2>
            <span>Staff Portal</span>
          </div>
        </div>

        <nav className="staff-nav">
          <div className="nav-label">MAIN MENU</div>

          <Link to="/staff" className="staff-nav-link active">
            <span className="nav-icon">▦</span>
            <span>Dashboard</span>
          </Link>

          <Link to="/staff/orders" className="staff-nav-link">
            <span className="nav-icon">▤</span>
            <span>Orders</span>
            <span className="nav-badge">{orders.length}</span>
          </Link>

          <Link to="/staff/menu" className="staff-nav-link">
            <span className="nav-icon">☷</span>
            <span>POS Menu</span>
          </Link>

          <div className="nav-label nav-label-spaced">SETTINGS & HARDWARE</div>

          <Link to="/staff/settings" className="staff-nav-link">
            <span className="nav-icon">⚙</span>
            <span>Settings</span>
          </Link>
        </nav>

        <div className="sidebar-bottom">
          <Link to="/" className="back-to-site">
            <span className="nav-icon">←</span>
            <span>Back to Website</span>
          </Link>

          <Link to="/login" className="staff-logout">
            <span className="nav-icon">↪</span>
            <span>Log Out</span>
          </Link>
        </div>
      </aside>

      {/* Main Staff Dashboard Body */}
      <main className="staff-main">
        <header className="staff-topbar">
          <div className="topbar-left">
            <div>
              <span className="page-label">STAFF PORTAL</span>
              <h1>Dashboard Overview</h1>
            </div>
          </div>

          <div className="topbar-right">
            <button
              type="button"
              className="notification-button"
              aria-label="Notifications"
            >
              <span>♢</span>
              {pendingOrders.length > 0 && <i />}
            </button>

            <div className="staff-user">
              <div className="staff-avatar">S</div>
              <div className="staff-user-info">
                <strong>Staff User</strong>
                <span>Barista & Cashier</span>
              </div>
            </div>
          </div>
        </header>

        <div className="dashboard-content">
          {/* Welcome & Shift Header */}
          <section className="welcome-section">
            <div>
              <p className="welcome-label">{greetingTime.toUpperCase()}, TEAM</p>
              <h2>{greetingTime}, Staff!</h2>
              <p>Here is what is currently happening at Amaya's Drinks & Bites today.</p>
            </div>

            <div className="today-date">
              <span>Today</span>
              <strong>{liveDate}</strong>
            </div>
          </section>

          {/* 4 KPI Metric Cards: Total Orders, Pending, Preparing, Completed Today */}
          <section className="stats-grid" aria-label="Quick metrics">
            {/* Total Orders Card */}
            <div className={`stat-card ${orders.length ? "" : "empty-stat-card"}`}>
              <div className="stat-card-top">
                <div className="stat-icon orders-icon">≡</div>
                <span className="stat-status">Today</span>
              </div>
              <div className="stat-info">
                <span>Total Orders Today</span>
                <h3>{todaysOrders.length}</h3>
              </div>
              <p className="stat-description">
                ₱{todaysRevenue.toFixed(2)} in today&apos;s revenue
              </p>
            </div>

            {/* Pending Orders Card */}
            <div className={`stat-card ${pendingOrders.length ? "" : "empty-stat-card"}`}>
              <div className="stat-card-top">
                <div className="stat-icon" style={{ background: "#fff3dc", color: "#b87923" }}>◷</div>
                <span className="stat-status pending">Action Needed</span>
              </div>
              <div className="stat-info">
                <span>Pending Orders</span>
                <h3>{pendingOrders.length}</h3>
              </div>
              <p className="stat-description">
                {pendingOrders.length ? "Orders queued for preparation" : "All orders acknowledged"}
              </p>
            </div>

            {/* Preparing Orders Card */}
            <div className={`stat-card ${preparingOrders.length ? "" : "empty-stat-card"}`}>
              <div className="stat-card-top">
                <div className="stat-icon" style={{ background: "#e8f1f8", color: "#497697" }}>◌</div>
                <span className="stat-status preparing">In Kitchen</span>
              </div>
              <div className="stat-info">
                <span>Preparing</span>
                <h3>{preparingOrders.length}</h3>
              </div>
              <p className="stat-description">
                {preparingOrders.length ? "Drinks & snacks in progress" : "No orders currently preparing"}
              </p>
            </div>

            {/* Completed Today Card */}
            <div className={`stat-card ${completedToday.length ? "" : "empty-stat-card"}`}>
              <div className="stat-card-top">
                <div className="stat-icon" style={{ background: "#e7f4ea", color: "#4a8457" }}>✓</div>
                <span className="stat-status completed">Fulfilled</span>
              </div>
              <div className="stat-info">
                <span>Completed Today</span>
                <h3>{completedToday.length}</h3>
              </div>
              <p className="stat-description">
                {completedToday.length ? `${completedToday.length} orders served & picked up` : "No completed orders yet today"}
              </p>
            </div>
          </section>

          {/* Main Dashboard Grid: Recent Orders & Quick POS Actions */}
          <section className="dashboard-grid">
            {/* Recent Orders Card */}
            <div className="dashboard-card orders-card">
              <div className="card-header">
                <div>
                  <h3>Recent Counter Orders</h3>
                  <p>Latest customer transactions received</p>
                </div>

                <Link to="/staff/orders" className="view-all">
                  View All Orders
                  <span>→</span>
                </Link>
              </div>

              <div className="orders-table-wrapper">
                <table className="orders-table">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Customer</th>
                      <th>Items</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {recentOrders.length ? (
                      recentOrders.map((order) => {
                        const itemCount = order.items
                          ? order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
                          : 0;

                        return (
                          <tr key={order.id}>
                            <td>
                              <strong>{order.id}</strong>
                              <span>{getOrderTime(order.createdAt)}</span>
                            </td>
                            <td>
                              <strong>{order.customer}</strong>
                              <small style={{ display: "block", color: "#8a7c73", fontSize: "10px" }}>
                                {order.type || "Counter"}
                              </small>
                            </td>
                            <td>{itemCount} item{itemCount === 1 ? "" : "s"}</td>
                            <td><strong>₱{Number(order.total || 0).toFixed(2)}</strong></td>
                            <td>
                              <span className={`order-status ${order.status.toLowerCase()}`}>
                                {order.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="5" className="empty-orders-cell">
                          <div className="empty-orders-state">
                            <strong>No orders yet</strong>
                            <span>New customer orders will appear here as they are processed.</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Quick Actions Card */}
            <div className="dashboard-card quick-card">
              <div className="card-header">
                <div>
                  <h3>Quick POS Actions</h3>
                  <p>Frequent staff counter tasks</p>
                </div>
              </div>

              <div className="quick-actions">
                <Link to="/staff/menu" className="quick-action">
                  <div className="quick-action-icon" style={{ background: "rgba(139, 94, 60, 0.15)", color: "#8b5e3c" }}>
                    +
                  </div>
                  <div>
                    <strong>New POS Order</strong>
                    <span>Open menu & build a customer order</span>
                  </div>
                  <span className="action-arrow">→</span>
                </Link>

                <Link to="/staff/orders" className="quick-action">
                  <div className="quick-action-icon">
                    ▤
                  </div>
                  <div>
                    <strong>Manage Order Queue</strong>
                    <span>Advance statuses & print receipts</span>
                  </div>
                  <span className="action-arrow">→</span>
                </Link>

                <Link to="/staff/settings" className="quick-action">
                  <div className="quick-action-icon">
                    ⚙
                  </div>
                  <div>
                    <strong>Printer & Settings</strong>
                    <span>Setup receipt printer & preferences</span>
                  </div>
                  <span className="action-arrow">→</span>
                </Link>
              </div>
            </div>
          </section>

          {/* Today's Live Activity Stream */}
          <section className="dashboard-card activity-card">
            <div className="card-header">
              <div>
                <h3>Today&apos;s Live Activity</h3>
                <p>Real-time audit log of recent staff portal transactions</p>
              </div>
            </div>

            <div className="activity-list">
              {todaysOrders.length ? (
                todaysOrders.slice(0, 5).map((order) => {
                  const itemCount = order.items
                    ? order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
                    : 0;

                  return (
                    <div className="activity-item" key={`activity-${order.id}`}>
                      <div className="activity-dot"></div>
                      <div className="activity-content">
                        <strong>Order #{order.id} for {order.customer} ({order.status})</strong>
                        <span>
                          {itemCount} item(s) · ₱{Number(order.total || 0).toFixed(2)} · Placed at {getOrderTime(order.createdAt)} · Type: {order.type || "Counter"}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="activity-item empty-activity">
                  <div className="activity-dot"></div>
                  <div className="activity-content">
                    <strong>No transactions yet today</strong>
                    <span>Activity events will log here automatically when orders are created or updated.</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default StaffDashboard;