import { formatUnitCost } from "../../../utils/inventoryFormatting.js";
import { getWasteReasonMeta } from "../../../utils/wasteMeasurement.js";
import { formatManilaDateTime } from "../../../../shared/manilaDate.js";

export function InventoryMovementHistoryModal({
  movementHistory,
  closeMovementHistory,
  reverseInternalTarget,
  setReverseInternalTarget,
  reverseInternalReason,
  setReverseInternalReason,
  reverseInternalError,
  setReverseInternalError,
  reverseInternalInputRef,
  handleConfirmReverseInternalUse,
  reverseInternalUse,
  isSaving,
}) {
  if (!movementHistory.item) return null;
  return (
    <div className="admin-inventory-modal-backdrop" role="presentation" onClick={closeMovementHistory}>
      <section className="admin-inventory-modal inventory-history-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-history-title" onClick={(event) => event.stopPropagation()}>
        <div className="admin-inventory-modal-header">
          <div>
            <span className="admin-inventory-eyebrow">AUDIT TRAIL</span>
            <h3 id="inventory-history-title">{movementHistory.item.item} history</h3>
            <p>Stock changes, quantities, and the account that recorded them.</p>
          </div>
          <button type="button" onClick={closeMovementHistory} aria-label="Close stock history">×</button>
        </div>
        {reverseInternalTarget && (
          <form
            onSubmit={handleConfirmReverseInternalUse}
            style={{
              marginBottom: "12px",
              padding: "12px",
              borderRadius: "10px",
              border: "1px solid #8b5e3c",
              background: "#fffaf3",
              display: "grid",
              gap: "8px",
            }}
          >
            <strong style={{ fontSize: "12px", color: "#382518" }}>
              Reverse Internal Store Use #{reverseInternalTarget.id} ({Math.abs(Number(reverseInternalTarget.quantityChange || 0))} {reverseInternalTarget.unit || movementHistory.item.unit})
            </strong>
            <label htmlFor="reverse-internal-reason" style={{ fontSize: "11.5px", fontWeight: 600, color: "#4a2c11", display: "grid", gap: "4px" }}>
              Audit Reversal Reason (min 3 characters)
              <input
                ref={reverseInternalInputRef}
                id="reverse-internal-reason"
                type="text"
                maxLength={255}
                value={reverseInternalReason}
                onChange={(e) => setReverseInternalReason(e.target.value)}
                placeholder="e.g. Logged twice by mistake"
                required
                style={{ padding: "8px 10px", borderRadius: "6px", border: "1px solid #8b5e3c", fontSize: "12px" }}
              />
            </label>
            {reverseInternalError && (
              <p className="inventory-form-error" role="alert" style={{ margin: 0, color: "#b91c1c" }}>{reverseInternalError}</p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button
                type="button"
                className="modal-cancel"
                disabled={isSaving}
                onClick={() => {
                  setReverseInternalTarget(null);
                  setReverseInternalReason("");
                  setReverseInternalError("");
                }}
              >
                Cancel
              </button>
              <button type="submit" className="modal-save" disabled={isSaving}>
                {isSaving ? "Reversing…" : "Confirm Reversal"}
              </button>
            </div>
          </form>
        )}
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
                              ? (row.orderId || row.orderNumber ? "Order void spoilage" : "Waste / Spoilage")
                              : row.type === "void_restore"
                                ? "Void stock restore"
                                : row.type === "internal_use"
                                  ? "Internal store use"
                                  : row.type === "opening_balance"
                                    ? "Opening stock"
                                    : "Stock adjustment"}
                        {row.wasteReason && (
                          <em className="inventory-history-waste-badge">
                            {getWasteReasonMeta(row.wasteReason).shortLabel}
                          </em>
                        )}
                        {row.isReversed && (
                          <em className="inventory-history-reversed-badge">Reversed</em>
                        )}
                      </strong>
                      <span>{row.note || "Inventory updated"}</span>
                      <small>{row.actor} · {formatManilaDateTime(row.timestamp)}</small>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "0 0 auto" }}>
                      <b className={row.quantityChange > 0 ? "is-increase" : "is-decrease"}>{row.quantityChange > 0 ? "+" : ""}{row.quantityChange} {row.unit || movementHistory.item.unit}</b>
                      {row.type === "internal_use" && !row.isReversed && reverseInternalUse && (
                        <button
                          type="button"
                          aria-label={`Reverse internal store use #${row.id}`}
                          onClick={() => {
                            setReverseInternalTarget(row);
                            setReverseInternalReason("");
                            setReverseInternalError("");
                          }}
                          style={{
                            border: "1px solid #8b5e3c",
                            background: "#fff7ed",
                            color: "#3d230e",
                            borderRadius: "6px",
                            padding: "4px 9px",
                            fontSize: "11px",
                            fontWeight: 700,
                            cursor: "pointer",
                            minHeight: "30px",
                          }}
                        >
                          Reverse
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="inventory-history-empty">No stock movements recorded yet.</p>}
      </section>
    </div>
  );
}

export function InventoryRestockModal({
  restockItem,
  closeRestockModal,
  handleRestock,
  restockQuantity,
  setRestockQuantity,
  restockBatchCost,
  setRestockBatchCost,
  restockCreditAccountCode,
  setRestockCreditAccountCode,
  restockDiluteZeroCost,
  setRestockDiluteZeroCost,
  restockSupplierName,
  setRestockSupplierName,
  restockReferenceNo,
  setRestockReferenceNo,
  actionError,
  isSaving,
}) {
  if (!restockItem) return null;
  return (
    <div className="admin-inventory-modal-backdrop" role="presentation" onClick={closeRestockModal}>
      <form className="admin-inventory-modal inventory-action-modal" onSubmit={handleRestock} role="dialog" aria-modal="true" aria-labelledby="restock-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="admin-inventory-modal-header">
          <div>
            <span className="admin-inventory-eyebrow">STOCK MOVEMENT</span>
            <h3 id="restock-dialog-title">Restock {restockItem.item}</h3>
            <p>Current: {restockItem.quantity} {restockItem.unit} · Maximum: {restockItem.maximumStock == null ? "Not set" : `${restockItem.maximumStock} ${restockItem.unit}`}</p>
          </div>
          <button type="button" onClick={closeRestockModal} disabled={isSaving} aria-label="Close restock form">×</button>
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
              <option value="1010">Cash drawer</option>
              <option value="1020">GCash wallet</option>
              <option value="1030">Store bank</option>
              <option value="1040">Owner reserve</option>
              <option value="2010">Pay the supplier later (unpaid bill)</option>
              <option value="3010">Owner puts in new money</option>
            </select>
            <small>The money comes out of the option you pick, and the stock is added to your inventory value.</small>
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
          <button type="button" className="modal-cancel" onClick={closeRestockModal} disabled={isSaving}>Cancel</button>
          <button type="submit" className="modal-save" disabled={isSaving}>{isSaving ? "Adding stock…" : "Confirm restock"}</button>
        </div>
      </form>
    </div>
  );
}

export function InventoryArchiveConfirmModal({
  itemToDelete,
  actionError,
  isSaving,
  onCancel,
  onConfirm,
}) {
  if (!itemToDelete) return null;
  return (
    <div className="admin-inventory-modal-backdrop" role="presentation" onClick={() => !isSaving && onCancel()}>
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
          <button type="button" className="modal-cancel" onClick={onCancel} disabled={isSaving}>Cancel</button>
          <button type="button" className="inventory-delete-confirm" onClick={onConfirm} disabled={isSaving}>
            {isSaving ? "Archiving…" : "Move to Archive"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function InventoryInternalUseModal({
  internalUseItem,
  closeInternalUseModal,
  handleInternalUseSubmit,
  quickPicks,
  accountOptions,
  internalUseAccount,
  setInternalUseAccount,
  internalUseQty,
  setInternalUseQty,
  internalUseNote,
  setInternalUseNote,
  actionError,
  isSaving,
}) {
  if (!internalUseItem) return null;
  return (
    <div
      className="admin-inventory-modal-backdrop"
      role="presentation"
      onClick={() => {
        if (!isSaving) closeInternalUseModal();
      }}
    >
      <form
        className="admin-inventory-modal inventory-action-modal"
        onSubmit={handleInternalUseSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="internal-use-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-inventory-modal-header">
          <div>
            <span className="admin-inventory-eyebrow">INTERNAL STORE USE</span>
            <h3 id="internal-use-dialog-title">Use {internalUseItem.item}</h3>
            <p>Available on hand: {internalUseItem.quantity} {internalUseItem.unit} · Moves the cost from your inventory value to a running cost.</p>
          </div>
          <button
            type="button"
            onClick={closeInternalUseModal}
            disabled={isSaving}
            aria-label="Close store use form"
          >
            ×
          </button>
        </div>
        <fieldset style={{ border: "none", padding: 0, margin: "0 0 0.75rem 0" }}>
          <legend style={{ fontSize: "12px", fontWeight: 700, color: "#4a2c11", marginBottom: "6px" }}>
            1. Quick-Pick Reason *
          </legend>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
            {quickPicks.map((pick) => {
              const selected = internalUseAccount === pick.code;
              return (
                <button
                  key={pick.code}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setInternalUseAccount(pick.code)}
                  style={{
                    textAlign: "left",
                    padding: "10px 11px",
                    minHeight: "52px",
                    borderRadius: "9px",
                    border: selected ? "2px solid #603b26" : "1px solid #8b5e3c",
                    background: selected ? "#fff7ed" : "#ffffff",
                    color: "#382518",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <strong style={{ fontSize: "12px", display: "flex", alignItems: "center", gap: "5px" }}>
                    <span aria-hidden="true">{selected ? "●" : "○"}</span>
                    {pick.title}
                  </strong>
                  <span style={{ fontSize: "11px", color: "#6b5847" }}>{pick.subtitle}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <label htmlFor="internal-use-account" className="inventory-restock-field" style={{ marginBottom: "0.75rem" }}>
          What it was used for
          <select
            id="internal-use-account"
            value={internalUseAccount}
            onChange={(event) => setInternalUseAccount(event.target.value)}
          >
            {accountOptions.map((opt) => (
              <option key={opt.code} value={opt.code}>{opt.label}</option>
            ))}
          </select>
          <small style={{ color: "#6b5847" }}>
            {(accountOptions.find((opt) => opt.code === internalUseAccount) || accountOptions[0]).hint}
          </small>
        </label>
        <label htmlFor="internal-use-qty" className="inventory-restock-field">
          Quantity ({internalUseItem.unit})
          <input
            id="internal-use-qty"
            type="number"
            inputMode="decimal"
            min="0.000001"
            max={Number(internalUseItem.quantity || 0) || undefined}
            step="any"
            value={internalUseQty}
            onChange={(event) => setInternalUseQty(event.target.value)}
            placeholder={`Max ${internalUseItem.quantity}`}
            required
          />
        </label>
        <label htmlFor="internal-use-note" className="inventory-restock-field" style={{ marginTop: "0.75rem" }}>
          Note / Crew / Shift — Optional
          <input
            id="internal-use-note"
            type="text"
            maxLength={420}
            value={internalUseNote}
            onChange={(event) => setInternalUseNote(event.target.value)}
            placeholder="e.g. Afternoon crew meal, kitchen sanitation refill, LPG tank opened"
          />
        </label>
        {actionError && <p className="inventory-form-error" role="alert">{actionError}</p>}
        <div className="admin-inventory-modal-actions">
          <button
            type="button"
            className="modal-cancel"
            onClick={closeInternalUseModal}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button type="submit" className="modal-save" disabled={isSaving}>
            {isSaving ? "Recording…" : "Record Store Use"}
          </button>
        </div>
      </form>
    </div>
  );
}
