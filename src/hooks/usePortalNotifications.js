import { useNotifications } from "./useNotifications.js";

export function usePortalNotifications() {
  return useNotifications({
    preferencesKey: "amaya-admin-notifications",
    preferencesEvent: "amaya-admin-notification-preferences",
  });
}
