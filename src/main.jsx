import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

import App from "./App.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { MenuProvider } from "./context/MenuContext.jsx";
import { BusinessProvider } from "./context/BusinessContext.jsx";
import { OrdersProvider } from "./context/OrdersContext.jsx";
import InventoryProvider from "./context/InventoryContext.jsx";
import { AuthProvider } from "./context/AuthContext.jsx";

const isPortal = import.meta.env.MODE === "portal";
document.title = isPortal ? "Amaya Admin & Staff Portal" : "Amaya | Drinks & Bites";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {isPortal ? (
      <AuthProvider>
        <ThemeProvider>
          <BusinessProvider>
            <OrdersProvider>
              <MenuProvider>
                <InventoryProvider>
                  <App />
                </InventoryProvider>
              </MenuProvider>
            </OrdersProvider>
          </BusinessProvider>
        </ThemeProvider>
      </AuthProvider>
    ) : (
      <ThemeProvider>
        <BusinessProvider>
          <MenuProvider>
            <App />
          </MenuProvider>
        </BusinessProvider>
      </ThemeProvider>
    )}
  </StrictMode>
);
