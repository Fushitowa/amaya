/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { apiRequest } from "../utils/api.js";
import { DEFAULT_TARGET_FOOD_COST, normalizeTargetFoodCost } from "../utils/menuCosting.js";

export const defaultBusinessSettings = {
  businessName: "Amaya's Drinks and Bites",
  email: "jessiecataya25@gmail.com",
  phone: "09636017184",
  address: "Barangay Lilingayon, Valencia City, Bukidnon",
  openingTime: "09:00",
  closingTime: "19:00",
  targetFoodCost: null,
};

const FOCUS_REFRESH_DEBOUNCE_MS = 5000;
const BusinessContext = createContext(null);

export function formatBusinessTime(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes || 0).padStart(2, "0")} ${period}`;
}

function getAuthIdentityKey(user) {
  if (!user || typeof user !== "object") return "anon";
  if (user.id != null) return `${user.id}:${user.role || ""}`;
  if (user.role || user.username) return `${user.username || ""}:${user.role || ""}`;
  return "anon";
}

function normalizeBusinessSettings(saved, isAdmin = false) {
  const source = saved && typeof saved === "object" ? saved : {};
  return {
    businessName: typeof source.businessName === "string" && source.businessName.trim()
      ? source.businessName.trim()
      : defaultBusinessSettings.businessName,
    email: typeof source.email === "string" ? source.email : defaultBusinessSettings.email,
    phone: typeof source.phone === "string" ? source.phone : defaultBusinessSettings.phone,
    address: typeof source.address === "string" ? source.address : defaultBusinessSettings.address,
    openingTime: typeof source.openingTime === "string" && source.openingTime
      ? source.openingTime
      : defaultBusinessSettings.openingTime,
    closingTime: typeof source.closingTime === "string" && source.closingTime
      ? source.closingTime
      : defaultBusinessSettings.closingTime,
    targetFoodCost: isAdmin
      ? normalizeTargetFoodCost(source.targetFoodCost, DEFAULT_TARGET_FOOD_COST)
      : null,
  };
}

export function BusinessProvider({ children }) {
  const { user, authReady } = useAuth() || {};
  const isAdmin = user?.role === "admin";
  const currentIdentityKey = getAuthIdentityKey(user);
  const [businessSettings, setBusinessSettings] = useState(defaultBusinessSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [settingsRefreshError, setSettingsRefreshError] = useState("");
  const requestSeqRef = useRef(0);
  const lastFetchAtRef = useRef(0);
  const isMountedRef = useRef(true);
  const settingsLoadedRef = useRef(false);
  const authSyncIdentityRef = useRef(null);
  const inFlightFetchRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const refreshBusinessSettings = useCallback(
    async ({ force = true, adminOverride = undefined, identityKey = undefined } = {}) => {
      const targetIdentityKey = identityKey ?? currentIdentityKey;
      const now = Date.now();
      if (!force && now - lastFetchAtRef.current < FOCUS_REFRESH_DEBOUNCE_MS) {
        return null;
      }
      if (inFlightFetchRef.current && inFlightFetchRef.current.identityKey === targetIdentityKey) {
        return inFlightFetchRef.current.promise;
      }

      const effectiveIsAdmin = typeof adminOverride === "boolean" ? adminOverride : isAdmin;
      const requestId = ++requestSeqRef.current;
      lastFetchAtRef.current = now;

      setSettingsLoading(true);

      const fetchPromise = (async () => {
        try {
          const saved = await apiRequest("/settings");
          if (!isMountedRef.current || requestId !== requestSeqRef.current) return null;
          const normalized = normalizeBusinessSettings(saved, effectiveIsAdmin);
          settingsLoadedRef.current = true;
          authSyncIdentityRef.current = targetIdentityKey;
          setBusinessSettings(normalized);
          setSettingsLoaded(true);
          setSettingsError("");
          setSettingsRefreshError("");
          return normalized;
        } catch (error) {
          if (!isMountedRef.current || requestId !== requestSeqRef.current) return null;
          const message = error?.message || "Could not load business settings.";
          if (!settingsLoadedRef.current) {
            setSettingsError(message);
          } else {
            setSettingsRefreshError(message);
          }
          console.error("Could not load business settings:", message);
          return null;
        } finally {
          if (inFlightFetchRef.current?.requestId === requestId) {
            inFlightFetchRef.current = null;
          }
          if (isMountedRef.current && requestId === requestSeqRef.current) {
            setSettingsLoading(false);
          }
        }
      })();

      inFlightFetchRef.current = {
        identityKey: targetIdentityKey,
        requestId,
        promise: fetchPromise,
      };
      return fetchPromise;
    },
    [currentIdentityKey, isAdmin],
  );

  useEffect(() => {
    if (!authReady) return undefined;
    if (authSyncIdentityRef.current === currentIdentityKey) return undefined;
    const timerId = window.setTimeout(() => {
      if (authSyncIdentityRef.current === currentIdentityKey) return;
      authSyncIdentityRef.current = currentIdentityKey;
      void refreshBusinessSettings({
        force: true,
        adminOverride: isAdmin,
        identityKey: currentIdentityKey,
      });
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [authReady, currentIdentityKey, isAdmin, refreshBusinessSettings]);

  useEffect(() => {
    const handleSessionChanged = (event) => {
      const nextUser = event?.detail?.user ?? null;
      const nextIsAdmin = nextUser?.role === "admin";
      const nextIdentityKey = getAuthIdentityKey(nextUser);
      const isIdentityChange = authSyncIdentityRef.current !== nextIdentityKey;
      authSyncIdentityRef.current = nextIdentityKey;
      if (isIdentityChange) {
        settingsLoadedRef.current = false;
        setSettingsLoaded(false);
      }
      if (!nextIsAdmin) {
        setBusinessSettings((prev) => ({ ...prev, targetFoodCost: null }));
      }
      void refreshBusinessSettings({
        force: true,
        adminOverride: nextIsAdmin,
        identityKey: nextIdentityKey,
      });
    };

    const handleUnauthorized = () => {
      const isIdentityChange = authSyncIdentityRef.current !== "anon";
      authSyncIdentityRef.current = "anon";
      if (isIdentityChange) {
        settingsLoadedRef.current = false;
        setSettingsLoaded(false);
      }
      setBusinessSettings((prev) => ({ ...prev, targetFoodCost: null }));
      if (inFlightFetchRef.current?.identityKey === "anon") return;
      void refreshBusinessSettings({
        force: true,
        adminOverride: false,
        identityKey: "anon",
      });
    };

    const handleFocus = () => {
      if (document.visibilityState === "hidden") return;
      void refreshBusinessSettings({ force: false });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void refreshBusinessSettings({ force: false });
    };

    window.addEventListener("amaya:session-changed", handleSessionChanged);
    window.addEventListener("amaya:unauthorized", handleUnauthorized);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("amaya:session-changed", handleSessionChanged);
      window.removeEventListener("amaya:unauthorized", handleUnauthorized);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshBusinessSettings]);

  const saveBusinessSettings = useCallback(async (updates) => {
    const saveSeq = ++requestSeqRef.current;
    lastFetchAtRef.current = Date.now();
    inFlightFetchRef.current = null;
    try {
      const saved = await apiRequest("/settings", { method: "PUT", body: JSON.stringify(updates) });
      const normalized = normalizeBusinessSettings(saved, true);
      if (isMountedRef.current && saveSeq === requestSeqRef.current) {
        lastFetchAtRef.current = Date.now();
        settingsLoadedRef.current = true;
        authSyncIdentityRef.current = currentIdentityKey;
        setBusinessSettings(normalized);
        setSettingsLoaded(true);
        setSettingsError("");
        setSettingsRefreshError("");
        setSettingsLoading(false);
      }
      return normalized;
    } catch (error) {
      if (isMountedRef.current && saveSeq === requestSeqRef.current) {
        setSettingsLoading(false);
      }
      throw error;
    }
  }, [currentIdentityKey]);

  const value = useMemo(
    () => ({
      businessSettings,
      settingsLoaded,
      settingsLoading,
      settingsError,
      settingsRefreshError,
      refreshBusinessSettings,
      saveBusinessSettings,
    }),
    [
      businessSettings,
      settingsLoaded,
      settingsLoading,
      settingsError,
      settingsRefreshError,
      refreshBusinessSettings,
      saveBusinessSettings,
    ],
  );
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  return useContext(BusinessContext);
}
