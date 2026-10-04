const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001/api";
const AUTH_TOKEN_KEY = "amaya-session-token";

export function getAuthToken() {
  return sessionStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token) {
  if (token) sessionStorage.setItem(AUTH_TOKEN_KEY, token);
  else sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function apiRequest(path, options = {}) {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new Error("Could not reach the Amaya API. Make sure the API server is running.");
  }

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/auth/login") {
    setAuthToken(null);
    window.dispatchEvent(new Event("amaya:unauthorized"));
  }
  if (!response.ok) throw new Error(payload.message || `Request failed (${response.status}).`);
  return payload;
}

export { API_BASE_URL };
