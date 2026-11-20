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
import { formatManilaDate, formatManilaDateTime } from "../../../shared/manilaDate.js";

import "../../assets/css/admin/AdminArchive.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const CLOSED_MODAL = { isOpen: false, type: null, id: null, name: "", scope: null };

// Plain names for what the history log records
const ACTION_LABELS = {
  archive: "Removed",
  archived: "Removed",
  delete: "Removed",
  restore: "Restored",
  restored: "Restored",
  permanent_delete: "Deleted for good",
  purge: "Deleted automatically",
  auto_purge: "Deleted automatically",
  empty: "Trash emptied",
  empty_trash: "Trash emptied",
};

const ENTITY_LABELS = {
  menu_product: "Menu item",
  inventory_item: "Inventory item",
  catalog_vault: "Archive",
};

const matches = (q, ...fields) => !q || fields.some((field) => String(field || "").toLowerCase().includes(q));

function describeAction(action) {
  const key = String(action || "").toLowerCase();
  if (ACTION_LABELS[key]) return ACTION_LABELS[key];
  const text = key.replaceAll("_", " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Activity";
}

function actionTone(action) {
  const label = describeAction(action);
  if (label === "Restored") return "good";
  if (label.startsWith("Deleted") || label === "Trash emptied") return "bad";
  return "neutral";
}

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

  const [deleteModal, setDeleteModal] = useState(CLOSED_MODAL);
  const [deleteModalError, setDeleteModalError] = useState("");
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
      setNotice(`“${name}” was restored to ${type === "menu" ? "Menu Management" : "Inventory"}.`);
      await fetchArchiveData();
      if (type === "menu") await refreshProducts?.();
      else await refreshInventory?.();
    } catch (err) {
      setError(err.message || `Failed to restore ${name}.`);
    } finally {
      setIsProcessing(false);
    }
  };

  const closeModal = () => {
    setDeleteModalError("");
    setDeleteModal(CLOSED_MODAL);
  };

  const confirmPermanentDelete = async () => {
    const { type, id, name, scope } = deleteModal;
    try {
      setDeleteModalError("");
      setIsProcessing(true);
      if (type === "empty") {
        const query = scope ? `?type=${encodeURIComponent(scope)}` : "";
        const result = await apiRequest(`/archive/empty${query}`, { method: "DELETE" });
        const skipped = [...(result.skippedMenu || []), ...(result.skippedInventory || [])];
        setNotice(result.message || "Trash emptied.");
        if (skipped.length > 0) {
          setError(`Some items could not be deleted because they are still used elsewhere: ${skipped.join("; ")}`);
        }
      } else {
        await apiRequest(`/archive/${type}/${id}`, { method: "DELETE" });
        setNotice(`“${name}” was deleted for good.`);
      }
      setDeleteModal(CLOSED_MODAL);
      await fetchArchiveData();
    } catch (err) {
      setDeleteModalError(err.message || "Deletion failed.");
      setError(err.message || "Deletion failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  const formatArchiveDate = (value) => formatManilaDate(value, { month: "short", day: "numeric", year: "numeric" });
  const retentionDays = Number(archiveData.retentionDays || 30);

  const timeLeft = (daysRemaining) => {
    const days = Number(daysRemaining ?? retentionDays);
    const tone = days <= 3 ? "critical" : days <= 7 ? "warning" : "safe";
    const text = days <= 0 ? "Deleted today" : `${days} day${days === 1 ? "" : "s"} left`;
    return <span className={`ar-tag is-${tone}`}><Clock size={12} aria-hidden="true" /> {text}</span>;
  };

  const query = search.trim().toLowerCase();

  const filteredMenuItems = useMemo(
    () => archiveData.menuProducts.filter((item) => matches(query, item.name, item.category)),
    [archiveData.menuProducts, query],
  );
  const filteredInventoryItems = useMemo(
    () => archiveData.inventoryItems.filter((item) => matches(query, item.name, item.category)),
    [archiveData.inventoryItems, query],
  );
  const filteredAuditLogs = useMemo(
    () => archiveData.auditLogs.filter((log) => matches(query, log.entity_name, log.actor_name, log.action, log.note)),
    [archiveData.auditLogs, query],
  );

  const tabEmptyCount = activeTab === "menu" ? archiveData.counts.menu : archiveData.counts.inventory;
  const tabEmptyLabel = activeTab === "menu" ? "archived menu items" : "archived inventory items";
  const searchLabel = activeTab === "menu" ? "Search removed menu items" : activeTab === "inventory" ? "Search removed inventory" : "Search history";

  const openDelete = (type, item) => setDeleteModal({ isOpen: true, type, id: item.id, name: item.name, scope: null });

  const renderItemRows = (items, type) => items.map((item) => (
    <tr key={item.id}>
      <td data-label="Item">
        <div className="ar-item">
          {type === "menu" && item.image_url ? (
            <img className="ar-thumb" src={item.image_url} alt="" />
          ) : (
            <span className="ar-thumb">{type === "menu" ? (item.name || "?").charAt(0).toUpperCase() : <Package size={18} aria-hidden="true" />}</span>
          )}
          <div>
            <strong title={item.name}>{item.name}</strong>
            <span>{item.category || "No category"}</span>
          </div>
        </div>
      </td>
      <td data-label={type === "menu" ? "Price" : "Stock when removed"}>
        {type === "menu" ? `₱${Number(item.base_price).toFixed(2)}` : `${Number(item.quantity)} ${item.unit || ""}`}
      </td>
      <td data-label="Removed">
        <strong>{formatArchiveDate(item.archivedAt || item.archived_at)}</strong>
        <span>by {item.archived_by_username || "Admin"}</span>
      </td>
      <td data-label="Time left">
        {timeLeft(item.daysRemaining)}
        <span>Deleted for good on {formatArchiveDate(item.expiresAt || item.expires_at)}</span>
      </td>
      <td data-label="Actions" className="ar-actions-cell">
        <button type="button" className="ar-btn is-primary" disabled={isProcessing} onClick={() => handleRestore(type, item.id, item.name)}>
          <RotateCcw size={14} aria-hidden="true" /> Restore
        </button>
        <button type="button" className="ar-btn is-danger" disabled={isProcessing} onClick={() => openDelete(type, item)}>
          <Trash2 size={14} aria-hidden="true" /> Delete forever
        </button>
      </td>
    </tr>
  ));

  const itemHead = (type) => (
    <tr>
      <th>Item</th>
      <th>{type === "menu" ? "Price" : "Stock when removed"}</th>
      <th>Removed</th>
      <th>Time left</th>
      <th className="ar-actions-head"><span className="sr-only">Actions</span></th>
    </tr>
  );

  const renderEmpty = (Icon, title, text) => (
    <div className="ar-empty">
      <Icon size={30} strokeWidth={1.6} aria-hidden="true" />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );

  let body;
  if (loading) {
    body = renderEmpty(Clock, "Loading…", "Getting your removed items and history.");
  } else if (activeTab === "menu") {
    body = filteredMenuItems.length === 0
      ? renderEmpty(Archive, query ? "No removed menu items match your search" : "No removed menu items", query ? "Try different words, or clear the search." : "Menu items you delete in Menu Management will wait here, so you can restore them.")
      : <table className="ar-table"><thead>{itemHead("menu")}</thead><tbody>{renderItemRows(filteredMenuItems, "menu")}</tbody></table>;
  } else if (activeTab === "inventory") {
    body = filteredInventoryItems.length === 0
      ? renderEmpty(Package, query ? "No removed inventory items match your search" : "No removed inventory items", query ? "Try different words, or clear the search." : "Inventory items you delete will wait here, so you can restore them.")
      : <table className="ar-table"><thead>{itemHead("inventory")}</thead><tbody>{renderItemRows(filteredInventoryItems, "inventory")}</tbody></table>;
  } else {
    body = filteredAuditLogs.length === 0
      ? renderEmpty(FileText, query ? "No history matches your search" : "No history yet", query ? "Try different words, or clear the search." : "Removing, restoring and deleting items will be listed here.")
      : (
        <table className="ar-table is-history">
          <thead>
            <tr>
              <th>When</th>
              <th>What happened</th>
              <th>Type</th>
              <th>Item</th>
              <th>Done by</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {filteredAuditLogs.map((log) => (
              <tr key={log.id}>
                <td data-label="When">{formatManilaDateTime(log.created_at || log.timestamp)}</td>
                <td data-label="What happened"><span className={`ar-tag is-${actionTone(log.action)}`}>{describeAction(log.action)}</span></td>
                <td data-label="Type">{ENTITY_LABELS[log.entityType || log.entity_type] || "Record"}</td>
                <td data-label="Item"><strong>{log.entity_name}</strong></td>
                <td data-label="Done by">{log.actor_name}</td>
                <td data-label="Note">{log.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
  }

  const tabs = [
    { key: "menu", label: "Menu items", Icon: Coffee, count: archiveData.counts.menu },
    { key: "inventory", label: "Inventory items", Icon: Package, count: archiveData.counts.inventory },
    { key: "audit", label: "History", Icon: FileText, count: archiveData.counts.audit },
  ];

  return (
    <div className={`admin-archive-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar role="admin" activeTab="archive" sidebarCollapsed={sidebarCollapsed} onToggle={toggleSidebar} />

      <main className="admin-archive-main">
        <header className="ar-topbar">
          <div className="ar-topbar-title">
            <span className="ar-label">ADMIN PORTAL</span>
            <h1>Archive &amp; Trash</h1>
          </div>
          <p className="ar-topbar-note">
            Deleted menu and inventory items wait here for {retentionDays} days. Restore them, or delete them for good.
          </p>
        </header>

        <div className="ar-content">
          {notice && (
            <div className="ar-banner is-good" role="status">
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice("")} aria-label="Dismiss message"><X size={14} aria-hidden="true" /></button>
            </div>
          )}
          {error && (
            <div className="ar-banner is-bad" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>{error}</span>
              <button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={14} aria-hidden="true" /></button>
            </div>
          )}

          <section className="ar-panel" aria-label="Archive">
            <div className="ar-toolbar">
              <div className="ar-tabs" role="tablist" aria-label="Archive sections">
                {tabs.map(({ key, label, Icon, count }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === key}
                    className={activeTab === key ? "is-active" : ""}
                    onClick={() => setActiveTab(key)}
                  >
                    <Icon size={15} aria-hidden="true" />
                    <span>{label}</span>
                    <span className="ar-count">{count}</span>
                  </button>
                ))}
              </div>

              <label className="ar-search">
                <Search size={15} aria-hidden="true" />
                <input type="text" aria-label={searchLabel} placeholder={searchLabel} value={search} onChange={(e) => setSearch(e.target.value)} />
                {search && (
                  <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X size={13} aria-hidden="true" /></button>
                )}
              </label>
            </div>

            <div className="ar-infobar">
              {activeTab === "audit" ? (
                <p><FileText size={14} aria-hidden="true" /><span>Showing <strong>{filteredAuditLogs.length}</strong> {filteredAuditLogs.length === 1 ? "entry" : "entries"}. History is kept permanently.</span></p>
              ) : (
                <>
                  <p><Clock size={14} aria-hidden="true" /><span>Items stay here for <strong>{retentionDays} days</strong>, then are deleted automatically.</span></p>
                  <button
                    type="button"
                    className="ar-btn is-danger"
                    disabled={tabEmptyCount === 0 || isProcessing}
                    onClick={() => {
                      setDeleteModalError("");
                      setDeleteModal({ isOpen: true, type: "empty", id: null, scope: activeTab, name: `all ${tabEmptyCount} ${tabEmptyLabel}` });
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Empty {activeTab === "menu" ? "menu" : "inventory"} trash
                  </button>
                </>
              )}
            </div>

            <div className="ar-body" role="tabpanel" key={activeTab}>{body}</div>
          </section>
        </div>
      </main>

      {deleteModal.isOpen && (
        <div className="ar-modal-backdrop" role="presentation" onClick={() => !isProcessing && closeModal()}>
          <div className="ar-modal" role="alertdialog" aria-modal="true" aria-labelledby="archive-modal-title" aria-describedby="archive-modal-text" onClick={(e) => e.stopPropagation()}>
            <h3 id="archive-modal-title">Delete forever?</h3>
            <p id="archive-modal-text">
              <strong>{deleteModal.name}</strong> will be deleted for good. This cannot be undone. The deletion is recorded in History.
            </p>
            {deleteModalError && <p className="ar-modal-error" role="alert">{deleteModalError}</p>}
            <div className="ar-modal-actions">
              <button type="button" className="ar-btn" disabled={isProcessing} autoFocus onClick={closeModal}>Cancel</button>
              <button type="button" className="ar-btn is-solid-danger" disabled={isProcessing} onClick={confirmPermanentDelete}>
                {isProcessing ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
