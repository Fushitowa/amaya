import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

import App from "./App.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { MenuProvider } from "./context/MenuContext.jsx";
import { BusinessProvider } from "./context/BusinessContext.jsx";
import { OrdersProvider } from "./context/OrdersContext.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ThemeProvider>
      <BusinessProvider>
        <OrdersProvider>
          <MenuProvider>
            <App />
          </MenuProvider>
        </OrdersProvider>
      </BusinessProvider>
    </ThemeProvider>
  </StrictMode>
);