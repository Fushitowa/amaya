import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CheckCircle2,
  PlusCircle,
  Printer,
  ShoppingBag,
  Trash2,
} from "lucide-react";

import {
  formatRelativeTime,
  playNotificationChime,
  readStaffNotifications,
  STAFF_NOTIFICATIONS_KEY,
  STAFF_NOTIFICATION_TYPES,
  STAFF_NOTIFY_EVENT,
  writeStaffNotifications,
} from "../utils/notifications.js";
import "../assets/css/staff-notifications.css";

const ICONS = {
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
  const rootRef = useRef(null);
  const ringTimer = useRef(null);

  const load = useCallback(() => setNotifications(readStaffNotifications()), []);

  useEffect(() => {
    // Newest arrival: chime, flash, and re-read (the notifier is the writer).
    const handleNotification = () => {
      load();
      playNotificationChime();
      setIsRinging(true);
      clearTimeout(ringTimer.current);
      ringTimer.current = setTimeout(() => setIsRinging(false), 900);
    };

    // Cross-tab sync so an admin action lands on an already-open staff till.
    const handleStorage = (event) => {
      if (event.key === STAFF_NOTIFICATIONS_KEY) load();
    };

    const handleClickOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setIsOpen(false);
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener(STAFF_NOTIFY_EVENT, handleNotification);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener(STAFF_NOTIFY_EVENT, handleNotification);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      clearTimeout(ringTimer.current);
    };
  }, [load]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.read).length, [notifications]);

  const commit = (next) => {
    const capped = writeStaffNotifications(next);
    setNotifications(capped);
  };

  const markAllAsRead = () => {
    commit(notifications.map((item) => ({ ...item, read: true })));
  };

  const markOneAsRead = (id) => {
    commit(notifications.map((item) => (item.id === id ? { ...item, read: true } : item)));
  };

  const clearAll = () => commit([]);

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
            {notifications.length > 0 ? (
              notifications.map((item) => {
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
                <span>Orders, receipts and menu changes will appear here.</span>
              </div>
            )}
          </div>

          {notifications.length > 0 && (
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
