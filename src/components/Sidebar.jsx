import { Link, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  BarChart2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  ClipboardList,
  Landmark,
  LayoutGrid,
  LogOut,
  Package,
  Settings,
  ShoppingBag,
  Tags,
  Trash2,
  Utensils,
  Wallet,
} from "lucide-react";

import amayaLogo from "../assets/images/amayalogo.png";
import adminAvatar from "../assets/images/icon/admin1.svg";
import SidebarLogoButton from "./SidebarLogoButton.jsx";
import AdminNotificationNavItem from "./AdminNotificationNavItem.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { EXPENSE_NAV_CATEGORIES } from "../config/expenseNavigation.js";

const NAV_BY_ROLE = {
  admin: [
    {
      label: "MAIN MENU",
      items: [
        { key: "dashboard", to: "/admin", label: "Dashboard", Icon: LayoutGrid },
        {
          key: "inventory",
          label: "Inventory",
          Icon: Package,
          children: [
            { key: "inventoryIngredients", to: "/admin/inventory", label: "Inventory Ingredients", Icon: ClipboardList },
            { key: "wasteTracker", to: "/admin/inventory/waste-tracker", label: "Waste & Spoilage Tracker", Icon: Trash2 },
          ],
        },
        {
          key: "expensesPayroll",
          label: "Expenses and Payroll",
          Icon: Wallet,
          children: [
            { key: "expense-budget-overview", to: "/admin/expenses-payroll", label: "Budget Overview", Icon: Wallet },
            ...EXPENSE_NAV_CATEGORIES.map((category) => ({
              key: `expense-${category.slug}`,
              to: `/admin/expenses-payroll/${category.slug}`,
              label: category.label,
              Icon: Circle,
            })),
          ],
        },
        { key: "menu", to: "/admin/menu", label: "Menu Management", Icon: Utensils },
      ],
    },
    {
      label: "MANAGEMENT",
      items: [
        { key: "categories", to: "/admin/categories", label: "Categories", Icon: Tags },
        { key: "reports", to: "/admin/reports", label: "Reports", Icon: BarChart2 },
        { key: "finances", to: "/admin/finances", label: "Finances", Icon: Landmark },
        { key: "archive", to: "/admin/archive", label: "Archive / Trash", Icon: Archive },
        { key: "notifications", label: "Notifications", notification: true },
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
  const location = useLocation();
  const [animatedItem, setAnimatedItem] = useState("");
  const [expandedNav, setExpandedNav] = useState(() => ({
    inventory: location.pathname.startsWith("/admin/inventory"),
    expensesPayroll: location.pathname.startsWith("/admin/expenses-payroll"),
  }));
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);

  useEffect(() => {
    if (!accountOpen) return undefined;
    const close = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !accountRef.current?.contains(e.target)) setAccountOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [accountOpen]);
  const resolvedSections = sections || NAV_BY_ROLE.admin;
  const portalLabel = role === "staff" ? "Staff Portal" : "Admin Portal";

  const replayNavMotion = (itemKey) => {
    setAnimatedItem("");
    window.requestAnimationFrame(() => setAnimatedItem(itemKey));
  };

  return (
    <aside
      className={`amaya-sidebar ${role === "admin" ? "amaya-sidebar--admin-frame" : ""} ${sidebarCollapsed ? "amaya-sidebar--collapsed" : ""} ${className}`.trim()}
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
              if (item.notification) {
                return <AdminNotificationNavItem key={item.key} active={item.key === activeTab} />;
              }
              if (item.children?.length) {
                const childIsActive = item.children.some((child) => location.pathname === child.to);
                const isExpanded = Boolean(expandedNav[item.key]);
                return (
                  <div className={`amaya-sidebar-nav-group amaya-sidebar-nav-group--${item.key}`} key={item.key}>
                    <button
                      type="button"
                      className={`amaya-sidebar-link amaya-sidebar-group-toggle${childIsActive ? " active" : ""}${animatedItem === item.key ? " nav-clicked" : ""}`}
                      aria-expanded={isExpanded}
                      aria-controls={`${item.key}-submenu`}
                      onClick={() => {
                        setExpandedNav((current) => ({ ...current, [item.key]: !current[item.key] }));
                        replayNavMotion(item.key);
                      }}
                      title={item.label}
                    >
                      <item.Icon aria-hidden="true" />
                      <span className="amaya-sidebar-link-label">{item.label}</span>
                      <ChevronDown className="amaya-sidebar-link-chevron" aria-hidden="true" />
                    </button>
                    {isExpanded && (
                      <div className="amaya-sidebar-submenu" id={`${item.key}-submenu`}>
                        {item.children.map((child) => {
                          const childActive = location.pathname === child.to;
                          return (
                            <Link
                              key={child.key}
                              to={child.to}
                              className={`amaya-sidebar-link amaya-sidebar-sublink${childActive ? " active" : ""}${animatedItem === child.key ? " nav-clicked" : ""}`}
                              aria-current={childActive ? "page" : undefined}
                              onClick={() => replayNavMotion(child.key)}
                              title={child.label}
                            >
                              <child.Icon aria-hidden="true" />
                              <span className="amaya-sidebar-link-label">{child.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
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

      <div className="amaya-sidebar-bottom" ref={accountRef}>
        {role !== "admin" && (
          <>
        <a
          href={import.meta.env.VITE_CUSTOMER_URL || (typeof window !== "undefined" ? `${window.location.origin}/` : "/")}
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
        </>
        )}
        {role === "admin" && (
          <>
            {accountOpen && (
              <div className="amaya-sidebar-account-menu" role="menu">
                <a href={import.meta.env.VITE_CUSTOMER_URL || (typeof window !== "undefined" ? `${window.location.origin}/` : "/")} className="amaya-sidebar-link" role="menuitem">
                  <ArrowLeft aria-hidden="true" />
                  <span className="amaya-sidebar-link-label">Back to Website</span>
                </a>
                <Link to="/login" className="amaya-sidebar-link amaya-sidebar-link--logout" onClick={logout} role="menuitem">
                  <LogOut aria-hidden="true" />
                  <span className="amaya-sidebar-link-label">Log Out</span>
                </Link>
              </div>
            )}
            <button
              type="button"
              className="amaya-sidebar-profile amaya-sidebar-profile--button"
              title="Administrator account"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((o) => !o)}
            >
              <div className="amaya-sidebar-profile-avatar">
                <img src={adminAvatar} alt="" aria-hidden="true" />
              </div>
              <div className="amaya-sidebar-profile-copy">
                <strong>Administrator</strong>
                <span>Admin</span>
              </div>
              <ChevronUp className="amaya-sidebar-profile-chevron" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
