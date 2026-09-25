import { useState } from "react";
import { Link } from "react-router-dom";

import { useTheme } from "../../context/ThemeContext.jsx";
import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";

import "../../assets/css/staff/staff-setting.css";
import "../../assets/css/sidebar-collapse.css";

function StaffSetting() {
  const { darkMode, toggleDarkMode } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Preference states
  const [notifications, setNotifications] = useState(true);
  const [orderAlerts, setOrderAlerts] = useState(true);
  const [audioChime, setAudioChime] = useState(true);
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(false);
  const [printerPaperSize, setPrinterPaperSize] = useState("80mm");
  const [printLogoOnReceipt, setPrintLogoOnReceipt] = useState(true);
  const [defaultOrderType, setDefaultOrderType] = useState("Counter");
  const [stationName, setStationName] = useState("POS Terminal #1");
  const [toastMessage, setToastMessage] = useState(null);

  const handleSaveSettings = () => {
    setToastMessage("Staff preferences & printer configurations saved successfully!");
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleTestPrint = () => {
    window.print();
  };

  return (
    <div className={`staff-settings-page ${darkMode ? "dark-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {/* Sidebar Navigation */}
      <aside className="staff-sidebar">
        <div className="staff-brand">
          <SidebarLogoButton
            logo={amayaLogo}
            alt="Amaya Logo"
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
          />
          <div>
            <h2>Amaya</h2>
            <span>Staff Portal</span>
          </div>
        </div>

        <nav className="staff-nav">
          <div className="nav-label">MAIN MENU</div>

          <Link to="/staff" className="staff-nav-link">
            <span className="nav-icon">▦</span>
            <span>Dashboard</span>
          </Link>

          <Link to="/staff/orders" className="staff-nav-link">
            <span className="nav-icon">▤</span>
            <span>Orders</span>
          </Link>

          <Link to="/staff/menu" className="staff-nav-link">
            <span className="nav-icon">☷</span>
            <span>POS Menu</span>
          </Link>

          <div className="nav-label nav-label-spaced">SETTINGS & HARDWARE</div>

          <Link to="/staff/settings" className="staff-nav-link active">
            <span className="nav-icon">⚙</span>
            <span>Settings</span>
          </Link>
        </nav>

        <div className="sidebar-bottom">
          <Link to="/" className="back-to-site">
            <span className="nav-icon">←</span>
            <span>Back to Website</span>
          </Link>

          <Link to="/login" className="staff-logout">
            <span className="nav-icon">↪</span>
            <span>Log Out</span>
          </Link>
        </div>
      </aside>

      {/* Main Settings Content */}
      <main className="staff-settings-main">
        <header className="staff-settings-topbar">
          <div className="settings-topbar-left">
            <span className="settings-page-label">STAFF PORTAL</span>
            <h1>Portal & POS Settings</h1>
          </div>

          <div className="settings-topbar-right">
            <button
              type="button"
              className="settings-notification"
              aria-label="Notifications"
            >
              <span>♢</span>
            </button>

            <div className="settings-user">
              <div className="settings-avatar">S</div>
              <div className="settings-user-info">
                <strong>Staff User</strong>
                <span>Barista & Cashier</span>
              </div>
            </div>
          </div>
        </header>

        <div className="settings-content">
          <section className="settings-intro">
            <div>
              <span className="settings-eyebrow">PREFERENCES & HARDWARE</span>
              <h2>Station Configuration</h2>
              <p>
                Configure receipt printer options, live order alerts, staff profile status, and counter workstation settings.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSaveSettings}
              style={{
                padding: "10px 22px",
                borderRadius: "8px",
                border: "none",
                background: "linear-gradient(135deg, #8b5e3c, #70482f)",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 4px 14px rgba(112, 72, 47, 0.25)",
              }}
            >
              Save Preferences
            </button>
          </section>

          <div className="settings-layout" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>
            {/* Card 1: Staff Profile & Duty Status */}
            <section className="settings-card" style={{ background: "#ffffff", border: "1px solid #ebdcd0", borderRadius: "14px", padding: "24px" }}>
              <div className="settings-card-header" style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "rgba(139, 94, 60, 0.12)", color: "#8b5e3c", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: "bold" }}>
                  👤
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#2d1f1a" }}>Staff Profile & Station</h3>
                  <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#8a7c73" }}>Assigned workstation and active shift status</p>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0e8e0" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>Shift Status</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Current working status</span>
                  </div>
                  <span style={{ padding: "4px 10px", borderRadius: "20px", background: "#e7f4ea", color: "#2e7d32", fontSize: "11px", fontWeight: 700 }}>
                    ● On Duty
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0e8e0" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>Counter Terminal</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Device identity</span>
                  </div>
                  <input
                    type="text"
                    value={stationName}
                    onChange={(e) => setStationName(e.target.value)}
                    style={{ width: "160px", padding: "6px 10px", borderRadius: "6px", border: "1px solid #dcd4cc", fontSize: "12px", textAlign: "right" }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #f0e8e0" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>Role & Permissions</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Access level</span>
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#8b5e3c" }}>
                    Staff / Cashier & Barista
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>Store Location</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Registered branch</span>
                  </div>
                  <span style={{ fontSize: "12px", color: "#5d4d43" }}>
                    Valencia City, Bukidnon
                  </span>
                </div>
              </div>
            </section>

            {/* Card 2: Receipt Printer & Hardware Setup */}
            <section className="settings-card" style={{ background: "#ffffff", border: "1px solid #ebdcd0", borderRadius: "14px", padding: "24px" }}>
              <div className="settings-card-header" style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "rgba(139, 94, 60, 0.12)", color: "#8b5e3c", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: "bold" }}>
                  ⎙
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#2d1f1a" }}>Receipt Printer Setup</h3>
                  <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#8a7c73" }}>Configure thermal slip format and printing behaviors</p>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid #f0e8e0" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>Paper Roll Size</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Thermal paper width standard</span>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {["80mm", "58mm"].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setPrinterPaperSize(size)}
                        style={{
                          padding: "5px 12px",
                          borderRadius: "6px",
                          border: printerPaperSize === size ? "1.5px solid #8b5e3c" : "1px solid #ded6ce",
                          background: printerPaperSize === size ? "#fbf5ef" : "#ffffff",
                          color: printerPaperSize === size ? "#70482f" : "#6a5749",
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid #f0e8e0" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>Auto-Print on Checkout</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Automatically open print dialog when order is placed</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoPrintReceipt}
                    onChange={(e) => setAutoPrintReceipt(e.target.checked)}
                    style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#8b5e3c" }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid #f0e8e0" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>Print Store Logo</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Include Amaya logo on thermal receipts</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={printLogoOnReceipt}
                    onChange={(e) => setPrintLogoOnReceipt(e.target.checked)}
                    style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#8b5e3c" }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={handleTestPrint}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "7px",
                      border: "1px solid #8b5e3c",
                      background: "#fbf5ef",
                      color: "#70482f",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>⎙</span> Test Print Receipt Slip
                  </button>
                </div>
              </div>
            </section>

            {/* Card 3: POS Ordering & Operational Alerts */}
            <section className="settings-card" style={{ background: "#ffffff", border: "1px solid #ebdcd0", borderRadius: "14px", padding: "24px" }}>
              <div className="settings-card-header" style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "rgba(139, 94, 60, 0.12)", color: "#8b5e3c", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: "bold" }}>
                  🔔
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#2d1f1a" }}>Notifications & Alerts</h3>
                  <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#8a7c73" }}>Manage order chime, queue alerts, and popup toasts</p>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "10px", borderBottom: "1px solid #f0e8e0" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>New Order Alerts</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Visual toast on incoming orders</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={orderAlerts}
                    onChange={(e) => setOrderAlerts(e.target.checked)}
                    style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#8b5e3c" }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "10px", borderBottom: "1px solid #f0e8e0" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>Audio Chime</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Sound chime when kitchen updates status</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={audioChime}
                    onChange={(e) => setAudioChime(e.target.checked)}
                    style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#8b5e3c" }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "10px", borderBottom: "1px solid #f0e8e0" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>System Notifications</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Receive operational announcements</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={notifications}
                    onChange={(e) => setNotifications(e.target.checked)}
                    style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#8b5e3c" }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>Default Order Type</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Preselected counter service</span>
                  </div>
                  <select
                    value={defaultOrderType}
                    onChange={(e) => setDefaultOrderType(e.target.value)}
                    style={{ padding: "6px 12px", borderRadius: "6px", border: "1px solid #ded6ce", fontSize: "12px", color: "#2d1f1a" }}
                  >
                    <option value="Counter">Counter</option>
                    <option value="Takeout">Takeout</option>
                    <option value="Dine-in">Dine-in</option>
                  </select>
                </div>
              </div>
            </section>

            {/* Card 4: Display & Appearance */}
            <section className="settings-card" style={{ background: "#ffffff", border: "1px solid #ebdcd0", borderRadius: "14px", padding: "24px" }}>
              <div className="settings-card-header" style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: "rgba(139, 94, 60, 0.12)", color: "#8b5e3c", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: "bold" }}>
                  🎨
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#2d1f1a" }}>Display & Themes</h3>
                  <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#8a7c73" }}>Adjust POS interface contrast and appearance</p>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid #f0e8e0" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>Dark Mode Display</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>High contrast for low-light café counters</span>
                  </div>
                  <button
                    type="button"
                    onClick={toggleDarkMode}
                    style={{
                      padding: "6px 14px",
                      borderRadius: "6px",
                      border: "1px solid #ded6ce",
                      background: darkMode ? "#2d1f1a" : "#faf7f4",
                      color: darkMode ? "#fff" : "#2d1f1a",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {darkMode ? "🌙 Dark Mode" : "☀️ Light Mode"}
                  </button>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong style={{ display: "block", fontSize: "12px", color: "#2d1f1a" }}>Quick Reset</strong>
                    <span style={{ fontSize: "11px", color: "#8a7c73" }}>Reset options to default factory values</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNotifications(true);
                      setOrderAlerts(true);
                      setAudioChime(true);
                      setAutoPrintReceipt(false);
                      setPrinterPaperSize("80mm");
                      setDefaultOrderType("Counter");
                      setToastMessage("Settings restored to defaults");
                      setTimeout(() => setToastMessage(null), 2500);
                    }}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "6px",
                      border: "1px solid #ded6ce",
                      background: "#fff",
                      color: "#b91c1c",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Reset Defaults
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            background: "#2d1f1a",
            color: "#ffffff",
            padding: "12px 20px",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: 600,
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
            zIndex: 1200,
          }}
        >
          ✓ {toastMessage}
        </div>
      )}
    </div>
  );
}

export default StaffSetting;