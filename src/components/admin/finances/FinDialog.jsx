import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export default function FinDialog({ isOpen, onClose, title, titleId, busy = false, maxWidth = "480px", children }) {
  const boxRef = useRef(null);
  const previousFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frameId = window.requestAnimationFrame(() => {
      const box = boxRef.current;
      if (!box) return;
      const firstFocusable = box.querySelector(
        'select:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), button:not([disabled])',
      );
      if (firstFocusable instanceof HTMLElement) {
        firstFocusable.focus();
      } else {
        box.focus();
      }
    });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        if (!busyRef.current) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }
      if (event.key === "Tab" && boxRef.current) {
        const focusables = Array.from(
          boxRef.current.querySelectorAll(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el instanceof HTMLElement && el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
      const prevEl = previousFocusRef.current;
      if (prevEl && prevEl.isConnected && typeof prevEl.focus === "function") {
        prevEl.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fin-modal-overlay"
      role="presentation"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        ref={boxRef}
        className="fin-modal-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="fin-modal-header">
          <h3 id={titleId}>{title}</h3>
          <button
            type="button"
            className="fin-modal-close-btn"
            disabled={busy}
            onClick={onClose}
            aria-label={`Close ${title}`}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
