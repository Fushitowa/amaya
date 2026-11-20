import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  PackageMinus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import LogWasteModal from "../../components/LogWasteModal.jsx";
import { useSidebar } from "../../context/useSidebar.jsx";
import { getInventoryStatus, useInventory } from "../../context/InventoryContext.jsx";
import { useBusiness } from "../../context/BusinessContext.jsx";
import { apiRequest } from "../../utils/api.js";
import { createClientRequestId } from "../../utils/clientRequestId.js";
import { formatUnitCost } from "../../utils/inventoryFormatting.js";
import { getStockHealth } from "../../utils/stockHealth.js";
import {
  InventoryArchiveConfirmModal,
  InventoryInternalUseModal,
  InventoryMovementHistoryModal,
  InventoryRestockModal,
} from "../../components/admin/inventory/InventoryActionModals.jsx";
import "../../assets/css/admin/AdminInventory.css";
import "../../assets/css/admin/MenuNotebook.css";
import "../../assets/css/admin/InventoryNotebook.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";
import { shrinkImageToDataUri } from "../../utils/imageResize.js";

const inventoryUnitGroups = [
  { label: "Weight", options: [["mg", "Milligrams (mg)"], ["g", "Grams (g)"], ["hg", "Hectograms (hg)"], ["kg", "Kilograms (kg)"], ["oz", "Ounces (oz)"], ["lb", "Pounds (lb)"]] },
  { label: "Volume", options: [["ml", "Milliliters (ml)"], ["cl", "Centiliters (cl)"], ["dl", "Deciliters (dl)"], ["l", "Liters (L)"], ["tsp", "Teaspoons (tsp)"], ["tbsp", "Tablespoons (tbsp)"], ["fl oz", "Fluid ounces (fl oz)"], ["cup", "Cups"], ["pt", "Pints (pt)"], ["qt", "Quarts (qt)"], ["gal", "Gallons (gal)"], ["cc", "Cubic centimeters (cc)"]] },
  { label: "Count", options: [["pcs", "Pieces (pcs)"], ["can", "Cans (can)"], ["pair", "Pairs"], ["dozen", "Dozen"]] },
];
const INTERNAL_USE_QUICK_PICKS = [
  { code: "6113", title: "Staff Meals", subtitle: "Crew food & drinks" },
  { code: "6144", title: "Sanitation (6144)", subtitle: "Cleaners, disinfectants" },
  { code: "6140", title: "Operating Supplies", subtitle: "Cups, straws, paper (6140)" },
  { code: "6133", title: "LPG / Gas (6133)", subtitle: "Kitchen gas, stove fuel" },
];

const INTERNAL_USE_OPTIONS = [
  { code: "6113", label: "6113 - Employee Benefits (Staff Meals)", hint: "Logs under Labor & Payroll OPEX. Keeps Customer COGS (5010) and Food Spoilage (6030) clean." },
  { code: "6144", label: "6144 - Sanitation Supplies (Cleaners, Disinfectants)", hint: "Logs under Operating Supplies OPEX (Sanitation)." },
  { code: "6140", label: "6140 - Operating Supplies (Paper Goods, Store Supplies)", hint: "Logs under Operating Supplies OPEX." },
  { code: "6141", label: "6141 - Linen & Uniforms (Towels, Aprons)", hint: "Logs under Operating Supplies OPEX (Linen & Uniforms)." },
  { code: "6142", label: "6142 - Dining Supplies (Utensils, Trays, Glasses)", hint: "Logs under Operating Supplies OPEX (Dining Supplies)." },
  { code: "6143", label: "6143 - Kitchen Supplies (Tools, Containers)", hint: "Logs under Operating Supplies OPEX (Kitchen Supplies)." },
  { code: "6133", label: "6133 - LPG / Cooking Gas", hint: "Logs under Utilities OPEX (LPG / Cooking Gas)." },
  { code: "6130", label: "6130 - Utilities (General Store Fuel / Utilities)", hint: "Logs under Utilities OPEX." },
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

const InventoryGridCard = memo(function InventoryGridCard({
  row,
  onHistory,
  onEdit,
  onRestock,
  onInternalUse,
  onWaste,
  onArchive,
}) {
  const noStock = Number(row.quantity || 0) <= 0;
  return (
    <article
      className={`nb-card nbi-card ${row.cardStatusKey}`}
      style={{ cursor: "pointer" }}
      tabIndex={0}
      onClick={(e) => {
        if (e.target.closest("button, a, input, select, textarea")) return;
        onEdit(row);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit(row);
        }
      }}
    >
      <span className="nb-tape" aria-hidden="true" />
      <div className="nb-photo nbi-photo">
        {row.image ? (
          <img src={row.image} alt={row.item} loading="lazy" decoding="async" />
        ) : (
          <span className="nbi-photo-empty" aria-hidden="true"><Package size={30} strokeWidth={1.5} /></span>
        )}
        <span className="nbi-cat">{row.category}</span>
        <span className={`nbi-status ${row.cardStatusKey}`}>{row.cardStatus}</span>
        {row.addedFromMenu && <span className="nbi-recipe">Recipe</span>}
      </div>

      <div className="nb-card-body">
        <h3 className="nbi-name" title={row.item}>{row.item}</h3>
        <p className="nbi-sub">
          <span title="Calculated unit cost">₱{formatUnitCost(row.unitCost)} / {row.unit}</span>
          {row.packageQuantity && row.contentsPerPackage ? (
            <>
              <span aria-hidden="true"> · </span>
              <span title="Package specification">{row.packageSpec}</span>
            </>
          ) : null}
        </p>

        <div className="nbi-stock">
          <div className="nbi-stock-row">
            <p className="nbi-qty">{row.quantity}<span>{row.unit}</span></p>
            <p className="nbi-value">
              <strong>₱{Number(row.inventoryValue || 0).toFixed(2)}</strong>
              <small>{row.maximumStock == null ? "No max set" : `of ${row.maximumStock} ${row.unit}`}</small>
            </p>
          </div>
          <div
            className={`nbi-gauge${row.stockRatio == null ? " no-maximum" : ""} ${row.stockLevelKey}`}
            role="progressbar"
            aria-valuenow={row.stockRatio == null ? undefined : row.stockRatio}
            aria-valuetext={row.stockRatio == null ? "No maximum set" : `${row.stockRatio}% of maximum stock${row.isLowStock ? ", low stock" : ""}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${row.item} stock level`}
            title={row.stockRatio == null ? "Set maximum stock to track this level" : `${row.stockRatio}% of maximum stock`}
          >
            {row.stockRatio == null ? null : <span style={{ width: `${row.stockRatio}%` }} />}
          </div>
        </div>

        <div className="nbi-actions">
          <button type="button" className="nbi-act primary" onClick={() => onRestock(row)} title={`Restock ${row.item}`}>
            <Warehouse aria-hidden="true" size={14} strokeWidth={2.1} /><span>Restock</span>
          </button>
          <button type="button" className="nbi-act icon" onClick={() => onInternalUse(row)} disabled={noStock}
            aria-label={`Use ${row.item}`}
            title={noStock ? `${row.item} is out of stock` : `Use: record internal store use of ${row.item}`}>
            <PackageMinus aria-hidden="true" size={15} strokeWidth={2.1} />
          </button>
          <button type="button" className="nbi-act icon warn" onClick={() => onWaste(row)} disabled={noStock}
            aria-label={`Log waste for ${row.item}`}
            title={noStock ? `${row.item} is out of stock` : `Waste: log spoilage of ${row.item}`}>
            <Trash2 aria-hidden="true" size={15} strokeWidth={2.1} />
          </button>
          <button type="button" className="nbi-act icon" onClick={() => onHistory(row)} aria-label={`Stock history for ${row.item}`} title="History">
            <History aria-hidden="true" size={15} strokeWidth={2.1} />
          </button>
          <button type="button" className="nbi-act icon" onClick={() => onEdit(row)} aria-label={`Edit ${row.item}`} title="Edit">
            <Pencil aria-hidden="true" size={15} strokeWidth={2.1} />
          </button>
          <button type="button" className="nbi-act icon danger" onClick={() => onArchive(row.id)} aria-label={`Archive ${row.item}`} title="Archive">
            <Archive aria-hidden="true" size={15} strokeWidth={2.1} />
          </button>
        </div>
      </div>
    </article>
  );
});

const InventoryListRow = memo(function InventoryListRow({
  row,
  onHistory,
  onEdit,
  onRestock,
  onInternalUse,
  onWaste,
  onArchive,
}) {
  const noStock = Number(row.quantity || 0) <= 0;
  return (
    <article className={`nbi-row ${row.cardStatusKey}`} role="listitem">
      <div className="nbi-row-id">
        {row.image ? (
          <img src={row.image} alt={row.item} className="nbi-thumb" loading="lazy" decoding="async" width={52} height={52} />
        ) : (
          <span className="nbi-thumb nbi-thumb-empty" aria-hidden="true"><Package size={20} strokeWidth={1.6} /></span>
        )}
        <div className="nbi-row-name">
          <div className="nbi-row-title">
            <strong title={row.item}>{row.item}</strong>
            <span className="nbi-cat-inline">{row.category}</span>
            {row.addedFromMenu && <span className="nbi-recipe-inline">Recipe</span>}
          </div>
          <span className="nbi-sub">
            ₱{formatUnitCost(row.unitCost)} / {row.unit}
            {row.packageSpec && row.packageSpec !== "—" ? ` · ${row.packageSpec}` : ""}
          </span>
        </div>
      </div>

      <div className="nbi-row-stock">
        <div className="nbi-row-qty">
          <strong>{row.quantity}</strong> {row.unit}
          <span>{row.maximumStock == null ? "No max" : `/ ${row.maximumStock} ${row.unit}`}</span>
        </div>
        <div
          className={`nbi-gauge${row.stockRatio == null ? " no-maximum" : ""} ${row.stockLevelKey}`}
          role="progressbar"
          aria-valuenow={row.stockRatio == null ? undefined : row.stockRatio}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${row.item} stock level`}
        >
          {row.stockRatio == null ? null : <span style={{ width: `${row.stockRatio}%` }} />}
        </div>
      </div>

      <div className="nbi-row-value">
        <span className="nbi-label">Worth</span>
        <strong>₱{Number(row.inventoryValue || 0).toFixed(2)}</strong>
      </div>
      <span className={`nbi-status inline ${row.cardStatusKey}`}>{row.cardStatus}</span>

      <div className="nbi-actions row">
        <button type="button" className="nbi-act primary" onClick={() => onRestock(row)} title={`Restock ${row.item}`}>
          <Warehouse aria-hidden="true" size={14} strokeWidth={2.1} /><span>Restock</span>
        </button>
        <button type="button" className="nbi-act" onClick={() => onInternalUse(row)} disabled={noStock}
          title={noStock ? `${row.item} is out of stock` : `Record internal store use for ${row.item}`}>
          <PackageMinus aria-hidden="true" size={14} strokeWidth={2.1} /><span>Use</span>
        </button>
        <button type="button" className="nbi-act warn" onClick={() => onWaste(row)} disabled={noStock}
          title={noStock ? `${row.item} is out of stock` : `Log waste or spoilage on ${row.item}`}>
          <Trash2 aria-hidden="true" size={14} strokeWidth={2.1} /><span>Waste</span>
        </button>
        <button type="button" className="nbi-act" onClick={() => onHistory(row)} title={`View ${row.item} stock history`}>
          <History aria-hidden="true" size={14} strokeWidth={2.1} /><span>History</span>
        </button>
        <button type="button" className="nbi-act" onClick={() => onEdit(row)} title={`Edit ${row.item}`}>
          <Pencil aria-hidden="true" size={14} strokeWidth={2.1} /><span>Edit</span>
        </button>
        <button type="button" className="nbi-act icon danger" onClick={() => onArchive(row.id)} title="Archive" aria-label={`Archive ${row.item}`}>
          <Archive aria-hidden="true" size={14} strokeWidth={2.1} />
        </button>
      </div>
    </article>
  );
});

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
    recordInternalUse,
    reverseInternalUse,
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
  // /admin/inventory?new=1 (used by the menu form) opens the Add item form straight away
  const [showForm, setShowForm] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1");
  const [editingItem, setEditingItem] = useState(null);
  const [restockItem, setRestockItem] = useState(null);
  const [restockQuantity, setRestockQuantity] = useState("");
  const [restockBatchCost, setRestockBatchCost] = useState("");
  const [restockSupplierName, setRestockSupplierName] = useState("");
  const [restockReferenceNo, setRestockReferenceNo] = useState("");
  const [restockCreditAccountCode, setRestockCreditAccountCode] = useState("1010");
  const [restockDiluteZeroCost, setRestockDiluteZeroCost] = useState(false);
  const [itemToDelete, setItemToDelete] = useState(null);
  const [wasteItem, setWasteItem] = useState(null);
  const [internalUseItem, setInternalUseItem] = useState(null);
  const [internalUseQty, setInternalUseQty] = useState("");
  const [internalUseAccount, setInternalUseAccount] = useState("6144");
  const [internalUseNote, setInternalUseNote] = useState("");
  const [internalUseRequestId, setInternalUseRequestId] = useState("");
  const [movementHistory, setMovementHistory] = useState({ item: null, rows: [], loading: false, error: "" });
  const [reverseInternalTarget, setReverseInternalTarget] = useState(null);
  const [reverseInternalReason, setReverseInternalReason] = useState("");
  const [reverseInternalError, setReverseInternalError] = useState("");
  const reverseInternalInputRef = useRef(null);
  const saveRequestIdRef = useRef(null);
  const restockRequestIdRef = useRef(null);
  const [actionError, setActionError] = useState("");
  const [confirmedAdjKey, setConfirmedAdjKey] = useState("");
  const [notice, setNotice] = useState("");
  const [inventoryAlertsEnabled] = useState(readInventoryAlertPreference);
  const [isSaving, setIsSaving] = useState(false);
  const [formValues, setFormValues] = useState(loadInventoryAddDraft);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // The ?new=1 link has done its job once the form is open, so a reload does not reopen the form
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, []);

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

  const createInternalUseRequestId = useCallback(() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      throw new Error("Cryptographic random generator unavailable.");
    }
    return `use-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }, []);

  const closeInternalUseModal = useCallback(() => {
    setInternalUseItem(null);
    setInternalUseQty("");
    setInternalUseNote("");
    setInternalUseRequestId("");
    setActionError("");
  }, []);

  const resetRestockState = useCallback(() => {
    restockRequestIdRef.current = null;
    setRestockItem(null);
    setRestockQuantity("");
    setRestockBatchCost("");
    setRestockSupplierName("");
    setRestockReferenceNo("");
    setRestockCreditAccountCode("1010");
    setRestockDiluteZeroCost(false);
    setActionError("");
  }, []);

  const closeRestockModal = useCallback(() => {
    if (isSaving) return;
    resetRestockState();
  }, [isSaving, resetRestockState]);

  useEffect(() => {
    if (!showForm && !restockItem && !internalUseItem && !itemToDelete && !movementHistory.item) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== "Escape" || isSaving) return;
      if (showForm) {
        saveRequestIdRef.current = null;
        setShowForm(false);
        if (editingItem) {
          setEditingItem(null);
          setFormValues(loadInventoryAddDraft());
        }
      }
      resetRestockState();
      closeInternalUseModal();
      setItemToDelete(null);
      setReverseInternalTarget(null);
      setReverseInternalReason("");
      setReverseInternalError("");
      setMovementHistory({ item: null, rows: [], loading: false, error: "" });
      setActionError("");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showForm, editingItem, restockItem, internalUseItem, itemToDelete, movementHistory.item, isSaving, closeInternalUseModal, resetRestockState]);

  const resetForm = () => {
    if (isSaving) return;
    saveRequestIdRef.current = null;
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
    saveRequestIdRef.current = createClientRequestId("inv");
    setActionError("");
    setFormValues(loadInventoryAddDraft());
    setShowForm(true);
  };

  const handleEdit = useCallback((item) => {
    setEditingItem(item);
    saveRequestIdRef.current = null;
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
  }, []);

  const requestDelete = useCallback((id) => {
    setItemToDelete(inventory.find((entry) => entry.id === id) || null);
    setActionError("");
  }, [inventory]);

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

  const openRestock = useCallback((item) => {
    restockRequestIdRef.current = createClientRequestId("rst");
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
  }, []);

  const openWaste = useCallback((item) => {
    setWasteItem(item);
    setActionError("");
  }, []);

  const openInternalUse = useCallback((item) => {
    setInternalUseItem(item);
    setInternalUseQty("");
    setInternalUseAccount("6113");
    setInternalUseNote("");
    setInternalUseRequestId(createInternalUseRequestId());
    setActionError("");
  }, [createInternalUseRequestId]);

  const handleInternalUseSubmit = async (event) => {
    event.preventDefault();
    if (!internalUseItem || isSaving) return;
    const qty = Number(internalUseQty);
    const available = Number(internalUseItem.quantity || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      setActionError("Enter a valid store use quantity greater than zero.");
      return;
    }
    if (qty > available) {
      setActionError(`Only ${available} ${internalUseItem.unit} available on hand.`);
      return;
    }
    const reqId = internalUseRequestId || createInternalUseRequestId();
    if (!internalUseRequestId) setInternalUseRequestId(reqId);
    setIsSaving(true);
    setActionError("");
    try {
      const saved = await recordInternalUse(internalUseItem.id, {
        quantity: qty,
        expenseAccountCode: internalUseAccount,
        note: internalUseNote.trim(),
        clientRequestId: reqId,
      });
      setNotice(`Recorded internal store use: -${qty} ${internalUseItem.unit} of ${internalUseItem.item} (${internalUseAccount}${saved?.usageValue ? ` · ₱${Number(saved.usageValue).toFixed(2)}` : ""}).`);
      closeInternalUseModal();
    } catch (error) {
      setActionError(error.message || "Could not record internal store use.");
    } finally {
      setIsSaving(false);
    }
  };

  const closeMovementHistory = useCallback(() => {
    setMovementHistory({ item: null, rows: [], loading: false, error: "" });
    setReverseInternalTarget(null);
    setReverseInternalReason("");
    setReverseInternalError("");
  }, []);

  useEffect(() => {
    if (reverseInternalTarget) {
      window.requestAnimationFrame(() => {
        reverseInternalInputRef.current?.focus();
      });
    }
  }, [reverseInternalTarget]);

  const openMovementHistory = useCallback(async (item) => {
    setReverseInternalTarget(null);
    setReverseInternalReason("");
    setReverseInternalError("");
    setMovementHistory({ item, rows: [], loading: true, error: "" });
    try {
      const rows = await apiRequest(`/inventory/${item.id}/movements?limit=50`);
      setMovementHistory({ item, rows, loading: false, error: "" });
    } catch (error) {
      setMovementHistory({ item, rows: [], loading: false, error: error.message || "Could not load stock history." });
    }
  }, []);

  const handleConfirmReverseInternalUse = async (event) => {
    event.preventDefault();
    if (!reverseInternalTarget || !reverseInternalUse || isSaving) return;
    const cleanReason = reverseInternalReason.trim();
    if (cleanReason.length < 3) {
      setReverseInternalError("Enter a clear reversal reason (at least 3 characters).");
      return;
    }
    setIsSaving(true);
    setReverseInternalError("");
    try {
      const res = await reverseInternalUse(reverseInternalTarget.id, cleanReason);
      setNotice(`Reversed internal store use #${reverseInternalTarget.id} (+${res?.restoredQuantity} ${res?.unit || ""} restored).`);
      const targetItem = movementHistory.item;
      setReverseInternalTarget(null);
      setReverseInternalReason("");
      if (targetItem) {
        try {
          const rows = await apiRequest(`/inventory/${targetItem.id}/movements?limit=50`);
          setMovementHistory({ item: targetItem, rows, loading: false, error: "" });
        } catch (refreshError) {
          setMovementHistory((prev) => ({
            ...prev,
            loading: false,
            error: refreshError?.message || "Reversal saved, but could not refresh stock history.",
          }));
        }
      }
    } catch (error) {
      setReverseInternalError(error?.message || "Could not reverse internal store use entry.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestock = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    const quantity = Number(restockQuantity);
    if (!restockItem || !Number.isFinite(quantity) || quantity <= 0) {
      setActionError("Enter a restock quantity greater than zero.");
      return;
    }
    if (restockBatchCost !== "" && (!Number.isFinite(Number(restockBatchCost)) || Number(restockBatchCost) < 0)) {
      setActionError("Enter a valid non-negative batch cost.");
      return;
    }
    if (!restockRequestIdRef.current) {
      restockRequestIdRef.current = createClientRequestId("rst");
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
        clientRequestId: restockRequestIdRef.current,
      });
      restockRequestIdRef.current = null;
      setNotice(`${restockItem.item} restocked by ${quantity} ${restockItem.unit}.`);
      resetRestockState();
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
    shrinkImageToDataUri(file)
      .then((dataUri) => {
        setFormValues((prev) => ({ ...prev, image: dataUri }));
        setActionError("");
      })
      .catch((error) => setActionError(error?.message || "Could not read image file."));
  };

  const handleImageDrop = (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) handleImageFile(file);
  };

  const handleSave = async (event) => {
    event.preventDefault();
    if (isSaving) return;

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

    if (!editingItem && !saveRequestIdRef.current) {
      saveRequestIdRef.current = createClientRequestId("inv");
    }
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
        ...(!editingItem && saveRequestIdRef.current ? { clientRequestId: saveRequestIdRef.current } : {}),
      };
      if (editingItem) savedItem = await updateInventoryItem(editingItem.id, values);
      else savedItem = await addInventoryItem(values);
      saveRequestIdRef.current = null;
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
                <button
                  type="button"
                  className="internal-use"
                  disabled={Number(actionRow.quantity || 0) <= 0}
                  onClick={() => { openInternalUse(actionRow); setActionRow(null); }}
                >
                  <PackageMinus size={22} aria-hidden="true" />
                  <span>
                    Record store use{Number(actionRow.quantity || 0) <= 0 ? " (Out of stock)" : ""}
                  </span>
                </button>
                <button
                  type="button"
                  className="waste"
                  disabled={Number(actionRow.quantity || 0) <= 0}
                  onClick={() => { openWaste(actionRow); setActionRow(null); }}
                >
                  <Trash2 size={22} aria-hidden="true" />
                  <span>
                    Log waste / spoilage{Number(actionRow.quantity || 0) <= 0 ? " (Out of stock)" : ""}
                  </span>
                </button>
                <button type="button" onClick={() => { handleEdit(actionRow); setActionRow(null); }}><Pencil size={22} aria-hidden="true" />Edit item</button>
                <button type="button" className="danger" onClick={() => { requestDelete(actionRow.id); setActionRow(null); }}><Archive size={22} aria-hidden="true" />Archive item</button>
              </div>
            </div>
          )}
        </main>
      ) : (
      <main className="admin-inventory-main nb-main">
        <div className="nb-desk">
          <section className="nb-notebook" aria-label="Inventory ingredients">
            <div className="nb-spiral" aria-hidden="true" />

            <div className="nb-page">
              <header className="nb-head">
                <span className="nb-crest" aria-hidden="true">
                  <Warehouse size={20} strokeWidth={2} />
                </span>
                <div className="nb-head-copy">
                  <h1>Inventory management</h1>
                  <p>
                    Track ingredients, packaging, and supplies needed for your daily operations.
                    <span className="nb-live"><span className="nb-live-dot" aria-hidden="true" />{inStockCount} of {totalItems} in stock</span>
                  </p>
                </div>
                <div className="nb-head-actions">
                  {inventoryAlertsEnabled && overMaximumCount + outOfStockCount > 0 && (
                    <span className="nb-chip nb-chip-alert" role="status">
                      <AlertTriangle size={14} strokeWidth={2.2} aria-hidden="true" />
                      {outOfStockCount + overMaximumCount} need attention
                      <Link to="/admin/reports" className="nbi-chip-link">Review report</Link>
                    </span>
                  )}
                  <Link to="/admin/archive" className="nb-btn">
                    <Archive size={15} strokeWidth={2.1} aria-hidden="true" />
                    View archive
                  </Link>
                  <button type="button" className="nb-btn nb-btn-primary" onClick={handleOpenAddForm}>
                    <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
                    Add inventory item
                  </button>
                </div>
              </header>

              {notice && (
                <div className="nbi-banner ok" role="status">
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>{notice}</span>
                  <button type="button" onClick={() => setNotice("")} aria-label="Dismiss message">×</button>
                </div>
              )}
              {inventoryError && inventory.length > 0 && (
                <div className="nbi-banner warn" role="status">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>Showing saved inventory. The latest refresh failed: {inventoryError}</span>
                  <button type="button" onClick={() => refreshInventory?.().catch(() => {})}>
                    <RefreshCw size={13} aria-hidden="true" /> Retry
                  </button>
                </div>
              )}

              <div className="nb-toolbar">
                <div className="nb-tabs" role="group" aria-label="View mode">
                  <button
                    type="button"
                    className={`nb-tab ${viewMode === "grid" ? "is-active" : ""}`}
                    onClick={() => setViewMode("grid")}
                    aria-pressed={viewMode === "grid"}
                    title="Grid view"
                  >
                    <LayoutGrid aria-hidden="true" size={15} strokeWidth={2.2} />
                    Cards
                  </button>
                  <button
                    type="button"
                    className={`nb-tab ${viewMode === "list" ? "is-active" : ""}`}
                    onClick={() => setViewMode("list")}
                    aria-pressed={viewMode === "list"}
                    title="List view"
                  >
                    <List aria-hidden="true" size={15} strokeWidth={2.2} />
                    List
                  </button>
                  <Link to="/admin/categories" className="nb-tab nb-tab-manage" title="Manage categories">
                    <Settings2 size={13} strokeWidth={2.1} aria-hidden="true" />
                    Manage categories
                  </Link>
                </div>
                <div className="nb-tools">
                  <label className="nb-field nb-search">
                    <Search aria-hidden="true" size={14} strokeWidth={2.2} />
                    <input
                      type="text"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search inventory items"
                      aria-label="Search inventory"
                    />
                    {search && (
                      <button type="button" className="nb-search-clear" onClick={() => setSearch("")} aria-label="Clear search">
                        <X size={13} strokeWidth={2.2} aria-hidden="true" />
                      </button>
                    )}
                  </label>
                  <label className="nb-field nb-sort">
                    <span className="nbi-field-label">Category</span>
                    <select
                      value={activeCategory}
                      onChange={(event) => setActiveCategory(event.target.value)}
                      aria-label="Filter inventory by category"
                    >
                      {categories.map((category) => {
                        const count = categoryCounts[category] || 0;
                        return (
                          <option key={category} value={category}>
                            {category === "All" ? "All categories" : category} ({count})
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="nb-field nb-sort">
                    <span className="nbi-field-label">Sort</span>
                    <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="Sort inventory">
                      <option value="name">Name A–Z</option>
                      <option value="quantity-asc">Quantity: Low to high</option>
                      <option value="quantity-desc">Quantity: High to low</option>
                      <option value="status">Needs attention first</option>
                    </select>
                  </label>
                </div>
              </div>

              <div
                className="nb-sheet"
                role="region"
                aria-label="Inventory items"
                tabIndex={0}
              >
                {inventoryLoading && inventory.length === 0 ? (
                  <div className="nb-empty" role="status">
                    <RefreshCw size={24} aria-hidden="true" />
                    <strong>Loading inventory</strong>
                    <span>Fetching the latest stock levels.</span>
                  </div>
                ) : inventoryError && inventory.length === 0 ? (
                  <div className="nb-empty" role="alert">
                    <AlertTriangle size={26} aria-hidden="true" />
                    <strong>Inventory couldn’t load</strong>
                    <span>{inventoryError}</span>
                    <button type="button" className="nb-btn" onClick={() => refreshInventory?.().catch(() => {})}>
                      <RefreshCw size={14} aria-hidden="true" /> Try again
                    </button>
                  </div>
                ) : inventory.length === 0 ? (
                  <div className="nb-empty">
                    <Package size={26} strokeWidth={1.8} aria-hidden="true" />
                    <strong>No inventory items yet</strong>
                    <span>Choose “Add inventory item” to start tracking ingredients and packaging.</span>
                  </div>
                ) : rows.length === 0 ? (
                  <div className="nb-empty">
                    <Search size={24} strokeWidth={1.8} aria-hidden="true" />
                    <strong>Nothing matches this view</strong>
                    <span>
                      {search
                        ? `No items matching "${search}" in ${activeCategory === "All" ? "the catalog" : activeCategory}.`
                        : `No items in ${activeCategory}.`}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="nb-sheet-title">
                      <h2>{activeCategory === "All" ? "All categories" : activeCategory}</h2>
                      <span className="nb-sheet-note">
                        {rows.length} {rows.length === 1 ? "item" : "items"} pinned
                      </span>
                    </div>

                    {viewMode === "grid" ? (
                      <div className="nb-grid nbi-grid">
                        {rows.map((row) => (
                          <InventoryGridCard
                            key={row.id}
                            row={row}
                            onHistory={openMovementHistory}
                            onEdit={handleEdit}
                            onRestock={openRestock}
                            onInternalUse={openInternalUse}
                            onWaste={openWaste}
                            onArchive={requestDelete}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="nbi-rows" role="list">
                        {rows.map((row) => (
                          <InventoryListRow
                            key={row.id}
                            row={row}
                            onHistory={openMovementHistory}
                            onEdit={handleEdit}
                            onRestock={openRestock}
                            onInternalUse={openInternalUse}
                            onWaste={openWaste}
                            onArchive={requestDelete}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>

          <aside className="nb-notes" aria-label="Inventory overview">
            <h2 className="nb-notes-title">Inventory overview</h2>
            <article className="nb-note nb-note-butter">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><Package size={16} strokeWidth={1.9} aria-hidden="true" /><span>Total items</span></div>
              <strong>{totalItems}</strong>
              <small>Tracked inventory</small>
            </article>
            <article className="nb-note nb-note-sage">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" /><span>In stock</span></div>
              <strong>{inStockCount}</strong>
              <small>Ready to use</small>
            </article>
            <article className="nb-note nb-note-peach">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><Clock size={16} strokeWidth={2} aria-hidden="true" /><span>Above maximum</span></div>
              <strong>{overMaximumCount}</strong>
              <small>Review stock levels</small>
            </article>
            <article className="nb-note nb-note-rose">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><AlertTriangle size={16} strokeWidth={2} aria-hidden="true" /><span>Out of stock</span></div>
              <strong>{outOfStockCount}</strong>
              <small>Needs ordering</small>
            </article>
            <article className="nb-note nb-note-butter nbi-note-wide">
              <span className="nb-pin" aria-hidden="true" />
              <div className="nb-note-top"><Warehouse size={16} strokeWidth={2} aria-hidden="true" /><span>Inventory asset value</span></div>
              <strong>₱{totalInventoryAssetValue.toFixed(2)}</strong>
              <small>{totalItems} active supplies &amp; ingredients</small>
            </article>
          </aside>
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
                          <small>PNG, JPG, WEBP · resized automatically</small>
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
                            const parsedPkg = newPkgQty.trim() === "" ? 0 : Number(newPkgQty);
                            const nextTotal = Number.isFinite(parsedPkg) && parsedPkg > 0
                              ? parsedPkg * Number(formValues.contentsPerPackage || 0)
                              : 0;
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
                            const parsedPkg = formValues.packageQuantity.trim() === "" ? 0 : Number(formValues.packageQuantity);
                            const nextTotal = Number.isFinite(parsedPkg) && parsedPkg > 0
                              ? parsedPkg * Number(newContents || 0)
                              : 0;
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
                <button type="button" className="clipboard-btn-cancel" onClick={resetForm} disabled={isSaving}>
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

      <InventoryMovementHistoryModal
        movementHistory={movementHistory}
        closeMovementHistory={closeMovementHistory}
        reverseInternalTarget={reverseInternalTarget}
        setReverseInternalTarget={setReverseInternalTarget}
        reverseInternalReason={reverseInternalReason}
        setReverseInternalReason={setReverseInternalReason}
        reverseInternalError={reverseInternalError}
        setReverseInternalError={setReverseInternalError}
        reverseInternalInputRef={reverseInternalInputRef}
        handleConfirmReverseInternalUse={handleConfirmReverseInternalUse}
        reverseInternalUse={reverseInternalUse}
        isSaving={isSaving}
      />

      <InventoryRestockModal
        restockItem={restockItem}
        closeRestockModal={closeRestockModal}
        handleRestock={handleRestock}
        restockQuantity={restockQuantity}
        setRestockQuantity={setRestockQuantity}
        restockBatchCost={restockBatchCost}
        setRestockBatchCost={setRestockBatchCost}
        restockCreditAccountCode={restockCreditAccountCode}
        setRestockCreditAccountCode={setRestockCreditAccountCode}
        restockDiluteZeroCost={restockDiluteZeroCost}
        setRestockDiluteZeroCost={setRestockDiluteZeroCost}
        restockSupplierName={restockSupplierName}
        setRestockSupplierName={setRestockSupplierName}
        restockReferenceNo={restockReferenceNo}
        setRestockReferenceNo={setRestockReferenceNo}
        actionError={actionError}
        isSaving={isSaving}
      />

      <InventoryArchiveConfirmModal
        itemToDelete={itemToDelete}
        actionError={actionError}
        isSaving={isSaving}
        onCancel={() => { setItemToDelete(null); setActionError(""); }}
        onConfirm={confirmDelete}
      />

      <InventoryInternalUseModal
        internalUseItem={internalUseItem}
        closeInternalUseModal={closeInternalUseModal}
        handleInternalUseSubmit={handleInternalUseSubmit}
        quickPicks={INTERNAL_USE_QUICK_PICKS}
        accountOptions={INTERNAL_USE_OPTIONS}
        internalUseAccount={internalUseAccount}
        setInternalUseAccount={setInternalUseAccount}
        internalUseQty={internalUseQty}
        setInternalUseQty={setInternalUseQty}
        internalUseNote={internalUseNote}
        setInternalUseNote={setInternalUseNote}
        actionError={actionError}
        isSaving={isSaving}
      />

      <LogWasteModal
        isOpen={Boolean(wasteItem)}
        initialItem={wasteItem}
        onClose={() => setWasteItem(null)}
        onSuccess={(saved) => {
          if (saved) {
            setNotice(`Logged -${Math.abs(Number(saved.deductedQuantity || 0))} ${saved.unit} waste on ${saved.itemName}.`);
          }
          refreshInventory?.().catch(() => {});
        }}
      />
    </div>
  );
}

export default AdminInventory;
