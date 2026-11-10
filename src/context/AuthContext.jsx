/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest, getAuthToken, setAuthToken } from "../utils/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(() => !getAuthToken());

  useEffect(() => {
    const handleUnauthorized = () => setUser(null);
    window.addEventListener("amaya:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("amaya:unauthorized", handleUnauthorized);
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

  const value = useMemo(
    () => ({ user, authReady, login, switchCashier, logout }),
    [user, authReady, login, switchCashier, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
