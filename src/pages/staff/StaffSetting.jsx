import { useState } from "react";
import { Link } from "react-router-dom";

import { useTheme } from "../../context/ThemeContext.jsx";

import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";

import "../../assets/css/staff/staff-setting.css";
import "../../assets/css/sidebar-collapse.css";

function StaffSetting() {

  const { darkMode } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const [notifications, setNotifications] = useState(true);
  const [orderAlerts, setOrderAlerts] = useState(true);

  return (
    <div
      className={`staff-settings-page ${darkMode ? "dark-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >

      

      <aside className="staff-sidebar">

        <div className="staff-brand">

          <SidebarLogoButton logo={amayaLogo} alt="Amaya Logo" collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)} />

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
            className="staff-nav-link"
          >
            <span className="nav-icon">
              ▤
            </span>

            <span>
              Orders
            </span>

            <span className="nav-badge">
              5
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
            className="staff-nav-link active"
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


      

      <main className="staff-settings-main">


        

        <header className="staff-settings-topbar">

          <div className="settings-topbar-left">

            <span className="settings-page-label">
              STAFF PORTAL
            </span>

            <h1>
              Settings
            </h1>

          </div>


          <div className="settings-topbar-right">

            <button
              type="button"
              className="settings-notification"
              aria-label="Notifications"
            >

              <span>
                ♢
              </span>

              <i></i>

            </button>


            <div className="settings-user">

              <div className="settings-avatar">
                S
              </div>

              <div className="settings-user-info">

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


        

        <div className="settings-content">


          

          <section className="settings-intro">

            <div>

              <span className="settings-eyebrow">
                PREFERENCES
              </span>

              <h2>
                Portal Settings
              </h2>

              <p>
                Customize your staff portal preferences
                and notification settings.
              </p>

            </div>

          </section>


          

          <div className="settings-layout">


            

            <section className="settings-card">

              <div className="settings-card-header">

                <div className="settings-section-icon">
                  ♢
                </div>

                <div>

                  <h3>
                    Notifications
                  </h3>

                  <p>
                    Manage alerts and staff notifications.
                  </p>

                </div>

              </div>


              

              <div className="settings-option">

                <div className="setting-option-info">

                  <div className="setting-option-title">

                    <strong>
                      Notifications
                    </strong>

                    <span className="setting-status">
                      {notifications
                        ? "Enabled"
                        : "Disabled"}
                    </span>

                  </div>

                  <p>
                    Receive important notifications
                    from the staff portal.
                  </p>

                </div>


                <button
                  type="button"
                  className={`settings-toggle ${
                    notifications
                      ? "toggle-active"
                      : ""
                  }`}
                  onClick={() =>
                    setNotifications(
                      !notifications
                    )
                  }
                  aria-label="Toggle notifications"
                  aria-pressed={notifications}
                >

                  <span></span>

                </button>

              </div>


              

              <div className="settings-option">

                <div className="setting-option-info">

                  <div className="setting-option-title">

                    <strong>
                      New Order Alerts
                    </strong>

                    <span className="setting-status">
                      {orderAlerts
                        ? "Enabled"
                        : "Disabled"}
                    </span>

                  </div>

                  <p>
                    Get notified when a new customer
                    order is received.
                  </p>

                </div>


                <button
                  type="button"
                  className={`settings-toggle ${
                    orderAlerts
                      ? "toggle-active"
                      : ""
                  }`}
                  onClick={() =>
                    setOrderAlerts(
                      !orderAlerts
                    )
                  }
                  aria-label="Toggle new order alerts"
                  aria-pressed={orderAlerts}
                >

                  <span></span>

                </button>

              </div>

            </section>


            

            <section className="settings-card">

              <div className="settings-card-header">

                <div className="settings-section-icon">
                  ◯
                </div>

                <div>

                  <h3>
                    Account
                  </h3>

                  <p>
                    Information about your staff account.
                  </p>

                </div>

              </div>


              <div className="account-information">


                <div className="account-row">

                  <div className="account-label">
                    <span>
                      Username
                    </span>
                  </div>

                  <strong>
                    staff
                  </strong>

                </div>


                <div className="account-row">

                  <div className="account-label">
                    <span>
                      Role
                    </span>
                  </div>

                  <span className="role-badge">
                    Employee
                  </span>

                </div>


                <div className="account-row">

                  <div className="account-label">
                    <span>
                      Access Level
                    </span>
                  </div>

                  <span className="access-level">
                    Staff
                  </span>

                </div>

              </div>

            </section>


            

            <section className="settings-card">

              <div className="settings-card-header">

                <div className="settings-section-icon">
                  ◈
                </div>

                <div>

                  <h3>
                    Security
                  </h3>

                  <p>
                    Security information for your account.
                  </p>

                </div>

              </div>


              <div className="security-message">

                <div className="security-icon">
                  ✓
                </div>

                <div>

                  <strong>
                    Account Security
                  </strong>

                  <p>
                    Your staff account is managed by
                    the system administrator.
                  </p>

                </div>

              </div>


              <div className="security-note">

                If you need to change your password or
                account information, contact the administrator.

              </div>

            </section>

          </div>


          

          <div className="settings-footer">

            <span>
              Amaya Staff Portal
            </span>

            <span>
              Staff settings are limited according to
              your account permissions.
            </span>

          </div>

        </div>

      </main>

    </div>
  );
}

export default StaffSetting;