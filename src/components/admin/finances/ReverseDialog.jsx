import FinDialog from "./FinDialog.jsx";

/** Cancel a transaction: asks why, then the page posts the linked cancellation entry. */
export default function ReverseDialog({
  reverseTarget,
  setReverseTarget,
  formSubmitting,
  formError,
  formErrorField,
  setFormError,
  setFormErrorField,
  reverseReasonRef,
  reverseReason,
  setReverseReason,
  handleConfirmReverse,
}) {
  return (
      <FinDialog
        isOpen={Boolean(reverseTarget)}
        onClose={() => setReverseTarget(null)}
        busy={formSubmitting}
        titleId="fin-reverse-modal-title"
        maxWidth="440px"
        title={reverseTarget ? `Cancel Transaction ${reverseTarget.entryNumber}` : "Cancel Transaction"}
      >
        <form onSubmit={handleConfirmReverse} className="fin-modal-body" style={{ padding: "1.25rem 1.4rem" }}>
          {formError && (
            <div id="fin-reverse-form-error" className="fin-form-error" role="alert">
              {formError}
            </div>
          )}
          <div className="fin-form-group">
            <label htmlFor="fin-reverse-reason">Why are you cancelling this? (at least 3 characters) *</label>
            <textarea
              ref={reverseReasonRef}
              id="fin-reverse-reason"
              rows={3}
              required
              maxLength={255}
              aria-invalid={formErrorField === "reverseReason"}
              aria-describedby={formErrorField === "reverseReason" ? "fin-reverse-form-error" : undefined}
              className="fin-form-input"
              value={reverseReason}
              onChange={(e) => {
                setReverseReason(e.target.value);
                if (formErrorField === "reverseReason") {
                  setFormError(null);
                  setFormErrorField(null);
                }
              }}
              placeholder="For example: entered the wrong amount"
            />
          </div>
          <div className="fin-modal-footer" style={{ margin: "0.35rem -1.4rem -1.25rem", padding: "0.95rem 1.4rem" }}>
            <button
              type="button"
              className="fin-modal-btn-secondary"
              disabled={formSubmitting}
              onClick={() => setReverseTarget(null)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="fin-modal-btn-danger"
              disabled={formSubmitting}
              aria-busy={formSubmitting}
            >
              {formSubmitting ? "Cancelling…" : "Cancel This Transaction"}
            </button>
          </div>
        </form>
      </FinDialog>
  );
}
