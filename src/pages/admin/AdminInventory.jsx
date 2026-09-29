import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  LayoutGrid,
  List,
  Package,
  Pencil,
  Plus,
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
import "../../assets/css/admin/AdminInventory.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const categories = INVENTORY_CATEGORIES;

// Stable reference so the memo dependencies below don't change every render.
const EMPTY_INVENTORY = [];

function AdminInventory() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const { orders } = useOrders();
  const { inventory: storedInventory, setInventory } = useInventory() || {};
  const inventory = storedInventory || EMPTY_INVENTORY;
  const [activeCategory, setActiveCategory] = useState("All");
  const [viewMode, setViewMode] = useState("grid");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
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
  }), [filteredInventory]);

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

  const resetForm = () => {
    setShowForm(false);
    setEditingItem(null);
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
    setFormValues({
      item: item.item,
      category: item.category,
      quantity: String(item.quantity),
      unit: item.unit,
      minimumStock: String(item.minimumStock),
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    setInventory((currentInventory) => currentInventory.filter((item) => item.id !== id));
  };

  const handleRestock = (id) => {
    setInventory((currentInventory) =>
      currentInventory.map((item) => {
        if (item.id !== id) return item;

        return {
          ...item,
          quantity: item.quantity + Math.max(item.minimumStock, 5),
        };
      })
    );
  };

  const handleSave = (event) => {
    event.preventDefault();

    const itemName = formValues.item.trim();
    const category = formValues.category.trim();
    const unit = formValues.unit.trim();
    const quantity = Number(formValues.quantity);
    const minimumStock = Number(formValues.minimumStock);

    if (!itemName || !category || !unit || !Number.isFinite(quantity) || !Number.isFinite(minimumStock)) {
      return;
    }

    if (editingItem) {
      setInventory((currentInventory) =>
        currentInventory.map((item) =>
          item.id === editingItem.id
            ? {
                ...item,
                item: itemName,
                category,
                quantity,
                unit,
                minimumStock,
              }
            : item
        )
      );
    } else {
      setInventory((currentInventory) => [
        ...currentInventory,
        {
          id: Date.now(),
          item: itemName,
          category,
          quantity,
          unit,
          minimumStock,
        },
      ]);
    }

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
            <PortalNotificationButton count={0} />
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
                <span className="metric-badge blue">Tracked</span>
              </div>
              <div className="metric-body">
                <span className="metric-label">Sold From Orders</span>
                <strong className="metric-value">{soldUnits}</strong>
                <span className="metric-hint">Units recorded</span>
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
            </div>
          </section>

          <section className="admin-inventory-panel">
            {inventory.length === 0 ? (
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
                        <span className={`admin-inventory-badge ${row.statusKey}`}>{row.status}</span>
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
                      <button type="button" onClick={() => handleEdit(row)} title={`Edit ${row.item}`}>
                        <Pencil aria-hidden="true" size={13} strokeWidth={2.2} />
                        <span>Edit</span>
                      </button>
                      <button type="button" className="restock" onClick={() => handleRestock(row.id)} title={`Restock ${row.item}`}>
                        <Warehouse aria-hidden="true" size={13} strokeWidth={2.2} />
                        <span>Restock</span>
                      </button>
                      <button type="button" className="danger" onClick={() => handleDelete(row.id)} title={`Delete ${row.item}`} aria-label={`Delete ${row.item}`}>
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
                            <button type="button" onClick={() => handleEdit(row)}>Edit</button>
                            <button type="button" onClick={() => handleRestock(row.id)}>Restock</button>
                            <button type="button" className="danger" onClick={() => handleDelete(row.id)}>Delete</button>
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
                  required
                />
              </label>
            </div>

            <div className="admin-inventory-modal-actions">
              <button type="button" className="modal-cancel" onClick={resetForm}>Cancel</button>
              <button type="submit" className="modal-save">{editingItem ? "Save changes" : "Add item"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default AdminInventory;
