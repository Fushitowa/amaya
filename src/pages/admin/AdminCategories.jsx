import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Coffee,
  Cookie,
  Edit2,
  FolderTree,
  Layers,
  Package,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Sliders,
  Tag,
  Tags,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import { useInventory } from "../../context/InventoryContext.jsx";

import "./AdminCategories.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const OPERATIONAL_FAMILY_CONFIG = {
  drink: {
    label: "Beverage Workflow",
    shortLabel: "Beverage",
    badgeClass: "badge-family-drink",
    Icon: Coffee,
    desc: "Uses volumetric liquid/powder recipes, cup-size isolation, dynamic modifiers, and scarcest-ingredient stock bounding.",
  },
  fries: {
    label: "Weighed Mass (Fries)",
    shortLabel: "Weighted",
    badgeClass: "badge-family-fries",
    Icon: Scale,
    desc: "Uses gram-based weight tiers (Regular/Large/Jumbo), seasoning powders, oil absorption, and paper cones.",
  },
  snack_pieces: {
    label: "Discrete Pieces (Snacks)",
    shortLabel: "Pieces",
    badgeClass: "badge-family-snack",
    Icon: Cookie,
    desc: "Uses piece counts (4s/6s/12s), bamboo skewers/paper boats, and dipping sauce portions.",
  },
  single_fixed: {
    label: "Single Fixed Price",
    shortLabel: "Fixed Price",
    badgeClass: "badge-family-fixed",
    Icon: Tag,
    desc: "Fixed assembly units sold without size dropdowns (burgers, hotdogs, single treats).",
  },
  general: {
    label: "Standard Item",
    shortLabel: "Standard",
    badgeClass: "badge-family-general",
    Icon: FolderTree,
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
    reassignAndDeleteCategory: reassignAndDeleteMenuCategory,
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
  const [familyFilter, setFamilyFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all"); // "all" | "cups" | "custom"
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState({ type: "", message: "" });
  const noticeTimerRef = useRef(null);

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

  // Keyboard accessibility: Escape key to close modals + clean up notice timeout
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setModalState((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
        setDeleteModal((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  const showNotice = (type, message) => {
    setNotice({ type, message });
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = setTimeout(() => {
      setNotice({ type: "", message: "" });
    }, 4500);
  };

  const handleTabSwitch = (nextTab) => {
    setActiveTab(nextTab);
    setFamilyFilter("all");
    setRoleFilter("all");
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
      const fam = cat.operationalFamily || "general";
      if (familyFilter !== "all" && fam !== familyFilter) return false;
      if (!query) return true;
      return (
        String(cat.name || "").toLowerCase().includes(query) ||
        String(cat.description || "").toLowerCase().includes(query) ||
        String(cat.operationalFamily || "").toLowerCase().includes(query)
      );
    });
  }, [menuCategories, search, familyFilter]);

  const filteredInventoryCategories = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (inventoryCategories || []).filter((cat) => {
      if (roleFilter === "cups" && !cat.isCupCategory) return false;
      if (roleFilter === "custom" && cat.isCupCategory) return false;
      if (!query) return true;
      return (
        String(cat.name || "").toLowerCase().includes(query) ||
        String(cat.description || "").toLowerCase().includes(query)
      );
    });
  }, [inventoryCategories, search, roleFilter]);

  // Totals & family breakdown
  const totals = useMemo(() => {
    const menuCount = menuCategories.length;
    const invCount = inventoryCategories.length;
    const activeMenuCount = menuCategories.filter((c) => c.isActive !== false).length;
    const activeInvCount = inventoryCategories.filter((c) => c.isActive !== false).length;
    const totalProducts = menuCategories.reduce((acc, c) => acc + Number(c.productCount || 0), 0);
    const totalItems = inventoryCategories.reduce((acc, c) => acc + Number(c.itemCount || 0), 0);
    const cupCount = inventoryCategories.filter((c) => Boolean(c.isCupCategory)).length;
    const totalAll = menuCount + invCount;
    const menuShare = totalAll > 0 ? menuCount / totalAll : 0.5;
    return {
      menuCount,
      invCount,
      activeMenuCount,
      activeInvCount,
      totalProducts,
      totalItems,
      cupCount,
      totalAll,
      menuShare,
    };
  }, [menuCategories, inventoryCategories]);

  const menuFamilyCounts = useMemo(() => {
    const counts = { all: menuCategories.length };
    Object.keys(OPERATIONAL_FAMILY_CONFIG).forEach((key) => {
      counts[key] = 0;
    });
    menuCategories.forEach((cat) => {
      const fam = cat.operationalFamily || "general";
      counts[fam] = (counts[fam] || 0) + 1;
    });
    return counts;
  }, [menuCategories]);

  const activeList = activeTab === "menu" ? filteredMenuCategories : filteredInventoryCategories;
  const rawActiveTotal = activeTab === "menu" ? menuCategories.length : inventoryCategories.length;
  const activeShownCount = activeList.length;
  const activeTabLiveCount = activeList.filter((c) => c.isActive !== false).length;
  const activeTabHiddenCount = activeList.length - activeTabLiveCount;
  const hasActiveFilter =
    Boolean(search.trim()) ||
    (activeTab === "menu" ? familyFilter !== "all" : roleFilter !== "all");

  const listRef = useRef(null);
  const [scrollCue, setScrollCue] = useState({
    canUp: false,
    canDown: false,
    isScrollable: false,
  });

  const updateScrollCue = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const isScrollable = el.scrollHeight - el.clientHeight > 6;
    const canUp = el.scrollTop > 8;
    const canDown = el.scrollHeight - el.clientHeight - el.scrollTop > 8;
    setScrollCue((prev) =>
      prev.canUp === canUp && prev.canDown === canDown && prev.isScrollable === isScrollable
        ? prev
        : { canUp, canDown, isScrollable }
    );
  }, []);

  useEffect(() => {
    const el = listRef.current;
    const frameId = requestAnimationFrame(updateScrollCue);
    let observer = null;
    if (el && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(updateScrollCue);
      observer.observe(el);
    }
    window.addEventListener("resize", updateScrollCue);
    return () => {
      cancelAnimationFrame(frameId);
      if (observer) observer.disconnect();
      window.removeEventListener("resize", updateScrollCue);
    };
  }, [activeTab, familyFilter, roleFilter, activeShownCount, search, updateScrollCue]);

  const handleScrollMore = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollBy({
      top: Math.max(200, Math.round(el.clientHeight * 0.65)),
      behavior: "smooth",
    });
  };

  // Open Add Modal (supports optional preset workflow/role overrides)
  const openAddModal = (overrides = {}) => {
    const preset = overrides && !overrides.nativeEvent ? overrides : {};
    const targetTab = preset.tab || activeTab;
    const highestOrder =
      targetTab === "menu"
        ? Math.max(0, ...(menuCategories || []).map((c) => Number(c.displayOrder || 0))) + 1
        : Math.max(0, ...(inventoryCategories || []).map((c) => Number(c.displayOrder || 0))) + 1;

    setModalState({
      isOpen: true,
      mode: "create",
      tab: targetTab,
      id: null,
      name: "",
      description: "",
      operationalFamily: preset.operationalFamily || "general",
      isCupCategory: Boolean(preset.isCupCategory),
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
          showNotice("success", `Menu category "${payload.name}" created successfully.`);
        } else {
          await updateMenuCategory(modalState.id, payload);
          showNotice("success", `Menu category "${payload.name}" updated successfully.`);
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
          showNotice("success", `Inventory category "${payload.name}" created successfully.`);
        } else {
          await updateInventoryCategory(modalState.id, payload);
          showNotice("success", `Inventory category "${payload.name}" updated successfully.`);
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
    const activeCount = tab === "menu" ? Number(item.productCount || 0) : Number(item.itemCount || 0);
    const archivedCount = tab === "menu" ? Number(item.archivedProductCount || 0) : Number(item.archivedItemCount || 0);
    const totalCount = Number(item.totalCount ?? (activeCount + archivedCount));
    setDeleteModal({
      isOpen: true,
      tab,
      id: item.id,
      name: item.name,
      count: totalCount,
      archivedCount,
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
        if (deleteModal.count > 0 && deleteModal.reassignTargetId) {
          await reassignAndDeleteMenuCategory(deleteModal.id, Number(deleteModal.reassignTargetId));
          showNotice("success", `Menu category "${deleteModal.name}" deleted and items reassigned.`);
        } else {
          await deleteMenuCategory(deleteModal.id);
          showNotice("success", `Menu category "${deleteModal.name}" deleted.`);
        }
      } else {
        if (deleteModal.count > 0 && deleteModal.reassignTargetId) {
          await reassignAndDeleteCategory(deleteModal.id, Number(deleteModal.reassignTargetId));
          showNotice("success", `Inventory category "${deleteModal.name}" deleted and items reassigned.`);
        } else {
          await deleteInventoryCategory(deleteModal.id);
          showNotice("success", `Inventory category "${deleteModal.name}" deleted.`);
        }
      }
      setDeleteModal({
        isOpen: false,
        tab: "menu",
        id: null,
        name: "",
        count: 0,
        isSystem: false,
        reassignTargetId: "",
      });
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
        {/* Canonical Brass & Espresso Top Header */}
        <header className="admin-categories-topbar">
          <div className="admin-categories-topbar-brand">
            <span className="admin-categories-topbar-crest" aria-hidden="true">
              <Tags size={20} strokeWidth={2} />
            </span>
            <div className="admin-categories-head-main">
              <div className="admin-categories-topbar-eyebrow">
                <span className="admin-categories-eyebrow">CATALOG ARCHITECTURE</span>
                <span className="admin-categories-live-pill">
                  <span className="categories-live-dot" aria-hidden="true" />
                  {totals.activeMenuCount + totals.activeInvCount} of {totals.totalAll} Active
                </span>
              </div>
              <h1>Category Management</h1>
              <p>Configure operational logic, menu workflows, and warehouse classification.</p>
            </div>
          </div>

          <div className="admin-categories-topbar-actions">
            <span className="admin-categories-status-chip" role="status">
              <Coffee size={13} strokeWidth={2.2} aria-hidden="true" />
              <span>
                {totals.cupCount} cup {totals.cupCount === 1 ? "group" : "groups"} mapped
              </span>
            </span>
            <Link to="/admin/menu" className="admin-categories-menu-link">
              <span>Menu Board</span>
              <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden="true" />
            </Link>
            <Link to="/admin/inventory" className="admin-categories-topbar-add">
              <span>Inventory Board</span>
              <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden="true" />
            </Link>
          </div>
        </header>

        <div className="admin-categories-content">
          {/* Notice Alert */}
          {notice.message && (
            <div
              className={`categories-notice ${notice.type === "success" ? "notice-success" : "notice-error"}`}
              role={notice.type === "error" ? "alert" : "status"}
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
            {/* Primary Left Column: Brass-Tabbed Catalog Index Cabinet */}
            <div className="admin-categories-main-pane">
              <section className="categories-cabinet" aria-label="Catalog index cabinet">
                {/* Walnut Drawer Crown with Stepped Divider Tabs */}
                <div className="categories-cabinet-crown">
                  <div className="categories-tab-group" role="tablist" aria-label="Category Types">
                    <button
                      type="button"
                      className={`categories-tab-btn ${activeTab === "menu" ? "active" : ""}`}
                      onClick={() => handleTabSwitch("menu")}
                      role="tab"
                      aria-selected={activeTab === "menu"}
                    >
                      <UtensilsCrossed size={15} strokeWidth={2.1} aria-hidden="true" />
                      <span>Menu Categories</span>
                      <span className="tab-pill-badge">{menuCategories.length}</span>
                    </button>

                    <button
                      type="button"
                      className={`categories-tab-btn ${activeTab === "inventory" ? "active" : ""}`}
                      onClick={() => handleTabSwitch("inventory")}
                      role="tab"
                      aria-selected={activeTab === "inventory"}
                    >
                      <Package size={15} strokeWidth={2.1} aria-hidden="true" />
                      <span>Inventory Categories</span>
                      <span className="tab-pill-badge">{inventoryCategories.length}</span>
                    </button>
                  </div>

                  <div className="categories-cabinet-seal" aria-hidden="true">
                    <Layers size={12} strokeWidth={2.2} />
                    <span>{activeTab === "menu" ? "POS WORKFLOWS" : "WAREHOUSE GROUPS"}</span>
                  </div>
                </div>

                {/* Seamless Parchment Command Strip */}
                <div className="categories-control-panel">
                  <div className="categories-search-box">
                    <Search size={15} className="search-icon" aria-hidden="true" />
                    <input
                      type="text"
                      placeholder={
                        activeTab === "menu"
                          ? "Search menu categories or workflow..."
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
                        <X size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="categories-actions-group">
                    <span className="categories-tally-chip">
                      <strong>{activeShownCount}</strong> of {rawActiveTotal} shown
                    </span>

                    <button
                      type="button"
                      className="categories-refresh-btn"
                      onClick={handleRefresh}
                      disabled={loading}
                      title="Refresh categories"
                      aria-label="Refresh categories"
                    >
                      <RefreshCw size={15} className={loading ? "spin" : ""} aria-hidden="true" />
                    </button>

                    <button type="button" className="categories-add-btn" onClick={openAddModal}>
                      <Plus size={15} strokeWidth={2.3} aria-hidden="true" />
                      <span>Add {activeTab === "menu" ? "Menu" : "Inventory"} Category</span>
                    </button>
                  </div>
                </div>

                {/* Operational Family / System Role Quick Filter Rail */}
                <div className="categories-schema-strip">
                  <span className="categories-schema-label">
                    <Sliders size={12} strokeWidth={2.2} aria-hidden="true" />
                    <span>{activeTab === "menu" ? "Workflow:" : "Role:"}</span>
                  </span>

                  {activeTab === "menu" ? (
                    <div className="categories-filter-pills" role="group" aria-label="Filter by operational workflow">
                      <button
                        type="button"
                        className={`schema-filter-pill ${familyFilter === "all" ? "is-selected" : ""}`}
                        onClick={() => setFamilyFilter("all")}
                        aria-pressed={familyFilter === "all"}
                      >
                        <span>All</span>
                        <em>{menuFamilyCounts.all}</em>
                      </button>
                      {Object.entries(OPERATIONAL_FAMILY_CONFIG).map(([key, cfg]) => (
                        <button
                          key={key}
                          type="button"
                          className={`schema-filter-pill ${familyFilter === key ? "is-selected" : ""}`}
                          onClick={() => setFamilyFilter(key)}
                          aria-pressed={familyFilter === key}
                          title={cfg.desc}
                        >
                          <span>{cfg.shortLabel}</span>
                          <em>{menuFamilyCounts[key] || 0}</em>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="categories-filter-pills" role="group" aria-label="Filter by inventory role">
                      <button
                        type="button"
                        className={`schema-filter-pill ${roleFilter === "all" ? "is-selected" : ""}`}
                        onClick={() => setRoleFilter("all")}
                        aria-pressed={roleFilter === "all"}
                      >
                        <span>All Groups</span>
                        <em>{inventoryCategories.length}</em>
                      </button>
                      <button
                        type="button"
                        className={`schema-filter-pill ${roleFilter === "cups" ? "is-selected" : ""}`}
                        onClick={() => setRoleFilter("cups")}
                        aria-pressed={roleFilter === "cups"}
                      >
                        <span>Cup Packaging</span>
                        <em>{totals.cupCount}</em>
                      </button>
                      <button
                        type="button"
                        className={`schema-filter-pill ${roleFilter === "custom" ? "is-selected" : ""}`}
                        onClick={() => setRoleFilter("custom")}
                        aria-pressed={roleFilter === "custom"}
                      >
                        <span>Custom Groups</span>
                        <em>{Math.max(0, inventoryCategories.length - totals.cupCount)}</em>
                      </button>
                    </div>
                  )}
                </div>

                {/* Archival Index Slips Canvas */}
                <div className="categories-index-canvas">
                  <div className="categories-index-cols-head" aria-hidden="true">
                    <span>Index</span>
                    <span>Category &amp; Notes</span>
                    <span>{activeTab === "menu" ? "Operational Logic" : "System Role"}</span>
                    <span>{activeTab === "menu" ? "Products" : "Stock Items"}</span>
                    <span>Status</span>
                    <span className="cols-head-right">Actions</span>
                  </div>

                  <div
                    className={`categories-index-list-frame ${scrollCue.canUp ? "has-scroll-up" : ""} ${scrollCue.canDown ? "has-scroll-down" : ""}`}
                  >
                    <div
                      ref={listRef}
                      onScroll={updateScrollCue}
                      className="categories-index-list custom-categories-scrollbar"
                      key={`${activeTab}-${familyFilter}-${roleFilter}`}
                      tabIndex={0}
                      aria-label={activeTab === "menu" ? "Menu categories list" : "Inventory categories list"}
                    >
                    {activeTab === "menu" ? (
                      filteredMenuCategories.length === 0 ? (
                        <div className="categories-empty-state">
                          <span className="categories-empty-medallion" aria-hidden="true">
                            <FolderTree size={24} strokeWidth={1.8} />
                          </span>
                          <h4>No menu categories match this filter</h4>
                          <p>
                            {search.trim()
                              ? `No menu categories found matching "${search}".`
                              : "Try clearing the workflow filter or add a new menu category."}
                          </p>
                          {hasActiveFilter ? (
                            <button
                              type="button"
                              className="categories-empty-reset"
                              onClick={() => {
                                setSearch("");
                                setFamilyFilter("all");
                              }}
                            >
                              Clear search &amp; filters
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="categories-empty-reset"
                              onClick={() => openAddModal()}
                            >
                              Create Menu Category
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          {filteredMenuCategories.map((cat, idx) => {
                            const familyConfig =
                              OPERATIONAL_FAMILY_CONFIG[cat.operationalFamily] ||
                              OPERATIONAL_FAMILY_CONFIG.general;
                            const FamilyIcon = familyConfig.Icon;
                            const productCount = Number(cat.productCount || 0);
                            const hasProducts = productCount > 0;
                            return (
                              <article
                                key={cat.id}
                                className={`category-index-slip ${cat.isActive === false ? "row-inactive" : ""}`}
                                style={{ "--slip-index": Math.min(idx, 9) }}
                              >
                                <div className="category-slip-spine">
                                  <span className="order-badge">#{cat.displayOrder}</span>
                                </div>

                                <div className="category-slip-identity">
                                  <div className="category-name-cell">
                                    <h3 className="category-title">{cat.name}</h3>
                                  </div>
                                  <p className={`category-desc ${!cat.description ? "is-empty-desc" : ""}`}>
                                    {cat.description || "No description notes added."}
                                  </p>
                                </div>

                                <div className="category-slip-workflow">
                                  <span
                                    className={`family-badge ${familyConfig.badgeClass}`}
                                    title={familyConfig.desc}
                                  >
                                    <FamilyIcon size={12} strokeWidth={2.2} aria-hidden="true" />
                                    <span>{familyConfig.label}</span>
                                  </span>
                                </div>

                                <div className="category-slip-count">
                                  <span
                                    className={`count-badge ${hasProducts ? "count-active" : "count-zero"}`}
                                  >
                                    {productCount} {productCount === 1 ? "product" : "products"}
                                  </span>
                                </div>

                                <div className="category-slip-status">
                                  <span
                                    className={`status-pill ${cat.isActive !== false ? "status-active" : "status-disabled"}`}
                                  >
                                    <span className="status-dot" aria-hidden="true" />
                                    <span>{cat.isActive !== false ? "Active" : "Inactive"}</span>
                                  </span>
                                </div>

                                <div className="category-slip-actions category-action-buttons">
                                  <button
                                    type="button"
                                    className="action-btn edit-btn"
                                    onClick={() => openEditModal(cat, "menu")}
                                    title="Edit category"
                                    aria-label={`Edit ${cat.name} category`}
                                  >
                                    <Edit2 size={15} aria-hidden="true" />
                                  </button>
                                  <button
                                    type="button"
                                    className={`action-btn delete-btn ${hasProducts ? "btn-disabled" : ""}`}
                                    onClick={() => !hasProducts && promptDelete(cat, "menu")}
                                    disabled={hasProducts}
                                    aria-label={`Delete ${cat.name} category`}
                                    title={
                                      hasProducts
                                        ? `Cannot delete: ${productCount} product(s) assigned`
                                        : `Delete ${cat.name} category`
                                    }
                                  >
                                    <Trash2 size={15} aria-hidden="true" />
                                  </button>
                                </div>
                              </article>
                            );
                          })}
                        </>
                      )
                    ) : filteredInventoryCategories.length === 0 ? (
                      <div className="categories-empty-state">
                        <span className="categories-empty-medallion" aria-hidden="true">
                          <FolderTree size={24} strokeWidth={1.8} />
                        </span>
                        <h4>No inventory groups match this filter</h4>
                        <p>
                          {search.trim()
                            ? `No inventory categories found matching "${search}".`
                            : "Try resetting the role filter or add a new warehouse classification."}
                        </p>
                        {hasActiveFilter ? (
                          <button
                            type="button"
                            className="categories-empty-reset"
                            onClick={() => {
                              setSearch("");
                              setRoleFilter("all");
                            }}
                          >
                            Clear search &amp; filters
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="categories-empty-reset"
                            onClick={() => openAddModal()}
                          >
                            Create Inventory Category
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        {filteredInventoryCategories.map((cat, idx) => {
                          const itemCount = Number(cat.itemCount || 0);
                          const hasItems = itemCount > 0;
                          return (
                            <article
                              key={cat.id}
                              className={`category-index-slip ${cat.isActive === false ? "row-inactive" : ""}`}
                              style={{ "--slip-index": Math.min(idx, 9) }}
                            >
                              <div className="category-slip-spine">
                                <span className="order-badge">#{cat.displayOrder}</span>
                              </div>

                              <div className="category-slip-identity">
                                <div className="category-name-cell">
                                  <h3 className="category-title">{cat.name}</h3>
                                </div>
                                <p className={`category-desc ${!cat.description ? "is-empty-desc" : ""}`}>
                                  {cat.description || "No warehouse classification notes added."}
                                </p>
                              </div>

                              <div className="category-slip-workflow">
                                <div className="role-badge-group">
                                  {cat.isCupCategory ? (
                                    <span
                                      className="family-badge badge-cup"
                                      title="Auto-synchronizes drink cup containers"
                                    >
                                      <Coffee size={12} strokeWidth={2.2} aria-hidden="true" />
                                      <span>Cups Container</span>
                                    </span>
                                  ) : (
                                    <span className="family-badge badge-custom">
                                      <Package size={12} strokeWidth={2} aria-hidden="true" />
                                      <span>Custom</span>
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="category-slip-count">
                                <span
                                  className={`count-badge ${hasItems ? "count-active" : "count-zero"}`}
                                >
                                  {itemCount} {itemCount === 1 ? "item" : "items"}
                                </span>
                              </div>

                              <div className="category-slip-status">
                                <span
                                  className={`status-pill ${cat.isActive !== false ? "status-active" : "status-disabled"}`}
                                >
                                  <span className="status-dot" aria-hidden="true" />
                                  <span>{cat.isActive !== false ? "Active" : "Inactive"}</span>
                                </span>
                              </div>

                              <div className="category-slip-actions category-action-buttons">
                                <button
                                  type="button"
                                  className="action-btn edit-btn"
                                  onClick={() => openEditModal(cat, "inventory")}
                                  title="Edit category"
                                  aria-label={`Edit ${cat.name} category`}
                                >
                                  <Edit2 size={15} aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  className="action-btn delete-btn"
                                  onClick={() => promptDelete(cat, "inventory")}
                                  aria-label={`Delete ${cat.name} category`}
                                  title={
                                    hasItems
                                      ? `${itemCount} item(s) assigned. Click to reassign & delete.`
                                      : `Delete ${cat.name} category`
                                  }
                                >
                                  <Trash2 size={15} aria-hidden="true" />
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </>
                    )}
                    </div>

                    {scrollCue.canDown && (
                      <button
                        type="button"
                        className="categories-scroll-more-pill"
                        onClick={handleScrollMore}
                        aria-label="Scroll down to view more categories"
                      >
                        <span>Scroll for more</span>
                        <ChevronDown size={13} strokeWidth={2.4} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Cabinet Lower Molded Footer Trim */}
                <div className="categories-cabinet-footer">
                  <span className="cabinet-footer-note">
                    <ShieldCheck size={14} strokeWidth={2.1} aria-hidden="true" />
                    <span>Display order sequences tabs across Staff POS and Admin views</span>
                  </span>
                  <span className="cabinet-footer-summary">
                    {activeTabLiveCount} active
                    {activeTabHiddenCount > 0 ? ` · ${activeTabHiddenCount} inactive` : ""}
                    {scrollCue.isScrollable ? " · Scroll list" : ""}
                  </span>
                </div>
              </section>
            </div>

            {/* Right Column: Sticky Architect Summary Dossier */}
            <aside className="admin-categories-side-rail" aria-label="Catalog statistics and shortcuts">
              {/* Card 1: Interactive Catalog Split Overview */}
              <div className="side-rail-card side-rail-dossier-card">
                <div className="side-rail-dossier-head">
                  <span className="side-rail-eyebrow">CATALOG INDEX</span>
                  <h4>Schema Overview</h4>
                </div>

                <div className="side-rail-split-list">
                  <button
                    type="button"
                    className={`side-rail-split-item ${activeTab === "menu" ? "is-current" : ""}`}
                    onClick={() => handleTabSwitch("menu")}
                  >
                    <div className="side-rail-icon icon-menu">
                      <UtensilsCrossed size={17} aria-hidden="true" />
                    </div>
                    <div className="side-rail-split-copy">
                      <strong>Menu Categories</strong>
                      <span>{totals.totalProducts} mapped products</span>
                    </div>
                    <span className="side-rail-split-num">{totals.menuCount}</span>
                  </button>

                  <button
                    type="button"
                    className={`side-rail-split-item ${activeTab === "inventory" ? "is-current" : ""}`}
                    onClick={() => handleTabSwitch("inventory")}
                  >
                    <div className="side-rail-icon icon-inventory">
                      <Package size={17} aria-hidden="true" />
                    </div>
                    <div className="side-rail-split-copy">
                      <strong>Inventory Groups</strong>
                      <span>{totals.totalItems} classified items</span>
                    </div>
                    <span className="side-rail-split-num">{totals.invCount}</span>
                  </button>
                </div>

                <div className="side-rail-ratio-wrap" aria-hidden="true">
                  <div className="side-rail-ratio-track">
                    <div
                      className="side-rail-ratio-fill"
                      style={{ transform: `scaleX(${totals.menuShare})` }}
                    />
                  </div>
                  <div className="side-rail-ratio-legend">
                    <span>Menu {totals.menuCount}</span>
                    <span>Inventory {totals.invCount}</span>
                  </div>
                </div>

                <p className="side-rail-desc">
                  Categories define POS ordering screens, recipe scaling, cup rules, and stock audits.
                </p>
              </div>

              {/* Card 2 (Menu Tab): Workflow Blueprints moved cleanly to Right Architect Rail */}
              {activeTab === "menu" && (
                <section className="side-rail-card categories-templates-deck" aria-label="Workflow Blueprints">
                  <div className="categories-templates-head">
                    <span className="side-rail-eyebrow">WORKFLOW BLUEPRINTS</span>
                    <h4>Quick POS Presets</h4>
                    <span className="categories-templates-hint">
                      Add a pre-configured menu category workflow
                    </span>
                  </div>
                  <div className="categories-templates-grid">
                    {Object.entries(OPERATIONAL_FAMILY_CONFIG)
                      .filter(([key]) => key !== "general")
                      .map(([key, cfg]) => {
                        const TplIcon = cfg.Icon;
                        const usedCount = menuFamilyCounts[key] || 0;
                        return (
                          <button
                            key={key}
                            type="button"
                            className="categories-template-card"
                            title={cfg.desc}
                            onClick={() => openAddModal({ tab: "menu", operationalFamily: key })}
                          >
                            <span className={`categories-template-icon ${cfg.badgeClass}`} aria-hidden="true">
                              <TplIcon size={14} strokeWidth={2.2} />
                            </span>
                            <div className="categories-template-copy">
                              <div className="categories-template-title-row">
                                <strong>{cfg.label}</strong>
                                <span className={`categories-template-tag ${usedCount > 0 ? "in-use" : ""}`}>
                                  {usedCount > 0 ? `${usedCount} mapped` : "Available"}
                                </span>
                              </div>
                              <p>{cfg.desc}</p>
                            </div>
                            <span className="categories-template-plus" aria-hidden="true">
                              <Plus size={14} strokeWidth={2.4} />
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </section>
              )}

              {/* Card 2: Quick Add CTA Card */}
              <div className="side-rail-card side-rail-cta-card">
                <span className="side-rail-cta-eyebrow">ARCHITECT ACTION</span>
                <h4>Need another category?</h4>
                <p>Define operational rules and structure before assigning catalog items.</p>
                <button
                  type="button"
                  className="side-rail-cta-btn"
                  onClick={openAddModal}
                >
                  <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                  <span>New {activeTab === "menu" ? "Menu Category" : "Inventory Category"}</span>
                </button>
              </div>
            </aside>
          </div>
        </div>
      </main>

      {/* Add / Edit Category Modal */}
      {modalState.isOpen && (
        <div
          className="categories-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="categories-modal-heading"
        >
          <div className="categories-modal-card">
            <div className="categories-modal-header">
              <div className="modal-header-title">
                <span className="modal-header-eyebrow">
                  {modalState.tab === "menu" ? "MENU CLASSIFICATION" : "WAREHOUSE CLASSIFICATION"}
                </span>
                <h3 id="categories-modal-heading">
                  {modalState.mode === "create" ? "Add New Category" : "Edit Category"}
                </h3>
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
                <label className="form-label" htmlFor="cat-name-input">
                  Category Name *
                </label>
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
                  <label className="form-label" htmlFor="operational-family-select">
                    Operational Logic Family
                  </label>
                  <select
                    id="operational-family-select"
                    value={modalState.operationalFamily}
                    onChange={(e) =>
                      setModalState({ ...modalState, operationalFamily: e.target.value })
                    }
                    className="form-select"
                  >
                    <option value="drink">
                      Beverage Workflow (Drink sizes with required cups from Inventory)
                    </option>
                    <option value="fries">
                      Weighed Mass (Fries: Regular, Medium, Large tiers)
                    </option>
                    <option value="snack_pieces">
                      Discrete Pieces (Snacks: 4s, 6s, 12s piece counts)
                    </option>
                    <option value="single_fixed">
                      Single Fixed Price (Burgers, Hotdogs, Fixed foods)
                    </option>
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
                      onChange={(e) =>
                        setModalState({ ...modalState, isCupCategory: e.target.checked })
                      }
                    />
                    <span className="checkbox-label">
                      Contains Beverage Cup Packaging (Auto-deducted by POS)
                    </span>
                  </label>
                  <span className="form-hint">
                    Identifies items in this category as drink cups (any size) for recipe assignment
                    and inventory deduction at POS checkout.
                  </span>
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="cat-desc-input">
                  Description
                </label>
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
                  <label className="form-label" htmlFor="cat-display-order">
                    Display Order
                  </label>
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
                  {loading
                    ? "Saving..."
                    : modalState.mode === "create"
                      ? "Create Category"
                      : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModal.isOpen && (
        <div
          className="categories-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="categories-delete-heading"
        >
          <div className="categories-modal-card delete-confirm-card">
            <div className="delete-confirm-header">
              <div className="delete-icon-box" aria-hidden="true">
                <AlertTriangle size={22} />
              </div>
              <h3 id="categories-delete-heading">Confirm Category Deletion</h3>
            </div>
            <div className="delete-confirm-body">
              <p>
                Are you sure you want to delete the category{" "}
                <strong>“{deleteModal.name}”</strong>?
              </p>
              {deleteModal.count > 0 ? (
                <div className="delete-reassign-box">
                  <p className="delete-reassign-title">
                    <AlertTriangle size={15} strokeWidth={2.2} aria-hidden="true" />
                    <span>
                      {deleteModal.count} {deleteModal.tab === "menu" ? "menu" : "inventory"} item(s)
                      {deleteModal.archivedCount > 0 ? ` (${deleteModal.archivedCount} archived)` : ""} are currently in this category.
                      Reassign them before deleting:
                    </span>
                  </p>
                  <select
                    className="delete-reassign-select"
                    value={deleteModal.reassignTargetId || ""}
                    onChange={(e) =>
                      setDeleteModal((prev) => ({ ...prev, reassignTargetId: e.target.value }))
                    }
                    aria-label="Destination category for reassignment"
                  >
                    <option value="">-- Select Destination Category --</option>
                    {(deleteModal.tab === "menu" ? menuCategories : inventoryCategories)
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
                onClick={() =>
                  setDeleteModal({
                    isOpen: false,
                    tab: "menu",
                    id: null,
                    name: "",
                    count: 0,
                    archivedCount: 0,
                    isSystem: false,
                    reassignTargetId: "",
                  })
                }
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-delete-confirm"
                onClick={confirmDelete}
                disabled={
                  loading ||
                  (deleteModal.count > 0 && !deleteModal.reassignTargetId)
                }
              >
                {loading
                  ? "Deleting..."
                  : deleteModal.count > 0
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
