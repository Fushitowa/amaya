import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";
import { safeItemName } from "../../../utils/menuCosting.js";

/*
 * Small windows that open right under a toolbar button in the menu item form.
 * They float over the ingredient table (and the receipt beside it) instead of
 * covering the whole screen, so you can still see what you are editing.
 */

const POP_WIDTH = 580;
const GAP = 10;
const EDGE = 16;

function useAnchoredPosition(anchorRef, isOpen) {
	const [pos, setPos] = useState(null);

	useLayoutEffect(() => {
		if (!isOpen) return undefined;
		const place = () => {
			const el = anchorRef?.current;
			if (!el) return;
			const r = el.getBoundingClientRect();
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const width = Math.min(POP_WIDTH, vw - EDGE * 2);
			const left = Math.max(EDGE, Math.min(r.left, vw - width - EDGE));
			const top = r.bottom + GAP;
			const maxHeight = Math.max(240, vh - top - 96);
			// Caret points at the middle of the button that opened the window.
			const caret = Math.max(18, Math.min(r.left + r.width / 2 - left, width - 18));
			setPos({ top, left, width, maxHeight, caret });
		};
		place();
		window.addEventListener("resize", place);
		window.addEventListener("scroll", place, true);
		return () => {
			window.removeEventListener("resize", place);
			window.removeEventListener("scroll", place, true);
		};
	}, [anchorRef, isOpen]);

	return pos;
}

function useDismiss(isOpen, popRef, anchorRef, onClose) {
	useEffect(() => {
		if (!isOpen) return undefined;
		const onKey = (e) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				onClose();
				anchorRef?.current?.focus();
			}
		};
		const onDown = (e) => {
			if (popRef.current?.contains(e.target)) return;
			if (anchorRef?.current?.contains(e.target)) return;
			onClose();
		};
		document.addEventListener("keydown", onKey, true);
		document.addEventListener("mousedown", onDown);
		return () => {
			document.removeEventListener("keydown", onKey, true);
			document.removeEventListener("mousedown", onDown);
		};
	}, [isOpen, popRef, anchorRef, onClose]);
}

function Popover({ isOpen, anchorRef, onClose, labelId, title, subtitle, children, footer, className = "" }) {
	const popRef = useRef(null);
	const pos = useAnchoredPosition(anchorRef, isOpen);
	useDismiss(isOpen, popRef, anchorRef, onClose);

	if (!isOpen || !pos) return null;

	return createPortal(
		<div
			ref={popRef}
			className={`mb-pop ${className}`}
			role="dialog"
			aria-labelledby={labelId}
			style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight, "--mb-pop-caret": `${pos.caret}px` }}
		>
			<header className="mb-pop-head">
				<div>
					<h4 id={labelId}>{title}</h4>
					{subtitle && <p>{subtitle}</p>}
				</div>
				<button type="button" className="mb-pop-close" onClick={onClose} aria-label={`Close ${title}`}>
					<X size={16} strokeWidth={2.2} />
				</button>
			</header>
			{children}
			{footer && <footer className="mb-pop-foot">{footer}</footer>}
		</div>,
		document.body,
	);
}

const safeName = (item) => safeItemName(item) || "Unnamed item";

export function InventoryPickerPopover({
	isOpen,
	anchorRef,
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
	const list = inventory || [];
	const categories = ["all", ...Array.from(new Set(list.map((i) => i.category).filter(Boolean)))];
	const query = String(pickerSearch || "").toLowerCase();
	const matches = list.filter((item) => {
		const okName = !query || safeName(item).toLowerCase().includes(query);
		const okCat = pickerCategory === "all" || item.category === pickerCategory;
		return okName && okCat;
	});
	const count = selectedInventoryItemIds.size;

	return (
		<Popover
			isOpen={isOpen}
			anchorRef={anchorRef}
			onClose={onClose}
			labelId="mb-pop-picker-title"
			title="Choose ingredients"
			subtitle="Tick what this item uses. You set the amounts after."
			className="is-picker"
			footer={
				<>
					<span className="mb-pop-count"><strong>{count}</strong> selected</span>
					<button type="button" className="mb-btn is-small" onClick={onClose}>Cancel</button>
					<button type="button" className="mb-btn is-small is-primary" onClick={applyInventoryPicker}>
						{count === 0 ? "Use none" : `Use ${count} ingredient${count === 1 ? "" : "s"}`}
					</button>
				</>
			}
		>
			<div className="mb-pop-filters">
				<label className="mb-pop-search">
					<Search size={14} strokeWidth={2.2} aria-hidden="true" />
					<input
						type="text"
						value={pickerSearch}
						onChange={(e) => setPickerSearch(e.target.value)}
						placeholder="Search Inventory"
						aria-label="Search Inventory"
						autoFocus
					/>
					{pickerSearch && (
						<button type="button" onClick={() => setPickerSearch("")} aria-label="Clear search">
							<X size={12} strokeWidth={2.2} />
						</button>
					)}
				</label>
				{categories.length > 2 && (
					<div className="mb-pop-cats" role="group" aria-label="Filter by category">
						{categories.map((cat) => (
							<button
								key={cat}
								type="button"
								className={pickerCategory === cat ? "is-on" : ""}
								aria-pressed={pickerCategory === cat}
								onClick={() => setPickerCategory(cat)}
							>
								{cat === "all" ? "All" : cat}
							</button>
						))}
					</div>
				)}
			</div>

			<ul className="mb-pop-list" aria-label="Inventory items">
				{matches.length === 0 && (
					<li className="mb-pop-empty" role="status">
						<strong>{list.length === 0 ? "Inventory is empty" : "Nothing matches"}</strong>
						<span>{list.length === 0 ? "Add your ingredients in Inventory first." : "Try another word, or add it as a new item."}</span>
					</li>
				)}
				{matches.map((item) => {
					const on = selectedInventoryItemIds.has(item.id);
					const qty = Number(item.quantity);
					const low = Number.isFinite(qty) && qty <= 0;
					return (
						<li key={item.id}>
							<button
								type="button"
								role="checkbox"
								aria-checked={on}
								className={`mb-pop-row ${on ? "is-on" : ""}`}
								onClick={() => togglePickerItem(item.id)}
							>
								<span className="mb-pop-box" aria-hidden="true">{on && <Check size={12} strokeWidth={3} />}</span>
								<span className="mb-pop-name">
									{safeName(item)}
									{item.category && <small>{item.category}</small>}
								</span>
								<span className={`mb-pop-stock ${low ? "is-out" : ""}`}>
									{low ? "Out of stock" : `${item.quantity} ${item.unit || ""}`}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
		</Popover>
	);
}

export function AddInventoryItemPopover({ isOpen, anchorRef, onClose }) {
	return (
		<Popover
			isOpen={isOpen}
			anchorRef={anchorRef}
			onClose={onClose}
			labelId="mb-pop-add-title"
			title="Add a new item to Inventory"
			className="is-add"
		>
			{/* Form goes here later. */}
			<div className="mb-pop-blank" />
		</Popover>
	);
}
