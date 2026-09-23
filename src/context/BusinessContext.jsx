/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const businessStorageKey = "amaya-business-settings";

export const defaultBusinessSettings = {
  businessName: "Amaya's Drinks and Bites",
  email: "jessiecataya25@gmail.com",
  phone: "09636017184",
  address: "Barangay Lilingayon, Valencia City, Bukidnon",
  openingTime: "09:00",
  closingTime: "19:00",
};

const BusinessContext = createContext(null);

function readBusinessSettings() {
  try {
    const savedSettings = localStorage.getItem(businessStorageKey);
    return savedSettings
      ? { ...defaultBusinessSettings, ...JSON.parse(savedSettings) }
      : defaultBusinessSettings;
  } catch {
    return defaultBusinessSettings;
  }
}

export function formatBusinessTime(time) {
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

export function BusinessProvider({ children }) {
  const [businessSettings, setBusinessSettings] = useState(readBusinessSettings);

  useEffect(() => {
    localStorage.setItem(businessStorageKey, JSON.stringify(businessSettings));
  }, [businessSettings]);

  useEffect(() => {
    const syncBusinessSettings = (event) => {
      if (event.key !== businessStorageKey || !event.newValue) return;

      try {
        setBusinessSettings({
          ...defaultBusinessSettings,
          ...JSON.parse(event.newValue),
        });
      } catch {
        // Ignore malformed values written by another tab.
      }
    };

    window.addEventListener("storage", syncBusinessSettings);
    return () => window.removeEventListener("storage", syncBusinessSettings);
  }, []);

  const value = useMemo(() => ({
    businessSettings,
    saveBusinessSettings: (updates) => {
      setBusinessSettings((current) => ({ ...current, ...updates }));
    },
  }), [businessSettings]);

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  return useContext(BusinessContext);
}
