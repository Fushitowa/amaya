import { useEffect, useMemo, useState } from "react";
import { Menu } from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import FinancialReconciliationCenter from "../../components/FinancialReconciliationCenter.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useOrders } from "../../context/OrdersContext.jsx";
import "../../assets/css/admin/AdminReport.css";
import "../../assets/css/admin/FinancialManagement.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

function AdminFinances() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { orders = [] } = useOrders() || {};
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const pendingCount = useMemo(
    () => orders.filter((order) => order.status === "Pending").length,
    [orders],
  );

  useEffect(() => {
    if (!mobileNavOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  return (
    <div className={`admin-report-page ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
      {mobileNavOpen && (
        <div
          className="report-mobile-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <Sidebar
        role="admin"
        activeTab="finances"
        orderCount={pendingCount}
        sidebarCollapsed={mobileNavOpen ? false : sidebarCollapsed}
        onToggle={() => {
          if (mobileNavOpen) {
            setMobileNavOpen(false);
          } else {
            toggleSidebar();
          }
        }}
      />

      <main className="admin-report-main">
        <header className="admin-report-topbar">
          <div className="admin-report-topbar-title">
            <div className="report-topbar-title-row">
              <button
                type="button"
                className="report-mobile-menu-btn"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation menu"
              >
                <Menu size={21} aria-hidden="true" />
              </button>
              <span className="admin-report-section-label">
                <i className="topbar-label-pin" aria-hidden="true" />
                ADMIN PORTAL
              </span>
            </div>
            <h1>Financial &amp; Ledger Center</h1>
          </div>
        </header>

        <div className="admin-report-content admin-finances-content">
          <FinancialReconciliationCenter />
        </div>
      </main>
    </div>
  );
}

export default AdminFinances;
