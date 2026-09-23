import { useState } from "react";
import { Link } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";

import "../../assets/css/admin/AdminSettings.css";
import "../../assets/css/sidebar-collapse.css";

const initialSettings = {
	businessName: "Amaya Cafe",
	email: "admin@amayacafe.com",
	phone: "+63 917 123 4567",
	address: "Mabini Street, General Santos City",
	openingTime: "09:00",
	closingTime: "21:00",
};

function AdminSettings() {
	const { sidebarCollapsed, toggleSidebar } = useSidebar();
	const [settings, setSettings] = useState(initialSettings);
	const [notifications, setNotifications] = useState(true);
	const [orderAlerts, setOrderAlerts] = useState(true);
	const [inventoryAlerts, setInventoryAlerts] = useState(true);
	const [saved, setSaved] = useState(false);

	const updateSetting = (event) => {
		const { name, value } = event.target;
		setSettings((current) => ({ ...current, [name]: value }));
		setSaved(false);
	};

	const handleSave = (event) => {
		event.preventDefault();
		setSaved(true);
	};

	return (
		<div className={`admin-settings-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
			<aside className="admin-settings-sidebar">
				<div className="admin-settings-brand">
					<SidebarLogoButton logo={amayaLogo} alt="Amaya logo" collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
					<div><strong>Amaya</strong><span>Admin Portal</span></div>
				</div>

				<nav className="admin-settings-nav" aria-label="Admin navigation">
					<span className="admin-settings-nav-label">MAIN MENU</span>
					<Link to="/admin" className="admin-settings-nav-link"><span>▦</span>Dashboard</Link>
					<Link to="/admin/orders" className="admin-settings-nav-link"><span>▤</span>Orders</Link>
					<Link to="/admin/inventory" className="admin-settings-nav-link"><span>☷</span>Inventory</Link>
					<Link to="/admin/menu" className="admin-settings-nav-link"><span>☷</span>Menu Management</Link>
					<span className="admin-settings-nav-label nav-label-spaced">MANAGEMENT</span>
					<Link to="/admin/reports" className="admin-settings-nav-link"><span>▥</span>Reports</Link>
					<Link to="/admin/settings" className="admin-settings-nav-link active"><span>⚙</span>Settings</Link>
				</nav>

				<div className="admin-settings-sidebar-bottom">
					<Link to="/" className="admin-settings-nav-link"><span>←</span>Back to Website</Link>
					<Link to="/login" className="admin-settings-nav-link logout-link"><span>↪</span>Log Out</Link>
				</div>
			</aside>

			<main className="admin-settings-main">
				<header className="admin-settings-topbar">
					<div><span className="admin-settings-section-label">ADMIN PORTAL</span><h1>Settings</h1></div>
					<div className="admin-settings-topbar-actions">
						<button type="button" className="admin-settings-icon-button" aria-label="Notifications">♢<b>3</b></button>
						<div className="admin-settings-user"><div className="admin-settings-avatar">A</div><div><strong>Administrator</strong><span>Admin</span></div></div>
					</div>
				</header>

				<div className="admin-settings-content">
					<section className="admin-settings-heading">
						<div>
							<span className="admin-settings-eyebrow">WORKSPACE CONTROL</span>
							<h2>Keep Amaya running smoothly.</h2>
							<p>Manage your cafe profile, operating hours, and admin alerts from one place.</p>
						</div>
						<div className="admin-settings-save-state"><span className="settings-status-dot"></span>{saved ? "Changes saved" : "All systems operational"}</div>
					</section>

					<form className="admin-settings-form" onSubmit={handleSave}>
						<div className="admin-settings-layout">
							<div className="admin-settings-primary-column">
								<section className="admin-settings-card">
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon">⌂</div><div><h3>Business profile</h3><p>Keep your public cafe details accurate.</p></div></div>
									<div className="admin-settings-fields">
										<label>Business name<input name="businessName" value={settings.businessName} onChange={updateSetting} /></label>
										<label>Admin email<input type="email" name="email" value={settings.email} onChange={updateSetting} /></label>
										<label>Contact number<input name="phone" value={settings.phone} onChange={updateSetting} /></label>
										<label className="field-wide">Store address<input name="address" value={settings.address} onChange={updateSetting} /></label>
									</div>
								</section>

								<section className="admin-settings-card">
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon">◷</div><div><h3>Operating hours</h3><p>Set the hours shown to staff and customers.</p></div></div>
									<div className="admin-settings-fields hours-fields">
										<label>Opening time<input type="time" name="openingTime" value={settings.openingTime} onChange={updateSetting} /></label>
										<label>Closing time<input type="time" name="closingTime" value={settings.closingTime} onChange={updateSetting} /></label>
									</div>
									<div className="admin-settings-hours-note"><span>●</span> Store is currently open <strong>Today, 9:00 AM - 9:00 PM</strong></div>
								</section>
							</div>

							<div className="admin-settings-secondary-column">
								<section className="admin-settings-card notifications-card">
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon">♢</div><div><h3>Notifications</h3><p>Choose what deserves your attention.</p></div></div>
									<SettingToggle label="Admin notifications" description="Receive important updates from the portal." enabled={notifications} onToggle={() => { setNotifications(!notifications); setSaved(false); }} />
									<SettingToggle label="New order alerts" description="Get notified when a customer order arrives." enabled={orderAlerts} onToggle={() => { setOrderAlerts(!orderAlerts); setSaved(false); }} />
									<SettingToggle label="Low stock alerts" description="Be alerted when inventory needs attention." enabled={inventoryAlerts} onToggle={() => { setInventoryAlerts(!inventoryAlerts); setSaved(false); }} />
								</section>

								<section className="admin-settings-card security-card">
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon">▣</div><div><h3>Account security</h3><p>Review access to your admin portal.</p></div></div>
									<div className="security-row"><div><strong>Password</strong><span>Last changed 30 days ago</span></div><button type="button" className="settings-secondary-button">Update</button></div>
									<div className="security-row"><div><strong>Two-factor authentication</strong><span>Extra protection is recommended</span></div><span className="security-badge">Not enabled</span></div>
								</section>
							</div>
						</div>

						<div className="admin-settings-footer"><span>Last saved just now</span><button type="submit" className="admin-settings-save-button">Save changes <span>→</span></button></div>
					</form>
				</div>
			</main>
		</div>
	);
}

function SettingToggle({ label, description, enabled, onToggle }) {
	return (
		<div className="admin-settings-toggle-row">
			<div><strong>{label}</strong><p>{description}</p></div>
			<button type="button" className={`admin-settings-toggle ${enabled ? "is-active" : ""}`} onClick={onToggle} aria-label={`Toggle ${label}`} aria-pressed={enabled}><span></span></button>
		</div>
	);
}

export default AdminSettings;
