import { useEffect, useMemo, useState } from "react";

import {
  Banknote,
  CalendarDays,
  Check,
  ClipboardList,
  Clock,
  CreditCard,
  Hash,
  MessageSquare,
  Minus,
  MoreVertical,
  Plus,
  Printer,
  Trash2,
  User,
  Utensils,
  Wallet,
  X,
} from "lucide-react";
import searchIcon from "../../assets/images/icon/search.svg";
import { useTheme } from "../../context/ThemeContext.jsx";
import Sidebar from "../../components/Sidebar.jsx";
import StaffNotificationBell from "../../components/StaffNotificationBell.jsx";
import staffAvatar from "../../assets/images/icon/staff1.svg";
import { useMenu } from "../../context/MenuContext.jsx";
import {
  getNextAllowedStatuses,
  getOrderTime,
  getPaymentMethodLabel,
  getPaymentStatusLabel,
  ORDER_STATUS_FLOW,
  useOrders,
  WALK_IN_CUSTOMER_NAME,
  WALK_IN_INITIALS,
} from "../../context/OrdersContext.jsx";
import { useBusiness, defaultBusinessSettings } from "../../context/BusinessContext.jsx";

import "../../assets/css/staff/staff-orders.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const statusFilterList = ["All", "Pending", "Preparing", "Ready", "Completed"];

function StaffOrder() {
  const { darkMode } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { orders = [], updateOrderStatus, deleteOrder, confirmOrder, printReceipt } = useOrders() || {};
  const { products = [] } = useMenu() || {};
  const { businessSettings } = useBusiness() || {};
  const business = businessSettings || defaultBusinessSettings;

  // Name -> product image, so the details modal can show real menu thumbnails.
  const productImageByName = useMemo(() => {
    const map = new Map();
    products.forEach((product) => {
      if (product?.name && product?.image) map.set(product.name, product.image);
    });
    return map;
  }, [products]);

  const [activeFilter, setActiveFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [orderToDelete, setOrderToDelete] = useState(null);
  const [orderToPrint, setOrderToPrint] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
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
      const items = (order.items || []).map((item) => (item.title || "").toLowerCase()).join(" ");
      return orderId.includes(query) || items.includes(query);
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
    if (!orderToDelete && !orderToPrint && !selectedOrder) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setOrderToDelete(null);
        setOrderToPrint(null);
        setSelectedOrder(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [orderToDelete, orderToPrint, selectedOrder]);

  const handleStatusChange = (orderId, currentStatus, newStatus) => {
    if (!updateOrderStatus || newStatus === currentStatus) return;

    const allowed = getNextAllowedStatuses(currentStatus);
    if (!allowed.includes(newStatus)) {
      const next = allowed[0];
      setToastMessage(
        next
          ? `Order ${orderId} must move to "${next}" next.`
          : `Order ${orderId} is completed and locked.`
      );
      return;
    }

    updateOrderStatus(orderId, newStatus);
    setToastMessage(`Order ${orderId} updated to "${newStatus}"`);
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

  return (
    <div className={`staff-orders-page ${darkMode ? "dark-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        role="staff"
        activeTab="orders"
        orderCount={pendingCount}
        sidebarCollapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />

      <main className="staff-orders-main">
        <header className="staff-orders-topbar">
          <div className="orders-topbar-left">
            <span className="orders-page-label">STAFF PORTAL</span>
            <h1>Orders</h1>
          </div>
          <div className="orders-topbar-right">
            <StaffNotificationBell />
            <div className="orders-user">
              <div className="amaya-user-avatar">
                <img src={staffAvatar} alt="" aria-hidden="true" className="tinted" />
              </div>
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
                <img
                  className="orders-search-icon"
                  src={searchIcon}
                  alt=""
                  aria-hidden="true"
                />
                <input
                  type="text"
                  placeholder="Search by order ID or item..."
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

            <div className="order-card-grid">
              {visibleOrders.length ? (
                visibleOrders.map((order) => {
                  const itemCount = order.items
                    ? order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
                    : 0;
                  const itemsSummary = order.items
                    ? order.items.map((i) => `${i.quantity}x ${i.title}`).join(", ")
                    : "";
                  const allowedNext = getNextAllowedStatuses(order.status);
                  const isLocked = allowedNext.length === 0;

                  return (
                    <article
                      className="order-card order-card-clickable"
                      key={order.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`View details for order ${order.id}`}
                      onClick={() => setSelectedOrder(order)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedOrder(order);
                        }
                      }}
                      title={new Date(order.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    >
                      <div className="order-card-head">
                        <div className="order-card-header">
                          <div>
                            <h3 className="order-card-id">{order.id}</h3>
                            <p className="order-card-time">
                              {getOrderTime(order.createdAt)}
                            </p>
                          </div>
                          <span
                            className={`order-status order-card-badge ${order.status.toLowerCase()}`}
                          >
                            {order.status}
                          </span>
                        </div>

                        <div className="order-card-customer">
                          <div className="order-card-avatar">{WALK_IN_INITIALS}</div>
                          <div className="order-card-customer-text">
                            <p>
                              <strong>{WALK_IN_CUSTOMER_NAME}</strong>
                              <span>{order.type || "Counter"}</span>
                            </p>
                          </div>
                        </div>
                      </div>

                      <hr className="order-card-divider" />

                      <div className="order-card-summary">
                        <span className="order-card-count" title={itemsSummary}>
                          {itemCount} item{itemCount === 1 ? "" : "s"}
                        </span>
                        <span className="order-card-total">
                          ₱{Number(order.total || 0).toFixed(2)}
                        </span>
                      </div>

                      <hr className="order-card-divider" />

                      <div className="order-card-actions">
                        <div className="order-status-select-wrap" onClick={(e) => e.stopPropagation()}>
                          <select
                            value={order.status}
                            onChange={(e) => handleStatusChange(order.id, order.status, e.target.value)}
                            className={`order-status-select select-${order.status.toLowerCase()}`}
                            aria-label={`Update status for ${order.id}`}
                            title={
                              isLocked
                                ? `Order ${order.id} is completed and locked`
                                : `Advance order ${order.id} to ${allowedNext[0]}`
                            }
                            disabled={isLocked}
                          >
                            {ORDER_STATUS_FLOW.map((status) => (
                              <option
                                key={status}
                                value={status}
                                disabled={!allowedNext.includes(status)}
                              >
                                {status}
                              </option>
                            ))}
                          </select>
                        </div>

                        <button
                          type="button"
                          className="order-print-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOrderToPrint(order);
                          }}
                          title={`Print receipt for ${order.id}`}
                          aria-label={`Print receipt for ${order.id}`}
                        >
                          <Printer aria-hidden="true" size={13} strokeWidth={2} />
                          <span>Print</span>
                        </button>

                        <button
                          type="button"
                          className="order-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOrderToDelete(order);
                          }}
                          title={`Delete order ${order.id}`}
                          aria-label={`Delete order ${order.id}`}
                        >
                          <Trash2 aria-hidden="true" size={13} strokeWidth={2} />
                          <span>Delete</span>
                        </button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <div className="order-card-empty">
                  {orders.length === 0 ? (
                    <div className="empty-orders-state">
                      <strong>No orders found</strong>
                      <span>There are currently no active customer orders in the system.</span>
                    </div>
                  ) : (
                    <div className="empty-orders-state">
                      <strong>No orders found</strong>
                      <span>
                        {searchQuery
                          ? `No orders matching "${searchQuery}" in ${activeFilter} filter.`
                          : `No ${activeFilter === "All" ? "" : `${activeFilter.toLowerCase()} `}orders in this view.`}
                      </span>
                    </div>
                  )}
                </div>
              )}
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

      {/* Order Details Modal (opened by clicking a card) */}
      {selectedOrder && (() => {
        const isConfirmed = selectedOrder.confirmed === true;
        const orderItems = Array.isArray(selectedOrder.items) ? selectedOrder.items : [];
        const totalUnits = orderItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const orderTotal = Number(selectedOrder.total || 0);
        const kitchenTicket = {
          Pending: "Sent to Kitchen",
          Preparing: "In Preparation",
          Ready: "Ready for Pickup",
          Completed: "Fulfilled",
        }[selectedOrder.status] || "Not Sent";
        const paymentMethod = selectedOrder.paymentMethod || "Cash";
        const orderDate = new Date(selectedOrder.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        const orderTime = getOrderTime(selectedOrder.createdAt);
        const orderNote =
          selectedOrder.notes ||
          orderItems.find((item) => item.notes)?.notes ||
          "No special instructions.";

        return (
        <div
          className="order-modal-backdrop"
          onClick={() => setSelectedOrder(null)}
          role="presentation"
        >
          <div
            className="order-modal-dialog order-dashboard"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-details-title"
          >
            <header className="order-dashboard-header">
              <span className="order-dashboard-header-icon" aria-hidden="true">
                <ClipboardList size={19} strokeWidth={1.9} />
              </span>
              <div>
                <h3 id="order-details-title">Order Details</h3>
                <p>View and manage the items in this order.</p>
              </div>
              <button
                type="button"
                className="modal-close-button"
                onClick={() => setSelectedOrder(null)}
                aria-label="Close order details"
              >
                <X aria-hidden="true" size={18} strokeWidth={2.2} />
              </button>
            </header>

            <div className="order-dashboard-layout">
              {/* ---------------- Left: order breakdown ---------------- */}
              <div className="order-dashboard-main">
                <div className="order-dashboard-section-head">
                  <h4>Ordered Items</h4>
                  <span className="order-dashboard-count">{totalUnits}</span>
                </div>

                <ul className="od-item-list">
                  {orderItems.length ? orderItems.map((item, index) => {
                    const image = productImageByName.get(item.title);
                    const unitPrice = Number(item.price || 0);
                    const qty = Number(item.quantity || 0);
                    const lineTotal = unitPrice * qty;
                    const description = [
                      item.size && item.size !== "Regular" ? item.size : "Medium (16oz)",
                      item.sugarLevel || null,
                      item.addons?.length ? `+${item.addons.join(", ")}` : null,
                    ].filter(Boolean).join(" · ");

                    return (
                      <li className="od-item" key={`${item.title}-${index}`}>
                        <span className="od-item-thumb" aria-hidden="true">
                          {image ? (
                            <img src={image} alt="" />
                          ) : (
                            <span className="od-item-thumb-fallback">
                              {String(item.title || "?").charAt(0)}
                            </span>
                          )}
                        </span>

                        <div className="od-item-text">
                          <strong>{item.title}</strong>
                          <span className="od-item-desc">{description}</span>
                          <span className="od-item-unit">₱{unitPrice.toFixed(2)} each</span>
                          {item.notes ? (
                            <span className="od-item-note">Note: {item.notes}</span>
                          ) : null}
                        </div>

                        <div
                          className="od-item-qty"
                          title="Quantity is locked once the order is placed"
                        >
                          <button type="button" disabled aria-label={`Decrease ${item.title} quantity`}>
                            <Minus aria-hidden="true" size={13} strokeWidth={2.6} />
                          </button>
                          <span aria-label={`Quantity ${qty}`}>{qty}</span>
                          <button type="button" disabled aria-label={`Increase ${item.title} quantity`}>
                            <Plus aria-hidden="true" size={13} strokeWidth={2.6} />
                          </button>
                        </div>

                        <button
                          type="button"
                          className="od-item-menu"
                          disabled
                          aria-label={`More options for ${item.title}`}
                          title="Item options are not available for a placed order"
                        >
                          <MoreVertical aria-hidden="true" size={15} strokeWidth={2.2} />
                        </button>

                        <strong className="od-item-total">₱{lineTotal.toFixed(2)}</strong>
                      </li>
                    );
                  }) : (
                    <li className="od-item-empty">No items recorded for this order.</li>
                  )}
                </ul>

                <div className="od-costs">
                  <div className="od-cost-row">
                    <span>Subtotal</span>
                    <strong>₱{orderTotal.toFixed(2)}</strong>
                  </div>
                  <div className="od-cost-row">
                    <span>Tax (VAT 0%)</span>
                    <strong>₱0.00</strong>
                  </div>
                  <div className="od-cost-row">
                    <span>Payment method</span>
                    <span className="od-method-pill">
                      {paymentMethod === "GCash" ? (
                        <Wallet aria-hidden="true" size={12} strokeWidth={2.2} />
                      ) : paymentMethod === "Card" ? (
                        <CreditCard aria-hidden="true" size={12} strokeWidth={2.2} />
                      ) : (
                        <Banknote aria-hidden="true" size={12} strokeWidth={2.2} />
                      )}
                      {String(paymentMethod).toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="od-total-banner">
                  <span className="od-total-label">
                    <Wallet aria-hidden="true" size={16} strokeWidth={2.2} />
                    Total Due
                  </span>
                  <strong>₱{orderTotal.toFixed(2)}</strong>
                </div>
              </div>

              {/* ---------------- Right: information sidebar ---------------- */}
              <aside className="order-dashboard-aside">
                {isConfirmed ? (
                  <span className="od-confirm confirmed">
                    <Check aria-hidden="true" size={15} strokeWidth={3} />
                    Order Confirmed
                  </span>
                ) : (
                  <span className="od-confirm pending">
                    <Clock aria-hidden="true" size={15} strokeWidth={2.4} />
                    Pending Confirmation
                  </span>
                )}

                {!isConfirmed ? (
                  <button
                    type="button"
                    className="od-action secondary"
                    onClick={() => {
                      confirmOrder(selectedOrder.id);
                      setSelectedOrder({ ...selectedOrder, confirmed: true, confirmedAt: new Date().toISOString() });
                      setToastMessage(`Order ${selectedOrder.id} confirmed`);
                    }}
                  >
                    <Check aria-hidden="true" size={15} strokeWidth={2.4} />
                    Confirm order
                  </button>
                ) : null}

                <dl className="od-meta">
                  <div>
                    <dt><Hash aria-hidden="true" size={13} strokeWidth={2.2} /> Order ID</dt>
                    <dd>{selectedOrder.id}</dd>
                  </div>
                  <div>
                    <dt><User aria-hidden="true" size={13} strokeWidth={2.2} /> Customer</dt>
                    <dd>{selectedOrder.customer || WALK_IN_CUSTOMER_NAME}</dd>
                  </div>
                  <div>
                    <dt><Utensils aria-hidden="true" size={13} strokeWidth={2.2} /> Order type</dt>
                    <dd>
                      <span className="od-type-pill">{selectedOrder.type || "Dine-in"}</span>
                    </dd>
                  </div>
                  <div>
                    <dt><CalendarDays aria-hidden="true" size={13} strokeWidth={2.2} /> Date &amp; time</dt>
                    <dd>{orderDate} &bull; {orderTime}</dd>
                  </div>
                  <div>
                    <dt><ClipboardList aria-hidden="true" size={13} strokeWidth={2.2} /> Kitchen ticket</dt>
                    <dd>{kitchenTicket}</dd>
                  </div>
                  <div>
                    <dt><MessageSquare aria-hidden="true" size={13} strokeWidth={2.2} /> Notes</dt>
                    <dd>{orderNote}</dd>
                  </div>
                </dl>

                <div className="od-aside-actions">
                  <button
                    type="button"
                    className="od-action primary"
                    onClick={() => {
                      setOrderToPrint(selectedOrder);
                      setSelectedOrder(null);
                    }}
                  >
                    <Printer aria-hidden="true" size={15} strokeWidth={2.2} />
                    Print Receipt
                  </button>
                  <button
                    type="button"
                    className="od-action neutral"
                    onClick={() => setSelectedOrder(null)}
                  >
                    Close
                  </button>
                </div>
              </aside>
            </div>
          </div>
        </div>
        );
      })()}
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
                  <strong>{WALK_IN_CUSTOMER_NAME}</strong>
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
                onClick={() => {
                  if (orderToPrint) printReceipt(orderToPrint.id);
                  window.print();
                }}
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
                  <span>CUSTOMER:</span> <strong>{WALK_IN_CUSTOMER_NAME}</strong>
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
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", marginTop: "3px" }}>
                <span>PAYMENT METHOD:</span>
                <strong>{getPaymentMethodLabel(orderToPrint)}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10.5px", marginTop: "3px", color: "#227733", fontWeight: 700 }}>
                <span>PAYMENT STATUS:</span>
                <strong>{getPaymentStatusLabel(orderToPrint)}</strong>
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

