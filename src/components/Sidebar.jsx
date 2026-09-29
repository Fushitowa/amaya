import { Link } from "react-router-dom";
import {
  ArrowLeft,
  BarChart2,
  LayoutGrid,
  LogOut,
  Package,
  Settings,
  ShoppingBag,
  Utensils,
} from "lucide-react";

import amayaLogo from "../assets/images/amayalogo.png";
import SidebarLogoButton from "./SidebarLogoButton.jsx";

const NAV_BY_ROLE = {
  admin: [
    {
      label: "MAIN MENU",
      items: [
        { key: "dashboard", to: "/admin", label: "Dashboard", Icon: LayoutGrid },
        { key: "orders", to: "/admin/orders", label: "Orders", Icon: ShoppingBag, countKey: true },
        { key: "inventory", to: "/admin/inventory", label: "Inventory", Icon: Package },
        { key: "menu", to: "/admin/menu", label: "Menu Management", Icon: Utensils },
      ],
    },
    {
      label: "MANAGEMENT",
      items: [
        { key: "reports", to: "/admin/reports", label: "Reports", Icon: BarChart2 },
        { key: "settings", to: "/admin/settings", label: "Settings", Icon: Settings },
      ],
    },
  ],
  staff: [
    {
      label: "MAIN MENU",
      items: [
        { key: "menu", to: "/staff/menu", label: "Menu", Icon: Utensils },
        { key: "dashboard", to: "/staff/dashboard", label: "Dashboard", Icon: LayoutGrid },
        { key: "orders", to: "/staff/orders", label: "Orders", Icon: ShoppingBag, countKey: true },
      ],
    },
    {
      label: "ACCOUNT",
      items: [
        { key: "settings", to: "/staff/settings", label: "Settings", Icon: Settings },
      ],
    },
  ],
};

function Sidebar({
  role = "admin",
  activeTab = "",
  orderCount = 0,
  sidebarCollapsed = false,
  onToggle,
  sections = NAV_BY_ROLE[role],
  logo = amayaLogo,
  className = "",
}) {
  const resolvedSections = sections || NAV_BY_ROLE.admin;
  const portalLabel = role === "staff" ? "Staff Portal" : "Admin Portal";

  return (
    <aside className={`amaya-sidebar ${className}`.trim()}>
      <div className="amaya-sidebar-brand">
        <SidebarLogoButton
          logo={logo}
          alt="Amaya's Drinks & Bites"
          collapsed={sidebarCollapsed}
          onToggle={onToggle}
        />
        <div className="amaya-sidebar-brand-text">
          <strong>Amaya</strong>
          <span>{portalLabel}</span>
        </div>
      </div>

      <nav className="amaya-sidebar-nav" aria-label={`${portalLabel} navigation`}>
        {resolvedSections.map((section) => (
          <div className="amaya-sidebar-section" key={section.label}>
            <span className="amaya-sidebar-section-label">{section.label}</span>
            {section.items.map((item) => {
              const isActive = item.key === activeTab;
              const count = item.countKey ? orderCount : null;
              const hasCount = Number.isFinite(count) && count > 0;

              return (
                <Link
                  key={item.key}
                  to={item.to}
                  className={`amaya-sidebar-link${isActive ? " active" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                >
                  <item.Icon aria-hidden="true" />
                  <span className="amaya-sidebar-link-label">{item.label}</span>
                  {hasCount ? <em className="amaya-sidebar-link-count">{count}</em> : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="amaya-sidebar-bottom">
        <Link to="/" className="amaya-sidebar-link">
          <ArrowLeft aria-hidden="true" />
          <span className="amaya-sidebar-link-label">Back to Website</span>
        </Link>
        <Link to="/login" className="amaya-sidebar-link amaya-sidebar-link--logout">
          <LogOut aria-hidden="true" />
          <span className="amaya-sidebar-link-label">Log Out</span>
        </Link>
      </div>
    </aside>
  );
}

export default Sidebar;
