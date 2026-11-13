import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Coffee,
  FileText,
  Package,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import { useInventory } from "../../context/InventoryContext.jsx";
import { apiRequest } from "../../utils/api.js";

import "../../assets/css/admin/AdminArchive.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";


export default function AdminArchive() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { refreshProducts } = useMenu() || {};
  const { refreshInventory } = useInventory() || {};

  const [activeTab, setActiveTab] = useState("menu"); // "menu" | "inventory" | "audit"
  const [search, setSearch] = useState("");
  const [archiveData, setArchiveData] = useState({
    menuProducts: [],
    inventoryItems: [],
    auditLogs: [],
    counts: { menu: 0, inventory: 0, audit: 0, totalArchived: 0 },
    retentionDays: 30,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    type: null, // "menu" | "inventory" | "empty"
    id: null,
    name: "",
  });
  const [isProcessing, setIsProcessing] = useState(false);

  const fetchArchiveData = useCallback(async () => {
    try {
      setError("");
      const data = await apiRequest("/archive");
      setArchiveData(data);
    } catch (err) {
      setError(err.message || "Failed to load archive data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest("/archive")
      .then((data) => {
        if (active) {
          setArchiveData(data);
          setError("");
        }
      })
      .catch((err) => {
        if (active) setError(err.message || "Failed to load archive data.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleRestore = async (type, id, name) => {
    try {
      setIsProcessing(true);
      await apiRequest(`/archive/restore/${type}/${id}`, { method: "POST" });
      setNotice(`“${name}” was restored to active ${type === "menu" ? "Menu Management" : "Inventory"}!`);
      await fetchArchiveData();
      if (type === "menu") await refreshProducts?.();
      else await refreshInventory?.();
    } catch (err) {
      setError(err.message || `Failed to restore ${name}.`);
    } finally {
      setIsProcessing(false);
    }
  };

  const confirmPermanentDelete = async () => {
    const { type, id, name } = deleteModal;
    try {
      setIsProcessing(true);
      if (type === "empty") {
        const result = await apiRequest("/archive/empty", { method: "DELETE" });
        const skipped = [...(result.skippedMenu || []), ...(result.skippedInventory || [])];
        setNotice(result.message || "Archive trash emptied.");
        if (skipped.length > 0) {
          setError(`Skipped items protected by referential integrity: ${skipped.join("; ")}`);
        }
      } else {
        await apiRequest(`/archive/${type}/${id}`, { method: "DELETE" });
        setNotice(`“${name}” was permanently deleted.`);
      }
      setDeleteModal({ isOpen: false, type: null, id: null, name: "" });
      await fetchArchiveData();
    } catch (err) {
      setError(err.message || "Deletion failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  const getCountdownBadge = (daysRemaining) => {
    if (daysRemaining <= 3) {
      return (
        <span className="archive-countdown-badge critical">
          <Clock size={12} /> {daysRemaining === 0 ? "Purging today" : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`}
        </span>
      );
    }
    if (daysRemaining <= 7) {
      return (
        <span className="archive-countdown-badge warning">
          <Clock size={12} /> {daysRemaining} days left
        </span>
      );
    }
    return (
      <span className="archive-countdown-badge safe">
        <Clock size={12} /> {daysRemaining} days left
      </span>
    );
  };

  const formatArchiveDate = (value) => {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
  };

  const formatAuditDateTime = (value) => {
    if (!value) return "—";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
  };

  const getPinTone = (daysRemaining) => {
    const days = Number(daysRemaining ?? 30);
    if (days <= 3) return "critical";
    if (days <= 7) return "amber";
    return "sage";
  };

  const retentionDays = Number(archiveData.retentionDays || 30);

  const activeLedgerMeta = useMemo(() => {
    if (activeTab === "inventory") {
      return {
        eyebrow: "WAREHOUSE RECOVERY",
        title: "Archived Inventory Stock",
        bookmarkLabel: "STOCK",
        bookmarkTone: "amber",
      };
    }
    if (activeTab === "audit") {
      return {
        eyebrow: "COMPLIANCE LEDGER",
        title: "Permanent Audit Trail",
        bookmarkLabel: "AUDIT",
        bookmarkTone: "sage",
      };
    }
    return {
      eyebrow: "MENU RECOVERY",
      title: "Archived Menu Catalog",
      bookmarkLabel: "MENU",
      bookmarkTone: "terracotta",
    };
  }, [activeTab]);

  const filteredMenuItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archiveData.menuProducts;
    return archiveData.menuProducts.filter(
      (item) =>
        String(item.name || "").toLowerCase().includes(q) ||
        String(item.category || "").toLowerCase().includes(q)
    );
  }, [archiveData.menuProducts, search]);

  const filteredInventoryItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archiveData.inventoryItems;
    return archiveData.inventoryItems.filter(
      (item) =>
        String(item.name || "").toLowerCase().includes(q) ||
        String(item.category || "").toLowerCase().includes(q)
    );
  }, [archiveData.inventoryItems, search]);

  const filteredAuditLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archiveData.auditLogs;
    return archiveData.auditLogs.filter(
      (log) =>
        String(log.entity_name || "").toLowerCase().includes(q) ||
        String(log.actor_name || "").toLowerCase().includes(q) ||
        String(log.action || "").toLowerCase().includes(q) ||
        String(log.note || "").toLowerCase().includes(q)
    );
  }, [archiveData.auditLogs, search]);

  const emptyTrashButton = (
    <div className="admin-archive-grid-bar">
      <p className="admin-archive-note">
        <Clock size={14} aria-hidden="true" />
        <span>Kept for <strong>{retentionDays} days</strong>, then purged automatically.</span>
      </p>
      <button
        type="button"
        className="admin-archive-empty-button"
        disabled={archiveData.counts.totalArchived === 0 || isProcessing}
        onClick={() =>
          setDeleteModal({
            isOpen: true,
            type: "empty",
            id: null,
            name: `all ${archiveData.counts.totalArchived} archived items`,
          })
        }
      >
        <Trash2 size={15} aria-hidden="true" />
        <span>Empty Trash</span>
      </button>
    </div>
  );
  return (
    <div className={`admin-archive-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        role="admin"
        activeTab="archive"
        sidebarCollapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      <main className="admin-archive-main">
        <header className="admin-archive-topbar">
          <div className="admin-archive-topbar-title">
            <span className="admin-archive-section-label">
              <i className="topbar-label-pin" aria-hidden="true" />
              ADMIN PORTAL
            </span>
            <h1>Archive &amp; Trash Management</h1>
            <p className="admin-archive-subtitle">
              Restore removed menu or stock entries within {retentionDays} days, or inspect immutable ledger logs.
            </p>
          </div>
          <div className="admin-archive-topbar-actions">
            <div className="archive-pinned-status">
              <span className="archive-status-pin" aria-hidden="true" />
              <span>VAULT STATUS</span>
              <strong>{archiveData.counts.totalArchived} Stored Items</strong>
              <small>{retentionDays}-day rolling retention</small>
            </div>
          </div>
        </header>

        <div className="admin-archive-content custom-menu-scrollbar">
          {notice && (
            <div className="admin-inventory-notice" role="status">
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice("")}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}

          {error && (
            <div className="admin-inventory-sync-warning admin-archive-error" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}

          <section className="admin-archive-toolbar" aria-label="Archive filter controls">
            <div className="admin-archive-tabs" role="tablist" aria-label="Archive sections">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "menu"}
                className={`admin-archive-tab ${activeTab === "menu" ? "active" : ""}`}
                onClick={() => setActiveTab("menu")}
              >
                <Coffee size={15} aria-hidden="true" />
                <span>Menu Items</span>
                <span className="admin-archive-tab-count">{archiveData.counts.menu}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "inventory"}
                className={`admin-archive-tab ${activeTab === "inventory" ? "active" : ""}`}
                onClick={() => setActiveTab("inventory")}
              >
                <Package size={15} aria-hidden="true" />
                <span>Inventory Items</span>
                <span className="admin-archive-tab-count">{archiveData.counts.inventory}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "audit"}
                className={`admin-archive-tab ${activeTab === "audit" ? "active" : ""}`}
                onClick={() => setActiveTab("audit")}
              >
                <FileText size={15} aria-hidden="true" />
                <span>Audit Trail</span>
                <span className="admin-archive-tab-count">{archiveData.counts.audit}</span>
              </button>
            </div>

            <div className="admin-archive-toolbar-right">
              <div className="admin-archive-search">
                <Search size={15} aria-hidden="true" />
                <input
                  type="text"
                  aria-label={
                    activeTab === "menu"
                      ? "Search archived menu items"
                      : activeTab === "inventory"
                      ? "Search archived inventory"
                      : "Search audit logs"
                  }
                  placeholder={
                    activeTab === "menu"
                      ? "Search archived menu items…"
                      : activeTab === "inventory"
                      ? "Search archived inventory…"
                      : "Search audit logs…"
                  }
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button
                    type="button"
                    className="archive-search-clear"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </section>

          <div className="admin-archive-workspace">
            <section
              className="admin-archive-big-box archive-notebook-sheet"
              aria-label={activeLedgerMeta.title}
            >
              <div className="archive-notebook-spine" aria-hidden="true">
                {Array.from({ length: 10 }).map((_, idx) => (
                  <span key={idx} className="archive-spine-ring">
                    <i className="archive-spine-hole" />
                    <b className="archive-spine-wire" />
                  </span>
                ))}
              </div>

              <div
                className={`archive-notebook-bookmark ${activeLedgerMeta.bookmarkTone}`}
                aria-hidden="true"
              >
                <span className="archive-bookmark-eyelet" />
                <span className="archive-bookmark-text">{activeLedgerMeta.bookmarkLabel}</span>
              </div>

              <div className="archive-notebook-page">
                <div className="archive-ledger-header">
                  <div className="archive-ledger-heading">
                    <span className="archive-ledger-eyebrow">{activeLedgerMeta.eyebrow}</span>
                    <h2>{activeLedgerMeta.title}</h2>
                  </div>

                  {activeTab === "audit" ? (
                    <div className="admin-archive-grid-bar">
                      <p className="admin-archive-note">
                        <FileText size={14} aria-hidden="true" />
                        <span>
                          Showing <strong>{filteredAuditLogs.length}</strong> audit {filteredAuditLogs.length === 1 ? "entry" : "entries"}
                        </span>
                      </p>
                    </div>
                  ) : (
                    emptyTrashButton
                  )}
                </div>

                <div className="admin-archive-scroll custom-menu-scrollbar">
                  <div className="archive-tab-stage" key={activeTab}>
                    {loading ? (
                      <div className="archive-empty-state">
                        <Clock size={34} strokeWidth={1.6} aria-hidden="true" />
                        <strong>Loading archive…</strong>
                        <span>Fetching archived items and audit history.</span>
                      </div>
                    ) : activeTab === "menu" ? (
                      filteredMenuItems.length === 0 ? (
                        <div className="archive-empty-state">
                          <Archive size={36} strokeWidth={1.5} aria-hidden="true" />
                          <strong>No archived menu items</strong>
                          <span>
                            {search.trim()
                              ? "No archived menu products match your current filter."
                              : "Menu items deleted from Menu Management will appear here."}
                          </span>
                        </div>
                      ) : (
                        <div className="admin-archive-grid">
                          {filteredMenuItems.map((item, idx) => (
                            <article
                              className="archive-item-card archive-pinned-card"
                              key={item.id}
                              style={{ "--i": Math.min(idx, 8) }}
                            >
                              <div
                                className={`archive-paper-pin ${getPinTone(item.daysRemaining)}`}
                                aria-hidden="true"
                              >
                                <span className="pin-shadow" />
                                <span className="pin-needle" />
                                <span className="pin-collar" />
                                <span className="pin-head">
                                  <span className="pin-glint" />
                                </span>
                              </div>

                              <div className="archive-card-inner">
                                <div className="archive-item-header">
                                  {item.image_url ? (
                                    <img className="archive-item-image" src={item.image_url} alt={item.name} />
                                  ) : (
                                    <div className="archive-item-image">
                                      {(item.name || "?").charAt(0).toUpperCase()}
                                    </div>
                                  )}
                                  <div className="archive-item-info">
                                    <span className="archive-item-category">{item.category}</span>
                                    <h4 className="archive-item-name" title={item.name}>{item.name}</h4>
                                    <span className="archive-item-price">₱{Number(item.base_price).toFixed(2)}</span>
                                  </div>
                                </div>

                                <div className="archive-item-body">
                                  {getCountdownBadge(item.daysRemaining)}
                                  <div className="archive-meta-row">
                                    <strong>Archived:</strong> {formatArchiveDate(item.archivedAt || item.archived_at)} by {item.archived_by_username || "Admin"}
                                  </div>
                                  <div className="archive-meta-row">
                                    <strong>Auto-purge:</strong> {formatArchiveDate(item.expiresAt || item.expires_at)}
                                  </div>
                                </div>

                                <div className="archive-item-footer">
                                  <button
                                    type="button"
                                    className="archive-restore-btn"
                                    disabled={isProcessing}
                                    onClick={() => handleRestore("menu", item.id, item.name)}
                                  >
                                    <RotateCcw size={14} aria-hidden="true" /> Restore
                                  </button>
                                  <button
                                    type="button"
                                    className="archive-delete-btn"
                                    disabled={isProcessing}
                                    onClick={() =>
                                      setDeleteModal({
                                        isOpen: true,
                                        type: "menu",
                                        id: item.id,
                                        name: item.name,
                                      })
                                    }
                                  >
                                    <Trash2 size={14} aria-hidden="true" /> Delete
                                  </button>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      )
                    ) : activeTab === "inventory" ? (
                      filteredInventoryItems.length === 0 ? (
                        <div className="archive-empty-state">
                          <Package size={36} strokeWidth={1.5} aria-hidden="true" />
                          <strong>No archived inventory items</strong>
                          <span>
                            {search.trim()
                              ? "No archived inventory entries match your current filter."
                              : "Inventory items removed from Inventory Management will appear here."}
                          </span>
                        </div>
                      ) : (
                        <div className="admin-archive-grid">
                          {filteredInventoryItems.map((item, idx) => (
                            <article
                              className="archive-item-card archive-pinned-card"
                              key={item.id}
                              style={{ "--i": Math.min(idx, 8) }}
                            >
                              <div
                                className={`archive-paper-pin ${getPinTone(item.daysRemaining)}`}
                                aria-hidden="true"
                              >
                                <span className="pin-shadow" />
                                <span className="pin-needle" />
                                <span className="pin-collar" />
                                <span className="pin-head">
                                  <span className="pin-glint" />
                                </span>
                              </div>

                              <div className="archive-card-inner">
                                <div className="archive-item-header">
                                  <div className="archive-item-image">
                                    <Package size={24} aria-hidden="true" />
                                  </div>
                                  <div className="archive-item-info">
                                    <span className="archive-item-category">{item.category}</span>
                                    <h4 className="archive-item-name" title={item.name}>{item.name}</h4>
                                    <span className="archive-item-price">
                                      {Number(item.quantity)} {item.unit} in stock
                                    </span>
                                  </div>
                                </div>

                                <div className="archive-item-body">
                                  {getCountdownBadge(item.daysRemaining)}
                                  <div className="archive-meta-row">
                                    <strong>Archived:</strong> {formatArchiveDate(item.archivedAt || item.archived_at)} by {item.archived_by_username || "Admin"}
                                  </div>
                                  <div className="archive-meta-row">
                                    <strong>Auto-purge:</strong> {formatArchiveDate(item.expiresAt || item.expires_at)}
                                  </div>
                                </div>

                                <div className="archive-item-footer">
                                  <button
                                    type="button"
                                    className="archive-restore-btn"
                                    disabled={isProcessing}
                                    onClick={() => handleRestore("inventory", item.id, item.name)}
                                  >
                                    <RotateCcw size={14} aria-hidden="true" /> Restore
                                  </button>
                                  <button
                                    type="button"
                                    className="archive-delete-btn"
                                    disabled={isProcessing}
                                    onClick={() =>
                                      setDeleteModal({
                                        isOpen: true,
                                        type: "inventory",
                                        id: item.id,
                                        name: item.name,
                                      })
                                    }
                                  >
                                    <Trash2 size={14} aria-hidden="true" /> Delete
                                  </button>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      )
                    ) : (
                      <div className="archive-audit-table-card">
                        {filteredAuditLogs.length === 0 ? (
                          <div className="archive-empty-state">
                            <FileText size={36} strokeWidth={1.5} aria-hidden="true" />
                            <strong>No audit logs found</strong>
                            <span>Archive, restore, and purge actions will be recorded here.</span>
                          </div>
                        ) : (
                          <div className="archive-audit-table-wrap">
                            <table className="archive-audit-table">
                              <thead>
                                <tr>
                                  <th>Date &amp; Time</th>
                                  <th>Action</th>
                                  <th>Type</th>
                                  <th>Item Name</th>
                                  <th>Actor</th>
                                  <th>Note</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filteredAuditLogs.map((log) => (
                                  <tr key={log.id}>
                                    <td>{formatAuditDateTime(log.created_at || log.timestamp)}</td>
                                    <td>
                                      <span className={`audit-action-badge ${log.action}`}>
                                        {log.action.replace("_", " ")}
                                      </span>
                                    </td>
                                    <td>{log.entity_type === "menu_product" ? "Menu Product" : "Inventory Item"}</td>
                                    <td><strong>{log.entity_name}</strong></td>
                                    <td>{log.actor_name}</td>
                                    <td className="audit-note-cell">{log.note || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <aside className="admin-archive-vertical-metrics" aria-label="Archive summary">
              <article className="archive-metric-card tone-amber">
                <span className="archive-slip-pin amber" aria-hidden="true" />
                <div className="archive-metric-head">
                  <span className="archive-metric-icon amber">
                    <Coffee size={19} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="metric-badge neutral">Menu</span>
                </div>
                <div className="archive-metric-body">
                  <span className="archive-metric-label">Archived Menu Items</span>
                  <div className="archive-metric-value">{archiveData.counts.menu}</div>
                  <span className="archive-metric-hint">Preserved products</span>
                </div>
              </article>

              <article className="archive-metric-card tone-green">
                <span className="archive-slip-pin green" aria-hidden="true" />
                <div className="archive-metric-head">
                  <span className="archive-metric-icon emerald">
                    <Package size={19} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="metric-badge emerald">Inventory</span>
                </div>
                <div className="archive-metric-body">
                  <span className="archive-metric-label">Archived Inventory</span>
                  <div className="archive-metric-value">{archiveData.counts.inventory}</div>
                  <span className="archive-metric-hint">Supplies &amp; ingredients</span>
                </div>
              </article>

              <article className="archive-metric-card tone-blue">
                <span className="archive-slip-pin blue" aria-hidden="true" />
                <div className="archive-metric-head">
                  <span className="archive-metric-icon blue">
                    <Clock size={19} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="metric-badge neutral">Auto-Purge</span>
                </div>
                <div className="archive-metric-body">
                  <span className="archive-metric-label">Retention Lifecycle</span>
                  <div className="archive-metric-value">{retentionDays} Days</div>
                  <span className="archive-metric-hint">Automatic rolling purge</span>
                </div>
              </article>

              <article className="archive-metric-card tone-plum">
                <span className="archive-slip-pin plum" aria-hidden="true" />
                <div className="archive-metric-head">
                  <span className="archive-metric-icon purple">
                    <FileText size={19} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="metric-badge neutral">Audit</span>
                </div>
                <div className="archive-metric-body">
                  <span className="archive-metric-label">Audit Log Entries</span>
                  <div className="archive-metric-value">{archiveData.counts.audit}</div>
                  <span className="archive-metric-hint">Permanent history</span>
                </div>
              </article>
            </aside>
          </div>
        </div>
      </main>

      {deleteModal.isOpen && (
        <div
          className="archive-modal-backdrop"
          role="presentation"
          onClick={() => !isProcessing && setDeleteModal({ isOpen: false, type: null, id: null, name: "" })}
        >
          <div
            className="archive-modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="archive-paper-pin critical" aria-hidden="true">
              <span className="pin-shadow" />
              <span className="pin-needle" />
              <span className="pin-collar" />
              <span className="pin-head">
                <span className="pin-glint" />
              </span>
            </div>
            <span className="archive-modal-eyebrow">PERMANENT REMOVAL</span>
            <h3 id="archive-modal-title">Permanently Delete?</h3>
            <p>
              Are you sure you want to permanently delete <strong>{deleteModal.name}</strong>?
              This action <strong>cannot be undone</strong> and will be logged in the permanent audit trail.
            </p>
            <div className="archive-modal-actions">
              <button
                type="button"
                className="archive-modal-cancel"
                disabled={isProcessing}
                onClick={() => setDeleteModal({ isOpen: false, type: null, id: null, name: "" })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="archive-modal-confirm-delete"
                disabled={isProcessing}
                onClick={confirmPermanentDelete}
              >
                {isProcessing ? "Deleting…" : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
