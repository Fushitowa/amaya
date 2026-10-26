import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Coffee,
  Edit2,
  FolderTree,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Search,
  Sliders,
  Tags,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import adminAvatar from "../../assets/images/icon/admin1.svg";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import { useInventory } from "../../context/InventoryContext.jsx";
import { apiRequest } from "../../utils/api.js";

import "./AdminCategories.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const OPERATIONAL_FAMILY_CONFIG = {
  drink: {
    label: "Beverage Workflow",
    badgeClass: "badge-family-drink",
    desc: "Uses volumetric liquid/powder recipes, cup-size isolation, dynamic modifiers, and scarcest-ingredient stock bounding.",
  },
  fries: {
    label: "Weighed Mass (Fries)",
    badgeClass: "badge-family-fries",
    desc: "Uses gram-based weight tiers (Regular/Large/Jumbo), seasoning powders, oil absorption, and paper cones.",
  },
  snack_pieces: {
    label: "Discrete Pieces (Snacks)",
    badgeClass: "badge-family-snack",
    desc: "Uses piece counts (4s/6s/12s), bamboo skewers/paper boats, and dipping sauce portions.",
  },
  single_fixed: {
    label: "Single Fixed Price",
    badgeClass: "badge-family-fixed",
    desc: "Fixed assembly units sold without size dropdowns (burgers, hotdogs, single treats).",
  },
  general: {
    label: "Standard Item",
    badgeClass: "badge-family-general",
    desc: "Default catalog category behavior.",
  },
};

export default function AdminCategories() {
  const { sidebarCollapsed, toggleSidebar } = useSidebar();
  const {
    categories: menuCategories = [],
    refreshCategories: refreshMenuCategories,
    addCategory: addMenuCategory,
    updateCategory: updateMenuCategory,
    deleteCategory: deleteMenuCategory,
  } = useMenu() || {};

  const {
    categories: inventoryCategories = [],
    refreshCategories: refreshInventoryCategories,
    addCategory: addInventoryCategory,
    updateCategory: updateInventoryCategory,
    deleteCategory: deleteInventoryCategory,
    reassignAndDeleteCategory,
  } = useInventory() || {};

  const [activeTab, setActiveTab] = useState("menu"); // "menu" | "inventory"
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState({ type: "", message: "" });

  // Modal State for Create / Edit
  const [modalState, setModalState] = useState({
    isOpen: false,
    mode: "create", // "create" | "edit"
    tab: "menu", // "menu" | "inventory"
    id: null,
    name: "",
    description: "",
    operationalFamily: "general",
    isCupCategory: false,
    displayOrder: 0,
    isActive: true,
  });

  // Delete Confirmation Modal
  const [deleteModal, setDeleteModal] = useState({
    isOpen: false,
    tab: "menu",
    id: null,
    name: "",
    count: 0,
    isSystem: false,
    reassignTargetId: "",
  });

  // Keyboard accessibility: Escape key to close modals
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setModalState((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
        setDeleteModal((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const showNotice = (type, message) => {
    setNotice({ type, message });
    setTimeout(() => {
      setNotice({ type: "", message: "" });
    }, 4500);
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      if (activeTab === "menu" && refreshMenuCategories) {
        await refreshMenuCategories();
      } else if (refreshInventoryCategories) {
        await refreshInventoryCategories();
      }
      showNotice("success", "Categories refreshed successfully.");
    } catch (err) {
      showNotice("error", err.message || "Failed to refresh categories.");
    } finally {
      setLoading(false);
    }
  };

  // Filtered lists
  const filteredMenuCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (menuCategories || []).filter((cat) => {
      if (!query) return true;
      return (
        String(cat.name || "").toLowerCase().includes(query) ||
        String(cat.description || "").toLowerCase().includes(query) ||
        String(cat.operationalFamily || "").toLowerCase().includes(query)
      );
    });
  }, [menuCategories, search]);

  const filteredInventoryCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (inventoryCategories || []).filter((cat) => {
      if (!query) return true;
      return (
        String(cat.name || "").toLowerCase().includes(query) ||
        String(cat.description || "").toLowerCase().includes(query)
      );
    });
  }, [inventoryCategories, search]);

  // Totals summary
  const totals = useMemo(() => {
    const menuCount = menuCategories.length;
    const invCount = inventoryCategories.length;
    const totalProducts = menuCategories.reduce((acc, c) => acc + Number(c.productCount || 0), 0);
    const totalItems = inventoryCategories.reduce((acc, c) => acc + Number(c.itemCount || 0), 0);
    const cupCount = inventoryCategories.filter((c) => Boolean(c.isCupCategory)).length;
    return { menuCount, invCount, totalProducts, totalItems, cupCount };
  }, [menuCategories, inventoryCategories]);

  // Open Add Modal
  const openAddModal = () => {
    const highestOrder = activeTab === "menu"
      ? Math.max(0, ...(menuCategories || []).map((c) => Number(c.displayOrder || 0))) + 1
      : Math.max(0, ...(inventoryCategories || []).map((c) => Number(c.displayOrder || 0))) + 1;

    setModalState({
      isOpen: true,
      mode: "create",
      tab: activeTab,
      id: null,
      name: "",
      description: "",
      operationalFamily: "general",
      isCupCategory: false,
      displayOrder: highestOrder,
      isActive: true,
    });
  };

  // Open Edit Modal
  const openEditModal = (item, tab) => {
    setModalState({
      isOpen: true,
      mode: "edit",
      tab,
      id: item.id,
      name: item.name || "",
      description: item.description || "",
      operationalFamily: item.operationalFamily || "general",
      isCupCategory: Boolean(item.isCupCategory),
      displayOrder: Number(item.displayOrder || 0),
      isActive: item.isActive !== false,
    });
  };

  // Handle Save
  const handleSaveCategory = async (e) => {
    e.preventDefault();
    if (!modalState.name.trim()) {
      showNotice("error", "Category name is required.");
      return;
    }

    setLoading(true);
    try {
      if (modalState.tab === "menu") {
        const payload = {
          name: modalState.name.trim(),
          description: modalState.description.trim() || null,
          operationalFamily: modalState.operationalFamily,
          displayOrder: Number(modalState.displayOrder) || 0,
          isActive: Boolean(modalState.isActive),
        };
        if (modalState.mode === "create") {
          await addMenuCategory(payload);
          showNotice("success", `Menu category “${payload.name}” created successfully!`);
        } else {
          await updateMenuCategory(modalState.id, payload);
          showNotice("success", `Menu category “${payload.name}” updated successfully!`);
        }
      } else {
        const payload = {
          name: modalState.name.trim(),
          description: modalState.description.trim() || null,
          isCupCategory: Boolean(modalState.isCupCategory),
          displayOrder: Number(modalState.displayOrder) || 0,
          isActive: Boolean(modalState.isActive),
        };
        if (modalState.mode === "create") {
          await addInventoryCategory(payload);
          showNotice("success", `Inventory category “${payload.name}” created successfully!`);
        } else {
          await updateInventoryCategory(modalState.id, payload);
          showNotice("success", `Inventory category “${payload.name}” updated successfully!`);
        }
      }
      setModalState((prev) => ({ ...prev, isOpen: false }));
    } catch (err) {
      showNotice("error", err.message || "Failed to save category.");
    } finally {
      setLoading(false);
    }
  };

  // Open Delete Confirm
  const promptDelete = (item, tab) => {
    const count = tab === "menu" ? Number(item.productCount || 0) : Number(item.itemCount || 0);
    setDeleteModal({
      isOpen: true,
      tab,
      id: item.id,
      name: item.name,
      count,
      isSystem: false,
      reassignTargetId: "",
    });
  };

  // Confirm Delete
  const confirmDelete = async () => {
    if (!deleteModal.id) return;
    setLoading(true);
    try {
      if (deleteModal.tab === "menu") {
        await deleteMenuCategory(deleteModal.id);
        showNotice("success", `Menu category “${deleteModal.name}” deleted.`);
      } else {
        if (deleteModal.count > 0 && deleteModal.reassignTargetId) {
          await reassignAndDeleteCategory(deleteModal.id, Number(deleteModal.reassignTargetId));
          showNotice("success", `Inventory category “${deleteModal.name}” deleted and items reassigned.`);
        } else {
          await deleteInventoryCategory(deleteModal.id);
          showNotice("success", `Inventory category “${deleteModal.name}” deleted.`);
        }
      }
      setDeleteModal({ isOpen: false, tab: "menu", id: null, name: "", count: 0, isSystem: false, reassignTargetId: "" });
    } catch (err) {
      showNotice("error", err.message || "Failed to delete category.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`admin-categories-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        role="admin"
        activeTab="categories"
        sidebarCollapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

      <main className="admin-categories-main">
        {/* Canonical Top Header matching Amaya Design System */}
        <header className="admin-categories-topbar">
          <div className="admin-categories-head-main">
            <span className="admin-categories-eyebrow">CATALOG ARCHITECTURE</span>
            <h1>Category Management</h1>
            <p>Configure operational logic, menu workflows, and warehouse classification.</p>
          </div>
          <div className="admin-categories-topbar-actions">
            <PortalNotificationButton />
            <div className="admin-categories-user">
              <div className="amaya-admin-avatar">
                <img src={adminAvatar} alt="" aria-hidden="true" />
              </div>
              <div className="admin-categories-user-meta">
                <strong>Store Admin</strong>
                <span>Administrator</span>
              </div>
            </div>
          </div>
        </header>

        <div className="admin-categories-content">
          {/* Notice Alert */}
          {notice.message && (
            <div
              className={`categories-notice ${notice.type === "success" ? "notice-success" : "notice-error"}`}
              role="status"
            >
              {notice.type === "success" ? (
                <CheckCircle2 size={18} aria-hidden="true" />
              ) : (
                <AlertCircle size={18} aria-hidden="true" />
              )}
              <span>{notice.message}</span>
              <button
                type="button"
                className="notice-dismiss"
                onClick={() => setNotice({ type: "", message: "" })}
                aria-label="Dismiss notice"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          )}

          {/* 2-Column Harmonized Workspace */}
          <div className="admin-categories-workspace">
            {/* Primary Left Column */}
            <div className="admin-categories-main-pane">
              <div className="categories-control-panel">
                <div className="categories-tab-group" role="tablist" aria-label="Category Types">
                  <button
                    className={`categories-tab-btn ${activeTab === "menu" ? "active" : ""}`}
                    onClick={() => setActiveTab("menu")}
                    role="tab"
                    aria-selected={activeTab === "menu"}
                  >
                    <UtensilsCrossed size={16} aria-hidden="true" />
                    <span>Menu Categories</span>
                    <span className="tab-pill-badge">{menuCategories.length}</span>
                  </button>

                  <button
                    className={`categories-tab-btn ${activeTab === "inventory" ? "active" : ""}`}
                    onClick={() => setActiveTab("inventory")}
                    role="tab"
                    aria-selected={activeTab === "inventory"}
                  >
                    <Package size={16} aria-hidden="true" />
                    <span>Inventory Categories</span>
                    <span className="tab-pill-badge">{inventoryCategories.length}</span>
                  </button>
                </div>

                <div className="categories-actions-group">
                  <div className="categories-search-box">
                    <Search size={16} className="search-icon" aria-hidden="true" />
                    <input
                      type="text"
                      placeholder={
                        activeTab === "menu"
                          ? "Search menu categories..."
                          : "Search inventory categories..."
                      }
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="categories-search-input"
                      aria-label={
                        activeTab === "menu"
                          ? "Search menu categories"
                          : "Search inventory categories"
                      }
                    />
                    {search && (
                      <button
                        type="button"
                        className="search-clear-btn"
                        onClick={() => setSearch("")}
                        aria-label="Clear search"
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className="categories-refresh-btn"
                    onClick={handleRefresh}
                    disabled={loading}
                    title="Refresh categories"
                    aria-label="Refresh categories"
                  >
                    <RefreshCw size={16} className={loading ? "spin" : ""} aria-hidden="true" />
                  </button>

                  <button type="button" className="categories-add-btn" onClick={openAddModal}>
                    <Plus size={16} aria-hidden="true" />
                    <span>Add {activeTab === "menu" ? "Menu Category" : "Inventory Category"}</span>
                  </button>
                </div>
              </div>

              {/* Categories Content Table */}
              <div className="categories-table-container">
                {activeTab === "menu" ? (
                  <div className="categories-table-wrap">
                    <table className="categories-table">
                      <thead>
                        <tr>
                          <th style={{ width: "80px" }}>Order</th>
                          <th>Category Name</th>
                          <th>Operational Logic</th>
                          <th>Description</th>
                          <th style={{ width: "130px" }}>Products</th>
                          <th style={{ width: "110px" }}>Status</th>
                          <th style={{ width: "120px", textAlign: "right" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMenuCategories.length === 0 ? (
                          <tr>
                            <td colSpan="7" className="categories-empty-cell">
                              <FolderTree size={32} className="empty-icon" aria-hidden="true" />
                              <p>No menu categories found matching “{search}”.</p>
                            </td>
                          </tr>
                        ) : (
                          filteredMenuCategories.map((cat) => {
                            const familyConfig =
                              OPERATIONAL_FAMILY_CONFIG[cat.operationalFamily] ||
                              OPERATIONAL_FAMILY_CONFIG.general;
                            const hasProducts = Number(cat.productCount || 0) > 0;
                            return (
                              <tr key={cat.id} className={!cat.isActive ? "row-inactive" : ""}>
                                <td>
                                  <span className="order-badge">#{cat.displayOrder}</span>
                                </td>
                                <td>
                                  <div className="category-name-cell">
                                    <span className="category-title">{cat.name}</span>
                                  </div>
                                </td>
                                <td>
                                  <span
                                    className={`family-badge ${familyConfig.badgeClass}`}
                                    title={familyConfig.desc}
                                  >
                                    {familyConfig.label}
                                  </span>
                                </td>
                                <td>
                                  <span className="category-desc">{cat.description || "—"}</span>
                                </td>
                                <td>
                                  <span
                                    className={`count-badge ${hasProducts ? "count-active" : "count-zero"}`}
                                  >
                                    {cat.productCount}{" "}
                                    {cat.productCount === 1 ? "product" : "products"}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className={`status-pill ${cat.isActive ? "status-active" : "status-disabled"}`}
                                  >
                                    {cat.isActive ? "Active" : "Inactive"}
                                  </span>
                                </td>
                                <td>
                                  <div className="category-action-buttons">
                                    <button
                                      type="button"
                                      className="action-btn edit-btn"
                                      onClick={() => openEditModal(cat, "menu")}
                                      title="Edit category"
                                      aria-label={`Edit ${cat.name} category`}
                                    >
                                      <Edit2 size={16} aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      className={`action-btn delete-btn ${hasProducts ? "btn-disabled" : ""}`}
                                      onClick={() => !hasProducts && promptDelete(cat, "menu")}
                                      disabled={hasProducts}
                                      aria-label={`Delete ${cat.name} category`}
                                      title={
                                        hasProducts
                                          ? `Cannot delete: ${cat.productCount} product(s) assigned`
                                          : `Delete ${cat.name} category`
                                      }
                                    >
                                      <Trash2 size={16} aria-hidden="true" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="categories-table-wrap">
                    <table className="categories-table">
                      <thead>
                        <tr>
                          <th style={{ width: "80px" }}>Order</th>
                          <th>Category Name</th>
                          <th>System Role</th>
                          <th>Description</th>
                          <th style={{ width: "130px" }}>Stock Items</th>
                          <th style={{ width: "110px" }}>Status</th>
                          <th style={{ width: "120px", textAlign: "right" }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredInventoryCategories.length === 0 ? (
                          <tr>
                            <td colSpan="7" className="categories-empty-cell">
                              <FolderTree size={32} className="empty-icon" aria-hidden="true" />
                              <p>No inventory categories found matching “{search}”.</p>
                            </td>
                          </tr>
                        ) : (
                          filteredInventoryCategories.map((cat) => {
                            const hasItems = Number(cat.itemCount || 0) > 0;
                            return (
                              <tr key={cat.id} className={!cat.isActive ? "row-inactive" : ""}>
                                <td>
                                  <span className="order-badge">#{cat.displayOrder}</span>
                                </td>
                                <td>
                                  <div className="category-name-cell">
                                    <span className="category-title">{cat.name}</span>
                                  </div>
                                </td>
                                <td>
                                  <div className="role-badge-group">
                                    {cat.isCupCategory && (
                                      <span
                                        className="family-badge badge-cup"
                                        title="Auto-synchronizes drink cup containers"
                                      >
                                        <Coffee size={12} aria-hidden="true" /> Cups Container
                                      </span>
                                    )}
                                    {!cat.isCupCategory && (
                                      <span className="family-badge badge-custom">Custom</span>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <span className="category-desc">{cat.description || "—"}</span>
                                </td>
                                <td>
                                  <span
                                    className={`count-badge ${hasItems ? "count-active" : "count-zero"}`}
                                  >
                                    {cat.itemCount} {cat.itemCount === 1 ? "item" : "items"}
                                  </span>
                                </td>
                                <td>
                                  <span
                                    className={`status-pill ${cat.isActive ? "status-active" : "status-disabled"}`}
                                  >
                                    {cat.isActive ? "Active" : "Inactive"}
                                  </span>
                                </td>
                                <td>
                                  <div className="category-action-buttons">
                                    <button
                                      type="button"
                                      className="action-btn edit-btn"
                                      onClick={() => openEditModal(cat, "inventory")}
                                      title="Edit category"
                                      aria-label={`Edit ${cat.name} category`}
                                    >
                                      <Edit2 size={16} aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      className="action-btn delete-btn"
                                      onClick={() => promptDelete(cat, "inventory")}
                                      aria-label={`Delete ${cat.name} category`}
                                      title={
                                        hasItems
                                          ? `${cat.itemCount} item(s) assigned. Click to reassign & delete.`
                                          : `Delete ${cat.name} category`
                                      }
                                    >
                                      <Trash2 size={16} aria-hidden="true" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Sticky Side-Rail */}
            <aside className="admin-categories-side-rail" aria-label="Catalog statistics and shortcuts">
              {/* Stat Card 1: Menu Categories */}
              <div className="side-rail-card">
                <div className="side-rail-card-head">
                  <div className="side-rail-icon icon-menu">
                    <UtensilsCrossed size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <span className="side-rail-eyebrow">STORE CATALOG</span>
                    <h4>Menu Categories</h4>
                  </div>
                </div>
                <div className="side-rail-metric">
                  <span className="side-rail-num">{totals.menuCount}</span>
                  <span className="side-rail-meta">{totals.totalProducts} active products mapped</span>
                </div>
                <p className="side-rail-desc">
                  Categories define POS ordering screens, recipe scaling, and beverage cup logic.
                </p>
              </div>

              {/* Stat Card 2: Inventory Commodities */}
              <div className="side-rail-card">
                <div className="side-rail-card-head">
                  <div className="side-rail-icon icon-inventory">
                    <Package size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <span className="side-rail-eyebrow">WAREHOUSE STOCK</span>
                    <h4>Inventory Groups</h4>
                  </div>
                </div>
                <div className="side-rail-metric">
                  <span className="side-rail-num">{totals.invCount}</span>
                  <span className="side-rail-meta">{totals.totalItems} commodities classified</span>
                </div>
                <p className="side-rail-desc">
                  Groups raw ingredients, consumables, packaging, and cups for inventory audits.
                </p>
              </div>

              {/* Stat Card 3: Relational Integrity & Packaging */}
              <div className="side-rail-card side-rail-card-accent">
                <div className="side-rail-card-head">
                  <div className="side-rail-icon icon-relational">
                    <Layers size={18} aria-hidden="true" />
                  </div>
                  <div>
                    <span className="side-rail-eyebrow">DATA SAFETY</span>
                    <h4>Relational Integrity</h4>
                  </div>
                </div>
                <div className="side-rail-metric">
                  <span className="side-rail-num side-rail-success">100% Active</span>
                  <span className="side-rail-meta">Cascade protection active</span>
                </div>
                <div className="side-rail-badge-list">
                  <div className="side-rail-badge-item">
                    <Coffee size={14} aria-hidden="true" />
                    <span>{totals.cupCount} Cup packaging groups</span>
                  </div>
                  <div className="side-rail-badge-item">
                    <CheckCircle2 size={14} aria-hidden="true" />
                    <span>Zero orphan product safeguards</span>
                  </div>
                </div>
              </div>

              {/* Quick Add CTA Card */}
              <div className="side-rail-card side-rail-cta-card">
                <h4>Need another category?</h4>
                <p>Define operational rules and structure before assigning catalog items.</p>
                <button
                  type="button"
                  className="side-rail-cta-btn"
                  onClick={openAddModal}
                >
                  <Plus size={16} aria-hidden="true" />
                  <span>New {activeTab === "menu" ? "Menu Category" : "Inventory Category"}</span>
                </button>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {/* Add / Edit Category Modal */}
      {modalState.isOpen && (
        <div className="categories-modal-overlay" role="dialog" aria-modal="true">
          <div className="categories-modal-card">
            <div className="categories-modal-header">
              <div className="modal-header-title">
                <h3>
                  {modalState.mode === "create" ? "Add New Category" : "Edit Category"}
                </h3>
                <span className="modal-header-sub">
                  Target: {modalState.tab === "menu" ? "Menu Products" : "Warehouse Inventory"}
                </span>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
                aria-label="Close modal"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="categories-modal-form">
              <div className="form-group">
                <label className="form-label" htmlFor="cat-name-input">Category Name *</label>
                <input
                  id="cat-name-input"
                  type="text"
                  required
                  placeholder="e.g. Signature Coffee, Artisan Teas"
                  value={modalState.name}
                  onChange={(e) => setModalState({ ...modalState, name: e.target.value })}
                  className="form-input"
                  maxLength={100}
                />
              </div>

              {modalState.tab === "menu" ? (
                <div className="form-group">
                  <label className="form-label" htmlFor="operational-family-select">Operational Logic Family</label>
                  <select
                    id="operational-family-select"
                    value={modalState.operationalFamily}
                    onChange={(e) => setModalState({ ...modalState, operationalFamily: e.target.value })}
                    className="form-select"
                  >
                    <option value="drink">Beverage Workflow (Drink sizes: 16oz/22oz & Cups generator)</option>
                    <option value="fries">Weighed Mass (Fries: Regular, Medium, Large tiers)</option>
                    <option value="snack_pieces">Discrete Pieces (Snacks: 4s, 6s, 12s piece counts)</option>
                    <option value="single_fixed">Single Fixed Price (Burgers, Hotdogs, Fixed foods)</option>
                    <option value="general">Standard Item (General catalog behavior)</option>
                  </select>
                  <span className="form-hint">
                    {OPERATIONAL_FAMILY_CONFIG[modalState.operationalFamily]?.desc}
                  </span>
                </div>
              ) : (
                <div className="form-group-checkbox">
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={modalState.isCupCategory}
                      onChange={(e) => setModalState({ ...modalState, isCupCategory: e.target.checked })}
                    />
                    <span className="checkbox-label">Contains Beverage Cup Packaging (Auto-deducted by POS)</span>
                  </label>
                  <span className="form-hint">
                    Identifies items in this category as cups (16oz, 22oz) for automatic inventory deduction at POS checkout.
                  </span>
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="cat-desc-input">Description</label>
                <textarea
                  id="cat-desc-input"
                  rows={3}
                  placeholder="Optional brief description of what belongs in this category..."
                  value={modalState.description}
                  onChange={(e) => setModalState({ ...modalState, description: e.target.value })}
                  className="form-textarea"
                  maxLength={500}
                />
              </div>

              <div className="form-row">
                <div className="form-group form-col">
                  <label className="form-label" htmlFor="cat-display-order">Display Order</label>
                  <input
                    id="cat-display-order"
                    type="number"
                    min={0}
                    value={modalState.displayOrder}
                    onChange={(e) => setModalState({ ...modalState, displayOrder: e.target.value })}
                    className="form-input"
                  />
                  <span className="form-hint">Lower numbers appear first in tabs.</span>
                </div>

                <div className="form-group form-col form-col-checkbox">
                  <label className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={modalState.isActive}
                      onChange={(e) => setModalState({ ...modalState, isActive: e.target.checked })}
                    />
                    <span className="checkbox-label">Active / Visible</span>
                  </label>
                  <span className="form-hint">Inactive categories are hidden from staff tabs.</span>
                </div>
              </div>

              <div className="categories-modal-footer">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-save" disabled={loading}>
                  {loading ? "Saving..." : modalState.mode === "create" ? "Create Category" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.isOpen && (
        <div className="categories-modal-overlay" role="dialog" aria-modal="true">
          <div className="categories-modal-card delete-confirm-card">
            <div className="delete-confirm-header">
              <div className="delete-icon-box">
                <AlertTriangle size={24} aria-hidden="true" />
              </div>
              <h3>Confirm Category Deletion</h3>
            </div>
            <div className="delete-confirm-body">
              <p>
                Are you sure you want to delete the category{" "}
                <strong>“{deleteModal.name}”</strong>?
              </p>
              {deleteModal.count > 0 && deleteModal.tab === "inventory" ? (
                <div style={{ marginTop: "14px", padding: "12px", background: "#fef3c7", borderRadius: "8px", border: "1px solid #fde68a", textAlign: "left" }}>
                  <p style={{ margin: "0 0 8px 0", color: "#92400e", fontSize: "0.88rem", fontWeight: 600 }}>
                    ⚠️ {deleteModal.count} inventory item(s) are currently in this category. Reassign them before deleting:
                  </p>
                  <select
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "6px", border: "1px solid #d97706", fontSize: "0.88rem", background: "#ffffff" }}
                    value={deleteModal.reassignTargetId || ""}
                    onChange={(e) => setDeleteModal((prev) => ({ ...prev, reassignTargetId: e.target.value }))}
                  >
                    <option value="">-- Select Destination Category --</option>
                    {inventoryCategories
                      .filter((c) => c.id !== deleteModal.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              ) : (
                <p className="delete-warning-note">
                  This action is permanent and will remove the category from the database.
                </p>
              )}
            </div>
            <div className="delete-confirm-footer">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setDeleteModal({ isOpen: false, tab: "menu", id: null, name: "", count: 0, isSystem: false, reassignTargetId: "" })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-delete-confirm"
                onClick={confirmDelete}
                disabled={loading || (deleteModal.count > 0 && deleteModal.tab === "inventory" && !deleteModal.reassignTargetId)}
              >
                {loading
                  ? "Deleting..."
                  : deleteModal.count > 0 && deleteModal.tab === "inventory"
                    ? "Reassign & Delete"
                    : "Delete Permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
