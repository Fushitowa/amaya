import { AlertTriangle } from "lucide-react";
import { unitFactors } from "../../../utils/menuCosting.js";

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
