import { useState } from "react";
import { SidebarContext } from "./SidebarContextValue.jsx";

export function SidebarProvider({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => !collapsed);
  };

  return (
    <SidebarContext.Provider value={{ sidebarCollapsed, toggleSidebar }}>
      {children}
    </SidebarContext.Provider>
  );
}
