import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Package,
  Plus,
  Clock,
  Menu,
  Settings,
  ShoppingBag,
  Utensils,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import StaffNotificationBell from "../../components/StaffNotificationBell.jsx";
import StaffOperationsBar from "../../components/StaffOperationsBar.jsx";
import OrderDetailsModal from "../../components/OrderDetailsModal.jsx";
import staffAvatar from "../../assets/images/icon/staff1.svg";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import { getOrderTime, isOrderPaid, isToday, useOrders } from "../../context/OrdersContext.jsx";

import "../../assets/css/staff/staff-dashboard.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

function StaffDashboard() {
  const navigate = useNavigate();
  const { darkMode } = useTheme();
  const { user } = useAuth() || {};
  const cashierName = user?.displayName || "Cashier";
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { orders = [], confirmOrder, revertOrderItem } = useOrders() || {};
  const { products = [] } = useMenu() || {};
  const [selectedOrder, setSelectedOrder] = useState(null);
  const modalTriggerRef = useRef(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const productImageByName = useMemo(() => {
    const map = new Map();
    products.forEach((product) => {
      if (product?.name && product?.image) map.set(product.name, product.image);
    });
    return map;
  }, [products]);

  const openOrderDetails = (order, event) => {
    modalTriggerRef.current = event?.currentTarget || null;
    setSelectedOrder(order);
  };
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const sync = () => setIsMobile(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

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
  const todaysRevenue = useMemo(
    () => todaysOrders.filter((order) => isOrderPaid(order)).reduce((sum, order) => sum + Number(order.total || 0), 0),
    [todaysOrders],
  );

  const recentOrders = useMemo(() => orders.slice(0, 15), [orders]);

  if (isMobile) {
    const kpis = [
      { label: "Today", value: todaysOrders.length, Icon: ShoppingBag, tone: "amber" },
      { label: "Pending", value: pendingOrders.length, Icon: Clock, tone: "red" },
      { label: "Preparing", value: preparingOrders.length, Icon: Utensils, tone: "blue" },
      { label: "Completed", value: completedToday.length, Icon: CheckCircle2, tone: "green" },
    ];
    const actions = [
      { to: "/staff/orders", label: "Order queue", note: "Advance statuses and print receipts", Icon: ClipboardList },
      { to: "/staff/menu", label: "Menu", note: "Browse items and stock", Icon: Package },
      { to: "/staff/settings", label: "Printer & settings", note: "Receipt printer and preferences", Icon: Settings },
    ];

    return (
      <div className={`staff-dashboard is-mobile ${darkMode ? "dark-mode" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
        {mobileNavOpen && <div className="sd-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />}
        <Sidebar
          role="staff"
          activeTab="dashboard"
          orderCount={pendingOrders.length}
          sidebarCollapsed={false}
          onToggle={() => setMobileNavOpen(false)}
        />

        <main className="sd-main">
          <header className="sd-appbar">
            <button type="button" className="sd-icon-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu">
              <Menu size={24} />
            </button>
            <div className="sd-appbar-title">
              <span>{greetingTime}</span>
              <h1>Staff Dashboard</h1>
            </div>
            <StaffNotificationBell />
          </header>

          <div className="sd-ops-strip">
            <StaffOperationsBar variant="compact" darkMode={darkMode} />
          </div>

          <section className="sd-hero" aria-label="Today's revenue">
            <span className="sd-hero-date">{liveDate}</span>
            <span className="sd-hero-label">Today&apos;s revenue</span>
            <strong className="sd-hero-amount">₱{todaysRevenue.toFixed(2)}</strong>
            <span className="sd-hero-sub">
              <i aria-hidden="true" />
              Terminal active · {todaysOrders.length} order{todaysOrders.length === 1 ? "" : "s"} today
            </span>
          </section>

          <section className="sd-kpis" aria-label="Quick metrics">
            {kpis.map(({ label, value, Icon, tone }) => (
              <Link to="/staff/orders" key={label} className={`sd-kpi ${tone}`}>
                <span className="sd-kpi-icon"><Icon size={20} aria-hidden="true" /></span>
                <strong>{value}</strong>
                <span>{label}</span>
              </Link>
            ))}
          </section>

          <h2 className="sd-section">Shortcuts</h2>
          <nav className="sd-actions" aria-label="Quick actions">
            {actions.map(({ to, label, note, Icon }) => (
              <Link to={to} key={to} className="sd-action">
                <span className="sd-action-icon"><Icon size={22} aria-hidden="true" /></span>
                <span className="sd-action-text"><strong>{label}</strong><small>{note}</small></span>
                <ArrowRight size={20} aria-hidden="true" />
              </Link>
            ))}
          </nav>

          <div className="sd-section-row">
            <h2 className="sd-section">Recent orders</h2>
            <Link to="/staff/orders">See all</Link>
          </div>
          <ul className="sd-recent">
            {orders.length ? orders.slice(0, 20).map((order) => {
              const itemCount = (order.items || []).reduce((n, i) => n + Number(i.quantity || 0), 0);
              return (
                <li key={order.id}>
                  <Link to="/staff/orders" className="sd-recent-row">
                    <span className={`sd-dot ${String(order.status).toLowerCase()}`} aria-hidden="true" />
                    <span className="sd-recent-text">
                      <strong>#{order.id}</strong>
                      <small>{itemCount} item{itemCount === 1 ? "" : "s"} · {order.type || "Counter"} · {getOrderTime(order.createdAt)}</small>
                    </span>
                    <span className="sd-recent-end">
                      <b>₱{Number(order.total || 0).toFixed(2)}</b>
                      <em className={String(order.status).toLowerCase()}>{order.status}</em>
                    </span>
                  </Link>
                </li>
              );
            }) : (
              <li className="sd-empty">
                <ClipboardList size={32} aria-hidden="true" />
                <strong>No orders yet</strong>
                <span>New customer orders will appear here.</span>
              </li>
            )}
          </ul>
        </main>

        <Link to="/staff/menu" className="sd-fab">
          <Plus size={22} strokeWidth={2.6} aria-hidden="true" />
          New order
        </Link>
      </div>
    );
  }

  return (
    <div className={`staff-dashboard ${darkMode ? "dark-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {/* Staff Sidebar Navigation */}
      <Sidebar
        role="staff"
        activeTab="dashboard"
        orderCount={pendingOrders.length}
        sidebarCollapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />

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
            <StaffOperationsBar variant="compact" darkMode={darkMode} />
            <StaffNotificationBell />

            <div className="staff-user">
              <div className="amaya-user-avatar">
                <img src={staffAvatar} alt="" aria-hidden="true" className="tinted" />
              </div>
              <div className="staff-user-info">
                <strong>{cashierName}</strong>
                <span>Barista & Cashier</span>
              </div>
            </div>
          </div>
        </header>

        <div className="dashboard-content">
          {/* Recent Orders Card (Left Adjustable Panel) */}
          <section className="dashboard-card orders-card" aria-label="Recent counter orders">
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

            {/* Separate Fixed Header Bar */}
            <div className="orders-bar-head" aria-hidden="true">
              <span>Order ID</span>
              <span>Customer</span>
              <span>Items</span>
              <span>Total</span>
              <span>Status</span>
            </div>

            {/* Separate Scrollable Order Bars */}
            <div className="orders-table" role="list" aria-label="Recent counter orders">
              {recentOrders.length ? (
                recentOrders.map((order) => {
                  const itemCount = order.items
                    ? order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
                    : 0;

                  return (
                    <article
                      className="orders-bar-row"
                      role="button"
                      tabIndex={0}
                      key={order.id}
                      title="Click to inspect order details, ingredients used, and payment method"
                      onClick={(e) => openOrderDetails(order, e)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openOrderDetails(order, e);
                        }
                      }}
                    >
                      <div className="orders-bar-cell orders-bar-id">
                        <strong>{order.id}</strong>
                        <span>{getOrderTime(order.createdAt)}</span>
                      </div>
                      <div className="orders-bar-cell orders-bar-customer">
                        <strong>{order.customer || "Walk-in Customer"}</strong>
                        <small>{order.type || "Counter"}</small>
                      </div>
                      <div className="orders-bar-cell orders-bar-items">
                        {itemCount} item{itemCount === 1 ? "" : "s"}
                      </div>
                      <div className="orders-bar-cell orders-bar-total">
                        <strong>₱{Number(order.total || 0).toFixed(2)}</strong>
                      </div>
                      <div className="orders-bar-cell orders-bar-status">
                        <span className={`order-status ${order.status.toLowerCase()}`}>
                          {order.status}
                        </span>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="empty-orders-state">
                  <strong>No orders yet</strong>
                  <span>New customer orders will appear here as they are processed.</span>
                </div>
              )}
            </div>
          </section>

          {/* 4 KPI Metric Cards (Right Vertical Rail) */}
          <aside className="stats-grid" aria-label="Quick metrics">
            <div className={`stat-card ${todaysOrders.length ? "" : "empty-stat-card"}`}>
              <div className="stat-card-top">
                <span className="stat-icon stat-icon-amber">
                  <ShoppingBag size={17} strokeWidth={2} />
                </span>
                <span className="stat-status stat-status-today">Today</span>
              </div>
              <div className="stat-info">
                <span>Total Orders Today</span>
                <h3>{todaysOrders.length}</h3>
              </div>
              <p className="stat-description">
                ₱{todaysRevenue.toFixed(2)} in today&apos;s revenue
              </p>
            </div>

            <div className={`stat-card ${pendingOrders.length ? "" : "empty-stat-card"}`}>
              <div className="stat-card-top">
                <span className="stat-icon stat-icon-amber">
                  <ClipboardList size={17} strokeWidth={2} />
                </span>
                <span className="stat-status stat-status-pending">Action needed</span>
              </div>
              <div className="stat-info">
                <span>Pending Orders</span>
                <h3>{pendingOrders.length}</h3>
              </div>
              <p className="stat-description">
                {pendingOrders.length ? "Orders queued for preparation" : "All orders acknowledged"}
              </p>
            </div>

            <div className={`stat-card ${preparingOrders.length ? "" : "empty-stat-card"}`}>
              <div className="stat-card-top">
                <span className="stat-icon stat-icon-blue">
                  <Package size={17} strokeWidth={2} />
                </span>
                <span className="stat-status stat-status-preparing">In kitchen</span>
              </div>
              <div className="stat-info">
                <span>Preparing</span>
                <h3>{preparingOrders.length}</h3>
              </div>
              <p className="stat-description">
                {preparingOrders.length ? "Drinks & snacks in progress" : "No orders currently preparing"}
              </p>
            </div>

            <div className={`stat-card ${completedToday.length ? "" : "empty-stat-card"}`}>
              <div className="stat-card-top">
                <span className="stat-icon stat-icon-green">
                  <CheckCircle2 size={17} strokeWidth={2} />
                </span>
                <span className="stat-status stat-status-completed">Fulfilled</span>
              </div>
              <div className="stat-info">
                <span>Completed Today</span>
                <h3>{completedToday.length}</h3>
              </div>
              <p className="stat-description">
                {completedToday.length
                  ? `${completedToday.length} orders served & picked up`
                  : "No completed orders yet today"}
              </p>
            </div>
          </aside>
        </div>
      </main>

      {selectedOrder && (
        <OrderDetailsModal
          key={selectedOrder.id}
          order={selectedOrder}
          portal="staff"
          darkMode={darkMode}
          productImageByName={productImageByName}
          canVoid={false}
          canViewCostBreakdown={false}
          triggerRef={modalTriggerRef}
          onConfirmOrder={async (ord) => {
            const updated = await confirmOrder?.(ord?.id ?? ord);
            if (updated) {
              setSelectedOrder(updated);
            }
            return updated;
          }}
          onRevertOrderItem={async (orderNumber, itemId, payload) => {
            const updated = await revertOrderItem?.(orderNumber, itemId, payload);
            if (updated) {
              setSelectedOrder(updated);
            }
            return updated;
          }}
          onPrintReceipt={(ord) => navigate("/staff/receipt", { state: { order: ord } })}
          onClosed={() => setSelectedOrder(null)}
        />
      )}
    </div>
  );
}

export default StaffDashboard;