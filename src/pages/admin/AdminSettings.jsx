import { useEffect, useRef, useState } from "react";

import Sidebar from "../../components/Sidebar.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import adminAvatar from "../../assets/images/icon/admin1.svg";
import NotificationIcon from "../../components/NotificationIcon.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useBusiness } from "../../context/BusinessContext.jsx";
import { apiRequest } from "../../utils/api.js";

import "../../assets/css/admin/AdminSettings.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const initialSettings = {
	businessName: "Amaya Cafe",
	email: "admin@amayacafe.com",
	phone: "+63 917 123 4567",
	address: "Mabini Street, General Santos City",
	openingTime: "09:00",
	closingTime: "21:00",
};

function readNotificationPreferences() {
	try {
		return { notifications: true, orderAlerts: true, inventoryAlerts: true, ...JSON.parse(localStorage.getItem("amaya-admin-notifications") || "{}") };
	} catch {
		return { notifications: true, orderAlerts: true, inventoryAlerts: true };
	}
}

function AdminSettings() {
	const { sidebarCollapsed, toggleSidebar } = useSidebar();
	const { businessSettings, saveBusinessSettings } = useBusiness();
	const [settingsDraft, setSettingsDraft] = useState({});
	const settings = { ...initialSettings, ...businessSettings, ...settingsDraft };
	const [preferences, setPreferences] = useState(readNotificationPreferences);
	const { notifications, orderAlerts, inventoryAlerts } = preferences;
	const [saveState, setSaveState] = useState("idle");
	const [saveError, setSaveError] = useState("");
	const [lastSaved, setLastSaved] = useState(null);
	const [showPasswordForm, setShowPasswordForm] = useState(false);
	const [passwordValues, setPasswordValues] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
	const [passwordSaving, setPasswordSaving] = useState(false);
	const [passwordFeedback, setPasswordFeedback] = useState(null);
	const saveTimers = useRef([]);

	useEffect(() => () => saveTimers.current.forEach((timer) => clearTimeout(timer)), []);
	useEffect(() => {
		try {
			localStorage.setItem("amaya-admin-notifications", JSON.stringify(preferences));
			window.dispatchEvent(new Event("amaya-admin-notification-preferences"));
		} catch {
			// Notification preferences remain available for the current session.
		}
	}, [preferences]);
	useEffect(() => {
		if (!showPasswordForm) return undefined;
		const closeOnEscape = (event) => {
			if (event.key === "Escape" && !passwordSaving) setShowPasswordForm(false);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [showPasswordForm, passwordSaving]);

	const updateSetting = (event) => {
		const { name, value } = event.target;
		setSettingsDraft((current) => ({ ...current, [name]: value }));
		setSaveError("");
		if (saveState !== "saving") setSaveState("idle");
	};

	const handleSave = async (event) => {
		event.preventDefault();
		if (saveState === "saving") return;

		saveTimers.current.forEach((timer) => clearTimeout(timer));
		setSaveState("saving");
		setSaveError("");
		try {
			await saveBusinessSettings(settings);
			setSettingsDraft({});
			setLastSaved(new Date());
			saveTimers.current = [
				setTimeout(() => setSaveState("success"), 250),
				setTimeout(() => setSaveState("idle"), 2200),
			];
		} catch (error) {
			setSaveState("error");
			setSaveError(error.message || "Could not save the settings. Please retry.");
		}
	};

	const handlePasswordChange = async (event) => {
		event.preventDefault();
		if (passwordValues.newPassword.length < 8) {
			setPasswordFeedback({ type: "error", message: "Use at least 8 characters for your new password." });
			return;
		}
		if (passwordValues.newPassword !== passwordValues.confirmPassword) {
			setPasswordFeedback({ type: "error", message: "The new passwords do not match." });
			return;
		}
		setPasswordSaving(true);
		setPasswordFeedback(null);
		try {
			const { message } = await apiRequest("/auth/change-password", {
				method: "POST",
				body: JSON.stringify({ currentPassword: passwordValues.currentPassword, newPassword: passwordValues.newPassword }),
			});
			setPasswordFeedback({ type: "success", message });
			setShowPasswordForm(false);
			setPasswordValues({ currentPassword: "", newPassword: "", confirmPassword: "" });
		} catch (error) {
			setPasswordFeedback({ type: "error", message: error.message || "Could not update your password." });
		} finally {
			setPasswordSaving(false);
		}
	};

	return (
		<div className={`admin-settings-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        role="admin"
        activeTab="settings"
        sidebarCollapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

			<main className="admin-settings-main">
				<header className="admin-settings-topbar">
					<div><span className="admin-settings-section-label">ADMIN PORTAL</span><h1>Settings</h1></div>
					<div className="admin-settings-topbar-actions">
						<PortalNotificationButton />
						<div className="admin-settings-user"><div className="amaya-admin-avatar"><img src={adminAvatar} alt="" aria-hidden="true" /></div><div><strong>Administrator</strong><span>Admin</span></div></div>
					</div>
				</header>

				<div className="admin-settings-content">
					<section className="admin-settings-heading">
						<div>
							<span className="admin-settings-eyebrow">WORKSPACE CONTROL</span>
							<h2>Keep Amaya running smoothly.</h2>
							<p>Manage your cafe profile, operating hours, and admin alerts from one place.</p>
						</div>
						<div className="admin-settings-save-state"><span className="settings-status-dot"></span>{saveState === "success" ? "Changes saved" : "All systems operational"}</div>
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
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon"><NotificationIcon size={17} /></div><div><h3>Notifications</h3><p>Choose what deserves your attention.</p></div></div>
									<SettingToggle label="Admin notifications" description="Receive important updates from this browser." enabled={notifications} onToggle={() => setPreferences((current) => ({ ...current, notifications: !current.notifications }))} />
									<SettingToggle label="New order alerts" description="Show an alert when a customer order arrives." enabled={orderAlerts} onToggle={() => setPreferences((current) => ({ ...current, orderAlerts: !current.orderAlerts }))} />
									<SettingToggle label="Low stock alerts" description="Show an alert when inventory needs attention." enabled={inventoryAlerts} onToggle={() => setPreferences((current) => ({ ...current, inventoryAlerts: !current.inventoryAlerts }))} />
								</section>

								<section className="admin-settings-card security-card">
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon">▣</div><div><h3>Account security</h3><p>Review access to your admin portal.</p></div></div>
									<div className="security-row"><div><strong>Password</strong><span>Keep your administrator account secure.</span></div><button type="button" className="settings-secondary-button" onClick={() => { setPasswordFeedback(null); setShowPasswordForm(true); }}>Update</button></div>
									<div className="security-row"><div><strong>Two-factor authentication</strong><span>Not configured for this account.</span></div><span className="security-badge">Unavailable</span></div>
								</section>
							</div>
						</div>

						{saveError && <p className="settings-save-error" role="alert">{saveError}</p>}
						{passwordFeedback && <p className={`settings-password-feedback is-${passwordFeedback.type}`} role={passwordFeedback.type === "error" ? "alert" : "status"}>{passwordFeedback.message}</p>}
						<div className="admin-settings-footer"><span>{lastSaved ? `Last saved ${lastSaved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Settings are saved to the database when you submit."}</span><button type="submit" className={`admin-settings-save-button is-${saveState}`} disabled={saveState === "saving"} aria-live="polite">{saveState === "saving" ? <><span className="save-spinner" aria-hidden="true"></span>Saving changes</> : saveState === "success" ? <><span className="save-check" aria-hidden="true">✓</span>Changes Saved</> : saveState === "error" ? <>Retry save <span aria-hidden="true">↻</span></> : <>Save changes <span aria-hidden="true">→</span></>}</button></div>
					</form>
				</div>
			</main>
			{showPasswordForm && (
				<div className="admin-settings-modal-backdrop" role="presentation" onClick={() => !passwordSaving && setShowPasswordForm(false)}>
					<form className="admin-settings-password-modal" onSubmit={handlePasswordChange} role="dialog" aria-modal="true" aria-labelledby="password-dialog-title" onClick={(event) => event.stopPropagation()}>
						<div className="admin-settings-card-header">
							<div className="admin-settings-card-icon">▣</div>
							<div><h3 id="password-dialog-title">Change password</h3><p>Use at least 8 characters.</p></div>
							<button type="button" onClick={() => setShowPasswordForm(false)} disabled={passwordSaving} aria-label="Close password form">×</button>
						</div>
						<label>Current password<input type="password" autoComplete="current-password" autoFocus value={passwordValues.currentPassword} onChange={(event) => setPasswordValues((current) => ({ ...current, currentPassword: event.target.value }))} required /></label>
						<label>New password<input type="password" autoComplete="new-password" minLength={8} value={passwordValues.newPassword} onChange={(event) => setPasswordValues((current) => ({ ...current, newPassword: event.target.value }))} required /></label>
						<label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={passwordValues.confirmPassword} onChange={(event) => setPasswordValues((current) => ({ ...current, confirmPassword: event.target.value }))} required /></label>
						{passwordFeedback?.type === "error" && <p className="settings-password-feedback is-error" role="alert">{passwordFeedback.message}</p>}
						<div className="admin-settings-password-actions"><button type="button" onClick={() => setShowPasswordForm(false)} disabled={passwordSaving}>Cancel</button><button type="submit" disabled={passwordSaving}>{passwordSaving ? "Updating…" : "Update password"}</button></div>
					</form>
				</div>
			)}
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
