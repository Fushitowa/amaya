/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const ThemeContext = createContext(null);
const THEME_STORAGE_KEY = "amaya-theme";

function readSavedTheme() {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark";
  } catch {
    return false;
  }
}

export function ThemeProvider({ children }) {
  const [darkMode, setDarkModeState] = useState(readSavedTheme);

  const setDarkMode = useCallback((value) => {
    setDarkModeState(Boolean(value));
  }, []);

  const toggleDarkMode = useCallback(() => {
    setDarkModeState((current) => !current);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, darkMode ? "dark" : "light");
    } catch {
      // The chosen theme still applies for this session when storage is unavailable.
    }
  }, [darkMode]);

  const value = useMemo(() => ({ darkMode, setDarkMode, toggleDarkMode }), [darkMode, setDarkMode, toggleDarkMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
