import { useEffect, useMemo, useRef, useState } from "react";

import NotificationIcon from "./NotificationIcon.jsx";
import { apiRequest } from "../utils/api.js";
import {
  formatRelativeTime,
  loadNotifications,
  readStaffNotifications,
  STAFF_NOTIFICATIONS_KEY,
  STAFF_NOTIFY_EVENT,
  writeStaffNotifications,
} from "../utils/notifications.js";
import "../assets/css/portal-notifications.css";

const palette = {
  border: "#E7E0D8",
  borderHover: "#D9CFC3",
  surface: "#FFFFFF",
  surfaceHover: "#F7F2ED",
  icon: "#5A3E2B",
  iconHover: "#3F2A1C",
  accent: "#B45309",
  ring: "rgba(90, 62, 43, 0.35)",
};

function readAdminPreferences() {
  try {
    return { notifications: true, orderAlerts: true, inventoryAlerts: true, ...JSON.parse(localStorage.getItem("amaya-admin-notifications") || "{}") };
  } catch {
    return { notifications: true, orderAlerts: true, inventoryAlerts: true };
  }
}

function PortalNotificationButton({
  label = "Notifications",
  iconSize = 20,
  className = "",
  onClick,
  ...rest
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState(readStaffNotifications);
  const [preferences, setPreferences] = useState(readAdminPreferences);
  const rootRef = useRef(null);

  const visibleNotifications = useMemo(() => {
    if (!preferences.notifications) return [];
    return notifications.filter((item) =>
      (preferences.orderAlerts || item.type !== "order_new")
      && (preferences.inventoryAlerts !== false || item.type !== "inventory_low"),
    );
  }, [notifications, preferences]);
  const unreadCount = useMemo(() => visibleNotifications.filter((item) => !item.read).length, [visibleNotifications]);
  const refresh = () => {
    setNotifications(readStaffNotifications());
    loadNotifications().then(setNotifications);
  };
  const saveNotifications = (next) => {
    try {
      setNotifications(writeStaffNotifications(next));
    } catch {
      refresh();
    }
  };

  useEffect(() => {
    const handleNotification = () => refresh();
    const handlePreferences = () => setPreferences(readAdminPreferences());
    const handleStorage = (event) => {
      if (event.key === STAFF_NOTIFICATIONS_KEY) refresh();
      if (event.key === "amaya-admin-notifications") handlePreferences();
    };
    const handleOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setIsOpen(false);
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener(STAFF_NOTIFY_EVENT, handleNotification);
    window.addEventListener("amaya:notifications-updated", handleNotification);
    window.addEventListener("amaya-admin-notification-preferences", handlePreferences);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    const poll = window.setInterval(handleNotification, 12000);
    return () => {
      window.removeEventListener(STAFF_NOTIFY_EVENT, handleNotification);
      window.removeEventListener("amaya:notifications-updated", handleNotification);
      window.removeEventListener("amaya-admin-notification-preferences", handlePreferences);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
      window.clearInterval(poll);
    };
  }, []);

  const markAllRead = async () => {
    saveNotifications(notifications.filter((item) => item.source !== "server").map((item) => ({ ...item, read: true })));
    await apiRequest("/notifications/read-all", { method: "PATCH", body: "{}" }).catch(() => {});
    refresh();
  };
  const clearNotifications = async () => {
    saveNotifications([]);
    await apiRequest("/notifications", { method: "DELETE" }).catch(() => {});
    refresh();
  };
  const markOneRead = async (id) => {
    const selected = notifications.find((item) => item.id === id);
    if (selected?.source === "server") {
      await apiRequest(`/notifications/${id}/read`, { method: "PATCH", body: "{}" }).catch(() => {});
      refresh();
      return;
    }
    saveNotifications(notifications.filter((item) => item.source !== "server").map((item) => item.id === id ? { ...item, read: true } : item));
  };
  const handleClick = (event) => {
    setIsOpen((current) => !current);
    onClick?.(event);
  };

  return (
    <div className="portal-notification-wrap" ref={rootRef}>
      <button
        type="button"
        className={`portal-notification-trigger ${className}`}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocus={() => setIsHovered(true)}
        onBlur={() => setIsHovered(false)}
        aria-label={unreadCount ? `${label}, ${unreadCount} unread` : label}
        title={label}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "40px",
          height: "40px",
          flex: "0 0 40px",
          padding: 0,
          borderRadius: "12px",
          border: `1px solid ${isHovered ? palette.borderHover : palette.border}`,
          background: isHovered ? palette.surfaceHover : palette.surface,
          color: isHovered ? palette.iconHover : palette.icon,
          cursor: "pointer",
          transition: "background-color 150ms ease, border-color 150ms ease, color 150ms ease",
          ...(isHovered ? { boxShadow: `0 0 0 3px ${palette.ring}` } : null),
        }}
        {...rest}
      >
        <NotificationIcon size={iconSize} />
        {unreadCount > 0 && <span className="portal-notification-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {isOpen && (
        <section className="portal-notification-panel" role="dialog" aria-label={label}>
          <header className="portal-notification-panel-header">
            <div><strong>Notifications</strong><span>{unreadCount ? `${unreadCount} unread` : "All caught up"}</span></div>
            {unreadCount > 0 && <button type="button" onClick={markAllRead}>Mark all read</button>}
          </header>
          <div className="portal-notification-list">
            {visibleNotifications.length ? visibleNotifications.map((item) => (
              <button key={item.id} type="button" className={`portal-notification-item ${item.read ? "is-read" : "is-unread"}`} onClick={() => markOneRead(item.id)}>
                <span className="portal-notification-item-dot" aria-hidden="true" />
                <span className="portal-notification-item-copy"><strong>{item.title}</strong><span>{item.message}</span><time dateTime={item.timestamp}>{formatRelativeTime(item.timestamp)}</time></span>
              </button>
            )) : <p className="portal-notification-empty">{preferences.notifications ? "Orders and menu updates will appear here." : "Admin notifications are turned off in Settings."}</p>}
          </div>
          {visibleNotifications.length > 0 && <footer className="portal-notification-panel-footer"><button type="button" onClick={clearNotifications}>Clear notifications</button></footer>}
        </section>
      )}
    </div>
  );
}

export default PortalNotificationButton;
