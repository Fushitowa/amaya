import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Lock, LockOpen, AlertCircle } from "lucide-react";
import { apiRequest } from "../../../utils/api.js";
import { monthLabel } from "../../../config/financeLabels.js";
import FinDialog from "./FinDialog.jsx";

/**
 * "Close the Month": locks a finished month so nothing can be added or changed inside it.
 * Closing and reopening need the Net Income PIN, because they change what every report shows.
 */
export default function MonthClosePanel({ isOpen, onClose, financialHeaders, unlocked, onRequestPin, onChanged }) {
  const [periods, setPeriods] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(null); // { month, action: "close" | "reopen" }
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { kind: "ok" | "error", text }

  const load = useCallback(async () => {
    try {
      const res = await apiRequest("/finances/periods");
      setPeriods(res?.months || []);
      setLoadError("");
    } catch (error) {
      setLoadError(error?.message || "We could not load the months. Please try again.");
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const timer = window.setTimeout(() => {
      setPending(null);
      setText("");
      setMessage(null);
      load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen, load]);

  const submit = async (event) => {
    event.preventDefault();
    if (!pending || busy) return;
    if (pending.action === "reopen" && text.trim().length < 3) {
      setMessage({ kind: "error", text: "Please say why you are reopening this month (at least 3 characters)." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const path = `/finances/periods/${pending.month}/${pending.action}`;
      const body = pending.action === "close" ? { note: text.trim() } : { reason: text.trim() };
      await apiRequest(path, { method: "POST", headers: financialHeaders, body: JSON.stringify(body) });
      setMessage({ kind: "ok", text: pending.action === "close" ? `${monthLabel(pending.month)} is closed.` : `${monthLabel(pending.month)} is open again.` });
      setPending(null);
      setText("");
      await load();
      onChanged?.();
    } catch (error) {
      setMessage({ kind: "error", text: error?.message || "That did not work. Please try again." });
    } finally {
      setBusy(false);
    }
  };

  const start = (month, action) => {
    if (!unlocked) {
      onRequestPin?.();
      return;
    }
    setPending({ month, action });
    setText("");
    setMessage(null);
  };

  return (
    <FinDialog isOpen={isOpen} onClose={onClose} busy={busy} titleId="fin-month-close-title" maxWidth="620px" title="Close the Month">
      <div className="fin-modal-body" style={{ padding: "1.1rem 1.4rem 1.4rem" }}>
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "#4a2c11" }}>
          Closing a finished month locks it. Nothing can be added or changed inside it, so the reports you gave someone for that month never change.
          If you find a mistake later, fix it in the current month, or reopen the month with a reason.
        </p>

        {!unlocked && (
          <div className="fin-callout" role="note">
            Closing or reopening a month needs your Net Income PIN.{" "}
            <button type="button" className="fin-inline-cta" onClick={onRequestPin}>
              <Lock size={13} aria-hidden="true" /> Enter PIN
            </button>
          </div>
        )}

        {message && (
          <div className={`fin-banner ${message.kind === "ok" ? "is-success" : "is-error"}`} role={message.kind === "ok" ? "status" : "alert"}>
            <span>{message.text}</span>
          </div>
        )}
        {loadError && <div className="fin-form-error" role="alert">{loadError}</div>}
        {!periods && !loadError && <div className="fin-loading-state">Loading months…</div>}

        {periods && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.45rem" }}>
            {periods.map((period) => {
              const isPending = pending?.month === period.month;
              return (
                <li key={period.month} className="fin-statement-card" style={{ padding: "0.6rem 0.8rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
                    <strong>{monthLabel(period.month)}</strong>
                    {period.status === "current" && <span style={{ fontSize: "0.8rem", color: "#6b5847" }}>This month, still running</span>}
                    {period.status === "closed" && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem", color: "#1e7047" }}>
                        <Lock size={13} aria-hidden="true" /> Closed{period.closedBy ? ` by ${period.closedBy}` : ""}
                      </span>
                    )}
                    {period.status === "open" && period.checklist?.canClose && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem", color: "#1e7047" }}>
                        <CheckCircle2 size={13} aria-hidden="true" /> Ready to close
                      </span>
                    )}
                    {period.status === "open" && period.checklist && !period.checklist.canClose && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem", color: "#92400e" }}>
                        <AlertCircle size={13} aria-hidden="true" /> Not ready
                      </span>
                    )}
                    {period.status === "closed" && (
                      <button type="button" className="fin-inline-cta" disabled={busy} onClick={() => start(period.month, "reopen")}>
                        <LockOpen size={13} aria-hidden="true" /> Reopen
                      </button>
                    )}
                    {period.status === "open" && (
                      <button type="button" className="fin-inline-cta" disabled={busy || !period.checklist?.canClose} onClick={() => start(period.month, "close")}>
                        <Lock size={13} aria-hidden="true" /> Close Month
                      </button>
                    )}
                  </div>
                  {period.status === "closed" && period.closeNote && (
                    <small style={{ color: "#6b5847" }}>Note: {period.closeNote}</small>
                  )}
                  {period.status === "open" && period.checklist?.problems?.length > 0 && (
                    <ul style={{ margin: "0.35rem 0 0 1rem", padding: 0, fontSize: "0.8rem", color: "#92400e" }}>
                      {period.checklist.problems.map((problem) => <li key={problem}>{problem}</li>)}
                    </ul>
                  )}
                  {isPending && (
                    <form onSubmit={submit} style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                      <label htmlFor="fin-month-note" style={{ fontSize: "0.82rem", fontWeight: 600, color: "#4a2c11" }}>
                        {pending.action === "close" ? "Note (optional)" : "Why are you reopening it? (at least 3 characters) *"}
                      </label>
                      <input
                        id="fin-month-note"
                        className="fin-form-input"
                        maxLength={255}
                        autoFocus
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder={pending.action === "close" ? "For example: checked with receipts" : "For example: found a missing receipt"}
                      />
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <button type="button" className="fin-modal-btn-secondary" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
                        <button type="submit" className="fin-modal-btn-primary" disabled={busy} aria-busy={busy}>
                          {busy ? "Saving…" : pending.action === "close" ? `Close ${monthLabel(period.month)}` : `Reopen ${monthLabel(period.month)}`}
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </FinDialog>
  );
}
