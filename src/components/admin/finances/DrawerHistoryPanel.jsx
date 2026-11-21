import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Lock } from "lucide-react";
import { apiRequest } from "../../../utils/api.js";
import { peso } from "../../../utils/financeFormat.js";

/**
 * Cash drawer over/short by cashier and weekday, plus the limits that decide what is flagged.
 * Everything here is for review. Nothing is ever deducted from anyone's pay.
 */
export default function DrawerHistoryPanel({ thresholds, onThresholdsSaved, financialHeaders, unlocked, onRequestPin, fromDate, toDate }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const [okInput, setOkInput] = useState(String(thresholds.ok));
  const [reviewInput, setReviewInput] = useState(String(thresholds.review));
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);
    try {
      const res = await apiRequest(`/finances/reports/drawer-history${params.toString() ? `?${params}` : ""}`);
      setHistory(res);
      setError("");
    } catch (requestError) {
      setError(requestError?.message || "We could not load the drawer history.");
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load, thresholds]);

  const save = async (event) => {
    event.preventDefault();
    if (!unlocked) {
      onRequestPin?.();
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    try {
      const saved = await apiRequest("/finances/drawer-thresholds", {
        method: "PUT",
        headers: financialHeaders,
        body: JSON.stringify({ ok: okInput, review: reviewInput }),
      });
      onThresholdsSaved?.(saved);
      setSaveMessage({ kind: "ok", text: "Limits saved." });
    } catch (requestError) {
      setSaveMessage({ kind: "error", text: requestError?.message || "We could not save the limits." });
    } finally {
      setSaving(false);
    }
  };

  const items = history?.items || [];

  return (
    <details className="fin-estimator-details" style={{ marginTop: "0.9rem" }}>
      <summary>Cash drawer history by cashier &amp; weekday</summary>
      <div style={{ padding: "0.6rem 0.2rem 0.2rem", display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "#4a2c11" }}>
          Repeat differences on the same weekday can point to a habit or a busy hour, not just bad luck. This is for review only.
          Nothing here is ever taken out of anyone&apos;s pay.{" "}
          {history && <>Showing closed shifts{history.from ? ` from ${history.from}` : ""}{history.to ? ` to ${history.to}` : ""}.</>}
        </p>

        <form onSubmit={save} style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "flex-end" }} aria-label="Drawer limits">
          <label htmlFor="fin-drawer-ok" style={{ display: "flex", flexDirection: "column", gap: "0.15rem", fontSize: "0.78rem", color: "#4a2c11" }}>
            Normal up to (₱)
            <input id="fin-drawer-ok" type="number" min="0" step="0.01" inputMode="decimal" className="fin-form-input fin-input-tabular" style={{ width: "8rem" }}
              value={okInput} onChange={(e) => setOkInput(e.target.value)} />
          </label>
          <label htmlFor="fin-drawer-review" style={{ display: "flex", flexDirection: "column", gap: "0.15rem", fontSize: "0.78rem", color: "#4a2c11" }}>
            Check the same day above (₱)
            <input id="fin-drawer-review" type="number" min="0" step="0.01" inputMode="decimal" className="fin-form-input fin-input-tabular" style={{ width: "8rem" }}
              value={reviewInput} onChange={(e) => setReviewInput(e.target.value)} />
          </label>
          <button type="submit" className="fin-inline-cta" disabled={saving} aria-busy={saving}>
            {!unlocked && <Lock size={13} aria-hidden="true" />} {saving ? "Saving…" : unlocked ? "Save Limits" : "Enter PIN to Change"}
          </button>
          {saveMessage && (
            <span role={saveMessage.kind === "ok" ? "status" : "alert"} style={{ fontSize: "0.8rem", color: saveMessage.kind === "ok" ? "#1e7047" : "#c53030" }}>
              {saveMessage.text}
            </span>
          )}
        </form>

        {error && <div className="fin-form-error" role="alert">{error}</div>}
        {history && items.length === 0 && !error && (
          <div style={{ fontSize: "0.82rem", color: "#6b5847" }}>No closed shifts with a cash count in this period yet.</div>
        )}

        {items.length > 0 && (
          <div className="fin-table-wrap">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Cashier</th>
                  <th>Weekday</th>
                  <th>Shifts</th>
                  <th>Outside normal</th>
                  <th title="Over minus short">Net over/short</th>
                  <th>Average difference</th>
                  <th>Pattern?</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.userId}-${item.weekdayNumber}`}>
                    <td><strong>{item.cashierName}</strong></td>
                    <td>{item.weekday}</td>
                    <td>{item.shifts}</td>
                    <td>{item.flaggedShifts}</td>
                    <td style={{ color: item.netVariance === 0 ? "#5a4029" : item.netVariance < 0 ? "#c53030" : "#1e7047" }}>
                      {item.netVariance === 0 ? peso(0) : `${item.netVariance < 0 ? "-" : "+"}${peso(Math.abs(item.netVariance))} ${item.netVariance < 0 ? "short" : "over"}`}
                    </td>
                    <td>{peso(item.averageDifference)}</td>
                    <td>
                      {item.isPattern ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "#92400e", fontWeight: 600 }}>
                          <AlertCircle size={13} aria-hidden="true" /> Repeat problem
                        </span>
                      ) : (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", color: "#6b5847" }}>
                          <CheckCircle2 size={13} aria-hidden="true" /> No pattern
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
