import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Clock, DollarSign, ShieldCheck, X } from "lucide-react";

import { useAuth } from "../context/AuthContext.jsx";
import { apiRequest } from "../utils/api.js";
import { formatDateTime, peso } from "../utils/staffActivityFormatters.js";
import { usePrefersReducedMotion } from "../utils/usePrefersReducedMotion.js";

import "../assets/css/staff/staff-operations.css";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function getDefaultTerminalLabel() {
  try {
    const prefs = JSON.parse(localStorage.getItem("amaya-staff-preferences") || "{}");
    return String(prefs.stationName || "Counter 1").trim() || "Counter 1";
  } catch {
    return "Counter 1";
  }
}

function StaffOperationsBar({ variant = "compact", darkMode = false }) {
  const { user, switchCashier } = useAuth() || {};
  const prefersReducedMotion = usePrefersReducedMotion();

  const [session, setSession] = useState(null);
  const [modalMode, setModalMode] = useState(null); // null | "open-shift" | "close-shift" | "switch-cashier"
  const [isClosing, setIsClosing] = useState(false);

  const [openingFloat, setOpeningFloat] = useState("1000");
  const [terminalLabel, setTerminalLabel] = useState(getDefaultTerminalLabel);
  const [countedCash, setCountedCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [closedReceipt, setClosedReceipt] = useState(null);
  const [switchPassword, setSwitchPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const closeTimerRef = useRef(null);

  const userId = user?.id;

  const refreshCurrentSession = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await apiRequest("/sessions/current");
      setSession(res?.session || null);
    } catch {
      // keep existing state cleanly
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    const sync = () => {
      apiRequest("/sessions/current")
        .then((res) => {
          if (active) setSession(res?.session || null);
        })
        .catch(() => {});
    };
    sync();
    window.addEventListener("amaya:session-changed", sync);
    window.addEventListener("amaya:stock-mutated", sync);
    return () => {
      active = false;
      window.removeEventListener("amaya:session-changed", sync);
      window.removeEventListener("amaya:stock-mutated", sync);
    };
  }, [userId]);

  useEffect(() => () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  const finishClose = useCallback(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setModalMode(null);
    setIsClosing(false);
    setClosedReceipt(null);
    setError("");
    const el = triggerRef.current;
    if (el && typeof el.focus === "function") {
      window.requestAnimationFrame(() => el.focus({ preventScroll: true }));
    }
  }, []);

  const requestClose = useCallback(() => {
    if (!modalMode || isClosing || busy) return;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(
      finishClose,
      prefersReducedMotion ? 125 : 155,
    );
  }, [busy, finishClose, isClosing, modalMode, prefersReducedMotion]);

  const openModal = (mode, event) => {
    triggerRef.current = event?.currentTarget || null;
    setError("");
    setClosedReceipt(null);
    if (mode === "open-shift") {
      setOpeningFloat("1000");
      setTerminalLabel(getDefaultTerminalLabel());
    } else if (mode === "close-shift") {
      setCountedCash(session?.expectedCash != null ? String(session.expectedCash) : "");
      setClosingNotes("");
    } else if (mode === "switch-cashier") {
      setSwitchPassword("");
    }
    setIsClosing(false);
    setModalMode(mode);
    window.requestAnimationFrame(() => {
      dialogRef.current?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    if (!modalMode) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusables = [...dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)]
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modalMode, requestClose]);

  const handleOpenShift = async (e) => {
    e.preventDefault();
    if (busy) return;
    const parsedFloat = Number(openingFloat || 0);
    if (!Number.isFinite(parsedFloat) || parsedFloat < 0) {
      setError("Opening float must be zero or greater.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await apiRequest("/sessions/open", {
        method: "POST",
        body: JSON.stringify({
          openingFloat: parsedFloat,
          terminalLabel: terminalLabel.trim() || "Counter 1",
        }),
      });
      setSession(res?.session || null);
      setNotice(`Shift opened (${res?.session?.terminalLabel || "Counter"}).`);
      window.dispatchEvent(new CustomEvent("amaya:session-changed"));
      requestClose();
    } catch (err) {
      setError(err?.message || "Could not open register shift.");
    } finally {
      setBusy(false);
    }
  };

  const handleCloseShift = async (e) => {
    e.preventDefault();
    if (busy || !session?.id) return;
    if (String(countedCash).trim() === "") {
      setError("Enter the counted cash amount inside the drawer.");
      return;
    }
    const parsedCounted = Number(countedCash);
    if (!Number.isFinite(parsedCounted) || parsedCounted < 0) {
      setError("Counted cash must be zero or greater.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await apiRequest(`/sessions/${session.id}/close`, {
        method: "POST",
        body: JSON.stringify({
          countedCash: parsedCounted,
          closingNotes: closingNotes.trim() || undefined,
        }),
      });
      setSession(null);
      setClosedReceipt(res?.session || null);
      setNotice("Register shift closed and counted.");
      window.dispatchEvent(new CustomEvent("amaya:session-changed"));
    } catch (err) {
      setError(err?.message || "Could not close register shift.");
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchCashier = async (e) => {
    e.preventDefault();
    if (busy || !switchCashier) return;
    if (!switchPassword.trim()) {
      setError("Enter the incoming cashier's password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await switchCashier(switchPassword);
      setSwitchPassword("");
      setNotice(`Active cashier switched to ${res?.user?.displayName || "Cashier"}.`);
      await refreshCurrentSession();
      requestClose();
    } catch (err) {
      setError(err?.message || "Invalid cashier password.");
    } finally {
      setBusy(false);
    }
  };

  const expectedLive = Number(session?.expectedCash ?? 0);
  const previewCounted = Number(countedCash);
  const hasPreviewCounted = String(countedCash).trim() !== "" && Number.isFinite(previewCounted);
  const previewVariance = hasPreviewCounted ? Number((previewCounted - expectedLive).toFixed(2)) : null;

  const displayName = user?.displayName || "Cashier";

  return (
    <>
      {variant === "panel" ? (
        <section className="sop-panel-card" aria-label="Register shift and cashier operations">
          <div className="sop-panel-head">
            <div>
              <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 800 }}>
                Active Cashier &amp; Register Shift
              </h3>
              <p style={{ margin: "3px 0 0", fontSize: "0.78rem", color: "#7b6659" }}>
                Signed in as <strong>{displayName}</strong> ·{" "}
                {session
                  ? `Shift #${session.id} (${session.terminalLabel}) opened ${formatDateTime(session.openedAt)}`
                  : "No open register shift right now"}
              </p>
            </div>

            <span className={`sop-chip-btn ${session ? "is-open" : "is-closed"}`} style={{ cursor: "default" }}>
              <span className="sop-dot" aria-hidden="true" />
              {session ? `Shift Open · #${session.id}` : "Shift Closed"}
            </span>
          </div>

          {notice && (
            <div style={{ padding: "8px 12px", borderRadius: "9px", background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", fontSize: "0.79rem", fontWeight: 600 }} role="status">
              {notice}
            </div>
          )}

          {session && (
            <div className="sop-panel-grid">
              <div className="sop-panel-metric">
                <span>Opening Float</span>
                <strong>{peso(session.openingFloat)}</strong>
              </div>
              <div className="sop-panel-metric">
                <span>Cash Sales</span>
                <strong>{peso(session.cashSales)}</strong>
              </div>
              <div className="sop-panel-metric">
                <span>Expected Drawer</span>
                <strong>{peso(session.expectedCash)}</strong>
              </div>
              <div className="sop-panel-metric">
                <span>Shift Orders</span>
                <strong>{session.ordersCount} ({peso(session.paidSales)})</strong>
              </div>
            </div>
          )}

          <div className="sop-panel-actions">
            {session ? (
              <button
                type="button"
                className="sop-chip-btn is-open"
                onClick={(e) => openModal("close-shift", e)}
              >
                <DollarSign size={14} strokeWidth={2.2} aria-hidden="true" />
                Close Shift &amp; Count Drawer
              </button>
            ) : (
              <button
                type="button"
                className="sop-chip-btn is-closed"
                onClick={(e) => openModal("open-shift", e)}
              >
                <Clock size={14} strokeWidth={2.2} aria-hidden="true" />
                Open Register Shift
              </button>
            )}

            <button
              type="button"
              className="sop-chip-btn"
              onClick={(e) => openModal("switch-cashier", e)}
            >
              <ArrowLeftRight size={14} strokeWidth={2.2} aria-hidden="true" />
              Switch Cashier ({displayName})
            </button>
          </div>
        </section>
      ) : (
        <div className="sop-compact">
          <button
            type="button"
            className={`sop-chip-btn ${session ? "is-open" : "is-closed"}`}
            onClick={(e) => openModal(session ? "close-shift" : "open-shift", e)}
            title={session ? `Shift #${session.id} (${session.terminalLabel}) open — click to close & count` : "Open cashier shift drawer"}
          >
            <span className="sop-dot" aria-hidden="true" />
            {session ? `Shift #${session.id}` : "Open Shift"}
          </button>

          <button
            type="button"
            className="sop-chip-btn"
            onClick={(e) => openModal("switch-cashier", e)}
            title="Switch active cashier account on this register"
          >
            <ArrowLeftRight size={14} strokeWidth={2.2} aria-hidden="true" />
            <span>{displayName}</span>
          </button>
        </div>
      )}

      {modalMode && (
        <div
          className={`sop-backdrop ${darkMode ? "dark-mode" : ""} ${isClosing ? "is-closing" : ""}`}
          onClick={requestClose}
          role="presentation"
        >
          <div
            ref={dialogRef}
            className="sop-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sop-dialog-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sop-dialog-head">
              <h3 id="sop-dialog-title">
                {modalMode === "open-shift" && "Open Register Shift"}
                {modalMode === "close-shift" && (closedReceipt ? "Shift Closed Summary" : "Close Shift & Drawer Count")}
                {modalMode === "switch-cashier" && "Switch Active Cashier"}
              </h3>
              <button
                type="button"
                className="sop-chip-btn"
                style={{ width: "34px", minHeight: "34px", padding: 0, justifyContent: "center" }}
                onClick={requestClose}
                aria-label="Close dialog"
                disabled={busy}
              >
                <X size={16} strokeWidth={2.3} aria-hidden="true" />
              </button>
            </header>

            <div className="sop-dialog-body">
              {error && (
                <div style={{ padding: "10px 12px", borderRadius: "10px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: "0.82rem", fontWeight: 600 }} role="alert">
                  {error}
                </div>
              )}

              {modalMode === "open-shift" && (
                <form onSubmit={handleOpenShift} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <p style={{ margin: 0, fontSize: "0.82rem", color: "#7b6659" }}>
                    Starting a new shift for <strong>{displayName}</strong> tracks cash drawer expected totals and links orders to this shift.
                  </p>
                  <label className="sop-field">
                    <span>Terminal / Register Label</span>
                    <input
                      type="text"
                      className="sop-input"
                      value={terminalLabel}
                      maxLength={80}
                      onChange={(e) => setTerminalLabel(e.target.value)}
                      required
                    />
                  </label>
                  <label className="sop-field">
                    <span>Opening Drawer Float (₱)</span>
                    <input
                      type="number"
                      className="sop-input"
                      min="0"
                      step="0.01"
                      value={openingFloat}
                      onChange={(e) => setOpeningFloat(e.target.value)}
                      required
                    />
                  </label>
                  <div className="sop-dialog-footer">
                    <button type="button" className="sop-btn" onClick={requestClose} disabled={busy}>
                      Cancel
                    </button>
                    <button type="submit" className="sop-btn primary" disabled={busy}>
                      {busy ? "Opening..." : "Open Shift"}
                    </button>
                  </div>
                </form>
              )}

              {modalMode === "close-shift" && !closedReceipt && session && (
                <form onSubmit={handleCloseShift} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="sop-summary-box">
                    <div><span>Cashier</span><strong>{displayName}</strong></div>
                    <div><span>Terminal</span><strong>{session.terminalLabel}</strong></div>
                    <div><span>Opening Float</span><strong>{peso(session.openingFloat)}</strong></div>
                    <div><span>Cash Sales</span><strong>{peso(session.cashSales)}</strong></div>
                    <div><span>Total Paid Orders</span><strong>{session.ordersCount} ({peso(session.paidSales)})</strong></div>
                    <div><span>Expected Cash in Drawer</span><strong>{peso(expectedLive)}</strong></div>
                  </div>

                  <label className="sop-field">
                    <span>Counted Cash in Drawer (₱)</span>
                    <input
                      type="number"
                      className="sop-input"
                      min="0"
                      step="0.01"
                      value={countedCash}
                      onChange={(e) => setCountedCash(e.target.value)}
                      required
                    />
                  </label>

                  {previewVariance !== null && (
                    <div
                      style={{
                        padding: "9px 12px",
                        borderRadius: "10px",
                        fontSize: "0.82rem",
                        fontWeight: 700,
                        background: Math.abs(previewVariance) < 0.01 ? "#f0fdf4" : "#fffbeb",
                        border: Math.abs(previewVariance) < 0.01 ? "1px solid #bbf7d0" : "1px solid #fde68a",
                        color: Math.abs(previewVariance) < 0.01 ? "#166534" : "#92400e",
                      }}
                    >
                      {Math.abs(previewVariance) < 0.01
                        ? "Drawer preview: Balanced (₱0.00 variance)"
                        : `Drawer variance preview: ${previewVariance > 0 ? "+" : ""}${peso(previewVariance)} (${previewVariance > 0 ? "Over" : "Short"})`}
                    </div>
                  )}

                  <label className="sop-field">
                    <span>Closing Notes (Optional)</span>
                    <textarea
                      className="sop-textarea"
                      maxLength={500}
                      placeholder="Shift handoff notes or drawer remarks..."
                      value={closingNotes}
                      onChange={(e) => setClosingNotes(e.target.value)}
                    />
                  </label>

                  <div className="sop-dialog-footer">
                    <button type="button" className="sop-btn" onClick={requestClose} disabled={busy}>
                      Keep Shift Open
                    </button>
                    <button type="submit" className="sop-btn primary" disabled={busy}>
                      {busy ? "Closing..." : "Close Shift"}
                    </button>
                  </div>
                </form>
              )}

              {modalMode === "close-shift" && closedReceipt && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#166534", fontWeight: 700, fontSize: "0.9rem" }}>
                    <ShieldCheck size={18} aria-hidden="true" />
                    Shift #{closedReceipt.id} closed cleanly.
                  </div>
                  <div className="sop-summary-box">
                    <div><span>Expected Cash</span><strong>{peso(closedReceipt.expectedCash)}</strong></div>
                    <div><span>Counted Cash</span><strong>{peso(closedReceipt.countedCash)}</strong></div>
                    <div>
                      <span>Final Variance</span>
                      <strong>
                        {closedReceipt.variance > 0 ? "+" : ""}
                        {peso(closedReceipt.variance)}
                      </strong>
                    </div>
                    <div><span>Closed At</span><strong>{formatDateTime(closedReceipt.closedAt)}</strong></div>
                  </div>
                  <div className="sop-dialog-footer">
                    <button type="button" className="sop-btn primary" onClick={requestClose}>
                      Done
                    </button>
                  </div>
                </div>
              )}

              {modalMode === "switch-cashier" && (
                <form onSubmit={handleSwitchCashier} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <p style={{ margin: 0, fontSize: "0.82rem", color: "#7b6659" }}>
                    Currently signed in as <strong>{displayName}</strong>. Enter an active cashier&apos;s password to switch counter attribution immediately.
                  </p>
                  <label className="sop-field">
                    <span>Cashier Password</span>
                    <input
                      type="password"
                      className="sop-input"
                      placeholder="Enter cashier password..."
                      value={switchPassword}
                      onChange={(e) => setSwitchPassword(e.target.value)}
                      autoComplete="off"
                      required
                    />
                  </label>
                  <div className="sop-dialog-footer">
                    <button type="button" className="sop-btn" onClick={requestClose} disabled={busy}>
                      Cancel
                    </button>
                    <button type="submit" className="sop-btn primary" disabled={busy || !switchPassword.trim()}>
                      {busy ? "Switching..." : "Switch Cashier"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default StaffOperationsBar;
