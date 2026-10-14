import CustomerApp from "./apps/CustomerApp.jsx";
import PortalApp from "./apps/PortalApp.jsx";

// Vite's customer and portal modes are served from different local ports.
export default function App() {
  return import.meta.env.MODE === "portal" ? <PortalApp /> : <CustomerApp />;
}
