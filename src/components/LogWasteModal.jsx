import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Minus,
  Package,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { useInventory } from "../context/InventoryContext.jsx";
import { usePrefersReducedMotion } from "../utils/usePrefersReducedMotion.js";
import {
  computeWasteDeduction,
  formatWasteQty,
  getCompatibleWasteUnits,
  getMeasurementMethodLabel,
  isDiscreteCountUnit,
  MEASUREMENT_METHODS,
  round2,
  WASTE_LOG_REASONS,
} from "../utils/wasteMeasurement.js";
import "../assets/css/log-waste-modal.css";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

const REASON_ICONS = {
  spoiled: Clock,
  expired: Clock,
  damaged: Trash2,
  spilled: AlertTriangle,
  other: ShieldAlert,
};

function createClientRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  const perfNow = typeof performance !== "undefined" && typeof performance.now === "function"
    ? Math.trunc(performance.now() * 1000).toString(36)
    : "0";
  return `waste-${Date.now().toString(36)}-${perfNow}`;
}

function LogWasteModalContent({
  onClose,
  initialItem = null,
  darkMode = false,
  onSuccess = null,
}) {
  const { user } = useAuth();
  const { inventory, recordInventoryWaste } = useInventory();
  const canViewCost = user?.role === "admin";
  const prefersReducedMotion = usePrefersReducedMotion();

  const dialogRef = useRef(null);
  const closeTimerRef = useRef(null);
  const lastFocusedRef = useRef(typeof document !== "undefined" ? document.activeElement : null);
  const submittingRef = useRef(false);
  const isClosingRef = useRef(false);
  const requestCloseRef = useRef(null);
  const modeTabRefs = useRef({});

  const [isClosing, setIsClosing] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState(
    initialItem?.id ? String(initialItem.id) : "",
  );
  const [showItemPicker, setShowItemPicker] = useState(!initialItem?.id);
  const [itemSearch, setItemSearch] = useState("");
  const [measurementMethod, setMeasurementMethod] = useState("direct_measure");
  const [measuredQuantity, setMeasuredQuantity] = useState("");
  const [measuredUnit, setMeasuredUnit] = useState(initialItem?.unit || "");
  const [showTare, setShowTare] = useState(false);
  const [tareWeight, setTareWeight] = useState("");
  const [wasteReason, setWasteReason] = useState("");
  const [note, setNote] = useState("");
  const [clientRequestId, setClientRequestId] = useState(() => createClientRequestId());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [validationSubmitted, setValidationSubmitted] = useState(false);

  const selectedItem = useMemo(() => {
    if (selectedItemId) {
      const liveMatch = inventory.find((it) => String(it.id) === String(selectedItemId));
      if (liveMatch) return liveMatch;
      if (initialItem && String(initialItem.id) === String(selectedItemId)) return initialItem;
    }
    return null;
  }, [initialItem, inventory, selectedItemId]);

  const compatibleUnits = useMemo(
    () => (selectedItem ? getCompatibleWasteUnits(selectedItem) : []),
    [selectedItem],
  );

  const activeUnit = useMemo(() => {
    if (measuredUnit && compatibleUnits.some((u) => u.value === measuredUnit)) {
      return measuredUnit;
    }
    return selectedItem?.unit || compatibleUnits[0]?.value || "";
  }, [compatibleUnits, measuredUnit, selectedItem]);

  const filteredItems = useMemo(() => {
    const query = itemSearch.trim().toLowerCase();
    const sorted = [...inventory].sort((a, b) => {
      const aHas = Number(a.quantity || 0) > 0 ? 0 : 1;
      const bHas = Number(b.quantity || 0) > 0 ? 0 : 1;
      if (aHas !== bHas) return aHas - bHas;
      return String(a.item || "").localeCompare(String(b.item || ""));
    });
    if (!query) return sorted;
    return sorted.filter(
      (it) =>
        String(it.item || "").toLowerCase().includes(query) ||
        String(it.category || "").toLowerCase().includes(query),
    );
  }, [inventory, itemSearch]);

  const groupedItems = useMemo(() => {
    const groups = new Map();
    filteredItems.forEach((item) => {
      const category = String(item.category || "Uncategorized").trim() || "Uncategorized";
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(item);
    });
    return Array.from(groups, ([category, items]) => ({ category, items }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }, [filteredItems]);

  const finishClose = useCallback(() => {
    const previous = lastFocusedRef.current;
    if (previous && typeof previous.focus === "function" && previous.isConnected) {
      window.requestAnimationFrame(() => previous.focus());
    }
    onClose?.();
  }, [onClose]);

  const requestClose = useCallback((force = false) => {
    if ((submittingRef.current && !force) || isClosingRef.current) return;
    if (prefersReducedMotion) {
      isClosingRef.current = true;
      finishClose();
      return;
    }
    isClosingRef.current = true;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      finishClose();
    }, 150);
  }, [finishClose, prefersReducedMotion]);

  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  useEffect(() => () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (dialogEl) {
      dialogEl.focus();
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestCloseRef.current?.();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleSelectItem = (item) => {
    setSelectedItemId(String(item.id));
    setShowItemPicker(false);
    setItemSearch("");
    setMeasurementMethod("direct_measure");
    setMeasuredUnit(item.unit || "");
    setMeasuredQuantity("");
    setTareWeight("");
    setShowTare(false);
    setSubmitError("");
    setValidationSubmitted(false);
    setClientRequestId(createClientRequestId());
  };

  const handleModeSwitch = (nextMethod) => {
    if (nextMethod === measurementMethod) return;
    setMeasurementMethod(nextMethod);
    setMeasuredQuantity("");
    setTareWeight("");
    setShowTare(false);
    setSubmitError("");
    setClientRequestId(createClientRequestId());
  };

  const handleQtyStep = (delta) => {
    const currentVal = Number.parseInt(measuredQuantity || "0", 10);
    const base = Number.isFinite(currentVal) ? currentVal : 0;
    const minVal = measurementMethod === "remaining_count" ? 0 : 1;
    const nextVal = Math.max(minVal, base + delta);
    setMeasuredQuantity(String(nextVal));
    setSubmitError("");
    setClientRequestId(createClientRequestId());
  };

  const handleApplySealedPack = () => {
    if (!selectedItem?.packageUnit) return;
    setMeasurementMethod("direct_measure");
    setMeasuredUnit(selectedItem.packageUnit);
    setMeasuredQuantity("1");
    setTareWeight("");
    setShowTare(false);
    setSubmitError("");
    setClientRequestId(createClientRequestId());
  };

  const previewCalc = useMemo(() => {
    if (!selectedItem || measuredQuantity === "") return null;
    return computeWasteDeduction({
      item: selectedItem,
      measurementMethod,
      measuredQuantity,
      measuredUnit: activeUnit,
      tareWeight: showTare && measurementMethod === "remaining_count" ? tareWeight : null,
      wasteReason: wasteReason || "spill_accident",
      note,
      beforeQuantity: Number(selectedItem.quantity || 0),
    });
  }, [
    activeUnit,
    measuredQuantity,
    measurementMethod,
    note,
    selectedItem,
    showTare,
    tareWeight,
    wasteReason,
  ]);

  const fullValidation = useMemo(() => {
    if (!selectedItem) return { ok: false, error: "Select an inventory item first." };
    return computeWasteDeduction({
      item: selectedItem,
      measurementMethod,
      measuredQuantity,
      measuredUnit: activeUnit,
      tareWeight: showTare && measurementMethod === "remaining_count" ? tareWeight : null,
      wasteReason,
      note,
      beforeQuantity: Number(selectedItem.quantity || 0),
    });
  }, [
    activeUnit,
    measuredQuantity,
    measurementMethod,
    note,
    selectedItem,
    showTare,
    tareWeight,
    wasteReason,
  ]);

  const estimatedAdminLoss = useMemo(() => {
    if (!canViewCost || !previewCalc?.ok) return null;
    const unitCost = Number(selectedItem?.unitCost ?? selectedItem?.unit_cost ?? 0);
    if (!Number.isFinite(unitCost) || unitCost <= 0) return null;
    return round2(previewCalc.deductedQuantity * unitCost);
  }, [canViewCost, previewCalc, selectedItem]);

  const isDiscreteCount = Boolean(activeUnit && isDiscreteCountUnit(activeUnit));
  const hasPackPreset = Boolean(
    selectedItem?.packageUnit && Number(selectedItem?.contentsPerPackage || 0) > 1,
  );
  const canShowTareOption =
    measurementMethod === "remaining_count" && !isDiscreteCountUnit(selectedItem?.unit);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setValidationSubmitted(true);
    setSubmitError("");

    if (!fullValidation.ok) {
      setSubmitError(fullValidation.error);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const payload = {
        measurementMethod,
        measuredQuantity: Number(measuredQuantity),
        measuredUnit: activeUnit,
        tareWeight:
          showTare && measurementMethod === "remaining_count" && tareWeight !== ""
            ? Number(tareWeight)
            : null,
        wasteReason,
        note: note.trim(),
        clientRequestId,
      };
      const saved = await recordInventoryWaste(selectedItem.id, payload);
      submittingRef.current = false;
      setSubmitting(false);
      onSuccess?.(saved);
      requestClose(true);
    } catch (err) {
      submittingRef.current = false;
      setSubmitting(false);
      setSubmitError(err?.message || "Could not record waste log. Please try again.");
    }
  };

  const resolvedDark =
    darkMode || (typeof document !== "undefined" && document.body.classList.contains("dark-mode"));

  const hasQtyError = Boolean(
    (previewCalc && !previewCalc.ok) ||
      (validationSubmitted && measuredQuantity === ""),
  );
  const hasBannerError = Boolean(submitError || (validationSubmitted && !fullValidation.ok));
  const qtyDescribedBy = [
    previewCalc && !previewCalc.ok ? "lwm-qty-error" : "",
    hasBannerError ? "lwm-submit-error" : "",
  ]
    .filter(Boolean)
    .join(" ") || undefined;
  const trimmedNoteLen = note.trim().length;
  const noteInvalid = Boolean(validationSubmitted && trimmedNoteLen > 450);

  return (
    <div
      className={`lwm-backdrop${resolvedDark ? " dark-mode" : ""}${isClosing ? " is-closing" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className="lwm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lwm-modal-title"
        tabIndex={-1}
      >
        <div className="lwm-header">
          <div className="lwm-header-title-wrap">
            <span className="lwm-header-icon" aria-hidden="true">
              <Trash2 size={20} />
            </span>
            <div>
              <h2 id="lwm-modal-title" className="lwm-title">Log Waste / Spoilage</h2>
              <p className="lwm-subtitle">
                Enter an exact count or measured amount — no percentages or guesses.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="lwm-close-btn"
            onClick={() => requestClose()}
            aria-label="Close log waste modal"
            disabled={submitting}
          >
            <X size={20} />
          </button>
        </div>

        <form className="lwm-form" onSubmit={handleSubmit} noValidate>
          <div className="lwm-body">
            {/* Step 1: Inventory Item */}
            <div className="lwm-section">
              <div className="lwm-label">
                <span>1. Inventory Item</span>
                {selectedItem && (
                  <span className="lwm-label-hint">
                    On hand: {formatWasteQty(selectedItem.quantity, selectedItem.unit)}
                  </span>
                )}
              </div>

              {selectedItem && !showItemPicker ? (
                <div className="lwm-selected-item-card">
                  <div className="lwm-selected-item-meta">
                    <span className="lwm-selected-item-name">{selectedItem.item}</span>
                    <span className="lwm-selected-item-stock">
                      {selectedItem.category} · On hand: {formatWasteQty(selectedItem.quantity, selectedItem.unit)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="lwm-item-change-btn"
                    onClick={() => setShowItemPicker(true)}
                  >
                    Change item
                  </button>
                </div>
              ) : (
                <>
                  <div className="lwm-search-wrap">
                    <Search size={16} className="lwm-search-icon" aria-hidden="true" />
                    <input
                      type="search"
                      className="lwm-input lwm-search-input"
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="Search ingredient, milk, beans, or cup..."
                      aria-label="Search inventory item for waste"
                    />
                  </div>
                  <div className="lwm-item-count" aria-live="polite">
                    {filteredItems.length} ingredient{filteredItems.length === 1 ? "" : "s"}
                    {itemSearch ? " found" : " in inventory"}
                  </div>
                  <div className="lwm-item-list" role="listbox" aria-label="Inventory items">
                    {filteredItems.length === 0 ? (
                      <div style={{ padding: "12px", fontSize: "13px", color: "var(--lwm-muted)" }}>
                        No inventory items match &ldquo;{itemSearch}&rdquo;.
                      </div>
                    ) : (
                      <>
                        {groupedItems.map(({ category, items }) => (
                          <section key={category} className="lwm-category-group" role="group" aria-label={category}>
                            <h3 className="lwm-category-heading">
                              <span>{category}</span>
                              <span className="lwm-category-count">{items.length}</span>
                            </h3>
                            <div className="lwm-item-grid">
                              {items.map((it) => {
                                const outOfStock = Number(it.quantity || 0) <= 0;
                                return (
                                  <button
                                    key={it.id}
                                    type="button"
                                    role="option"
                                    aria-selected={String(it.id) === String(selectedItemId)}
                                    className="lwm-item-option"
                                    disabled={outOfStock}
                                    onClick={() => handleSelectItem(it)}
                                  >
                                    <span className="lwm-item-option-meta">
                                      <span className="lwm-item-option-name">{it.item}</span>
                                      <span className="lwm-item-option-cat">{category}</span>
                                    </span>
                                    <span className={`lwm-item-option-qty${outOfStock ? " is-empty" : ""}`}>
                                      {outOfStock ? "Out of stock" : formatWasteQty(it.quantity, it.unit)}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </section>
                        ))}
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {selectedItem && (
              <>
                {/* Step 2: Measurement Mode */}
                <div className="lwm-section">
                  <div className="lwm-label">
                    <span>2. Measurement Mode</span>
                  </div>
                  <div
                    className="lwm-mode-tabs"
                    role="tablist"
                    aria-label="Waste measurement method"
                  >
                    {MEASUREMENT_METHODS.map((method, index) => {
                      const active = measurementMethod === method.value;
                      return (
                        <button
                          key={method.value}
                          ref={(el) => {
                            modeTabRefs.current[method.value] = el;
                          }}
                          id={`lwm-tab-${method.value}`}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          aria-controls="lwm-measure-tabpanel"
                          tabIndex={active ? 0 : -1}
                          className="lwm-mode-tab"
                          onClick={() => handleModeSwitch(method.value)}
                          onKeyDown={(e) => {
                            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                            e.preventDefault();
                            const delta = e.key === "ArrowRight" ? 1 : -1;
                            const nextIdx = (index + delta + MEASUREMENT_METHODS.length) % MEASUREMENT_METHODS.length;
                            const nextMethod = MEASUREMENT_METHODS[nextIdx];
                            handleModeSwitch(nextMethod.value);
                            modeTabRefs.current[nextMethod.value]?.focus();
                          }}
                        >
                          {getMeasurementMethodLabel(method.value, selectedItem)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  role="tabpanel"
                  id="lwm-measure-tabpanel"
                  aria-labelledby={`lwm-tab-${measurementMethod}`}
                  className="lwm-tabpanel"
                >
                  <p className="lwm-mode-helper">
                    {measurementMethod === "remaining_count"
                      ? `Weigh or count remaining stock in ${activeUnit || selectedItem.unit}. The POS calculates the exact loss from ${formatWasteQty(selectedItem.quantity, selectedItem.unit)}.`
                      : `Enter the exact measured quantity spoiled or thrown away in ${activeUnit || selectedItem.unit}.`}
                  </p>

                  {/* Step 3: Quantity + Unit + Stepper + Optional Tare */}
                  <div className="lwm-section">
                    <label className="lwm-label" htmlFor="lwm-qty-input">
                      <span>
                        {measurementMethod === "remaining_count"
                          ? "Remaining Stock Count / Weight"
                          : "Measured Spoiled / Wasted Quantity"}
                      </span>
                      <span className="lwm-label-hint">Stock unit: {selectedItem.unit}</span>
                    </label>

                    <div className="lwm-measure-row">
                      <div className="lwm-qty-stepper-wrap">
                        {isDiscreteCount && (
                          <button
                            type="button"
                            className="lwm-stepper-btn"
                            onClick={() => handleQtyStep(-1)}
                            aria-label="Decrease quantity"
                          >
                            <Minus size={16} />
                          </button>
                        )}
                        <input
                          id="lwm-qty-input"
                          type="number"
                          step={isDiscreteCount ? "1" : "any"}
                          min={measurementMethod === "remaining_count" ? "0" : "0.000001"}
                          inputMode={isDiscreteCount ? "numeric" : "decimal"}
                          className="lwm-input lwm-qty-input"
                          aria-invalid={hasQtyError ? "true" : undefined}
                          aria-describedby={qtyDescribedBy}
                          value={measuredQuantity}
                          onChange={(e) => {
                            setMeasuredQuantity(e.target.value);
                            setSubmitError("");
                            setClientRequestId(createClientRequestId());
                          }}
                          placeholder={
                            measurementMethod === "remaining_count" ? "e.g. 750" : "e.g. 2"
                          }
                          required
                        />
                        {isDiscreteCount && (
                          <button
                            type="button"
                            className="lwm-stepper-btn"
                            onClick={() => handleQtyStep(1)}
                            aria-label="Increase quantity"
                          >
                            <Plus size={16} />
                          </button>
                        )}
                      </div>

                      <select
                        id="lwm-unit-select"
                        className="lwm-select"
                        aria-label="Measured unit"
                        value={activeUnit}
                        onChange={(e) => {
                          setMeasuredUnit(e.target.value);
                          setSubmitError("");
                          setClientRequestId(createClientRequestId());
                        }}
                      >
                        {compatibleUnits.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {hasPackPreset && (
                      <div className="lwm-pack-helper-row">
                        <button
                          type="button"
                          className="lwm-pack-pill"
                          onClick={handleApplySealedPack}
                        >
                          <Package size={14} aria-hidden="true" />
                          Spoiled 1 sealed {selectedItem.packageUnit} ({selectedItem.contentsPerPackage} {selectedItem.unit})
                        </button>
                      </div>
                    )}

                    {canShowTareOption && (
                      <>
                        <button
                          type="button"
                          className="lwm-tare-toggle"
                          aria-expanded={showTare}
                          onClick={() => {
                            setShowTare((prev) => {
                              if (prev) setTareWeight("");
                              return !prev;
                            });
                          }}
                        >
                          {showTare ? "Remove container tare weight" : "+ Subtract container / pitcher tare weight"}
                        </button>

                        {showTare && (
                          <div className="lwm-tare-panel">
                            <input
                              id="lwm-tare-input"
                              type="number"
                              step="any"
                              min="0"
                              inputMode="decimal"
                              className="lwm-input"
                              aria-label={`Container tare weight in ${activeUnit}`}
                              aria-invalid={previewCalc && !previewCalc.ok ? "true" : undefined}
                              aria-describedby={previewCalc && !previewCalc.ok ? "lwm-qty-error" : undefined}
                              value={tareWeight}
                              onChange={(e) => {
                                setTareWeight(e.target.value);
                                setSubmitError("");
                                setClientRequestId(createClientRequestId());
                              }}
                              placeholder={`Empty container weight (${activeUnit})`}
                            />
                            <span className="lwm-tare-unit-badge">{activeUnit}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Live Calculation Banner */}
                {previewCalc && (
                  <div
                    className={`lwm-preview-banner${
                      previewCalc.ok
                        ? previewCalc.afterQuantity <= 0
                          ? " is-warning"
                          : " is-valid"
                        : ""
                    }`}
                    aria-live="polite"
                  >
                    {previewCalc.ok ? (
                      <>
                        <div className="lwm-preview-headline">
                          <span>
                            Calculated Waste: -{formatWasteQty(previewCalc.deductedQuantity, previewCalc.unit)}
                          </span>
                          {canViewCost && estimatedAdminLoss !== null && (
                            <span>₱{estimatedAdminLoss.toFixed(2)} est. loss</span>
                          )}
                        </div>
                        <p className="lwm-preview-sub">
                          Remaining Stock: {formatWasteQty(previewCalc.beforeQuantity, previewCalc.unit)} →{" "}
                          <strong>{formatWasteQty(previewCalc.afterQuantity, previewCalc.unit)}</strong>
                          {previewCalc.afterQuantity <= 0
                            ? " (Item will become Out of Stock)"
                            : ""}
                        </p>
                      </>
                    ) : (
                      <p
                        id="lwm-qty-error"
                        className="lwm-preview-sub"
                        style={{ color: "var(--lwm-danger)", fontWeight: 600 }}
                      >
                        {previewCalc.error}
                      </p>
                    )}
                  </div>
                )}

                {/* Step 4: Reason */}
                <div className="lwm-section">
                  <div className="lwm-label">
                    <span>3. Waste Reason</span>
                  </div>
                  <div
                    className="lwm-reason-grid"
                    role="radiogroup"
                    aria-label="Standardized waste reason"
                  >
                    {WASTE_LOG_REASONS.map((r) => {
                      const IconComp = REASON_ICONS[r.value] || AlertTriangle;
                      const selected = wasteReason === r.value;
                      return (
                        <button
                          key={r.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className="lwm-reason-pill"
                          onClick={() => {
                            setWasteReason(r.value);
                            setSubmitError("");
                          }}
                        >
                          <IconComp size={16} aria-hidden="true" />
                          <span>{r.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Step 5: Mandatory Note */}
                <div className="lwm-section">
                  <label className="lwm-label" htmlFor="lwm-note-input">
                    <span>4. Notes (optional)</span>
                    <span className="lwm-label-hint">{note.trim().length}/450</span>
                  </label>
                  <textarea
                    id="lwm-note-input"
                    className="lwm-textarea"
                    rows={2}
                    maxLength={450}
                    aria-invalid={noteInvalid ? "true" : undefined}
                    aria-describedby={hasBannerError ? "lwm-submit-error" : undefined}
                    value={note}
                    onChange={(e) => {
                      setNote(e.target.value);
                      setSubmitError("");
                    }}
                    placeholder="e.g., Pitcher slipped during rush prep / bottle seal broken on open"
                  />
                </div>
              </>
            )}

            {(submitError || (validationSubmitted && !fullValidation.ok)) && (
              <div id="lwm-submit-error" className="lwm-error-banner" role="alert">
                <AlertTriangle size={18} style={{ flex: "0 0 auto", marginTop: "1px" }} />
                <span>{submitError || fullValidation.error}</span>
              </div>
            )}
          </div>

          <div className="lwm-footer">
            <button
              type="button"
              className="lwm-btn lwm-btn-cancel"
              onClick={() => requestClose()}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="lwm-btn lwm-btn-danger"
              disabled={submitting || !selectedItem}
              aria-busy={submitting}
            >
              <Check size={17} aria-hidden="true" />
              {submitting ? "Recording waste..." : "Confirm & Deduct Waste"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LogWasteModal({ isOpen, ...props }) {
  if (!isOpen) return null;
  return <LogWasteModalContent {...props} />;
}

export default LogWasteModal;
