import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Menu } from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import ExpenseBudgetBoard from "../../components/ExpenseBudgetBoard.jsx";
import { currentBudgetMonth } from "../../utils/expenseBudget.js";
import "../../assets/css/admin/AdminReport.css";
import "../../assets/css/admin/FinancialManagement.css";
import "../../assets/css/admin/AdminExpenseCategory.css";
import "../../assets/css/admin/ExpenseBudgetBoard.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

export default function AdminExpenseBudgetOverview() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [month, setMonth] = useState(currentBudgetMonth);
  return (
    <div className={`admin-report-page expense-budget-overview-page${sidebarCollapsed ? " sidebar-collapsed" : ""}${mobileNavOpen ? " mobile-nav-open" : ""}`}>
      {mobileNavOpen && <button type="button" className="report-mobile-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <Sidebar role="admin" activeTab="expensesPayroll" sidebarCollapsed={mobileNavOpen ? false : sidebarCollapsed} onToggle={() => (mobileNavOpen ? setMobileNavOpen(false) : toggleSidebar())} />
      <main className="admin-report-main">
        <header className="admin-report-topbar"><div className="admin-report-topbar-title"><div className="report-topbar-title-row"><button type="button" className="report-mobile-menu-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu"><Menu size={21} aria-hidden="true" /></button><span className="admin-report-section-label"><i className="topbar-label-pin" aria-hidden="true" /> ADMIN PORTAL</span></div><h1>Expenses and Payroll</h1></div></header>
        <div className="admin-report-content admin-finances-content expense-category-content">
          <div className="expense-budget-overview-intro">
            <Link className="expense-back-link" to="/admin/finances"><ArrowLeft size={15} aria-hidden="true" /> Financial Center</Link>
            <p>Waste Cost is tracked under COGS and is excluded from these operating expense budgets.</p>
          </div>
          <ExpenseBudgetBoard month={month} onMonthChange={setMonth} />
        </div>
      </main>
    </div>
  );
}
