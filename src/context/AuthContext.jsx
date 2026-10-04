/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest, setAuthToken } from "../utils/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(() => !sessionStorage.getItem("amaya-session-token"));

  useEffect(() => {
    const handleUnauthorized = () => setUser(null);
    window.addEventListener("amaya:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("amaya:unauthorized", handleUnauthorized);
  }, []);

  useEffect(() => {
    let active = true;
    const token = sessionStorage.getItem("amaya-session-token");
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
    return result.user;
  }, []);

  const logout = useCallback(() => {
    setAuthToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, authReady, login, logout }), [user, authReady, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
