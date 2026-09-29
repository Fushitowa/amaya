import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Coffee,
  Lock,
  Printer,
  Search,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import adminAvatar from "../../assets/images/icon/admin1.svg";
import { useSidebar } from "../../context/useSidebar.jsx";
import {
  getOrderTime,
  getPaymentMethodLabel,
  getPaymentStatusLabel,
  isOrderPaid,
  isToday,
  useOrders,
  WALK_IN_CUSTOMER_NAME,
  WALK_IN_INITIALS,
} from "../../context/OrdersContext.jsx";
import { useBusiness, defaultBusinessSettings } from "../../context/BusinessContext.jsx";

import "../../assets/css/admin/AdminOrder.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const statusOptions = ["All orders", "Pending", "Preparing", "Ready", "Completed"];


function AdminOrder() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { orders = [] } = useOrders() || {};
  const { businessSettings } = useBusiness() || {};
  const business = businessSettings || defaultBusinessSettings;

  const [activeStatus, setActiveStatus] = useState("All orders");
  const [search, setSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  // Enrich order models for display
  const displayOrders = useMemo(() => orders.map((order) => {
    const itemsList = order.items || [];
    const itemsCount = itemsList.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const summary = itemsList.map((item) => item.title).join(", ");
    const totalAmount = Number(order.total || 0);

    return {
      ...order,
      time: getOrderTime(order.createdAt),
      itemsList,
      itemsCount,
      summary,
      totalAmount,
      totalLabel: `₱${totalAmount.toFixed(2)}`,
      isPaid: isOrderPaid(order),
      paymentStatusLabel: getPaymentStatusLabel(order),
      paymentMethodLabel: getPaymentMethodLabel(order),
      customer: WALK_IN_CUSTOMER_NAME,
      initials: WALK_IN_INITIALS,
    };
  }), [orders]);

  // Filter orders based on active status filter and search query
  const filteredOrders = useMemo(() => {
    const normalizedSearch = search.toLowerCase().trim();
    return displayOrders.filter((order) => {
      const matchesStatus = activeStatus === "All orders" || order.status === activeStatus;
      const matchesSearch = !normalizedSearch || `${order.id} ${order.summary}`.toLowerCase().includes(normalizedSearch);
      return matchesStatus && matchesSearch;
    });
  }, [activeStatus, displayOrders, search]);

  // Resolve currently selected order cleanly (pure derivation, no cascading effect)
  const selectedOrder = useMemo(() => {
    if (selectedOrderId) {
      const found = displayOrders.find((order) => order.id === selectedOrderId);
      if (found) return found;
    }
    return filteredOrders[0] || displayOrders[0] || null;
  }, [selectedOrderId, displayOrders, filteredOrders]);

  // Summary Metrics
  const todaysOrders = useMemo(() => displayOrders.filter((order) => isToday(order.createdAt)), [displayOrders]);
  const pendingOrders = useMemo(() => displayOrders.filter((order) => order.status === "Pending"), [displayOrders]);
  const inProgressOrders = useMemo(() => displayOrders.filter((order) => ["Preparing", "Ready"].includes(order.status)), [displayOrders]);
  const completedToday = useMemo(() => todaysOrders.filter((order) => order.status === "Completed"), [todaysOrders]);
  const todaysRevenue = useMemo(() => todaysOrders.reduce((sum, order) => sum + order.totalAmount, 0), [todaysOrders]);

  // Keyboard shortcut to close receipt modal
  useEffect(() => {
    if (!isReceiptOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsReceiptOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isReceiptOpen]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className={`admin-orders-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        role="admin"
        activeTab="orders"
        orderCount={orders.length}
        sidebarCollapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      <main className="admin-orders-main">
        <header className="admin-orders-topbar">
          <div>
            <span className="admin-orders-section-label">ADMIN PORTAL</span>
            <h1>Orders Overview</h1>
          </div>
          <div className="admin-orders-topbar-actions">
            <PortalNotificationButton count={0} />
            <div className="admin-orders-user">
              <div className="amaya-admin-avatar"><img src={adminAvatar} alt="" aria-hidden="true" /></div>
              <div>
                <strong>Administrator</strong>
                <span>Store Supervisor</span>
              </div>
            </div>
          </div>
        </header>

        <div className="admin-orders-content">
          <section className="admin-orders-heading">
            <div>
              <span className="admin-orders-eyebrow">ORDER MANAGEMENT & AUDIT</span>
              <h2>Customer orders</h2>
              <p>Monitor live orders in the queue and view itemized order records for receipt printing.</p>
            </div>
            <button
              type="button"
              className="admin-orders-export"
              onClick={() => {
                if (selectedOrder) {
                  setIsReceiptOpen(true);
                }
              }}
            >
                              <Printer aria-hidden="true" /> <span>Quick print receipt</span>
            </button>
          </section>

          {/* Top Summary Metrics */}
          <section className="admin-orders-stats" aria-label="Order summary">
            <div>
              <span className="stat-mark amber">◷</span>
              <div>
                <small>Pending</small>
                <strong>{pendingOrders.length}</strong>
                <span className="stat-note warning">
                  {pendingOrders.length ? "In queue" : "No pending orders"}
                </span>
              </div>
            </div>
            <div>
              <span className="stat-mark blue">◌</span>
              <div>
                <small>In progress</small>
                <strong>{inProgressOrders.length}</strong>
                <span className="stat-note">
                  {inProgressOrders.length ? "Being prepared" : "Kitchen clear"}
                </span>
              </div>
            </div>
            <div>
                <span className="stat-mark green"><Check aria-hidden="true" size={19} strokeWidth={2.6} /></span>
              <div>
                <small>Completed today</small>
                <strong>{completedToday.length}</strong>
                <span className="stat-note positive">
                  {completedToday.length ? "Fulfilled" : "No completed orders yet"}
                </span>
              </div>
            </div>
            <div>
              <span className="stat-mark plum">₱</span>
              <div>
                <small>Today's revenue</small>
                <strong>₱{todaysRevenue.toFixed(2)}</strong>
                <span className="stat-note positive">
                  {todaysOrders.length ? `${todaysOrders.length} order${todaysOrders.length === 1 ? "" : "s"} today` : "No sales recorded yet"}
                </span>
              </div>
            </div>
          </section>

          {/* Main Order Workspace: Order Queue on left, Order Details on right */}
          <section className="admin-orders-workspace">
            {/* Left Panel: Order Queue */}
            <div className="admin-orders-list-panel">
              <div className="admin-orders-list-header">
                <div>
                  <h3>Order queue</h3>
                  <span>{filteredOrders.length} order{filteredOrders.length === 1 ? "" : "s"} shown</span>
                </div>
                <label className="admin-orders-search">
                  <Search aria-hidden="true" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search by order ID or item..."
                    aria-label="Search orders"
                  />
                </label>
              </div>

              {/* Status Filter Tabs */}
              <div className="admin-orders-tabs" role="tablist" aria-label="Filter orders">
                {statusOptions.map((status) => {
                  const count = status === "All orders"
                    ? displayOrders.length
                    : displayOrders.filter((order) => order.status === status).length;

                  return (
                    <button
                      key={status}
                      type="button"
                      className={activeStatus === status ? "active" : ""}
                      onClick={() => setActiveStatus(status)}
                    >
                      {status}
                      <span>({count})</span>
                    </button>
                  );
                })}
              </div>

              {/* Order Queue Table with prominent Selected State */}
              <div className="admin-orders-table-wrap">
                <table className="admin-orders-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Type</th>
                      <th>Total</th>
                      <th>Status (Read-Only)</th>
                      <th><span className="sr-only">View</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.length ? (
                      filteredOrders.map((order) => {
                        const isCurrentSelected = selectedOrder?.id === order.id;

                        return (
                          <tr
                            key={order.id}
                            className={isCurrentSelected ? "selected" : ""}
                            onClick={() => setSelectedOrderId(order.id)}
                            title="Click to view details"
                          >
                            <td>
                              <strong>{order.id}</strong>
                              <span>{order.time}</span>
                            </td>
                            <td>
                              <div className="order-customer">
                                <span>{order.initials}</span>
                                <div>
                                  <strong>{order.customer}</strong>
                                  <small>{order.itemsCount} item{order.itemsCount === 1 ? "" : "s"} · {order.summary}</small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="order-type">
                                <i className={order.type ? order.type.toLowerCase() : "counter"}></i>
                                {order.type || "Counter"}
                              </span>
                            </td>
                            <td>
                              <strong>{order.totalLabel}</strong>
                              <span className="payment-status">● {order.paymentStatusLabel}</span>
                              <span className="payment-method">{order.paymentMethodLabel}</span>
                            </td>
                            <td>
                              {/* Read-Only Status Pill */}
                              <span className={`order-status ${order.status.toLowerCase()}`}>
                                {order.status}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="row-arrow"
                                aria-label={`View details for ${order.id}`}
                              >
                                <ChevronRight aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="6">
                          <div className="admin-orders-empty">
                            No orders matching the selected filter.
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Panel: Read-Only ORDER DETAILS with Prominent Print Receipt Button */}
            {selectedOrder ? (
              <aside className="admin-order-detail" aria-labelledby="order-detail-title">
                <div className="detail-heading">
                  <div>
                    <span className="admin-orders-eyebrow">ORDER DETAILS</span>
                    <h3 id="order-detail-title">{selectedOrder.id}</h3>
                  </div>
                  {/* Requirement 1: Read-Only Status Badge (No update controls) */}
                  <span className={`order-status ${selectedOrder.status.toLowerCase()}`}>
                    {selectedOrder.status}
                  </span>
                </div>

                <div className="detail-customer">
                  <span>{selectedOrder.initials}</span>
                  <div>
                    <strong>{selectedOrder.customer}</strong>
                    <small>Ordered on {new Date(selectedOrder.createdAt).toLocaleDateString()} at {selectedOrder.time}</small>
                  </div>
                </div>

                <div className="detail-divider"></div>

                {/* Itemized Order List */}
                <div className="detail-section">
                  <div className="detail-section-title">
                    <strong>Order items</strong>
                    <span>{selectedOrder.itemsCount} item{selectedOrder.itemsCount === 1 ? "" : "s"}</span>
                  </div>
                  {selectedOrder.itemsList.map((item, index) => (
                    <div className="detail-item" key={`${selectedOrder.id}-${item.title}-${index}`}>
                      <span>
                        {item.quantity} × {item.title}
                        {item.size && item.size !== "Regular" ? ` (${item.size})` : ""}
                      </span>
                      <strong>₱{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}</strong>
                    </div>
                  ))}
                </div>

                {/* Total */}
                <div className="detail-total">
                  <span>Total amount</span>
                  <strong>{selectedOrder.totalLabel}</strong>
                </div>

                {/* Order Type, Payment Method & Payment Status */}
                <div className="detail-meta">
                  <div>
                    <span>Order type</span>
                    <strong>{selectedOrder.type || "Counter"}</strong>
                  </div>
                  <div>
                    <span>Payment method</span>
                    <strong>{selectedOrder.paymentMethodLabel}</strong>
                  </div>
                  <div>
                    <span>Payment status</span>
                    <strong className="payment-status-badge">● {selectedOrder.paymentStatusLabel}</strong>
                  </div>
                  <div>
                    <span>Paid at</span>
                    <strong>{getOrderTime(selectedOrder.paidAt || selectedOrder.createdAt)}</strong>
                  </div>
                </div>

                {/* Read-Only Workflow Notice */}
                <div className="admin-readonly-banner">
                  <Lock aria-hidden="true" />
                  <span>Order status workflow is managed by Staff POS (Read-Only)</span>
                </div>

                {/* Requirement 2: Prominent Print Receipt Action Button */}
                <div className="detail-actions">
                  <button
                    type="button"
                    className="print-receipt-action"
                    onClick={() => setIsReceiptOpen(true)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="6 9 6 2 18 2 18 9"></polyline>
                      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                      <rect x="6" y="14" width="12" height="8"></rect>
                    </svg>
                    <span>Print Receipt</span>
                  </button>
                </div>
              </aside>
            ) : (
              <aside className="admin-order-detail">
                <div className="detail-heading">
                  <div>
                    <span className="admin-orders-eyebrow">ORDER DETAILS</span>
                    <h3>No active order</h3>
                  </div>
                </div>
                <div className="admin-orders-empty-state">
                  <strong>No orders selected</strong>
                  <span>Select an order from the queue table on the left to inspect its details and print receipts.</span>
                </div>
              </aside>
            )}
          </section>
        </div>
      </main>

      {/* Requirement 3: Restaurant Thermal Receipt Modal & Print View */}
      {isReceiptOpen && selectedOrder && (
        <div
          className="admin-receipt-modal-backdrop"
          onClick={() => setIsReceiptOpen(false)}
          role="presentation"
        >
          <div
            className="admin-receipt-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="receipt-dialog-title"
          >
            {/* Modal Controls (Hidden in Print) */}
            <div className="receipt-modal-controls no-print">
              <button
                type="button"
                className="btn-print-now"
                onClick={handlePrint}
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 6 2 18 2 18 9"></polyline>
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                  <rect x="6" y="14" width="12" height="8"></rect>
                </svg>
                Print Slip
              </button>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setIsReceiptOpen(false)}
              >
                Close
              </button>
            </div>

            {/* Authentic Thermal Receipt Paper */}
            <div className="thermal-receipt-paper printable-area" id="printable-receipt">
              <div className="receipt-header">
                <div className="receipt-brand-logo" aria-hidden="true">
                  <Coffee size={22} />
                </div>
                <h2 className="receipt-store-title" id="receipt-dialog-title">
                  {business.businessName || "Amaya's Drinks and Bites"}
                </h2>
                <p className="receipt-address">
                  {business.address || "Barangay Lilingayon, Valencia City, Bukidnon"}
                </p>
                <p className="receipt-contact">
                  Tel: {business.phone || "09636017184"}
                </p>
              </div>

              <div className="receipt-divider-dashed"></div>

              <div className="receipt-meta-grid">
                <div><span>ORDER NO:</span> <strong>{selectedOrder.id}</strong></div>
                <div><span>DATE:</span> <span>{new Date(selectedOrder.createdAt).toLocaleDateString()}</span></div>
                <div><span>TIME:</span> <span>{selectedOrder.time}</span></div>
                <div><span>CUSTOMER:</span> <strong>{selectedOrder.customer}</strong></div>
                <div><span>TYPE:</span> <strong>{String(selectedOrder.type || "Counter").toUpperCase()}</strong></div>
                <div><span>STATUS:</span> <strong>{selectedOrder.status.toUpperCase()}</strong></div>
              </div>

              <div className="receipt-divider-dashed"></div>

              <table className="receipt-items-table">
                <thead>
                  <tr>
                    <th className="th-qty">QTY</th>
                    <th className="th-desc">ITEM</th>
                    <th className="th-price">PRICE</th>
                    <th className="th-amount">AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrder.itemsList.map((item, idx) => (
                    <tr key={idx}>
                      <td className="td-qty">{item.quantity}</td>
                      <td className="td-desc">
                        {item.title}
                        {item.size && item.size !== "Regular" && (
                          <span className="item-variant"> ({item.size})</span>
                        )}
                      </td>
                      <td className="td-price">₱{Number(item.price || 0).toFixed(2)}</td>
                      <td className="td-amount">
                        ₱{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="receipt-divider-dashed"></div>

              <div className="receipt-calculations">
                <div className="calc-row">
                  <span>Subtotal:</span>
                  <span>₱{selectedOrder.totalAmount.toFixed(2)}</span>
                </div>
                <div className="calc-row">
                  <span>Tax / VAT (0%):</span>
                  <span>₱0.00</span>
                </div>
                <div className="receipt-divider-solid"></div>
                <div className="calc-row calc-total">
                  <strong>TOTAL AMOUNT:</strong>
                  <strong>{selectedOrder.totalLabel}</strong>
                </div>
                <div className="calc-row payment-indicator">
                  <span>Payment Method:</span>
                  <strong>{selectedOrder.paymentMethodLabel}</strong>
                </div>
                <div className="calc-row payment-indicator">
                  <span>Payment Status:</span>
                  <strong>PAID</strong>
                </div>

                {selectedOrder.paymentMethod === "Cash" ? (
                  <>
                    <div className="calc-row">
                      <span>Cash Tendered:</span>
                      <span>₱{Number(selectedOrder.cashTendered || selectedOrder.totalAmount).toFixed(2)}</span>
                    </div>
                    <div className="calc-row">
                      <span>Change Due:</span>
                      <span>₱{Number(selectedOrder.changeDue || 0).toFixed(2)}</span>
                    </div>
                  </>
                ) : null}
              </div>

              <div className="receipt-divider-dashed"></div>

              <div className="receipt-footer">
                <p className="footer-greeting">Thank you for visiting Amaya!</p>
                <p className="footer-subtext">Freshly Brewed Drinks & Savory Bites</p>
                <p className="footer-timestamp">
                  Printed by Admin · {new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminOrder;
