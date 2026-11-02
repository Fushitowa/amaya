import { useMemo, useState } from "react";
import { Bell, CheckCheck, CircleCheck, Package, Printer, Search, ShoppingBag, Trash2, Utensils } from "lucide-react";
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

export default function AdminNotifications() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { notifications, unreadCount, preferences, markAllRead, clearNotifications, markOneRead } = usePortalNotifications();
  const [activeFilter, setActiveFilter] = useState("All");
  const [search, setSearch] = useState("");

  const filteredNotifications = useMemo(() => {
    const query = search.trim().toLowerCase();
    return notifications.filter((item) => {
      const matchesFilter = activeFilter === "All"
        || (activeFilter === "Unread" ? !item.read : item.read);
      const matchesSearch = !query || `${item.title} ${item.message}`.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [activeFilter, notifications, search]);

  return (
    <div className={`admin-notifications-page${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <Sidebar role="admin" activeTab="notifications" sidebarCollapsed={sidebarCollapsed} onToggle={toggleSidebar} />

      <main className="admin-notifications-main">
        <header className="admin-notifications-topbar">
          <div>
            <span className="admin-notifications-eyebrow">ADMIN PORTAL</span>
            <h1>Notifications</h1>
          </div>
          <div className="admin-notifications-topbar-count">
            <Bell size={17} aria-hidden="true" />
            <span>{unreadCount} unread</span>
          </div>
        </header>

        <div className="admin-notifications-content">
          <section className="admin-notifications-heading">
            <div>
              <span className="admin-notifications-section-label">ACTIVITY CENTER</span>
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
                return (
                  <article key={item.id} className={`admin-notification-item${item.read ? " is-read" : " is-unread"}`}>
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
                      <button type="button" className="admin-notification-mark-read" onClick={() => markOneRead(item.id)}>
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
      </main>
    </div>
  );
}
