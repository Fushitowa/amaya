/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../utils/api.js";

export const defaultBusinessSettings = {
  businessName: "Amaya's Drinks and Bites",
  email: "jessiecataya25@gmail.com",
  phone: "09636017184",
  address: "Barangay Lilingayon, Valencia City, Bukidnon",
  openingTime: "09:00",
  closingTime: "19:00",
  targetFoodCost: 0.3,
};

const BusinessContext = createContext(null);

export function formatBusinessTime(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes || 0).padStart(2, "0")} ${period}`;
}

function normalizeBusinessSettings(saved) {
  const merged = { ...defaultBusinessSettings, ...(saved || {}) };
  const parsedTarget = Number(merged.targetFoodCost);
  merged.targetFoodCost = Number.isFinite(parsedTarget) && parsedTarget > 0 && parsedTarget < 1
    ? parsedTarget
    : defaultBusinessSettings.targetFoodCost;
  return merged;
}

export function BusinessProvider({ children }) {
  const [businessSettings, setBusinessSettings] = useState(defaultBusinessSettings);

  useEffect(() => {
    let active = true;
    apiRequest("/settings")
      .then((saved) => { if (active) setBusinessSettings(normalizeBusinessSettings(saved)); })
      .catch((error) => console.error("Could not load business settings:", error.message));
    return () => { active = false; };
  }, []);

  const saveBusinessSettings = useCallback(async (updates) => {
    const saved = await apiRequest("/settings", { method: "PUT", body: JSON.stringify(updates) });
    const normalized = normalizeBusinessSettings(saved);
    setBusinessSettings(normalized);
    return normalized;
  }, []);

  const value = useMemo(() => ({ businessSettings, saveBusinessSettings }), [businessSettings, saveBusinessSettings]);
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  return useContext(BusinessContext);
}
