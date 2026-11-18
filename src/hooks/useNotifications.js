import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../utils/api.js";
import {
  loadNotifications,
  readStaffNotifications,
  STAFF_NOTIFICATIONS_KEY,
  STAFF_NOTIFY_EVENT,
  writeStaffNotifications,
} from "../utils/notifications.js";

export const INVENTORY_ALERT_TYPES = new Set([
  "inventory_stock",
  "inventory_low",
  "inventory_inactive",
  "inventory_waste",
]);

const DEFAULT_PREFERENCES = {
  notifications: true,
  orderAlerts: true,
  inventoryAlerts: true,
  audioChime: true,
};

function readAlertPreferences(storageKey) {
  try {
    return {
      ...DEFAULT_PREFERENCES,
      ...JSON.parse(localStorage.getItem(storageKey) || "{}"),
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function isAlertEnabledForType(type, preferences = DEFAULT_PREFERENCES) {
  if (preferences.notifications === false) return false;
  if (type === "order_new" && preferences.orderAlerts === false) return false;
  if (INVENTORY_ALERT_TYPES.has(type) && preferences.inventoryAlerts === false) return false;
  return true;
}

export function useNotifications({
  preferencesKey = "amaya-admin-notifications",
  preferencesEvent = "amaya-admin-notification-preferences",
  onArrival = null,
} = {}) {
  const [notifications, setNotifications] = useState(readStaffNotifications);
  const [preferences, setPreferences] = useState(() => readAlertPreferences(preferencesKey));
  const onArrivalRef = useRef(onArrival);

  useEffect(() => {
    onArrivalRef.current = onArrival;
  }, [onArrival]);

  const refresh = useCallback(() => {
    setNotifications(readStaffNotifications());
    loadNotifications().then(setNotifications).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    const syncRemote = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadNotifications()
        .then((list) => {
          if (active) setNotifications(list);
        })
        .catch(() => {});
    };

    const handleLocalUpdate = (event) => {
      if (active) setNotifications(readStaffNotifications());
      syncRemote();
      const type = event?.detail?.type;
      if (type && onArrivalRef.current) {
        const latestPrefs = readAlertPreferences(preferencesKey);
        if (active) setPreferences(latestPrefs);
        onArrivalRef.current(type, latestPrefs);
      }
    };

    const handlePreferences = () => {
      if (active) setPreferences(readAlertPreferences(preferencesKey));
    };

    const handleStorage = (event) => {
      if (event.key === STAFF_NOTIFICATIONS_KEY) handleLocalUpdate(null);
      if (event.key === preferencesKey) handlePreferences();
    };

    const handleVisibility = () => {
      if (document.visibilityState !== "hidden") syncRemote();
    };

    window.addEventListener(STAFF_NOTIFY_EVENT, handleLocalUpdate);
    window.addEventListener("amaya:notifications-updated", syncRemote);
    if (preferencesEvent) window.addEventListener(preferencesEvent, handlePreferences);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibility);

    const poll = window.setInterval(syncRemote, 12000);
    syncRemote();

    return () => {
      active = false;
      window.removeEventListener(STAFF_NOTIFY_EVENT, handleLocalUpdate);
      window.removeEventListener("amaya:notifications-updated", syncRemote);
      if (preferencesEvent) window.removeEventListener(preferencesEvent, handlePreferences);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(poll);
    };
  }, [preferencesEvent, preferencesKey]);

  const visibleNotifications = useMemo(
    () => notifications.filter((item) => isAlertEnabledForType(item.type, preferences)),
    [notifications, preferences],
  );

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
    try {
      await apiRequest("/notifications/read-all", { method: "PATCH", body: "{}" });
    } finally {
      refresh();
    }
  }, [notifications, refresh, saveNotifications]);

  const clearNotifications = useCallback(async () => {
    saveNotifications([]);
    try {
      await apiRequest("/notifications", { method: "DELETE" });
    } finally {
      refresh();
    }
  }, [refresh, saveNotifications]);

  const markOneRead = useCallback(async (id) => {
    const selected = notifications.find((item) => item.id === id);
    if (selected?.source === "server") {
      try {
        await apiRequest(`/notifications/${id}/read`, { method: "PATCH", body: "{}" });
      } finally {
        refresh();
      }
      return;
    }
    saveNotifications(
      notifications
        .filter((item) => item.source !== "server")
        .map((item) => (item.id === id ? { ...item, read: true } : item)),
    );
  }, [notifications, refresh, saveNotifications]);

  return {
    notifications: visibleNotifications,
    unreadCount,
    preferences,
    markAllRead,
    clearNotifications,
    markOneRead,
    refresh,
  };
}
