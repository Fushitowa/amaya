import { useState } from "react";
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
  const { orders } = useOrders();
  const liveDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const todaysOrders = orders.filter((order) => isToday(order.createdAt));
  const todaysRevenue = todaysOrders.reduce((sum, order) => sum + order.total, 0);
  const recentOrders = orders.slice(0, 5);

  return (
    <div className={`staff-dashboard ${darkMode ? "dark-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>

      
      <aside className="staff-sidebar">

        <div className="staff-brand">
          <SidebarLogoButton logo={amayaLogo} alt="Amaya Logo" collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)} />
          <div>
            <h2>Amaya</h2>
            <span>Staff Portal</span>
          </div>
        </div>

        <nav className="staff-nav">

          <div className="nav-label">
            MAIN MENU
          </div>

          <Link to="/staff" className="staff-nav-link active">
            <span className="nav-icon">▦</span>
            <span>Dashboard</span>
          </Link>

          <Link to="/staff/orders" className="staff-nav-link">
            <span className="nav-icon">▤</span>
            <span>Orders</span>
          </Link>

          <Link to="/staff/menu" className="staff-nav-link">
            <span className="nav-icon">☷</span>
            <span>Menu</span>
          </Link>

          <div className="nav-label nav-label-spaced">
            ACCOUNT
          </div>

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

      
      <main className="staff-main">

        
        <header className="staff-topbar">

          <div className="topbar-left">
            <div>
              <span className="page-label">
                STAFF PORTAL
              </span>

              <h1>
                Dashboard
              </h1>
            </div>
          </div>

          <div className="topbar-right">

            <button
              type="button"
              className="notification-button"
              aria-label="Notifications"
            >
              <span>♢</span>
              <i></i>
            </button>

            <div className="staff-user">

              <div className="staff-avatar">
                S
              </div>

              <div className="staff-user-info">
                <strong>Staff</strong>
                <span>Employee</span>
              </div>

            </div>

          </div>

        </header>

        
        <div className="dashboard-content">

          
          <section className="welcome-section">

            <div>
              <p className="welcome-label">
                GOOD DAY
              </p>

              <h2>
                Welcome back, Staff!
              </h2>

              <p>
                Here's what's happening at Amaya today.
              </p>
            </div>

            <div className="today-date">
              <span>Today</span>
              <strong>{liveDate}</strong>
            </div>

          </section>

          
          <section className="stats-grid">

            <div className={`stat-card ${todaysOrders.length ? "" : "empty-stat-card"}`}>
              <div className="stat-card-top">
                <div className="stat-icon orders-icon">
                  ≡
                </div>

                <span className="stat-status">
                  Today
                </span>
              </div>

              <div className="stat-info">
                <span>{todaysOrders.length ? "Orders today" : "No orders"}</span>
                <h3>{todaysOrders.length}</h3>
              </div>

              <p className="stat-description">
                {todaysOrders.length ? `₱${todaysRevenue.toFixed(2)} in revenue` : "Orders will appear here when received"}
              </p>
            </div>

          </section>

          
          <section className="dashboard-grid">

            
            <div className="dashboard-card orders-card">

              <div className="card-header">

                <div>
                  <h3>Recent Orders</h3>
                  <p>Latest customer orders</p>
                </div>

                <Link to="/staff/orders" className="view-all">
                  View All
                  <span>→</span>
                </Link>

              </div>

              <div className="orders-table-wrapper">

                <table className="orders-table">

                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Items</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {recentOrders.length ? recentOrders.map((order) => (
                      <tr key={order.id}>
                        <td><strong>{order.id}</strong><span>{getOrderTime(order.createdAt)}</span></td>
                        <td>{order.customer}</td>
                        <td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
                        <td>₱{order.total.toFixed(2)}</td>
                        <td><span className={`order-status ${order.status.toLowerCase()}`}>{order.status}</span></td>
                      </tr>
                    )) : (
                      <tr><td colSpan="5" className="empty-orders-cell"><div className="empty-orders-state"><strong>No orders yet</strong><span>New customer orders will appear here.</span></div></td></tr>
                    )}
                  </tbody>

                </table>

              </div>

            </div>

            
            <div className="dashboard-card quick-card">

              <div className="card-header">

                <div>
                  <h3>Quick Actions</h3>
                  <p>Common staff tasks</p>
                </div>

              </div>

              <div className="quick-actions">

                <Link
                  to="/staff/orders"
                  className="quick-action"
                >
                  <div className="quick-action-icon">
                    ≡
                  </div>

                  <div>
                    <strong>Manage Orders</strong>
                    <span>View and update orders</span>
                  </div>

                  <span className="action-arrow">
                    →
                  </span>
                </Link>

                <Link
                  to="/staff/menu"
                  className="quick-action"
                >
                  <div className="quick-action-icon">
                    ☷
                  </div>

                  <div>
                    <strong>View Menu</strong>
                    <span>Check available products</span>
                  </div>

                  <span className="action-arrow">
                    →
                  </span>
                </Link>

              </div>

            </div>

          </section>

          
          <section className="dashboard-card activity-card">

            <div className="card-header">

              <div>
                <h3>Today's Activity</h3>
                <p>Recent activity from the staff portal</p>
              </div>

            </div>

            <div className="activity-list">
              {todaysOrders.length ? todaysOrders.slice(0, 4).map((order) => (
                <div className="activity-item" key={`activity-${order.id}`}>
                  <div className="activity-dot"></div>
                  <div className="activity-content">
                    <strong>Order {order.id} received</strong>
                    <span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} item(s) · ₱{order.total.toFixed(2)} · {getOrderTime(order.createdAt)}</span>
                  </div>
                </div>
              )) : (
                <div className="activity-item empty-activity"><div className="activity-dot"></div><div className="activity-content"><strong>No recent activity</strong><span>New staff actions will appear here.</span></div></div>
              )}
            </div>

          </section>

        </div>

      </main>

    </div>
  );
}

export default StaffDashboard;