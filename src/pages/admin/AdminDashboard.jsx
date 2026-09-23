import { Link } from "react-router-dom";
import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import "../../assets/css/admin/AdminDashboard.css";
import "../../assets/css/sidebar-collapse.css";

function AdminDashboard() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const liveDate = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className={`admin-dashboard ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>

      
      <aside className="admin-sidebar">

        
        <div className="admin-brand">
          <SidebarLogoButton
            logo={amayaLogo}
            alt="Amaya Logo"
            collapsed={sidebarCollapsed}
            onToggle={toggleSidebar}
            className="admin-logo"
          />

          <div className="admin-brand-text">
            <h2>Amaya</h2>
            <span>Admin Portal</span>
          </div>
        </div>

        
        <nav className="admin-nav">

          <p className="admin-nav-title">
            MAIN MENU
          </p>

          <Link
            to="/admin"
            className="admin-nav-link active"
          >
            <span className="nav-icon">▦</span>
            <span>Dashboard</span>
          </Link>

          <Link
            to="/admin/orders"
            className="admin-nav-link"
          >
            <span className="nav-icon">▤</span>
            <span>Orders</span>
          </Link>

          <Link
            to="/admin/inventory"
            className="admin-nav-link"
          >
            <span className="nav-icon">☷</span>
            <span>Inventory</span>
          </Link>

          <Link
            to="/admin/menu"
            className="admin-nav-link"
          >
            <span className="nav-icon">☷</span>
            <span>Menu Management</span>
          </Link>

          <p className="admin-nav-title">
            MANAGEMENT
          </p>

          <Link
            to="/admin/reports"
            className="admin-nav-link"
          >
            <span className="nav-icon">▥</span>
            <span>Reports</span>
          </Link>

          <Link
            to="/admin/settings"
            className="admin-nav-link"
          >
            <span className="nav-icon">⚙</span>
            <span>Settings</span>
          </Link>

        </nav>

        
        <div className="admin-sidebar-bottom">

          <Link
            to="/"
            className="admin-nav-link website-link"
          >
            <span className="nav-icon">←</span>
            <span>Back to Website</span>
          </Link>

          <Link
            to="/login"
            className="admin-nav-link logout-link"
          >
            <span className="nav-icon">↪</span>
            <span>Log Out</span>
          </Link>

        </div>

      </aside>


      
      <main className="admin-main">

        
        <header className="admin-topbar">

          <div className="admin-page-title">
            <h1>Dashboard</h1>
            <p>Overview of your Amaya business</p>
          </div>

          <div className="admin-topbar-right">

            <button
              className="admin-notification"
              type="button"
              aria-label="Notifications"
            >
              🔔
              <span className="notification-badge">
                3
              </span>
            </button>

            <div className="admin-user">

              <div className="admin-avatar">
                A
              </div>

              <div className="admin-user-info">
                <strong>Administrator</strong>
                <span>Admin</span>
              </div>

            </div>

          </div>

        </header>


        
        <div className="admin-content">

          
          <section className="admin-welcome">

            <div>
              <span className="welcome-label">
                ADMINISTRATOR
              </span>

              <h2>
                Welcome back, Admin!
              </h2>

              <p>
                Here's what's happening with Amaya today.
              </p>
            </div>

            <div className="welcome-date">
              <span>Today</span>
              <strong>{liveDate}</strong>
            </div>

          </section>


          
          <section className="admin-stats">

            
            <div className="admin-stat-card">

              <div className="stat-icon">
                ₱
              </div>

              <div className="stat-info">
                <span>Total Sales</span>
                <h3>₱0.00</h3>
                <small>
                  No sales recorded yet
                </small>
              </div>

            </div>


            
            <div className="admin-stat-card">

              <div className="stat-icon">
                ▤
              </div>

              <div className="stat-info">
                <span>Today's Orders</span>
                <h3>0</h3>
                <small>
                  No orders yet
                </small>
              </div>

            </div>


            
            <div className="admin-stat-card">

              <div className="stat-icon">
                ◷
              </div>

              <div className="stat-info">
                <span>Pending Orders</span>
                <h3>0</h3>
                <small>
                  No pending orders
                </small>
              </div>

            </div>


            
            <div className="admin-stat-card">

              <div className="stat-icon">
                ☷
              </div>

              <div className="stat-info">
                <span>Total Products</span>
                <h3>32</h3>
                <small>
                  4 low-stock items
                </small>
              </div>

            </div>

          </section>


          
          <section className="admin-middle-grid">

            
            <div className="admin-panel sales-panel">

              <div className="panel-header">

                <div>
                  <h3>Sales Overview</h3>
                  <p>Sales performance this week</p>
                </div>

                <select
                  className="sales-filter"
                  defaultValue="week"
                >
                  <option value="week">
                    This Week
                  </option>

                  <option value="month">
                    This Month
                  </option>

                  <option value="year">
                    This Year
                  </option>
                </select>

              </div>

              <div className="sales-chart">

                <div className="chart-value">
                  ₱0
                </div>

                <div className="empty-orders-state">
                  <strong>No sales yet</strong>
                  <span>Sales performance will appear here once orders are placed.</span>
                </div>

              </div>

            </div>


            
            <div className="admin-panel quick-panel">

              <div className="panel-header">
                <div>
                  <h3>Quick Actions</h3>
                  <p>Manage your business</p>
                </div>
              </div>

              <div className="quick-actions">

                <Link
                  to="/admin/menu"
                  className="quick-action"
                >
                  <span className="quick-icon">
                    +
                  </span>

                  <div>
                    <strong>Add Product</strong>
                    <span>Add a new menu item</span>
                  </div>

                  <span className="quick-arrow">
                    →
                  </span>
                </Link>


                <Link
                  to="/admin/orders"
                  className="quick-action"
                >
                  <span className="quick-icon">
                    ▤
                  </span>

                  <div>
                    <strong>View Orders</strong>
                    <span>Manage customer orders</span>
                  </div>

                  <span className="quick-arrow">
                    →
                  </span>
                </Link>


                <Link
                  to="/admin/reports"
                  className="quick-action"
                >
                  <span className="quick-icon">
                    ▥
                  </span>

                  <div>
                    <strong>View Reports</strong>
                    <span>Check sales reports</span>
                  </div>

                  <span className="quick-arrow">
                    →
                  </span>
                </Link>

              </div>

            </div>

          </section>


          
          <section className="admin-bottom-grid">

            
            <div className="admin-panel orders-panel">

              <div className="panel-header">

                <div>
                  <h3>Recent Orders</h3>
                  <p>Latest customer orders</p>
                </div>

                <Link
                  to="/admin/orders"
                  className="view-all"
                >
                  View All →
                </Link>

              </div>

              <div className="orders-table-wrapper">

                <table className="admin-orders-table">

                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    <tr>
                      <td colSpan="4" className="empty-orders-cell">
                        <div className="empty-orders-state">
                          <strong>No orders yet</strong>
                          <span>New customer orders will appear here.</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>

                </table>

              </div>

            </div>

          </section>

        </div>

      </main>

    </div>
  );
}

export default AdminDashboard;