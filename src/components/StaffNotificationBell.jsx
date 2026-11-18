import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  PlusCircle,
  Printer,
  ShoppingBag,
  Trash2,
} from "lucide-react";

import { isAlertEnabledForType, useNotifications } from "../hooks/useNotifications.js";
import {
  formatRelativeTime,
  playNotificationChime,
  STAFF_NOTIFICATION_TYPES,
} from "../utils/notifications.js";
import "../assets/css/staff-notifications.css";

const ICONS = {
  inventory_stock: AlertTriangle,
  inventory_low: AlertTriangle,
  inventory_inactive: AlertTriangle,
  inventory_waste: AlertTriangle,
  order_new: ShoppingBag,
  order_completed: CheckCircle2,
  receipt_printed: Printer,
  menu_added: PlusCircle,
  menu_deleted: Trash2,
  info: Bell,
};

function StaffNotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [isRinging, setIsRinging] = useState(false);
  const rootRef = useRef(null);
  const ringTimer = useRef(null);

  const handleArrival = useCallback((type, preferences) => {
    if (!isAlertEnabledForType(type, preferences)) return;
    if (preferences.audioChime !== false) playNotificationChime();
    setIsRinging(true);
    clearTimeout(ringTimer.current);
    ringTimer.current = setTimeout(() => setIsRinging(false), 900);
  }, []);

  const {
    notifications: visibleNotifications,
    unreadCount,
    markAllRead,
    clearNotifications,
    markOneRead,
  } = useNotifications({
    preferencesKey: "amaya-staff-preferences",
    preferencesEvent: "amaya-staff-preferences",
    onArrival: handleArrival,
  });

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setIsOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
      clearTimeout(ringTimer.current);
    };
  }, []);

  const openAndToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next && unreadCount > 0) markAllRead();
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
              <button type="button" className="staff-notif-link" onClick={markAllRead}>
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
                    onClick={() => markOneRead(item.id)}
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
              <button type="button" className="staff-notif-clear" onClick={clearNotifications}>
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
