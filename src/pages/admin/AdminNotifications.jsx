import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Bell,
  Calendar,
  CheckCheck,
  CircleCheck,
  Clock,
  Hash,
  Info,
  Layers,
  Package,
  Printer,
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
  Utensils,
} from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { STAFF_NOTIFICATION_TYPES, formatRelativeTime } from "../../utils/notifications.js";
import { usePortalNotifications } from "../../hooks/usePortalNotifications.js";
import "../../assets/css/admin/AdminNotifications.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const filters = ["All", "Unread", "Read"];
const typeIcons = {
  order_new: ShoppingBag,
  order_completed: CircleCheck,
  receipt_printed: Printer,
  menu_added: Utensils,
  menu_deleted: Utensils,
  inventory_stock: Package,
  inventory_low: Package,
  inventory_inactive: Package,
};

const typeMeta = {
  order_new: {
    module: "POS & Orders",
    route: "/admin/reports",
    routeLabel: "View Sales & Orders",
    summary: "A new customer order was recorded at the point of sale terminal.",
  },
  order_completed: {
    module: "Order Fulfillment",
    route: "/admin/reports",
    routeLabel: "View Sales & Orders",
    summary: "An active order has been fulfilled and marked as completed.",
  },
  receipt_printed: {
    module: "Billing & Receipts",
    route: "/admin/reports",
    routeLabel: "View Transaction Logs",
    summary: "A physical or digital receipt was generated for this transaction.",
  },
  menu_added: {
    module: "Menu Management",
    route: "/admin/menu",
    routeLabel: "Open Menu Management",
    summary: "A new catalog item was added and published to the store menu.",
  },
  menu_deleted: {
    module: "Menu & Archive",
    route: "/admin/archive",
    routeLabel: "Open 30-Day Archive",
    summary: "A menu item was removed from the active catalog and moved to archive.",
  },
  inventory_stock: {
    module: "Inventory Control",
    route: "/admin/inventory",
    routeLabel: "Open Inventory",
    summary: "Stock threshold notification triggered by inventory monitoring.",
  },
  inventory_low: {
    module: "Inventory Control",
    route: "/admin/inventory",
    routeLabel: "Replenish Inventory",
    summary: "Stock levels have dropped below the recommended minimum threshold.",
  },
  inventory_inactive: {
    module: "Inventory Control",
    route: "/admin/inventory",
    routeLabel: "Review Inventory",
    summary: "An inventory item was marked inactive or requires stock verification.",
  },
};

function parseMessageHighlights(message = "") {
  const highlights = [];
  const orderMatch = message.match(/#([A-Za-z0-9-_]+)/);
  if (orderMatch) {
    highlights.push({ label: "Order Reference", value: `#${orderMatch[1]}` });
  }
  const amountMatch = message.match(/₱\s*([0-9,]+(?:\.[0-9]{2})?)/);
  if (amountMatch) {
    highlights.push({ label: "Transaction Amount", value: `₱${amountMatch[1]}` });
  }
  const quotedMatch = message.match(/[“"]([^”"]+)[”"]/);
  if (quotedMatch) {
    highlights.push({ label: "Affected Item", value: quotedMatch[1] });
  }
  return highlights;
}

function formatFullTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AdminNotifications() {
  const navigate = useNavigate();
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { notifications, unreadCount, preferences, markAllRead, clearNotifications, markOneRead } = usePortalNotifications();
  const [activeFilter, setActiveFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const filteredNotifications = useMemo(() => {
    const query = search.trim().toLowerCase();
    return notifications.filter((item) => {
      const matchesFilter = activeFilter === "All"
        || (activeFilter === "Unread" ? !item.read : item.read);
      const matchesSearch = !query || `${item.title} ${item.message}`.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [activeFilter, notifications, search]);

  const selectedNotification = useMemo(() => {
    if (!filteredNotifications.length) return null;
    if (selectedId) {
      const found = filteredNotifications.find((item) => item.id === selectedId);
      if (found) return found;
    }
    return null;
  }, [filteredNotifications, selectedId]);

  const SelectedIcon = selectedNotification ? (typeIcons[selectedNotification.type] || Bell) : Bell;
  const selectedTone = selectedNotification
    ? (STAFF_NOTIFICATION_TYPES[selectedNotification.type]?.tone || "stone")
    : "stone";
  const selectedTypeLabel = selectedNotification
    ? (STAFF_NOTIFICATION_TYPES[selectedNotification.type]?.label || "Notice")
    : "";
  const selectedMeta = selectedNotification
    ? (typeMeta[selectedNotification.type] || {
        module: "System Activity",
        route: "/admin",
        routeLabel: "Go to Dashboard",
        summary: "System activity notification recorded in the admin portal.",
      })
    : null;
  const selectedHighlights = useMemo(
    () => (selectedNotification ? parseMessageHighlights(selectedNotification.message) : []),
    [selectedNotification]
  );

  return (
    <div className={`admin-notifications-page${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar role="admin" activeTab="notifications" sidebarCollapsed={sidebarCollapsed} onToggle={toggleSidebar} />

      <main className="admin-notifications-main">
        <header className="admin-notifications-topbar">
          <div>
            <span className="admin-notifications-eyebrow">ACTIVITY CENTER</span>
            <h1>Notifications</h1>
          </div>
          <div className="admin-notifications-topbar-count">
            <Bell size={17} aria-hidden="true" />
            <span>{unreadCount} unread</span>
          </div>
        </header>

        <div className="admin-notifications-workspace">
          <div className="admin-notifications-content">
            <section className="admin-notifications-heading">
              <div>
                <h2>All notifications</h2>
                <p>Review recent order, menu, and inventory updates.</p>
              </div>
              <div className="admin-notifications-actions">
                <button type="button" onClick={markAllRead} disabled={!unreadCount}>
                  <CheckCheck size={16} aria-hidden="true" /> Mark all read
                </button>
                <button type="button" className="admin-notifications-clear" onClick={clearNotifications} disabled={!notifications.length}>
                  <Trash2 size={15} aria-hidden="true" /> Clear all
                </button>
              </div>
            </section>

            <section className="admin-notifications-panel" aria-label="Notification list">
              <div className="admin-notifications-toolbar">
                <div className="admin-notifications-filters" role="group" aria-label="Filter notifications">
                  {filters.map((filter) => {
                    const count = filter === "All" ? notifications.length : filter === "Unread" ? unreadCount : notifications.length - unreadCount;
                    return (
                      <button
                        type="button"
                        key={filter}
                        className={activeFilter === filter ? "active" : ""}
                        onClick={() => setActiveFilter(filter)}
                        aria-pressed={activeFilter === filter}
                      >
                        {filter}<span>{count}</span>
                      </button>
                    );
                  })}
                </div>
                <label className="admin-notifications-search">
                  <Search size={16} aria-hidden="true" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notifications" aria-label="Search notifications" />
                </label>
              </div>

              <div className="admin-notifications-list">
                {filteredNotifications.length ? filteredNotifications.map((item) => {
                  const Icon = typeIcons[item.type] || Bell;
                  const type = STAFF_NOTIFICATION_TYPES[item.type]?.label || "Notice";
                  const isSelected = selectedNotification?.id === item.id;
                  return (
                    <article
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      aria-selected={isSelected}
                      onClick={() => setSelectedId(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(item.id);
                        }
                      }}
                      className={`admin-notification-item${item.read ? " is-read" : " is-unread"}${isSelected ? " is-selected" : ""}`}
                    >
                      <div className={`admin-notification-item-icon ${STAFF_NOTIFICATION_TYPES[item.type]?.tone || "stone"}`}>
                        <Icon size={18} strokeWidth={1.9} aria-hidden="true" />
                      </div>
                      <div className="admin-notification-item-copy">
                        <div className="admin-notification-item-heading">
                          <strong>{item.title}</strong>
                          {!item.read && <span className="admin-notification-unread-dot" aria-label="Unread" />}
                        </div>
                        <p>{item.message || "There are no additional details for this notification."}</p>
                        <div className="admin-notification-item-meta">
                          <span>{type}</span>
                          <time dateTime={item.timestamp}>{formatRelativeTime(item.timestamp)}</time>
                        </div>
                      </div>
                      {!item.read && (
                        <button
                          type="button"
                          className="admin-notification-mark-read"
                          onClick={(event) => {
                            event.stopPropagation();
                            markOneRead(item.id);
                          }}
                        >
                          Mark read
                        </button>
                      )}
                    </article>
                  );
                }) : (
                  <div className="admin-notifications-empty">
                    <div><Bell size={22} aria-hidden="true" /></div>
                    <strong>{search ? "No matching notifications" : activeFilter === "Unread" ? "You’re all caught up" : "No notifications yet"}</strong>
                    <p>{preferences.notifications ? "New order, menu, and inventory updates will appear here." : "Notifications are turned off in Settings."}</p>
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="admin-notification-detail-pane" aria-label="Notification details">
            {selectedNotification ? (
              <div className="admin-notification-detail-card" key={selectedNotification.id}>
                <div className="admin-notification-detail-hero">
                  <div className="admin-notification-detail-hero-top">
                    <div className={`admin-notification-detail-icon ${selectedTone}`}>
                      <SelectedIcon size={24} strokeWidth={1.9} aria-hidden="true" />
                    </div>
                    <div className="admin-notification-detail-badges">
                      <span className={`admin-notification-detail-pill tone-${selectedTone}`}>
                        {selectedTypeLabel}
                      </span>
                      <span className={`admin-notification-detail-status ${selectedNotification.read ? "read" : "unread"}`}>
                        <span className="status-dot" />
                        {selectedNotification.read ? "Read" : "Unread"}
                      </span>
                    </div>
                  </div>

                  <h2 className="admin-notification-detail-title">{selectedNotification.title}</h2>
                  <p className="admin-notification-detail-subtitle">{selectedMeta.summary}</p>
                </div>

                <div className="admin-notification-detail-body">
                  <div className="admin-notification-detail-message-box">
                    <span className="admin-notification-detail-section-tag">
                      <Info size={13} aria-hidden="true" /> Event Message
                    </span>
                    <p>{selectedNotification.message || "There are no additional details for this notification."}</p>
                  </div>

                  {selectedHighlights.length > 0 && (
                    <div className="admin-notification-detail-highlights">
                      {selectedHighlights.map((hl) => (
                        <div className="admin-notification-highlight-chip" key={hl.label}>
                          <span>{hl.label}</span>
                          <strong>{hl.value}</strong>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="admin-notification-detail-grid">
                    <div className="admin-notification-meta-tile">
                      <span className="meta-tile-label">
                        <Calendar size={13} aria-hidden="true" /> Date & Time
                      </span>
                      <strong>{formatFullTimestamp(selectedNotification.timestamp)}</strong>
                    </div>

                    <div className="admin-notification-meta-tile">
                      <span className="meta-tile-label">
                        <Clock size={13} aria-hidden="true" /> Relative Time
                      </span>
                      <strong>{formatRelativeTime(selectedNotification.timestamp) || "Just now"}</strong>
                    </div>

                    <div className="admin-notification-meta-tile">
                      <span className="meta-tile-label">
                        <Layers size={13} aria-hidden="true" /> Source Module
                      </span>
                      <strong>{selectedMeta.module}</strong>
                    </div>

                    <div className="admin-notification-meta-tile">
                      <span className="meta-tile-label">
                        <Hash size={13} aria-hidden="true" /> Event Reference
                      </span>
                      <strong className="mono">{selectedNotification.eventKey || selectedNotification.id}</strong>
                    </div>
                  </div>
                </div>

                <footer className="admin-notification-detail-footer">
                  {!selectedNotification.read && (
                    <button
                      type="button"
                      className="detail-btn-secondary"
                      onClick={() => markOneRead(selectedNotification.id)}
                    >
                      <CheckCheck size={16} aria-hidden="true" />
                      Mark as read
                    </button>
                  )}
                  <button
                    type="button"
                    className="detail-btn-primary"
                    onClick={() => navigate(selectedMeta.route)}
                  >
                    <span>{selectedMeta.routeLabel}</span>
                    <ArrowUpRight size={16} aria-hidden="true" />
                  </button>
                </footer>
              </div>
            ) : (
              <div className="admin-notification-detail-empty">
                <div className="admin-notification-detail-empty-icon">
                  <Sparkles size={24} aria-hidden="true" />
                </div>
                <h3>Select a notification to inspect</h3>
                <p>
                  Click any notification from the activity stream on the left to view its full message, timestamp breakdown, and quick module actions.
                </p>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
