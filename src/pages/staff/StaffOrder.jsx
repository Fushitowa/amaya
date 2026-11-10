import { useEffect, useMemo, useRef, useState } from "react";

import {
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  Menu,
  MoreVertical,
  Printer,
  Search,
  Utensils,
  X,
  XCircle,
} from "lucide-react";
import searchIcon from "../../assets/images/icon/search.svg";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import Sidebar from "../../components/Sidebar.jsx";
import MenuProductImage from "../../components/MenuProductImage.jsx";
import OrderDetailsModal from "../../components/OrderDetailsModal.jsx";
import StaffNotificationBell from "../../components/StaffNotificationBell.jsx";
import StaffOperationsBar from "../../components/StaffOperationsBar.jsx";
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

const statusFilterList = ["All", "Pending", "Preparing", "Completed", "Cancelled"];

function StaffOrder() {
  const { darkMode } = useTheme();
  const { user } = useAuth() || {};
  const cashierName = user?.displayName || "Staff";
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { orders = [], updateOrderStatus, confirmOrder, printReceipt } = useOrders() || {};
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
  const [orderToPrint, setOrderToPrint] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionOrder, setActionOrder] = useState(null);
  const modalTriggerRef = useRef(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const sync = () => setIsMobile(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Dynamic summary metrics calculated directly from state
  const totalOrdersCount = orders.length;
  const activeOrdersCount = useMemo(
    () => orders.filter((o) => o.status !== "Completed" && o.status !== "Cancelled").length,
    [orders]
  );
  const pendingCount = useMemo(() => orders.filter((o) => o.status === "Pending").length, [orders]);
  const preparingCount = useMemo(() => orders.filter((o) => o.status === "Preparing").length, [orders]);
  const completedCount = useMemo(() => orders.filter((o) => o.status === "Completed").length, [orders]);
  const cancelledCount = useMemo(() => orders.filter((o) => o.status === "Cancelled").length, [orders]);

  // Filter & Search visible orders
  const visibleOrders = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return orders.filter((order) => {
      const matchesFilter = activeFilter === "All" || order.status === activeFilter;
      if (!matchesFilter) return false;
      if (!query) return true;

      const orderId = (order.id || "").toLowerCase();
      const customer = (order.customer || order.customerName || "").toLowerCase();
      const items = (order.items || []).map((item) => (item.title || "").toLowerCase()).join(" ");
      return orderId.includes(query) || customer.includes(query) || items.includes(query);
    });
  }, [activeFilter, orders, searchQuery]);

  // Toast timer cleanup
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Close secondary modals/sheets on Escape key (OrderDetailsModal handles its own Escape + close animation)
  useEffect(() => {
    if (!orderToPrint && !actionOrder) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setOrderToPrint(null);
        setActionOrder(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actionOrder, orderToPrint]);

  const openOrderDetails = (order, event) => {
    modalTriggerRef.current = event?.currentTarget || null;
    setSelectedOrder(order);
  };

  const handleStatusChange = async (orderId, currentStatus, newStatus) => {
    if (!updateOrderStatus || newStatus === currentStatus) return;

    const allowed = getNextAllowedStatuses(currentStatus);
    if (!allowed.includes(newStatus)) {
      const next = allowed[0];
      setToastMessage(
        next
          ? `Order ${orderId} must move to "${next}" next.`
          : currentStatus === "Cancelled"
            ? `Order ${orderId} is cancelled and locked.`
            : `Order ${orderId} is completed and locked.`
      );
      return;
    }

    try {
      const result = await updateOrderStatus(orderId, newStatus);
      if (result) {
        setToastMessage(`Order ${orderId} updated to "${newStatus}"`);
      }
    } catch (err) {
      setToastMessage(err?.message || `Failed to update order ${orderId}`);
    }
  };

  return (
    <div className={`staff-orders-page ${darkMode ? "dark-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${isMobile ? "is-mobile" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
      {mobileNavOpen && <div className="so-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />}
      <Sidebar
        role="staff"
        activeTab="orders"
        orderCount={pendingCount}
        sidebarCollapsed={sidebarCollapsed}
        onToggle={() => (isMobile ? setMobileNavOpen(false) : setSidebarCollapsed((c) => !c))}
      />

      {isMobile ? (
        <main className="so-main">
          <header className="so-appbar">
            <button type="button" className="so-icon-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu">
              <Menu size={24} />
            </button>
            {searchOpen ? (
              <label className="so-search">
                <Search size={20} aria-hidden="true" />
                <input autoFocus type="search" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search orders" aria-label="Search orders" />
                <button type="button" onClick={() => { setSearchQuery(""); setSearchOpen(false); }} aria-label="Close search"><X size={20} /></button>
              </label>
            ) : (
              <>
                <h1 className="so-title">Orders</h1>
                <button type="button" className="so-icon-btn" onClick={() => setSearchOpen(true)} aria-label="Search orders">
                  <Search size={22} />
                </button>
                <StaffNotificationBell />
              </>
            )}
          </header>

          <div className="so-ops-wrap">
            <StaffOperationsBar variant="compact" darkMode={darkMode} />
          </div>

          <section className="so-queue" aria-label="Queue overview">
            <div className="so-queue-head">
              <div>
                <strong>{activeOrdersCount}</strong>
                <span>in the queue</span>
              </div>
              <em>{completedCount} of {totalOrdersCount} done</em>
            </div>
            <div className="so-queue-bar" role="img" aria-label={`${pendingCount} pending, ${preparingCount} preparing, ${completedCount} completed`}>
              <i className="p" style={{ flexGrow: pendingCount }} />
              <i className="r" style={{ flexGrow: preparingCount }} />
              <i className="c" style={{ flexGrow: completedCount }} />
            </div>
          </section>

          <ul className="so-list">
            {visibleOrders.length ? visibleOrders.map((order) => {
              const items = order.items || [];
              const itemCount = items.reduce((n, i) => n + Number(i.quantity || 0), 0);
              const next = getNextAllowedStatuses(order.status)[0];
              const status = String(order.status || "").toLowerCase();
              const isCancelled = order.status === "Cancelled";
              const stepIndex = ORDER_STATUS_FLOW.indexOf(order.status);
              return (
                <li key={order.id} className={`so-card ${status}`}>
                  <div className="so-card-head">
                    <button type="button" className="so-card-title" onClick={(e) => openOrderDetails(order, e)} aria-label={`View details for order ${order.id}`}>
                      <span className="so-time"><Clock size={13} aria-hidden="true" />{getOrderTime(order.createdAt)}</span>
                      <strong>{order.id}</strong>
                      <span className="so-who">{order.customer || order.customerName || WALK_IN_CUSTOMER_NAME} · {order.type || "Counter"}</span>
                    </button>
                    <button
                      type="button"
                      className="so-more"
                      onClick={(e) => {
                        modalTriggerRef.current = e.currentTarget;
                        setActionOrder(order);
                      }}
                      aria-label={`More actions for ${order.id}`}
                    >
                      <MoreVertical size={22} />
                    </button>
                  </div>

                  <button type="button" className="so-lines" onClick={(e) => openOrderDetails(order, e)} tabIndex={-1} aria-hidden="true">
                    <span className="so-thumbs">
                      {items.slice(0, 4).map((item, i) => (
                        <span className="so-thumb" key={`${item.title}-${i}`}>
                          <MenuProductImage src={productImageByName.get(item.title)} alt="" className="order-card-item-thumb-image" />
                          <b>{item.quantity || 1}</b>
                        </span>
                      ))}
                      {items.length > 4 && <span className="so-thumb more">+{items.length - 4}</span>}
                    </span>
                    <span className="so-lines-text">{items.map((i) => i.title).join(", ") || "No item details"}</span>
                  </button>

                  {isCancelled ? (
                    <div className="so-cancelled-banner">
                      <XCircle size={15} strokeWidth={2.2} aria-hidden="true" />
                      <span>Voided / Cancelled — stock ledger recorded</span>
                    </div>
                  ) : (
                    <ol className="so-steps" aria-label={`Progress: ${order.status}`}>
                      {ORDER_STATUS_FLOW.map((step, i) => (
                        <li key={step} className={i < stepIndex ? "done" : i === stepIndex ? "now" : ""}>
                          <i aria-hidden="true">{i < stepIndex ? <Check size={12} strokeWidth={3.5} /> : null}</i>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  )}

                  <div className="so-card-foot">
                    <div className="so-total">
                      <small>{itemCount} item{itemCount === 1 ? "" : "s"}</small>
                      <strong>₱{Number(order.total || 0).toFixed(2)}</strong>
                    </div>
                    {isCancelled ? (
                      <span className="so-cancelled-pill"><XCircle size={17} aria-hidden="true" /> Cancelled</span>
                    ) : next ? (
                      <button type="button" className="so-advance" onClick={() => handleStatusChange(order.id, order.status, next)}>
                        {next === "Preparing" ? "Start preparing" : next === "Completed" ? "Mark done" : next}
                        <span aria-hidden="true">→</span>
                      </button>
                    ) : (
                      <span className="so-done"><CheckCircle2 size={18} aria-hidden="true" /> Completed</span>
                    )}
                  </div>
                </li>
              );
            }) : (
              <li className="so-empty">
                <span className="so-empty-icon" aria-hidden="true">
                  {activeFilter === "Preparing" ? <Utensils size={34} /> : activeFilter === "Completed" ? <CheckCircle2 size={34} /> : activeFilter === "Cancelled" ? <XCircle size={34} /> : activeFilter === "Pending" ? <Clock size={34} /> : <ClipboardList size={34} />}
                </span>
                <strong>
                  {searchQuery ? "No matches found" : activeFilter === "Preparing" ? "Nothing being prepared" : activeFilter === "Pending" ? "No pending orders" : activeFilter === "Completed" ? "No completed orders yet" : activeFilter === "Cancelled" ? "No voided orders" : "No orders yet"}
                </strong>
                <span>
                  {searchQuery
                    ? `No orders match "${searchQuery}".`
                    : activeFilter === "Preparing"
                    ? "Orders you start preparing will appear here."
                    : activeFilter === "Completed"
                    ? "Finished orders will be listed here."
                    : activeFilter === "Cancelled"
                    ? "Admin-voided orders will appear here."
                    : "New customer orders will show up in this queue."}
                </span>
                {!searchQuery && activeFilter === "Preparing" && pendingCount > 0 && (
                  <button type="button" className="so-empty-cta" onClick={() => setActiveFilter("Pending")}>
                    Go to {pendingCount} pending order{pendingCount === 1 ? "" : "s"}
                  </button>
                )}
                {(searchQuery || (activeFilter !== "All" && orders.length > 0 && !(activeFilter === "Preparing" && pendingCount > 0))) && (
                  <button type="button" className="so-empty-cta ghost" onClick={() => { setSearchQuery(""); setActiveFilter("All"); }}>
                    Show all orders
                  </button>
                )}
              </li>
            )}
          </ul>

          <nav className="so-nav" aria-label="Order status">
            {[
              { key: "All", label: "All", Icon: ClipboardList, count: totalOrdersCount },
              { key: "Pending", label: "Pending", Icon: Clock, count: pendingCount },
              { key: "Preparing", label: "Preparing", Icon: Utensils, count: preparingCount },
              { key: "Completed", label: "Done", Icon: CheckCircle2, count: completedCount },
              { key: "Cancelled", label: "Voided", Icon: XCircle, count: cancelledCount },
            ].map(({ key, label, Icon, count }) => (
              <button key={key} type="button" className={activeFilter === key ? "on" : ""} aria-current={activeFilter === key ? "page" : undefined} onClick={() => setActiveFilter(key)}>
                <span className="so-nav-pill">
                  <Icon size={22} aria-hidden="true" />
                  {count > 0 && <b>{count}</b>}
                </span>
                <span>{label}</span>
              </button>
            ))}
          </nav>

          {actionOrder && (
            <div className="so-sheet-wrap" role="presentation" onClick={() => setActionOrder(null)}>
              <div className="so-sheet" role="dialog" aria-modal="true" aria-label={`Actions for ${actionOrder.id}`} onClick={(e) => e.stopPropagation()}>
                <span className="so-sheet-handle" aria-hidden="true" />
                <h2>{actionOrder.id}</h2>
                <button type="button" onClick={() => { setSelectedOrder(actionOrder); setActionOrder(null); }}><ClipboardList size={22} aria-hidden="true" />View details</button>
                <button type="button" onClick={() => { setOrderToPrint(actionOrder); setActionOrder(null); }}><Printer size={22} aria-hidden="true" />Print receipt</button>
              </div>
            </div>
          )}
        </main>
      ) : (
      <main className="staff-orders-main">
        <header className="staff-orders-topbar">
          <div className="orders-topbar-left">
            <span className="orders-page-label">STAFF PORTAL</span>
            <h1>Orders</h1>
          </div>
          <div className="orders-topbar-right">
            <StaffOperationsBar variant="compact" darkMode={darkMode} />
            <StaffNotificationBell />
            <div className="orders-user">
              <div className="amaya-user-avatar">
                <img src={staffAvatar} alt="" aria-hidden="true" className="tinted" />
              </div>
              <div className="orders-user-info">
                <strong>{cashierName}</strong>
                <span>Cashier</span>
              </div>
            </div>
          </div>
        </header>

        <div className="orders-content">
          <section className="orders-page-header">
            <div>
              <span className="orders-eyebrow">ORDER MANAGEMENT</span>
              <h2>Order Overview</h2>
              <p>Track incoming orders and manage each step of service.</p>
            </div>
            <div className="orders-summary">
              <div className="summary-number">{activeOrdersCount}</div>
              <div className="summary-text">
                <strong>Active Orders</strong>
                <span>Currently in system</span>
              </div>
            </div>
          </section>

          {/* Top Summary Cards with dynamic metrics */}
          <section className="order-stats">
            <OrderStat
              Icon={ClipboardList}
              tone="total"
              label="Total Orders"
              value={totalOrdersCount}
              note="All recorded orders"
            />
            <OrderStat
              Icon={Clock}
              tone="pending"
              label="Pending"
              value={pendingCount}
              note="Awaiting preparation"
            />
            <OrderStat
              Icon={Utensils}
              tone="preparing"
              label="Preparing"
              value={preparingCount}
              note="In progress"
            />
            <OrderStat
              Icon={CheckCircle2}
              tone="completed"
              label="Completed"
              value={completedCount}
              note="Successfully fulfilled"
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
                  if (filter === "Completed") count = completedCount;
                  if (filter === "Cancelled") count = cancelledCount;

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
                      className={`order-card ${order.status === "Cancelled" ? "cancelled" : ""}`}
                      key={order.id}
                      title={new Date(order.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    >
                      <button
                        type="button"
                        className="order-card-trigger order-card-clickable"
                        aria-label={`View details for order ${order.id}`}
                        onClick={(event) => openOrderDetails(order, event)}
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
                                <strong>{order.customer || order.customerName || WALK_IN_CUSTOMER_NAME}</strong>
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

                        <div className="order-card-items-preview" aria-label={`${itemCount} ordered items`}>
                          {(order.items || []).slice(0, 3).map((item, itemIndex) => (
                            <div className="order-card-item-preview" key={`${item.title}-${itemIndex}`} title={`${item.quantity || 1} × ${item.title}`}>
                              <MenuProductImage
                                src={productImageByName.get(item.title)}
                                alt=""
                                className="order-card-item-thumb-image"
                              />
                              <span>{item.quantity || 1}×</span>
                            </div>
                          ))}
                          {itemCount > 3 && <span className="order-card-items-more">+{itemCount - 3}</span>}
                          {!order.items?.length && <span className="order-card-items-empty">No item details</span>}
                        </div>
                      </button>

                      <hr className="order-card-divider" />

                      <div className="order-card-actions">
                        <div className="order-status-select-wrap">
                          <select
                            value={order.status}
                            onChange={(e) => handleStatusChange(order.id, order.status, e.target.value)}
                            className={`order-status-select select-${order.status.toLowerCase()}`}
                            aria-label={`Update status for ${order.id}`}
                            title={
                              isLocked
                                ? (order.status === "Cancelled"
                                    ? `Order ${order.id} is cancelled and locked`
                                    : `Order ${order.id} is completed and locked`)
                                : `Advance order ${order.id} to ${allowedNext[0]}`
                            }
                            disabled={isLocked}
                          >
                            {order.status === "Cancelled" && (
                              <option value="Cancelled" disabled>
                                Cancelled
                              </option>
                            )}
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
                          onClick={() => setOrderToPrint(order)}
                          title={`Print receipt for ${order.id}`}
                          aria-label={`Print receipt for ${order.id}`}
                        >
                          <Printer aria-hidden="true" size={13} strokeWidth={2} />
                          <span>Print</span>
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
                Use the status selector to advance orders across Pending, Preparing, and Completed. Click any order card to inspect payment details or print receipts; order voids require Admin authorization.
              </p>
            </div>
          </div>
        </div>
      </main>
      )}

      {/* Shared Animated Order Details Modal */}
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
              setToastMessage(`Order ${updated.id} confirmed`);
            }
            return updated;
          }}
          onPrintReceipt={(ord) => {
            setSelectedOrder(null);
            setOrderToPrint(ord);
          }}
          onClosed={() => setSelectedOrder(null)}
        />
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
                  <span>CUSTOMER:</span> <strong>{orderToPrint.customer || orderToPrint.customerName || WALK_IN_CUSTOMER_NAME}</strong>
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

function OrderStat({ Icon, tone, label, value, note }) {
  return (
    <div className="order-stat-card">
      <div className={`order-stat-icon ${tone}`}><Icon size={20} strokeWidth={1.8} aria-hidden="true" /></div>
      <div className="order-stat-info">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </div>
  );
}

export default StaffOrder;

