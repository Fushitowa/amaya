import { Link } from "react-router-dom";
import { useState } from "react";
import {
  Archive,
  ArrowLeft,
  BarChart2,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  LogOut,
  Package,
  Settings,
  ShoppingBag,
  Tags,
  Utensils,
} from "lucide-react";

import amayaLogo from "../assets/images/amayalogo.png";
import SidebarLogoButton from "./SidebarLogoButton.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const NAV_BY_ROLE = {
  admin: [
    {
      label: "MAIN MENU",
      items: [
        { key: "dashboard", to: "/admin", label: "Dashboard", Icon: LayoutGrid },
        { key: "inventory", to: "/admin/inventory", label: "Inventory", Icon: Package },
        { key: "menu", to: "/admin/menu", label: "Menu Management", Icon: Utensils },
      ],
    },
    {
      label: "MANAGEMENT",
      items: [
        { key: "categories", to: "/admin/categories", label: "Categories", Icon: Tags },
        { key: "reports", to: "/admin/reports", label: "Reports", Icon: BarChart2 },
        { key: "archive", to: "/admin/archive", label: "Archive / Trash", Icon: Archive },
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
  const { logout } = useAuth();
  const [animatedItem, setAnimatedItem] = useState("");
  const resolvedSections = sections || NAV_BY_ROLE.admin;
  const portalLabel = role === "staff" ? "Staff Portal" : "Admin Portal";

  const replayNavMotion = (itemKey) => {
    setAnimatedItem("");
    window.requestAnimationFrame(() => setAnimatedItem(itemKey));
  };

  return (
    <aside
      className={`amaya-sidebar ${sidebarCollapsed ? "amaya-sidebar--collapsed" : ""} ${className}`.trim()}
      aria-label={`${portalLabel} navigation`}
      aria-expanded={!sidebarCollapsed}
      data-collapsed={sidebarCollapsed ? "true" : "false"}
    >
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
        <button
          type="button"
          className="sidebar-toggle-btn amaya-sidebar-toggle-btn amaya-sidebar-toggle"
          onClick={onToggle}
          aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
          title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {sidebarCollapsed ? (
            <ChevronRight size={18} strokeWidth={2.4} aria-hidden="true" />
          ) : (
            <ChevronLeft size={18} strokeWidth={2.4} aria-hidden="true" />
          )}
        </button>
      </div>

      <nav className="amaya-sidebar-nav" aria-label={`${portalLabel} menu`}>
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
                  className={`amaya-sidebar-link${isActive ? " active" : ""}${animatedItem === item.key ? " nav-clicked" : ""}`}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => replayNavMotion(item.key)}
                  title={item.label}
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
        <a
          href={import.meta.env.VITE_CUSTOMER_URL || "http://localhost:5173/"}
          className="amaya-sidebar-link"
          title="Back to Website"
        >
          <ArrowLeft aria-hidden="true" />
          <span className="amaya-sidebar-link-label">Back to Website</span>
        </a>
        <Link
          to="/login"
          className="amaya-sidebar-link amaya-sidebar-link--logout"
          onClick={logout}
          title="Log Out"
        >
          <LogOut aria-hidden="true" />
          <span className="amaya-sidebar-link-label">Log Out</span>
        </Link>
      </div>
    </aside>
  );
}

export default Sidebar;
