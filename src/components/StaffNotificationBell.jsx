import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  PlusCircle,
  Printer,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { apiRequest } from "../utils/api.js";

import {
  formatRelativeTime,
  loadNotifications,
  playNotificationChime,
  readStaffNotifications,
  STAFF_NOTIFICATIONS_KEY,
  STAFF_NOTIFICATION_TYPES,
  STAFF_NOTIFY_EVENT,
  writeStaffNotifications,
} from "../utils/notifications.js";
import "../assets/css/staff-notifications.css";

const ICONS = {
  inventory_low: AlertTriangle,
  order_new: ShoppingBag,
  order_completed: CheckCircle2,
  receipt_printed: Printer,
  menu_added: PlusCircle,
  menu_deleted: Trash2,
  info: Bell,
};

function StaffNotificationBell() {
  // Read straight from storage on first render; the effect below only
  // subscribes to external changes, so no cascading setState on mount.
  const [notifications, setNotifications] = useState(readStaffNotifications);
  const [isOpen, setIsOpen] = useState(false);
  const [isRinging, setIsRinging] = useState(false);
  const [inventoryAlertsEnabled, setInventoryAlertsEnabled] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("amaya-staff-preferences") || "{}").inventoryAlerts !== false;
    } catch { return true; }
  });
  const rootRef = useRef(null);
  const ringTimer = useRef(null);

  const load = useCallback(() => {
    setNotifications(readStaffNotifications());
    loadNotifications().then(setNotifications);
  }, []);

  useEffect(() => {
    // Newest arrival: chime, flash, and re-read (the notifier is the writer).
    const handleNotification = (event) => {
      load();
      let preferences = {};
      try {
        preferences = JSON.parse(localStorage.getItem("amaya-staff-preferences") || "{}");
      } catch { /* Keep default alert behavior when browser storage is unavailable. */ }
      const alertEnabled = preferences.notifications !== false
        && !(event.detail?.type === "order_new" && preferences.orderAlerts === false)
        && !(event.detail?.type === "inventory_low" && preferences.inventoryAlerts === false);
      if (!alertEnabled) return;
      if (preferences.audioChime !== false) playNotificationChime();
      setIsRinging(true);
      clearTimeout(ringTimer.current);
      ringTimer.current = setTimeout(() => setIsRinging(false), 900);
    };

    // Cross-tab sync so an admin action lands on an already-open staff till.
    const handleStorage = (event) => {
      if (event.key === STAFF_NOTIFICATIONS_KEY) load();
      if (event.key === "amaya-staff-preferences") {
        try { setInventoryAlertsEnabled(JSON.parse(event.newValue || "{}").inventoryAlerts !== false); }
        catch { setInventoryAlertsEnabled(true); }
      }
    };
    const handlePreferenceChange = () => {
      try { setInventoryAlertsEnabled(JSON.parse(localStorage.getItem("amaya-staff-preferences") || "{}").inventoryAlerts !== false); }
      catch { setInventoryAlertsEnabled(true); }
    };

    const handleClickOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setIsOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener(STAFF_NOTIFY_EVENT, handleNotification);
    window.addEventListener("amaya:notifications-updated", load);
    window.addEventListener("storage", handleStorage);
    const poll = window.setInterval(handleNotification, 12000);
    window.addEventListener("amaya-staff-preferences", handlePreferenceChange);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener(STAFF_NOTIFY_EVENT, handleNotification);
      window.removeEventListener("amaya:notifications-updated", load);
      window.removeEventListener("storage", handleStorage);
      window.clearInterval(poll);
      window.removeEventListener("amaya-staff-preferences", handlePreferenceChange);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      clearTimeout(ringTimer.current);
    };
  }, [load]);

  const visibleNotifications = useMemo(() => notifications.filter((item) => inventoryAlertsEnabled || item.type !== "inventory_low"), [inventoryAlertsEnabled, notifications]);
  const unreadCount = useMemo(() => visibleNotifications.filter((item) => !item.read).length, [visibleNotifications]);

  const commit = (next) => {
    const capped = writeStaffNotifications(next);
    setNotifications(capped);
  };

  const markAllAsRead = async () => {
    commit(notifications.filter((item) => item.source !== "server").map((item) => ({ ...item, read: true })));
    await apiRequest("/notifications/read-all", { method: "PATCH", body: "{}" }).catch(() => {});
    load();
  };

  const markOneAsRead = async (id) => {
    const selected = notifications.find((item) => item.id === id);
    if (selected?.source === "server") {
      await apiRequest(`/notifications/${id}/read`, { method: "PATCH", body: "{}" }).catch(() => {});
      load();
      return;
    }
    commit(notifications.filter((item) => item.source !== "server").map((item) => item.id === id ? { ...item, read: true } : item));
  };

  const clearAll = async () => {
    commit([]);
    await apiRequest("/notifications", { method: "DELETE" }).catch(() => {});
    load();
  };

  const openAndToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    // Opening the panel is an implicit acknowledgement.
    if (next && unreadCount > 0) markAllAsRead();
  };

  return (
    <div className="staff-notif" ref={rootRef}>
      <button
        type="button"
        className={`staff-notif-trigger ${isRinging ? "ringing" : ""}`}
        onClick={openAndToggle}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title="Notifications"
      >
        <Bell size={20} strokeWidth={1.9} aria-hidden="true" />

        {unreadCount > 0 && (
          <span className="staff-notif-badge" aria-hidden="true">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="staff-notif-panel" role="menu" aria-label="Notifications">
          <header className="staff-notif-head">
            <div className="staff-notif-head-title">
              <h3>Notifications</h3>
              {unreadCount > 0 && <span className="staff-notif-pill">{unreadCount} new</span>}
            </div>
            {unreadCount > 0 && (
              <button type="button" className="staff-notif-link" onClick={markAllAsRead}>
                Mark all read
              </button>
            )}
          </header>

          <div className="staff-notif-list">
            {visibleNotifications.length > 0 ? (
              visibleNotifications.map((item) => {
                const tone = (STAFF_NOTIFICATION_TYPES[item.type] || STAFF_NOTIFICATION_TYPES.info).tone;
                const Icon = ICONS[item.type] || Bell;

                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className={`staff-notif-item ${item.read ? "read" : "unread"}`}
                    onClick={() => markOneAsRead(item.id)}
                  >
                    <span className={`staff-notif-icon ${tone}`} aria-hidden="true">
                      <Icon size={15} strokeWidth={2} />
                    </span>
                    <span className="staff-notif-body">
                      <strong>{item.title}</strong>
                      <span className="staff-notif-message">{item.message}</span>
                      <time className="staff-notif-time" dateTime={item.timestamp}>
                        {formatRelativeTime(item.timestamp)}
                      </time>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="staff-notif-empty">
                <Bell size={22} strokeWidth={1.7} aria-hidden="true" />
                <strong>No notifications yet</strong>
                <span>Orders, receipts, menu changes and stock alerts will appear here.</span>
              </div>
            )}
          </div>

          {visibleNotifications.length > 0 && (
            <footer className="staff-notif-foot">
              <button type="button" className="staff-notif-clear" onClick={clearAll}>
                Clear all notifications
              </button>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}

export default StaffNotificationBell;
