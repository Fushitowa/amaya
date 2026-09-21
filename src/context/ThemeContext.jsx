import { createContext, useContext } from "react";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const darkMode = false;

  const setDarkMode = () => {};
  const toggleDarkMode = () => {};

  return (
    <ThemeContext.Provider
      value={{
        darkMode,
        setDarkMode,
        toggleDarkMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}