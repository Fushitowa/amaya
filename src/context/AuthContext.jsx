/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, getAuthToken, setAuthToken } from "../utils/api.js";

const AuthContext = createContext(null);

function readConfiguredIdleLockMinutes() {
  try {
    const raw = localStorage.getItem("amaya-idle-lock-minutes");
    if (raw === null || raw === "") return 15;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 240 ? parsed : 15;
  } catch {
    return 15;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(() => !getAuthToken());
  const [idleLockMinutes, setIdleLockMinutes] = useState(readConfiguredIdleLockMinutes);
  const idleTimerRef = useRef(null);

  useEffect(() => {
    const handleUnauthorized = () => setUser(null);
    const handleSettingsUpdated = (event) => {
      const nextMinutes = Number(event?.detail?.idleLockMinutes);
      if (Number.isInteger(nextMinutes) && nextMinutes >= 0 && nextMinutes <= 240) {
        setIdleLockMinutes(nextMinutes);
      }
    };
    window.addEventListener("amaya:unauthorized", handleUnauthorized);
    window.addEventListener("amaya:settings-updated", handleSettingsUpdated);
    return () => {
      window.removeEventListener("amaya:unauthorized", handleUnauthorized);
      window.removeEventListener("amaya:settings-updated", handleSettingsUpdated);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const token = getAuthToken();
    if (!token) return undefined;
    apiRequest("/auth/me")
      .then((profile) => { if (active) setUser(profile); })
      .catch(() => { if (active) setAuthToken(null); })
      .finally(() => { if (active) setAuthReady(true); });
    return () => { active = false; };
  }, []);

  const login = useCallback(async (username, password) => {
    const result = await apiRequest("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    setAuthToken(result.token);
    setUser(result.user);
    window.dispatchEvent(new CustomEvent("amaya:session-changed", { detail: { user: result.user } }));
    return result.user;
  }, []);

  const switchCashier = useCallback(async (password) => {
    const result = await apiRequest("/auth/switch-cashier", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setAuthToken(result.token);
    setUser(result.user);
    window.dispatchEvent(new CustomEvent("amaya:session-changed", { detail: { user: result.user } }));
    return result;
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
    window.dispatchEvent(new CustomEvent("amaya:session-changed", { detail: { user: null } }));
  }, []);

  useEffect(() => {
    if (!user || !idleLockMinutes || idleLockMinutes <= 0) return undefined;
    const timeoutMs = idleLockMinutes * 60_000;
    const resetTimer = () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        logout();
      }, timeoutMs);
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [idleLockMinutes, logout, user]);

  const value = useMemo(
    () => ({ user, authReady, login, switchCashier, logout }),
    [user, authReady, login, switchCashier, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
