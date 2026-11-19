import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CircleDollarSign, ClipboardList, Clock3, Menu, RefreshCw, Search, Trash2, UserRound } from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import LogWasteModal from "../../components/LogWasteModal.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useInventory } from "../../context/InventoryContext.jsx";
import { formatWasteQty, getWasteReasonMeta } from "../../utils/wasteMeasurement.js";
import { formatManilaDate } from "../../../shared/manilaDate.js";
import "../../assets/css/admin/AdminWasteTracker.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const WASTE_SCOPES = [
  { key: "today", label: "Today" },
  { key: "shift", label: "Active Shift" },
  { key: "all", label: "All History" },
];

function formatWasteDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function AdminWasteTracker() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const {
    wasteLogs = [],
    wasteSummary = {},
    wasteLogsLoading = false,
    wasteLogsError = "",
    fetchWasteLogs,
  } = useInventory() || {};
  const [scope, setScope] = useState("today");
  const [search, setSearch] = useState("");
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches,
  );
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const sync = () => setIsMobile(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const refreshLogs = useCallback(async () => {
    if (!fetchWasteLogs) return;
    try {
      await fetchWasteLogs({ scope, limit: 100, allPages: true });
    } catch (error) {
      console.warn("Could not refresh waste tracker:", error?.message || error);
    }
  }, [fetchWasteLogs, scope]);

  useEffect(() => {
    refreshLogs();
  }, [refreshLogs]);

  const activeWasteLogs = useMemo(
    () => wasteLogs.filter((entry) => !entry.isReversed),
    [wasteLogs],
  );
  const totalLoss = useMemo(
    () => activeWasteLogs.reduce((total, entry) => total + Number(entry.wasteValue || 0), 0),
    [activeWasteLogs],
  );
  const topWastedItems = useMemo(() => {
    const totals = new Map();
    activeWasteLogs.forEach((entry) => {
      const name = String(entry.itemName || "Unknown ingredient");
      const current = totals.get(name) || { name, quantity: 0, value: 0, events: 0, unit: entry.unit || "" };
      current.quantity += Number(entry.deductedQuantity || 0);
      current.value += Number(entry.wasteValue || 0);
      current.events += 1;
      totals.set(name, current);
    });
    return Array.from(totals.values())
      .sort((a, b) => b.events - a.events || b.value - a.value || a.name.localeCompare(b.name))
      .slice(0, 5);
  }, [activeWasteLogs]);
  const filteredLogs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return wasteLogs;
    return wasteLogs.filter((entry) => [
      entry.itemName,
      entry.actor,
      entry.note,
      getWasteReasonMeta(entry.wasteReason).label,
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [search, wasteLogs]);

  const handleWasteSuccess = () => {
    setSuccessMessage("Waste recorded. The tracker now reflects the inventory deduction.");
    refreshLogs();
  };

  const currentDate = formatManilaDate(new Date(), {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className={`admin-waste-tracker-page${sidebarCollapsed ? " sidebar-collapsed" : ""}${isMobile ? " is-mobile" : ""}${mobileNavOpen ? " mobile-nav-open" : ""}`}>
      {mobileNavOpen && <button type="button" className="awt-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <Sidebar
        role="admin"
        activeTab="wasteTracker"
        sidebarCollapsed={sidebarCollapsed}
        onToggle={() => (isMobile ? setMobileNavOpen(false) : toggleSidebar())}
      />

      <main className="awt-main">
        <header className="awt-page-header">
          <button type="button" className="awt-mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
            <Menu size={22} aria-hidden="true" />
          </button>
          <div className="awt-heading-copy">
            <span className="awt-eyebrow"><ClipboardList size={14} aria-hidden="true" /> INVENTORY RECORDS</span>
            <h1>Waste &amp; Spoilage Tracker</h1>
            <p>Review ingredient waste, recorded costs, and recurring stock losses.</p>
            <span className="awt-date"><CalendarDays size={15} aria-hidden="true" /> {currentDate}</span>
          </div>
          <div className="awt-header-actions">
            <button type="button" className="awt-button awt-button-secondary" onClick={refreshLogs} disabled={wasteLogsLoading}>
              <RefreshCw size={16} aria-hidden="true" className={wasteLogsLoading ? "is-spinning" : ""} />
              Refresh
            </button>
            <button type="button" className="awt-button awt-button-primary" onClick={() => setShowWasteModal(true)}>
              <Trash2 size={16} aria-hidden="true" />
              Log Waste / Spoilage
            </button>
          </div>
        </header>

        {successMessage && <div className="awt-feedback" role="status">{successMessage}</div>}
        {wasteLogsError && <div className="awt-error" role="alert">{wasteLogsError}</div>}

        <section className="awt-kpis" aria-label="Waste overview">
          <article className="awt-kpi-card">
            <span><ClipboardList size={16} aria-hidden="true" /> Recorded events</span>
            <strong>{Number(wasteSummary.total ?? wasteLogs.length).toLocaleString()}</strong>
            <small>{WASTE_SCOPES.find((entry) => entry.key === scope)?.label} records</small>
          </article>
          <article className="awt-kpi-card is-loss">
            <span><CircleDollarSign size={16} aria-hidden="true" /> Cost of waste</span>
            <strong>₱{totalLoss.toFixed(2)}</strong>
            <small>Calculated from the recorded ingredient cost</small>
          </article>
          <article className="awt-kpi-card">
            <span><Clock3 size={16} aria-hidden="true" /> Most frequent waste</span>
            <strong>{topWastedItems[0]?.name || "None recorded"}</strong>
            <small>{topWastedItems[0] ? `${topWastedItems[0].events} recorded event${topWastedItems[0].events === 1 ? "" : "s"}` : "No unreversed waste in this range"}</small>
          </article>
        </section>

        {topWastedItems.length > 0 && (
          <section className="awt-top-items" aria-label="Frequently wasted ingredients">
            <div className="awt-section-heading">
              <div>
                <h2>Frequently Wasted Ingredients</h2>
                <p>Ranked by number of waste events in the selected range.</p>
              </div>
            </div>
            <div className="awt-top-list">
              {topWastedItems.map((item, index) => (
                <article className="awt-top-item" key={item.name}>
                  <span className="awt-top-rank">{String(index + 1).padStart(2, "0")}</span>
                  <div className="awt-top-item-copy">
                    <strong>{item.name}</strong>
                    <small>{item.events} event{item.events === 1 ? "" : "s"} · {formatWasteQty(item.quantity, item.unit)}</small>
                  </div>
                  <span className="awt-top-item-cost">₱{item.value.toFixed(2)}</span>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="awt-log-panel" aria-label="Waste and spoilage records">
          <div className="awt-log-header">
            <div className="awt-section-heading">
              <div>
                <h2>Waste Records</h2>
                <p>Quantity deductions, reason, cost, and staff audit trail.</p>
              </div>
            </div>
            <div className="awt-log-controls">
              <div className="awt-scope-tabs" role="group" aria-label="Waste record date range">
                {WASTE_SCOPES.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={scope === entry.key ? "is-active" : ""}
                    aria-pressed={scope === entry.key}
                    onClick={() => setScope(entry.key)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <label className="awt-search">
                <Search size={16} aria-hidden="true" />
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search item, staff, reason..." aria-label="Search waste records" />
              </label>
            </div>
          </div>

          <div className="awt-table-scroll">
            <table className="awt-table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Quantity Wasted</th>
                  <th>Cost</th>
                  <th>Reason</th>
                  <th>Date &amp; Time</th>
                  <th>Recorded By</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((entry) => {
                  const reason = getWasteReasonMeta(entry.wasteReason);
                  return (
                    <tr key={entry.id} className={entry.isReversed ? "is-reversed" : ""}>
                      <td><strong>{entry.itemName || "Unknown ingredient"}</strong>{entry.isReversed && <small className="awt-reversed-tag">Reversed</small>}</td>
                      <td className="awt-quantity">-{formatWasteQty(entry.deductedQuantity, entry.unit)}</td>
                      <td className="awt-cost">₱{Number(entry.wasteValue || 0).toFixed(2)}</td>
                      <td><span className="awt-reason-pill">{reason.label}</span></td>
                      <td className="awt-date-cell">{formatWasteDateTime(entry.timestamp)}</td>
                      <td><span className="awt-recorded-by"><UserRound size={14} aria-hidden="true" /> {entry.actor || "Staff"}</span></td>
                      <td className="awt-note-cell">{entry.note || "—"}</td>
                    </tr>
                  );
                })}
                {!filteredLogs.length && (
                  <tr>
                    <td colSpan={7} className="awt-empty-cell">
                      <strong>{wasteLogsLoading ? "Loading waste records..." : search ? "No matching waste records" : "No waste records in this range"}</strong>
                      <span>{search ? "Try another ingredient, staff name, or reason." : "Waste logged from the Staff Dashboard will appear here automatically."}</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <footer className="awt-table-footer">
            <span>{filteredLogs.length} displayed record{filteredLogs.length === 1 ? "" : "s"}</span>
            <span>Amounts and costs use the values saved with each waste record.</span>
          </footer>
        </section>
      </main>

      <LogWasteModal
        isOpen={showWasteModal}
        onClose={() => setShowWasteModal(false)}
        onSuccess={handleWasteSuccess}
      />
    </div>
  );
}

export default AdminWasteTracker;
