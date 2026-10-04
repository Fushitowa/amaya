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
};

const BusinessContext = createContext(null);

export function formatBusinessTime(time) {
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${period}`;
}

export function BusinessProvider({ children }) {
  const [businessSettings, setBusinessSettings] = useState(defaultBusinessSettings);

  useEffect(() => {
    let active = true;
    apiRequest("/settings")
      .then((saved) => { if (active) setBusinessSettings({ ...defaultBusinessSettings, ...saved }); })
      .catch((error) => console.error("Could not load business settings:", error.message));
    return () => { active = false; };
  }, []);

  const saveBusinessSettings = useCallback(async (updates) => {
    const saved = await apiRequest("/settings", { method: "PUT", body: JSON.stringify(updates) });
    setBusinessSettings({ ...defaultBusinessSettings, ...saved });
    return saved;
  }, []);

  const value = useMemo(() => ({ businessSettings, saveBusinessSettings }), [businessSettings, saveBusinessSettings]);
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  return useContext(BusinessContext);
}
