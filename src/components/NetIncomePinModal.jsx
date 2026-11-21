import { useState } from "react";
import { LockKeyhole, X } from "lucide-react";
import { apiRequest } from "../utils/api.js";
import "../assets/css/admin/NetIncomePin.css";

// `purpose` names what the PIN unlocks on this screen (e.g. "Pay Rates"); defaults to Net Income.
export default function NetIncomePinModal({ open, hasPin, onClose, onUnlocked, purpose = "Net Income" }) {
  const [mode, setMode] = useState("access");
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const setting = !hasPin || mode === "change";

  const closeModal = () => {
    setMode("access");
    setCurrentPin("");
    setPin("");
    setConfirmPin("");
    setError("");
    onClose();
  };

  if (!open) return null;

  const digitsOnly = (setter) => (event) => setter(event.target.value.replace(/\D/g, "").slice(0, 6));
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (setting) {
        if (!/^\d{6}$/.test(pin)) throw new Error("Choose a 6-digit PIN.");
        if (pin !== confirmPin) throw new Error("The PIN entries do not match.");
        const result = await apiRequest("/finances/net-income-pin/set", {
          method: "POST",
          body: JSON.stringify({ pin, ...(hasPin ? { currentPin } : {}) }),
        });
        onUnlocked(result.accessToken);
      } else {
        if (!/^\d{4,6}$/.test(pin)) throw new Error("Enter your 4 to 6 digit PIN.");
        const result = await apiRequest("/finances/net-income-pin/verify", {
          method: "POST",
          body: JSON.stringify({ pin }),
        });
        onUnlocked(result.accessToken);
      }
      closeModal();
    } catch (err) {
      setError(err?.message || "Could not verify the Numeric PIN.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fin-modal-overlay net-income-pin-overlay" role="dialog" aria-modal="true" aria-labelledby="net-income-pin-title">
      <div className="fin-modal-box net-income-pin-dialog">
        <div className="fin-modal-header">
          <h3 id="net-income-pin-title"><LockKeyhole size={17} /> {setting ? (hasPin ? "Change Owner Numeric PIN" : "Set Owner Numeric PIN") : `Enter Owner Numeric PIN to View ${purpose}`}</h3>
          <button type="button" className="fin-modal-close-btn" onClick={closeModal} aria-label="Close"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="net-income-pin-form">
          <p>This is a separate 6-digit PIN. It must differ from your Admin login password.</p>
          {setting && hasPin && (
            <label>Current PIN<input autoFocus type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={currentPin} onChange={digitsOnly(setCurrentPin)} /></label>
          )}
          <label>{setting ? "New PIN (6 numbers)" : "Owner Numeric PIN"}<input autoFocus={mode === "access"} type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={6} value={pin} onChange={digitsOnly(setPin)} /></label>
          {setting && <label>Confirm new PIN<input type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={6} value={confirmPin} onChange={digitsOnly(setConfirmPin)} /></label>}
          {error && <div className="net-income-pin-error" role="alert">{error}</div>}
          <div className="net-income-pin-actions">
            {hasPin && mode === "access" && <button type="button" className="fin-inline-cta" onClick={() => { setMode("change"); setPin(""); setError(""); }}>Change PIN</button>}
            {mode === "change" && <button type="button" className="fin-inline-cta" onClick={() => { setMode("access"); setCurrentPin(""); setPin(""); setConfirmPin(""); setError(""); }}>Back</button>}
            <button type="button" className="fin-action-btn" onClick={closeModal}>Cancel</button>
            <button type="submit" className="fin-action-btn fin-action-primary" disabled={busy}>{busy ? "Please wait…" : setting ? "Save PIN & View" : `Unlock ${purpose}`}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
