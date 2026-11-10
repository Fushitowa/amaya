import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../utils/api.js";
import {
  loadNotifications,
  readStaffNotifications,
  STAFF_NOTIFICATIONS_KEY,
  STAFF_NOTIFY_EVENT,
  writeStaffNotifications,
} from "../utils/notifications.js";

function readAdminPreferences() {
  try {
    return {
      notifications: true,
      orderAlerts: true,
      inventoryAlerts: true,
      ...JSON.parse(localStorage.getItem("amaya-admin-notifications") || "{}"),
    };
  } catch {
    return { notifications: true, orderAlerts: true, inventoryAlerts: true };
  }
}

export function usePortalNotifications() {
  const [notifications, setNotifications] = useState(readStaffNotifications);
  const [preferences, setPreferences] = useState(readAdminPreferences);

  const refresh = useCallback(() => {
    loadNotifications().then(setNotifications).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    const syncRemote = () => {
      loadNotifications()
        .then((list) => {
          if (active) setNotifications(list);
        })
        .catch(() => {});
    };
    const handleLocalUpdate = () => {
      setNotifications(readStaffNotifications());
      syncRemote();
    };
    const handlePreferences = () => setPreferences(readAdminPreferences());
    const handleStorage = (event) => {
      if (event.key === STAFF_NOTIFICATIONS_KEY) handleLocalUpdate();
      if (event.key === "amaya-admin-notifications") handlePreferences();
    };

    window.addEventListener(STAFF_NOTIFY_EVENT, handleLocalUpdate);
    window.addEventListener("amaya:notifications-updated", syncRemote);
    window.addEventListener("amaya-admin-notification-preferences", handlePreferences);
    window.addEventListener("storage", handleStorage);
    const poll = window.setInterval(syncRemote, 12000);
    syncRemote();

    return () => {
      active = false;
      window.removeEventListener(STAFF_NOTIFY_EVENT, handleLocalUpdate);
      window.removeEventListener("amaya:notifications-updated", syncRemote);
      window.removeEventListener("amaya-admin-notification-preferences", handlePreferences);
      window.removeEventListener("storage", handleStorage);
      window.clearInterval(poll);
    };
  }, []);

  const visibleNotifications = useMemo(() => {
    if (!preferences.notifications) return [];
    return notifications.filter((item) =>
      (preferences.orderAlerts || item.type !== "order_new")
      && (preferences.inventoryAlerts !== false || !["inventory_stock", "inventory_low", "inventory_inactive"].includes(item.type)),
    );
  }, [notifications, preferences]);
  const unreadCount = useMemo(
    () => visibleNotifications.filter((item) => !item.read).length,
    [visibleNotifications],
  );

  const saveNotifications = useCallback((next) => {
    try {
      setNotifications(writeStaffNotifications(next));
    } catch {
      refresh();
    }
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    saveNotifications(notifications.filter((item) => item.source !== "server").map((item) => ({ ...item, read: true })));
    await apiRequest("/notifications/read-all", { method: "PATCH", body: "{}" }).catch(() => {});
    refresh();
  }, [notifications, refresh, saveNotifications]);

  const clearNotifications = useCallback(async () => {
    saveNotifications([]);
    await apiRequest("/notifications", { method: "DELETE" }).catch(() => {});
    refresh();
  }, [refresh, saveNotifications]);

  const markOneRead = useCallback(async (id) => {
    const selected = notifications.find((item) => item.id === id);
    if (selected?.source === "server") {
      await apiRequest(`/notifications/${id}/read`, { method: "PATCH", body: "{}" }).catch(() => {});
      refresh();
      return;
    }
    saveNotifications(notifications.filter((item) => item.source !== "server").map((item) =>
      item.id === id ? { ...item, read: true } : item,
    ));
  }, [notifications, refresh, saveNotifications]);

  return { notifications: visibleNotifications, unreadCount, preferences, markAllRead, clearNotifications, markOneRead, refresh };
}
