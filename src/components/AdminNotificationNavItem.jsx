import { Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { usePortalNotifications } from "../hooks/usePortalNotifications.js";

export default function AdminNotificationNavItem({ active = false }) {
  const { unreadCount } = usePortalNotifications();

  return (
    <Link
      to="/admin/notifications"
      className={`amaya-sidebar-link${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
      title="Notifications"
    >
      <Bell aria-hidden="true" />
      <span className="amaya-sidebar-link-label">Notifications</span>
      {unreadCount > 0 && <em className="amaya-sidebar-link-count">{unreadCount > 9 ? "9+" : unreadCount}</em>}
    </Link>
  );
}
