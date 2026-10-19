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
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import adminAvatar from "../../assets/images/icon/admin1.svg";
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
        setNotice(result.message || "Archive trash emptied successfully.");
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

  const filteredMenuItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archiveData.menuProducts;
    return archiveData.menuProducts.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.category && item.category.toLowerCase().includes(q))
    );
  }, [archiveData.menuProducts, search]);

  const filteredInventoryItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archiveData.inventoryItems;
    return archiveData.inventoryItems.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.category && item.category.toLowerCase().includes(q))
    );
  }, [archiveData.inventoryItems, search]);

  const filteredAuditLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return archiveData.auditLogs;
    return archiveData.auditLogs.filter(
      (log) =>
        log.entity_name.toLowerCase().includes(q) ||
        log.actor_name.toLowerCase().includes(q) ||
        log.action.toLowerCase().includes(q) ||
        (log.note && log.note.toLowerCase().includes(q))
    );
  }, [archiveData.auditLogs, search]);

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
          <div>
            <span className="admin-archive-section-label">ADMIN PORTAL</span>
            <h1>Archive & Trash Management</h1>
          </div>
          <div className="admin-archive-topbar-actions">
            <PortalNotificationButton />
            <div className="admin-archive-user">
              <div className="amaya-admin-avatar">
                <img src={adminAvatar} alt="" aria-hidden="true" />
              </div>
              <div>
                <strong>Administrator</strong>
                <span>Admin</span>
              </div>
            </div>
          </div>
        </header>

        <div className="admin-archive-content custom-menu-scrollbar">
          {notice && (
            <div className="admin-inventory-notice" role="status" style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#eaf1ea", color: "#607b66", padding: "0.75rem 1rem", borderRadius: "10px" }}>
              <CheckCircle2 size={16} aria-hidden="true" />
              <span style={{ flex: 1, fontWeight: "500" }}>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice("")}
                aria-label="Dismiss message"
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "#607b66" }}
              >
                ×
              </button>
            </div>
          )}

          {error && (
            <div className="admin-inventory-sync-warning" role="alert" style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#f9e9e5", color: "#a56452", padding: "0.75rem 1rem", borderRadius: "10px" }}>
              <AlertTriangle size={16} aria-hidden="true" />
              <span style={{ flex: 1, fontWeight: "500" }}>{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "#a56452" }}
              >
                ×
              </button>
            </div>
          )}

          <section className="admin-archive-head">
            <div className="admin-archive-head-main">
              <span className="admin-archive-eyebrow">Trash & Compliance</span>
              <h2>30-Day Safe Archive</h2>
              <p>
                Items deleted from Menu Management or Inventory are preserved here for 30 days before permanent deletion. You can restore them anytime or purge immediately.
              </p>
            </div>

            <div className="admin-archive-head-actions">
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
                <Trash2 size={16} />
                <span>Empty Trash</span>
              </button>
            </div>
          </section>

          <section className="admin-archive-metrics" aria-label="Archive summary">
            <article className="archive-metric-card">
              <div className="archive-metric-head">
                <span className="archive-metric-icon amber">
                  <Coffee size={20} strokeWidth={2} />
                </span>
                <span className="metric-badge neutral">Menu</span>
              </div>
              <div>
                <span className="archive-metric-label">Archived Menu Items</span>
                <div className="archive-metric-value">{archiveData.counts.menu}</div>
                <span className="archive-metric-hint">Preserved products</span>
              </div>
            </article>

            <article className="archive-metric-card">
              <div className="archive-metric-head">
                <span className="archive-metric-icon emerald">
                  <Package size={20} strokeWidth={2} />
                </span>
                <span className="metric-badge emerald">Inventory</span>
              </div>
              <div>
                <span className="archive-metric-label">Archived Inventory</span>
                <div className="archive-metric-value">{archiveData.counts.inventory}</div>
                <span className="archive-metric-hint">Supplies & ingredients</span>
              </div>
            </article>

            <article className="archive-metric-card">
              <div className="archive-metric-head">
                <span className="archive-metric-icon blue">
                  <Clock size={20} strokeWidth={2} />
                </span>
                <span className="metric-badge neutral">Auto-Purge</span>
              </div>
              <div>
                <span className="archive-metric-label">Retention Lifecycle</span>
                <div className="archive-metric-value">30 Days</div>
                <span className="archive-metric-hint">Automatic rolling purge</span>
              </div>
            </article>

            <article className="archive-metric-card">
              <div className="archive-metric-head">
                <span className="archive-metric-icon purple">
                  <FileText size={20} strokeWidth={2} />
                </span>
                <span className="metric-badge neutral">Audit</span>
              </div>
              <div>
                <span className="archive-metric-label">Audit Log Entries</span>
                <div className="archive-metric-value">{archiveData.counts.audit}</div>
                <span className="archive-metric-hint">Permanent history</span>
              </div>
            </article>
          </section>

          <section className="admin-archive-toolbar">
            <div className="admin-archive-tabs" role="tablist">
              <button
                type="button"
                className={`admin-archive-tab ${activeTab === "menu" ? "active" : ""}`}
                onClick={() => setActiveTab("menu")}
              >
                <Coffee size={15} />
                <span>Menu Items</span>
                <span className="admin-archive-tab-count">{archiveData.counts.menu}</span>
              </button>
              <button
                type="button"
                className={`admin-archive-tab ${activeTab === "inventory" ? "active" : ""}`}
                onClick={() => setActiveTab("inventory")}
              >
                <Package size={15} />
                <span>Inventory Items</span>
                <span className="admin-archive-tab-count">{archiveData.counts.inventory}</span>
              </button>
              <button
                type="button"
                className={`admin-archive-tab ${activeTab === "audit" ? "active" : ""}`}
                onClick={() => setActiveTab("audit")}
              >
                <FileText size={15} />
                <span>Audit Trail</span>
                <span className="admin-archive-tab-count">{archiveData.counts.audit}</span>
              </button>
            </div>

            <div className="admin-archive-search">
              <Search size={15} color="#857b72" />
              <input
                type="text"
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
            </div>
          </section>

          {loading ? (
            <div className="archive-empty-state">
              <strong>Loading archive…</strong>
              <span>Fetching items and audit history.</span>
            </div>
          ) : activeTab === "menu" ? (
            filteredMenuItems.length === 0 ? (
              <div className="archive-empty-state">
                <Archive size={36} color="#857b72" strokeWidth={1.5} />
                <strong>No archived menu items</strong>
                <span>Menu items deleted from Menu Management will appear here.</span>
              </div>
            ) : (
              <div className="admin-archive-grid">
                {filteredMenuItems.map((item) => (
                  <article className="archive-item-card" key={item.id}>
                    <div className="archive-item-header">
                      {item.image_url ? (
                        <img className="archive-item-image" src={item.image_url} alt={item.name} />
                      ) : (
                        <div className="archive-item-image">
                          {item.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="archive-item-info">
                        <span className="archive-item-category">{item.category}</span>
                        <h4 className="archive-item-name">{item.name}</h4>
                        <span className="archive-item-price">₱{Number(item.base_price).toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="archive-item-body">
                      {getCountdownBadge(item.daysRemaining)}
                      <div>
                        <strong>Archived:</strong> {new Date(item.archived_at).toLocaleDateString()} by {item.archived_by_username || "Admin"}
                      </div>
                      <div>
                        <strong>Auto-purge:</strong> {new Date(item.expiresAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div className="archive-item-footer">
                      <button
                        type="button"
                        className="archive-restore-btn"
                        disabled={isProcessing}
                        onClick={() => handleRestore("menu", item.id, item.name)}
                      >
                        <RotateCcw size={14} /> Restore
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
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )
          ) : activeTab === "inventory" ? (
            filteredInventoryItems.length === 0 ? (
              <div className="archive-empty-state">
                <Package size={36} color="#857b72" strokeWidth={1.5} />
                <strong>No archived inventory items</strong>
                <span>Inventory items removed from Inventory Management will appear here.</span>
              </div>
            ) : (
              <div className="admin-archive-grid">
                {filteredInventoryItems.map((item) => (
                  <article className="archive-item-card" key={item.id}>
                    <div className="archive-item-header">
                      <div className="archive-item-image">
                        <Package size={24} />
                      </div>
                      <div className="archive-item-info">
                        <span className="archive-item-category">{item.category}</span>
                        <h4 className="archive-item-name">{item.name}</h4>
                        <span className="archive-item-price">
                          {Number(item.quantity)} {item.unit} in stock
                        </span>
                      </div>
                    </div>

                    <div className="archive-item-body">
                      {getCountdownBadge(item.daysRemaining)}
                      <div>
                        <strong>Archived:</strong> {new Date(item.archived_at).toLocaleDateString()} by {item.archived_by_username || "Admin"}
                      </div>
                      <div>
                        <strong>Auto-purge:</strong> {new Date(item.expiresAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div className="archive-item-footer">
                      <button
                        type="button"
                        className="archive-restore-btn"
                        disabled={isProcessing}
                        onClick={() => handleRestore("inventory", item.id, item.name)}
                      >
                        <RotateCcw size={14} /> Restore
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
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )
          ) : (
            <div className="archive-audit-table-card">
              {filteredAuditLogs.length === 0 ? (
                <div className="archive-empty-state">
                  <FileText size={36} color="#857b72" strokeWidth={1.5} />
                  <strong>No audit logs found</strong>
                  <span>Archive, restore, and purge actions will be recorded here.</span>
                </div>
              ) : (
                <table className="archive-audit-table">
                  <thead>
                    <tr>
                      <th>Date & Time</th>
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
                        <td>{new Date(log.created_at).toLocaleString()}</td>
                        <td>
                          <span className={`audit-action-badge ${log.action}`}>
                            {log.action.replace("_", " ")}
                          </span>
                        </td>
                        <td>{log.entity_type === "menu_product" ? "Menu Product" : "Inventory Item"}</td>
                        <td><strong>{log.entity_name}</strong></td>
                        <td>{log.actor_name}</td>
                        <td style={{ color: "#857b72" }}>{log.note || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
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
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Permanently Delete?</h3>
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
