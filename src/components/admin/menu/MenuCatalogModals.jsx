import { AlertTriangle, Check, Search, X } from "lucide-react";
import { safeItemName, safeLower, unitFactors } from "../../../utils/menuCosting.js";

const SUPPORTED_UNITS = [
  { group: "Weight", units: [["mg", "Milligrams (mg)"], ["g", "Grams (g)"], ["hg", "Hectograms (hg)"], ["kg", "Kilograms (kg)"], ["oz", "Ounces (oz)"], ["lb", "Pounds (lb)"]] },
  { group: "Volume", units: [["ml", "Milliliters (ml)"], ["cl", "Centiliters (cl)"], ["dl", "Deciliters (dl)"], ["L", "Liters (L)"], ["tsp", "Teaspoons (tsp)"], ["tbsp", "Tablespoons (tbsp)"], ["fl oz", "Fluid ounces (fl oz)"], ["cup", "Cups"], ["pt", "Pints (pt)"], ["qt", "Quarts (qt)"], ["gal", "Gallons (gal)"], ["cc", "Cubic centimeters (cc)"]] },
  { group: "Count", units: [["pcs", "Pieces (pcs)"], ["can", "Cans (can)"], ["pair", "Pairs"], ["dozen", "Dozen"]] },
];

const KNOWN_UNITS_LOWER = new Set(SUPPORTED_UNITS.flatMap((group) => group.units.map(([unit]) => unit.toLowerCase())));

export function UnitSelect({ value, onChange, ariaLabel, disabled = false, compatibleWith }) {
  const currentUnit = String(value || "pcs");
  const compatibleUnit = unitFactors.get(String(compatibleWith || "").trim().toLowerCase());
  return (
    <select value={currentUnit} onChange={(event) => onChange(event.target.value)} aria-label={ariaLabel} disabled={disabled}>
      {!KNOWN_UNITS_LOWER.has(currentUnit.toLowerCase()) && <option value={currentUnit}>{currentUnit} (current unit)</option>}
      {SUPPORTED_UNITS.map((group) => (
        <optgroup key={group.group} label={group.group}>
          {group.units.map(([unit, label]) => {
            const definition = unitFactors.get(unit.toLowerCase());
            return (
              <option key={unit} value={unit} disabled={Boolean(compatibleUnit && definition?.dimension !== compatibleUnit.dimension)}>
                {label}
              </option>
            );
          })}
        </optgroup>
      ))}
    </select>
  );
}

export function MenuArchiveConfirmModal({
  itemToDelete,
  menuActionError,
  isDeleting,
  onClose,
  onConfirm,
}) {
  if (!itemToDelete) return null;
  return (
    <div
      className="admin-menu-modal-backdrop delete-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="delete-confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-item-title"
        aria-describedby="delete-item-message"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="delete-confirm-icon" aria-hidden="true">
          <AlertTriangle size={22} strokeWidth={2} />
        </div>

        <div className="delete-confirm-text">
          <h3 id="delete-item-title">Move to Archive?</h3>
          <p id="delete-item-message">
            Are you sure you want to archive <strong>{itemToDelete.name}</strong>? It will be safely moved to the <strong>Archive</strong> for 30 days before permanent deletion. You can restore it anytime!
          </p>
        </div>

        <div className="delete-confirm-preview">
          {itemToDelete.image ? (
            <img src={itemToDelete.image} alt="" />
          ) : (
            <span className="delete-confirm-preview-fallback" aria-hidden="true">
              {itemToDelete.name?.charAt(0) || "?"}
            </span>
          )}
          <div>
            <span className="delete-confirm-category">{itemToDelete.category}</span>
            <strong>{itemToDelete.name}</strong>
            <em>{itemToDelete.price}</em>
          </div>
        </div>

        {menuActionError && (
          <p className="menu-recipe-error" role="alert">
            {menuActionError}
          </p>
        )}

        <div className="delete-confirm-actions">
          <button type="button" className="delete-confirm-cancel" onClick={onClose} disabled={isDeleting}>
            Cancel
          </button>
          <button type="button" className="delete-confirm-submit" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? "Archiving..." : "Move to Archive"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InventoryRecipePickerModal({
  isOpen,
  inventory,
  pickerSearch,
  setPickerSearch,
  pickerCategory,
  setPickerCategory,
  selectedInventoryItemIds,
  togglePickerItem,
  applyInventoryPicker,
  onClose,
}) {
  if (!isOpen) return null;
  return (
    <div
      className="recipe-picker-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="recipe-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="recipe-picker-header">
          <div>
            <h3 id="recipe-picker-title">Select Recipe Ingredients</h3>
            <p>Pick items from your inventory to include in this recipe. Quantities can be set in the next step.</p>
          </div>
          <button
            type="button"
            className="recipe-picker-close-btn"
            onClick={onClose}
            aria-label="Close inventory picker"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
        </div>

        <div className="recipe-picker-filters">
          <div className="recipe-picker-search-wrap">
            <Search size={15} strokeWidth={2.2} className="picker-search-icon" />
            <input
              type="text"
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              placeholder="Search ingredients by name..."
              aria-label="Search ingredients"
              autoFocus
            />
            {pickerSearch && (
              <button
                type="button"
                className="picker-search-clear"
                onClick={() => setPickerSearch("")}
                aria-label="Clear search"
              >
                <X size={13} strokeWidth={2} />
              </button>
            )}
          </div>

          <div className="recipe-picker-categories">
            {["all", ...Array.from(new Set((inventory || []).map((i) => i.category).filter(Boolean)))].map((cat) => (
              <button
                key={cat}
                type="button"
                className={`picker-cat-pill ${pickerCategory === cat ? "active" : ""}`}
                onClick={() => setPickerCategory(cat)}
              >
                {cat === "all" ? "All Categories" : cat}
              </button>
            ))}
          </div>
        </div>

        <div className="recipe-picker-grid">
          {(inventory || [])
            .filter((item) => {
              const name = safeItemName(item);
              const matchesSearch = !pickerSearch || safeLower(name).includes(safeLower(pickerSearch));
              const matchesCat = pickerCategory === "all" || item.category === pickerCategory;
              return matchesSearch && matchesCat;
            })
            .map((item) => {
              const isSelected = selectedInventoryItemIds.has(item.id);
              const itemName = safeItemName(item);
              return (
                <div
                  key={item.id}
                  className={`recipe-picker-item-card ${isSelected ? "selected" : ""}`}
                  onClick={() => togglePickerItem(item.id)}
                  role="checkbox"
                  aria-checked={isSelected}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      togglePickerItem(item.id);
                    }
                  }}
                >
                  <div className="picker-card-check">
                    {isSelected ? <Check size={13} strokeWidth={3} /> : null}
                  </div>
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={itemName}
                      className="picker-card-thumb"
                    />
                  ) : null}
                  <div className="picker-card-info">
                    <strong className="picker-card-name">{itemName}</strong>
                    <div className="picker-card-meta">
                      <span className="picker-card-stock">
                        Stock: <strong>{item.quantity} {item.unit}</strong>
                      </span>
                      {item.category && (
                        <span className="picker-card-badge">{item.category}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>

        <div className="recipe-picker-footer">
          <span className="picker-selected-summary">
            <strong>{selectedInventoryItemIds.size}</strong> ingredient{selectedInventoryItemIds.size === 1 ? "" : "s"} selected
          </span>
          <div className="picker-footer-actions">
            <button
              type="button"
              className="picker-cancel-btn"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="picker-apply-btn"
              onClick={applyInventoryPicker}
            >
              Apply Selected ({selectedInventoryItemIds.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
