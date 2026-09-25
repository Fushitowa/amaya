import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useTheme } from "../../context/ThemeContext.jsx";
import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";
import { getOrderTime, useOrders } from "../../context/OrdersContext.jsx";
import { useBusiness, defaultBusinessSettings } from "../../context/BusinessContext.jsx";

import "../../assets/css/staff/staff-orders.css";
import "../../assets/css/sidebar-collapse.css";

const statusFilterList = ["All", "Pending", "Preparing", "Ready", "Completed"];

function StaffOrder() {
  const { darkMode } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { orders = [], updateOrderStatus, deleteOrder, resetOrders } = useOrders() || {};
  const { businessSettings } = useBusiness() || {};
  const business = businessSettings || defaultBusinessSettings;

  const [activeFilter, setActiveFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [orderToDelete, setOrderToDelete] = useState(null);
  const [orderToPrint, setOrderToPrint] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Dynamic summary metrics calculated directly from state
  const totalOrdersCount = orders.length;
  const pendingCount = useMemo(() => orders.filter((o) => o.status === "Pending").length, [orders]);
  const preparingCount = useMemo(() => orders.filter((o) => o.status === "Preparing").length, [orders]);
  const readyCount = useMemo(() => orders.filter((o) => o.status === "Ready").length, [orders]);
  const completedCount = useMemo(() => orders.filter((o) => o.status === "Completed").length, [orders]);

  // Filter & Search visible orders
  const visibleOrders = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return orders.filter((order) => {
      const matchesFilter = activeFilter === "All" || order.status === activeFilter;
      if (!matchesFilter) return false;
      if (!query) return true;

      const orderId = (order.id || "").toLowerCase();
      const customer = (order.customer || "").toLowerCase();
      const items = (order.items || []).map((item) => item.title.toLowerCase()).join(" ");
      return orderId.includes(query) || customer.includes(query) || items.includes(query);
    });
  }, [activeFilter, orders, searchQuery]);

  // Toast timer cleanup
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Close modals on Escape key
  useEffect(() => {
    if (!orderToDelete && !orderToPrint) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setOrderToDelete(null);
        setOrderToPrint(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [orderToDelete, orderToPrint]);

  const handleStatusChange = (orderId, newStatus) => {
    if (updateOrderStatus) {
      updateOrderStatus(orderId, newStatus);
      setToastMessage(`Order ${orderId} updated to "${newStatus}"`);
    }
  };

  const handleConfirmDelete = () => {
    if (!orderToDelete) return;
    const id = orderToDelete.id;
    if (deleteOrder) {
      deleteOrder(id);
      setToastMessage(`Order ${id} deleted successfully`);
    }
    setOrderToDelete(null);
  };

  const handleResetOrders = () => {
    if (resetOrders) {
      resetOrders();
      setToastMessage("Demo orders restored");
    }
  };

  return (
    <div className={`staff-orders-page ${darkMode ? "dark-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
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
          <Link to="/staff" className="staff-nav-link">
            <span className="nav-icon">▦</span>
            <span>Dashboard</span>
          </Link>
          <Link to="/staff/orders" className="staff-nav-link active">
            <span className="nav-icon">▤</span>
            <span>Orders</span>
            <span className="nav-badge">{totalOrdersCount}</span>
          </Link>
          <Link to="/staff/menu" className="staff-nav-link">
            <span className="nav-icon">☷</span>
            <span>Menu</span>
          </Link>
          <div className="nav-label nav-label-spaced">ACCOUNT</div>
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

      <main className="staff-orders-main">
        <header className="staff-orders-topbar">
          <div className="orders-topbar-left">
            <span className="orders-page-label">STAFF PORTAL</span>
            <h1>Orders</h1>
          </div>
          <div className="orders-topbar-right">
            <button type="button" className="orders-notification" aria-label="Notifications">
              <span>♢</span>
              <i />
            </button>
            <div className="orders-user">
              <div className="orders-avatar">S</div>
              <div className="orders-user-info">
                <strong>Staff</strong>
                <span>Employee</span>
              </div>
            </div>
          </div>
        </header>

        <div className="orders-content">
          <section className="orders-page-header">
            <div>
              <span className="orders-eyebrow">ORDER MANAGEMENT</span>
              <h2>Customer Orders</h2>
              <p>View, update order statuses, and manage customer orders received by Amaya.</p>
            </div>
            <div className="orders-summary">
              <div className="summary-number">{totalOrdersCount}</div>
              <div className="summary-text">
                <strong>Active Orders</strong>
                <span>Currently in system</span>
              </div>
            </div>
          </section>

          {/* Top Summary Cards with dynamic metrics */}
          <section className="order-stats">
            <OrderStat
              icon="≡"
              tone="total"
              label="Total Orders"
              value={totalOrdersCount}
              note="All active"
            />
            <OrderStat
              icon="◷"
              tone="pending"
              label="Pending"
              value={pendingCount}
              note="Need attention"
            />
            <OrderStat
              icon="◌"
              tone="preparing"
              label="Preparing"
              value={preparingCount}
              note="In progress"
            />
            <OrderStat
              icon="✓"
              tone="ready"
              label="Ready"
              value={readyCount}
              note="For pickup"
            />
          </section>

          <section className="orders-card">
            <div className="orders-toolbar">
              <div>
                <h3>All Orders</h3>
                <p>Manage and process current customer orders</p>
              </div>

              {/* Quick Search */}
              <div className="orders-toolbar-search">
                <span className="orders-search-icon">🔍</span>
                <input
                  type="text"
                  placeholder="Search by order ID, customer, item..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="orders-search-input"
                  aria-label="Search orders"
                />
              </div>

              {/* Status Filters with Dynamic Counts */}
              <div className="order-filters">
                {statusFilterList.map((filter) => {
                  let count = totalOrdersCount;
                  if (filter === "Pending") count = pendingCount;
                  if (filter === "Preparing") count = preparingCount;
                  if (filter === "Ready") count = readyCount;
                  if (filter === "Completed") count = completedCount;

                  return (
                    <button
                      key={filter}
                      type="button"
                      className={`filter-button ${activeFilter === filter ? "active" : ""}`}
                      onClick={() => setActiveFilter(filter)}
                    >
                      {filter}
                      <span className="filter-count">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="orders-table-wrapper">
              <table className="staff-orders-table">
                <thead>
                  <tr>
                    <th>ORDER</th>
                    <th>CUSTOMER</th>
                    <th>ITEMS</th>
                    <th>TOTAL</th>
                    <th>DATE</th>
                    <th>STATUS</th>
                    <th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.length ? (
                    visibleOrders.map((order) => {
                      const itemCount = order.items
                        ? order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
                        : 0;
                      const itemsSummary = order.items
                        ? order.items.map((i) => `${i.quantity}x ${i.title}`).join(", ")
                        : "";

                      return (
                        <tr key={order.id}>
                          <td>
                            <strong className="order-number">{order.id}</strong>
                            <span className="order-time" style={{ display: "block", fontSize: "10px", color: "#8a7c73" }}>
                              {getOrderTime(order.createdAt)}
                            </span>
                          </td>
                          <td>
                            <div className="customer-info">
                              <div className="customer-avatar">
                                {order.customer ? order.customer.charAt(0).toUpperCase() : "C"}
                              </div>
                              <div>
                                <strong>{order.customer}</strong>
                                <span>{order.type || "Counter"}</span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="items-count" title={itemsSummary}>
                              {itemCount} item{itemCount === 1 ? "" : "s"}
                            </span>
                          </td>
                          <td>
                            <strong className="order-total">₱{Number(order.total || 0).toFixed(2)}</strong>
                          </td>
                          <td>
                            <div className="order-date">
                              <strong>
                                {new Date(order.createdAt).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </strong>
                            </div>
                          </td>
                          <td>
                            <span className={`order-status ${order.status.toLowerCase()}`}>
                              {order.status}
                            </span>
                          </td>
                          <td>
                            <div className="order-actions-cell">
                              {/* Requirement 1: Status Dropdown / Select control */}
                              <div className="order-status-select-wrap">
                                <select
                                  value={order.status}
                                  onChange={(e) => handleStatusChange(order.id, e.target.value)}
                                  className={`order-status-select select-${order.status.toLowerCase()}`}
                                  aria-label={`Update status for ${order.id}`}
                                >
                                  <option value="Pending">Pending</option>
                                  <option value="Preparing">Preparing</option>
                                  <option value="Ready">Ready</option>
                                  <option value="Completed">Completed</option>
                                </select>
                              </div>

                              {/* Print Receipt Button */}
                              <button
                                type="button"
                                className="order-print-btn"
                                onClick={() => setOrderToPrint(order)}
                                title={`Print receipt for ${order.id}`}
                                aria-label={`Print receipt for ${order.id}`}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="6 9 6 2 18 2 18 9" />
                                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                                  <rect x="6" y="14" width="12" height="8" />
                                </svg>
                                <span>Print</span>
                              </button>

                              {/* Requirement 2: Delete Order Button */}
                              <button
                                type="button"
                                className="order-delete-btn"
                                onClick={() => setOrderToDelete(order)}
                                title={`Delete order ${order.id}`}
                                aria-label={`Delete order ${order.id}`}
                              >
                                <svg
                                  width="13"
                                  height="13"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  <line x1="10" y1="11" x2="10" y2="17" />
                                  <line x1="14" y1="11" x2="14" y2="17" />
                                </svg>
                                <span>Delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="7" className="empty-orders">
                        <div className="empty-orders-state">
                          <strong>No orders found</strong>
                          <span>
                            {searchQuery
                              ? `No orders matching "${searchQuery}" in ${activeFilter} filter.`
                              : "No orders available under this category."}
                          </span>
                          {orders.length === 0 && (
                            <button
                              type="button"
                              className="btn-reset-demo"
                              onClick={handleResetOrders}
                            >
                              Restore Demo Orders
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="orders-pagination">
              <span>
                Showing {visibleOrders.length} of {totalOrdersCount} order{totalOrdersCount === 1 ? "" : "s"}
              </span>
              <div className="pagination-buttons">
                <button type="button" disabled>←</button>
                <button type="button" className="pagination-active">1</button>
                <button type="button" disabled>→</button>
              </div>
            </div>
          </section>

          <div className="staff-order-notice">
            <div className="notice-icon">i</div>
            <div>
              <strong>Staff Order Controls</strong>
              <p>
                Use the status selector to advance orders across Pending, Preparing, Ready, and Completed. Use the Delete button to remove cancelled or mistaken orders.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Requirement 2: Delete Order Confirmation Modal */}
      {orderToDelete && (
        <div
          className="order-modal-backdrop"
          onClick={() => setOrderToDelete(null)}
          role="presentation"
        >
          <div
            className="order-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
          >
            <div className="order-modal-header">
              <div className="modal-danger-icon" aria-hidden="true">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div>
                <h3 id="delete-modal-title">Delete Order</h3>
                <p className="modal-header-subtitle">Confirm order deletion</p>
              </div>
              <button
                type="button"
                className="modal-close-button"
                onClick={() => setOrderToDelete(null)}
                aria-label="Close dialog"
              >
                ×
              </button>
            </div>

            <div className="order-modal-body">
              <p className="modal-confirm-question">
                Are you sure you want to delete order <strong>#{orderToDelete.id}</strong>?
              </p>

              <div className="modal-order-summary">
                <div className="summary-row">
                  <span>Customer:</span>
                  <strong>{orderToDelete.customer}</strong>
                </div>
                <div className="summary-row">
                  <span>Current Status:</span>
                  <span className={`order-status ${orderToDelete.status.toLowerCase()}`}>
                    {orderToDelete.status}
                  </span>
                </div>
                <div className="summary-row">
                  <span>Total Amount:</span>
                  <strong className="summary-price">₱{Number(orderToDelete.total || 0).toFixed(2)}</strong>
                </div>
                {orderToDelete.items && (
                  <div className="summary-row">
                    <span>Items Ordered:</span>
                    <span>
                      {orderToDelete.items.map((i) => `${i.quantity}x ${i.title}`).join(", ")}
                    </span>
                  </div>
                )}
              </div>

              <p className="modal-warning-text">
                ⚠️ This action cannot be undone. This order will be permanently removed from the system.
              </p>
            </div>

            <div className="order-modal-footer">
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setOrderToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-modal-delete"
                onClick={handleConfirmDelete}
              >
                Yes, Delete Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Staff Thermal Receipt Modal */}
      {orderToPrint && (
        <div
          className="order-modal-backdrop"
          onClick={() => setOrderToPrint(null)}
          role="presentation"
        >
          <div
            className="order-modal-dialog"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="print-dialog-title"
            style={{ maxWidth: "340px", padding: "16px" }}
          >
            <div className="no-print" style={{ display: "flex", justifyContent: "space-between", marginBottom: "12px", borderBottom: "1px solid #eee", paddingBottom: "8px" }}>
              <button
                type="button"
                className="btn-modal-delete"
                style={{ background: "#70482f", color: "#fff", display: "inline-flex", alignItems: "center", gap: "6px" }}
                onClick={() => window.print()}
              >
                <span>⎙</span> Print Slip (80mm)
              </button>
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setOrderToPrint(null)}
              >
                Close
              </button>
            </div>

            {/* Authentic 300px Thermal Receipt Slip */}
            <div
              className="printable-area"
              id="printable-staff-receipt"
              style={{
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: "11px",
                color: "#1a1714",
                lineHeight: "1.4",
              }}
            >
              <div style={{ textAlign: "center", marginBottom: "8px" }}>
                <h3 id="print-dialog-title" style={{ margin: "0", fontSize: "14px", fontWeight: 800 }}>
                  {business.businessName || "AMAYA DRINKS & BITES"}
                </h3>
                <p style={{ margin: "2px 0", fontSize: "10px", color: "#555" }}>
                  {business.address || "Barangay Lilingayon, Valencia City"}
                </p>
                <p style={{ margin: "2px 0", fontSize: "10px", color: "#555" }}>
                  Tel: {business.phone || "09636017184"}
                </p>
              </div>

              <div style={{ borderTop: "1px dashed #666", margin: "8px 0" }}></div>

              <div style={{ fontSize: "10.5px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>ORDER NO:</span> <strong>{orderToPrint.id}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>DATE:</span> <span>{new Date(orderToPrint.createdAt).toLocaleDateString()}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>TIME:</span> <span>{getOrderTime(orderToPrint.createdAt)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>CUSTOMER:</span> <strong>{orderToPrint.customer}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>TYPE:</span> <strong>{String(orderToPrint.type || "Counter").toUpperCase()}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>STATUS:</span> <strong>{orderToPrint.status.toUpperCase()}</strong>
                </div>
              </div>

              <div style={{ borderTop: "1px dashed #666", margin: "8px 0" }}></div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10.5px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px dashed #666", textAlign: "left" }}>
                    <th style={{ width: "24px" }}>QTY</th>
                    <th>ITEM</th>
                    <th style={{ textAlign: "right", width: "55px" }}>TOTAL</th>
                  </tr>
                </thead>
                <tbody>
                  {(orderToPrint.items || []).map((item, idx) => (
                    <tr key={idx} style={{ verticalAlign: "top" }}>
                      <td>{item.quantity}</td>
                      <td>
                        {item.title}
                        {item.size && item.size !== "Regular" && <span style={{ fontSize: "9px", color: "#555" }}> ({item.size})</span>}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        ₱{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ borderTop: "1px dashed #666", margin: "8px 0" }}></div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "3px" }}>
                <span>Subtotal:</span>
                <span>₱{Number(orderToPrint.total || 0).toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 800, borderTop: "1px solid #222", paddingTop: "4px" }}>
                <span>TOTAL AMOUNT:</span>
                <span>₱{Number(orderToPrint.total || 0).toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", marginTop: "3px", color: "#227733" }}>
                <span>PAYMENT:</span>
                <strong>{String(orderToPrint.payment || "PAID").toUpperCase()}</strong>
              </div>

              <div style={{ borderTop: "1px dashed #666", margin: "8px 0" }}></div>

              <div style={{ textAlign: "center", margin: "8px 0 4px" }}>
                <div style={{ letterSpacing: "2px", fontWeight: "bold" }}>||| | |||| ||| ||||||| | |||</div>
                <span style={{ fontSize: "9px", color: "#555" }}>*{orderToPrint.id}*</span>
              </div>

              <div style={{ textAlign: "center", fontSize: "9.5px", color: "#555" }}>
                Thank you for visiting Amaya!<br />
                Please present this slip when claiming order.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action Toast Feedback */}
      {toastMessage && (
        <div className="order-toast" role="status" aria-live="polite">
          <span>✓</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}

function OrderStat({ icon, tone, label, value, note }) {
  return (
    <div className="order-stat-card">
      <div className={`order-stat-icon ${tone}`}>{icon}</div>
      <div className="order-stat-info">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

export default StaffOrder;

