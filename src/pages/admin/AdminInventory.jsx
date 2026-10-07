import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  LayoutGrid,
  List,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  TrendingUp,
  Warehouse,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import adminAvatar from "../../assets/images/icon/admin1.svg";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useOrders } from "../../context/OrdersContext.jsx";
import { getInventoryStatus, INVENTORY_CATEGORIES, useInventory } from "../../context/InventoryContext.jsx";
import { apiRequest } from "../../utils/api.js";
import "../../assets/css/admin/AdminInventory.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const categories = INVENTORY_CATEGORIES;

// Stable reference so the memo dependencies below don't change every render.
const EMPTY_INVENTORY = [];

function readInventoryAlertPreference() {
  try {
    return JSON.parse(localStorage.getItem("amaya-admin-notifications") || "{}").inventoryAlerts !== false;
  } catch {
    return true;
  }
}

function AdminInventory() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { orders } = useOrders();
  const {
    inventory: storedInventory,
    loading: inventoryLoading,
    error: inventoryError,
    refreshInventory,
    addInventoryItem,
    updateInventoryItem,
    removeInventoryItem,
    restockInventoryItem,
  } = useInventory() || {};
  const inventory = storedInventory || EMPTY_INVENTORY;
  const [activeCategory, setActiveCategory] = useState("All");
  const [viewMode, setViewMode] = useState("grid");
  const [sortBy, setSortBy] = useState("name");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [restockItem, setRestockItem] = useState(null);
  const [restockQuantity, setRestockQuantity] = useState("");
  const [itemToDelete, setItemToDelete] = useState(null);
  const [movementHistory, setMovementHistory] = useState({ item: null, rows: [], loading: false, error: "" });
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [inventoryAlertsEnabled] = useState(readInventoryAlertPreference);
  const [isSaving, setIsSaving] = useState(false);
  const [formValues, setFormValues] = useState({
    item: "",
    category: "Soft Drinks",
    quantity: "",
    unit: "",
    minimumStock: "",
  });

  // Persistence now lives in InventoryContext, shared with Menu Management.

  const filteredInventory = useMemo(() => {
    const query = search.trim().toLowerCase();

    return inventory.filter((entry) => {
      const matchesCategory = activeCategory === "All" || entry.category === activeCategory;
      const matchesSearch =
        !query ||
        `${entry.item} ${entry.category} ${entry.unit}`.toLowerCase().includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, inventory, search]);

  // One row shape shared by both the grid and list views.
  const rows = useMemo(() => filteredInventory.map((entry) => {
    const status = getInventoryStatus(entry.quantity, entry.minimumStock);
    // The bar reads "how comfortably stocked are we": full at 2x the minimum.
    const healthyTarget = entry.minimumStock * 2;
    const ratio = healthyTarget > 0 ? Math.max(0, Math.min(1, entry.quantity / healthyTarget)) : entry.quantity > 0 ? 1 : 0;

    return {
      ...entry,
      status,
      statusKey: status === "In Stock" ? "in-stock" : status === "Low Stock" ? "low-stock" : "out-of-stock",
      stockRatio: Math.round(ratio * 100),
    };
  }).sort((left, right) => {
    if (sortBy === "quantity-asc") return left.quantity - right.quantity || left.item.localeCompare(right.item);
    if (sortBy === "quantity-desc") return right.quantity - left.quantity || left.item.localeCompare(right.item);
    if (sortBy === "status") {
      const order = { "Out of Stock": 0, "Low Stock": 1, "In Stock": 2 };
      return order[left.status] - order[right.status] || left.item.localeCompare(right.item);
    }
    return left.item.localeCompare(right.item);
  }), [filteredInventory, sortBy]);

  const categoryCounts = useMemo(() => {
    const counts = { All: inventory.length };
    inventory.forEach((entry) => {
      counts[entry.category] = (counts[entry.category] || 0) + 1;
    });
    return counts;
  }, [inventory]);

  const totalItems = inventory.length;
  const lowStockCount = inventory.filter((item) => getInventoryStatus(item.quantity, item.minimumStock) === "Low Stock").length;
  const outOfStockCount = inventory.filter((item) => getInventoryStatus(item.quantity, item.minimumStock) === "Out of Stock").length;
  const inStockCount = inventory.filter((item) => getInventoryStatus(item.quantity, item.minimumStock) === "In Stock").length;
  const soldUnits = orders.reduce((total, order) => total + order.items.reduce((itemTotal, item) => itemTotal + item.quantity, 0), 0);

  useEffect(() => {
    if (!showForm && !restockItem && !itemToDelete && !movementHistory.item) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || isSaving) return;
      setShowForm(false);
      setEditingItem(null);
      setRestockItem(null);
      setItemToDelete(null);
      setMovementHistory({ item: null, rows: [], loading: false, error: "" });
      setActionError("");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showForm, restockItem, itemToDelete, movementHistory.item, isSaving]);

  const resetForm = () => {
    setShowForm(false);
    setEditingItem(null);
    setActionError("");
    setIsSaving(false);
    setFormValues({
      item: "",
      category: "Soft Drinks",
      quantity: "",
      unit: "",
      minimumStock: "",
    });
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setActionError("");
    setFormValues({
      item: item.item,
      category: item.category,
      quantity: String(item.quantity),
      unit: item.unit,
      minimumStock: String(item.minimumStock),
    });
    setShowForm(true);
  };

  const requestDelete = (id) => {
    setItemToDelete(inventory.find((entry) => entry.id === id) || null);
    setActionError("");
  };

  const confirmDelete = async () => {
    if (!itemToDelete || isSaving) return;
    setIsSaving(true);
    setActionError("");
    try {
      await removeInventoryItem(itemToDelete.id);
      setNotice(`${itemToDelete.item} was removed from inventory.`);
      setItemToDelete(null);
    } catch (error) {
      setActionError(error.message || "Could not remove this item.");
    } finally {
      setIsSaving(false);
    }
  };

  const openRestock = (item) => {
    setRestockItem(item);
    setRestockQuantity(String(Math.max(1, item.minimumStock * 2 - item.quantity)));
    setActionError("");
  };

  const openMovementHistory = async (item) => {
    setMovementHistory({ item, rows: [], loading: true, error: "" });
    try {
      const rows = await apiRequest(`/inventory/${item.id}/movements?limit=50`);
      setMovementHistory({ item, rows, loading: false, error: "" });
    } catch (error) {
      setMovementHistory({ item, rows: [], loading: false, error: error.message || "Could not load stock history." });
    }
  };

  const handleRestock = async (event) => {
    event.preventDefault();
    const quantity = Number(restockQuantity);
    if (!restockItem || !Number.isFinite(quantity) || quantity <= 0 || isSaving) {
      setActionError("Enter a restock quantity greater than zero.");
      return;
    }
    setIsSaving(true);
    setActionError("");
    try {
      await restockInventoryItem(restockItem.id, quantity);
      setNotice(`${restockItem.item} restocked by ${quantity} ${restockItem.unit}.`);
      setRestockItem(null);
    } catch (error) {
      setActionError(error.message || "Could not restock this item.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();

    const itemName = formValues.item.trim();
    const category = formValues.category.trim();
    const unit = formValues.unit.trim();
    const quantity = Number(formValues.quantity);
    const minimumStock = Number(formValues.minimumStock);

    if (!itemName || !category || !unit || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(minimumStock) || minimumStock < 0) {
      setActionError("Complete all fields with non-negative quantities.");
      return;
    }

    setIsSaving(true);
    setActionError("");
    try {
      const values = { item: itemName, category, quantity, unit, minimumStock };
      if (editingItem) await updateInventoryItem(editingItem.id, values);
      else await addInventoryItem(values);
    } catch (error) {
      setActionError(error.message || "Could not save the inventory item.");
      setIsSaving(false);
      return;
    }

    setNotice(editingItem ? `${itemName} was updated.` : `${itemName} was added to inventory.`);
    setIsSaving(false);
    resetForm();
  };

  return (
    <div className={`admin-inventory-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        role="admin"
        activeTab="inventory"
        sidebarCollapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      <main className="admin-inventory-main">
        <header className="admin-inventory-topbar">
          <div>
            <span className="admin-inventory-section-label">ADMIN PORTAL</span>
            <h1>Inventory</h1>
          </div>
          <div className="admin-inventory-topbar-actions">
            <PortalNotificationButton />
            <div className="admin-inventory-user">
              <div className="amaya-admin-avatar"><img src={adminAvatar} alt="" aria-hidden="true" /></div>
              <div>
                <strong>Administrator</strong>
                <span>Admin</span>
              </div>
            </div>
          </div>
        </header>

        <div className="admin-inventory-content">
          {notice && (
            <div className="admin-inventory-notice" role="status">
              <CheckCircle2 size={16} aria-hidden="true" />
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice("")} aria-label="Dismiss message">×</button>
            </div>
          )}
          {inventoryError && inventory.length > 0 && (
            <div className="admin-inventory-sync-warning" role="status">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>Showing saved inventory. The latest refresh failed: {inventoryError}</span>
              <button type="button" onClick={() => refreshInventory?.().catch(() => {})}>
                <RefreshCw size={13} aria-hidden="true" /> Retry
              </button>
            </div>
          )}
          {inventoryAlertsEnabled && lowStockCount + outOfStockCount > 0 && (
            <div className="admin-inventory-stock-alert" role="status">
              <AlertTriangle size={17} aria-hidden="true" />
              <span>
                <strong>{outOfStockCount + lowStockCount} item{outOfStockCount + lowStockCount === 1 ? "" : "s"} need attention.</strong>
                {outOfStockCount > 0 && ` ${outOfStockCount} out of stock.`}
                {lowStockCount > 0 && ` ${lowStockCount} running low.`}
              </span>
              <Link to="/admin/reports">Review stock report <span aria-hidden="true">→</span></Link>
            </div>
          )}
          {/* Stock Overview Header + Unified Metrics Grid */}
          <section className="admin-inventory-head">
            <div className="admin-inventory-head-main">
              <span className="admin-inventory-eyebrow">Stock Overview</span>
              <h2>Inventory management</h2>
              <p>Track ingredients, packaging, and supplies needed for your daily operations.</p>
            </div>

            <button type="button" className="admin-inventory-add-button" onClick={() => setShowForm(true)}>
              <Plus size={16} strokeWidth={2.6} aria-hidden="true" />
              <span>Add inventory item</span>
            </button>
          </section>

          <section className="admin-inventory-metrics" aria-label="Inventory summary">
            <article className="metric-card">
              <div className="metric-card-head">
                <span className="metric-icon amber">
                  <Package size={18} strokeWidth={1.9} aria-hidden="true" />
                </span>
                <span className="metric-badge neutral">Total</span>
              </div>
              <div className="metric-body">
                <span className="metric-label">Total Items</span>
                <strong className="metric-value">{totalItems}</strong>
                <span className="metric-hint">Tracked inventory</span>
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-card-head">
                <span className="metric-icon emerald">
                  <CheckCircle2 size={18} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="metric-badge emerald">Ready</span>
              </div>
              <div className="metric-body">
                <span className="metric-label">In Stock</span>
                <strong className="metric-value">{inStockCount}</strong>
                <span className="metric-hint">Ready to use</span>
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-card-head">
                <span className="metric-icon amber">
                  <Clock size={18} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="metric-badge amber">Restock</span>
              </div>
              <div className="metric-body">
                <span className="metric-label">Low Stock</span>
                <strong className="metric-value">{lowStockCount}</strong>
                <span className="metric-hint">Restock soon</span>
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-card-head">
                <span className="metric-icon rose">
                  <AlertTriangle size={18} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="metric-badge rose">Critical</span>
              </div>
              <div className="metric-body">
                <span className="metric-label">Out of Stock</span>
                <strong className="metric-value critical">{outOfStockCount}</strong>
                <span className="metric-hint">Needs ordering</span>
              </div>
            </article>

            <article className="metric-card">
              <div className="metric-card-head">
                <span className="metric-icon blue">
                  <TrendingUp size={18} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="metric-badge blue">Orders</span>
              </div>
              <div className="metric-body">
                <span className="metric-label">Menu Units Sold</span>
                <strong className="metric-value">{soldUnits}</strong>
                <span className="metric-hint">Across recorded orders</span>
              </div>
            </article>
          </section>

          <section className="admin-inventory-toolbar">
            <div className="admin-inventory-pills" role="tablist" aria-label="Inventory categories">
              {categories.map((category) => {
                const count = categoryCounts[category] || 0;

                return (
                  <button
                    key={category}
                    type="button"
                    role="tab"
                    aria-selected={activeCategory === category}
                    className={`admin-inventory-pill ${activeCategory === category ? "active" : ""} ${count === 0 && category !== "All" ? "empty" : ""}`}
                    onClick={() => setActiveCategory(category)}
                  >
                    {category}
                    <span className="admin-inventory-pill-count">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="admin-inventory-toolbar-right">
              <label className="admin-inventory-search">
                <Search aria-hidden="true" size={15} strokeWidth={2} />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search inventory"
                  aria-label="Search inventory"
                />
              </label>

              <div className="admin-inventory-viewtoggle" role="group" aria-label="View mode">
                <button
                  type="button"
                  className={viewMode === "grid" ? "active" : ""}
                  onClick={() => setViewMode("grid")}
                  aria-pressed={viewMode === "grid"}
                  title="Grid view"
                >
                  <LayoutGrid aria-hidden="true" size={15} strokeWidth={2} />
                  <span>Grid</span>
                </button>
                <button
                  type="button"
                  className={viewMode === "list" ? "active" : ""}
                  onClick={() => setViewMode("list")}
                  aria-pressed={viewMode === "list"}
                  title="List view"
                >
                  <List aria-hidden="true" size={15} strokeWidth={2} />
                  <span>List</span>
                </button>
              </div>
              <label className="admin-inventory-sort">
                <span>Sort</span>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort inventory">
                  <option value="name">Name A–Z</option>
                  <option value="quantity-asc">Quantity: Low to high</option>
                  <option value="quantity-desc">Quantity: High to low</option>
                  <option value="status">Needs attention first</option>
                </select>
              </label>
            </div>
          </section>

          <section className="admin-inventory-panel">
            {inventoryLoading && inventory.length === 0 ? (
              <div className="admin-inventory-blank" role="status">
                <div className="admin-inventory-blank-icon" aria-hidden="true"><RefreshCw size={21} /></div>
                <p className="admin-inventory-blank-title">Loading inventory</p>
                <p className="admin-inventory-blank-text">Fetching the latest stock levels.</p>
              </div>
            ) : inventoryError && inventory.length === 0 ? (
              <div className="admin-inventory-blank" role="alert">
                <div className="admin-inventory-blank-icon" aria-hidden="true"><AlertTriangle size={22} /></div>
                <p className="admin-inventory-blank-title">Inventory couldn’t load</p>
                <p className="admin-inventory-blank-text">{inventoryError}</p>
                <button type="button" className="inventory-retry-button" onClick={() => refreshInventory?.().catch(() => {})}>
                  <RefreshCw size={14} aria-hidden="true" /> Try again
                </button>
              </div>
            ) : inventory.length === 0 ? (
              <div className="admin-inventory-blank">
                <div className="admin-inventory-blank-icon" aria-hidden="true">
                  <Package size={24} strokeWidth={1.8} />
                </div>
                <p className="admin-inventory-blank-title">No inventory items found</p>
                <p className="admin-inventory-blank-text">
                  Click &ldquo;+ Add inventory&rdquo; above to start adding ingredients and packaging stock.
                </p>
              </div>
            ) : rows.length === 0 ? (
              <div className="admin-inventory-blank">
                <div className="admin-inventory-blank-icon" aria-hidden="true">
                  <Search size={22} strokeWidth={1.8} />
                </div>
                <p className="admin-inventory-blank-title">Nothing matches this view</p>
                <p className="admin-inventory-blank-text">
                  {search
                    ? `No items matching "${search}" in ${activeCategory === "All" ? "the catalog" : activeCategory}.`
                    : `No items in ${activeCategory}.`}
                </p>
              </div>
            ) : viewMode === "grid" ? (
              <div className="admin-inventory-grid">
                {rows.map((row) => (
                  <article className="admin-inventory-card" key={row.id}>
                    <div>
                      <div className="admin-inventory-card-top">
                      <div className="admin-inventory-card-title">
                        <span className="admin-inventory-card-category">{row.category}</span>
                        <h4>{row.item}</h4>
                      </div>
                      <div className="admin-inventory-card-badges">
                        {row.addedFromMenu && <span className="inventory-source-badge">Menu recipe</span>}
                        <span className={`admin-inventory-badge ${row.statusKey}`}>{row.status}</span>
                      </div>
                      </div>

                      <div className="admin-inventory-card-stock">
                        <div>
                          <span className="admin-inventory-card-label">Current quantity</span>
                          <p className="admin-inventory-card-qty">
                            {row.quantity}
                            <span>{row.unit}</span>
                          </p>
                        </div>
                        <div className="admin-inventory-card-min">
                          <span className="admin-inventory-card-label">Minimum stock</span>
                          <p>{row.minimumStock} {row.unit}</p>
                        </div>
                      </div>

                      <div
                        className="admin-inventory-progress"
                        role="progressbar"
                        aria-valuenow={row.stockRatio}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${row.item} stock level`}
                      >
                        <span className={row.statusKey} style={{ width: `${row.stockRatio}%` }} />
                      </div>
                    </div>

                    <div className="admin-inventory-card-actions">
                      <button type="button" onClick={() => openMovementHistory(row)} title={`View ${row.item} stock history`}>
                        <History aria-hidden="true" size={13} strokeWidth={2.2} />
                        <span>History</span>
                      </button>
                      <button type="button" onClick={() => handleEdit(row)} title={`Edit ${row.item}`}>
                        <Pencil aria-hidden="true" size={13} strokeWidth={2.2} />
                        <span>Edit</span>
                      </button>
                      <button type="button" className="restock" onClick={() => openRestock(row)} title={`Restock ${row.item}`}>
                        <Warehouse aria-hidden="true" size={13} strokeWidth={2.2} />
                        <span>Restock</span>
                      </button>
                      <button type="button" className="danger" onClick={() => requestDelete(row.id)} title={`Delete ${row.item}`} aria-label={`Delete ${row.item}`}>
                        <Trash2 aria-hidden="true" size={13} strokeWidth={2.2} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="admin-inventory-table-wrap">
                <table className="admin-inventory-table">
                  <thead>
                    <tr>
                      <th>Inventory Item</th>
                      <th>Category</th>
                      <th>Quantity</th>
                      <th>Unit</th>
                      <th>Minimum Stock</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.item}</td>
                        <td>{row.category}</td>
                        <td>{row.quantity}</td>
                        <td>{row.unit}</td>
                        <td>{row.minimumStock}</td>
                        <td>
                          <span className={`inventory-status ${row.statusKey}`}>{row.status}</span>
                        </td>
                        <td>
                          <div className="inventory-actions">
                            <button type="button" onClick={() => openMovementHistory(row)}>History</button>
                            <button type="button" onClick={() => handleEdit(row)}>Edit</button>
                            <button type="button" onClick={() => openRestock(row)}>Restock</button>
                            <button type="button" className="danger" onClick={() => requestDelete(row.id)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>

      {showForm && (
        <div className="admin-inventory-modal-backdrop" role="presentation" onClick={resetForm}>
          <form className="admin-inventory-modal" onSubmit={handleSave} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="admin-inventory-modal-header">
              <div>
                <span className="admin-inventory-eyebrow">INVENTORY UPDATE</span>
                <h3>{editingItem ? "Edit inventory item" : "Add inventory item"}</h3>
              </div>
              <button type="button" onClick={resetForm} aria-label="Close form">×</button>
            </div>

            <div className="admin-inventory-form-grid">
              <label>
                Inventory Item
                <input
                  type="text"
                  value={formValues.item}
                  autoFocus
                  onChange={(event) => setFormValues({ ...formValues, item: event.target.value })}
                  placeholder="e.g. Brown Sugar"
                  required
                />
              </label>

              <label>
                Category
                <select
                  value={formValues.category}
                  onChange={(event) => setFormValues({ ...formValues, category: event.target.value })}
                >
                  {categories.filter((category) => category !== "All").map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>

              <label>
                Quantity
                <input
                  type="number"
                  value={formValues.quantity}
                  onChange={(event) => setFormValues({ ...formValues, quantity: event.target.value })}
                  min="0"
                  step="any"
                  required
                />
              </label>

              <label>
                Unit
                <input
                  type="text"
                  value={formValues.unit}
                  onChange={(event) => setFormValues({ ...formValues, unit: event.target.value })}
                  placeholder="e.g. liters, pcs, kg"
                  required
                />
              </label>

              <label>
                Minimum Stock
                <input
                  type="number"
                  value={formValues.minimumStock}
                  onChange={(event) => setFormValues({ ...formValues, minimumStock: event.target.value })}
                  min="0"
                  step="any"
                  required
                />
              </label>
            </div>

            {actionError && <p className="inventory-form-error" role="alert">{actionError}</p>}

            <div className="admin-inventory-modal-actions">
              <button type="button" className="modal-cancel" onClick={resetForm}>Cancel</button>
              <button type="submit" className="modal-save" disabled={isSaving}>
                {isSaving ? "Saving…" : editingItem ? "Save changes" : "Add item"}
              </button>
            </div>
          </form>
        </div>
      )}

      {movementHistory.item && (
        <div className="admin-inventory-modal-backdrop" role="presentation" onClick={() => setMovementHistory({ item: null, rows: [], loading: false, error: "" })}>
          <section className="admin-inventory-modal inventory-history-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-history-title" onClick={(event) => event.stopPropagation()}>
            <div className="admin-inventory-modal-header">
              <div>
                <span className="admin-inventory-eyebrow">AUDIT TRAIL</span>
                <h3 id="inventory-history-title">{movementHistory.item.item} history</h3>
                <p>Stock changes, quantities, and the account that recorded them.</p>
              </div>
              <button type="button" onClick={() => setMovementHistory({ item: null, rows: [], loading: false, error: "" })} aria-label="Close stock history">×</button>
            </div>
            {movementHistory.loading ? <p className="inventory-history-empty">Loading stock history…</p>
              : movementHistory.error ? <p className="inventory-history-error" role="alert">{movementHistory.error}</p>
                : movementHistory.rows.length ? (
                  <div className="inventory-history-list">
                    {movementHistory.rows.map((row) => (
                      <article className="inventory-history-row" key={row.id}>
                        <div><strong>{row.type === "usage" ? "Order usage" : row.type === "restock" ? "Restocked" : "Stock adjustment"}</strong><span>{row.note || "Inventory updated"}</span><small>{row.actor} · {new Date(row.timestamp).toLocaleString()}</small></div>
                        <b className={row.quantityChange > 0 ? "is-increase" : "is-decrease"}>{row.quantityChange > 0 ? "+" : ""}{row.quantityChange} {movementHistory.item.unit}</b>
                      </article>
                    ))}
                  </div>
                ) : <p className="inventory-history-empty">No stock movements recorded yet.</p>}
          </section>
        </div>
      )}

      {restockItem && (
        <div className="admin-inventory-modal-backdrop" role="presentation" onClick={() => !isSaving && setRestockItem(null)}>
          <form className="admin-inventory-modal inventory-action-modal" onSubmit={handleRestock} role="dialog" aria-modal="true" aria-labelledby="restock-dialog-title" onClick={(event) => event.stopPropagation()}>
            <div className="admin-inventory-modal-header">
              <div>
                <span className="admin-inventory-eyebrow">STOCK MOVEMENT</span>
                <h3 id="restock-dialog-title">Restock {restockItem.item}</h3>
                <p>Current: {restockItem.quantity} {restockItem.unit} · Minimum: {restockItem.minimumStock} {restockItem.unit}</p>
              </div>
              <button type="button" onClick={() => setRestockItem(null)} disabled={isSaving} aria-label="Close restock form">×</button>
            </div>
            <label className="inventory-restock-field">
              Quantity to add ({restockItem.unit})
              <input autoFocus type="number" min="0.01" step="any" value={restockQuantity} onChange={(event) => setRestockQuantity(event.target.value)} required />
              <small>This amount will be added to the current stock and recorded as a restock.</small>
            </label>
            {actionError && <p className="inventory-form-error" role="alert">{actionError}</p>}
            <div className="admin-inventory-modal-actions">
              <button type="button" className="modal-cancel" onClick={() => setRestockItem(null)} disabled={isSaving}>Cancel</button>
              <button type="submit" className="modal-save" disabled={isSaving}>{isSaving ? "Adding stock…" : "Confirm restock"}</button>
            </div>
          </form>
        </div>
      )}

      {itemToDelete && (
        <div className="admin-inventory-modal-backdrop" role="presentation" onClick={() => !isSaving && setItemToDelete(null)}>
          <section className="admin-inventory-modal inventory-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" onClick={(event) => event.stopPropagation()}>
            <div className="admin-inventory-modal-header">
              <div>
                <span className="admin-inventory-eyebrow">REMOVE INVENTORY ITEM</span>
                <h3 id="delete-dialog-title">Delete {itemToDelete.item}?</h3>
                <p>This can’t be undone. Items used in recipes or with stock history are protected.</p>
              </div>
            </div>
            {actionError && <p className="inventory-form-error" role="alert">{actionError}</p>}
            <div className="admin-inventory-modal-actions">
              <button type="button" className="modal-cancel" onClick={() => { setItemToDelete(null); setActionError(""); }} disabled={isSaving}>Keep item</button>
              <button type="button" className="inventory-delete-confirm" onClick={confirmDelete} disabled={isSaving}>
                {isSaving ? "Deleting…" : "Delete item"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default AdminInventory;
