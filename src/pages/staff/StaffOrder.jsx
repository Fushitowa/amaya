import { Link } from "react-router-dom";

import { useTheme } from "../../context/ThemeContext.jsx";
import amayaLogo from "../../assets/images/amayalogo.png";

import "../../assets/css/staff/staff-orders.css";

function StaffOrder() {
  const { darkMode } = useTheme();

  return (
    <div className={`staff-orders-page ${darkMode ? "dark-mode" : ""}`}>

      

      <aside className="staff-sidebar">

        <div className="staff-brand">

          <img
            src={amayaLogo}
            alt="Amaya Logo"
          />

          <div>
            <h2>Amaya</h2>
            <span>Staff Portal</span>
          </div>

        </div>


        <nav className="staff-nav">

          <div className="nav-label">
            MAIN MENU
          </div>


          <Link
            to="/staff"
            className="staff-nav-link"
          >
            <span className="nav-icon">
              ▦
            </span>

            <span>
              Dashboard
            </span>
          </Link>


          <Link
            to="/staff/orders"
            className="staff-nav-link active"
          >
            <span className="nav-icon">
              ▤
            </span>

            <span>
              Orders
            </span>

            <span className="nav-badge">
              0
            </span>
          </Link>


          <Link
            to="/staff/menu"
            className="staff-nav-link"
          >
            <span className="nav-icon">
              ☷
            </span>

            <span>
              Menu
            </span>
          </Link>


          <div className="nav-label nav-label-spaced">
            ACCOUNT
          </div>

          <Link
            to="/staff/settings"
            className="staff-nav-link"
          >
            <span className="nav-icon">
              ⚙
            </span>

            <span>
              Settings
            </span>
          </Link>

        </nav>


        

        <div className="sidebar-bottom">

          <Link
            to="/"
            className="back-to-site"
          >

            <span className="nav-icon">
              ←
            </span>

            <span>
              Back to Website
            </span>

          </Link>


          <Link
            to="/login"
            className="staff-logout"
          >

            <span className="nav-icon">
              ↪
            </span>

            <span>
              Log Out
            </span>

          </Link>

        </div>

      </aside>


      

      <main className="staff-orders-main">


        

        <header className="staff-orders-topbar">

          <div className="orders-topbar-left">

            <span className="orders-page-label">
              STAFF PORTAL
            </span>

            <h1>
              Orders
            </h1>

          </div>


          <div className="orders-topbar-right">

            <button
              type="button"
              className="orders-notification"
              aria-label="Notifications"
            >

              <span>
                ♢
              </span>

              <i></i>

            </button>


            <div className="orders-user">

              <div className="orders-avatar">
                S
              </div>

              <div className="orders-user-info">

                <strong>
                  Staff
                </strong>

                <span>
                  Employee
                </span>

              </div>

            </div>

          </div>

        </header>


        

        <div className="orders-content">


          

          <section className="orders-page-header">

            <div>

              <span className="orders-eyebrow">
                ORDER MANAGEMENT
              </span>

              <h2>
                Customer Orders
              </h2>

              <p>
                View and manage customer orders received
                by Amaya.
              </p>

            </div>


            <div className="orders-summary">

              <div className="summary-number">
                0
              </div>

              <div className="summary-text">

                <strong>
                  Today's Orders
                </strong>

                <span>
                  Total orders received
                </span>

              </div>

            </div>

          </section>


          

          <section className="order-stats">


            <div className="order-stat-card">

              <div className="order-stat-icon total">
                ≡
              </div>

              <div className="order-stat-info">

                <span>
                  Total Orders
                </span>

                <strong>
                  0
                </strong>

                <small>
                  Today
                </small>

              </div>

            </div>


            <div className="order-stat-card">

              <div className="order-stat-icon pending">
                ◷
              </div>

              <div className="order-stat-info">

                <span>
                  Pending
                </span>

                <strong>
                  0
                </strong>

                <small>
                  Need attention
                </small>

              </div>

            </div>


            <div className="order-stat-card">

              <div className="order-stat-icon preparing">
                ◌
              </div>

              <div className="order-stat-info">

                <span>
                  Preparing
                </span>

                <strong>
                  0
                </strong>

                <small>
                  In progress
                </small>

              </div>

            </div>


            <div className="order-stat-card">

              <div className="order-stat-icon ready">
                ✓
              </div>

              <div className="order-stat-info">

                <span>
                  Ready
                </span>

                <strong>
                  0
                </strong>

                <small>
                  For pickup
                </small>

              </div>

            </div>


          </section>


          

          <section className="orders-card">

            <div className="orders-toolbar">

              <div>

                <h3>
                  All Orders
                </h3>

                <p>
                  Manage recent customer orders
                </p>

              </div>


              <div className="order-filters">

                <button
                  type="button"
                  className="filter-button active"
                >
                  All
                </button>

                <button
                  type="button"
                  className="filter-button"
                >
                  Pending
                </button>

                <button
                  type="button"
                  className="filter-button"
                >
                  Preparing
                </button>

                <button
                  type="button"
                  className="filter-button"
                >
                  Ready
                </button>

                <button
                  type="button"
                  className="filter-button"
                >
                  Completed
                </button>

              </div>

            </div>


            

            <div className="orders-table-wrapper">

              <table className="staff-orders-table">

                <thead>

                  <tr>

                    <th>
                      ORDER
                    </th>

                    <th>
                      CUSTOMER
                    </th>

                    <th>
                      ITEMS
                    </th>

                    <th>
                      TOTAL
                    </th>

                    <th>
                      DATE
                    </th>

                    <th>
                      STATUS
                    </th>

                    <th>
                      ACTION
                    </th>

                  </tr>

                </thead>


                <tbody>

                  <tr>
                    <td colSpan="7" className="empty-orders">
                      <div className="empty-orders-state">
                        <strong>No orders yet</strong>
                        <span>New customer orders will appear here.</span>
                      </div>
                    </td>
                  </tr>

                </tbody>

              </table>

            </div>


            

            <div className="orders-pagination">

              <span>
                Showing 0 orders
              </span>


              <div className="pagination-buttons">

                <button
                  type="button"
                  disabled
                >
                  ←
                </button>

                <button
                  type="button"
                  className="pagination-active"
                >
                  1
                </button>

                <button type="button">
                  2
                </button>

                <button type="button">
                  3
                </button>

                <button type="button">
                  4
                </button>

                <button type="button">
                  5
                </button>

                <button type="button">
                  →
                </button>

              </div>

            </div>

          </section>


          

          <div className="staff-order-notice">

            <div className="notice-icon">
              i
            </div>

            <div>

              <strong>
                Staff Order Permissions
              </strong>

              <p>
                You can view orders and update their status.
                Product management and system settings are
                available only to administrators.
              </p>

            </div>

          </div>


        </div>

      </main>

    </div>
  );
}

export default StaffOrder;