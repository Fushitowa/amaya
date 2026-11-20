import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  Bell,
  Check,
  CheckCheck,
  CircleCheck,
  Package,
  Printer,
  Search,
  ShoppingBag,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { ADMIN_NOTIFICATION_TYPES, formatRelativeTime } from "../../utils/notifications.js";
import { usePortalNotifications } from "../../hooks/usePortalNotifications.js";
import "../../assets/css/admin/AdminNotifications.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "read", label: "Read" },
];

const typeIcons = {
  order_new: ShoppingBag,
  order_completed: CircleCheck,
  receipt_printed: Printer,
  menu_added: Utensils,
  menu_deleted: Utensils,
  inventory_stock: Package,
  inventory_low: Package,
  inventory_inactive: Package,
  inventory_waste: Trash2,
};

// Plain-language description and the page each kind of notification points to
const typeMeta = {
  order_new: { area: "Orders", route: "/admin/reports", routeLabel: "Open sales & orders", summary: "A new customer order was placed at the counter." },
  order_completed: { area: "Orders", route: "/admin/reports", routeLabel: "Open sales & orders", summary: "An order was prepared and marked as completed." },
  receipt_printed: { area: "Receipts", route: "/admin/reports", routeLabel: "Open sales & orders", summary: "A receipt was printed for this order." },
  menu_added: { area: "Menu", route: "/admin/menu", routeLabel: "Open menu management", summary: "A new item was added to your menu." },
  menu_deleted: { area: "Menu", route: "/admin/archive", routeLabel: "Open archive", summary: "An item was removed from the menu and moved to the archive." },
  inventory_stock: { area: "Inventory", route: "/admin/inventory", routeLabel: "Open inventory", summary: "An ingredient reached a stock limit you set." },
  inventory_low: { area: "Inventory", route: "/admin/inventory", routeLabel: "Open inventory", summary: "An ingredient is running low and may need restocking." },
  inventory_inactive: { area: "Inventory", route: "/admin/inventory", routeLabel: "Open inventory", summary: "An ingredient has not been used for a while, or needs a stock check." },
  inventory_waste: { area: "Waste", route: "/admin/inventory", routeLabel: "Open inventory", summary: "Waste was recorded. Stock and waste costs were updated." },
};

const FALLBACK_META = { area: "Activity", route: "/admin", routeLabel: "Open dashboard", summary: "Something happened in the admin portal." };
const MANILA = { timeZone: "Asia/Manila" };

function parseMessageHighlights(message = "") {
  const highlights = [];
  const orderMatch = message.match(/#([A-Za-z0-9-_]+)/);
  if (orderMatch) highlights.push({ label: "Order", value: `#${orderMatch[1]}` });
  const amountMatch = message.match(/₱\s*([0-9,]+(?:\.[0-9]{2})?)/);
  if (amountMatch) highlights.push({ label: "Amount", value: `₱${amountMatch[1]}` });
  const quotedMatch = message.match(/[“"]([^”"]+)[”"]/);
  if (quotedMatch) highlights.push({ label: "Item", value: quotedMatch[1] });
  return highlights;
}

function dayKey(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleDateString("en-CA", MANILA);
}

function dayLabel(key) {
  if (key === "unknown") return "Earlier";
  if (key === dayKey(Date.now())) return "Today";
  if (key === dayKey(Date.now() - 86_400_000)) return "Yesterday";
  return new Date(`${key}T12:00:00+08:00`).toLocaleDateString("en-US", { ...MANILA, weekday: "long", month: "short", day: "numeric" });
}

function formatClock(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { ...MANILA, hour: "numeric", minute: "2-digit" });
}

function formatFullTimestamp(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString("en-US", { ...MANILA, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function AdminNotifications() {
  const navigate = useNavigate();
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { notifications, unreadCount, preferences, markAllRead, clearNotifications, markOneRead } = usePortalNotifications();
  const [activeFilter, setActiveFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const filteredNotifications = useMemo(() => {
    const query = search.trim().toLowerCase();
    return notifications.filter((item) => {
      const matchesFilter = activeFilter === "all" || (activeFilter === "unread" ? !item.read : item.read);
      const matchesSearch = !query || `${item.title} ${item.message}`.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [activeFilter, notifications, search]);

  // Open the chosen notification, or the newest one, so the detail side is never empty
  const selected = filteredNotifications.find((item) => item.id === selectedId) || filteredNotifications[0] || null;

  const groups = useMemo(() => {
    const byDay = new Map();
    filteredNotifications.forEach((item) => {
      const key = dayKey(item.timestamp);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(item);
    });
    return [...byDay.entries()].map(([key, items]) => ({ key, label: dayLabel(key), items }));
  }, [filteredNotifications]);

  const meta = selected ? (typeMeta[selected.type] || FALLBACK_META) : null;
  const tone = selected ? (ADMIN_NOTIFICATION_TYPES[selected.type]?.tone || "stone") : "stone";
  const typeLabel = selected ? (ADMIN_NOTIFICATION_TYPES[selected.type]?.label || "Notice") : "";
  const SelectedIcon = selected ? (typeIcons[selected.type] || Bell) : Bell;
  const highlights = useMemo(() => (selected ? parseMessageHighlights(selected.message) : []), [selected]);
  const readCount = notifications.length - unreadCount;

  // On a narrow screen the details sit below the list, so bring them into view
  // Opening a notification counts as reading it
  const openNotification = (id) => {
    setSelectedId(id);
    const opened = notifications.find((item) => item.id === id);
    if (opened && !opened.read) markOneRead(id);
    if (window.matchMedia("(max-width: 900px)").matches) {
      document.getElementById("notification-details")?.scrollIntoView({ block: "start" });
    }
  };

  const handleClearAll = () => {
    clearNotifications();
    setConfirmClear(false);
    setSelectedId(null);
  };

  return (
    <div className={`admin-notifications-page${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar role="admin" activeTab="notifications" sidebarCollapsed={sidebarCollapsed} onToggle={toggleSidebar} />

      <main className="admin-notifications-main">
        <header className="nt-topbar">
          <div className="nt-topbar-title">
            <span className="nt-label">ADMIN PORTAL</span>
            <h1>Notifications</h1>
            <span className={`nt-unread-count${unreadCount > 0 ? " has-unread" : ""}`} role="status">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </span>
          </div>
          <div className="nt-actions">
            <button type="button" className="nt-btn" onClick={markAllRead} disabled={!unreadCount}>
              <CheckCheck size={15} aria-hidden="true" /> Mark all as read
            </button>
            {confirmClear ? (
              <span className="nt-confirm" role="group" aria-label="Confirm clearing all notifications">
                <span>Delete all {notifications.length}?</span>
                <button type="button" className="nt-btn is-danger" onClick={handleClearAll}>Yes, delete</button>
                <button type="button" className="nt-btn" onClick={() => setConfirmClear(false)}>Cancel</button>
              </span>
            ) : (
              <button type="button" className="nt-btn is-danger" onClick={() => setConfirmClear(true)} disabled={!notifications.length}>
                <Trash2 size={15} aria-hidden="true" /> Clear all
              </button>
            )}
          </div>
        </header>

        <div className="nt-workspace">
          <section className="nt-list-pane" aria-label="Notification list">
            <div className="nt-toolbar">
              <div className="nt-tabs" role="group" aria-label="Show notifications">
                {FILTERS.map((filter) => {
                  const count = filter.key === "all" ? notifications.length : filter.key === "unread" ? unreadCount : readCount;
                  return (
                    <button
                      type="button"
                      key={filter.key}
                      className={activeFilter === filter.key ? "is-active" : ""}
                      onClick={() => setActiveFilter(filter.key)}
                      aria-pressed={activeFilter === filter.key}
                    >
                      {filter.label}<span>{count}</span>
                    </button>
                  );
                })}
              </div>
              <label className="nt-search">
                <Search size={15} aria-hidden="true" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search notifications" aria-label="Search notifications" />
                {search && (
                  <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
              </label>
            </div>

            <div className="nt-list">
              {groups.length ? groups.map((group) => (
                <div className="nt-group" key={group.key}>
                  <h2 className="nt-group-title">{group.label}</h2>
                  <ul>
                    {group.items.map((item) => {
                      const Icon = typeIcons[item.type] || Bell;
                      const definition = ADMIN_NOTIFICATION_TYPES[item.type];
                      const isSelected = selected?.id === item.id;
                      return (
                        <li key={item.id} className={`nt-row${item.read ? "" : " is-unread"}${isSelected ? " is-selected" : ""}`}>
                          <button type="button" className="nt-row-main" onClick={() => openNotification(item.id)} aria-current={isSelected ? "true" : undefined}>
                            <span className={`nt-icon tone-${definition?.tone || "stone"}`}><Icon size={17} strokeWidth={1.85} aria-hidden="true" /></span>
                            <span className="nt-row-copy">
                              <span className="nt-row-head">
                                <strong>{item.title}</strong>
                                {!item.read && <i className="nt-dot" aria-label="Unread" />}
                                <time dateTime={item.timestamp}>{formatClock(item.timestamp)}</time>
                              </span>
                              <span className="nt-row-text">{item.message || "No more details."}</span>
                            </span>
                          </button>
                          {!item.read && (
                            <button type="button" className="nt-row-read" onClick={() => markOneRead(item.id)} aria-label={`Mark "${item.title}" as read`} title="Mark as read">
                              <Check size={15} aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )) : (
                <div className="nt-empty">
                  <Bell size={22} aria-hidden="true" />
                  <strong>{search ? "No notifications match your search" : activeFilter === "unread" ? "You are all caught up" : "No notifications yet"}</strong>
                  <p>{search ? "Try different words, or clear the search." : preferences.notifications ? (preferences.orderAlerts === false ? "Stock alerts and other system updates will show up here. Staff order alerts are off in Settings." : "New orders, menu changes and stock alerts will show up here.") : "Notifications are turned off. You can turn them on in Settings."}</p>
                </div>
              )}
            </div>
          </section>

          <aside className="nt-detail-pane" aria-label="Notification details" id="notification-details">
            {selected ? (
              <article className="nt-detail" key={selected.id}>
                <header className="nt-detail-head">
                  <span className={`nt-icon is-large tone-${tone}`}><SelectedIcon size={22} strokeWidth={1.75} aria-hidden="true" /></span>
                  <div>
                    <div className="nt-detail-tags">
                      <span className={`nt-tag tone-${tone}`}>{typeLabel}</span>
                      <span className={`nt-status${selected.read ? "" : " is-unread"}`}>{selected.read ? "Read" : "Unread"}</span>
                    </div>
                    <h2>{selected.title}</h2>
                    <p className="nt-detail-time">{formatFullTimestamp(selected.timestamp)}{formatRelativeTime(selected.timestamp) ? ` (${formatRelativeTime(selected.timestamp)})` : ""}</p>
                  </div>
                </header>

                <div className="nt-detail-body">
                <section className="nt-detail-section">
                  <h3>What happened</h3>
                  <p className="nt-message">{selected.message || "There are no more details for this notification."}</p>
                  <p className="nt-summary">{meta.summary}</p>
                </section>

                {highlights.length > 0 && (
                  <section className="nt-detail-section">
                    <h3>Key details</h3>
                    <dl className="nt-facts">
                      {highlights.map((item) => (
                        <div key={item.label}>
                          <dt>{item.label}</dt>
                          <dd>{item.value}</dd>
                        </div>
                      ))}
                      <div>
                        <dt>Area</dt>
                        <dd>{meta.area}</dd>
                      </div>
                    </dl>
                  </section>
                )}
                </div>

                <footer className="nt-detail-actions">
                  {!selected.read && (
                    <button type="button" className="nt-btn" onClick={() => markOneRead(selected.id)}>
                      <CheckCheck size={15} aria-hidden="true" /> Mark as read
                    </button>
                  )}
                  <button type="button" className="nt-btn is-primary" onClick={() => navigate(meta.route)}>
                    {meta.routeLabel} <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                </footer>
              </article>
            ) : (
              <div className="nt-detail-empty">
                <Bell size={24} aria-hidden="true" />
                <strong>Nothing to show yet</strong>
                <p>When something happens, you will see the details here.</p>
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
