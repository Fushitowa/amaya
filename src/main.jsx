import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";

import App from "./App.jsx";
import { ThemeProvider } from "./context/ThemeContext.jsx";
import { MenuProvider } from "./context/MenuContext.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ThemeProvider>
      <MenuProvider>
        <App />
      </MenuProvider>
    </ThemeProvider>
  </StrictMode>
);