import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useTheme } from "../../context/ThemeContext.jsx";
import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";
import { getOrderTime, isToday, useOrders } from "../../context/OrdersContext.jsx";

import "../../assets/css/staff/staff-orders.css";
import "../../assets/css/sidebar-collapse.css";

function StaffOrder() {
  const { darkMode } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { orders, updateOrderStatus } = useOrders();
  const [activeFilter, setActiveFilter] = useState("All");
  const visibleOrders = useMemo(
    () => orders.filter((order) => activeFilter === "All" || order.status === activeFilter),
    [activeFilter, orders],
  );
  const todaysOrders = orders.filter((order) => isToday(order.createdAt));
  const pendingOrders = orders.filter((order) => order.status === "Pending");
  const preparingOrders = orders.filter((order) => order.status === "Preparing");
  const readyOrders = orders.filter((order) => order.status === "Ready");

  const advanceOrder = (order) => {
    const nextStatus = order.status === "Pending"
      ? "Preparing"
      : order.status === "Preparing"
        ? "Ready"
        : "Completed";
    updateOrderStatus(order.id, nextStatus);
  };

  return (
    <div className={`staff-orders-page ${darkMode ? "dark-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="staff-sidebar">
        <div className="staff-brand">
          <SidebarLogoButton logo={amayaLogo} alt="Amaya Logo" collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)} />
          <div><h2>Amaya</h2><span>Staff Portal</span></div>
        </div>

        <nav className="staff-nav">
          <div className="nav-label">MAIN MENU</div>
          <Link to="/staff" className="staff-nav-link"><span className="nav-icon">▦</span><span>Dashboard</span></Link>
          <Link to="/staff/orders" className="staff-nav-link active"><span className="nav-icon">▤</span><span>Orders</span><span className="nav-badge">{orders.length}</span></Link>
          <Link to="/staff/menu" className="staff-nav-link"><span className="nav-icon">☷</span><span>Menu</span></Link>
          <div className="nav-label nav-label-spaced">ACCOUNT</div>
          <Link to="/staff/settings" className="staff-nav-link"><span className="nav-icon">⚙</span><span>Settings</span></Link>
        </nav>

        <div className="sidebar-bottom">
          <Link to="/" className="back-to-site"><span className="nav-icon">←</span><span>Back to Website</span></Link>
          <Link to="/login" className="staff-logout"><span className="nav-icon">↪</span><span>Log Out</span></Link>
        </div>
      </aside>

      <main className="staff-orders-main">
        <header className="staff-orders-topbar">
          <div className="orders-topbar-left"><span className="orders-page-label">STAFF PORTAL</span><h1>Orders</h1></div>
          <div className="orders-topbar-right">
            <button type="button" className="orders-notification" aria-label="Notifications"><span>♢</span><i /></button>
            <div className="orders-user"><div className="orders-avatar">S</div><div className="orders-user-info"><strong>Staff</strong><span>Employee</span></div></div>
          </div>
        </header>

        <div className="orders-content">
          <section className="orders-page-header">
            <div><span className="orders-eyebrow">ORDER MANAGEMENT</span><h2>Customer Orders</h2><p>View and manage customer orders received by Amaya.</p></div>
            <div className="orders-summary"><div className="summary-number">{todaysOrders.length}</div><div className="summary-text"><strong>Today's Orders</strong><span>Total orders received</span></div></div>
          </section>

          <section className="order-stats">
            <OrderStat icon="≡" tone="total" label="Total Orders" value={todaysOrders.length} note="Today" />
            <OrderStat icon="◷" tone="pending" label="Pending" value={pendingOrders.length} note="Need attention" />
            <OrderStat icon="◌" tone="preparing" label="Preparing" value={preparingOrders.length} note="In progress" />
            <OrderStat icon="✓" tone="ready" label="Ready" value={readyOrders.length} note="For pickup" />
          </section>

          <section className="orders-card">
            <div className="orders-toolbar">
              <div><h3>All Orders</h3><p>Manage recent customer orders</p></div>
              <div className="order-filters">
                {["All", "Pending", "Preparing", "Ready", "Completed"].map((filter) => (
                  <button key={filter} type="button" className={`filter-button ${activeFilter === filter ? "active" : ""}`} onClick={() => setActiveFilter(filter)}>{filter}</button>
                ))}
              </div>
            </div>

            <div className="orders-table-wrapper">
              <table className="staff-orders-table">
                <thead><tr><th>ORDER</th><th>CUSTOMER</th><th>ITEMS</th><th>TOTAL</th><th>DATE</th><th>STATUS</th><th>ACTION</th></tr></thead>
                <tbody>
                  {visibleOrders.length ? visibleOrders.map((order) => (
                    <tr key={order.id}>
                      <td><strong>{order.id}</strong><span>{getOrderTime(order.createdAt)}</span></td>
                      <td>{order.customer}</td>
                      <td>{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
                      <td>₱{order.total.toFixed(2)}</td>
                      <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                      <td><span className={`order-status ${order.status.toLowerCase()}`}>{order.status}</span></td>
                      <td><button type="button" onClick={() => advanceOrder(order)}>{order.status === "Completed" ? "Done" : "Advance"}</button></td>
                    </tr>
                  )) : (
                    <tr><td colSpan="7" className="empty-orders"><div className="empty-orders-state"><strong>No orders yet</strong><span>New customer orders will appear here.</span></div></td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="orders-pagination"><span>Showing {visibleOrders.length} order{visibleOrders.length === 1 ? "" : "s"}</span><div className="pagination-buttons"><button type="button" disabled>←</button><button type="button" className="pagination-active">1</button><button type="button" disabled>→</button></div></div>
          </section>

          <div className="staff-order-notice"><div className="notice-icon">i</div><div><strong>Staff Order Permissions</strong><p>You can view orders and update their status. Product management and system settings are available only to administrators.</p></div></div>
        </div>
      </main>
    </div>
  );
}

function OrderStat({ icon, tone, label, value, note }) {
  return <div className="order-stat-card"><div className={`order-stat-icon ${tone}`}>{icon}</div><div className="order-stat-info"><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>;
}

export default StaffOrder;
