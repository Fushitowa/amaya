import { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import NotificationIcon from "../../components/NotificationIcon.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { defaultBusinessSettings, formatBusinessTime, useBusiness } from "../../context/BusinessContext.jsx";
import { apiRequest } from "../../utils/api.js";
import {
	DEFAULT_TARGET_FOOD_COST,
	MIN_TARGET_FOOD_COST,
	MAX_TARGET_FOOD_COST,
	normalizeTargetFoodCost,
} from "../../utils/menuCosting.js";

import "../../assets/css/admin/AdminSettings.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

function isStoreOpen(openingTime, closingTime, currentDate) {
	const parseTime = (time) => {
		const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ""));
		return match ? Number(match[1]) * 60 + Number(match[2]) : null;
	};
	const opening = parseTime(openingTime);
	const closing = parseTime(closingTime);
	if (opening === null || closing === null) return false;
	if (opening === closing) return true;
	const now = currentDate.getHours() * 60 + currentDate.getMinutes();
	return closing > opening ? now >= opening && now < closing : now >= opening || now < closing;
}

function AdminSettings() {
	const { sidebarCollapsed, toggleSidebar } = useSidebar();
	const {
		businessSettings,
		settingsLoaded,
		settingsLoading,
		settingsError,
		settingsRefreshError,
		refreshBusinessSettings,
		saveBusinessSettings,
	} = useBusiness() || {};
	const [settingsDraft, setSettingsDraft] = useState({});
	const [businessNameError, setBusinessNameError] = useState("");
	const businessNameRef = useRef(null);
	const [targetFoodCostDraft, setTargetFoodCostDraft] = useState(null);
	const [targetFoodCostError, setTargetFoodCostError] = useState("");
	const targetFoodCostRef = useRef(null);
	const baseSettings = {
		...defaultBusinessSettings,
		...(businessSettings || {}),
		targetFoodCost: normalizeTargetFoodCost(businessSettings?.targetFoodCost, DEFAULT_TARGET_FOOD_COST),
	};
	const settings = { ...baseSettings, ...settingsDraft };
	const [newDiscountLabel, setNewDiscountLabel] = useState("");
	const [newDiscountPct, setNewDiscountPct] = useState("");
	const notifications = Boolean(settings.notifyAllEnabled);
	const orderAlerts = Boolean(settings.notifyOrderAlerts);
	const inventoryAlerts = Boolean(settings.notifyInventoryAlerts);
	const [saveState, setSaveState] = useState("idle");
	const [saveError, setSaveError] = useState("");
	const [lastSaved, setLastSaved] = useState(null);
	const [statusClock, setStatusClock] = useState(() => new Date());
	const [mobileNavOpen, setMobileNavOpen] = useState(false);
	const storeOpen = !settings.isTemporarilyClosed && isStoreOpen(settings.openingTime, settings.closingTime, statusClock);
	// Cashier Team State
	const [cashiers, setCashiers] = useState([]);
	const [cashiersLoading, setCashiersLoading] = useState(true);
	const [showAddCashier, setShowAddCashier] = useState(false);
	const [newCashier, setNewCashier] = useState({ displayName: "", password: "" });
	const [cashierTarget, setCashierTarget] = useState(null);
	const [targetPassword, setTargetPassword] = useState("");
	const [renameTarget, setRenameTarget] = useState(null);
	const [renameDisplayName, setRenameDisplayName] = useState("");
	const [cashierActionLoading, setCashierActionLoading] = useState(false);
	const [cashierFeedback, setCashierFeedback] = useState(null);
	const [cashierModalError, setCashierModalError] = useState("");

	const loadCashiers = useCallback(async () => {
		try {
			const data = await apiRequest("/auth/cashiers");
			setCashiers(data || []);
		} catch (err) {
			console.error("Failed to load cashiers:", err);
		} finally {
			setCashiersLoading(false);
		}
	}, []);

	useEffect(() => {
		let active = true;
		apiRequest("/auth/cashiers")
			.then((data) => {
				if (active) setCashiers(data || []);
			})
			.catch((err) => {
				console.error("Failed to load cashiers:", err);
			})
			.finally(() => {
				if (active) setCashiersLoading(false);
			});
		return () => {
			active = false;
		};
	}, []);

	const handleAddCashier = async (e) => {
		e.preventDefault();
		const displayName = newCashier.displayName.trim();
		if (!displayName) {
			setCashierModalError("Enter a cashier display name.");
			return;
		}
		if (newCashier.password.length < 6) {
			setCashierModalError("Cashier password must be at least 6 characters.");
			return;
		}
		setCashierActionLoading(true);
		setCashierModalError("");
		setCashierFeedback(null);
		try {
			const res = await apiRequest("/auth/cashiers", {
				method: "POST",
				body: JSON.stringify({ displayName, password: newCashier.password }),
			});
			setCashierFeedback({ type: "success", message: res.message || "Cashier added successfully." });
			setShowAddCashier(false);
			setNewCashier({ displayName: "", password: "" });
			await loadCashiers();
		} catch (err) {
			setCashierModalError(err.message || "Failed to add cashier.");
		} finally {
			setCashierActionLoading(false);
		}
	};

	const handleRenameCashier = async (e) => {
		e.preventDefault();
		if (!renameTarget) return;
		const trimmed = renameDisplayName.trim();
		if (trimmed.length < 2) {
			setCashierModalError("Display name must be at least 2 characters.");
			return;
		}
		setCashierActionLoading(true);
		setCashierModalError("");
		setCashierFeedback(null);
		try {
			const res = await apiRequest(`/auth/cashiers/${renameTarget.id}`, {
				method: "PUT",
				body: JSON.stringify({ displayName: trimmed }),
			});
			setCashierFeedback({ type: "success", message: res.message || `Renamed cashier to ${trimmed}.` });
			setRenameTarget(null);
			setRenameDisplayName("");
			await loadCashiers();
		} catch (err) {
			setCashierModalError(err.message || "Failed to rename cashier.");
		} finally {
			setCashierActionLoading(false);
		}
	};

	const handleChangeCashierPassword = async (e) => {
		e.preventDefault();
		if (!cashierTarget) return;
		if (targetPassword.length < 6) {
			setCashierModalError("Cashier password must be at least 6 characters.");
			return;
		}
		setCashierActionLoading(true);
		setCashierModalError("");
		setCashierFeedback(null);
		try {
			const res = await apiRequest(`/auth/cashiers/${cashierTarget.id}/password`, {
				method: "PUT",
				body: JSON.stringify({ password: targetPassword }),
			});
			setCashierFeedback({ type: "success", message: res.message || "Cashier password updated." });
			setCashierTarget(null);
			setTargetPassword("");
		} catch (err) {
			setCashierModalError(err.message || "Failed to update cashier password.");
		} finally {
			setCashierActionLoading(false);
		}
	};

	const handleToggleCashier = async (cashierId) => {
		setCashierFeedback(null);
		try {
			const res = await apiRequest(`/auth/cashiers/${cashierId}/toggle`, { method: "POST" });
			setCashierFeedback({ type: "success", message: res.message });
			await loadCashiers();
		} catch (err) {
			setCashierFeedback({ type: "error", message: err.message });
		}
	};

	const [showPasswordForm, setShowPasswordForm] = useState(false);
	const [passwordValues, setPasswordValues] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
	const [passwordSaving, setPasswordSaving] = useState(false);
	const [passwordFeedback, setPasswordFeedback] = useState(null);
	const saveTimers = useRef([]);

	useEffect(() => () => saveTimers.current.forEach((timer) => clearTimeout(timer)), []);
	useEffect(() => {
		const timer = window.setInterval(() => setStatusClock(new Date()), 60_000);
		return () => window.clearInterval(timer);
	}, []);
	useEffect(() => {
		try {
			localStorage.setItem(
				"amaya-admin-notifications",
				JSON.stringify({ notifications, orderAlerts, inventoryAlerts }),
			);
			window.dispatchEvent(new Event("amaya-admin-notification-preferences"));
		} catch {
			// Notification preferences remain available for the current session.
		}
	}, [inventoryAlerts, notifications, orderAlerts]);
	useEffect(() => {
		if (!showPasswordForm && !showAddCashier && !cashierTarget && !renameTarget) return undefined;
		const closeOnEscape = (event) => {
			if (event.key !== "Escape") return;
			if (showPasswordForm && !passwordSaving) setShowPasswordForm(false);
			if (!cashierActionLoading) {
				if (showAddCashier) setShowAddCashier(false);
				if (cashierTarget) setCashierTarget(null);
				if (renameTarget) setRenameTarget(null);
			}
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [showPasswordForm, passwordSaving, showAddCashier, cashierTarget, renameTarget, cashierActionLoading]);

	const clearSaveTimers = () => {
		saveTimers.current.forEach((timer) => clearTimeout(timer));
		saveTimers.current = [];
	};

	const updateSetting = (event) => {
		clearSaveTimers();
		const { name, type, value, checked } = event.target;
		const nextValue = type === "checkbox" ? Boolean(checked) : value;
		setSettingsDraft((current) => ({ ...current, [name]: nextValue }));
		if (name === "businessName" && businessNameError && String(nextValue).trim()) {
			setBusinessNameError("");
		}
		setSaveError("");
		if (saveState !== "saving") setSaveState("dirty");
	};

	const setRuleField = (field, nextValue) => {
		clearSaveTimers();
		setSettingsDraft((current) => ({ ...current, [field]: nextValue }));
		setSaveError("");
		if (saveState !== "saving") setSaveState("dirty");
	};

	const handleAddDiscountPreset = () => {
		const label = newDiscountLabel.trim().slice(0, 50);
		const pct = Number(newDiscountPct);
		if (!label || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
			setSaveError("Discount preset requires a label and a percentage between 0.01% and 100%.");
			return;
		}
		const currentList = Array.isArray(settings.discountPresets) ? settings.discountPresets : [];
		if (currentList.length >= 10) {
			setSaveError("Maximum of 10 discount presets reached.");
			return;
		}
		setRuleField("discountPresets", [...currentList, { label, pct: Number(pct.toFixed(2)) }]);
		setNewDiscountLabel("");
		setNewDiscountPct("");
	};

	const handleRemoveDiscountPreset = (idx) => {
		const currentList = Array.isArray(settings.discountPresets) ? settings.discountPresets : [];
		setRuleField("discountPresets", currentList.filter((_, i) => i !== idx));
	};

	const validateTargetFoodCostPct = (raw) => {
		const trimmed = String(raw ?? "").trim();
		if (!trimmed) {
			return "Enter a target food cost percentage between 10% and 90%.";
		}
		const numeric = Number(trimmed);
		if (
			!Number.isFinite(numeric) ||
			numeric < MIN_TARGET_FOOD_COST * 100 ||
			numeric > MAX_TARGET_FOOD_COST * 100
		) {
			return "Target food cost must be between 10% and 90%.";
		}
		return "";
	};

	const handleTargetFoodCostChange = (event) => {
		clearSaveTimers();
		const raw = event.target.value;
		setTargetFoodCostDraft(raw);
		setSaveError("");
		const validationMessage = validateTargetFoodCostPct(raw);
		if (!validationMessage) {
			setTargetFoodCostError("");
			const ratio = normalizeTargetFoodCost(Number(raw) / 100, DEFAULT_TARGET_FOOD_COST);
			setSettingsDraft((current) => ({ ...current, targetFoodCost: ratio }));
		} else if (targetFoodCostError) {
			setTargetFoodCostError(validationMessage);
		}
		if (saveState !== "saving") setSaveState("dirty");
	};

	const handleTargetFoodCostBlur = () => {
		const validationMessage = validateTargetFoodCostPct(targetFoodCostPctDisplay);
		setTargetFoodCostError(validationMessage);
	};

	const handleSave = async (event) => {
		event.preventDefault();
		if (!settingsLoaded || settingsError || saveState === "saving") return;

		if (!String(settings.businessName || "").trim()) {
			const message = "Business name is required.";
			setBusinessNameError(message);
			setSaveState("error");
			setSaveError(message);
			businessNameRef.current?.focus();
			return;
		}

		const validationMessage = validateTargetFoodCostPct(targetFoodCostPctDisplay);
		if (validationMessage) {
			setTargetFoodCostError(validationMessage);
			setSaveState("error");
			setSaveError(validationMessage);
			targetFoodCostRef.current?.focus();
			return;
		}

		clearSaveTimers();
		setSaveState("saving");
		setSaveError("");
		setBusinessNameError("");
		setTargetFoodCostError("");
		try {
			const normalizedFoodCost = normalizeTargetFoodCost(
				Number(targetFoodCostPctDisplay) / 100,
				DEFAULT_TARGET_FOOD_COST,
			);
			const lowThreshold = Number.parseInt(settings.lowStockThresholdPercent, 10);
			const criticalThreshold = Number.parseInt(settings.criticalStockThresholdPercent, 10);
			if (!Number.isInteger(lowThreshold) || lowThreshold < 5 || lowThreshold > 90) {
				throw new Error("Low stock threshold must be a whole number between 5% and 90%.");
			}
			if (!Number.isInteger(criticalThreshold) || criticalThreshold < 1 || criticalThreshold >= lowThreshold) {
				throw new Error("Critical stock threshold must be a whole number below the low stock threshold.");
			}
			await saveBusinessSettings({
				...settings,
				targetFoodCost: normalizedFoodCost,
				isTemporarilyClosed: Boolean(settings.isTemporarilyClosed),
				lowStockThresholdPercent: lowThreshold,
				criticalStockThresholdPercent: criticalThreshold,
				inactivityAlertDays: Number.parseInt(settings.inactivityAlertDays, 10) || 30,
				archiveRetentionDays: Number.parseInt(settings.archiveRetentionDays, 10) || 30,
				maxInventoryAdjustmentPct: Number.parseInt(settings.maxInventoryAdjustmentPct, 10) || 200,
				vatEnabled: Boolean(settings.vatEnabled),
				vatRatePercent: Number(settings.vatRatePercent ?? 12),
				discountPresets: Array.isArray(settings.discountPresets) ? settings.discountPresets : [],
				enforceShiftGate: Boolean(settings.enforceShiftGate),
				autoPrintReceipt: Boolean(settings.autoPrintReceipt),
				defaultVoidStockAction: settings.defaultVoidStockAction === "spoilage" ? "spoilage" : "restore",
				requireKitchenNoteApproval: Boolean(settings.requireKitchenNoteApproval),
				idleLockMinutes: Number.parseInt(settings.idleLockMinutes, 10) || 0,
				exportRowLimit: Number.parseInt(settings.exportRowLimit, 10) || 5000,
				notifyAllEnabled: Boolean(settings.notifyAllEnabled),
				notifyOrderAlerts: Boolean(settings.notifyOrderAlerts),
				notifyInventoryAlerts: Boolean(settings.notifyInventoryAlerts),
			});
			setSettingsDraft({});
			setTargetFoodCostDraft(null);
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

	const targetFoodCostPctDisplay = targetFoodCostDraft ?? String(Number((normalizeTargetFoodCost(settings.targetFoodCost, DEFAULT_TARGET_FOOD_COST) * 100).toFixed(2)));
	const statusPillVariant =
		saveState !== "idle"
			? saveState
			: settingsError
				? "load-error"
				: !settingsLoaded
					? "loading"
					: "idle";
	const statusPillText =
		saveState === "success"
			? "Changes saved"
			: saveState === "saving"
				? "Saving changes…"
				: saveState === "error"
					? "Save failed"
					: saveState === "dirty"
						? "Unsaved changes"
						: settingsError
							? "Load failed"
							: !settingsLoaded
								? "Loading settings…"
								: lastSaved
									? "Settings saved"
									: "Ready to configure";

	return (
		<div className={`admin-settings-page ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
      {mobileNavOpen && <div className="admin-settings-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />}
      <Sidebar
        role="admin"
        activeTab="settings"
        sidebarCollapsed={mobileNavOpen ? false : sidebarCollapsed}
        onToggle={() => (window.matchMedia("(max-width: 900px)").matches ? setMobileNavOpen((prev) => !prev) : toggleSidebar())}
      />

			<main className="admin-settings-main">
				<header className="admin-settings-topbar">
					<div className="admin-settings-topbar-left">
						<button
							type="button"
							className="settings-mobile-menu-btn"
							onClick={() => setMobileNavOpen((prev) => !prev)}
							aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
							aria-expanded={mobileNavOpen}
						>
							<Menu size={20} strokeWidth={2.2} aria-hidden="true" />
						</button>
						<div><span className="admin-settings-section-label">ADMIN PORTAL</span><h1>Settings</h1></div>
					</div>
					<div className="admin-settings-topbar-actions">
					</div>
				</header>

				<div className="admin-settings-content">
					<section className="admin-settings-heading">
						<div>
							<span className="admin-settings-eyebrow">WORKSPACE CONTROL</span>
							<h2>Keep Amaya running smoothly.</h2>
							<p>Manage your cafe profile, operating hours, food cost targets, and cashier team from one place.</p>
						</div>
						<div className={`admin-settings-save-state is-${statusPillVariant}`} role="status" aria-live="polite"><span className="settings-status-dot" aria-hidden="true"></span>{statusPillText}</div>
					</section>

					{settingsError && (
						<div className="settings-load-banner" role="alert">
							<span>
								Could not load current settings ({settingsError}). Retry before saving so existing values aren&apos;t overwritten.
							</span>
							<button
								type="button"
								className="settings-retry-button"
								disabled={settingsLoading}
								aria-busy={settingsLoading ? "true" : undefined}
								onClick={() => refreshBusinessSettings?.({ force: true })}
							>
								{settingsLoading ? "Retrying…" : "Retry loading"}
							</button>
						</div>
					)}

					{settingsRefreshError && !settingsError && (
						<div className="settings-refresh-banner" role="status">
							<span>
								Could not refresh latest settings ({settingsRefreshError}). You can keep editing saved values or retry refreshing.
							</span>
							<button
								type="button"
								className="settings-refresh-button"
								disabled={settingsLoading}
								aria-busy={settingsLoading ? "true" : undefined}
								onClick={() => refreshBusinessSettings?.({ force: true })}
							>
								{settingsLoading ? "Refreshing…" : "Refresh"}
							</button>
						</div>
					)}

					<form className="admin-settings-form" onSubmit={handleSave} noValidate>
						<div className="admin-settings-layout">
							<div className="admin-settings-primary-column">
								<section className="admin-settings-card">
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon">⌂</div><div><h3>Business profile</h3><p>Keep your public cafe details accurate.</p></div></div>
									<div className="admin-settings-fields">
										<label htmlFor="settings-business-name-input">
											Business name
											<input
												id="settings-business-name-input"
												ref={businessNameRef}
												name="businessName"
												value={settings.businessName}
												onChange={updateSetting}
												required
												aria-invalid={businessNameError ? "true" : undefined}
												aria-describedby={businessNameError ? "business-name-error" : undefined}
											/>
											{businessNameError && (
												<p id="business-name-error" className="settings-field-error" role="alert">
													{businessNameError}
												</p>
											)}
										</label>
										<label>Public storefront contact email<input type="email" name="email" value={settings.email} onChange={updateSetting} /></label>
										<label>Contact number<input type="tel" name="phone" autoComplete="tel" value={settings.phone} onChange={updateSetting} /></label>
										<label className="field-wide">Store address<input name="address" autoComplete="street-address" value={settings.address} onChange={updateSetting} /></label>
									</div>
								</section>

								<section className="admin-settings-card">
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon">◷</div><div><h3>Operating hours &amp; store status</h3><p>Set storefront hours or pause ordering manually.</p></div></div>
									<div className="admin-settings-fields hours-fields">
										<label>Opening time<input type="time" name="openingTime" value={settings.openingTime} onChange={updateSetting} /></label>
										<label>Closing time<input type="time" name="closingTime" value={settings.closingTime} onChange={updateSetting} /></label>
									</div>
									<div style={{ marginTop: "14px" }}>
										<SettingToggle
											label="Temporarily close storefront"
											description="Display a temporary closure notice on the public storefront immediately."
											enabled={Boolean(settings.isTemporarilyClosed)}
											onToggle={() => setRuleField("isTemporarilyClosed", !settings.isTemporarilyClosed)}
										/>
									</div>
									<div className={`admin-settings-hours-note ${storeOpen ? "is-open" : "is-closed"}`}><span aria-hidden="true">●</span> Store is currently {settings.isTemporarilyClosed ? "paused (closed manually)" : storeOpen ? "open" : "closed"}<strong>Today, {formatBusinessTime(settings.openingTime)} - {formatBusinessTime(settings.closingTime)}</strong></div>
								</section>

								<section className="admin-settings-card">
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon">%</div><div><h3>Financial targets &amp; inventory rules</h3><p>Food cost targets, stock health alerts, archive retention &amp; export caps.</p></div></div>
									<div className="admin-settings-fields">
										<label htmlFor="target-food-cost-input">
											Target food cost (%)
											<input
												id="target-food-cost-input"
												ref={targetFoodCostRef}
												type="number"
												name="targetFoodCostPct"
												min="10"
												max="90"
												step="0.01"
												inputMode="decimal"
												value={targetFoodCostPctDisplay}
												onChange={handleTargetFoodCostChange}
												onBlur={handleTargetFoodCostBlur}
												aria-invalid={targetFoodCostError ? "true" : undefined}
												aria-describedby={targetFoodCostError ? "target-food-cost-error target-food-cost-help" : "target-food-cost-help"}
											/>
											{targetFoodCostError && (
												<p id="target-food-cost-error" className="settings-field-error" role="alert">
													{targetFoodCostError}
												</p>
											)}
											<p id="target-food-cost-help" className="settings-field-help">
												Menu price previews &amp; Report variance (10%–90%).
											</p>
										</label>
										<label>
											Low stock warning (%)
											<input type="number" min="5" max="90" value={settings.lowStockThresholdPercent ?? 40} onChange={(e) => setRuleField("lowStockThresholdPercent", e.target.value)} />
										</label>
										<label>
											Critical stock alert (%)
											<input type="number" min="1" max="85" value={settings.criticalStockThresholdPercent ?? 20} onChange={(e) => setRuleField("criticalStockThresholdPercent", e.target.value)} />
										</label>
										<label>
											Dead-stock inactivity (days)
											<input type="number" min="1" max="365" value={settings.inactivityAlertDays ?? 30} onChange={(e) => setRuleField("inactivityAlertDays", e.target.value)} />
										</label>
										<label>
											Archive retention window (days)
											<input type="number" min="1" max="365" value={settings.archiveRetentionDays ?? 30} onChange={(e) => setRuleField("archiveRetentionDays", e.target.value)} />
										</label>
										<label>
											Adjustment variance guard (%)
											<input type="number" min="25" max="1000" value={settings.maxInventoryAdjustmentPct ?? 200} onChange={(e) => setRuleField("maxInventoryAdjustmentPct", e.target.value)} />
										</label>
										<label className="field-wide">
											CSV export row limit (100–25,000)
											<input type="number" min="100" max="25000" step="100" value={settings.exportRowLimit ?? 5000} onChange={(e) => setRuleField("exportRowLimit", e.target.value)} />
										</label>
									</div>
								</section>

								<section className="admin-settings-card">
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon">₱</div><div><h3>POS tax, discounts &amp; checkout policy</h3><p>Control VAT collection, cashier shift gates, void stock behavior, and receipt footer.</p></div></div>
									<SettingToggle
										label="Charge VAT on POS orders"
										description="Calculate tax on checkout and credit Liability 2020 in the double-entry ledger."
										enabled={Boolean(settings.vatEnabled)}
										onToggle={() => setRuleField("vatEnabled", !settings.vatEnabled)}
									/>
									{settings.vatEnabled && (
										<div className="admin-settings-fields" style={{ marginBottom: "12px" }}>
											<label>
												VAT rate (%)
												<input type="number" min="0" max="30" step="0.5" value={settings.vatRatePercent ?? 12} onChange={(e) => setRuleField("vatRatePercent", e.target.value)} />
											</label>
										</div>
									)}
									<SettingToggle
										label="Require open cashier shift before checkout"
										description="Block POS order placement unless the signed-in cashier has an open drawer session."
										enabled={Boolean(settings.enforceShiftGate)}
										onToggle={() => setRuleField("enforceShiftGate", !settings.enforceShiftGate)}
									/>
									<SettingToggle
										label="Auto-print POS receipt"
										description="Automatically open the print dialog when landing on Staff Receipt."
										enabled={Boolean(settings.autoPrintReceipt)}
										onToggle={() => setRuleField("autoPrintReceipt", !settings.autoPrintReceipt)}
									/>
									<SettingToggle
										label="Kitchen note AI guard check"
										description="Screen free-text customer kitchen notes for unpaid extras or allergy warnings before checkout."
										enabled={Boolean(settings.requireKitchenNoteApproval)}
										onToggle={() => setRuleField("requireKitchenNoteApproval", !settings.requireKitchenNoteApproval)}
									/>
									<div className="admin-settings-fields" style={{ marginTop: "14px" }}>
										<label>
											Default void action (Preparing / Completed)
											<select
												value={settings.defaultVoidStockAction || "restore"}
												onChange={(e) => setRuleField("defaultVoidStockAction", e.target.value)}
												style={{ width: "100%", minHeight: "44px", padding: "0 12px", border: "1px solid #e5dcd5", borderRadius: "7px", background: "#fffdfb", font: "12px 'DM Sans', sans-serif" }}
											>
												<option value="restore">Restore ingredients to stock</option>
												<option value="spoilage">Record as wasted / spoilage</option>
											</select>
										</label>
										<label>
											Thermal receipt footer note
											<input maxLength={255} value={settings.receiptFooter ?? ""} onChange={(e) => setRuleField("receiptFooter", e.target.value)} placeholder="Thank you for visiting Amaya!" />
										</label>
									</div>

									<div style={{ marginTop: "18px", paddingTop: "14px", borderTop: "1px solid #f1ebe6" }}>
										<strong style={{ display: "block", fontSize: "12px", color: "var(--settings-ink)", marginBottom: "8px" }}>
											POS Discount Presets ({(settings.discountPresets || []).length}/10)
										</strong>
										<div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "10px" }}>
											{(settings.discountPresets || []).map((preset, idx) => (
												<div key={`${preset.label}-${idx}`} className="security-row" style={{ padding: "8px 0" }}>
													<div>
														<strong>{preset.label}</strong>
														<span>{Number(preset.pct)}% off subtotal (DR 4020 Sales Discounts)</span>
													</div>
													<button type="button" className="settings-secondary-button" onClick={() => handleRemoveDiscountPreset(idx)}>
														Remove
													</button>
												</div>
											))}
										</div>
										<div style={{ display: "grid", gridTemplateColumns: "1fr 110px auto", gap: "8px", alignItems: "center" }}>
											<input
												type="text"
												placeholder="Preset label (e.g. Promo 15%)"
												value={newDiscountLabel}
												onChange={(e) => setNewDiscountLabel(e.target.value)}
												style={{ minHeight: "38px", padding: "0 10px", border: "1px solid #e5dcd5", borderRadius: "7px", fontSize: "12px" }}
											/>
											<input
												type="number"
												min="0.01"
												max="100"
												step="0.5"
												placeholder="%"
												value={newDiscountPct}
												onChange={(e) => setNewDiscountPct(e.target.value)}
												style={{ minHeight: "38px", padding: "0 10px", border: "1px solid #e5dcd5", borderRadius: "7px", fontSize: "12px" }}
											/>
											<button type="button" className="settings-secondary-button" onClick={handleAddDiscountPreset}>
												+ Add
											</button>
										</div>
									</div>
								</section>
							</div>

							<div className="admin-settings-secondary-column">
								<section className="admin-settings-card notifications-card">
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon"><NotificationIcon size={17} /></div><div><h3>Notifications</h3><p>Synced to your account &amp; saved on submit.</p></div><span className="settings-local-badge">Account synced</span></div>
									<SettingToggle label="Admin notifications" description="Receive operational updates across portal bells." enabled={notifications} onToggle={() => setRuleField("notifyAllEnabled", !notifications)} />
									<SettingToggle label="New order alerts" description="Show an alert when a customer order arrives." enabled={orderAlerts} onToggle={() => setRuleField("notifyOrderAlerts", !orderAlerts)} />
									<SettingToggle label="Inventory limit alerts" description="Show alerts when stock is out, low, or above maximum." enabled={inventoryAlerts} onToggle={() => setRuleField("notifyInventoryAlerts", !inventoryAlerts)} />
								</section>

								<section className="admin-settings-card security-card">
									<div className="admin-settings-card-header"><div className="admin-settings-card-icon">▣</div><div><h3>Account &amp; session security</h3><p>Credentials, JWT RBAC &amp; idle portal auto-lock.</p></div></div>
									<div className="security-row"><div><strong>Password</strong><span>Keep your administrator account secure.</span></div><button type="button" className="settings-secondary-button" onClick={() => { setPasswordFeedback(null); setShowPasswordForm(true); }}>Update</button></div>
									<div className="security-row">
										<div>
											<strong>Idle session auto-lock</strong>
											<span>Automatically sign out inactive terminals after idle period.</span>
										</div>
										<select
											aria-label="Idle session auto-lock"
											value={settings.idleLockMinutes ?? 15}
											onChange={(e) => setRuleField("idleLockMinutes", Number(e.target.value))}
											style={{ padding: "6px 10px", borderRadius: "6px", border: "1px solid #dfd4ca", fontSize: "11px", fontWeight: 600 }}
										>
											<option value={0}>Disabled</option>
											<option value={5}>5 mins</option>
											<option value={10}>10 mins</option>
											<option value={15}>15 mins</option>
											<option value={30}>30 mins</option>
											<option value={60}>1 hour</option>
											<option value={120}>2 hours</option>
										</select>
									</div>
								</section>

								<section className="admin-settings-card cashiers-card">
									<div className="admin-settings-card-header" style={{ justifyContent: "space-between", alignItems: "flex-start", width: "100%", gap: "10px" }}>
										<div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
											<div className="admin-settings-card-icon">CS</div>
											<div>
												<h3>Counter Cashiers</h3>
												<p>All cashiers sign in with <strong>staff</strong> and their personal password.</p>
											</div>
										</div>
										<button type="button" className="settings-secondary-button settings-add-cashier-btn" onClick={() => { setCashierFeedback(null); setCashierModalError(""); setShowAddCashier(true); }}>
											+ Add Cashier
										</button>
									</div>

									{cashierFeedback && (
										<p className={`settings-password-feedback is-${cashierFeedback.type}`} style={{ margin: "0 0 12px" }} role={cashierFeedback.type === "error" ? "alert" : "status"}>
											{cashierFeedback.message}
										</p>
									)}

									{cashiersLoading ? (
										<div style={{ padding: "8px 0", fontSize: "12px", color: "var(--settings-muted)" }}>Loading cashier team...</div>
									) : cashiers.length === 0 ? (
										<div style={{ padding: "8px 0", fontSize: "12px", color: "var(--settings-muted)" }}>No cashiers configured yet. Click &ldquo;+ Add Cashier&rdquo; to create one.</div>
									) : (
										<div className="cashiers-list">
											{cashiers.map((c) => (
												<div key={c.id} className="security-row cashier-row-item">
													<div>
														<div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
															<strong style={{ fontSize: "13px" }}>{c.displayName}</strong>
															<span style={{ padding: "2px 6px", background: "#f0ece7", border: "1px solid #dfd4ca", borderRadius: "4px", fontSize: "10px", color: "#6b5548", fontWeight: "bold" }}>
																login: staff
															</span>
															<span style={{ padding: "2px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: "bold", background: c.isActive ? "#E9F5EC" : "#FEE2E2", color: c.isActive ? "#15803D" : "#B91C1C" }}>
																{c.isActive ? "Active" : "Inactive"}
															</span>
														</div>
														<span style={{ fontSize: "11px", color: "var(--settings-muted)", marginTop: "2px" }}>
															Attributed in shift logs &amp; sales reports
														</span>
													</div>
													<div className="cashier-row-actions">
														<button type="button" className="settings-secondary-button" onClick={() => { setCashierFeedback(null); setCashierModalError(""); setRenameTarget(c); setRenameDisplayName(c.displayName || ""); }}>
															Rename
														</button>
														<button type="button" className="settings-secondary-button" onClick={() => { setCashierFeedback(null); setCashierModalError(""); setCashierTarget(c); setTargetPassword(""); }}>
															Password
														</button>
														<button type="button" className="settings-secondary-button" style={{ color: c.isActive ? "#b91c1c" : "#15803d" }} onClick={() => handleToggleCashier(c.id)}>
															{c.isActive ? "Disable" : "Enable"}
														</button>
													</div>
												</div>
											))}
										</div>
									)}
								</section>
							</div>
						</div>

						{saveError && <p className="settings-save-error" role="alert">{saveError}</p>}
						{passwordFeedback && <p className={`settings-password-feedback is-${passwordFeedback.type}`} role={passwordFeedback.type === "error" ? "alert" : "status"}>{passwordFeedback.message}</p>}
						<div className="admin-settings-footer"><span>{lastSaved ? `Last saved ${lastSaved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · Browser notifications auto-save locally` : "Business profile, hours & food cost targets save to the database when you submit."}</span><button type="submit" className={`admin-settings-save-button is-${saveState}`} disabled={!settingsLoaded || Boolean(settingsError) || saveState === "saving"} title={!settingsLoaded || settingsError ? "Load settings first before saving changes" : undefined} aria-live="polite">{saveState === "saving" ? <><span className="save-spinner" aria-hidden="true"></span>Saving changes</> : saveState === "success" ? <><span className="save-check" aria-hidden="true">✓</span>Changes Saved</> : saveState === "error" ? <>Retry save <span aria-hidden="true">↻</span></> : <>Save changes <span aria-hidden="true">→</span></>}</button></div>
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

			{showAddCashier && (
				<div className="admin-settings-modal-backdrop" role="presentation" onClick={() => !cashierActionLoading && setShowAddCashier(false)}>
					<form className="admin-settings-password-modal" onSubmit={handleAddCashier} role="dialog" aria-modal="true" aria-labelledby="add-cashier-title" onClick={(event) => event.stopPropagation()}>
						<div className="admin-settings-card-header">
							<div className="admin-settings-card-icon">CS</div>
							<div>
								<h3 id="add-cashier-title">Add Counter Cashier</h3>
								<p>Username is automatically <strong>staff</strong>.</p>
							</div>
							<button type="button" onClick={() => setShowAddCashier(false)} disabled={cashierActionLoading} aria-label="Close form">×</button>
						</div>
						<label>
							Cashier identifier / name
							<input
								type="text"
								placeholder="e.g. Cashier 2, Maria"
								value={newCashier.displayName}
								onChange={(e) => setNewCashier((cur) => ({ ...cur, displayName: e.target.value }))}
								required
								autoFocus
							/>
						</label>
						<label>
							Assigned cashier password
							<input
								type="password"
								placeholder="Minimum 6 characters"
								minLength={6}
								value={newCashier.password}
								onChange={(e) => setNewCashier((cur) => ({ ...cur, password: e.target.value }))}
								required
							/>
						</label>
						{cashierModalError && <p className="settings-password-feedback is-error" role="alert">{cashierModalError}</p>}
						<div className="admin-settings-password-actions">
							<button type="button" onClick={() => setShowAddCashier(false)} disabled={cashierActionLoading}>Cancel</button>
							<button type="submit" disabled={cashierActionLoading}>{cashierActionLoading ? "Creating…" : "Create Cashier"}</button>
						</div>
					</form>
				</div>
			)}

			{renameTarget && (
				<div className="admin-settings-modal-backdrop" role="presentation" onClick={() => !cashierActionLoading && setRenameTarget(null)}>
					<form className="admin-settings-password-modal" onSubmit={handleRenameCashier} role="dialog" aria-modal="true" aria-labelledby="rename-cashier-title" onClick={(event) => event.stopPropagation()}>
						<div className="admin-settings-card-header">
							<div className="admin-settings-card-icon">ID</div>
							<div>
								<h3 id="rename-cashier-title">Rename Cashier</h3>
								<p>Update display name for <strong>{renameTarget.displayName}</strong>.</p>
							</div>
							<button type="button" onClick={() => setRenameTarget(null)} disabled={cashierActionLoading} aria-label="Close form">×</button>
						</div>
						<label>
							New display name
							<input
								type="text"
								placeholder="e.g. Maria S."
								minLength={2}
								maxLength={80}
								value={renameDisplayName}
								onChange={(e) => setRenameDisplayName(e.target.value)}
								required
								autoFocus
							/>
						</label>
						{cashierModalError && <p className="settings-password-feedback is-error" role="alert">{cashierModalError}</p>}
						<div className="admin-settings-password-actions">
							<button type="button" onClick={() => setRenameTarget(null)} disabled={cashierActionLoading}>Cancel</button>
							<button type="submit" disabled={cashierActionLoading}>{cashierActionLoading ? "Saving…" : "Save Name"}</button>
						</div>
					</form>
				</div>
			)}

			{cashierTarget && (
				<div className="admin-settings-modal-backdrop" role="presentation" onClick={() => !cashierActionLoading && setCashierTarget(null)}>
					<form className="admin-settings-password-modal" onSubmit={handleChangeCashierPassword} role="dialog" aria-modal="true" aria-labelledby="edit-cashier-title" onClick={(event) => event.stopPropagation()}>
						<div className="admin-settings-card-header">
							<div className="admin-settings-card-icon">PW</div>
							<div>
								<h3 id="edit-cashier-title">Change Cashier Password</h3>
								<p>Update password for <strong>{cashierTarget.displayName}</strong>.</p>
							</div>
							<button type="button" onClick={() => setCashierTarget(null)} disabled={cashierActionLoading} aria-label="Close form">×</button>
						</div>
						<label>
							New password for {cashierTarget.displayName}
							<input
								type="password"
								placeholder="Minimum 6 characters"
								minLength={6}
								value={targetPassword}
								onChange={(e) => setTargetPassword(e.target.value)}
								required
								autoFocus
							/>
						</label>
						{cashierModalError && <p className="settings-password-feedback is-error" role="alert">{cashierModalError}</p>}
						<div className="admin-settings-password-actions">
							<button type="button" onClick={() => setCashierTarget(null)} disabled={cashierActionLoading}>Cancel</button>
							<button type="submit" disabled={cashierActionLoading}>{cashierActionLoading ? "Updating…" : "Save New Password"}</button>
						</div>
					</form>
				</div>
			)}

		</div>
	);
}

function SettingToggle({ label, description, enabled, onToggle }) {
	const labelId = `setting-toggle-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
	const descId = `${labelId}-desc`;
	return (
		<div className="admin-settings-toggle-row">
			<div><strong id={labelId}>{label}</strong><p id={descId}>{description}</p></div>
			<button type="button" role="switch" aria-checked={Boolean(enabled)} aria-labelledby={labelId} aria-describedby={descId} className={`admin-settings-toggle ${enabled ? "is-active" : ""}`} onClick={onToggle}><span aria-hidden="true"></span></button>
		</div>
	);
}

export default AdminSettings;
