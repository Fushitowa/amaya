import { useEffect, useMemo, useState } from "react";
import Sidebar from "../../components/Sidebar.jsx";
import FinancialReconciliationCenter from "../../components/FinancialReconciliationCenter.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useOrders } from "../../context/OrdersContext.jsx";
import "../../assets/css/admin/AdminReport.css";
import "../../assets/css/admin/FinancialManagement.css";
import "../../assets/css/admin/FinanceCenter.css";
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
    <div className={`admin-report-page finance-center-page ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
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
        <div className="lb-page">
          <FinancialReconciliationCenter onOpenNav={() => setMobileNavOpen(true)} />
        </div>
      </main>
    </div>
  );
}

export default AdminFinances;
