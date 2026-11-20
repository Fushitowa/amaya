import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardList, Menu, RefreshCw, Search, Trash2, Undo2, X } from "lucide-react";
import Sidebar from "../../components/Sidebar.jsx";
import LogWasteModal from "../../components/LogWasteModal.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useInventory } from "../../context/InventoryContext.jsx";
import { WASTE_REASONS, formatWasteQty, getWasteReasonMeta } from "../../utils/wasteMeasurement.js";
import "../../assets/css/admin/MenuNotebook.css";
import "../../assets/css/admin/WasteNotebook.css";
import "../../assets/css/admin/AdminWasteTracker.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const WASTE_SCOPES = [
  { key: "today", label: "Today", when: "today", empty: "today" },
  { key: "shift", label: "This shift", when: "during this shift", empty: "during this shift" },
  { key: "all", label: "All time", when: "in total", empty: "yet" },
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
    wasteLogsLoading = false,
    wasteLogsError = "",
    fetchWasteLogs,
    reverseWasteLog,
  } = useInventory() || {};
  const [scope, setScope] = useState("today");
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches,
  );
  const [successMessage, setSuccessMessage] = useState("");
  const [undoTarget, setUndoTarget] = useState(null);
  const [undoReason, setUndoReason] = useState("");
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState("");

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
    const byReason = reasonFilter === "all"
      ? wasteLogs
      : wasteLogs.filter((entry) => entry.wasteReason === reasonFilter);
    if (!query) return byReason;
    return byReason.filter((entry) => [
      entry.itemName,
      entry.actor,
      entry.note,
      getWasteReasonMeta(entry.wasteReason).label,
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }, [search, reasonFilter, wasteLogs]);

  const reversedCount = wasteLogs.length - activeWasteLogs.length;
  const scopeMeta = WASTE_SCOPES.find((entry) => entry.key === scope) || WASTE_SCOPES[0];
  const isFiltering = Boolean(search.trim()) || reasonFilter !== "all";

  const handleWasteSuccess = () => {
    setSuccessMessage("Waste logged. The amount was taken out of stock.");
    refreshLogs();
  };

  const openUndo = (entry) => {
    setUndoTarget(entry.id);
    setUndoReason("");
    setUndoError("");
  };
  const closeUndo = () => {
    setUndoTarget(null);
    setUndoReason("");
    setUndoError("");
  };
  const submitUndo = async (event, entry) => {
    event.preventDefault();
    const reason = undoReason.trim();
    if (reason.length < 3) {
      setUndoError("Write a short reason (at least 3 characters).");
      return;
    }
    if (!reverseWasteLog) {
      setUndoError("Undo is not available right now. Refresh the page and try again.");
      return;
    }
    setUndoBusy(true);
    setUndoError("");
    try {
      await reverseWasteLog(entry.id, reason);
      setSuccessMessage(`Undone. ${formatWasteQty(entry.deductedQuantity, entry.unit)} of ${entry.itemName || "the ingredient"} went back into stock.`);
      closeUndo();
      await refreshLogs();
    } catch (error) {
      setUndoError(error?.message || "Could not undo this entry. Please try again.");
    } finally {
      setUndoBusy(false);
    }
  };

  const emptyTitle = wasteLogsError
    ? "Could not load the waste log"
    : wasteLogsLoading
      ? "Loading entries…"
      : isFiltering
        ? "No entries match"
        : scope === "all" ? "Nothing has been logged yet" : `Nothing logged ${scopeMeta.empty}`;
  const emptyHelp = wasteLogsError
    ? "Check your connection, then press Refresh."
    : isFiltering
      ? "Clear the search or pick another reason."
      : "Use Log waste when something is spilled, expires or gets spoiled. Staff entries show up here too.";
  const EmptyIcon = wasteLogsError ? AlertTriangle : wasteLogsLoading ? RefreshCw : ClipboardList;
  const topItem = topWastedItems[0];

  return (
    <div className={`admin-waste-tracker-page${sidebarCollapsed ? " sidebar-collapsed" : ""}${isMobile ? " is-mobile" : ""}${mobileNavOpen ? " mobile-nav-open" : ""}`}>
      {mobileNavOpen && <button type="button" className="awt-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />}
      <Sidebar
        role="admin"
        activeTab="wasteTracker"
        sidebarCollapsed={sidebarCollapsed}
        onToggle={() => (isMobile ? setMobileNavOpen(false) : toggleSidebar())}
      />

      <main className="awt-main nb-main">
        <div className="nb-desk">
          <section className="nb-notebook" aria-label="Waste and spoilage log">
            <div className="nb-spiral" aria-hidden="true" />

            <div className="nb-page">
              <header className="nb-head">
                <button type="button" className="nbw-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
                  <Menu size={20} aria-hidden="true" />
                </button>
                <span className="nb-crest" aria-hidden="true">
                  <Trash2 size={20} strokeWidth={2} />
                </span>
                <div className="nb-head-copy">
                  <h1>Waste and spoilage</h1>
                  <p>
                    Everything thrown away or spoiled, and what it cost you.
                    <span className="nb-live">
                      <span className="nb-live-dot" aria-hidden="true" />
                      {activeWasteLogs.length} {activeWasteLogs.length === 1 ? "entry" : "entries"} {scopeMeta.when}
                    </span>
                  </p>
                </div>
                <div className="nb-head-actions">
                  <button type="button" className="nb-btn" onClick={refreshLogs} disabled={wasteLogsLoading}>
                    <RefreshCw size={15} aria-hidden="true" className={wasteLogsLoading ? "is-spinning" : ""} />
                    Refresh
                  </button>
                  <button type="button" className="nb-btn nb-btn-primary" onClick={() => setShowWasteModal(true)}>
                    <Trash2 size={15} aria-hidden="true" />
                    Log waste
                  </button>
                </div>
              </header>

              {successMessage && (
                <div className="nbw-banner ok" role="status">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{successMessage}</span>
                  <button type="button" onClick={() => setSuccessMessage("")} aria-label="Dismiss message"><X size={15} aria-hidden="true" /></button>
                </div>
              )}
              {wasteLogsError && wasteLogs.length > 0 && (
                <div className="nbw-banner warn" role="alert">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>Showing the last saved list. The latest refresh failed: {wasteLogsError}</span>
                  <button type="button" onClick={refreshLogs}><RefreshCw size={13} aria-hidden="true" /> Try again</button>
                </div>
              )}

              <div className="nb-toolbar">
                <div className="nb-tabs" role="group" aria-label="Show entries from">
                  {WASTE_SCOPES.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      className={`nb-tab${scope === entry.key ? " is-active" : ""}`}
                      aria-pressed={scope === entry.key}
                      onClick={() => setScope(entry.key)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
                <div className="nb-tools">
                  <label className="nb-field nb-search">
                    <Search aria-hidden="true" size={14} strokeWidth={2.2} />
                    <input
                      type="text"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search ingredient, person or note"
                      aria-label="Search waste entries"
                    />
                    {search && (
                      <button type="button" className="nb-search-clear" onClick={() => setSearch("")} aria-label="Clear search">
                        <X size={13} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                    )}
                  </label>
                  <label className="nb-field nb-sort">
                    <span className="nbw-field-label">Reason</span>
                    <select value={reasonFilter} onChange={(event) => setReasonFilter(event.target.value)} aria-label="Filter by reason">
                      <option value="all">All reasons</option>
                      {WASTE_REASONS.map((reason) => (
                        <option key={reason.value} value={reason.value}>{reason.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="nb-sheet">
                <div className="nb-sheet-title">
                  <h2>Waste log</h2>
                  <span className="nb-sheet-note">{filteredLogs.length} {filteredLogs.length === 1 ? "entry" : "entries"}</span>
                </div>

                {filteredLogs.length === 0 ? (
                  <div className="nb-empty" role={wasteLogsError ? "alert" : "status"}>
                    <EmptyIcon size={30} aria-hidden="true" className={wasteLogsLoading && !wasteLogsError ? "is-spinning" : ""} />
                    <strong>{emptyTitle}</strong>
                    <span>{emptyHelp}</span>
                  </div>
                ) : (
                  <ul className="nbw-rows">
                    {filteredLogs.map((entry) => {
                      const reason = getWasteReasonMeta(entry.wasteReason);
                      const isUndoing = undoTarget === entry.id;
                      return (
                        <li key={entry.id} className={`nbw-row${entry.isReversed ? " is-undone" : ""}`}>
                          <div className="nbw-main">
                            <strong className="nbw-name" title={entry.itemName}>{entry.itemName || "Unknown ingredient"}</strong>
                            <span className="nbw-chips">
                              <span className="nbw-chip">{reason.label}</span>
                              {entry.isReversed && <span className="nbw-chip nbw-chip-undone">Undone</span>}
                            </span>
                            {entry.note && <span className="nbw-note" title={entry.note}>{entry.note}</span>}
                          </div>
                          <div className="nbw-qty">
                            <strong>{formatWasteQty(entry.deductedQuantity, entry.unit)}</strong>
                            <span>wasted</span>
                          </div>
                          <div className="nbw-cost">
                            <strong>₱{Number(entry.wasteValue || 0).toFixed(2)}</strong>
                            <span>cost</span>
                          </div>
                          <div className="nbw-who">
                            <strong>{formatWasteDateTime(entry.timestamp)}</strong>
                            <span>by {entry.actor || "Staff"}</span>
                          </div>
                          <div className="nbw-act">
                            {!entry.isReversed && (
                              <button
                                type="button"
                                className="nbw-undo"
                                onClick={() => openUndo(entry)}
                                aria-expanded={isUndoing}
                                title="Undo this entry and put the stock back"
                                aria-label={`Undo waste entry for ${entry.itemName || "ingredient"}`}
                              >
                                <Undo2 size={14} aria-hidden="true" /> Undo
                              </button>
                            )}
                          </div>
                          {isUndoing && (
                            <form className="nbw-undo-form" onSubmit={(event) => submitUndo(event, entry)}>
                              <label>
                                <span>Why are you undoing this? The stock goes back in and the cost is reversed.</span>
                                <input
                                  autoFocus
                                  type="text"
                                  value={undoReason}
                                  maxLength={255}
                                  onChange={(event) => setUndoReason(event.target.value)}
                                  placeholder="For example: logged the wrong item"
                                />
                              </label>
                              <div className="nbw-undo-actions">
                                <button type="submit" className="nb-btn nb-btn-primary" disabled={undoBusy}>{undoBusy ? "Undoing…" : "Undo entry"}</button>
                                <button type="button" className="nb-btn" onClick={closeUndo} disabled={undoBusy}>Keep it</button>
                              </div>
                              {undoError && <p className="nbw-undo-error" role="alert">{undoError}</p>}
                            </form>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </section>

          <aside className="nb-notes" aria-label="Waste summary">
            <h2 className="nb-notes-title">At a glance</h2>
            <div className="nb-note nb-note-butter">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><ClipboardList size={15} aria-hidden="true" /> Entries logged</div>
              <strong>{activeWasteLogs.length.toLocaleString()}</strong>
              <small>{scope === "all" ? "Across all time" : scope === "shift" ? "During this shift" : "Today"}</small>
            </div>
            <div className="nb-note nb-note-rose">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><Trash2 size={15} aria-hidden="true" /> Money lost</div>
              <strong>₱{totalLoss.toFixed(2)}</strong>
              <small>What the wasted stock cost you</small>
            </div>
            <div className="nb-note nb-note-peach">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><AlertTriangle size={15} aria-hidden="true" /> Wasted most</div>
              <strong className="nbw-note-text">{topItem?.name || "Nothing yet"}</strong>
              <small>{topItem ? `${topItem.events} ${topItem.events === 1 ? "time" : "times"} · ${formatWasteQty(topItem.quantity, topItem.unit)}` : "Entries will rank here"}</small>
            </div>
            <div className="nb-note nb-note-sage">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><Undo2 size={15} aria-hidden="true" /> Undone</div>
              <strong>{reversedCount.toLocaleString()}</strong>
              <small>Entries taken back, stock returned</small>
            </div>
          </aside>
        </div>
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
