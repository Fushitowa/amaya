import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import Sidebar from "../../components/Sidebar.jsx";
import ErrorBoundary from "../../components/ErrorBoundary.jsx";
import { Menu, Pencil, AlertTriangle, ChevronLeft, Archive, ArrowUpDown, Beaker, Check, CheckCircle2, ChevronRight, Clock, Coffee, ExternalLink, FolderOpen, ImagePlus, Package, Plus, Search, Settings2, Sparkles, Star, Trash2, Utensils, X } from "lucide-react";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import { useInventory } from "../../context/InventoryContext.jsx";
import { useBusiness } from "../../context/BusinessContext.jsx";
import { InventoryRecipePickerModal, MenuArchiveConfirmModal, UnitSelect } from "../../components/admin/menu/MenuCatalogModals.jsx";
import {
	DEFAULT_TARGET_FOOD_COST,
	safeLower,
	safeItemName,
	safeToFixed,
	findInventoryItemInList,
	convertRecipeAmount,
	defaultSizeFactor,
	scaleIngredientAmount,
	normalizeTargetFoodCost,
	buildSafeSizeQtyMap,
	readSizeQtyValue,
	writeSizeQtyValue,
	computeMenuItemCostSummary,
	resolveBaseRecipeQuantity,
	formatRecipeBaseQtyBadge,
} from "../../utils/menuCosting.js";

import { shrinkImageToDataUri } from "../../utils/imageResize.js";
import "../../assets/css/admin/AdminMenuManagement.css";
import "../../assets/css/admin/MenuItemBuilder.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";



const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MENU_PAGE_SIZE = 16;
const getInvItemName = safeItemName;
const amountAttachedToUnit = (unit) => /^\s*\d+(?:\.\d+)?\s*[a-z]/i.test(String(unit || ""));


function separateAmountHint(amount, unit, stockUnit, itemName) {
	const amountMatch = String(amount || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
	if (amountMatch) return `For “${itemName}”, enter only ${amountMatch[1]} in Amount per serving and “${amountMatch[2]}” in Recipe unit.`;
	const match = String(unit || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
	if (match) return `For “${itemName}”, put ${match[1]} in Amount per serving and “${match[2]}” in Recipe unit. Keep the amount and unit in separate fields.`;
	const stockMatch = String(stockUnit || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
	if (stockMatch) return `The inventory unit for “${itemName}” is “${stockUnit}”. Edit that inventory item: put ${stockMatch[1]} in its stock quantity and “${stockMatch[2]}” in its unit. Then try again.`;
	return "";
}

// Fallback for food and other "general" categories: no cup sizes in the name.
const STANDARD_SIZES = [
	{ label: "Regular", factor: 1.0 },
	{ label: "Medium", factor: 1.25 },
	{ label: "Large", factor: 1.5 },
];

// Cup-sized names only make sense for drinks.
const DRINK_STANDARD_SIZES = [
	{ label: "Regular (16oz)", factor: 1.0 },
	{ label: "Medium (18oz)", factor: 1.25 },
	{ label: "Large (22oz)", factor: 1.5 },
];

const VARIATION_PRESETS = {
	drink: [
		{ label: "Regular (16oz)", factor: 1.0 },
		{ label: "Large (22oz)", factor: 1.35 },
	],
	fries: [
		{ label: "Regular", factor: 1.0 },
		{ label: "Large", factor: 1.5 },
		{ label: "Jumbo / Party", factor: 2.2 },
	],
	snack_pieces: [
		{ label: "4 pcs (Solo)", factor: 1.0 },
		{ label: "6 pcs (Sharing)", factor: 1.5 },
		{ label: "12 pcs (Party)", factor: 3.0 },
	],
};


const computeInventoryBasedSizePrice = (sizeCost, baseCost, basePrice, factor, index = 0) => {
	const numBasePrice = Number(basePrice);
	if (Number.isFinite(numBasePrice) && numBasePrice > 0 && baseCost > 0 && sizeCost > 0) {
		if (factor === 1.0) {
			return numBasePrice.toFixed(2);
		}
		const ratio = baseCost / numBasePrice;
		if (ratio > 0) {
			const calculatedPrice = Math.ceil((sizeCost / ratio) / 5) * 5;
			return Number(calculatedPrice).toFixed(2);
		}
	}
	const fallbackBase = Number.isFinite(numBasePrice) && numBasePrice > 0 ? numBasePrice : 40;
	const fallback = fallbackBase + (index * 10);
	return Number(fallback).toFixed(2);
};

// The add / edit item form walks through these steps in order.
const BUILDER_STEPS = [
	{ key: "identity", label: "Basics" },
	{ key: "sizes", label: "Sizes" },
	{ key: "recipe", label: "Ingredients" },
	{ key: "addons", label: "Add-ons" },
	{ key: "review", label: "Review" },
];

function AdminMenuManagement() {
	const { products = [], categories: contextMenuCategories = [], menuError, addProduct, updateProduct, deleteProduct, refreshCategories } = useMenu() || {};
	const { inventory = [], refreshInventory } = useInventory() || {};
	const { businessSettings } = useBusiness() || {};
	const cupInventoryItems = useMemo(() => {
		return (inventory || [])
			.filter((item) => item && (item.isCupCategory || item.is_cup_category) && !item.isArchived)
			.sort((a, b) => {
				const nameA = getInvItemName(a);
				const nameB = getInvItemName(b);
				const ozA = Number(nameA.match(/(\d+(?:\.\d+)?)\s*oz/i)?.[1] || 999);
				const ozB = Number(nameB.match(/(\d+(?:\.\d+)?)\s*oz/i)?.[1] || 999);
				return ozA - ozB || nameA.localeCompare(nameB);
			});
	}, [inventory]);
	const { sidebarCollapsed, toggleSidebar } = useSidebar();
	const dbCategories = useMemo(
		() => (contextMenuCategories || []).filter((cat) => cat && cat.name && cat.isActive !== false),
		[contextMenuCategories],
	);
	const categories = useMemo(
		() => ["All items", ...dbCategories.map((cat) => cat.name)],
		[dbCategories],
	);
	const categoriesLoading = false;
	const [activeCategory, setActiveCategory] = useState("All items");
	const [search, setSearch] = useState("");
	const [sortBy, setSortBy] = useState("popular");
	const [currentPage, setCurrentPage] = useState(1);
	const [showForm, setShowForm] = useState(false);
	const [builderChapter, setBuilderChapter] = useState("identity");
	const [editingProduct, setEditingProduct] = useState(null);
	const [itemToDelete, setItemToDelete] = useState(null);
	const [mobileNavOpen, setMobileNavOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	const [actionProduct, setActionProduct] = useState(null);
	const [isMobile, setIsMobile] = useState(
		() => typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches
	);

	const emptyForm = () => ({ name: "", price: "", costPrice: "", stock: "", description: "", category: dbCategories[0]?.name || "", image: "", sizes: [], ingredients: [], addons: [], available: true });
	const [formValues, setFormValues] = useState(emptyForm);
	const [editingSizeIndex, setEditingSizeIndex] = useState(null);
	const editingSizeRef = useRef(null);
	const [addonDraft, setAddonDraft] = useState({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
	const [recipeError, setRecipeError] = useState("");
	const [menuActionError, setMenuActionError] = useState("");
	const [syncNotice, setSyncNotice] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [togglingProductId, setTogglingProductId] = useState(null);
	const syncTimer = useRef(null);

	// Multi-select inventory picker state
	const [showInventoryPicker, setShowInventoryPicker] = useState(false);
	const [pickerSearch, setPickerSearch] = useState("");
	const [pickerCategory, setPickerCategory] = useState("all");
	const [selectedInventoryItemIds, setSelectedInventoryItemIds] = useState(new Set());

	// Target food cost percentage for suggested pricing (synced from Business Settings, previewable per modal session)
	const configuredFoodCostPct = useMemo(
		() => Number((normalizeTargetFoodCost(businessSettings?.targetFoodCost, DEFAULT_TARGET_FOOD_COST) * 100).toFixed(2)),
		[businessSettings?.targetFoodCost],
	);
	const [targetFoodCostOverride, setTargetFoodCostOverride] = useState(null);
	const targetFoodCostPct = targetFoodCostOverride ?? configuredFoodCostPct;
	const isPreviewOverridden =
		targetFoodCostOverride !== null && targetFoodCostOverride !== configuredFoodCostPct;
	const targetCostOptions = useMemo(
		() => Array.from(new Set([configuredFoodCostPct, 30, 40, 50, 60])).sort((a, b) => a - b),
		[configuredFoodCostPct],
	);

	useEffect(() => {
		const query = window.matchMedia("(max-width: 800px)");
		const sync = () => setIsMobile(query.matches);
		query.addEventListener("change", sync);
		return () => query.removeEventListener("change", sync);
	}, []);

	const inventoryLookup = useMemo(() => {
		const byId = new Map();
		const byName = new Map();
		for (const entry of inventory || []) {
			if (!entry) continue;
			if (entry.id != null && !Number.isNaN(Number(entry.id))) {
				byId.set(Number(entry.id), entry);
			}
			const nameKey = safeLower(safeItemName(entry));
			if (nameKey && !byName.has(nameKey)) {
				byName.set(nameKey, entry);
			}
		}
		return { byId, byName };
	}, [inventory]);

	const findInventoryItem = useCallback((queryOrList, maybeQuery = null, maybeId = null) => {
		if (Array.isArray(queryOrList)) {
			return findInventoryItemInList(queryOrList, maybeQuery, maybeId);
		}
		const numericId = maybeQuery != null && !Number.isNaN(Number(maybeQuery)) ? Number(maybeQuery) : null;
		if (numericId !== null && inventoryLookup.byId.has(numericId)) {
			return inventoryLookup.byId.get(numericId);
		}
		const clean = safeLower(queryOrList);
		if (clean && inventoryLookup.byName.has(clean)) {
			return inventoryLookup.byName.get(clean);
		}
		return undefined;
	}, [inventoryLookup]);

	const categoryFamilyMap = useMemo(() => {
		const map = new Map();
		for (const c of dbCategories || []) {
			if (c?.name) map.set(safeLower(c.name), c.operationalFamily || "general");
		}
		return map;
	}, [dbCategories]);

	const getCategoryFamily = (categoryName) => {
		return categoryFamilyMap.get(safeLower(categoryName)) || "general";
	};

	useEffect(() => {
		refreshCategories?.();
	}, [refreshCategories]);

	useEffect(() => {
		const root = document.documentElement;
		const body = document.body;
		const previousRootOverflow = root.style.overflow;
		const previousBodyOverflow = body.style.overflow;
		const syncPageScroll = () => {
			const lockScroll = window.innerWidth > 700;
			root.style.overflow = lockScroll ? "hidden" : previousRootOverflow;
			body.style.overflow = lockScroll ? "hidden" : previousBodyOverflow;
		};

		syncPageScroll();
		window.addEventListener("resize", syncPageScroll);
		return () => {
			window.removeEventListener("resize", syncPageScroll);
			root.style.overflow = previousRootOverflow;
			body.style.overflow = previousBodyOverflow;
		};
	}, []);

	useEffect(() => {
    if (!syncNotice) return;
    syncTimer.current = setTimeout(() => setSyncNotice(""), 6000);
    return () => clearTimeout(syncTimer.current);
  }, [syncNotice]);
	const [imageError, setImageError] = useState("");

	useEffect(() => {
		if (!itemToDelete && !showForm) return;
		const handleKeyDown = (event) => {
			if (event.key !== "Escape") return;
			setItemToDelete(null);
			setShowForm(false);
			setEditingProduct(null);
			setEditingSizeIndex(null);
			setTargetFoodCostOverride(null);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [itemToDelete, showForm]);

	useEffect(() => {
		if (editingSizeIndex === null) return;
		const handleOutsideClick = (event) => {
			if (editingSizeRef.current && !editingSizeRef.current.contains(event.target)) {
				setEditingSizeIndex(null);
			}
		};
		document.addEventListener("mousedown", handleOutsideClick);
		return () => document.removeEventListener("mousedown", handleOutsideClick);
	}, [editingSizeIndex]);

	const openAddForm = () => {
		setEditingProduct(null);
		setFormValues(emptyForm());
		setEditingSizeIndex(null);
		setTargetFoodCostOverride(null);
		setMenuActionError("");
		setRecipeError("");
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
		setImageError("");
		setBuilderChapter("identity");
		setShowForm(true);
	};

	const isCupIngredient = (ing) => {
		if (!ing) return false;
		const invItem = findInventoryItem(ing.name || ing.item, ing.inventoryItemId);
		return Boolean(invItem?.isCupCategory || invItem?.is_cup_category || invItem?.category === "Cups" || invItem?.category === "Cups & Lids");
	};

	// Per-size amount: cups preserve the configured amount set by the merchant; other ingredients scale by factor.
	const amountForSize = (ing, sizeLabel, factor) => {
		if (!ing) return "0";
		if (isCupIngredient(ing)) return String(ing.quantityUsed ?? "1");
		return scaleIngredientAmount(ing.quantityUsed, factor, ing.unit);
	};

	const calculateCostForFactor = (factor, ingredients = formValues.ingredients) => {
		let rawCost = 0;
		for (const ing of (ingredients || [])) {
			if (!ing) continue;
			const invItem = findInventoryItem(ing.name || ing.item, ing.inventoryItemId);
			const unitCost = Number(invItem?.unitCost ?? invItem?.unit_cost ?? ing.unitCost ?? 0);
			const stockUnit = invItem?.unit || ing.stockUnit || ing.unit || "pcs";
			const recipeUnit = ing.unit || stockUnit;
			const scaledQty = Number(scaleIngredientAmount(ing.quantityUsed, factor, recipeUnit));
			const stockQty = convertRecipeAmount(scaledQty, recipeUnit, stockUnit);
			if (stockQty && unitCost > 0) {
				rawCost += stockQty * unitCost;
			}
		}
		return Number(Number.isFinite(rawCost) ? rawCost.toFixed(2) : 0);
	};

	const addVariation = () => {
		const family = getCategoryFamily(formValues.category);
		const presets = VARIATION_PRESETS[family] || STANDARD_SIZES;
		const existingLabels = (formValues.sizes || []).map((s) => safeLower(s?.label));
		const nextStandard = presets.find((std) => !existingLabels.some((lbl) => lbl.includes(safeLower(std.label).slice(0, 5))))
			|| { label: `Size ${(formValues.sizes || []).length + 1}`, factor: Number((1.0 + (formValues.sizes || []).length * 0.25).toFixed(2)) };

		const newIndex = (formValues.sizes || []).length;
		const factor = defaultSizeFactor(nextStandard.factor, newIndex);
		const basePrice = Number(formValues.price) > 0 ? Number(formValues.price) : 40;
		const baseCost = calculateCostForFactor(1.0);
		const sizeCost = calculateCostForFactor(factor);
		const price = computeInventoryBasedSizePrice(sizeCost, baseCost, basePrice, factor, newIndex);

		setFormValues((current) => {
			const newSizes = [...(current.sizes || []), { label: nextStandard.label, price, factor, cupId: null }];
			const updatedIngredients = (current.ingredients || []).map((ing) => {
				const qMap = writeSizeQtyValue(
					ing?.quantityBySize,
					nextStandard.label,
					amountForSize(ing, nextStandard.label, factor),
				);
				return { ...ing, quantityBySize: qMap };
			});
			return { ...current, sizes: newSizes, ingredients: updatedIngredients };
		});
		setEditingSizeIndex(newIndex);
	};

	const assignCupToSize = (sizeIndex, cupId) => {
		const numericCupId = cupId ? Number(cupId) : null;
		setFormValues((current) => {
			const targetSize = (current.sizes || [])[sizeIndex];
			if (!targetSize) return current;

			const updatedSizes = (current.sizes || []).map((s, idx) =>
				idx === sizeIndex ? { ...s, cupId: numericCupId } : s
			);

			const chosenCup = (inventory || []).find((item) => Number(item?.id) === numericCupId);
			const chosenCupName = getInvItemName(chosenCup);
			let updatedIngredients = [...(current.ingredients || [])];

			if (chosenCup && !updatedIngredients.some((ing) => (numericCupId && Number(ing?.inventoryItemId) === numericCupId) || safeLower(ing?.name) === safeLower(chosenCupName))) {
				updatedIngredients.push({
					inventoryItemId: chosenCup.id,
					name: chosenCupName,
					unit: chosenCup.unit || "pcs",
					stockUnit: chosenCup.unit || "pcs",
					quantityUsed: "1",
					quantityBySize: buildSafeSizeQtyMap(),
				});
			}

			updatedIngredients = updatedIngredients.map((ing) => {
				const isCup = Boolean(
					(numericCupId && Number(ing?.inventoryItemId) === numericCupId) ||
					isCupIngredient(ing) ||
					(chosenCup && safeLower(ing?.name) === safeLower(chosenCupName))
				);
				if (!isCup) return ing;
				const isThisCup = (numericCupId && Number(ing?.inventoryItemId) === numericCupId) ||
					(chosenCup && safeLower(ing?.name) === safeLower(chosenCupName));
				const qMap = writeSizeQtyValue(ing?.quantityBySize, targetSize.label, isThisCup ? "1" : "0");
				return { ...ing, quantityBySize: qMap };
			});

			return { ...current, sizes: updatedSizes, ingredients: updatedIngredients };
		});
	};

	const updateSizeFactor = (index, newFactor) => {
		const factorNum = Number(newFactor);
		setFormValues((current) => {
			const targetSize = (current.sizes || [])[index];
			const updatedSizes = (current.sizes || []).map((s, i) => i === index ? { ...s, factor: factorNum } : s);
			if (!targetSize || !Number.isFinite(factorNum) || factorNum <= 0) {
				return { ...current, sizes: updatedSizes };
			}
			const updatedIngredients = (current.ingredients || []).map((ing) => {
				if (isCupIngredient(ing)) return ing;
				const qMap = writeSizeQtyValue(
					ing?.quantityBySize,
					targetSize.label,
					scaleIngredientAmount(ing?.quantityUsed, factorNum, ing?.unit),
				);
				return { ...ing, quantityBySize: qMap };
			});
			return { ...current, sizes: updatedSizes, ingredients: updatedIngredients };
		});
	};

	const handleApplyVariationPreset = (presetList) => {
		const basePrice = Number(formValues.price) > 0 ? Number(formValues.price) : 40;
		const baseCost = calculateCostForFactor(1.0);

		const newSizes = (presetList || []).map((preset, index) => {
			const factor = defaultSizeFactor(preset?.factor, index);
			const sizeCost = calculateCostForFactor(factor);
			const price = computeInventoryBasedSizePrice(sizeCost, baseCost, basePrice, factor, index);
			return {
				label: preset?.label || "",
				price,
				factor,
				cupId: preset?.cupId || null,
			};
		});

		const updatedIngredients = (formValues.ingredients || []).map((ing) => {
			let qMap = buildSafeSizeQtyMap(ing?.quantityBySize);
			(presetList || []).forEach((preset, idx) => {
				if (!preset?.label) return;
				const factor = defaultSizeFactor(preset.factor, idx);
				qMap = writeSizeQtyValue(qMap, preset.label, amountForSize(ing, preset.label, factor));
			});
			return { ...ing, quantityBySize: qMap };
		});

		setFormValues((current) => ({
			...current,
			price: String(basePrice),
			sizes: newSizes,
			ingredients: updatedIngredients,
		}));
		setEditingSizeIndex(null);
	};

	const handleClearVariations = () => {
		setFormValues((current) => ({
			...current,
			sizes: [],
			ingredients: (current.ingredients || []).map((ing) => ({
				...ing,
				quantityUsed: (current.sizes || []).length > 0
					? resolveBaseRecipeQuantity({ ...ing, quantityUsed: "" }, current.sizes)
					: ing.quantityUsed,
				quantityBySize: buildSafeSizeQtyMap(),
			})),
		}));
		setEditingSizeIndex(null);
	};

	const handleAutoSetStandardSizes = () => {
		handleApplyVariationPreset(DRINK_STANDARD_SIZES);
	};

	const handleAutoSetFromCups = () => {
		const cupsToUse = cupInventoryItems.length ? cupInventoryItems : null;
		if (!cupsToUse || cupsToUse.length === 0) {
			handleAutoSetStandardSizes();
			return;
		}

		const basePrice = Number(formValues.price) > 0 ? Number(formValues.price) : 40;
		const baseCost = calculateCostForFactor(1.0);

		const newSizes = cupsToUse.map((cup, index) => {
			const cupName = getInvItemName(cup);
			const label = cupName.replace(/\s*cup\s*/i, "").trim() || cupName;
			const factor = index === 0 ? 1.0 : Number((1.0 + index * 0.25).toFixed(2));
			const sizeCost = calculateCostForFactor(factor);
			const price = computeInventoryBasedSizePrice(sizeCost, baseCost, basePrice, factor, index);
			return {
				label,
				price,
				factor,
				cupId: cup.id,
			};
		});

		const nonCupIngredients = (formValues.ingredients || []).filter((ing) => !isCupIngredient(ing));
		const scaledNonCupIngredients = nonCupIngredients.map((ing) => {
			const qMap = buildSafeSizeQtyMap(
				newSizes.map((s) => [s.label, scaleIngredientAmount(ing?.quantityUsed, s.factor, ing?.unit)]),
			);
			return { ...ing, quantityBySize: qMap };
		});

		const cupIngredients = cupsToUse.map((cup, cupIdx) => {
			const cupName = getInvItemName(cup);
			const qMap = buildSafeSizeQtyMap(
				newSizes.map((s, sIdx) => [s.label, cupIdx === sIdx ? "1" : "0"]),
			);
			return {
				inventoryItemId: cup.id,
				name: cupName,
				unit: cup.unit || "pcs",
				stockUnit: cup.unit || "pcs",
				quantityUsed: cupIdx === 0 ? "1" : "0",
				quantityBySize: qMap,
			};
		});

		setFormValues((current) => ({
			...current,
			price: String(basePrice),
			sizes: newSizes,
			ingredients: [...scaledNonCupIngredients, ...cupIngredients],
		}));
		setEditingSizeIndex(null);
	};

	const addSingleCupVariation = (cup) => {
		const cupName = getInvItemName(cup);
		const label = cupName.replace(/\s*cup\s*/i, "").trim() || cupName;
		const existingLabels = (formValues.sizes || []).map((s) => safeLower(s?.label));
		if (existingLabels.includes(safeLower(label))) {
			return;
		}

		const newIndex = (formValues.sizes || []).length;
		const factor = newIndex === 0 ? 1.0 : Number((1.0 + newIndex * 0.25).toFixed(2));
		const basePrice = Number(formValues.price) > 0 ? Number(formValues.price) : 40;
		const baseCost = calculateCostForFactor(1.0);
		const sizeCost = calculateCostForFactor(factor);
		const price = computeInventoryBasedSizePrice(sizeCost, baseCost, basePrice, factor, newIndex);

		setFormValues((current) => {
			const newSizes = [...(current.sizes || []), { label, price, factor, cupId: cup.id }];
			let hasThisCup = false;

			const updatedIngredients = (current.ingredients || []).map((ing) => {
				const isCup = isCupIngredient(ing) || (Number(ing?.inventoryItemId) === Number(cup.id)) || safeLower(ing?.name) === safeLower(cupName);
				const isThisCup = (Number(ing?.inventoryItemId) === Number(cup.id)) || safeLower(ing?.name) === safeLower(cupName);
				if (isThisCup) hasThisCup = true;

				const qMap = writeSizeQtyValue(
					ing?.quantityBySize,
					label,
					isCup ? (isThisCup ? "1" : "0") : scaleIngredientAmount(ing?.quantityUsed, factor, ing?.unit),
				);
				return { ...ing, quantityBySize: qMap };
			});

			if (!hasThisCup) {
				const qMap = buildSafeSizeQtyMap(
					newSizes.map((s) => [s.label, safeLower(s?.label) === safeLower(label) ? "1" : "0"]),
				);
				updatedIngredients.push({
					inventoryItemId: cup.id,
					name: cupName,
					unit: cup.unit || "pcs",
					stockUnit: cup.unit || "pcs",
					quantityUsed: (current.sizes || []).length === 0 ? "1" : "0",
					quantityBySize: qMap,
				});
			}

			return { ...current, sizes: newSizes, ingredients: updatedIngredients };
		});
		setEditingSizeIndex(newIndex);
	};

	const updateSizeLabel = (index, newLabel) => {
		setFormValues((current) => {
			const oldSize = current.sizes[index];
			const oldLabel = oldSize?.label;
			const factor = oldSize?.factor ?? defaultSizeFactor(null, index);
			const basePrice = Number(current.price) > 0 ? Number(current.price) : 40;
			const baseCost = calculateCostForFactor(1.0, current.ingredients);
			const sizeCost = calculateCostForFactor(factor, current.ingredients);
			const suggestedPrice = computeInventoryBasedSizePrice(sizeCost, baseCost, basePrice, factor, index);

			const currentPriceNum = Number(oldSize?.price);
			const shouldAutoUpdatePrice =
				oldSize?.price === "" ||
				oldSize?.price === null ||
				oldSize?.price === undefined ||
				(Number.isFinite(currentPriceNum) && currentPriceNum === basePrice && factor !== 1.0);

			const updatedPrice = shouldAutoUpdatePrice ? suggestedPrice : oldSize?.price;

			const updatedSizes = current.sizes.map((s, i) =>
				i === index ? { ...s, label: newLabel, price: updatedPrice } : s
			);

			const updatedIngredients = current.ingredients.map((ing) => {
				const prevMap = ing?.quantityBySize;
				const existingQty = oldLabel ? readSizeQtyValue(prevMap, oldLabel) : undefined;
				const retainedEntries =
					prevMap && typeof prevMap === "object"
						? Object.keys(prevMap)
								.filter((key) => !(oldLabel && key === oldLabel && oldLabel !== newLabel))
								.map((key) => [key, readSizeQtyValue(prevMap, key)])
						: [];
				let qMap = buildSafeSizeQtyMap(retainedEntries);
				if (newLabel) {
					qMap = writeSizeQtyValue(
						qMap,
						newLabel,
						existingQty !== undefined ? existingQty : amountForSize(ing, newLabel, factor),
					);
				}
				return { ...ing, quantityBySize: qMap };
			});

			return { ...current, sizes: updatedSizes, ingredients: updatedIngredients };
		});
	};

	const updateSizePrice = (index, newPrice) => {
		setFormValues((current) => ({
			...current,
			sizes: current.sizes.map((s, i) => i === index ? { ...s, price: newPrice } : s),
		}));
	};

	const updateBasePrice = (value) =>
		setFormValues((current) => ({
			...current,
			price: value,
		}));

	const removeSize = (index) => {
		if (editingSizeIndex === index) {
			setEditingSizeIndex(null);
		} else if (editingSizeIndex !== null && editingSizeIndex > index) {
			setEditingSizeIndex(editingSizeIndex - 1);
		}
		setFormValues((current) => {
			const removedLabel = current.sizes[index]?.label;
			const remainingSizes = current.sizes.filter((_, i) => i !== index);
			return {
				...current,
				sizes: remainingSizes,
				ingredients: current.ingredients.map((ingredient) => {
					const prevMap = ingredient?.quantityBySize;
					const quantityBySize = buildSafeSizeQtyMap(
						prevMap && typeof prevMap === "object"
							? Object.keys(prevMap)
									.filter((key) => key !== removedLabel)
									.map((key) => [key, readSizeQtyValue(prevMap, key)])
							: null,
					);
					return {
						...ingredient,
						quantityUsed: remainingSizes.length
							? resolveBaseRecipeQuantity({ ...ingredient, quantityUsed: "", quantityBySize }, remainingSizes)
							: ingredient.quantityUsed,
						quantityBySize,
					};
				}),
			};
		});
	};

	const openInventoryPicker = () => {
		const currentIds = new Set(
			(formValues.ingredients || []).map((ing) => {
				if (ing.inventoryItemId) return ing.inventoryItemId;
				const matched = findInventoryItem(ing.name);
				return matched?.id;
			}).filter(Boolean)
		);
		setSelectedInventoryItemIds(currentIds);
		setPickerSearch("");
		setPickerCategory("all");
		setShowInventoryPicker(true);
	};

	const togglePickerItem = (itemId) => {
		setSelectedInventoryItemIds((prev) => {
			const next = new Set(prev);
			if (next.has(itemId)) {
				next.delete(itemId);
			} else {
				next.add(itemId);
			}
			return next;
		});
	};

	const applyInventoryPicker = () => {
		const selectedArray = Array.from(selectedInventoryItemIds);
		const selectedInvItems = (inventory || []).filter((inv) => selectedArray.includes(inv.id));
		
		setFormValues((current) => {
			const existingMap = new Map();
			(current.ingredients || []).forEach((ing) => {
				const id = ing.inventoryItemId || findInventoryItem(ing.name)?.id;
				if (id) existingMap.set(id, ing);
				else existingMap.set(safeLower(ing.name), ing);
			});

			const updatedIngredients = selectedInvItems.map((inv) => {
				const existing = existingMap.get(inv.id) || existingMap.get(safeLower(safeItemName(inv)));
				if (existing) {
					return {
						...existing,
						inventoryItemId: inv.id,
						name: safeItemName(inv),
						stockUnit: inv.unit || existing.stockUnit || "pcs",
					};
				}
				const unit = inv.unit || "pcs";
				const defaultQty = 1;
				return {
					inventoryItemId: inv.id,
					name: safeItemName(inv),
					quantityUsed: defaultQty,
					unit,
					stockUnit: unit,
					quantityBySize: buildSafeSizeQtyMap(
						(current.sizes || []).map((size, idx) => [
							size.label,
							amountForSize({ name: safeItemName(inv), quantityUsed: defaultQty, unit }, size.label, defaultSizeFactor(size.factor, idx)),
						]),
					),
				};
			});

			return {
				...current,
				ingredients: updatedIngredients,
			};
		});

		setShowInventoryPicker(false);
	};

	const updateIngredientQuantityUsed = (index, val) => {
		setFormValues((current) => ({
			...current,
			ingredients: current.ingredients.map((ing, i) => {
				if (i !== index) return ing;
				const factorMap = buildSafeSizeQtyMap(
					(current.sizes || []).map((size, idx) => [
						size.label,
						amountForSize({ ...ing, quantityUsed: Number(val) || 0 }, size.label, defaultSizeFactor(size.factor, idx)),
					]),
				);
				return {
					...ing,
					quantityUsed: val,
					quantityBySize: factorMap,
				};
			}),
		}));
	};

	const addAddon = () => {
		const label = addonDraft.label.trim();
		const existingItem = findInventoryItem(label);
		if (!existingItem) {
			setRecipeError(`"${label}" is not in Inventory. Please pick an existing inventory item or add it in Inventory first.`);
			return;
		}
		const stockUnit = (existingItem?.unit || addonDraft.stockUnit || "").trim();
		const unit = (addonDraft.unit || "").trim();
		const unitHint = separateAmountHint(addonDraft.quantityUsed, unit, stockUnit, label || "this add-on");
		if (unitHint) {
			setRecipeError(unitHint);
			return;
		}
		const priceRaw = String(addonDraft.price ?? "").trim();
		const price = Number(priceRaw);
		const quantityUsed = Number(addonDraft.quantityUsed);
		if (!label || label.length > 100 || !stockUnit || stockUnit.length > 40 || !unit || unit.length > 40 || priceRaw === "" || !Number.isFinite(price) || price < 0) {
			setRecipeError("Enter a valid add-on name, price, stock unit, and recipe unit.");
			return;
		}
		if (!Number.isFinite(quantityUsed) || quantityUsed <= 0 || Number(quantityUsed.toFixed(6)) !== quantityUsed) {
			setRecipeError("Enter the add-on quantity used per serving (up to 6 decimal places).");
			return;
		}
		if (!convertRecipeAmount(quantityUsed, unit, stockUnit)) {
			setRecipeError(`“${unit}” and “${stockUnit}” cannot be converted automatically. Choose units from the same group (weight, volume, or count).`);
			return;
		}
		if ((formValues.addons || []).some((entry) => safeLower(entry?.label || entry?.name) === safeLower(label))) {
			setRecipeError("That add-on is already listed for this menu item.");
			return;
		}
		setFormValues((current) => ({ ...current, addons: [...current.addons, { inventoryItemId: existingItem.id, label, price, quantityUsed, unit, stockUnit }] }));
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
		setRecipeError("");
	};

	const removeIngredient = (index) =>
		setFormValues((current) => ({ ...current, ingredients: current.ingredients.filter((_, i) => i !== index) }));

	const updateSizeRecipeQuantity = (ingredientIndex, sizeLabel, quantityUsed) =>
		setFormValues((current) => ({
			...current,
			ingredients: current.ingredients.map((entry, entryIndex) => {
				if (entryIndex !== ingredientIndex) return entry;
				let nextQuantityBySize = writeSizeQtyValue(entry.quantityBySize, sizeLabel, quantityUsed);
				for (const s of (current.sizes || [])) {
					if (s?.label && readSizeQtyValue(nextQuantityBySize, s.label) === undefined) {
						nextQuantityBySize = writeSizeQtyValue(nextQuantityBySize, s.label, entry.quantityUsed || "0");
					}
				}
				return {
					...entry,
					quantityUsed: resolveBaseRecipeQuantity(
						{
							...entry,
							quantityUsed: (current.sizes || []).length > 0 ? "" : entry.quantityUsed,
							quantityBySize: nextQuantityBySize,
						},
						current.sizes,
					),
					quantityBySize: nextQuantityBySize,
				};
			}),
		}));

	const updateRecipeUnit = (index, unit) =>
		setFormValues((current) => ({
			...current,
			ingredients: current.ingredients.map((entry, entryIndex) => entryIndex === index ? { ...entry, unit } : entry),
		}));

	const removeAddon = (index) =>
		setFormValues((current) => ({ ...current, addons: current.addons.filter((_, i) => i !== index) }));

	const updateAddon = (index, key, value) =>
		setFormValues((current) => ({
			...current,
			addons: current.addons.map((addon, addonIndex) => addonIndex === index ? { ...addon, [key]: value } : addon),
		}));

	const applyImageFile = (file) => {
		if (!file) return;
		if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
			setImageError("Unsupported file type. Use PNG, JPG, JPEG or WEBP.");
			return;
		}
		shrinkImageToDataUri(file)
			.then((dataUri) => {
				setFormValues((current) => ({ ...current, image: dataUri }));
				setImageError("");
			})
			.catch((error) => setImageError(error?.message || "Could not read that file. Please try another."));
	};

	const handleImageUpload = (event) => {
		applyImageFile(event.target.files?.[0]);
		event.target.value = "";
	};

	const handleImageDrop = (event) => {
		event.preventDefault();
		applyImageFile(event.dataTransfer?.files?.[0]);
	};

	const closeForm = () => {
		if (isSaving) return;
		setShowForm(false);
		setEditingProduct(null);
		setEditingSizeIndex(null);
		setTargetFoodCostOverride(null);
		setRecipeError("");
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
		setImageError("");
		setBuilderChapter("identity");
	};

	const visibleProducts = useMemo(() => {
		const query = safeLower(search);
		const filtered = (products || []).filter((product) => {
			if (!product) return false;
			const categoryMatches = activeCategory === "All items" || product.category === activeCategory;
			const searchMatches = !query || safeLower(`${product.name || ""} ${product.category || ""}`).includes(query);
			return categoryMatches && searchMatches;
		});
		return [...filtered].sort((left, right) => {
			if (sortBy === "name") return String(left?.name || "").localeCompare(String(right?.name || ""));
			const leftPrice = Number(String(left?.price || "").replace(/[^0-9.]/g, "")) || 0;
			const rightPrice = Number(String(right?.price || "").replace(/[^0-9.]/g, "")) || 0;
			if (sortBy === "price") return leftPrice - rightPrice || String(left?.name || "").localeCompare(String(right?.name || ""));
			return Number(right?.featured) - Number(left?.featured) || String(left?.name || "").localeCompare(String(right?.name || ""));
		});
	}, [activeCategory, products, search, sortBy]);
	const pageCount = Math.max(1, Math.ceil(visibleProducts.length / MENU_PAGE_SIZE));
	const safePage = Math.min(currentPage, pageCount);
	const pageProducts = visibleProducts.slice((safePage - 1) * MENU_PAGE_SIZE, safePage * MENU_PAGE_SIZE);

	const toggleAvailability = async (id) => {
		if (togglingProductId === id) return;
		setMenuActionError("");
		setTogglingProductId(id);
		try {
			await updateProduct(id, { available: !products.find((product) => product.id === id)?.available });
		} catch (error) {
			setMenuActionError(error?.message || "Could not update product availability.");
		} finally {
			setTogglingProductId((prev) => (prev === id ? null : prev));
		}
	};

	const handleDelete = (product) => {
		if (!product) return;
		setMenuActionError("");
		setItemToDelete(product);
	};

	const confirmDelete = async () => {
		if (!itemToDelete || isDeleting) return;
		setMenuActionError("");
		setIsDeleting(true);
		try {
			await deleteProduct(itemToDelete.id);
			setItemToDelete(null);
		} catch (error) {
			setMenuActionError(error?.message || "Could not archive this menu item.");
		} finally {
			setIsDeleting(false);
		}
	};

	const openEditForm = (product) => {
		if (!product) return;
		setEditingProduct(product);
		setEditingSizeIndex(null);
		setTargetFoodCostOverride(null);
		setMenuActionError("");

		const rawSizes = Array.isArray(product.sizes) ? product.sizes : [];
		const rawIngredients = Array.isArray(product.ingredients) ? product.ingredients.filter(Boolean) : [];
		const rawAddons = Array.isArray(product.addons) ? product.addons.filter(Boolean) : [];

		const cleanRawSizes = rawSizes.filter(Boolean);
		const sizes = cleanRawSizes.map((size, idx) => {
			const sizeIngredients = Array.isArray(size.ingredients) ? size.ingredients.filter(Boolean) : [];
			const sizeCup = sizeIngredients.find((ing) => isCupIngredient(ing));
			return {
				label: String(size.label || `Size ${idx + 1}`),
				price: size.price != null && !Number.isNaN(Number(size.price)) ? String(size.price) : "",
				factor: size.factor ?? defaultSizeFactor(null, idx),
				cupId: sizeCup && sizeCup.inventoryItemId != null ? Number(sizeCup.inventoryItemId) : null,
			};
		});

		const mergedIngredients = [
			...rawIngredients,
			...rawSizes
				.flatMap((size) => (Array.isArray(size?.ingredients) ? size.ingredients.filter(Boolean) : []))
				.filter((entry, index, all) => {
					if (typeof entry === "string") return false;
					if (!entry || entry.inventoryItemId == null) return false;
					const entryId = Number(entry.inventoryItemId);
					const existsInBase = rawIngredients.some(
						(base) => typeof base !== "string" && base && Number(base.inventoryItemId) === entryId
					);
					const isFirstOccurrence =
						all.findIndex((other) => other && Number(other.inventoryItemId) === entryId) === index;
					return !existsInBase && isFirstOccurrence;
				}),
		];

		const ingredients = mergedIngredients.map((ingredient) => {
			if (typeof ingredient === "string") {
				const invItem = findInventoryItem(ingredient);
				return {
					name: invItem ? safeItemName(invItem) : ingredient,
					unit: invItem?.unit || "pcs",
					stockUnit: invItem?.unit || "pcs",
					quantityUsed: "",
					quantityBySize: buildSafeSizeQtyMap(),
				};
			}
			const invId = ingredient?.inventoryItemId != null ? Number(ingredient.inventoryItemId) : null;
			const invItem = findInventoryItem(ingredient?.name, invId);
			const quantityBySize = buildSafeSizeQtyMap(
				sizes.map((size, idx) => {
					const rawSizeObj = cleanRawSizes[idx];
					const sizedIngredient = Array.isArray(rawSizeObj?.ingredients)
						? rawSizeObj.ingredients.find((entry) => entry && ((invId !== null && Number(entry.inventoryItemId) === invId) || safeLower(entry.name) === safeLower(ingredient?.name)))
						: null;
					const fallbackQty = !Array.isArray(rawSizeObj?.ingredients)
						? (ingredient.quantityUsed != null ? String(ingredient.quantityUsed) : "0")
						: "0";
					return [
						size.label,
						sizedIngredient && sizedIngredient.quantityUsed != null ? String(sizedIngredient.quantityUsed) : fallbackQty,
					];
				}),
			);
			return {
				...ingredient,
				name: ingredient.name || safeItemName(invItem) || "",
				unit: ingredient.unit || invItem?.unit || "pcs",
				stockUnit: ingredient.stockUnit || invItem?.unit || ingredient.unit || "pcs",
				quantityUsed: resolveBaseRecipeQuantity({ ...ingredient, quantityBySize }, sizes),
				quantityBySize,
			};
		});

		const addons = rawAddons.map((addon) => {
			const invId = addon?.inventoryItemId != null ? Number(addon.inventoryItemId) : null;
			const addonLabel = String(addon?.label || "");
			const invItem = findInventoryItem(addonLabel, invId);
			return {
				...addon,
				label: addonLabel,
				price: addon?.price != null && !Number.isNaN(Number(addon.price)) ? String(addon.price) : "",
				quantityUsed: addon?.quantityUsed == null ? 1 : addon.quantityUsed,
				unit: addon?.unit || invItem?.unit || "pcs",
				stockUnit: addon?.stockUnit || invItem?.unit || addon?.unit || "pcs",
			};
		});

		setFormValues({
			name: String(product.name || ""),
			price: String(product.price || "").replace(/[^0-9.]/g, ""),
			costPrice: product.costPrice != null && Number.isFinite(Number(product.costPrice)) ? String(product.costPrice) : "",
			stock: product.stock != null ? String(product.stock) : "",
			description: product.description != null ? String(product.description) : "",
			category: product.category != null ? String(product.category) : (dbCategories[0]?.name || ""),
			image: product.image != null ? String(product.image) : "",
			sizes,
			ingredients,
			addons,
			available: product.available !== false,
		});
		setRecipeError("");
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
		setImageError("");
		setBuilderChapter("identity");
		setShowForm(true);
	};

	// Amount an ingredient uses in one size; blank or 0 means "not used in this size".
	const sizeQty = (ing, label) => {
		if (!ing) return 0;
		const explicit = readSizeQtyValue(ing.quantityBySize, label);
		const fallback = ing.quantityUsed;
		const raw = explicit ?? fallback;
		const amount = Number(raw);
		return raw !== "" && raw != null && Number.isFinite(amount) && amount > 0 ? amount : 0;
	};

	const saveProduct = async (event) => {
		event.preventDefault();
		if (isSaving) return;
		if (categoriesLoading || !formValues.category) {
			setRecipeError("Categories are still loading from database. Please wait.");
			return;
		}
		const name = String(formValues.name || "").trim();
		const description = String(formValues.description || "").trim();
		const numericPrice = Number(formValues.price);

		if (!name || String(formValues.price ?? "").trim() === "" || !description || !Number.isFinite(numericPrice) || numericPrice < 0) {
			setBuilderChapter("identity");
			setRecipeError("Enter a name, a description and a selling price of 0 or more.");
			return;
		}

		if (formValues.costPrice !== "" && (!Number.isFinite(Number(formValues.costPrice)) || Number(formValues.costPrice) < 0)) {
			setBuilderChapter("identity");
			setRecipeError("Cost to make must be 0 or more.");
			return;
		}

		// Clean and validate variation sizes
		const cleanSizes = (formValues.sizes || [])
			.map((s) => ({
				rawLabel: String(s?.label ?? ""),
				label: String(s?.label || "").trim(),
				price: s?.price,
			}))
			.filter((s) => s.label || (s.price !== "" && s.price !== null && s.price !== undefined));

		if (cleanSizes.length > 0) {
			for (const s of cleanSizes) {
				if (!s.label) {
					setBuilderChapter("sizes");
					setRecipeError("Each size needs a name, for example Large.");
					return;
				}
				const p = Number(s.price);
				if (s.price === "" || !Number.isFinite(p) || p < 0) {
					setBuilderChapter("sizes");
					setRecipeError(`Enter a price for the "${s.label}" size.`);
					return;
				}
			}
			const lowerLabels = cleanSizes.map((s) => safeLower(s.label));
			if (new Set(lowerLabels).size !== lowerLabels.length) {
				setBuilderChapter("sizes");
				setRecipeError("Each size needs a different name.");
				return;
			}
		}

		const finalSizes = cleanSizes.length
			? cleanSizes.map((size) => ({
					label: size.label,
					price: Number(size.price),
					ingredients: (formValues.ingredients || [])
						.map((ingredient) => {
							const matchedSizeLabel =
								readSizeQtyValue(ingredient?.quantityBySize, size.rawLabel) !== undefined
									? size.rawLabel
									: size.label;
							return {
								...(ingredient?.inventoryItemId ? { inventoryItemId: Number(ingredient.inventoryItemId) } : {}),
								name: String(ingredient?.name || "").trim(),
								quantityUsed: sizeQty(ingredient, matchedSizeLabel),
								unit: ingredient?.unit || "pcs",
								stockUnit: ingredient?.stockUnit || ingredient?.unit || "pcs",
							};
						})
						.filter((ingredient) => ingredient.quantityUsed > 0),
				}))
			: [{
					label: "Regular",
					price: numericPrice,
					ingredients: (formValues.ingredients || [])
						.map((ing) => ({
							...(ing?.inventoryItemId ? { inventoryItemId: Number(ing.inventoryItemId) } : {}),
							name: String(ing?.name || "").trim(),
							quantityUsed: Number(ing?.quantityUsed ?? readSizeQtyValue(ing?.quantityBySize, "Regular") ?? 0),
							unit: ing?.unit || "pcs",
							stockUnit: ing?.stockUnit || ing?.unit || "pcs",
						}))
						.filter((ing) => (ing.inventoryItemId || ing.name) && ing.quantityUsed > 0),
				}];

		if (finalSizes.some((size) => !Number.isFinite(size.price) || size.price < 0)) {
			setBuilderChapter("sizes");
			setRecipeError("Enter a price for every size.");
			return;
		}
		const emptySize = (formValues.ingredients || []).length > 0 ? finalSizes.find((size) => !size.ingredients.length) : null;
		if (emptySize) {
			setBuilderChapter("recipe");
			setRecipeError(`The ${emptySize.label} size uses no ingredients. Enter an amount above 0 for at least one ingredient.`);
			return;
		}

		if (getCategoryFamily(formValues.category) === "drink") {
			if (cupInventoryItems.length === 0) {
				setBuilderChapter("sizes");
				setRecipeError("Drinks need a cup, and there are no cups in Inventory. Add a cup in Inventory (category Cups & Lids) first.");
				return;
			}
			for (const size of finalSizes) {
				const hasCup = (size.ingredients || []).some((ing) => isCupIngredient(ing) && ing.quantityUsed > 0);
				if (!hasCup) {
					setBuilderChapter("sizes");
					setRecipeError(`Choose a cup for the "${size.label}" size. Every drink size needs one.`);
					return;
				}
			}
		}

		for (const addon of (formValues.addons || [])) {
			const addonLabel = String(addon?.label || addon?.name || "").trim();
			const addonPrice = Number(addon?.price);
			const addonQty = Number(addon?.quantityUsed);
			const addonId = Number(addon?.inventoryItemId);
			const matchedInv = (addonId > 0)
				? (inventory || []).find((entry) => Number(entry?.id) === addonId)
				: (inventory || []).find((entry) => safeLower(safeItemName(entry)) === safeLower(addonLabel));
			const addonUnit = String(addon?.unit || matchedInv?.unit || "pcs").trim();
			const addonStockUnit = String(matchedInv?.unit || addon?.stockUnit || addonUnit || "pcs").trim();

			if (!addonLabel || addon.price === "" || !Number.isFinite(addonPrice) || addonPrice < 0) {
				setBuilderChapter("addons");
				setRecipeError(`Enter a price of 0 or more for the add-on "${addonLabel || "unnamed"}".`);
				return;
			}
			if ((addon.inventoryItemId || addon.quantityUsed != null) && (!Number.isFinite(addonQty) || addonQty <= 0)) {
				setBuilderChapter("addons");
				setRecipeError(`Enter how much the add-on "${addonLabel}" uses.`);
				return;
			}
			if (Number.isFinite(addonQty) && addonQty > 0 && !convertRecipeAmount(addonQty, addonUnit, addonStockUnit)) {
				setBuilderChapter("addons");
				setRecipeError(`The add-on "${addonLabel}" is measured in ${addonUnit}, which cannot be turned into ${addonStockUnit}. Change its unit.`);
				return;
			}
		}

		const productBasePrice = finalSizes.find((size) => safeLower(size?.label) === "regular")?.price ?? finalSizes[0]?.price ?? numericPrice;
		const cleanStock = formValues.stock !== "" && !Number.isNaN(Number(formValues.stock))
			? Math.max(0, parseInt(formValues.stock, 10))
			: 0;

		const productData = {
			name,
			price: `₱${safeToFixed(productBasePrice, 2)}`,
			...(formValues.costPrice !== "" && Number.isFinite(Number(formValues.costPrice))
				? { costPrice: Number(formValues.costPrice) }
				: { costPrice: null }),
			description,
			category: formValues.category,
			image: formValues.image || "",
			available: formValues.available !== false,
			sizes: finalSizes,
			// Default recipe = the first size's recipe; every size also sends its own list.
			ingredients: finalSizes[0]?.ingredients || [],
			addons: (formValues.addons || []).map((addon) => ({ ...addon, price: Number(addon?.price || 0), quantityUsed: Number(addon?.quantityUsed || 1), unit: addon?.unit || "pcs", stockUnit: addon?.stockUnit || addon?.unit || "pcs" })),
		};

		setIsSaving(true);
		setRecipeError("");
		try {
			if (editingProduct) await updateProduct(editingProduct.id, { ...productData, stock: cleanStock });
			else await addProduct({ ...productData, stock: cleanStock, available: formValues.available !== false, featured: false });
			await refreshInventory?.().catch(() => null);
			setSyncNotice(`${name} saved successfully.`);
			setShowForm(false);
			setEditingProduct(null);
			setEditingSizeIndex(null);
			setTargetFoodCostOverride(null);
			setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
		} catch (error) {
			setRecipeError(error?.message || "Could not save this menu item.");
		} finally {
			setIsSaving(false);
		}
	};

	const availableCount = useMemo(() => (products || []).filter((product) => product?.available).length, [products]);
	const lowStockCount = useMemo(() => (products || []).filter((product) => product?.stock > 0 && product?.stock <= 7).length, [products]);
	const outOfStockCount = useMemo(() => (products || []).filter((product) => (product?.stock ?? 0) === 0).length, [products]);
	const featuredCount = useMemo(() => (products || []).filter((product) => product?.featured).length, [products]);
	const categoryCounts = useMemo(() => {
		const map = new Map();
		map.set("All items", (products || []).length);
		for (const p of products || []) {
			if (!p?.category) continue;
			map.set(p.category, (map.get(p.category) || 0) + 1);
		}
		return map;
	}, [products]);

	const effectiveTargetCostRatio = normalizeTargetFoodCost(
		(Number(targetFoodCostPct) || 30) / 100,
		DEFAULT_TARGET_FOOD_COST,
	);

	const sizeCostingsByIndex = useMemo(() => {
		const formPrice = Number(formValues.price) || 0;
		const ingredients = (formValues.ingredients || []).filter(Boolean);

		return (formValues.sizes || []).map((size, idx) => {
			const rawSizePrice = size?.price;
			const numericPrice = rawSizePrice !== "" && rawSizePrice !== null && rawSizePrice !== undefined && !Number.isNaN(Number(rawSizePrice))
				? Number(rawSizePrice)
				: formPrice;
			return computeMenuItemCostSummary({
				sellingPrice: numericPrice,
				directCostPrice: formValues.costPrice,
				sizeLabel: size?.label || "",
				sizeFactor: defaultSizeFactor(size?.factor, idx),
				ingredients,
				inventory,
				targetFoodCost: effectiveTargetCostRatio,
			});
		});
	}, [effectiveTargetCostRatio, formValues.costPrice, formValues.ingredients, formValues.price, formValues.sizes, inventory]);

	const singleItemCosting = useMemo(() => {
		const rawPrice = formValues.price;
		const numericPrice = rawPrice !== "" && rawPrice !== null && rawPrice !== undefined && !Number.isNaN(Number(rawPrice))
			? Number(rawPrice)
			: 0;
		return computeMenuItemCostSummary({
			sellingPrice: numericPrice,
			directCostPrice: formValues.costPrice,
			sizeLabel: "",
			sizeFactor: 1.0,
			ingredients: (formValues.ingredients || []).filter(Boolean),
			inventory,
			targetFoodCost: effectiveTargetCostRatio,
		});
	}, [effectiveTargetCostRatio, formValues.costPrice, formValues.ingredients, formValues.price, inventory]);

	const applySuggestedSizePrice = (index, suggestedPrice) => {
		if (suggestedPrice == null) return;
		const nextPrice = String(suggestedPrice);
		setFormValues((current) => {
			const targetLabel = safeLower(current.sizes[index]?.label);
			const shouldUpdateBase = index === 0 || targetLabel.includes("regular");
			return {
				...current,
				price: shouldUpdateBase ? nextPrice : current.price,
				sizes: (current.sizes || []).map((s, i) => (i === index ? { ...s, price: nextPrice } : s)),
			};
		});
	};

	const applySuggestedBasePrice = (suggestedPrice) => {
		if (suggestedPrice == null) return;
		setFormValues((current) => ({ ...current, price: String(suggestedPrice) }));
	};

	// ---- Add / edit item form: what each step shows in the step bar and on Review ----
	const builderFamily = getCategoryFamily(formValues.category);
	const builderIsDrink = builderFamily === "drink";
	const builderStepIndex = Math.max(0, BUILDER_STEPS.findIndex((step) => step.key === builderChapter));
	const builderPriceOk = String(formValues.price ?? "").trim() !== "" && Number.isFinite(Number(formValues.price)) && Number(formValues.price) >= 0;
	const builderBasicsOk = Boolean(String(formValues.name || "").trim() && String(formValues.description || "").trim() && builderPriceOk && formValues.category);
	const builderSizeCount = (formValues.sizes || []).length;
	const builderIngredientCount = (formValues.ingredients || []).length;
	const builderAddonCount = (formValues.addons || []).length;
	const builderHasCup = (label) => (formValues.ingredients || []).some((ing) => isCupIngredient(ing) && sizeQty(ing, label) > 0);
	const builderMissingCups = !builderIsDrink
		? []
		: builderSizeCount
			? formValues.sizes.filter((size) => !(size?.cupId || builderHasCup(size?.label))).map((size) => size?.label || "Unnamed size")
			: (builderHasCup() ? [] : ["this drink"]);
	const countLabel = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
	const builderStepDone = {
		identity: builderBasicsOk,
		sizes: builderSizeCount > 0 && builderMissingCups.length === 0,
		recipe: builderIngredientCount > 0,
		addons: builderAddonCount > 0,
		review: false,
	};
	const builderStepWarn = { identity: false, sizes: builderMissingCups.length > 0, recipe: false, addons: false, review: false };
	const builderStepNote = {
		identity: builderBasicsOk ? "Done" : "Required",
		sizes: builderMissingCups.length ? "Needs a cup" : builderSizeCount ? countLabel(builderSizeCount, "size") : "One price",
		recipe: builderIngredientCount ? countLabel(builderIngredientCount, "ingredient") : "Optional",
		addons: builderAddonCount ? countLabel(builderAddonCount, "add-on") : "Optional",
		review: editingProduct ? "Save" : "Add item",
	};
	const profitTone = (margin) => (margin == null || !Number.isFinite(margin) ? "neutral" : margin >= 50 ? "good" : margin >= 30 ? "warn" : "low");
	const builderMissingBasics = [
		!String(formValues.name || "").trim() && "name",
		!builderPriceOk && "selling price",
		!String(formValues.description || "").trim() && "description",
	].filter(Boolean);
	const builderChecklist = [
		{
			key: "basics",
			step: "identity",
			state: builderBasicsOk ? "ok" : "bad",
			title: "Basics",
			text: builderBasicsOk
				? `${String(formValues.name).trim()}, ₱${safeToFixed(formValues.price, 2)}, ${formValues.category}`
				: `Still needed: ${builderMissingBasics.join(", ")}`,
		},
		{
			key: "sizes",
			step: "sizes",
			state: builderMissingCups.length ? "bad" : "ok",
			title: "Sizes",
			text: builderMissingCups.length
				? `Needs a cup: ${builderMissingCups.join(", ")}. Choose a cup for each size, or add a cup in Ingredients.`
				: builderSizeCount
					? formValues.sizes.map((size) => `${size?.label || "Unnamed"} ₱${safeToFixed(size?.price !== "" && size?.price != null ? size.price : formValues.price, 2)}`).join(", ")
					: `Sells at one price, ₱${safeToFixed(formValues.price, 2)}`,
		},
		{
			key: "recipe",
			step: "recipe",
			state: builderIngredientCount ? "ok" : "skip",
			title: "Ingredients",
			text: builderIngredientCount
				? countLabel(builderIngredientCount, "ingredient")
				: "None. Stock and cost will not come from a recipe.",
		},
		{
			key: "addons",
			step: "addons",
			state: builderAddonCount ? "ok" : "skip",
			title: "Add-ons",
			text: builderAddonCount ? formValues.addons.map((addon) => addon.label).join(", ") : "None",
		},
		{
			key: "menu",
			step: "identity",
			state: "ok",
			title: "On the menu",
			text: formValues.available ? "Customers will see this item." : "Hidden from customers for now.",
		},
	];

	return (
		<div className={`admin-menu-page ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${(showForm || itemToDelete) ? "modal-open" : ""} ${isMobile ? "is-mobile" : ""} ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
      {mobileNavOpen && <div className="am-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />}
      <Sidebar
        role="admin"
        activeTab="menu"
        sidebarCollapsed={sidebarCollapsed}
        onToggle={() => (isMobile ? setMobileNavOpen(false) : toggleSidebar())}
      />

			{isMobile ? (
				<main className="am-main">
					<header className="am-appbar">
						<button type="button" className="am-icon-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation menu"><Menu size={22} /></button>
						{searchOpen ? (
							<label className="am-search">
								<Search size={18} aria-hidden="true" />
								<input autoFocus type="search" value={search} onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }} placeholder="Search menu" aria-label="Search menu items" />
								<button type="button" onClick={() => { setSearch(""); setSearchOpen(false); }} aria-label="Close search"><X size={18} /></button>
							</label>
						) : (
							<>
								<div className="am-title"><h1>Menu</h1><span>{products.length} items · {availableCount} available</span></div>
								<button type="button" className="am-icon-btn" onClick={() => setSearchOpen(true)} aria-label="Search menu"><Search size={20} /></button>
								<Link to="/admin/archive" className="am-icon-btn" aria-label="View archive"><Archive size={20} /></Link>
							</>
						)}
					</header>

					<div className="am-stats" aria-label="Menu overview">
						<span className="ok"><b>{availableCount}</b> ready</span>
						<span className="low"><b>{lowStockCount}</b> low</span>
						<span className="star"><b>{featuredCount}</b> featured</span>
					</div>

					<div className="am-chips" role="tablist" aria-label="Menu categories">
						{categories.map((category) => (
							<button type="button" role="tab" aria-selected={activeCategory === category} key={category} className={activeCategory === category ? "on" : ""} onClick={() => { setActiveCategory(category); setCurrentPage(1); }}>
								{category}<b>{categoryCounts.get(category) || 0}</b>
							</button>
						))}
					</div>

					<div className="am-sortbar">
						<span>{visibleProducts.length} shown</span>
						<select aria-label="Sort menu items" value={sortBy} onChange={(event) => { setSortBy(event.target.value); setCurrentPage(1); }}>
							<option value="popular">Featured first</option>
							<option value="name">Name A–Z</option>
							<option value="price">Price low–high</option>
						</select>
					</div>

					{menuActionError && (
						<div className="admin-menu-action-error" role="alert">
							<span>{menuActionError}</span>
							<button type="button" onClick={() => setMenuActionError("")} aria-label="Dismiss error">×</button>
						</div>
					)}

					<ul className="am-grid">
						{pageProducts.map((product) => (
							<li key={product.id} className={`am-card ${!product.available ? "off" : ""}`}>
								<button type="button" className="am-thumb" onClick={() => openEditForm(product)} aria-label={`Edit ${product.name}`}>
									<img src={product.image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
									{product.featured && <span className="am-star">★</span>}
								</button>
								<button type="button" className="am-more" onClick={() => setActionProduct(product)} aria-label={`Actions for ${product.name}`}>&#8942;</button>
								<div className="am-body">
									<small>{product.category}</small>
									<strong>{product.name}</strong>
									<span className="am-price">{product.price}</span>
									<span className={`am-stock ${product.stock === 0 ? "out" : product.stock <= 7 ? "low" : ""}`}>{product.stock === 0 ? "Out of stock" : `${product.stock} in stock`}</span>
								</div>
								<label className="am-switch">
									<input type="checkbox" checked={product.available} disabled={togglingProductId === product.id} onChange={() => toggleAvailability(product.id)} />
									<span aria-hidden="true" />
									<em>{product.available ? "Available" : "Hidden"}</em>
								</label>
							</li>
						))}
						{!visibleProducts.length && (
							<li className="am-empty" role={menuError ? "alert" : undefined}>
								<Package size={36} aria-hidden="true" />
								<strong>{menuError ? "Could not load menu" : "No items found"}</strong>
								<span>{menuError || "Try another category or search."}</span>
							</li>
						)}
					</ul>

					{visibleProducts.length > 0 && pageCount > 1 && (
						<nav className="am-pager" aria-label="Menu pages">
							<button type="button" onClick={() => setCurrentPage(Math.max(1, safePage - 1))} disabled={safePage === 1}>Prev</button>
							<span>{safePage} / {pageCount}</span>
							<button type="button" onClick={() => setCurrentPage(Math.min(pageCount, safePage + 1))} disabled={safePage === pageCount}>Next</button>
						</nav>
					)}

					<button type="button" className="am-fab" onClick={openAddForm}><Plus size={20} strokeWidth={2.6} aria-hidden="true" />Add</button>

					{actionProduct && (
						<div className="am-sheet-wrap" role="presentation" onClick={() => setActionProduct(null)}>
							<div className="am-sheet" role="dialog" aria-modal="true" aria-label={`Actions for ${actionProduct.name}`} onClick={(e) => e.stopPropagation()}>
								<span className="am-sheet-handle" aria-hidden="true" />
								<h2>{actionProduct.name}</h2>
								<button type="button" onClick={() => { openEditForm(actionProduct); setActionProduct(null); }}><Pencil size={20} aria-hidden="true" />Edit item</button>
								<button type="button" className="danger" onClick={() => { handleDelete(actionProduct); setActionProduct(null); }}><Trash2 size={20} aria-hidden="true" />Delete item</button>
							</div>
						</div>
					)}
				</main>
			) : (
			<main className="admin-menu-main">
				<header className="admin-menu-topbar storefront-topbar">
					<div className="admin-menu-topbar-brand">
						<span className="admin-menu-topbar-crest" aria-hidden="true">
							<Utensils size={20} strokeWidth={2} />
						</span>
						<div className="admin-menu-topbar-copy">
							<div className="admin-menu-topbar-eyebrow">
								<span className="admin-menu-section-label">Storefront Catalog</span>
								<span className="admin-menu-topbar-live-pill">
									<span className="topbar-live-dot" aria-hidden="true" />
									{availableCount} of {products.length} Live
								</span>
							</div>
							<h1>Menu Management</h1>
							<p className="admin-menu-topbar-sub">Organize counter items, plated pricing, and live recipe availability.</p>
						</div>
					</div>
					<div className="admin-menu-topbar-actions">
						{outOfStockCount > 0 ? (
							<span className="admin-menu-status-chip alert" role="status">
								<AlertTriangle size={14} strokeWidth={2.2} aria-hidden="true" />
								<span>{outOfStockCount} out of stock</span>
							</span>
						) : lowStockCount > 0 ? (
							<span className="admin-menu-status-chip warn" role="status">
								<Clock size={14} strokeWidth={2.2} aria-hidden="true" />
								<span>{lowStockCount} low stock</span>
							</span>
						) : (
							<span className="admin-menu-status-chip ready" role="status">
								<CheckCircle2 size={14} strokeWidth={2.2} aria-hidden="true" />
								<span>Board ready</span>
							</span>
						)}
						<Link to="/admin/archive" className="admin-menu-archive-button">
							<Archive size={15} strokeWidth={2.1} aria-hidden="true" />
							<span>View Archive</span>
						</Link>
						<button type="button" className="admin-menu-add-button" onClick={openAddForm}>
							<Plus size={16} strokeWidth={2.4} aria-hidden="true" />
							<span>Add new item</span>
						</button>
					</div>
				</header>

				<div className="admin-menu-content custom-menu-scrollbar">
					<div className="admin-menu-workspace">
						<div className="admin-menu-main-pane">
							<section className="admin-menu-panel menu-storefront-board">
								<div className="menu-board-curtain" aria-hidden="true">
									<div className="menu-board-curtain-seal">
										<Utensils size={18} strokeWidth={2} />
										<span>AMAYA STOREFRONT MENU</span>
									</div>
								</div>

								<div className="menu-board-marquee">
									<div className="menu-board-marquee-left">
										<span className="menu-board-marquee-badge">
											<Utensils size={12} strokeWidth={2.2} aria-hidden="true" />
											<span>AMAYA CAFÉ · IN-STORE MENU BOARD</span>
										</span>
									</div>
									<div className="menu-board-marquee-meta" aria-hidden="true">
										<span>{availableCount} On Board</span>
										<span className="menu-board-meta-dot" />
										<span>{featuredCount} Featured</span>
									</div>
								</div>

								<div className="admin-menu-toolbar">
									<div className="admin-menu-tabs">
										<div className="admin-menu-tabs-scroll" role="tablist" aria-label="Menu categories">
											{categories.map((category) => (
												<button
													type="button"
													role="tab"
													aria-selected={activeCategory === category}
													key={category}
													className={activeCategory === category ? "active" : ""}
													onClick={() => { setActiveCategory(category); setCurrentPage(1); }}
												>
													{category}
													<span>{categoryCounts.get(category) || 0}</span>
												</button>
											))}
										</div>
										<Link
											to="/admin/categories"
											className="admin-menu-manage-link"
											title="Manage Categories in Database"
										>
											<Settings2 size={13} strokeWidth={2.1} aria-hidden="true" />
											<span>Manage</span>
										</Link>
									</div>
									<div className="admin-menu-toolbar-actions">
										<label className="admin-menu-search">
											<Search size={14} strokeWidth={2.1} aria-hidden="true" />
											<input
												value={search}
												onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }}
												placeholder="Search menu items"
												aria-label="Search menu items"
											/>
											{search && (
												<button
													type="button"
													className="admin-menu-search-clear"
													onClick={() => { setSearch(""); setCurrentPage(1); }}
													aria-label="Clear search"
												>
													<X size={13} strokeWidth={2.2} aria-hidden="true" />
												</button>
											)}
										</label>
										<div className="admin-menu-sort-wrap">
											<ArrowUpDown size={13} strokeWidth={2.1} className="admin-menu-sort-icon" aria-hidden="true" />
											<select aria-label="Sort menu items" value={sortBy} onChange={(event) => { setSortBy(event.target.value); setCurrentPage(1); }}>
												<option value="popular">Sort: Featured first</option>
												<option value="name">Sort: Name A–Z</option>
												<option value="price">Sort: Price low to high</option>
											</select>
										</div>
									</div>
								</div>

								<div className="admin-menu-grid-wrap custom-menu-scrollbar">
									<div className="menu-board-section-banner">
										<div className="menu-board-section-title">
											<span className="menu-board-eyebrow">
												{search.trim() ? "Filtered Store Listing" : "Current Store Listing"}
											</span>
											<div className="menu-board-heading-row">
												<h3>{activeCategory}</h3>
												<span className="menu-board-count-pill">
													{visibleProducts.length} {visibleProducts.length === 1 ? "listing" : "listings"}
												</span>
											</div>
										</div>
										<div className="menu-board-ribbon">
											<span>{visibleProducts.filter((item) => item?.available).length} Live in Store</span>
										</div>
									</div>

									{menuActionError && (
										<div className="admin-menu-action-error" role="alert">
											<span>{menuActionError}</span>
											<button type="button" onClick={() => setMenuActionError("")} aria-label="Dismiss error">×</button>
										</div>
									)}

									<div className="admin-menu-grid" key={`${activeCategory}-${safePage}-${sortBy}`}>
										{pageProducts.map((product, index) => (
											<article
												className={`admin-product-card store-menu-card ${!product.available ? "unavailable" : ""}`}
												key={product.id}
												style={{ "--card-index": Math.min(index, 11) }}
											>
												<div
													className={`admin-product-image ${!product.image ? "image-unavailable" : ""}`}
													onClick={() => openEditForm(product)}
													role="button"
													tabIndex={0}
													onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEditForm(product); } }}
													title={`Click to edit ${product.name}`}
												>
													{product.image && (
														<img
															src={product.image}
															alt={product.name}
															loading="lazy"
															onError={(event) => {
																event.currentTarget.style.display = "none";
																event.currentTarget.parentElement.classList.add("image-unavailable");
															}}
														/>
													)}
													<span className="store-menu-img-fallback" aria-hidden="true">
														<Coffee size={24} strokeWidth={1.75} />
													</span>
													{product.featured && (
														<span className="featured-label">
															<Star size={10} fill="currentColor" strokeWidth={2.2} aria-hidden="true" />
															<span>Featured</span>
														</span>
													)}
													<button
														type="button"
														className="product-menu-button"
														aria-label={`Edit ${product.name}`}
														onClick={(e) => { e.stopPropagation(); openEditForm(product); }}
													>
														<Pencil size={13} strokeWidth={2.1} aria-hidden="true" />
													</button>
													{!product.available && (
														<span className="store-menu-hidden-stamp">Hidden</span>
													)}
												</div>
												<div className="admin-product-body">
													<div className="admin-product-meta store-menu-card-eyebrow">
														<span>{product.category}</span>
														{Array.isArray(product.sizes) && product.sizes.length > 0 && (
															<small className="store-menu-size-count">
																{product.sizes.length} {product.sizes.length === 1 ? "size" : "sizes"}
															</small>
														)}
													</div>
													<div className="store-menu-leader-row">
														<h4 title={product.name}>{product.name}</h4>
														<span className="store-menu-leader-dots" aria-hidden="true" />
														<strong className="store-menu-price">{product.price}</strong>
													</div>
													<div className="admin-product-footer">
														<span className={`stock-label ${product.stock === 0 ? "out" : product.stock <= 7 ? "low" : ""}`}>
															{product.stock === 0 ? "Out of stock" : `${product.stock} in stock`}
														</span>
														<label className="availability-toggle">
															<input type="checkbox" checked={product.available} disabled={togglingProductId === product.id} onChange={() => toggleAvailability(product.id)} />
															<span></span>
															<small>{product.available ? "Available" : "Hidden"}</small>
														</label>
														<button
															type="button"
															className="product-delete-button"
															onClick={() => handleDelete(product)}
															aria-label={`Delete ${product.name}`}
															title={`Delete ${product.name}`}
														>
															<Trash2 size={13} strokeWidth={2.1} aria-hidden="true" />
														</button>
													</div>
												</div>
											</article>
										))}
										{!visibleProducts.length && (
											<div className="admin-menu-empty" role={menuError ? "alert" : undefined}>
												<Coffee size={28} strokeWidth={1.7} aria-hidden="true" />
												<strong>{menuError ? "Could not load menu items" : "No menu items found"}</strong>
												<span>{menuError || "Try another category or search term."}</span>
											</div>
										)}
									</div>
								</div>

								{visibleProducts.length > 0 && (
									<nav className="admin-menu-pagination" aria-label="Menu catalog pages">
										<span>Showing {(safePage - 1) * MENU_PAGE_SIZE + 1}–{Math.min(safePage * MENU_PAGE_SIZE, visibleProducts.length)} of {visibleProducts.length} items</span>
										<div>
											<button type="button" onClick={() => setCurrentPage(Math.max(1, safePage - 1))} disabled={safePage === 1}>Previous</button>
											<span>Page {safePage} of {pageCount}</span>
											<button type="button" onClick={() => setCurrentPage(Math.min(pageCount, safePage + 1))} disabled={safePage === pageCount}>Next</button>
										</div>
									</nav>
								)}
							</section>
						</div>

						<aside className="admin-menu-side-rail" aria-label="Menu overview and statistics">
							<div className="admin-menu-side-rail-sticky">
								<div className="admin-menu-side-rail-title">
									<Utensils size={15} aria-hidden="true" />
									<span>Menu Overview</span>
								</div>

								<div className="admin-menu-metrics">
									<article className="metric-card">
										<div className="metric-card-head">
											<span className="metric-icon amber">
												<Package size={17} strokeWidth={1.9} aria-hidden="true" />
											</span>
											<span className="metric-badge neutral">Total</span>
										</div>
										<div className="metric-body">
											<span className="metric-label">Total Items</span>
											<strong className="metric-value">{products.length}</strong>
											<span className="metric-hint">Across {categories.length - 1} categories</span>
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
											<span className="metric-label">Available Now</span>
											<strong className="metric-value">{availableCount}</strong>
											<span className="metric-hint">Ready to order</span>
										</div>
									</article>

									<article className="metric-card">
										<div className="metric-card-head">
											<span className="metric-icon orange">
												<Clock size={17} strokeWidth={2} aria-hidden="true" />
											</span>
											<span className="metric-badge amber">Review</span>
										</div>
										<div className="metric-body">
											<span className="metric-label">Low Stock</span>
											<strong className="metric-value">{lowStockCount}</strong>
											<span className="metric-hint">Needs restocking</span>
										</div>
									</article>

									<article className="metric-card">
										<div className="metric-card-head">
											<span className="metric-icon plum">
												<Sparkles size={17} strokeWidth={2} aria-hidden="true" />
											</span>
											<span className="metric-badge plum">Featured</span>
										</div>
										<div className="metric-body">
											<span className="metric-label">Featured Items</span>
											<strong className="metric-value">{featuredCount}</strong>
											<span className="metric-hint">Shown on homepage</span>
										</div>
									</article>
								</div>
							</div>
						</aside>
					</div>
				</div>
			</main>
			)}

			<MenuArchiveConfirmModal
				itemToDelete={itemToDelete}
				menuActionError={menuActionError}
				isDeleting={isDeleting}
				onClose={() => !isDeleting && setItemToDelete(null)}
				onConfirm={confirmDelete}
			/>

			{showForm && (
				<ErrorBoundary
					fallback={({ error, reset }) => (
						<div className="admin-menu-modal-backdrop" role="presentation" onClick={closeForm}>
							<div className="admin-menu-modal" style={{ maxWidth: 500, padding: "2rem" }} onClick={(e) => e.stopPropagation()}>
								<h3 style={{ color: "#b91c1c", fontWeight: "bold", marginBottom: "0.5rem" }}>⚠️ Form Render Error</h3>
								<p style={{ fontSize: "0.875rem", color: "#4b5563", marginBottom: "1rem" }}>
									{error?.message || "An unexpected error occurred while displaying the product form."}
								</p>
								<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
									<button type="button" className="menu-builder-cancel" onClick={closeForm}>Close</button>
									<button type="button" className="menu-builder-save" onClick={reset}>Try Again</button>
								</div>
							</div>
						</div>
					)}
				>
					<div className="mb-backdrop" role="presentation" onClick={closeForm}>
						<form
							className="mb-sheet"
							onSubmit={saveProduct}
							onKeyDown={(event) => {
								// Enter in a text box moves nothing and saves nothing until the Review step
								if (event.key === "Enter" && event.target.tagName === "INPUT" && builderChapter !== "review") event.preventDefault();
							}}
							role="dialog"
							aria-modal="true"
							aria-labelledby="edit-item-title"
							onClick={(event) => event.stopPropagation()}
							noValidate
						>
							<header className="mb-head">
								<div className="mb-head-copy">
									<h3 id="edit-item-title">{editingProduct ? "Edit menu item" : "Add menu item"}</h3>
									<p>{String(formValues.name || "").trim() || (editingProduct ? "Update this item step by step." : "Fill in each step. Sizes, ingredients and add-ons are optional.")}</p>
								</div>
								<button type="button" className="mb-close" onClick={closeForm} disabled={isSaving} aria-label="Close form">
									<X size={18} strokeWidth={2} aria-hidden="true" />
								</button>
							</header>

							<nav className="mb-steps" aria-label="Steps">
								<ol>
									{BUILDER_STEPS.map((step, index) => {
										const isCurrent = builderChapter === step.key;
										const isDone = builderStepDone[step.key];
										return (
											<li key={step.key}>
												<button
													type="button"
													className={`mb-step${isCurrent ? " is-current" : ""}${isDone ? " is-done" : ""}${builderStepWarn[step.key] ? " is-warn" : ""}`}
													aria-current={isCurrent ? "step" : undefined}
													onClick={() => setBuilderChapter(step.key)}
												>
													<span className="mb-step-num" aria-hidden="true">{isDone && !isCurrent ? <Check size={14} strokeWidth={2.6} /> : index + 1}</span>
													<span className="mb-step-text">
														<strong>{step.label}</strong>
														<small>{builderStepNote[step.key]}</small>
													</span>
												</button>
											</li>
										);
									})}
								</ol>
							</nav>

							<div className="mb-body">
								<div className="mb-main">
									{/* ---------------- Step 1: Basics ---------------- */}
									{builderChapter === "identity" && (
										<section className="mb-panel" aria-labelledby="mb-basics-title">
											<header className="mb-panel-head">
												<h4 id="mb-basics-title">Basics</h4>
												<p>What customers see on the menu.</p>
											</header>

											<div className="mb-basics-grid">
												<div className="mb-photo">
													<span className="mb-label">Photo <em>optional</em></span>
													{formValues.image ? (
														<div className="mb-photo-card">
															<img src={formValues.image} alt="Menu item preview" />
															<div className="mb-photo-actions">
																<label className="mb-btn is-small">
																	<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageUpload} aria-label="Change product image" />
																	<FolderOpen size={14} strokeWidth={2} aria-hidden="true" /> Change
																</label>
																<button
																	type="button"
																	className="mb-btn is-small is-danger"
																	onClick={() => {
																		setFormValues((prev) => ({ ...prev, image: "" }));
																		setImageError("");
																	}}
																>
																	<Trash2 size={14} strokeWidth={2} aria-hidden="true" /> Remove
																</button>
															</div>
														</div>
													) : (
														<label className="mb-drop" onDragOver={(event) => event.preventDefault()} onDrop={handleImageDrop}>
															<input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleImageUpload} aria-label="Upload product image" />
															<ImagePlus size={24} strokeWidth={1.7} aria-hidden="true" />
															<strong>Add a photo</strong>
															<small>Click or drop a PNG, JPG or WEBP file</small>
														</label>
													)}
													{imageError ? <p className="mb-error" role="alert">{imageError}</p> : null}
												</div>

												<div className="mb-fields">
													<label className="mb-field is-wide">
														<span className="mb-label">Item name</span>
														<input
															type="text"
															value={formValues.name}
															onChange={(event) => setFormValues({ ...formValues, name: event.target.value })}
															placeholder="e.g. Classic Milk Tea"
															required
														/>
													</label>

													<label className="mb-field">
														<span className="mb-label">Category</span>
														<select
															value={formValues.category}
															onChange={(event) => setFormValues({ ...formValues, category: event.target.value })}
															disabled={categoriesLoading}
														>
															{categoriesLoading ? (
																<option value="">Loading categories…</option>
															) : (
																dbCategories.map((category) => (
																	<option key={category.id || category.name} value={category.name}>{category.name}</option>
																))
															)}
														</select>
													</label>

													{builderSizeCount > 0 ? (
														<div className="mb-field">
															<span className="mb-label">Selling price</span>
															<div className="mb-price-note">
																<span>Set per size ({countLabel(builderSizeCount, "size")})</span>
																<button type="button" className="mb-link" onClick={() => setBuilderChapter("sizes")}>Change in Sizes</button>
															</div>
														</div>
													) : (
														<label className="mb-field">
															<span className="mb-label">Selling price</span>
															<span className="mb-money">
																<i aria-hidden="true">₱</i>
																<input
																	type="number"
																	value={formValues.price}
																	onChange={(event) => updateBasePrice(event.target.value)}
																	inputMode="decimal"
																	placeholder="0.00"
																	min="0"
																	required
																/>
															</span>
														</label>
													)}

													<label className="mb-field is-wide">
														<span className="mb-label">Description</span>
														<textarea
															value={formValues.description}
															onChange={(event) => setFormValues({ ...formValues, description: event.target.value })}
															placeholder="A short line customers will read, e.g. Creamy milk tea with brown sugar pearls."
															rows={3}
															required
														/>
													</label>

													<div className="mb-field is-wide mb-switch-row">
														<div>
															<span className="mb-label" id="mb-available-label">Show on the menu</span>
															<small>Turn off to hide this item from customers without deleting it.</small>
														</div>
														<button
															type="button"
															className={`mb-switch${formValues.available ? " is-on" : ""}`}
															role="switch"
															aria-checked={formValues.available}
															aria-labelledby="mb-available-label"
															onClick={() => setFormValues((prev) => ({ ...prev, available: !prev.available }))}
														>
															<span aria-hidden="true" />
														</button>
													</div>

													<details className="mb-more is-wide" open={Boolean(formValues.costPrice)}>
														<summary>More options</summary>
														<label className="mb-field">
															<span className="mb-label">Cost to make <em>optional</em></span>
															<span className="mb-money">
																<i aria-hidden="true">₱</i>
																<input
																	type="number"
																	value={formValues.costPrice ?? ""}
																	onChange={(event) => setFormValues((prev) => ({ ...prev, costPrice: event.target.value }))}
																	inputMode="decimal"
																	step="0.01"
																	placeholder="0.00"
																	min="0"
																/>
															</span>
															<small>Only needed if you do not add ingredients, for example a bottled drink you buy ready-made.</small>
														</label>
													</details>
												</div>
											</div>

											{builderIsDrink && cupInventoryItems.length === 0 && (
												<p className="mb-alert is-bad" role="alert">
													<AlertTriangle size={16} aria-hidden="true" />
													<span>Drinks need a cup for each size, and there are no cups in Inventory yet. <a href="/admin/inventory">Add a cup in Inventory</a> (category Cups &amp; Lids) before saving.</span>
												</p>
											)}
										</section>
									)}

									{/* ---------------- Step 2: Sizes ---------------- */}
									{builderChapter === "sizes" && (
										<section className="mb-panel" aria-labelledby="mb-sizes-title">
											<header className="mb-panel-head">
												<h4 id="mb-sizes-title">Sizes <em>optional</em></h4>
												<p>
													{formValues.sizes.length
														? "Give each size its own price."
														: `No sizes yet, so this item sells at one price: ₱${safeToFixed(formValues.price, 2)}. Add sizes only if customers can choose one.`}
												</p>
											</header>

											<div className="mb-toolbar">
												<span className="mb-label">Quick fill</span>
												<button
													type="button"
													className="mb-btn is-small"
													onClick={() => handleApplyVariationPreset([
														{ label: "Small", factor: 1.0 },
														{ label: "Medium", factor: 1.25 },
														{ label: "Large", factor: 1.5 },
													])}
												>
													Small, Medium, Large
												</button>
												{builderFamily === "drink" && (
													<button
														type="button"
														className="mb-btn is-small"
														onClick={() => handleApplyVariationPreset([
															{ label: "8oz", factor: 1.0 },
															{ label: "12oz", factor: 1.25 },
															{ label: "16oz", factor: 1.5 },
														])}
													>
														8oz, 12oz, 16oz
													</button>
												)}
												{builderFamily === "drink" && cupInventoryItems.length > 0 && (
													<button type="button" className="mb-btn is-small" onClick={handleAutoSetFromCups}>
														One size per cup ({cupInventoryItems.length})
													</button>
												)}
												{builderFamily === "fries" && (
													<button type="button" className="mb-btn is-small" onClick={() => handleApplyVariationPreset(VARIATION_PRESETS.fries)}>
														Regular, Large, Jumbo
													</button>
												)}
												{builderFamily === "snack_pieces" && (
													<button type="button" className="mb-btn is-small" onClick={() => handleApplyVariationPreset(VARIATION_PRESETS.snack_pieces)}>
														4, 6 and 12 pieces
													</button>
												)}
												<span className="mb-toolbar-spacer" />
												{formValues.sizes.length > 0 && (
													<button type="button" className="mb-btn is-small is-danger" onClick={handleClearVariations}>
														Remove all sizes
													</button>
												)}
												<button type="button" className="mb-btn is-small is-primary" onClick={addVariation}>
													<Plus size={14} strokeWidth={2.4} aria-hidden="true" /> Add size
												</button>
											</div>

											{builderIsDrink && cupInventoryItems.length === 0 && (
												<p className="mb-alert is-bad" role="alert">
													<AlertTriangle size={16} aria-hidden="true" />
													<span>Drinks need a cup for each size. <a href="/admin/inventory">Add a cup in Inventory</a> (category Cups &amp; Lids) first.</span>
												</p>
											)}

											{builderIsDrink && cupInventoryItems.length > 0 && (
												<div className="mb-cups">
													<span className="mb-label">Your cups in Inventory: click one to add it as a size</span>
													<div className="mb-cup-list">
														{cupInventoryItems.map((cup) => {
															const cupName = safeItemName(cup);
															const label = cupName.replace(/\s*cup\s*/i, "").trim() || cupName;
															const isAdded = formValues.sizes.some((s) => safeLower(s?.label) === safeLower(label) || s.cupId === cup.id);
															return (
																<button
																	key={cup.id}
																	type="button"
																	className={`mb-cup${isAdded ? " is-added" : ""}`}
																	onClick={() => addSingleCupVariation(cup)}
																	title={isAdded ? `${label} is already a size` : `Add ${label} as a size`}
																>
																	{isAdded ? <Check size={14} strokeWidth={2.4} aria-hidden="true" /> : <Plus size={14} strokeWidth={2.4} aria-hidden="true" />}
																	<span>{cupName}</span>
																	<small>{Number(cup.quantity)} in stock</small>
																</button>
															);
														})}
													</div>
												</div>
											)}

											{formValues.sizes.length > 0 && (
												<div className="mb-table-wrap">
													<table className="mb-table">
														<thead>
															<tr>
																<th>Size name</th>
																<th>Price</th>
																{builderIsDrink && <th>Cup</th>}
																<th title="How big this size is compared with the first one. 1 is the same, 1.5 is half again as much.">Portion ×</th>
																<th><span className="sr-only">Remove</span></th>
															</tr>
														</thead>
														<tbody>
															{formValues.sizes.map((size, index) => (
																<tr key={index}>
																	<td>
																		<input
																			type="text"
																			value={size?.label || ""}
																			placeholder="e.g. Large"
																			onChange={(e) => updateSizeLabel(index, e.target.value)}
																			aria-label={`Size ${index + 1} name`}
																			autoFocus={editingSizeIndex === index}
																		/>
																	</td>
																	<td>
																		<span className="mb-money">
																			<i aria-hidden="true">₱</i>
																			<input
																				type="number"
																				min="0"
																				step="0.01"
																				value={size?.price ?? ""}
																				placeholder={formValues.price || "0.00"}
																				onChange={(e) => updateSizePrice(index, e.target.value)}
																				aria-label={`${size?.label || "Size"} price`}
																			/>
																		</span>
																	</td>
																	{builderIsDrink && (
																		<td>
																			<select
																				value={size?.cupId || ""}
																				onChange={(e) => assignCupToSize(index, e.target.value)}
																				aria-label={`Cup for ${size?.label || "this size"}`}
																				className={size?.cupId ? "" : "is-missing"}
																			>
																				<option value="">Choose a cup</option>
																				{(cupInventoryItems || []).map((cup) => (
																					<option key={cup.id} value={cup.id}>
																						{safeItemName(cup)} ({cup.quantity} {cup.unit})
																					</option>
																				))}
																			</select>
																		</td>
																	)}
																	<td>
																		<input
																			type="number"
																			min="0.1"
																			max="10"
																			step="0.05"
																			className="mb-narrow"
																			value={size?.factor ?? defaultSizeFactor(size?.factor, index)}
																			onChange={(e) => updateSizeFactor(index, e.target.value)}
																			aria-label={`${size?.label || "Size"} portion compared with the first size`}
																		/>
																	</td>
																	<td className="mb-cell-end">
																		<button type="button" className="mb-icon-btn" onClick={() => removeSize(index)} aria-label={`Remove ${size?.label || "size"}`} title="Remove size">
																			<X size={16} strokeWidth={2.2} aria-hidden="true" />
																		</button>
																	</td>
																</tr>
															))}
														</tbody>
													</table>
												</div>
											)}

											{formValues.sizes.length > 0 && (
												<p className="mb-help">Portion × sets how much bigger a size is than the first one. It fills in ingredient amounts for you on the next step, and you can still change them there.</p>
											)}
										</section>
									)}

									{/* ---------------- Step 3: Ingredients ---------------- */}
									{builderChapter === "recipe" && (
										<section className="mb-panel" aria-labelledby="mb-recipe-title">
											<header className="mb-panel-head">
												<h4 id="mb-recipe-title">Ingredients <em>optional</em></h4>
												<p>What one serving uses. Stock goes down by these amounts each time this item is sold, and they work out the cost to make.</p>
											</header>

											<div className="mb-toolbar">
												<button type="button" className="mb-btn is-primary" onClick={openInventoryPicker}>
													<Plus size={14} strokeWidth={2.4} aria-hidden="true" /> Choose from Inventory
												</button>
												<a href="/admin/inventory" target="_blank" rel="noopener noreferrer" className="mb-btn">
													<ExternalLink size={14} strokeWidth={2} aria-hidden="true" /> Add a new item in Inventory
												</a>
											</div>

											{formValues.ingredients.length === 0 ? (
												<div className="mb-empty">
													<Beaker size={26} strokeWidth={1.6} aria-hidden="true" />
													<strong>No ingredients yet</strong>
													<p>Choose the ingredients this item uses so stock and cost are tracked. You can skip this for items without a recipe.</p>
												</div>
											) : (
												<div className="mb-table-wrap">
													<table className="mb-table">
														<thead>
															<tr>
																<th>Ingredient</th>
																<th>Unit</th>
																{formValues.sizes.length > 0
																	? formValues.sizes.map((s, i) => <th key={`${s.label}-${i}`} className="mb-num">{s.label || `Size ${i + 1}`}</th>)
																	: <th className="mb-num">Per serving</th>}
																<th><span className="sr-only">Remove</span></th>
															</tr>
														</thead>
														<tbody>
															{formValues.ingredients.map((ingredient, index) => {
																const inventoryItem = findInventoryItem(ingredient.name, ingredient.inventoryItemId);
																const ingredientName = safeItemName(inventoryItem) || ingredient.name || "Item";
																const stockAvailable = inventoryItem ? `${inventoryItem.quantity} ${inventoryItem.unit}` : "not in Inventory";
																const isZero = formValues.sizes.length
																	? formValues.sizes.every((size) => sizeQty(ingredient, size.label) === 0)
																	: sizeQty(ingredient) === 0;
																return (
																	<tr key={`${ingredientName}-${index}`} className={isZero ? "is-warn" : ""}>
																		<td>
																			<strong>{ingredientName}</strong>
																			<small>In stock: {stockAvailable}</small>
																			{isZero && <small className="mb-warn-text">Amount is 0, so nothing is used</small>}
																		</td>
																		<td>
																			<UnitSelect
																				value={ingredient.unit || "pcs"}
																				compatibleWith={inventoryItem?.unit || ingredient.stockUnit || "pcs"}
																				onChange={(unit) => updateRecipeUnit(index, unit)}
																				ariaLabel={`${ingredientName} unit`}
																			/>
																		</td>
																		{formValues.sizes.length > 0 ? (
																			formValues.sizes.map((size, sizeIndex) => (
																				<td key={`${size.label}-${sizeIndex}`} className="mb-num">
																					<input
																						type="number"
																						min="0"
																						step="0.000001"
																						className="mb-narrow"
																						value={readSizeQtyValue(ingredient.quantityBySize, size.label) ?? ingredient.quantityUsed ?? ""}
																						onChange={(event) => updateSizeRecipeQuantity(index, size.label, event.target.value)}
																						placeholder="0"
																						aria-label={`${ingredientName} amount for ${size.label}`}
																					/>
																				</td>
																			))
																		) : (
																			<td className="mb-num">
																				<input
																					type="number"
																					min="0"
																					step="0.000001"
																					className="mb-narrow"
																					value={ingredient.quantityUsed ?? ""}
																					onChange={(event) => updateIngredientQuantityUsed(index, event.target.value)}
																					placeholder="e.g. 1"
																					aria-label={`${ingredientName} amount per serving`}
																				/>
																			</td>
																		)}
																		<td className="mb-cell-end">
																			<button type="button" className="mb-icon-btn" onClick={() => removeIngredient(index)} aria-label={`Remove ${ingredientName}`} title={`Remove ${ingredientName}`}>
																				<X size={16} strokeWidth={2.2} aria-hidden="true" />
																			</button>
																		</td>
																	</tr>
																);
															})}
														</tbody>
													</table>
												</div>
											)}

											<div className="mb-costs">
												<div className="mb-costs-head">
													<h5>Cost and profit</h5>
													<div className="mb-goal" role="group" aria-labelledby="mb-goal-label" title="Suggested prices aim for the cost to make to be this share of the price. Your store setting is in Settings.">
														<span id="mb-goal-label">Suggest prices for a cost of</span>
														{targetCostOptions.map((pct) => {
															const isSelected = targetFoodCostPct === pct;
															const isStoreDefault = pct === configuredFoodCostPct;
															return (
																<button
																	key={pct}
																	type="button"
																	className={`mb-chip${isSelected ? " is-on" : ""}`}
																	aria-pressed={isSelected}
																	aria-label={isStoreDefault ? `${pct}%, your store setting` : `${pct}%`}
																	onClick={() => setTargetFoodCostOverride(pct === configuredFoodCostPct ? null : pct)}
																>
																	{pct}%{isStoreDefault ? " (yours)" : ""}
																</button>
															);
														})}
														<span>of the price</span>
												{isPreviewOverridden && (
													<button type="button" className="mb-link" onClick={() => setTargetFoodCostOverride(null)}>
														Back to your setting ({configuredFoodCostPct}%)
													</button>
												)}
													</div>
												</div>

												{(formValues.ingredients || []).length === 0 && !(Number(formValues.costPrice) > 0) ? (
													<p className="mb-help">Add ingredients above, or enter a cost to make in Basics, to see cost and profit here.</p>
												) : (
													<div className="mb-table-wrap">
														<table className="mb-table is-costs">
															<thead>
																<tr>
																	<th>Size</th>
																	<th className="mb-num">Price</th>
																	<th className="mb-num">Cost to make</th>
																	<th className="mb-num">Profit</th>
																	<th className="mb-num">Suggested price</th>
																</tr>
															</thead>
															<tbody>
																{(builderSizeCount
														? formValues.sizes.map((size, index) => ({ key: `size-${index}`, index, label: size?.label || `Size ${index + 1}`, price: size?.price !== "" && size?.price != null ? size.price : formValues.price, costing: sizeCostingsByIndex[index] }))
														: [{ key: "single", index: -1, label: "One price", price: formValues.price, costing: singleItemCosting }]
													).map((row) => (
																	<tr key={row.key}>
																		<td>
																			<strong>{row.label}</strong>
																			{row.costing?.usedCount === 0 && (formValues.ingredients || []).length > 0 && <small className="mb-warn-text">All amounts are 0 for this size</small>}
																			{row.costing && !row.costing.costComplete && <small className="mb-warn-text">Estimate: some ingredients have no cost in Inventory</small>}
																		</td>
																		<td className="mb-num">₱{safeToFixed(row.price, 2)}</td>
																		<td className="mb-num">₱{safeToFixed(row.costing?.cost, 2)}</td>
																		<td className="mb-num">
																			<span className={`mb-profit is-${profitTone(row.costing?.margin)}`}>
																				{row.costing?.grossProfit != null && Number.isFinite(row.costing.grossProfit) ? `₱${safeToFixed(row.costing.grossProfit, 2)}` : "—"}
																				{row.costing?.margin != null && Number.isFinite(row.costing.margin) ? ` (${safeToFixed(row.costing.margin, 0)}%)` : ""}
																			</span>
																		</td>
																		<td className="mb-num">
																			{row.costing?.suggestedPrice != null ? (
																				<span className="mb-suggest">
																					₱{row.costing.suggestedPrice}
																					<button type="button" className="mb-btn is-small" onClick={() => (row.index < 0 ? applySuggestedBasePrice(row.costing?.suggestedPrice) : applySuggestedSizePrice(row.index, row.costing?.suggestedPrice))} aria-label={`Use ₱${row.costing.suggestedPrice} for ${row.label}`}>
																						Use
																					</button>
																				</span>
																			) : "—"}
																		</td>
																	</tr>
																))}
															</tbody>
														</table>
													</div>
												)}
											</div>
										</section>
									)}

									{/* ---------------- Step 4: Add-ons ---------------- */}
									{builderChapter === "addons" && (
										<section className="mb-panel" aria-labelledby="mb-addons-title">
											<header className="mb-panel-head">
												<h4 id="mb-addons-title">Add-ons <em>optional</em></h4>
												<p>Extras customers can pay for, like extra cheese or an extra shot. Each add-on uses stock from Inventory.</p>
											</header>

											{(() => {
												const matchedAddonDraft = findInventoryItem(addonDraft.label);
												const draftStockUnit = matchedAddonDraft?.unit || addonDraft.stockUnit;
												const convertedAddonQty = convertRecipeAmount(addonDraft.quantityUsed, addonDraft.unit, draftStockUnit);
												return (
													<div className="mb-addon-form">
														<div className="mb-addon-fields">
															<label className="mb-field">
																<span className="mb-label">Add-on name</span>
																<input
																	list="menu-inventory-items"
																	value={addonDraft.label}
																	onChange={(event) => {
																		const label = event.target.value;
																		const existing = findInventoryItem(label);
																		setAddonDraft((current) => ({ ...current, label, stockUnit: existing?.unit || current.stockUnit, unit: existing?.unit || current.unit }));
																		setRecipeError("");
																	}}
																	placeholder="Type or pick from Inventory"
																/>
																<datalist id="menu-inventory-items">
																	{(inventory || []).filter((entry) => entry && !entry.isArchived).map((entry) => {
																		const itemName = safeItemName(entry);
																		return itemName ? <option key={entry.id || itemName} value={itemName} /> : null;
																	})}
																</datalist>
															</label>
															<label className="mb-field">
																<span className="mb-label">Price</span>
																<span className="mb-money">
																	<i aria-hidden="true">₱</i>
																	<input type="number" min="0" step="0.01" value={addonDraft.price} onChange={(event) => setAddonDraft((current) => ({ ...current, price: event.target.value }))} placeholder="0.00" />
																</span>
															</label>
															<label className="mb-field">
																<span className="mb-label">Amount used</span>
																<span className="mb-amount">
																	<input type="number" min="0.000001" step="0.000001" value={addonDraft.quantityUsed} onChange={(event) => setAddonDraft((current) => ({ ...current, quantityUsed: event.target.value }))} placeholder="e.g. 5" />
																	<i>{addonDraft.unit || "pcs"}</i>
																</span>
															</label>
															<button type="button" className="mb-btn is-primary mb-addon-add" onClick={addAddon} disabled={!addonDraft.label.trim() || addonDraft.price === "" || !addonDraft.quantityUsed}>
																<Plus size={14} strokeWidth={2.4} aria-hidden="true" /> Add
															</button>
														</div>

														<details className="mb-more">
															<summary>Units</summary>
															<div className="mb-addon-units">
																<label className="mb-field">
																	<span className="mb-label">Amount is measured in</span>
																	<UnitSelect value={addonDraft.unit} compatibleWith={draftStockUnit} onChange={(unit) => setAddonDraft((current) => ({ ...current, unit }))} ariaLabel="Add-on amount unit" />
																</label>
																<label className="mb-field">
																	<span className="mb-label">Inventory counts it in</span>
																	<UnitSelect value={draftStockUnit} disabled={Boolean(matchedAddonDraft)} onChange={(stockUnit) => setAddonDraft((current) => ({ ...current, stockUnit, unit: current.unit === current.stockUnit ? stockUnit : current.unit }))} ariaLabel="Add-on inventory unit" />
																</label>
															</div>
															<p className="mb-help">Units in the same group convert by themselves, for example grams and kilograms. Weight and volume cannot be mixed.</p>
														</details>

														{convertedAddonQty != null && addonDraft.label.trim() && (
															<p className="mb-help">Uses {convertedAddonQty.toLocaleString(undefined, { maximumFractionDigits: 6 })} {draftStockUnit} from Inventory each time.</p>
														)}
														{matchedAddonDraft && amountAttachedToUnit(matchedAddonDraft.unit) && (
															<p className="mb-alert is-bad" role="alert">
																<AlertTriangle size={16} aria-hidden="true" />
																<span>This Inventory item has a number inside its unit. Edit it in Inventory so the amount and unit are separate (for example 5 and kg).</span>
															</p>
														)}
													</div>
												);
											})()}

											{formValues.addons.length ? (
												<div className="mb-table-wrap">
													<table className="mb-table">
														<thead>
															<tr>
																<th>Add-on</th>
																<th>Price</th>
																<th>Amount used</th>
																<th>Unit</th>
																<th className="mb-num">Profit</th>
																<th><span className="sr-only">Remove</span></th>
															</tr>
														</thead>
														<tbody>
															{formValues.addons.map((addon, index) => {
																const addonInv = findInventoryItem(addon.label, addon.inventoryItemId);
																const addonStockUnit = addonInv?.unit || addon.stockUnit || "pcs";
																const addonUnitCost = Number(addonInv?.unitCost ?? addonInv?.unit_cost ?? addon.unitCost ?? 0);
																const addonStockQty = convertRecipeAmount(addon.quantityUsed, addon.unit || addonStockUnit, addonStockUnit);
																const addonCost = addonStockQty && addonUnitCost > 0 ? Number((addonStockQty * addonUnitCost).toFixed(2)) : 0;
																const addonPriceNum = Number(addon.price || 0);
																const addonMargin = addonPriceNum > 0 ? Number((((addonPriceNum - addonCost) / addonPriceNum) * 100).toFixed(1)) : null;
																return (
																	<tr key={`${addon.label}-${index}`}>
																		<td>
																			<strong>{addon.label}</strong>
																			<small>In stock: {addonInv?.quantity ?? 0} {addonStockUnit}</small>
																		</td>
																		<td>
																			<span className="mb-money">
																				<i aria-hidden="true">₱</i>
																				<input type="number" min="0" step="0.01" value={addon.price} onChange={(event) => updateAddon(index, "price", event.target.value)} aria-label={`${addon.label} price`} />
																			</span>
																		</td>
																		<td>
																			<input type="number" min="0.000001" step="0.000001" className="mb-narrow" value={addon.quantityUsed} onChange={(event) => updateAddon(index, "quantityUsed", event.target.value)} aria-label={`${addon.label} amount used`} />
																		</td>
																		<td>
																			<UnitSelect value={addon.unit || "pcs"} compatibleWith={addonStockUnit} onChange={(unit) => updateAddon(index, "unit", unit)} ariaLabel={`${addon.label} unit`} />
																		</td>
																		<td className="mb-num">
																			<span title={`Cost to make ₱${safeToFixed(addonCost, 2)}`}>{addonMargin != null ? `${addonMargin.toFixed(0)}%` : "—"}</span>
																		</td>
																		<td className="mb-cell-end">
																			<button type="button" className="mb-icon-btn" onClick={() => removeAddon(index)} aria-label={`Remove ${addon.label}`} title="Remove add-on">
																				<X size={16} strokeWidth={2.2} aria-hidden="true" />
																			</button>
																		</td>
																	</tr>
																);
															})}
														</tbody>
													</table>
												</div>
											) : (
												<p className="mb-help">No add-ons yet.</p>
											)}

											<p className="mb-help">A new add-on name is added to Inventory with zero stock. Restock it in Inventory before selling.</p>
										</section>
									)}

									{/* ---------------- Step 5: Review ---------------- */}
									{builderChapter === "review" && (
										<section className="mb-panel" aria-labelledby="mb-review-title">
											<header className="mb-panel-head">
												<h4 id="mb-review-title">Review</h4>
												<p>Check the list, then {editingProduct ? "save your changes" : "add the item"}.</p>
											</header>

											<ul className="mb-checklist">
												{builderChecklist.map((item) => (
													<li key={item.key} className={`is-${item.state}`}>
														<span className="mb-check-icon" aria-hidden="true">
															{item.state === "ok" ? <Check size={14} strokeWidth={2.6} /> : item.state === "bad" ? <X size={14} strokeWidth={2.6} /> : <span>–</span>}
														</span>
														<div>
															<strong>{item.title}</strong>
															<small>{item.text}</small>
														</div>
														<button type="button" className="mb-btn is-small" onClick={() => setBuilderChapter(item.step)}>
															{item.state === "bad" ? "Fix" : "Edit"}
														</button>
													</li>
												))}
											</ul>
										</section>
									)}
								</div>

								{/* Live receipt: how the item will look at the counter */}
								<aside className="mb-receipt" aria-label="Item summary">
									<div className="mb-receipt-paper">
										<div className="mb-receipt-photo">
											{formValues.image ? <img src={formValues.image} alt="" /> : <ImagePlus size={22} strokeWidth={1.6} aria-hidden="true" />}
										</div>
										<strong className="mb-receipt-name">{String(formValues.name || "").trim() || "New item"}</strong>
										<span className="mb-receipt-meta">{formValues.category || "No category"} · {formValues.available ? "On the menu" : "Hidden"}</span>

										<div className="mb-receipt-rule" aria-hidden="true" />
										<dl className="mb-receipt-lines">
											{formValues.sizes.length ? formValues.sizes.map((size, i) => (
												<div key={`${size.label}-${i}`}>
													<dt>{size.label || `Size ${i + 1}`}</dt>
													<dd>₱{safeToFixed(size?.price !== "" && size?.price != null ? size.price : formValues.price, 2)}</dd>
												</div>
											)) : (
												<div>
													<dt>Price</dt>
													<dd>₱{safeToFixed(formValues.price, 2)}</dd>
												</div>
											)}
										</dl>

										<div className="mb-receipt-rule" aria-hidden="true" />
										<dl className="mb-receipt-lines is-muted">
											<div><dt>Cost to make</dt><dd>{(formValues.ingredients || []).length > 0 || Number(formValues.costPrice) > 0 ? `₱${safeToFixed((builderSizeCount ? sizeCostingsByIndex[0] : singleItemCosting)?.cost, 2)}` : "—"}</dd></div>
											<div><dt>Add-ons</dt><dd>{(formValues.addons || []).length}</dd></div>
											<div><dt>Servings in stock</dt><dd>{formValues.stock !== "" && formValues.stock != null ? String(formValues.stock) : "0"}</dd></div>
										</dl>
										{(formValues.ingredients || []).length > 0 && (
											<>
												<div className="mb-receipt-rule" aria-hidden="true" />
												<span className="mb-receipt-sub">Each serving uses</span>
												<dl className="mb-receipt-lines is-muted">
													{formValues.ingredients.map((ingredient, index) => {
														const ingredientName = safeItemName(findInventoryItem(ingredient.name, ingredient.inventoryItemId)) || ingredient.name || "Item";
														return (
															<div key={`${ingredientName}-${index}`}>
																<dt title={ingredientName}>{ingredientName}</dt>
																<dd>{formatRecipeBaseQtyBadge(ingredient, formValues.sizes)}</dd>
															</div>
														);
													})}
												</dl>
											</>
										)}
										{formValues.sizes.length > 0 && <small className="mb-receipt-note">Cost shown for {formValues.sizes[0]?.label || "the first size"}</small>}
									</div>
								</aside>
							</div>

							<footer className="mb-foot">
								{recipeError ? (
									<p className="mb-foot-error" role="alert"><AlertTriangle size={16} aria-hidden="true" /> <span>{recipeError}</span></p>
								) : (
									<p className="mb-foot-hint">Step {builderStepIndex + 1} of {BUILDER_STEPS.length}</p>
								)}
								<div className="mb-foot-actions">
									<button type="button" className="mb-btn" onClick={closeForm} disabled={isSaving}>Cancel</button>
									{builderStepIndex > 0 && (
										<button type="button" className="mb-btn" onClick={() => setBuilderChapter(BUILDER_STEPS[builderStepIndex - 1].key)} disabled={isSaving}>
											<ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" /> Back
										</button>
									)}
									{builderChapter !== "review" && editingProduct && (
										<button type="submit" className="mb-btn" disabled={categoriesLoading || isSaving}>
											{isSaving ? "Saving…" : "Save now"}
										</button>
									)}
									{builderChapter !== "review" ? (
										<button type="button" className="mb-btn is-primary" onClick={() => setBuilderChapter(BUILDER_STEPS[builderStepIndex + 1].key)}>
											Next: {BUILDER_STEPS[builderStepIndex + 1].label} <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />
										</button>
									) : (
										<button type="submit" className="mb-btn is-primary" disabled={categoriesLoading || isSaving}>
											{isSaving ? "Saving…" : categoriesLoading ? "Loading…" : editingProduct ? "Save changes" : "Add item"}
										</button>
									)}
								</div>
							</footer>
						</form>
					</div>

				{/* Multi-Select Inventory Picker Modal */}
				<InventoryRecipePickerModal
					isOpen={showInventoryPicker}
					inventory={inventory}
					pickerSearch={pickerSearch}
					setPickerSearch={setPickerSearch}
					pickerCategory={pickerCategory}
					setPickerCategory={setPickerCategory}
					selectedInventoryItemIds={selectedInventoryItemIds}
					togglePickerItem={togglePickerItem}
					applyInventoryPicker={applyInventoryPicker}
					onClose={() => setShowInventoryPicker(false)}
				/>
				</ErrorBoundary>
			)}

			{syncNotice && (
				<div className="menu-sync-notice" role="status" aria-live="polite">
					<Beaker aria-hidden="true" size={15} strokeWidth={2.2} />
					<span>{syncNotice}</span>
					<button type="button" onClick={() => setSyncNotice("")} aria-label="Dismiss notification">×</button>
				</div>
			)}
		</div>
	);
}

export default AdminMenuManagement;
