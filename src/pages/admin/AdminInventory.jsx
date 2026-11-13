import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  Clock,
  FolderOpen,
  History,
  ImagePlus,
  LayoutGrid,
  List,
  Menu,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { getInventoryStatus, useInventory } from "../../context/InventoryContext.jsx";
import { useBusiness } from "../../context/BusinessContext.jsx";
import { apiRequest } from "../../utils/api.js";
import { formatUnitCost } from "../../utils/inventoryFormatting.js";
import { getStockHealth } from "../../utils/stockHealth.js";
import "../../assets/css/admin/AdminInventory.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const inventoryUnitGroups = [
  { label: "Weight", options: [["mg", "Milligrams (mg)"], ["g", "Grams (g)"], ["hg", "Hectograms (hg)"], ["kg", "Kilograms (kg)"], ["oz", "Ounces (oz)"], ["lb", "Pounds (lb)"]] },
  { label: "Volume", options: [["ml", "Milliliters (ml)"], ["cl", "Centiliters (cl)"], ["dl", "Deciliters (dl)"], ["l", "Liters (L)"], ["tsp", "Teaspoons (tsp)"], ["tbsp", "Tablespoons (tbsp)"], ["fl oz", "Fluid ounces (fl oz)"], ["cup", "Cups"], ["pt", "Pints (pt)"], ["qt", "Quarts (qt)"], ["gal", "Gallons (gal)"], ["cc", "Cubic centimeters (cc)"]] },
  { label: "Count", options: [["pcs", "Pieces (pcs)"], ["can", "Cans (can)"], ["pair", "Pairs"], ["dozen", "Dozen"]] },
];
const packageUnitOptions = ["pack", "box", "bag", "bottle", "can", "sack", "set", "tub", "jar", "carton"];

const INVENTORY_ADD_DRAFT_KEY = "amaya_admin_inventory_add_draft";

function createEmptyInventoryForm() {
  return {
    item: "",
    image: "",
    category: "",
    purchasePrice: "",
    packageQuantity: "1",
    packageUnit: "pack",
    contentsPerPackage: "",
    unit: "g",
    quantity: "",
    maximumStock: "",
  };
}

function loadInventoryAddDraft() {
  try {
    const saved = localStorage.getItem(INVENTORY_ADD_DRAFT_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        return { ...createEmptyInventoryForm(), ...parsed };
      }
    }
  } catch { /* ignore localStorage failures */ }
  return createEmptyInventoryForm();
}

function saveInventoryAddDraft(formValues) {
  try {
    const hasContent = Boolean(
      formValues.item || formValues.category || formValues.purchasePrice || (formValues.quantity && formValues.quantity !== "0") || formValues.image
    );
    if (hasContent) {
      try {
        localStorage.setItem(INVENTORY_ADD_DRAFT_KEY, JSON.stringify(formValues));
      } catch {
        // If image exceeds localStorage quota, safely drop image and preserve text fields
        const safeDraft = { ...formValues, image: "" };
        localStorage.setItem(INVENTORY_ADD_DRAFT_KEY, JSON.stringify(safeDraft));
      }
    } else {
      localStorage.removeItem(INVENTORY_ADD_DRAFT_KEY);
    }
  } catch { /* ignore localStorage failures */ }
}

function clearInventoryAddDraft() {
  try {
    localStorage.removeItem(INVENTORY_ADD_DRAFT_KEY);
  } catch { /* ignore localStorage failures */ }
}

const normalizeInventoryCategory = (cat) => cat || "Uncategorized";

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
    categoryNames = [],
    loading: inventoryLoading,
    error: inventoryError,
    refreshInventory,
    addInventoryItem,
    updateInventoryItem,
    removeInventoryItem,
    restockInventoryItem,
  } = useInventory() || {};
  const categories = (categoryNames && categoryNames.length) ? categoryNames : ["All"];
  const { businessSettings } = useBusiness() || {};
  const lowThreshold = businessSettings?.lowStockThresholdPercent ?? 40;
  const criticalThreshold = businessSettings?.criticalStockThresholdPercent ?? 20;
  const inventory = storedInventory || EMPTY_INVENTORY;
  const [activeCategory, setActiveCategory] = useState("All");
  const [viewMode, setViewMode] = useState("grid");
  const [sortBy, setSortBy] = useState("name");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [restockItem, setRestockItem] = useState(null);
  const [restockQuantity, setRestockQuantity] = useState("");
  const [restockBatchCost, setRestockBatchCost] = useState("");
  const [restockSupplierName, setRestockSupplierName] = useState("");
  const [restockReferenceNo, setRestockReferenceNo] = useState("");
  const [restockCreditAccountCode, setRestockCreditAccountCode] = useState("1010");
  const [restockDiluteZeroCost, setRestockDiluteZeroCost] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [movementHistory, setMovementHistory] = useState({ item: null, rows: [], loading: false, error: "" });
  const [actionError, setActionError] = useState("");
  const [confirmedAdjKey, setConfirmedAdjKey] = useState("");
  const [notice, setNotice] = useState("");
  const [inventoryAlertsEnabled] = useState(readInventoryAlertPreference);
  const [isSaving, setIsSaving] = useState(false);
  const [formValues, setFormValues] = useState(loadInventoryAddDraft);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Auto-persist unsaved add-item draft so closing the docket or switching tabs never loses user input
  useEffect(() => {
    if (!editingItem && showForm) {
      saveInventoryAddDraft(formValues);
    }
  }, [formValues, editingItem, showForm]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [actionRow, setActionRow] = useState(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const sync = () => setIsMobile(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Dynamic live calculation of unit cost and valuation for the Add/Edit form preview
  const parsedLivePurchasePrice = Number(formValues.purchasePrice || 0);
  const livePurchasePrice = Number.isFinite(parsedLivePurchasePrice) ? Math.max(0, parsedLivePurchasePrice) : 0;
  const parsedLivePackageQuantity = Number(formValues.packageQuantity);
  const livePkgQty = Number.isFinite(parsedLivePackageQuantity) && parsedLivePackageQuantity > 0 ? parsedLivePackageQuantity : 0;
  const parsedLiveContents = Number(formValues.contentsPerPackage || 1);
  const liveContents = Number.isFinite(parsedLiveContents) && parsedLiveContents > 0 ? parsedLiveContents : 1;
  const liveTotalMeasurable = livePkgQty * liveContents;
  const liveUnitCost = (livePurchasePrice > 0 && liveTotalMeasurable > 0)
    ? (livePurchasePrice / liveTotalMeasurable)
    : 0;
  const parsedLiveStockQty = Number(formValues.quantity || 0);
  const liveStockQty = Number.isFinite(parsedLiveStockQty) ? Math.max(0, parsedLiveStockQty) : 0;
  const liveInventoryValue = liveStockQty * liveUnitCost;

  // Detect whether there is active unsaved content in the Add Item draft
  const hasAddDraft = Boolean(
    !editingItem &&
    (formValues.item?.trim() ||
     formValues.category?.trim() ||
     formValues.purchasePrice?.trim() ||
     (formValues.quantity?.trim() && formValues.quantity !== "0") ||
     formValues.image)
  );

  const filteredInventory = useMemo(() => {
    const query = search.trim().toLowerCase();

    return inventory.filter((entry) => {
      const canonicalCategory = normalizeInventoryCategory(entry.category);
      const matchesCategory =
        activeCategory === "All" ||
        entry.category === activeCategory ||
        canonicalCategory === activeCategory;
      const matchesSearch =
        !query ||
        `${entry.item} ${entry.category} ${canonicalCategory} ${entry.unit}`.toLowerCase().includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, inventory, search]);

  // One row shape shared by both the grid and list views.
  const rows = useMemo(() => filteredInventory.map((entry) => {
    const status = getInventoryStatus(entry.quantity, entry.maximumStock);
    const { capacityPercent, reportedPercent: stockRatio, tone: stockHealthTone } = getStockHealth(
      entry.quantity,
      entry.maximumStock,
      { overMaximum: status === "Over Maximum", lowThreshold, criticalThreshold },
    );
    const stockLevelKey = {
      available: "health-green",
      moderate: "health-moderate",
      low: "health-low",
      critical: "health-critical",
      over: "health-over",
      untracked: "no-maximum",
    }[stockHealthTone];
    const ratio = capacityPercent == null ? null : capacityPercent / 100;
    const hasMaximum = ratio != null;
    const isLowStock = hasMaximum && status !== "Out of Stock" && (stockRatio ?? 100) <= lowThreshold;
    const unitCost = Number(entry.unitCost || entry.unit_cost || 0);
    const inventoryValue = Number((Number(entry.quantity || 0) * unitCost).toFixed(2));
    const packageSpec = `${entry.packageQuantity || 1} ${entry.packageUnit || "pack"}${entry.contentsPerPackage ? ` (${entry.contentsPerPackage} ${entry.unit})` : ""}`;

    return {
      ...entry,
      unitCost,
      inventoryValue,
      packageSpec,
      status,
      cardStatus: isLowStock ? "Low Stock" : status,
      cardStatusKey: isLowStock ? "low-stock" : status === "In Stock" ? "in-stock" : status === "Over Maximum" ? "over-maximum" : "out-of-stock",
      stockLevelKey,
      isLowStock,
      lowThreshold,
      criticalThreshold,
      stockRatio,
    };
  }).sort((left, right) => {
    if (sortBy === "quantity-asc") return left.quantity - right.quantity || left.item.localeCompare(right.item);
    if (sortBy === "quantity-desc") return right.quantity - left.quantity || left.item.localeCompare(right.item);
    if (sortBy === "status") {
      const order = { "Out of Stock": 0, "Over Maximum": 1, "In Stock": 2 };
      return order[left.status] - order[right.status] || left.item.localeCompare(right.item);
    }
    return left.item.localeCompare(right.item);
  }), [filteredInventory, sortBy, lowThreshold, criticalThreshold]);

  const categoryCounts = useMemo(() => {
    const counts = { All: inventory.length };
    inventory.forEach((entry) => {
      const canonical = normalizeInventoryCategory(entry.category);
      counts[canonical] = (counts[canonical] || 0) + 1;
      if (entry.category && entry.category !== canonical) {
        counts[entry.category] = (counts[entry.category] || 0) + 1;
      }
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
      if (showForm) {
        setShowForm(false);
        if (editingItem) {
          setEditingItem(null);
          setFormValues(loadInventoryAddDraft());
        }
      }
      setRestockItem(null);
      setRestockBatchCost("");
      setRestockSupplierName("");
      setRestockReferenceNo("");
      setRestockCreditAccountCode("1010");
      setRestockDiluteZeroCost(false);
      setItemToDelete(null);
      setMovementHistory({ item: null, rows: [], loading: false, error: "" });
      setActionError("");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showForm, editingItem, restockItem, itemToDelete, movementHistory.item, isSaving]);

  const resetForm = () => {
    setShowForm(false);
    setActionError("");
    setIsSaving(false);
    if (editingItem) {
      setEditingItem(null);
      setFormValues(loadInventoryAddDraft());
    }
  };

  const handleOpenAddForm = () => {
    setEditingItem(null);
    setActionError("");
    setFormValues(loadInventoryAddDraft());
    setShowForm(true);
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setActionError("");
    setFormValues({
      item: item.item,
      image: item.image || "",
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
    const maxStock = Number(item.maximumStock);
    const currentQty = Number(item.quantity || 0);
    // Suggest the gap to the maximum only when a maximum is set and not yet reached; otherwise leave blank.
    if (Number.isFinite(maxStock) && maxStock > 0 && currentQty < maxStock) {
      setRestockQuantity(String(maxStock - currentQty));
    } else {
      setRestockQuantity("");
    }
    setRestockBatchCost("");
    setRestockSupplierName("");
    setRestockReferenceNo("");
    setRestockCreditAccountCode("1010");
    setRestockDiluteZeroCost(false);
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
    if (restockBatchCost !== "" && (!Number.isFinite(Number(restockBatchCost)) || Number(restockBatchCost) < 0)) {
      setActionError("Enter a valid non-negative batch cost.");
      return;
    }
    setIsSaving(true);
    setActionError("");
    try {
      await restockInventoryItem(restockItem.id, quantity, {
        batchCost: restockBatchCost,
        supplierName: restockSupplierName.trim() || undefined,
        referenceNo: restockReferenceNo.trim() || undefined,
        creditAccountCode: Number(restockBatchCost) > 0 ? restockCreditAccountCode : undefined,
        diluteZeroCost: restockBatchCost !== "" && Number(restockBatchCost) === 0 ? restockDiluteZeroCost : false,
      });
      setNotice(`${restockItem.item} restocked by ${quantity} ${restockItem.unit}.`);
      setRestockItem(null);
      setRestockBatchCost("");
      setRestockSupplierName("");
      setRestockReferenceNo("");
      setRestockCreditAccountCode("1010");
      setRestockDiluteZeroCost(false);
      setRestockCreditAccountCode("1010");
      setRestockDiluteZeroCost(false);
    } catch (error) {
      setActionError(error.message || "Could not restock this item.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleImageFile = (file) => {
    if (!file) return;
    const accepted = ["image/png", "image/jpeg", "image/webp"];
    if (!accepted.includes(file.type)) {
      setActionError("Unsupported file type. Use PNG, JPG, JPEG, or WEBP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setActionError("Image is larger than 5MB. Please choose a smaller file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setFormValues((prev) => ({ ...prev, image: reader.result }));
      setActionError("");
    };
    reader.onerror = () => setActionError("Could not read image file.");
    reader.readAsDataURL(file);
  };

  const handleImageDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) handleImageFile(file);
  };

  const handleSave = async (event) => {
    event.preventDefault();

    const itemName = formValues.item.trim();
    const category = formValues.category.trim();
    const unit = formValues.unit.trim();
    const packageUnit = formValues.packageUnit.trim() || "pack";
    const purchasePrice = formValues.purchasePrice.trim() === "" ? 0 : Number(formValues.purchasePrice);
    const packageQuantity = formValues.packageQuantity.trim() === ""
      ? (purchasePrice > 0 ? 0 : 1)
      : Number(formValues.packageQuantity);
    const enteredContentsPerPackage = formValues.contentsPerPackage.trim() === "" ? 0 : Number(formValues.contentsPerPackage);
    const contentsPerPackage = enteredContentsPerPackage || 1;
    const quantity = formValues.quantity.trim() === "" ? Number.NaN : Number(formValues.quantity);
    const maximumStock = formValues.maximumStock.trim() === "" ? null : Number(formValues.maximumStock);

    if (!itemName) {
      setActionError("Enter an inventory item name.");
      return;
    }
    if (!category) {
      setActionError("Choose an inventory category.");
      return;
    }
    if (!unit) {
      setActionError("Choose a stock measurement unit.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      setActionError("Enter a valid current stock quantity (zero or greater).");
      return;
    }
    if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
      setActionError("Enter a valid purchase price (zero or greater), or leave it blank.");
      return;
    }
    if (!Number.isFinite(packageQuantity) || packageQuantity <= 0) {
      setActionError(purchasePrice > 0
        ? "Enter how many packages you purchased; this is required to calculate unit cost."
        : "Package quantity must be greater than zero, or leave it blank to use 1.");
      return;
    }
    if (!Number.isFinite(enteredContentsPerPackage) || enteredContentsPerPackage < 0) {
      setActionError("Enter a valid contents-per-package amount, or leave it blank.");
      return;
    }
    if (purchasePrice > 0 && enteredContentsPerPackage <= 0) {
      setActionError("Enter the measurable amount inside each package to calculate unit cost.");
      return;
    }
    if (maximumStock !== null && (!Number.isFinite(maximumStock) || maximumStock <= 0)) {
      setActionError("Maximum stock must be greater than zero, or leave it blank.");
      return;
    }

    const prevQty = Number(editingItem?.quantity ?? 0);
    const maxAdjPct = Number(businessSettings?.maxInventoryAdjustmentPct ?? 200);
    const adjPct = editingItem && prevQty > 0 ? Math.abs(((quantity - prevQty) / prevQty) * 100) : 0;
    const adjKey = editingItem ? `${editingItem.id}:${prevQty}->${quantity}` : "";
    if (editingItem && prevQty > 0 && adjPct > maxAdjPct && confirmedAdjKey !== adjKey) {
      setConfirmedAdjKey(adjKey);
      setActionError(
        `Large adjustment warning: ${adjPct.toFixed(0)}% change exceeds your ${maxAdjPct}% Store Rule. Click "Save Changes" again to confirm.`,
      );
      return;
    }

    const totalMeasurable = packageQuantity * contentsPerPackage;
    const pricingUnchangedInEdit = Boolean(editingItem) &&
      Number(editingItem.purchasePrice ?? 0) === purchasePrice &&
      Number(editingItem.packageQuantity ?? 1) === packageQuantity &&
      (editingItem.contentsPerPackage == null ? 1 : Number(editingItem.contentsPerPackage)) === contentsPerPackage;
    const unitCost = pricingUnchangedInEdit
      ? Number(editingItem.unitCost ?? 0)
      : (purchasePrice > 0 && totalMeasurable > 0)
        ? Number((purchasePrice / totalMeasurable).toFixed(6))
        : 0;

    setIsSaving(true);
    setActionError("");
    let savedItem;
    try {
      const values = {
        item: itemName,
        image: formValues.image || null,
        category,
        purchasePrice,
        packageQuantity,
        packageUnit,
        contentsPerPackage,
        ...(pricingUnchangedInEdit ? {} : { unitCost }),
        quantity,
        unit,
        maximumStock,
      };
      if (editingItem) savedItem = await updateInventoryItem(editingItem.id, values);
      else savedItem = await addInventoryItem(values);
    } catch (error) {
      setActionError(error.message || "Could not save the inventory item.");
      setIsSaving(false);
      return;
    }

    setConfirmedAdjKey("");
    setNotice(
      savedItem?.unitDimensionWarning
        ? `${itemName} updated. Warning: ${savedItem.unitDimensionWarning}`
        : (editingItem ? `${itemName} was updated.` : `${itemName} was added to inventory.`),
    );
    setIsSaving(false);
    if (!editingItem) {
      clearInventoryAddDraft();
      setFormValues(createEmptyInventoryForm());
    }
    resetForm();
  };

  return (
    <div className={`admin-inventory-page ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${isMobile ? "is-mobile" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
      {mobileNavOpen && <div className="ai-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />}
      <Sidebar
        role="admin"
        activeTab="inventory"
        sidebarCollapsed={sidebarCollapsed}
        onToggle={() => (isMobile ? setMobileNavOpen(false) : toggleSidebar())}
      />

      {isMobile ? (
        <main className="ai-main">
          <header className="ai-appbar">
            <button type="button" className="ai-icon-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu"><Menu size={24} /></button>
            {searchOpen ? (
              <label className="ai-search">
                <Search size={20} aria-hidden="true" />
                <input autoFocus type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search inventory" aria-label="Search inventory" />
                <button type="button" onClick={() => { setSearch(""); setSearchOpen(false); }} aria-label="Close search">&times;</button>
              </label>
            ) : (
              <>
                <div className="ai-title"><h1>Inventory</h1><span>{totalItems} items</span></div>
                <button type="button" className="ai-icon-btn" onClick={() => setSearchOpen(true)} aria-label="Search inventory"><Search size={22} /></button>
                <Link to="/admin/archive" className="ai-icon-btn" aria-label="View archive"><Archive size={22} /></Link>
              </>
            )}
          </header>

          {notice && <div className="ai-snack" role="status"><CheckCircle2 size={18} aria-hidden="true" /><span>{notice}</span><button type="button" onClick={() => setNotice("")}>OK</button></div>}

          <section className="ai-summary" aria-label="Inventory summary">
            <div className="ai-summary-main"><span>Asset value</span><strong>₱{totalInventoryAssetValue.toFixed(2)}</strong></div>
            <div className="ai-summary-row">
              <span className="ok"><i />{inStockCount} in stock</span>
              <span className="out"><i />{outOfStockCount} out</span>
              <span className="over"><i />{overMaximumCount} over</span>
            </div>
          </section>

          <div className="ai-chips" role="tablist" aria-label="Category">
            {categories.map((c) => (
              <button key={c} type="button" role="tab" aria-selected={activeCategory === c} className={activeCategory === c ? "on" : ""} onClick={() => setActiveCategory(c)}>
                {c}<b>{categoryCounts[c] ?? 0}</b>
              </button>
            ))}
          </div>

          <div className="ai-sortbar">
            <span>{rows.length} shown</span>
            <div className="ai-sortbar-controls">
              <label>Sort
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort inventory">
                  <option value="name">Name</option>
                  <option value="status">Status</option>
                  <option value="quantity-asc">Qty low-high</option>
                  <option value="quantity-desc">Qty high-low</option>
                </select>
              </label>
              <div className="ai-viewtoggle" role="group" aria-label="View mode">
                <button
                  type="button"
                  className={viewMode === "grid" ? "active" : ""}
                  onClick={() => setViewMode("grid")}
                  aria-pressed={viewMode === "grid"}
                  title="Grid view"
                >
                  <LayoutGrid aria-hidden="true" size={15} strokeWidth={2.2} />
                  <span>Grid</span>
                </button>
                <button
                  type="button"
                  className={viewMode === "list" ? "active" : ""}
                  onClick={() => setViewMode("list")}
                  aria-pressed={viewMode === "list"}
                  title="List view"
                >
                  <List aria-hidden="true" size={15} strokeWidth={2.2} />
                  <span>List</span>
                </button>
              </div>
            </div>
          </div>

          <ul className={`ai-list ${viewMode === "list" ? "is-bars" : "is-grid"}`}>
            {inventoryLoading && inventory.length === 0 ? (
              <li className="ai-empty"><RefreshCw size={30} aria-hidden="true" /><strong>Loading inventory…</strong></li>
            ) : rows.length === 0 ? (
              <li className="ai-empty">
                <Package size={40} aria-hidden="true" />
                <strong>{inventory.length === 0 ? "No inventory yet" : "Nothing matches"}</strong>
                <span>{inventory.length === 0 ? "Tap Add to stock your first item." : "Try another category or search."}</span>
              </li>
            ) : viewMode === "grid" ? (
              rows.map((row) => (
                <li key={row.id} className={`ai-item ai-grid-card ${row.cardStatusKey}`}>
                  <div className="ai-card-media">
                    {row.image ? (
                      <img src={row.image} alt={row.item} loading="lazy" />
                    ) : (
                      <div className="ai-card-placeholder" aria-hidden="true">
                        <Package size={26} strokeWidth={1.6} />
                      </div>
                    )}
                    <div className="ai-card-media-overlay">
                      <span className="ai-card-cat-pill">{row.category}</span>
                      <button type="button" className="ai-more-glass" onClick={() => setActionRow(row)} aria-label={`Actions for ${row.item}`}>&#8942;</button>
                    </div>
                    <span className={`ai-badge ai-card-status-float ${row.cardStatusKey}`}>{row.cardStatus}</span>
                  </div>

                  <div className="ai-card-body">
                    <strong className="ai-card-title" title={row.item}>{row.item}</strong>
                    <span className="ai-card-submeta">₱{formatUnitCost(row.unitCost)} / {row.unit}</span>

                    <div className="ai-card-stock-box">
                      <div className="ai-qty-row">
                        <span className="ai-qty"><b>{row.quantity}</b> {row.unit}</span>
                        <span className="ai-val-tag">₱{Number(row.inventoryValue || 0).toFixed(2)}</span>
                      </div>
                      <div className={`ai-meter ${row.stockRatio == null ? "none" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.stockRatio ?? undefined} aria-label={`${row.item} stock level`}>
                        {row.stockRatio != null && <i className={row.stockLevelKey} style={{ width: `${Math.min(100, row.stockRatio)}%` }} />}
                      </div>
                      <small className="ai-max">{row.maximumStock == null ? "No max set" : `Max ${row.maximumStock} ${row.unit}`}</small>
                    </div>

                    <button type="button" className="ai-restock" onClick={() => openRestock(row)}>
                      <Warehouse size={14} aria-hidden="true" />Restock
                    </button>
                  </div>
                </li>
              ))
            ) : (
              rows.map((row) => (
                <li key={row.id} className={`ai-bar-item ${row.cardStatusKey}`}>
                  <div className="ai-bar-top">
                    <span className="ai-bar-thumb">
                      {row.image ? <img src={row.image} alt={row.item} loading="lazy" /> : <Package size={20} strokeWidth={1.6} aria-hidden="true" />}
                    </span>
                    <div className="ai-bar-info">
                      <div className="ai-bar-title-row">
                        <strong>{row.item}</strong>
                        <span className={`ai-badge ${row.cardStatusKey}`}>{row.cardStatus}</span>
                      </div>
                      <div className="ai-bar-meta-row">
                        <span className="ai-bar-cat">{row.category}</span>
                        <span>·</span>
                        <span>₱{formatUnitCost(row.unitCost)} / {row.unit}</span>
                        <span>·</span>
                        <span className="ai-bar-val">₱{Number(row.inventoryValue || 0).toFixed(2)}</span>
                      </div>
                    </div>
                    <button type="button" className="ai-more" onClick={() => setActionRow(row)} aria-label={`Actions for ${row.item}`}>&#8942;</button>
                  </div>

                  <div className="ai-bar-bottom">
                    <div className="ai-bar-stock-col">
                      <div className="ai-bar-qty-line">
                        <span className="ai-bar-qty"><b>{row.quantity}</b> {row.unit}</span>
                        <small className="ai-max">{row.maximumStock == null ? "No max" : `/ ${row.maximumStock} ${row.unit}`}</small>
                      </div>
                      <div className={`ai-meter ${row.stockRatio == null ? "none" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={row.stockRatio ?? undefined} aria-label={`${row.item} stock level`}>
                        {row.stockRatio != null && <i className={row.stockLevelKey} style={{ width: `${Math.min(100, row.stockRatio)}%` }} />}
                      </div>
                    </div>
                    <button type="button" className="ai-restock ai-bar-restock" onClick={() => openRestock(row)}>
                      <Warehouse size={14} aria-hidden="true" />Restock
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>

          <button type="button" className="ai-fab" onClick={handleOpenAddForm}>
            <Plus size={22} strokeWidth={2.6} aria-hidden="true" />Add
          </button>

          {actionRow && (
            <div className="ai-sheet-wrap" role="presentation" onClick={() => setActionRow(null)}>
              <div className="ai-sheet" role="dialog" aria-modal="true" aria-label={`Actions for ${actionRow.item}`} onClick={(e) => e.stopPropagation()}>
                <span className="ai-sheet-handle" aria-hidden="true" />
                <h2>{actionRow.item}</h2>
                <button type="button" onClick={() => { openMovementHistory(actionRow); setActionRow(null); }}><History size={22} aria-hidden="true" />Stock history</button>
                <button type="button" onClick={() => { handleEdit(actionRow); setActionRow(null); }}><Pencil size={22} aria-hidden="true" />Edit item</button>
                <button type="button" className="danger" onClick={() => { requestDelete(actionRow.id); setActionRow(null); }}><Trash2 size={22} aria-hidden="true" />Archive item</button>
              </div>
            </div>
          )}
        </main>
      ) : (
      <main className="admin-inventory-main">
        <header className="admin-inventory-topbar">
          <div className="admin-inventory-head-main">
            <span className="admin-inventory-eyebrow">Stock Overview</span>
            <h1>Inventory management</h1>
            <p>Track ingredients, packaging, and supplies needed for your daily operations.</p>
          </div>
          <div className="admin-inventory-topbar-actions">
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
            >
              <Archive size={16} /> View Archive
            </Link>
            <button
              type="button"
              className="admin-inventory-add-button"
              onClick={handleOpenAddForm}
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
            <div
              className="admin-inventory-main-pane"
              tabIndex={0}
              role="region"
              aria-label="Inventory management workspace"
            >
              <section className="admin-inventory-toolbar">
                <label className="admin-inventory-search">
                  <Search aria-hidden="true" size={16} strokeWidth={2.2} />
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
                    <span className="admin-inventory-filter-label">
                      <span>Category</span>
                      <Link to="/admin/categories" className="admin-inventory-manage-category-link" title="Manage Categories">
                        ⚙ Manage
                      </Link>
                    </span>
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
                    <span className="admin-inventory-sort-label">
                      <span>Sort</span>
                    </span>
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
                      <LayoutGrid aria-hidden="true" size={16} strokeWidth={2.2} />
                      <span>Grid</span>
                    </button>
                    <button
                      type="button"
                      className={viewMode === "list" ? "active" : ""}
                      onClick={() => setViewMode("list")}
                      aria-pressed={viewMode === "list"}
                      title="List view"
                    >
                      <List aria-hidden="true" size={16} strokeWidth={2.2} />
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
              <div
                className="admin-inventory-grid-wrap custom-inventory-scrollbar inventory-binder-folio"
                role="region"
                aria-label="Inventory items"
                tabIndex={0}
              >
                {/* 3D Animated Leather Binder Cover that slowly opens on mount */}
                <div className="inventory-binder-cover" aria-hidden="true">
                  <div className="inventory-binder-cover-inner">
                    <span className="inventory-binder-crest">AMAYA CAFE</span>
                    <strong className="inventory-binder-title">INVENTORY BINDER</strong>
                    <span className="inventory-binder-sub">Pinned Stock &amp; Supply Catalog</span>
                  </div>
                </div>

                {/* Left Spiral Wire Binding Spine */}
                <div className="inventory-binder-spine" aria-hidden="true">
                  {Array.from({ length: 12 }).map((_, idx) => (
                    <span key={idx} className="inventory-binder-ring">
                      <i className="inventory-binder-hole" />
                      <b className="inventory-binder-wire" />
                    </span>
                  ))}
                </div>

                {/* Top-Right Crimson Bookmark Ribbon */}
                <div className="inventory-binder-ribbon" aria-hidden="true">
                  <span className="inventory-ribbon-hole" />
                  <span className="inventory-ribbon-label">
                    {activeCategory === "All" ? "ALL STOCK" : activeCategory.toUpperCase()}
                  </span>
                </div>

                {/* Ruled Binder Page Interior */}
                <div className="inventory-binder-page">
                  <div className="inventory-binder-page-header" aria-hidden="true">
                    <div className="inventory-binder-page-meta">
                      <span className="inventory-binder-eyebrow">PINNED INGREDIENT FOLIO</span>
                      <span className="inventory-binder-stamp">
                        {rows.length} {rows.length === 1 ? "ITEM" : "ITEMS"} PINNED
                      </span>
                    </div>
                    <span className="inventory-binder-cat-tag">
                      SECTION: {activeCategory === "All" ? "ALL CATEGORIES" : activeCategory.toUpperCase()}
                    </span>
                  </div>

                  <div className="inventory-binder-scroll custom-inventory-scrollbar">
                    <div className="admin-inventory-grid">
                      {rows.map((row, idx) => (
                        <article
                          className={`admin-inventory-card inventory-pinned-card ${row.cardStatusKey}`}
                          key={row.id}
                          style={{ "--card-index": idx }}
                        >
                          {/* 3D Pushpin / Thumbtack pinning each inventory card */}
                          <div className={`inventory-card-pin ${row.cardStatusKey}`} aria-hidden="true">
                            <span className="inventory-pin-shadow" />
                            <span className="inventory-pin-needle" />
                            <span className="inventory-pin-collar" />
                            <span className="inventory-pin-head">
                              <i className="inventory-pin-glint" />
                            </span>
                          </div>

                          {/* Numbered Ledger Index Stamp */}
                          <span className="inventory-card-index-tag" aria-hidden="true">
                            #{String(idx + 1).padStart(2, "0")}
                          </span>

                          <div className="admin-inventory-card-media">
                            {row.image ? (
                              <img
                                src={row.image}
                                alt={row.item}
                                className="admin-inventory-card-thumbnail"
                                loading="lazy"
                              />
                            ) : (
                              <div className="admin-inventory-card-placeholder" aria-hidden="true">
                                <Package size={30} strokeWidth={1.5} />
                              </div>
                            )}
                            <div className="admin-inventory-card-overlay-top">
                              <span className="admin-inventory-card-category">{row.category}</span>
                              <div className="admin-inventory-card-badges">
                                {row.addedFromMenu && <span className="inventory-source-badge">Recipe</span>}
                                <span className={`admin-inventory-badge ${row.cardStatusKey}`}>{row.cardStatus}</span>
                              </div>
                            </div>
                          </div>

                          <div className="admin-inventory-card-body">
                            <div className="admin-inventory-card-title">
                              <h4 title={row.item}>{row.item}</h4>
                              <div className="admin-inventory-card-submeta">
                                <span title="Calculated unit cost">₱{formatUnitCost(row.unitCost)} / {row.unit}</span>
                                {row.packageQuantity && row.contentsPerPackage ? (
                                  <>
                                    <span className="meta-dot" aria-hidden="true">·</span>
                                    <span title="Package specification">{row.packageSpec}</span>
                                  </>
                                ) : null}
                              </div>
                            </div>

                            <div className="admin-inventory-card-stock">
                              <div className="admin-inventory-card-stock-row">
                                <div>
                                  <span className="admin-inventory-card-label">Available Stock</span>
                                  <p className="admin-inventory-card-qty">
                                    {row.quantity}
                                    <span>{row.unit}</span>
                                  </p>
                                </div>
                                <div className="admin-inventory-card-max">
                                  <span className="admin-inventory-card-label">Value · Max</span>
                                  <p className="admin-inventory-card-value">₱{Number(row.inventoryValue || 0).toFixed(2)}</p>
                                  <small className="admin-inventory-card-cap">
                                    {row.maximumStock == null ? "No max set" : `of ${row.maximumStock} ${row.unit}`}
                                  </small>
                                </div>
                              </div>

                              <div
                                className={`admin-inventory-progress${row.stockRatio == null ? " no-maximum" : ""} ${row.stockLevelKey}`}
                                role="progressbar"
                                aria-valuenow={row.stockRatio == null ? undefined : row.stockRatio}
                                aria-valuetext={row.stockRatio == null ? "No maximum set" : `${row.stockRatio}% of maximum stock${row.isLowStock ? ", low stock" : ""}`}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label={`${row.item} stock level`}
                                title={row.stockRatio == null ? "Set maximum stock to track this level" : `${row.stockRatio}% of maximum stock${row.isLowStock ? " · Low stock" : ""}`}
                              >
                                {row.stockRatio == null
                                  ? null
                                  : <span className={row.stockLevelKey} style={{ width: `${row.stockRatio}%` }} />}
                              </div>
                            </div>
                          </div>

                          <div className="admin-inventory-card-actions">
                            <button type="button" onClick={() => openMovementHistory(row)} title={`View ${row.item} stock history`}>
                              <History aria-hidden="true" size={14} strokeWidth={2.1} />
                              <span>History</span>
                            </button>
                            <button type="button" onClick={() => handleEdit(row)} title={`Edit ${row.item}`}>
                              <Pencil aria-hidden="true" size={14} strokeWidth={2.1} />
                              <span>Edit</span>
                            </button>
                            <button type="button" className="restock" onClick={() => openRestock(row)} title={`Restock ${row.item}`}>
                              <Warehouse aria-hidden="true" size={14} strokeWidth={2.1} />
                              <span>Restock</span>
                            </button>
                            <button type="button" className="danger" onClick={() => requestDelete(row.id)} title={`Archive ${row.item}`} aria-label={`Archive ${row.item}`}>
                              <Trash2 aria-hidden="true" size={14} strokeWidth={2.1} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="admin-inventory-table-wrap custom-inventory-scrollbar inventory-binder-folio inventory-binder-list-mode"
                role="region"
                aria-label="Inventory items list"
                tabIndex={0}
              >
                {/* Left Spiral Wire Binding Spine */}
                <div className="inventory-binder-spine" aria-hidden="true">
                  {Array.from({ length: 12 }).map((_, idx) => (
                    <span key={idx} className="inventory-binder-ring">
                      <i className="inventory-binder-hole" />
                      <b className="inventory-binder-wire" />
                    </span>
                  ))}
                </div>

                {/* Top-Right Crimson Bookmark Ribbon */}
                <div className="inventory-binder-ribbon" aria-hidden="true">
                  <span className="inventory-ribbon-hole" />
                  <span className="inventory-ribbon-label">
                    {activeCategory === "All" ? "ALL STOCK" : activeCategory.toUpperCase()}
                  </span>
                </div>

                <div className="inventory-binder-page">
                  <div className="inventory-binder-page-header" aria-hidden="true">
                    <div className="inventory-binder-page-meta">
                      <span className="inventory-binder-eyebrow">LEDGER STOCK REGISTER</span>
                      <span className="inventory-binder-stamp">
                        {rows.length} {rows.length === 1 ? "ITEM" : "ITEMS"} RECORDED
                      </span>
                    </div>
                    <span className="inventory-binder-cat-tag">
                      SECTION: {activeCategory === "All" ? "ALL CATEGORIES" : activeCategory.toUpperCase()}
                    </span>
                  </div>

                  <div className="inventory-binder-scroll custom-inventory-scrollbar">
                    <div className="admin-inventory-table" role="list">
                      {rows.map((row, idx) => (
                        <article className="admin-inventory-bar-row inventory-ledger-bar-row" role="listitem" key={row.id}>
                          <div className="admin-inventory-bar-identity">
                            <span className="inventory-bar-index-num" aria-hidden="true">
                              #{String(idx + 1).padStart(2, "0")}
                            </span>
                            {row.image ? (
                              <img
                                src={row.image}
                                alt={row.item}
                                className="admin-inventory-table-thumbnail"
                                loading="lazy"
                              />
                            ) : (
                              <div className="admin-inventory-table-placeholder" aria-hidden="true">
                                <Package size={20} strokeWidth={1.6} />
                              </div>
                            )}
                            <div className="admin-inventory-table-item-meta">
                              <div className="admin-inventory-bar-title-line">
                                <strong title={row.item}>{row.item}</strong>
                                <span className="admin-inventory-bar-cat">{row.category}</span>
                                {row.addedFromMenu && <span className="inventory-source-badge">Recipe</span>}
                              </div>
                              <div className="admin-inventory-bar-subline">
                                <span>₱{formatUnitCost(row.unitCost)} / {row.unit}</span>
                                {row.packageSpec && row.packageSpec !== "—" ? (
                                  <>
                                    <span className="meta-dot" aria-hidden="true">·</span>
                                    <span>{row.packageSpec}</span>
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </div>

                          <div className="admin-inventory-bar-stock">
                            <div className="admin-inventory-bar-stock-top">
                              <span className="admin-inventory-bar-qty">
                                <strong>{row.quantity}</strong> {row.unit}
                              </span>
                              <span className="admin-inventory-bar-max">
                                {row.maximumStock == null ? "No max" : `/ ${row.maximumStock} ${row.unit}`}
                              </span>
                            </div>
                            <div
                              className={`admin-inventory-progress${row.stockRatio == null ? " no-maximum" : ""} ${row.stockLevelKey}`}
                              role="progressbar"
                              aria-valuenow={row.stockRatio == null ? undefined : row.stockRatio}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={`${row.item} stock level`}
                            >
                              {row.stockRatio == null ? null : (
                                <span className={row.stockLevelKey} style={{ width: `${row.stockRatio}%` }} />
                              )}
                            </div>
                          </div>

                          <div className="admin-inventory-bar-metrics">
                            <div className="admin-inventory-bar-val">
                              <span className="admin-inventory-bar-label">Asset Value</span>
                              <strong>₱{Number(row.inventoryValue || 0).toFixed(2)}</strong>
                            </div>
                            <span className={`admin-inventory-badge ${row.cardStatusKey}`}>{row.cardStatus}</span>
                          </div>

                          <div className="admin-inventory-bar-actions">
                            <button type="button" onClick={() => openMovementHistory(row)} title={`View ${row.item} stock history`}>
                              <History aria-hidden="true" size={14} strokeWidth={2.1} />
                              <span>History</span>
                            </button>
                            <button type="button" onClick={() => handleEdit(row)} title={`Edit ${row.item}`}>
                              <Pencil aria-hidden="true" size={14} strokeWidth={2.1} />
                              <span>Edit</span>
                            </button>
                            <button type="button" className="restock" onClick={() => openRestock(row)} title={`Restock ${row.item}`}>
                              <Warehouse aria-hidden="true" size={14} strokeWidth={2.1} />
                              <span>Restock</span>
                            </button>
                            <button type="button" className="danger" onClick={() => requestDelete(row.id)} title={`Archive ${row.item}`} aria-label={`Archive ${row.item}`}>
                              <Trash2 aria-hidden="true" size={14} strokeWidth={2.1} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
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
      )}

      {showForm && (
        <div className="admin-inventory-modal-backdrop" role="presentation" onClick={resetForm}>
          <form
            className="admin-inventory-modal admin-inventory-item-modal clipboard-docket-board"
            onSubmit={handleSave}
            role="dialog"
            aria-modal="true"
            aria-labelledby="inventory-docket-title"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Top Mechanical Brass Spring-Clip */}
            <div className="clipboard-top-clip" aria-hidden="true">
              <span className="clipboard-clip-rivet rivet-left" />
              <div className="clipboard-clip-plate">
                <span className="clipboard-clip-hole" />
                <span className="clipboard-clip-stamp">AMAYA WORKSHOP · REQUISITION DOCKET</span>
                <span className="clipboard-clip-screw" />
              </div>
              <span className="clipboard-clip-rivet rivet-right" />
            </div>

            {/* List Board Header Bar */}
            <div className="admin-inventory-modal-header clipboard-header">
              <div className="clipboard-header-info">
                <div className="clipboard-header-tags">
                  <span className="clipboard-tag-amber">
                    <span className="clipboard-tag-pip" />
                    REQUISITION DOCKET
                  </span>
                  <span className="clipboard-tag-num">
                    {editingItem ? `#${editingItem.id || "EDIT"}` : "#NEW"}
                  </span>
                  {hasAddDraft && (
                    <span
                      className="clipboard-tag-amber"
                      style={{ background: "#eef8f2", color: "#1e7047", borderColor: "#c6e7d2" }}
                      title="Your draft is automatically saved and preserved"
                    >
                      <span className="clipboard-tag-pip" style={{ background: "#1e7047" }} />
                      DRAFT PRESERVED
                    </span>
                  )}
                </div>
                <h3 id="inventory-docket-title" className="clipboard-title">
                  {editingItem ? "Edit Inventory Item Spec" : "Add Inventory Item"}
                </h3>
                <p className="clipboard-subtitle">
                  Workshop master sheet for raw ingredient tracking, recipe conversions, and storage floors.
                </p>
              </div>

              <button
                type="button"
                className="clipboard-close-btn"
                onClick={resetForm}
                aria-label="Close form"
                title="Close docket (Draft is preserved)"
              >
                <X size={18} strokeWidth={2.4} />
              </button>
            </div>

            {/* List Board Body holding Two Clipped Docket Papers */}
            <div className="admin-inventory-modal-body clipboard-body">
              <div className="clipboard-dockets-grid">

                {/* DOCKET SHEET 1: Item Identity & Storage Floor */}
                <article className="clipboard-sheet sheet-identity">
                  <div className="docket-sheet-pin-bar">
                    <span className="docket-pin-badge">
                      <span className="docket-pin-dot" />
                      #1 ITEM SPEC & STORAGE
                    </span>
                    <span className="docket-sheet-folio">DOC-01 / MASTER ID</span>
                  </div>

                  <div className="docket-sheet-content">
                    <div className="clipboard-field-group">
                      <label htmlFor="inventory-item-name" className="clipboard-label">
                        <span className="inventory-field-label-text">
                          Inventory Item Name
                          <FieldHelpTooltip
                            title="Item Name"
                            text="Exact ingredient or packaging name (e.g. Non-Dairy Milk Powder, 22oz Cups, Assam Black Tea). Keep it specific so recipes attach to the right stock!"
                            align="left"
                          />
                        </span>
                      </label>
                      <input
                        id="inventory-item-name"
                        type="text"
                        className="clipboard-input"
                        value={formValues.item}
                        autoFocus
                        onChange={(event) => setFormValues({ ...formValues, item: event.target.value })}
                        placeholder="e.g. Non-Dairy Creamer, Assam Black Tea, 22oz Cups"
                        required
                      />
                    </div>

                    <div className="clipboard-field-group">
                      <label htmlFor="inventory-category-select" className="clipboard-label">
                        <span className="inventory-field-label-text">
                          Warehouse Category
                          <Link
                            to="/admin/categories"
                            className="clipboard-manage-link"
                            title="Manage Categories"
                          >
                            ⚙ Manage
                          </Link>
                          <FieldHelpTooltip
                            title="Category"
                            text="Operational grouping for recipe & stock control. E.g., Black Tea = 'Tea Bases' | Milk = 'Dairy & Creamers' | Cups = 'Cups' | Straws/Bags = 'Packaging & Disposables' | Pearls = 'Toppings & Add-ons'!"
                            align="right"
                          />
                        </span>
                      </label>
                      <select
                        id="inventory-category-select"
                        className="clipboard-select"
                        value={formValues.category}
                        onChange={(event) => setFormValues({ ...formValues, category: event.target.value })}
                      >
                        <option value="">-- Choose Category --</option>
                        {formValues.category && !categories.includes(formValues.category) && (
                          <option value={formValues.category}>{formValues.category} (current)</option>
                        )}
                        {categories.filter((category) => category !== "All").map((category) => (
                          <option key={category} value={category}>{category}</option>
                        ))}
                      </select>
                    </div>

                    {/* Photo Specimen Frame */}
                    <div className="clipboard-field-group">
                      <span className="inventory-field-label-text">
                        Item Photo (Optional)
                        <FieldHelpTooltip
                          title="Item Photo"
                          text="Upload a picture of the ingredient or packaging. Displays on inventory cards, tables, and recipe pickers."
                          align="right"
                        />
                      </span>

                      {formValues.image ? (
                        <div className="inventory-form-image-preview clipboard-image-preview">
                          <img
                            src={formValues.image}
                            alt={formValues.item || "Inventory item"}
                            className="inventory-form-image-img"
                          />
                          <div className="inventory-form-image-controls">
                            <label className="inventory-img-btn change" title="Choose a new file to replace this image">
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleImageFile(file);
                                }}
                                aria-label="Change inventory image"
                                style={{ display: "none" }}
                              />
                              <FolderOpen size={13} strokeWidth={2.2} />
                              <span>Change Photo</span>
                            </label>
                            <button
                              type="button"
                              className="inventory-img-btn remove"
                              onClick={() => setFormValues((prev) => ({ ...prev, image: "" }))}
                              title="Remove this image"
                            >
                              <Trash2 size={13} strokeWidth={2} />
                              <span>Remove</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <label
                          className="inventory-dropzone clipboard-dropzone"
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={handleImageDrop}
                        >
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageFile(file);
                            }}
                            aria-label="Upload inventory item image"
                            style={{ display: "none" }}
                          />
                          <span className="inventory-dropzone-icon" aria-hidden="true">
                            <ImagePlus size={22} strokeWidth={1.8} />
                          </span>
                          <span className="inventory-dropzone-text">
                            <strong>Click to upload</strong> or drag photo here
                          </span>
                          <small>PNG, JPG, WEBP (Up to 5MB)</small>
                        </label>
                      )}
                    </div>

                    {/* Storage Floor Sub-section */}
                    <div className="docket-subheading-divider">
                      <span className="docket-subheading-label">STORAGE FLOOR LEVELS</span>
                      <span className="docket-subheading-line" />
                    </div>

                    <div className="clipboard-row-2col">
                      <div className="clipboard-field-group">
                        <label htmlFor="inventory-current-stock" className="clipboard-label">
                          <span className="inventory-field-label-text">
                            Current Stock
                            <FieldHelpTooltip
                              title="Current Stock"
                              text="Actual measurable amount in your cafe right now (e.g. 25,000g or 500 pcs). POS automatically subtracts from this every time a drink is sold!"
                              align="left"
                            />
                          </span>
                        </label>
                        <div className="clipboard-input-with-dock">
                          <input
                            id="inventory-current-stock"
                            type="number"
                            className="clipboard-input"
                            value={formValues.quantity}
                            onChange={(event) => setFormValues({ ...formValues, quantity: event.target.value })}
                            min="0"
                            step="any"
                            placeholder="0"
                            required
                          />
                          <span className="clipboard-dock-badge">{formValues.unit || "unit"}</span>
                        </div>
                      </div>

                      <div className="clipboard-field-group">
                        <label htmlFor="inventory-max-stock" className="clipboard-label">
                          <span className="inventory-field-label-text">
                            Target Max
                            <FieldHelpTooltip
                              title="Maximum Stock"
                              text="Optional upper target for the amount you want to keep. The system flags this item when its quantity goes above this level."
                              align="right"
                            />
                          </span>
                        </label>
                        <div className="clipboard-input-with-dock">
                          <input
                            id="inventory-max-stock"
                            type="number"
                            className="clipboard-input"
                            value={formValues.maximumStock}
                            onChange={(event) => setFormValues({ ...formValues, maximumStock: event.target.value })}
                            min="0.000001"
                            step="0.000001"
                            placeholder="Optional ceiling"
                          />
                          <span className="clipboard-dock-badge">{formValues.unit || "unit"}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>

                {/* DOCKET SHEET 2: Procurement & Live Costing Receipt */}
                <article className="clipboard-sheet sheet-procurement">
                  <div className="docket-sheet-pin-bar">
                    <span className="docket-pin-badge">
                      <span className="docket-pin-dot" />
                      #2 PROCUREMENT & UNIT COST
                    </span>
                    <span className="docket-sheet-folio">DOC-02 / BATCH SPEC</span>
                  </div>

                  <div className="docket-sheet-content">
                    <div className="clipboard-row-2col">
                      <div className="clipboard-field-group">
                        <label htmlFor="inventory-purchase-price" className="clipboard-label">
                          <span className="inventory-field-label-text">
                            Purchase Price (₱)
                            <FieldHelpTooltip
                              title="Purchase Price"
                              text="Total money paid for this batch (e.g. ₱3,300 for a 25kg sack of powder). System divides this by total quantity to get your true cost per cup!"
                              align="left"
                            />
                          </span>
                        </label>
                        <div className="clipboard-input-with-prefix">
                          <span className="clipboard-prefix-symbol">₱</span>
                          <input
                            id="inventory-purchase-price"
                            type="number"
                            min="0"
                            step="0.01"
                            className="clipboard-input"
                            value={formValues.purchasePrice}
                            onChange={(event) => setFormValues({ ...formValues, purchasePrice: event.target.value })}
                            placeholder="0.00"
                          />
                        </div>
                      </div>

                      <div className="clipboard-field-group">
                        <label htmlFor="inventory-pkg-qty" className="clipboard-label">
                          <span className="inventory-field-label-text">
                            Package Qty
                            <FieldHelpTooltip
                              title="Package Quantity"
                              text="Number of containers, sacks, or boxes bought (e.g. 1 sack of powder, 5 boxes of cups). Multiplied by package contents to auto-calculate your total stock!"
                              align="right"
                            />
                          </span>
                        </label>
                        <input
                          id="inventory-pkg-qty"
                          type="number"
                          min="0.001"
                          step="any"
                          className="clipboard-input"
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
                          placeholder="e.g. 1, 5"
                        />
                      </div>
                    </div>

                    <div className="clipboard-row-2col">
                      <div className="clipboard-field-group">
                        <label htmlFor="inventory-pkg-unit" className="clipboard-label">
                          <span className="inventory-field-label-text">
                            Container Type
                            <FieldHelpTooltip
                              title="Package Container"
                              text="Container packaging medium (sack, box, bottle, bag, pack). Gives staff a clear audit specification label on inventory cards!"
                              align="left"
                            />
                          </span>
                        </label>
                        <select
                          id="inventory-pkg-unit"
                          className="clipboard-select"
                          value={formValues.packageUnit}
                          onChange={(event) => setFormValues({ ...formValues, packageUnit: event.target.value })}
                        >
                          {!packageUnitOptions.includes(formValues.packageUnit) && (
                            <option value={formValues.packageUnit}>{formValues.packageUnit} (current)</option>
                          )}
                          {packageUnitOptions.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </div>

                      <div className="clipboard-field-group">
                        <label htmlFor="inventory-contents-pkg" className="clipboard-label">
                          <span className="inventory-field-label-text">
                            Contents / Pack
                            <FieldHelpTooltip
                              title="Contents per Package"
                              text="Measurable amount inside ONE package (e.g. 25000g for a 25kg sack, 1000pcs for a box of cups, 2500ml for syrup). Critical for calculating cost per cup!"
                              align="right"
                            />
                          </span>
                        </label>
                        <input
                          id="inventory-contents-pkg"
                          type="number"
                          min="0.001"
                          step="any"
                          className="clipboard-input"
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
                          placeholder="e.g. 25000"
                        />
                      </div>
                    </div>

                    <div className="clipboard-field-group">
                      <label htmlFor="inventory-recipe-unit" className="clipboard-label">
                        <span className="inventory-field-label-text">
                          Recipe Dispensing Unit
                          <FieldHelpTooltip
                            title="Stock Unit"
                            text="Recipe dispensing unit: 'g' for powders/tea/pearls, 'ml' for syrups/liquids, 'pcs' for cups/lids/straws. Must match your menu recipe unit!"
                            align="left"
                          />
                        </span>
                      </label>
                      <select
                        id="inventory-recipe-unit"
                        className="clipboard-select"
                        value={formValues.unit}
                        onChange={(event) => setFormValues({ ...formValues, unit: event.target.value })}
                      >
                        {!inventoryUnitGroups.some((group) => group.options.some(([value]) => value === formValues.unit)) && (
                          <option value={formValues.unit}>{formValues.unit} (current)</option>
                        )}
                        {inventoryUnitGroups.map((group) => (
                          <optgroup label={group.label} key={group.label}>
                            {group.options.map(([value, label]) => (
                              <option value={value} key={value}>{label}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    {/* PINNED COSTING AUDIT RECEIPT */}
                    <div className="clipboard-costing-receipt">
                      <div className="costing-receipt-pinned-tab">
                        <span className="costing-pin-rivet" />
                        <span className="costing-receipt-badge-title">COSTING & VALUE AUDIT</span>
                      </div>

                      <div className="costing-receipt-hero">
                        <div className="costing-receipt-hero-lead">
                          <span className="costing-receipt-caption">CALCULATED UNIT COST</span>
                          <strong className="costing-receipt-price">
                            ₱{formatUnitCost(liveUnitCost)}
                            <span className="costing-receipt-unit"> / {formValues.unit || "unit"}</span>
                          </strong>
                        </div>
                        <span className="costing-receipt-status-pill">
                          {liveUnitCost > 0 ? "Cost Verified" : "Awaiting Data"}
                        </span>
                      </div>

                      <div className="costing-receipt-metrics-grid">
                        <div className="costing-receipt-metric-cell">
                          <span className="receipt-cell-label">BATCH INFLOW</span>
                          <strong className="receipt-cell-value">
                            {liveTotalMeasurable > 0 ? liveTotalMeasurable.toLocaleString() : "0"} {formValues.unit}
                          </strong>
                        </div>
                        <div className="costing-receipt-metric-cell">
                          <span className="receipt-cell-label">PURCHASE OUTLAY</span>
                          <strong className="receipt-cell-value">₱{livePurchasePrice.toFixed(2)}</strong>
                        </div>
                        <div className="costing-receipt-metric-cell">
                          <span className="receipt-cell-label">TOTAL VALUATION</span>
                          <strong className="receipt-cell-value">₱{liveInventoryValue.toFixed(2)}</strong>
                        </div>
                      </div>

                      <div className="costing-receipt-formula-box">
                        <span className="costing-formula-icon">∑</span>
                        <p className="costing-formula-text">
                          {livePurchasePrice > 0 && liveContents <= 0
                            ? "Enter the measurable contents in each package to calculate an accurate unit cost."
                            : `Unit Cost = Purchase Price (₱${livePurchasePrice.toFixed(2)}) ÷ (${livePkgQty} ${formValues.packageUnit} × ${liveContents || 1} ${formValues.unit}) = ₱${formatUnitCost(liveUnitCost)} per ${formValues.unit}`}
                        </p>
                      </div>
                    </div>
                  </div>
                </article>

              </div>

              {actionError && <p className="inventory-form-error" role="alert">{actionError}</p>}
            </div>

            {/* List Board Bottom Rail / Actions */}
            <div className="admin-inventory-modal-actions clipboard-actions">
              <div className="clipboard-actions-status">
                <span className="clipboard-status-dot" />
                <span>Auto-calculates POS recipe deduction rates & batch valuation</span>
              </div>
              <div className="clipboard-actions-btns">
                {hasAddDraft && (
                  <button
                    type="button"
                    className="clipboard-btn-cancel"
                    style={{ color: "#8b5e3c", borderColor: "#e8dfd5" }}
                    onClick={() => {
                      if (window.confirm("Discard your saved draft and reset the form?")) {
                        clearInventoryAddDraft();
                        setFormValues(createEmptyInventoryForm());
                      }
                    }}
                    title="Clear current unsaved draft"
                  >
                    Clear Draft
                  </button>
                )}
                <button type="button" className="clipboard-btn-cancel" onClick={resetForm}>
                  Cancel
                </button>
                <button type="submit" className="clipboard-btn-save" disabled={isSaving}>
                  <Check size={16} strokeWidth={2.4} />
                  <span>{isSaving ? "Saving…" : editingItem ? "Save Changes" : "Save Item"}</span>
                </button>
              </div>
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
                        <div>
                          <strong>
                            {row.type === "usage"
                              ? "Order usage"
                              : row.type === "restock"
                                ? "Restocked"
                                : row.type === "spoilage"
                                  ? "Void spoilage"
                                  : row.type === "void_restore"
                                    ? "Void stock restore"
                                    : row.type === "opening_balance"
                                      ? "Opening stock"
                                      : "Stock adjustment"}
                          </strong>
                          <span>{row.note || "Inventory updated"}</span>
                          <small>{row.actor} · {new Date(row.timestamp).toLocaleString()}</small>
                        </div>
                        <b className={row.quantityChange > 0 ? "is-increase" : "is-decrease"}>{row.quantityChange > 0 ? "+" : ""}{row.quantityChange} {movementHistory.item.unit}</b>
                      </article>
                    ))}
                  </div>
                ) : <p className="inventory-history-empty">No stock movements recorded yet.</p>}
          </section>
        </div>
      )}

      {restockItem && (
        <div className="admin-inventory-modal-backdrop" role="presentation" onClick={() => { if (!isSaving) { setRestockItem(null); setRestockBatchCost(""); setRestockSupplierName(""); setRestockReferenceNo(""); } }}>
          <form className="admin-inventory-modal inventory-action-modal" onSubmit={handleRestock} role="dialog" aria-modal="true" aria-labelledby="restock-dialog-title" onClick={(event) => event.stopPropagation()}>
            <div className="admin-inventory-modal-header">
              <div>
                <span className="admin-inventory-eyebrow">STOCK MOVEMENT</span>
                <h3 id="restock-dialog-title">Restock {restockItem.item}</h3>
                <p>Current: {restockItem.quantity} {restockItem.unit} · Maximum: {restockItem.maximumStock == null ? "Not set" : `${restockItem.maximumStock} ${restockItem.unit}`}</p>
              </div>
              <button type="button" onClick={() => { setRestockItem(null); setRestockBatchCost(""); setRestockSupplierName(""); setRestockReferenceNo(""); }} disabled={isSaving} aria-label="Close restock form">×</button>
            </div>
            <label className="inventory-restock-field">
              Quantity to add ({restockItem.unit})
              <input autoFocus type="number" min="0.01" step="any" value={restockQuantity} onChange={(event) => setRestockQuantity(event.target.value)} required />
              <small>This amount will be added to the current stock and recorded as a restock.</small>
            </label>
            <label className="inventory-restock-field" style={{ marginTop: "0.75rem" }}>
              Total paid for this batch (₱) — Optional
              <input
                type="number"
                min="0"
                step="0.01"
                value={restockBatchCost}
                onChange={(event) => setRestockBatchCost(event.target.value)}
                placeholder="Leave blank to keep current unit cost"
              />
              <small>Enter total batch cost to recalculate weighted-average unit cost.</small>
            </label>
            {restockBatchCost !== "" && Number(restockBatchCost) > 0 && (
              <label className="inventory-restock-field" style={{ marginTop: "0.75rem" }}>
                Payment / Funding Source
                <select
                  value={restockCreditAccountCode}
                  onChange={(event) => setRestockCreditAccountCode(event.target.value)}
                >
                  <option value="1010">1010 - Cash Drawer (Counter 1)</option>
                  <option value="1020">1020 - GCash Official Wallet</option>
                  <option value="1030">1030 - Store Bank Account</option>
                  <option value="1040">1040 - Owner Capital Reserve</option>
                  <option value="2010">2010 - Accounts Payable (Supplier Credit)</option>
                  <option value="3010">3010 - Owner Capital Contribution</option>
                </select>
                <small>Credits the selected account and debits 1050 Merchandise Inventory.</small>
              </label>
            )}
            {restockBatchCost !== "" && Number(restockBatchCost) === 0 && (
              <label className="inventory-restock-checkbox" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.75rem", fontSize: "0.84rem" }}>
                <input
                  type="checkbox"
                  checked={restockDiluteZeroCost}
                  onChange={(event) => setRestockDiluteZeroCost(event.target.checked)}
                />
                <span>Dilute weighted-average unit cost with ₱0 free/bonus batch</span>
              </label>
            )}
            <div className="inventory-restock-meta-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginTop: "0.75rem" }}>
              <label className="inventory-restock-field">
                Supplier Name — Optional
                <input
                  type="text"
                  maxLength={120}
                  value={restockSupplierName}
                  onChange={(event) => setRestockSupplierName(event.target.value)}
                  placeholder="e.g. Bukidnon Dairy"
                />
              </label>
              <label className="inventory-restock-field">
                Reference / Receipt No. — Optional
                <input
                  type="text"
                  maxLength={80}
                  value={restockReferenceNo}
                  onChange={(event) => setRestockReferenceNo(event.target.value)}
                  placeholder="e.g. INV-2026-041"
                />
              </label>
            </div>
            {(Number(restockBatchCost) > 0 || (restockBatchCost !== "" && Number(restockBatchCost) === 0 && restockDiluteZeroCost)) && Number(restockQuantity) > 0 && (
              <div className="inventory-costing-preview-box" style={{ marginTop: "0.75rem" }}>
                <div className="costing-preview-header">
                  <span className="costing-preview-title">Weighted-Average Cost Preview</span>
                  <span className="costing-preview-badge">
                    ₱{formatUnitCost(((Math.max(0, Number(restockItem.quantity || 0)) * Number(restockItem.unitCost || 0)) + Number(restockBatchCost || 0)) / (Math.max(0, Number(restockItem.quantity || 0)) + Number(restockQuantity)))} / {restockItem.unit}
                  </span>
                </div>
                <div className="costing-preview-metrics">
                  <div>
                    <small>Current Unit Cost</small>
                    <strong>₱{formatUnitCost(restockItem.unitCost)} / {restockItem.unit}</strong>
                  </div>
                  <div>
                    <small>Batch Unit Cost</small>
                    <strong>₱{formatUnitCost(Number(restockBatchCost || 0) / Number(restockQuantity))} / {restockItem.unit}</strong>
                  </div>
                  <div>
                    <small>New Weighted-Average Cost</small>
                    <strong>
                      ₱{formatUnitCost(((Math.max(0, Number(restockItem.quantity || 0)) * Number(restockItem.unitCost || 0)) + Number(restockBatchCost || 0)) / (Math.max(0, Number(restockItem.quantity || 0)) + Number(restockQuantity)))} / {restockItem.unit}
                    </strong>
                  </div>
                </div>
              </div>
            )}
            {actionError && <p className="inventory-form-error" role="alert">{actionError}</p>}
            <div className="admin-inventory-modal-actions">
              <button type="button" className="modal-cancel" onClick={() => { setRestockItem(null); setRestockBatchCost(""); setRestockSupplierName(""); setRestockReferenceNo(""); }} disabled={isSaving}>Cancel</button>
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
