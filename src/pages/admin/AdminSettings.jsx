import { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { defaultBusinessSettings, formatBusinessTime, useBusiness } from "../../context/BusinessContext.jsx";
import { apiRequest } from "../../utils/api.js";
import { formatManilaTime, MANILA_TIMEZONE } from "../../../shared/manilaDate.js";
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

const SETTINGS_SECTIONS = [
	{ id: "store", label: "Store" },
	{ id: "checkout", label: "Orders & checkout" },
	{ id: "stock", label: "Food cost & stock" },
	{ id: "team", label: "Cashier team" },
	{ id: "alerts", label: "Alerts" },
	{ id: "security", label: "Security" },
];

function isStoreOpen(openingTime, closingTime, currentDate) {
	const parseTime = (time) => {
		const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time || ""));
		return match ? Number(match[1]) * 60 + Number(match[2]) : null;
	};
	const opening = parseTime(openingTime);
	const closing = parseTime(closingTime);
	if (opening === null || closing === null) return false;
	if (opening === closing) return true;
	const [manilaHour, manilaMinute] = new Intl.DateTimeFormat("en-GB", {
		timeZone: MANILA_TIMEZONE,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(currentDate).split(":").map(Number);
	const now = manilaHour * 60 + manilaMinute;
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
	const [activeSection, setActiveSection] = useState("store");
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
		// Highlight the section being read in the "On this page" list.
		const sections = SETTINGS_SECTIONS.map((section) => document.getElementById(`settings-${section.id}`)).filter(Boolean);
		if (!sections.length || typeof IntersectionObserver === "undefined") return undefined;
		const observer = new IntersectionObserver((entries) => {
			const topmost = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
			if (topmost) setActiveSection(topmost.target.id.replace("settings-", ""));
		}, { rootMargin: "-130px 0px -60% 0px" });
		sections.forEach((section) => observer.observe(section));
		return () => observer.disconnect();
	}, []);

	const goToSection = (sectionId) => {
		const target = document.getElementById(`settings-${sectionId}`);
		if (!target) return;
		setActiveSection(sectionId);
		const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
	};
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
		if (!settingsLoaded || settingsError || saveState === "saving") return false;

		if (!String(settings.businessName || "").trim()) {
			const message = "Business name is required.";
			setBusinessNameError(message);
			setSaveState("error");
			setSaveError(message);
			businessNameRef.current?.focus();
			return false;
		}

		const validationMessage = validateTargetFoodCostPct(targetFoodCostPctDisplay);
		if (validationMessage) {
			setTargetFoodCostError(validationMessage);
			setSaveState("error");
			setSaveError(validationMessage);
			targetFoodCostRef.current?.focus();
			return false;
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
			return true;
		} catch (error) {
			setSaveState("error");
			setSaveError(error.message || "Could not save the settings. Please retry.");
			return false;
		}
	};

	// ---- Unsaved changes guard: stay on this page until changes are saved or discarded ----
	const hasUnsaved = Object.keys(settingsDraft).length > 0 || targetFoodCostDraft !== null;
	const [leavePrompt, setLeavePrompt] = useState(null);
	const bypassGuardRef = useRef(false);
	const skipUnloadRef = useRef(false);
	const ignorePopRef = useRef(false);
	const sentinelRef = useRef(false);

	useEffect(() => {
		if (!hasUnsaved) return undefined;
		const guardPath = window.location.pathname;
		// Closing or reloading the tab
		const onBeforeUnload = (event) => {
			if (skipUnloadRef.current) return;
			event.preventDefault();
			event.returnValue = "";
		};
		// Clicking any link, including the sidebar
		const onClick = (event) => {
			if (bypassGuardRef.current || event.defaultPrevented || event.button !== 0) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
			if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
			const url = new URL(anchor.href, window.location.href);
			if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.search === window.location.search) return;
			event.preventDefault();
			event.stopPropagation();
			setLeavePrompt({ anchor });
		};
		// The browser back button: add one extra history entry and absorb the first back press
		window.history.pushState({ ...(window.history.state || {}), settingsGuard: true }, "", window.location.href);
		sentinelRef.current = true;
		const onPopState = (event) => {
			// A same-page #link also fires popstate, with no history state: it is not a back press
			if (!event.state) return;
			if (ignorePopRef.current) {
				ignorePopRef.current = false;
				return;
			}
			window.history.pushState({ ...(window.history.state || {}), settingsGuard: true }, "", window.location.href);
			setLeavePrompt({ back: true });
		};
		window.addEventListener("beforeunload", onBeforeUnload);
		document.addEventListener("click", onClick, true);
		window.addEventListener("popstate", onPopState);
		return () => {
			window.removeEventListener("beforeunload", onBeforeUnload);
			document.removeEventListener("click", onClick, true);
			window.removeEventListener("popstate", onPopState);
			// Changes were saved or discarded and we are still here: remove the extra history entry
			if (sentinelRef.current && window.location.pathname === guardPath) {
				ignorePopRef.current = true;
				window.history.back();
			}
			sentinelRef.current = false;
		};
	}, [hasUnsaved]);

	useEffect(() => {
		if (!leavePrompt) return undefined;
		const closeOnEscape = (event) => {
			if (event.key === "Escape") setLeavePrompt(null);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [leavePrompt]);

	const continueLeaving = (prompt) => {
		skipUnloadRef.current = true;
		setLeavePrompt(null);
		if (prompt?.anchor) {
			// Replay the click that was held back, so links, log out and the like behave normally
			bypassGuardRef.current = true;
			prompt.anchor.click();
			bypassGuardRef.current = false;
		} else if (prompt?.back) {
			sentinelRef.current = false;
			ignorePopRef.current = true;
			window.history.go(-2);
		}
		window.setTimeout(() => { skipUnloadRef.current = false; }, 1500);
	};

	const handleLeaveWithoutSaving = () => {
		const prompt = leavePrompt;
		setSettingsDraft({});
		setTargetFoodCostDraft(null);
		setSaveState("idle");
		setSaveError("");
		continueLeaving(prompt);
	};

	const handleSaveAndLeave = async () => {
		const prompt = leavePrompt;
		const saved = await handleSave({ preventDefault() {} });
		if (saved) continueLeaving(prompt);
		else setLeavePrompt(null);
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
						<div className={`admin-settings-save-state is-${statusPillVariant}`} role="status" aria-live="polite"><span className="settings-status-dot" aria-hidden="true"></span>{statusPillText}</div>
					</div>
				</header>

					<div className="admin-settings-content">
						<div className="st-layout">
							<nav className="st-nav" aria-label="Settings sections">
								<span className="st-nav-title">On this page</span>
								{SETTINGS_SECTIONS.map((section) => (
									<button
										key={section.id}
										type="button"
										className={`st-nav-link${activeSection === section.id ? " is-active" : ""}`}
										aria-current={activeSection === section.id ? "true" : undefined}
										onClick={() => goToSection(section.id)}
									>
										{section.label}
									</button>
								))}
							</nav>

							<div className="st-content">
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
									{/* ---------- Store ---------- */}
									<section id="settings-store" className="st-section" aria-labelledby="st-store-title">
										<header className="st-section-head">
											<div>
												<h2 id="st-store-title">Store</h2>
												<p>Your shop details and opening hours.</p>
											</div>
										</header>

										<div className="st-group">
											<h3>Business details</h3>
											<div className="st-fields">
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
												<label>Contact email<input type="email" name="email" value={settings.email} onChange={updateSetting} /></label>
												<label>Contact number<input type="tel" name="phone" autoComplete="tel" value={settings.phone} onChange={updateSetting} /></label>
												<label className="is-wide">Store address<input name="address" autoComplete="street-address" value={settings.address} onChange={updateSetting} /></label>
											</div>
										</div>

										<div className="st-group">
											<h3>Opening hours</h3>
											<SettingRow id="settings-hours" label="Open from" description="Customers can order between these times.">
												<div className="st-time-pair">
													<input id="settings-hours" aria-label="Opening time" type="time" name="openingTime" value={settings.openingTime} onChange={updateSetting} />
													<span aria-hidden="true">to</span>
													<input aria-label="Closing time" type="time" name="closingTime" value={settings.closingTime} onChange={updateSetting} />
												</div>
											</SettingRow>
											<SettingToggle
												label="Pause ordering"
												description="Show a temporary closed notice on the storefront right away."
												enabled={Boolean(settings.isTemporarilyClosed)}
												onToggle={() => setRuleField("isTemporarilyClosed", !settings.isTemporarilyClosed)}
											/>
											<div className={`st-status ${storeOpen ? "is-open" : "is-closed"}`}>
												<span aria-hidden="true">●</span>
												Store is {settings.isTemporarilyClosed ? "paused (closed manually)" : storeOpen ? "open now" : "closed now"}
												<strong>{formatBusinessTime(settings.openingTime)} - {formatBusinessTime(settings.closingTime)}</strong>
											</div>
										</div>
									</section>

									{/* ---------- Orders & checkout ---------- */}
									<section id="settings-checkout" className="st-section" aria-labelledby="st-checkout-title">
										<header className="st-section-head">
											<div>
												<h2 id="st-checkout-title">Orders &amp; checkout</h2>
												<p>How the counter takes orders, prints receipts and gives discounts.</p>
											</div>
										</header>

										<div className="st-group">
											<h3>Tax</h3>
											<SettingToggle
												label="Charge VAT on orders"
												description="Adds VAT to each POS order at checkout."
												enabled={Boolean(settings.vatEnabled)}
												onToggle={() => setRuleField("vatEnabled", !settings.vatEnabled)}
											/>
											{settings.vatEnabled && (
												<SettingRow id="settings-vat-rate" label="VAT rate" description="Percentage added to the order total.">
													<UnitInput id="settings-vat-rate" unit="%" min="0" max="30" step="0.5" value={settings.vatRatePercent ?? 12} onChange={(e) => setRuleField("vatRatePercent", e.target.value)} />
												</SettingRow>
											)}
										</div>

										<div className="st-group">
											<h3>Cashier rules</h3>
											<SettingToggle
												label="Cashier must open a shift first"
												description="Orders can only be placed after the cashier opens their cash drawer shift."
												enabled={Boolean(settings.enforceShiftGate)}
												onToggle={() => setRuleField("enforceShiftGate", !settings.enforceShiftGate)}
											/>
											<SettingToggle
												label="Print receipts automatically"
												description="Open the print window as soon as a receipt appears."
												enabled={Boolean(settings.autoPrintReceipt)}
												onToggle={() => setRuleField("autoPrintReceipt", !settings.autoPrintReceipt)}
											/>
											<SettingToggle
												label="Check kitchen notes before checkout"
												description="Look for unpaid extras or allergy warnings in customer notes."
												enabled={Boolean(settings.requireKitchenNoteApproval)}
												onToggle={() => setRuleField("requireKitchenNoteApproval", !settings.requireKitchenNoteApproval)}
											/>
										</div>

										<div className="st-group">
											<h3>Cancelled orders &amp; receipts</h3>
											<SettingRow id="settings-void-action" label="When a started order is cancelled" description="Choose what happens to the ingredients already used.">
												<select id="settings-void-action" className="st-select" value={settings.defaultVoidStockAction || "restore"} onChange={(e) => setRuleField("defaultVoidStockAction", e.target.value)}>
													<option value="restore">Put ingredients back in stock</option>
													<option value="spoilage">Record them as wasted</option>
												</select>
											</SettingRow>
											<SettingRow id="settings-receipt-footer" label="Receipt message" description="Printed at the bottom of every receipt.">
												<input id="settings-receipt-footer" className="st-text" maxLength={255} value={settings.receiptFooter ?? ""} onChange={(e) => setRuleField("receiptFooter", e.target.value)} placeholder="Thank you for visiting Amaya!" />
											</SettingRow>
										</div>

										<div className="st-group">
											<h3>Discount presets <span className="st-count">{(settings.discountPresets || []).length} of 10</span></h3>
											{(settings.discountPresets || []).length === 0 && <p className="st-empty">No discount presets yet. Add one below.</p>}
											{(settings.discountPresets || []).map((preset, idx) => (
												<div key={`${preset.label}-${idx}`} className="st-row">
													<div className="st-row-text">
														<strong>{preset.label}</strong>
														<p>{Number(preset.pct)}% off the subtotal</p>
													</div>
													<div className="st-row-control">
														<button type="button" className="settings-secondary-button is-danger" onClick={() => handleRemoveDiscountPreset(idx)}>
															Remove
														</button>
													</div>
												</div>
											))}
											<div className="st-add-preset">
												<input type="text" aria-label="Discount name" placeholder="Name, for example Senior citizen" value={newDiscountLabel} onChange={(e) => setNewDiscountLabel(e.target.value)} />
												<span className="st-unit">
													<input type="number" aria-label="Discount percent" min="0.01" max="100" step="0.5" placeholder="0" value={newDiscountPct} onChange={(e) => setNewDiscountPct(e.target.value)} />
													<i>%</i>
												</span>
												<button type="button" className="settings-secondary-button" onClick={handleAddDiscountPreset}>
													Add discount
												</button>
											</div>
										</div>
									</section>

									{/* ---------- Food cost & stock ---------- */}
									<section id="settings-stock" className="st-section" aria-labelledby="st-stock-title">
										<header className="st-section-head">
											<div>
												<h2 id="st-stock-title">Food cost &amp; stock</h2>
												<p>Targets and warnings for your ingredients and reports.</p>
											</div>
										</header>

										<div className="st-group">
											<h3>Food cost</h3>
											<div className="st-row">
												<div className="st-row-text">
													<label htmlFor="target-food-cost-input">Target food cost</label>
													<p id="target-food-cost-help">Share of each sale you aim to spend on ingredients. Used for menu price ideas and the Reports page (10% to 90%).</p>
													{targetFoodCostError && (
														<p id="target-food-cost-error" className="settings-field-error" role="alert">
															{targetFoodCostError}
														</p>
													)}
												</div>
												<div className="st-row-control">
													<span className="st-unit">
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
														<i>%</i>
													</span>
												</div>
											</div>
										</div>

										<div className="st-group">
											<h3>Stock warnings</h3>
											<SettingRow id="settings-low-stock" label="Low stock warning" description="Flag an ingredient as low when it falls to this share of its maximum.">
												<UnitInput id="settings-low-stock" unit="%" min="5" max="90" value={settings.lowStockThresholdPercent ?? 40} onChange={(e) => setRuleField("lowStockThresholdPercent", e.target.value)} />
											</SettingRow>
											<SettingRow id="settings-critical-stock" label="Critical stock alert" description="Flag it as urgent when it falls to this share.">
												<UnitInput id="settings-critical-stock" unit="%" min="1" max="85" value={settings.criticalStockThresholdPercent ?? 20} onChange={(e) => setRuleField("criticalStockThresholdPercent", e.target.value)} />
											</SettingRow>
											<SettingRow id="settings-inactivity" label="Slow-moving stock" description="Flag ingredients that have not been used for this many days.">
												<UnitInput id="settings-inactivity" unit="days" min="1" max="365" value={settings.inactivityAlertDays ?? 30} onChange={(e) => setRuleField("inactivityAlertDays", e.target.value)} />
											</SettingRow>
											<SettingRow id="settings-adjustment" label="Largest stock adjustment" description="Blocks stock edits that change an amount by more than this, to catch typing mistakes.">
												<UnitInput id="settings-adjustment" unit="%" min="25" max="1000" value={settings.maxInventoryAdjustmentPct ?? 200} onChange={(e) => setRuleField("maxInventoryAdjustmentPct", e.target.value)} />
											</SettingRow>
										</div>

										<div className="st-group">
											<h3>Records &amp; exports</h3>
											<SettingRow id="settings-retention" label="Keep deleted items for" description="Deleted items stay in Archive / Trash this long before they are removed for good.">
												<UnitInput id="settings-retention" unit="days" min="1" max="365" value={settings.archiveRetentionDays ?? 30} onChange={(e) => setRuleField("archiveRetentionDays", e.target.value)} />
											</SettingRow>
											<SettingRow id="settings-export-limit" label="Most rows in a CSV download" description="Between 100 and 25,000 rows.">
												<UnitInput id="settings-export-limit" unit="rows" min="100" max="25000" step="100" value={settings.exportRowLimit ?? 5000} onChange={(e) => setRuleField("exportRowLimit", e.target.value)} />
											</SettingRow>
										</div>
									</section>

									{/* ---------- Cashier team ---------- */}
									<section id="settings-team" className="st-section" aria-labelledby="st-team-title">
										<header className="st-section-head">
											<div>
												<h2 id="st-team-title">Cashier team</h2>
												<p>Every cashier signs in with the username <strong>staff</strong> and their own password.</p>
											</div>
											<button type="button" className="settings-secondary-button settings-add-cashier-btn" onClick={() => { setCashierFeedback(null); setCashierModalError(""); setShowAddCashier(true); }}>
												+ Add cashier
											</button>
										</header>

										<div className="st-group">
											{cashierFeedback && (
												<p className={`settings-password-feedback is-${cashierFeedback.type}`} role={cashierFeedback.type === "error" ? "alert" : "status"}>
													{cashierFeedback.message}
												</p>
											)}

											{cashiersLoading ? (
												<p className="st-empty">Loading cashier team…</p>
											) : cashiers.length === 0 ? (
												<p className="st-empty">No cashiers yet. Choose &ldquo;+ Add cashier&rdquo; to create one.</p>
											) : (
												cashiers.map((c) => (
													<div key={c.id} className="st-row st-cashier">
														<div className="st-row-text">
															<strong>{c.displayName} <span className={`st-pill ${c.isActive ? "is-ok" : "is-off"}`}>{c.isActive ? "Active" : "Inactive"}</span></strong>
															<p>Sales and shifts are recorded under this name in reports.</p>
														</div>
														<div className="st-row-control st-actions">
															<button type="button" className="settings-secondary-button" onClick={() => { setCashierFeedback(null); setCashierModalError(""); setRenameTarget(c); setRenameDisplayName(c.displayName || ""); }}>
																Rename
															</button>
															<button type="button" className="settings-secondary-button" onClick={() => { setCashierFeedback(null); setCashierModalError(""); setCashierTarget(c); setTargetPassword(""); }}>
																Change password
															</button>
															<button type="button" className={`settings-secondary-button ${c.isActive ? "is-danger" : "is-ok"}`} onClick={() => handleToggleCashier(c.id)}>
																{c.isActive ? "Disable" : "Enable"}
															</button>
														</div>
													</div>
												))
											)}
										</div>
									</section>

									{/* ---------- Alerts ---------- */}
									<section id="settings-alerts" className="st-section" aria-labelledby="st-alerts-title">
										<header className="st-section-head">
											<div>
												<h2 id="st-alerts-title">Alerts</h2>
												<p>Choose which updates show in the notification bell.</p>
											</div>
											<span className="settings-local-badge">Saved to your account</span>
										</header>
										<div className="st-group">
											<SettingToggle label="Admin notifications" description="Receive updates from across the portal." enabled={notifications} onToggle={() => setRuleField("notifyAllEnabled", !notifications)} />
											<SettingToggle label="Staff order alerts" description="Show new orders, completed orders and printed receipts from staff. Turn off to keep only stock and other system alerts." enabled={orderAlerts} onToggle={() => setRuleField("notifyOrderAlerts", !orderAlerts)} />
											<SettingToggle label="Stock alerts" description="Show an alert when an ingredient is out, low or above its maximum." enabled={inventoryAlerts} onToggle={() => setRuleField("notifyInventoryAlerts", !inventoryAlerts)} />
										</div>
									</section>

									{/* ---------- Security ---------- */}
									<section id="settings-security" className="st-section" aria-labelledby="st-security-title">
										<header className="st-section-head">
											<div>
												<h2 id="st-security-title">Security</h2>
												<p>Protect your administrator account and idle terminals.</p>
											</div>
										</header>
										<div className="st-group">
											<SettingRow id="settings-password" label="Password" description="Change the password for your administrator account.">
												<button id="settings-password" type="button" className="settings-secondary-button" onClick={() => { setPasswordFeedback(null); setShowPasswordForm(true); }}>Change password</button>
											</SettingRow>
											<SettingRow id="settings-idle-lock" label="Sign out idle screens" description="Sign out automatically when a terminal is left idle.">
												<select id="settings-idle-lock" className="st-select" value={settings.idleLockMinutes ?? 15} onChange={(e) => setRuleField("idleLockMinutes", Number(e.target.value))}>
													<option value={0}>Never</option>
													<option value={5}>After 5 minutes</option>
													<option value={10}>After 10 minutes</option>
													<option value={15}>After 15 minutes</option>
													<option value={30}>After 30 minutes</option>
													<option value={60}>After 1 hour</option>
													<option value={120}>After 2 hours</option>
												</select>
											</SettingRow>
										</div>
									</section>

									{saveError && <p className="settings-save-error" role="alert">{saveError}</p>}
									{passwordFeedback && <p className={`settings-password-feedback is-${passwordFeedback.type}`} role={passwordFeedback.type === "error" ? "alert" : "status"}>{passwordFeedback.message}</p>}

									<div className="st-savebar">
										<span>{hasUnsaved ? "You have unsaved changes. Save them before leaving this page." : lastSaved ? `Last saved ${formatManilaTime(lastSaved)}. Alert choices save on this device as you change them.` : "Store, checkout and stock settings are saved when you choose Save changes."}</span>
										<button type="submit" className={`admin-settings-save-button is-${saveState}`} disabled={!settingsLoaded || Boolean(settingsError) || saveState === "saving"} title={!settingsLoaded || settingsError ? "Load settings first before saving changes" : undefined} aria-live="polite">{saveState === "saving" ? <><span className="save-spinner" aria-hidden="true"></span>Saving changes</> : saveState === "success" ? <><span className="save-check" aria-hidden="true">✓</span>Changes saved</> : saveState === "error" ? <>Retry save <span aria-hidden="true">↻</span></> : <>Save changes</>}</button>
									</div>
								</form>
							</div>
						</div>
					</div>
			</main>
			{leavePrompt && (
				<div className="admin-settings-modal-backdrop" role="presentation">
					<div className="admin-settings-password-modal" role="alertdialog" aria-modal="true" aria-labelledby="leave-dialog-title" aria-describedby="leave-dialog-text">
						<div className="admin-settings-card-header">
							<div className="admin-settings-card-icon">!</div>
							<div><h3 id="leave-dialog-title">You have unsaved changes</h3><p id="leave-dialog-text">You changed some settings but have not saved them. Save now, or leave and lose the changes.</p></div>
						</div>
						<div className="admin-settings-password-actions">
							<button type="button" autoFocus onClick={() => setLeavePrompt(null)}>Keep editing</button>
							<button type="button" className="is-danger" onClick={handleLeaveWithoutSaving} disabled={saveState === "saving"}>Leave without saving</button>
							<button type="button" className="is-primary" onClick={handleSaveAndLeave} disabled={saveState === "saving" || !settingsLoaded || Boolean(settingsError)}>{saveState === "saving" ? "Saving…" : "Save and leave"}</button>
						</div>
					</div>
				</div>
			)}
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

function SettingRow({ id, label, description, children }) {
	return (
		<div className="st-row">
			<div className="st-row-text">
				<label htmlFor={id}>{label}</label>
				{description && <p>{description}</p>}
			</div>
			<div className="st-row-control">{children}</div>
		</div>
	);
}

function UnitInput({ unit, ...inputProps }) {
	return (
		<span className="st-unit">
			<input type="number" {...inputProps} />
			{unit && <i>{unit}</i>}
		</span>
	);
}

function SettingToggle({ label, description, enabled, onToggle }) {
	const labelId = `setting-toggle-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
	const descId = `${labelId}-desc`;
	return (
		<div className="st-row">
			<div className="st-row-text">
				<strong id={labelId}>{label}</strong>
				<p id={descId}>{description}</p>
			</div>
			<div className="st-row-control">
				<button type="button" role="switch" aria-checked={Boolean(enabled)} aria-labelledby={labelId} aria-describedby={descId} className={`admin-settings-toggle ${enabled ? "is-active" : ""}`} onClick={onToggle}><span aria-hidden="true"></span></button>
			</div>
		</div>
	);
}

export default AdminSettings;
