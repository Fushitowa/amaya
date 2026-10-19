import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
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
  Warehouse,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { DEFAULT_INGREDIENT_CATEGORY, getInventoryStatus, INVENTORY_CATEGORIES, useInventory } from "../../context/InventoryContext.jsx";
import { apiRequest } from "../../utils/api.js";
import "../../assets/css/admin/AdminInventory.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const categories = INVENTORY_CATEGORIES;
const inventoryUnitGroups = [
  { label: "Weight", options: [["mg", "Milligrams (mg)"], ["g", "Grams (g)"], ["hg", "Hectograms (hg)"], ["kg", "Kilograms (kg)"], ["oz", "Ounces (oz)"], ["lb", "Pounds (lb)"]] },
  { label: "Volume", options: [["ml", "Milliliters (ml)"], ["cl", "Centiliters (cl)"], ["dl", "Deciliters (dl)"], ["l", "Liters (L)"], ["tsp", "Teaspoons (tsp)"], ["tbsp", "Tablespoons (tbsp)"], ["fl oz", "Fluid ounces (fl oz)"], ["cup", "Cups"], ["pt", "Pints (pt)"], ["qt", "Quarts (qt)"], ["gal", "Gallons (gal)"], ["cc", "Cubic centimeters (cc)"]] },
  { label: "Count", options: [["pcs", "Pieces (pcs)"], ["pair", "Pairs"], ["dozen", "Dozen"]] },
];
const packageUnitOptions = ["pack", "box", "bag", "bottle", "can", "sack", "set", "tub", "jar", "carton"];

function createEmptyInventoryForm() {
  return {
    item: "",
    category: DEFAULT_INGREDIENT_CATEGORY,
    purchasePrice: "",
    packageQuantity: "1",
    packageUnit: "pack",
    contentsPerPackage: "",
    unit: "g",
    quantity: "",
    maximumStock: "",
  };
}

// Stable reference so the memo dependencies below don't change every render.
const EMPTY_INVENTORY = [];

function readInventoryAlertPreference() {
  try {
    return JSON.parse(localStorage.getItem("amaya-admin-notifications") || "{}").inventoryAlerts !== false;
  } catch {
    return true;
  }
}

function FieldHelpTooltip({ title, text, align = "left" }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleDocumentClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <span
      className="inventory-field-help-wrap"
      ref={containerRef}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        className={`inventory-field-help-btn ${isOpen ? "is-active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={(e) => {
          if (!containerRef.current?.contains(e.relatedTarget)) {
            setIsOpen(false);
          }
        }}
        aria-label={`Help: ${title}`}
        aria-expanded={isOpen}
      >
        !
      </button>

      {isOpen && (
        <span
          className={`inventory-field-help-popover align-${align}`}
          role="tooltip"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <span className="inventory-field-help-title">
            <span className="inventory-field-help-badge-icon">!</span>
            {title}
          </span>
          <span className="inventory-field-help-body">{text}</span>
        </span>
      )}
    </span>
  );
}

function AdminInventory() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
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
  const [formValues, setFormValues] = useState(createEmptyInventoryForm);

  // Dynamic live calculation of unit cost and valuation for the Add/Edit form preview
  const parsedLivePurchasePrice = Number(formValues.purchasePrice || 0);
  const livePurchasePrice = Number.isFinite(parsedLivePurchasePrice) ? Math.max(0, parsedLivePurchasePrice) : 0;
  const parsedLivePackageQuantity = Number(formValues.packageQuantity);
  const livePkgQty = Number.isFinite(parsedLivePackageQuantity) && parsedLivePackageQuantity > 0 ? parsedLivePackageQuantity : 0;
  const parsedLiveContents = Number(formValues.contentsPerPackage || 0);
  const liveContents = Number.isFinite(parsedLiveContents) ? Math.max(0, parsedLiveContents) : 0;
  const liveTotalMeasurable = livePkgQty * liveContents;
  const liveUnitCost = (livePurchasePrice > 0 && liveTotalMeasurable > 0)
    ? (livePurchasePrice / liveTotalMeasurable)
    : 0;
  const parsedLiveStockQty = Number(formValues.quantity || 0);
  const liveStockQty = Number.isFinite(parsedLiveStockQty) ? Math.max(0, parsedLiveStockQty) : 0;
  const liveInventoryValue = liveStockQty * liveUnitCost;

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
    const status = getInventoryStatus(entry.quantity, entry.maximumStock);
    const healthyTarget = Number(entry.maximumStock) > 0 ? Number(entry.maximumStock) : entry.quantity;
    const ratio = healthyTarget > 0 ? Math.max(0, Math.min(1, entry.quantity / healthyTarget)) : 0;
    const unitCost = Number(entry.unitCost || entry.unit_cost || 0);
    const inventoryValue = Number((Number(entry.quantity || 0) * unitCost).toFixed(2));
    const packageSpec = `${entry.packageQuantity || 1} ${entry.packageUnit || "pack"}${entry.contentsPerPackage ? ` (${entry.contentsPerPackage} ${entry.unit})` : ""}`;

    return {
      ...entry,
      unitCost,
      inventoryValue,
      packageSpec,
      status,
      statusKey: status === "In Stock" ? "in-stock" : status === "Over Maximum" ? "over-maximum" : "out-of-stock",
      stockRatio: Math.round(ratio * 100),
    };
  }).sort((left, right) => {
    if (sortBy === "quantity-asc") return left.quantity - right.quantity || left.item.localeCompare(right.item);
    if (sortBy === "quantity-desc") return right.quantity - left.quantity || left.item.localeCompare(right.item);
    if (sortBy === "status") {
      const order = { "Out of Stock": 0, "Over Maximum": 1, "In Stock": 2 };
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
  const overMaximumCount = inventory.filter((item) => getInventoryStatus(item.quantity, item.maximumStock) === "Over Maximum").length;
  const outOfStockCount = inventory.filter((item) => getInventoryStatus(item.quantity, item.maximumStock) === "Out of Stock").length;
  const inStockCount = inventory.filter((item) => getInventoryStatus(item.quantity, item.maximumStock) === "In Stock").length;
  const totalInventoryAssetValue = inventory.reduce((sum, item) => sum + (Number(item.quantity || 0) * Number(item.unitCost || item.unit_cost || 0)), 0);

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
      if (showForm) {
        setEditingItem(null);
        setFormValues(createEmptyInventoryForm());
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showForm, restockItem, itemToDelete, movementHistory.item, isSaving]);

  const resetForm = () => {
    setShowForm(false);
    setEditingItem(null);
    setActionError("");
    setIsSaving(false);
    setFormValues(createEmptyInventoryForm());
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setActionError("");
    setFormValues({
      item: item.item,
      category: item.category,
      purchasePrice: item.purchasePrice != null ? String(item.purchasePrice) : "",
      packageQuantity: item.packageQuantity != null ? String(item.packageQuantity) : "1",
      packageUnit: item.packageUnit || "pack",
      contentsPerPackage: item.contentsPerPackage != null ? String(item.contentsPerPackage) : "",
      unit: item.unit || "g",
      quantity: String(item.quantity),
      maximumStock: item.maximumStock == null ? "" : String(item.maximumStock),
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
      setNotice(`${itemToDelete.item} was moved to the archive.`);
      setItemToDelete(null);
    } catch (error) {
      setActionError(error.message || "Could not remove this item.");
    } finally {
      setIsSaving(false);
    }
  };

  const openRestock = (item) => {
    setRestockItem(item);
    setRestockQuantity(String(Math.max(1, Number(item.maximumStock || 0) - item.quantity)));
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
    const packageUnit = formValues.packageUnit.trim() || "pack";
    const purchasePrice = formValues.purchasePrice.trim() === "" ? 0 : Number(formValues.purchasePrice);
    const packageQuantity = formValues.packageQuantity.trim() === "" ? 0 : Number(formValues.packageQuantity);
    const enteredContentsPerPackage = formValues.contentsPerPackage.trim() === "" ? 0 : Number(formValues.contentsPerPackage);
    const contentsPerPackage = enteredContentsPerPackage || 1;
    const quantity = Number(formValues.quantity);
    const maximumStock = formValues.maximumStock === "" ? null : Number(formValues.maximumStock);

    if (!itemName || !category || !unit || !Number.isFinite(quantity) || quantity < 0
      || !Number.isFinite(purchasePrice) || purchasePrice < 0
      || !Number.isFinite(packageQuantity) || packageQuantity <= 0
      || !Number.isFinite(enteredContentsPerPackage) || enteredContentsPerPackage < 0
      || (purchasePrice > 0 && enteredContentsPerPackage <= 0)
      || (maximumStock !== null && (!Number.isFinite(maximumStock) || maximumStock <= 0))) {
      setActionError("Enter valid stock and costing values. If you enter a purchase price, also enter the amount inside each package.");
      return;
    }

    const totalMeasurable = packageQuantity * contentsPerPackage;
    const unitCost = (purchasePrice > 0 && totalMeasurable > 0)
      ? Number((purchasePrice / totalMeasurable).toFixed(4))
      : 0;

    setIsSaving(true);
    setActionError("");
    try {
      const values = {
        item: itemName,
        category,
        purchasePrice,
        packageQuantity,
        packageUnit,
        contentsPerPackage,
        unitCost,
        quantity,
        unit,
        maximumStock,
      };
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
          <div className="admin-inventory-head-main">
            <span className="admin-inventory-eyebrow">Stock Overview</span>
            <h1>Inventory management</h1>
            <p>Track ingredients, packaging, and supplies needed for your daily operations.</p>
          </div>
          <div className="admin-inventory-topbar-actions" style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            {inventoryAlertsEnabled && overMaximumCount + outOfStockCount > 0 && (
              <div className="admin-inventory-stock-alert" role="status">
                <AlertTriangle size={15} aria-hidden="true" />
                <span>
                  <strong>{outOfStockCount + overMaximumCount} item{outOfStockCount + overMaximumCount === 1 ? "" : "s"} need attention.</strong>
                  {outOfStockCount > 0 && ` ${outOfStockCount} out of stock.`}
                  {overMaximumCount > 0 && ` ${overMaximumCount} above maximum stock.`}
                </span>
                <Link to="/admin/reports">Review stock report <span aria-hidden="true">→</span></Link>
              </div>
            )}
            <Link
              to="/admin/archive"
              className="admin-inventory-archive-button"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.65rem 1rem",
                borderRadius: "10px",
                background: "#ffffff",
                color: "#2e261f",
                fontWeight: "600",
                fontSize: "0.88rem",
                textDecoration: "none",
                border: "1px solid #ece4df",
                boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              }}
            >
              <Archive size={16} /> View Archive
            </Link>
            <button
              type="button"
              className="admin-inventory-add-button"
              onClick={() => {
                setEditingItem(null);
                setFormValues(createEmptyInventoryForm());
                setActionError("");
                setShowForm(true);
              }}
            >
              <Plus size={16} strokeWidth={2.6} aria-hidden="true" />
              <span>Add inventory item</span>
            </button>
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

          <div className="admin-inventory-workspace">
            <div className="admin-inventory-main-pane">
              <section className="admin-inventory-toolbar">
                <label className="admin-inventory-search">
                  <Search aria-hidden="true" size={15} strokeWidth={2} />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search inventory items..."
                    aria-label="Search inventory"
                  />
                </label>

                <div className="admin-inventory-toolbar-center">
                  <label className="admin-inventory-filter">
                    <span>Category</span>
                    <select
                      value={activeCategory}
                      onChange={(event) => setActiveCategory(event.target.value)}
                      aria-label="Filter inventory by category"
                    >
                      {categories.map((category) => {
                        const count = categoryCounts[category] || 0;
                        return (
                          <option key={category} value={category}>
                            {category === "All" ? "All Categories" : category} ({count})
                          </option>
                        );
                      })}
                    </select>
                  </label>

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

                <div className="admin-inventory-toolbar-right">
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
                        <div className="admin-inventory-card-max">
                          <span className="admin-inventory-card-label">Maximum stock</span>
                          <p>{row.maximumStock == null ? "Not set" : `${row.maximumStock} ${row.unit}`}</p>
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

                      <div className="inventory-pricing-badges">
                        <span className="inventory-unit-cost-pill" title="Calculated unit cost">
                          ₱{Number(row.unitCost || 0).toFixed(4)} / {row.unit}
                        </span>
                        <span className="inventory-value-pill" title="Current remaining stock asset value">
                          Valued: ₱{Number(row.inventoryValue || 0).toFixed(2)}
                        </span>
                        {row.packageQuantity && row.contentsPerPackage ? (
                          <span className="inventory-source-badge" title="Package specification">
                            {row.packageSpec}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="admin-inventory-card-actions">
                      <button type="button" onClick={() => openMovementHistory(row)} title={`View ${row.item} stock history`}>
                        <History aria-hidden="true" size={11} strokeWidth={2.2} />
                        <span>History</span>
                      </button>
                      <button type="button" onClick={() => handleEdit(row)} title={`Edit ${row.item}`}>
                        <Pencil aria-hidden="true" size={11} strokeWidth={2.2} />
                        <span>Edit</span>
                      </button>
                      <button type="button" className="restock" onClick={() => openRestock(row)} title={`Restock ${row.item}`}>
                        <Warehouse aria-hidden="true" size={11} strokeWidth={2.2} />
                        <span>Restock</span>
                      </button>
                      <button type="button" className="danger" onClick={() => requestDelete(row.id)} title={`Archive ${row.item}`} aria-label={`Archive ${row.item}`}>
                        <Trash2 aria-hidden="true" size={11.5} strokeWidth={2.2} />
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
                      <th>Unit Cost</th>
                      <th>Package Spec</th>
                      <th>Asset Value</th>
                      <th>Max Stock</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.item}</td>
                        <td>{row.category}</td>
                        <td><strong>{row.quantity}</strong> {row.unit}</td>
                        <td>₱{Number(row.unitCost || 0).toFixed(4)} / {row.unit}</td>
                        <td>{row.packageSpec}</td>
                        <td><span className="inventory-value-pill">₱{Number(row.inventoryValue || 0).toFixed(2)}</span></td>
                        <td>{row.maximumStock == null ? "—" : `${row.maximumStock} ${row.unit}`}</td>
                        <td>
                          <span className={`inventory-status ${row.statusKey}`}>{row.status}</span>
                        </td>
                        <td>
                          <div className="inventory-actions">
                            <button type="button" onClick={() => openMovementHistory(row)}>History</button>
                            <button type="button" onClick={() => handleEdit(row)}>Edit</button>
                            <button type="button" onClick={() => openRestock(row)}>Restock</button>
                            <button type="button" className="danger" onClick={() => requestDelete(row.id)}>Archive</button>
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

        <aside className="admin-inventory-side-rail" aria-label="Inventory statistics and overview">
          <div className="admin-inventory-side-rail-sticky">
            <div className="admin-inventory-side-rail-title">
              <Warehouse size={15} aria-hidden="true" />
              <span>Inventory Overview</span>
            </div>

            <div className="admin-inventory-metrics">
              <article className="metric-card">
                <div className="metric-card-head">
                  <span className="metric-icon amber">
                    <Package size={17} strokeWidth={1.9} aria-hidden="true" />
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
                    <CheckCircle2 size={17} strokeWidth={2} aria-hidden="true" />
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
                    <Clock size={17} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="metric-badge amber">Review</span>
                </div>
                <div className="metric-body">
                  <span className="metric-label">Above Maximum</span>
                  <strong className="metric-value">{overMaximumCount}</strong>
                  <span className="metric-hint">Review stock levels</span>
                </div>
              </article>

              <article className="metric-card">
                <div className="metric-card-head">
                  <span className="metric-icon rose">
                    <AlertTriangle size={17} strokeWidth={2} aria-hidden="true" />
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
                    <Warehouse size={17} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="metric-badge blue">Valuation</span>
                </div>
                <div className="metric-body">
                  <span className="metric-label">Inventory Asset Value</span>
                  <strong className="metric-value">₱{totalInventoryAssetValue.toFixed(2)}</strong>
                  <span className="metric-hint">{totalItems} active supplies & ingredients</span>
                </div>
              </article>
            </div>
          </div>
        </aside>
      </div>
        </div>
      </main>

      {showForm && (
        <div className="admin-inventory-modal-backdrop" role="presentation">
          <form className="admin-inventory-modal admin-inventory-item-modal" onSubmit={handleSave} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="admin-inventory-modal-header">
              <div>
                <span className="admin-inventory-eyebrow">INVENTORY UPDATE</span>
                <h3>{editingItem ? "Edit inventory item" : "Add inventory item"}</h3>
              </div>
              <button type="button" onClick={resetForm} aria-label="Close form">×</button>
            </div>

            <div className="admin-inventory-modal-body">
              <div className="admin-inventory-form-grid">
              <span className="admin-inventory-form-section-title">1. Item Identification</span>
              <label>
                <span className="inventory-field-label-text">
                  Inventory Item Name
                  <FieldHelpTooltip
                    title="Item Name"
                    text="Exact ingredient or packaging name (e.g. Non-Dairy Milk Powder, 22oz Cups, Assam Black Tea). Keep it specific so recipes attach to the right stock!"
                    align="left"
                  />
                </span>
                <input
                  type="text"
                  value={formValues.item}
                  autoFocus
                  onChange={(event) => setFormValues({ ...formValues, item: event.target.value })}
                  placeholder="e.g. Milk Powder, Assorted Pearls, 22oz Cups"
                  required
                />
              </label>

              <label>
                <span className="inventory-field-label-text">
                  Category
                  <FieldHelpTooltip
                    title="Category"
                    text="Operational grouping for recipe & stock control. E.g., Black Tea = 'Tea Bases' | Milk = 'Dairy & Creamers' | Cups = 'Packaging & Disposables' | Pearls = 'Toppings & Add-ons'!"
                    align="right"
                  />
                </span>
                <select
                  value={formValues.category}
                  onChange={(event) => setFormValues({ ...formValues, category: event.target.value })}
                >
                  {!categories.includes(formValues.category) && <option value={formValues.category}>{formValues.category} (current)</option>}
                  {categories.filter((category) => category !== "All").map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>

              <span className="admin-inventory-form-section-title">2. Procurement & Package Specification</span>
              <label>
                <span className="inventory-field-label-text">
                  Purchase Price (₱)
                  <FieldHelpTooltip
                    title="Purchase Price"
                    text="Total money paid for this batch (e.g. ₱3,300 for a 25kg sack of powder). System divides this by total quantity to get your true cost per cup!"
                    align="left"
                  />
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formValues.purchasePrice}
                  onChange={(event) => setFormValues({ ...formValues, purchasePrice: event.target.value })}
                  placeholder="e.g. 99.00 or 3300.00"
                />
              </label>

              <label>
                <span className="inventory-field-label-text">
                  Package Quantity Purchased
                  <FieldHelpTooltip
                    title="Package Quantity"
                    text="Number of containers, sacks, or boxes bought (e.g. 1 sack of powder, 5 boxes of cups). Multiplied by package contents to auto-calculate your total stock!"
                    align="right"
                  />
                </span>
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={formValues.packageQuantity}
                  onChange={(event) => {
                    const newPkgQty = event.target.value;
                    const nextTotal = (Number(newPkgQty || 1) * Number(formValues.contentsPerPackage || 0));
                    setFormValues((prev) => ({
                      ...prev,
                      packageQuantity: newPkgQty,
                      quantity: !editingItem && nextTotal > 0 ? String(nextTotal) : prev.quantity,
                    }));
                  }}
                  placeholder="e.g. 1, 5, 10"
                />
              </label>

              <label>
                <span className="inventory-field-label-text">
                  Package Type / Unit
                  <FieldHelpTooltip
                    title="Package Container"
                    text="Container packaging medium (sack, box, bottle, bag, pack). Gives staff a clear audit specification label on inventory cards!"
                    align="left"
                  />
                </span>
                <select
                  value={formValues.packageUnit}
                  onChange={(event) => setFormValues({ ...formValues, packageUnit: event.target.value })}
                >
                  {!packageUnitOptions.includes(formValues.packageUnit) && <option value={formValues.packageUnit}>{formValues.packageUnit} (current)</option>}
                  {packageUnitOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>

              <label>
                <span className="inventory-field-label-text">
                  Contents per Package
                  <FieldHelpTooltip
                    title="Contents per Package"
                    text="Measurable amount inside ONE package (e.g. 25000g for a 25kg sack, 1000pcs for a box of cups, 2500ml for syrup). Critical for calculating cost per cup!"
                    align="right"
                  />
                </span>
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  value={formValues.contentsPerPackage}
                  onChange={(event) => {
                    const newContents = event.target.value;
                    const nextTotal = (Number(formValues.packageQuantity || 1) * Number(newContents || 0));
                    setFormValues((prev) => ({
                      ...prev,
                      contentsPerPackage: newContents,
                      quantity: !editingItem && nextTotal > 0 ? String(nextTotal) : prev.quantity,
                    }));
                  }}
                  placeholder="e.g. 1000 (for 1kg), 750 (ml), 2000 (pcs)"
                />
              </label>

              <label>
                <span className="inventory-field-label-text">
                  Stock Measurement Unit
                  <FieldHelpTooltip
                    title="Stock Unit"
                    text="Recipe dispensing unit: 'g' for powders/tea/pearls, 'ml' for syrups/liquids, 'pcs' for cups/lids/straws. Must match your menu recipe unit!"
                    align="left"
                  />
                </span>
                <select
                  value={formValues.unit}
                  onChange={(event) => setFormValues({ ...formValues, unit: event.target.value })}
                >
                  {!inventoryUnitGroups.some((group) => group.options.some(([value]) => value === formValues.unit)) && <option value={formValues.unit}>{formValues.unit} (current)</option>}
                  {inventoryUnitGroups.map((group) => (
                    <optgroup label={group.label} key={group.label}>
                      {group.options.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>

              <div className="inventory-costing-preview-box">
                <div className="costing-preview-header">
                  <span className="costing-preview-title">Live Costing & Stock Conversion</span>
                  <span className="costing-preview-badge">₱{liveUnitCost.toFixed(4)} / {formValues.unit || "unit"}</span>
                </div>
                <div className="costing-preview-metrics">
                  <div>
                    <small>Batch Inflow Stock</small>
                    <strong>{liveTotalMeasurable > 0 ? liveTotalMeasurable.toLocaleString() : "0"} {formValues.unit}</strong>
                  </div>
                  <div>
                    <small>Total Purchase Cost</small>
                    <strong>₱{livePurchasePrice.toFixed(2)}</strong>
                  </div>
                  <div>
                    <small>Valuation at Stock</small>
                    <strong>₱{liveInventoryValue.toFixed(2)}</strong>
                  </div>
                </div>
                <p className="costing-preview-hint">
                  {livePurchasePrice > 0 && liveContents <= 0
                    ? "Enter the measurable contents in each package to calculate an accurate unit cost."
                    : `Unit Cost = Purchase Price (₱${livePurchasePrice.toFixed(2)}) ÷ (${livePkgQty} ${formValues.packageUnit} × ${liveContents || 1} ${formValues.unit}) = ₱${liveUnitCost.toFixed(4)} per ${formValues.unit}`}
                </p>
              </div>

              <span className="admin-inventory-form-section-title">3. Stock Levels & Thresholds</span>
              <label>
                <span className="inventory-field-label-text">
                  Current Measurable Stock ({formValues.unit})
                  <FieldHelpTooltip
                    title="Current Stock"
                    text="Actual measurable amount in your cafe right now (e.g. 25,000g or 500 pcs). POS automatically subtracts from this every time a drink is sold!"
                    align="left"
                  />
                </span>
                <input
                  type="number"
                  value={formValues.quantity}
                  onChange={(event) => setFormValues({ ...formValues, quantity: event.target.value })}
                  min="0"
                  step="any"
                  placeholder="Total stock in storage"
                  required
                />
              </label>

              <label>
                <span className="inventory-field-label-text">
                  Maximum Stock ({formValues.unit})
                  <FieldHelpTooltip
                    title="Maximum Stock"
                    text="Optional upper target for the amount you want to keep. The system flags this item when its quantity goes above this level."
                    align="right"
                  />
                </span>
                <input
                  type="number"
                  value={formValues.maximumStock}
                  onChange={(event) => setFormValues({ ...formValues, maximumStock: event.target.value })}
                  min="0.000001"
                  step="0.000001"
                  placeholder="No maximum set"
                />
              </label>
            </div>

            {actionError && <p className="inventory-form-error" role="alert">{actionError}</p>}
            </div>

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
                <p>Current: {restockItem.quantity} {restockItem.unit} · Maximum: {restockItem.maximumStock == null ? "Not set" : `${restockItem.maximumStock} ${restockItem.unit}`}</p>
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
                <span className="admin-inventory-eyebrow">MOVE TO ARCHIVE</span>
                <h3 id="delete-dialog-title">Archive {itemToDelete.item}?</h3>
                <p>This item will be safely moved to the <strong>Archive</strong> for 30 days before permanent deletion. You can restore it anytime from Management → Archive!</p>
              </div>
            </div>
            {actionError && <p className="inventory-form-error" role="alert">{actionError}</p>}
            <div className="admin-inventory-modal-actions">
              <button type="button" className="modal-cancel" onClick={() => { setItemToDelete(null); setActionError(""); }} disabled={isSaving}>Cancel</button>
              <button type="button" className="inventory-delete-confirm" onClick={confirmDelete} disabled={isSaving}>
                {isSaving ? "Archiving…" : "Move to Archive"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default AdminInventory;
