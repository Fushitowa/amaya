import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import Sidebar from "../../components/Sidebar.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import ErrorBoundary from "../../components/ErrorBoundary.jsx";
import { AlertTriangle, Archive, Beaker, Check, CheckCircle2, ChevronRight, ClipboardList, Clock, Coffee, ExternalLink, FolderOpen, ImagePlus, List, Package, Plus, Sparkles, Trash2, Utensils } from "lucide-react";
import adminAvatar from "../../assets/images/icon/admin1.svg";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import { useInventory } from "../../context/InventoryContext.jsx";
import { apiRequest } from "../../utils/api.js";

import "../../assets/css/admin/AdminMenuManagement.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";


const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MENU_PAGE_SIZE = 16;
const supportedUnits = [
	{ group: "Weight", units: [["mg", "Milligrams (mg)"], ["g", "Grams (g)"], ["hg", "Hectograms (hg)"], ["kg", "Kilograms (kg)"], ["oz", "Ounces (oz)"], ["lb", "Pounds (lb)"]] },
	{ group: "Volume", units: [["ml", "Milliliters (ml)"], ["cl", "Centiliters (cl)"], ["dl", "Deciliters (dl)"], ["L", "Liters (L)"], ["tsp", "Teaspoons (tsp)"], ["tbsp", "Tablespoons (tbsp)"], ["fl oz", "Fluid ounces (fl oz)"], ["cup", "Cups"], ["pt", "Pints (pt)"], ["qt", "Quarts (qt)"], ["gal", "Gallons (gal)"], ["cc", "Cubic centimeters (cc)"]] },
	{ group: "Count", units: [["pcs", "Pieces (pcs)"], ["pair", "Pairs"], ["dozen", "Dozen"]] },
];
const unitFactors = new Map();
const registerUnit = (dimension, factorToBase, units) => units.forEach((unit) => unitFactors.set(unit.toLowerCase(), { dimension, factorToBase }));
registerUnit("mass", 0.000001, ["µg", "μg", "ug", "mcg", "microgram", "micrograms"]);
registerUnit("mass", 0.001, ["mg", "milligram", "milligrams"]);
registerUnit("mass", 1, ["g", "gram", "grams"]);
registerUnit("mass", 100, ["hg", "hectogram", "hectograms"]);
registerUnit("mass", 1000, ["kg", "kilogram", "kilograms"]);
registerUnit("mass", 1000000, ["t", "tonne", "tonnes", "metric ton", "metric tons"]);
registerUnit("mass", 28.349523125, ["oz", "ounce", "ounces"]);
registerUnit("mass", 453.59237, ["lb", "lbs", "pound", "pounds"]);
registerUnit("volume", 1, ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "cc", "cm3", "cm³"]);
registerUnit("volume", 10, ["cl", "centiliter", "centiliters", "centilitre", "centilitres"]);
registerUnit("volume", 100, ["dl", "deciliter", "deciliters", "decilitre", "decilitres"]);
registerUnit("volume", 1000, ["l", "liter", "liters", "litre", "litres"]);
registerUnit("volume", 4.92892159375, ["tsp", "teaspoon", "teaspoons"]);
registerUnit("volume", 14.78676478125, ["tbsp", "tablespoon", "tablespoons"]);
registerUnit("volume", 236.5882365, ["cup", "cups"]);
registerUnit("volume", 29.5735295625, ["fl oz", "fluid ounce", "fluid ounces"]);
registerUnit("volume", 473.176473, ["pt", "pint", "pints"]);
registerUnit("volume", 946.352946, ["qt", "quart", "quarts"]);
registerUnit("volume", 3785.411784, ["gal", "gallon", "gallons"]);
registerUnit("count", 1, ["pc", "pcs", "piece", "pieces", "ea", "each", "unit", "units"]);
registerUnit("count", 2, ["pair", "pairs"]);
registerUnit("count", 12, ["dozen", "doz"]);
const safeLower = (val) => String(val || "").trim().toLowerCase();
const safeItemName = (entry) => String(entry?.item ?? entry?.name ?? "").trim();
const getInvItemName = safeItemName;
const safeToFixed = (val, fractionDigits = 2, fallback = "0.00") => {
	const num = Number(val);
	return Number.isFinite(num) ? num.toFixed(fractionDigits) : fallback;
};

const findInventoryItemInList = (inventoryList, query, id = null) => {
	if (!Array.isArray(inventoryList)) return undefined;
	const numericId = id != null && !Number.isNaN(Number(id)) ? Number(id) : null;
	const clean = safeLower(query);
	return inventoryList.find((entry) => {
		if (!entry) return false;
		if (numericId !== null && Number(entry.id) === numericId) return true;
		if (!clean) return false;
		return safeLower(safeItemName(entry)) === clean;
	});
};

const convertRecipeAmount = (amount, recipeUnit, stockUnit) => {
	const sourceName = safeLower(recipeUnit);
	const targetName = safeLower(stockUnit);
	const quantity = Number(amount);
	const source = unitFactors.get(sourceName);
	const target = unitFactors.get(targetName);
	if (!Number.isFinite(quantity) || quantity <= 0) return null;
	if (!source && !target && sourceName === targetName) return quantity;
	if (!source || !target || source.dimension !== target.dimension) return null;
	const converted = Number((quantity * source.factorToBase / target.factorToBase).toFixed(6));
	return converted > 0 ? converted : null;
};
const amountAttachedToUnit = (unit) => /^\s*\d+(?:\.\d+)?\s*[a-z]/i.test(String(unit || ""));

function UnitSelect({ value, onChange, ariaLabel, disabled = false, compatibleWith }) {
	const currentUnit = String(value || "pcs");
	const knownUnits = supportedUnits.flatMap((group) => group.units.map(([unit]) => unit.toLowerCase()));
	const compatibleUnit = unitFactors.get(String(compatibleWith || "").trim().toLowerCase());
	return (
		<select value={currentUnit} onChange={(event) => onChange(event.target.value)} aria-label={ariaLabel} disabled={disabled}>
			{!knownUnits.includes(currentUnit.toLowerCase()) && <option value={currentUnit}>{currentUnit} (current unit)</option>}
			{supportedUnits.map((group) => (
				<optgroup key={group.group} label={group.group}>
				{group.units.map(([unit, label]) => {
					const definition = unitFactors.get(unit.toLowerCase());
					return <option key={unit} value={unit} disabled={Boolean(compatibleUnit && definition?.dimension !== compatibleUnit.dimension)}>{label}</option>;
				})}
				</optgroup>
			))}
		</select>
	);
}

function separateAmountHint(amount, unit, stockUnit, itemName) {
	const amountMatch = String(amount || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
	if (amountMatch) return `For “${itemName}”, enter only ${amountMatch[1]} in Amount per serving and “${amountMatch[2]}” in Recipe unit.`;
	const match = String(unit || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
	if (match) return `For “${itemName}”, put ${match[1]} in Amount per serving and “${match[2]}” in Recipe unit. Keep the amount and unit in separate fields.`;
	const stockMatch = String(stockUnit || "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-z].*)$/i);
	if (stockMatch) return `The inventory unit for “${itemName}” is “${stockUnit}”. Edit that inventory item: put ${stockMatch[1]} in its stock quantity and “${stockMatch[2]}” in its unit. Then try again.`;
	return "";
}

const STANDARD_SIZES = [
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


const defaultSizeFactor = (factor, index = 0) => (Number.isFinite(Number(factor)) && Number(factor) > 0 ? Number(factor) : (index === 0 ? 1.0 : Number((1.0 + index * 0.25).toFixed(2))));


const scaleIngredientAmount = (baseQty, factor, unit) => {
	const numQty = Number(baseQty);
	if (!Number.isFinite(numQty) || numQty <= 0) return "";
	const unitDef = unitFactors.get(safeLower(unit));
	if (unitDef?.dimension === "count" || ["pcs", "pc", "piece", "pieces", "ea", "each", "unit", "units", "cup", "cups"].includes(safeLower(unit))) {
		return String(numQty);
	}
	const scaled = Number((numQty * factor).toFixed(2));
	return String(scaled);
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

function AdminMenuManagement() {
	const { products = [], menuError, addProduct, updateProduct, deleteProduct } = useMenu() || {};
	const { inventory = [], refreshInventory } = useInventory() || {};
	const cupInventoryItems = useMemo(() => {
		return (inventory || [])
			.filter((item) => item && (item.isCupCategory || item.is_cup_category || item.category === "Cups" || item.category === "Cups & Lids") && !item.isArchived)
			.sort((a, b) => {
				const nameA = getInvItemName(a);
				const nameB = getInvItemName(b);
				const ozA = Number(nameA.match(/(\d+(?:\.\d+)?)\s*oz/i)?.[1] || 999);
				const ozB = Number(nameB.match(/(\d+(?:\.\d+)?)\s*oz/i)?.[1] || 999);
				return ozA - ozB || nameA.localeCompare(nameB);
			});
	}, [inventory]);
	const { sidebarCollapsed, toggleSidebar } = useSidebar();
	const [categories, setCategories] = useState(["All items"]);
	const [dbCategories, setDbCategories] = useState([]);
	const [categoriesLoading, setCategoriesLoading] = useState(true);
	const [activeCategory, setActiveCategory] = useState("All items");
	const [search, setSearch] = useState("");
	const [sortBy, setSortBy] = useState("popular");
	const [currentPage, setCurrentPage] = useState(1);
	const [showForm, setShowForm] = useState(false);
	const [editingProduct, setEditingProduct] = useState(null);
	const [itemToDelete, setItemToDelete] = useState(null);
	const emptyForm = () => ({ name: "", price: "", stock: "", description: "", category: dbCategories[0]?.name || "", image: "", sizes: [], ingredients: [], addons: [], available: true });

	const findInventoryItem = (queryOrList, maybeQuery = null, maybeId = null) => {
		if (Array.isArray(queryOrList)) {
			return findInventoryItemInList(queryOrList, maybeQuery, maybeId);
		}
		return findInventoryItemInList(inventory, queryOrList, maybeQuery);
	};

	const getCategoryFamily = (categoryName) => {
		const match = (dbCategories || []).find(
			(c) => safeLower(c?.name) === safeLower(categoryName)
		);
		return match?.operationalFamily || "general";
	};

	useEffect(() => {
		let isMounted = true;
		apiRequest("/menu/categories")
			.then((data) => {
				if (!isMounted || !Array.isArray(data)) return;
				const validCats = data.filter((cat) => cat && cat.name);
				setDbCategories(validCats);
				const categoryNames = validCats.map((cat) => cat.name);
				setCategories(["All items", ...categoryNames]);
				setCategoriesLoading(false);
				setFormValues((prev) => {
					if (!prev.category && validCats.length > 0) {
						return { ...prev, category: validCats[0].name };
					}
					return prev;
				});
			})
			.catch((err) => {
				console.warn("Failed to fetch menu categories:", err);
				if (isMounted) setCategoriesLoading(false);
			});
		return () => {
			isMounted = false;
		};
	}, []);

	const [formValues, setFormValues] = useState(emptyForm());
	const [editingSizeIndex, setEditingSizeIndex] = useState(null);
	const editingSizeRef = useRef(null);
	const [ingredientDraft, setIngredientDraft] = useState({ name: "", quantityUsed: "", unit: "pcs", stockUnit: "pcs" });
	const [addonDraft, setAddonDraft] = useState({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
	const [recipeError, setRecipeError] = useState("");
	const [syncNotice, setSyncNotice] = useState("");
	const syncTimer = useRef(null);

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
		setIngredientDraft({ name: "", quantityUsed: "", unit: "pcs", stockUnit: "pcs" });
		setRecipeError("");
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
		setImageError("");
		setShowForm(true);
	};

	const isCupIngredient = (ing) => {
		if (!ing) return false;
		const name = safeLower(ing.name || ing.item);
		const invItemId = Number(ing.inventoryItemId);
		const invItem = (inventory || []).find((entry) => (invItemId > 0 && Number(entry?.id) === invItemId) || safeLower(getInvItemName(entry)) === name);
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
			const ingName = safeLower(ing.name || ing.item);
			const invItemId = Number(ing.inventoryItemId);
			const invItem = (inventory || []).find((entry) => (invItemId > 0 && Number(entry?.id) === invItemId) || safeLower(getInvItemName(entry)) === ingName);
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
				const qMap = { ...(ing?.quantityBySize || {}) };
				qMap[nextStandard.label] = amountForSize(ing, nextStandard.label, factor);
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
					quantityBySize: {},
				});
			}

			updatedIngredients = updatedIngredients.map((ing) => {
				const isCup = Boolean(
					(numericCupId && Number(ing?.inventoryItemId) === numericCupId) ||
					isCupIngredient(ing) ||
					(chosenCup && safeLower(ing?.name) === safeLower(chosenCupName))
				);
				if (!isCup) return ing;
				const qMap = { ...(ing?.quantityBySize || {}) };
				const isThisCup = (numericCupId && Number(ing?.inventoryItemId) === numericCupId) ||
					(chosenCup && safeLower(ing?.name) === safeLower(chosenCupName));
				qMap[targetSize.label] = isThisCup ? "1" : "0";
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
				const qMap = { ...(ing?.quantityBySize || {}) };
				qMap[targetSize.label] = scaleIngredientAmount(ing?.quantityUsed, factorNum, ing?.unit);
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
			const qMap = { ...(ing?.quantityBySize || {}) };
			(presetList || []).forEach((preset, idx) => {
				const factor = defaultSizeFactor(preset?.factor, idx);
				qMap[preset?.label] = amountForSize(ing, preset?.label, factor);
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
				quantityBySize: {},
			})),
		}));
		setEditingSizeIndex(null);
	};

	const handleAutoSetStandardSizes = () => {
		handleApplyVariationPreset(STANDARD_SIZES);
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
			const qMap = {};
			newSizes.forEach((s) => {
				qMap[s.label] = scaleIngredientAmount(ing?.quantityUsed, s.factor, ing?.unit);
			});
			return { ...ing, quantityBySize: qMap };
		});

		const cupIngredients = cupsToUse.map((cup, cupIdx) => {
			const cupName = getInvItemName(cup);
			const qMap = {};
			newSizes.forEach((s, sIdx) => {
				qMap[s.label] = cupIdx === sIdx ? "1" : "0";
			});
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

				const qMap = { ...(ing?.quantityBySize || {}) };
				if (isCup) {
					qMap[label] = isThisCup ? "1" : "0";
				} else {
					qMap[label] = scaleIngredientAmount(ing?.quantityUsed, factor, ing?.unit);
				}
				return { ...ing, quantityBySize: qMap };
			});

			if (!hasThisCup) {
				const qMap = {};
				newSizes.forEach((s) => {
					qMap[s.label] = safeLower(s?.label) === safeLower(label) ? "1" : "0";
				});
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
				const qMap = { ...(ing.quantityBySize || {}) };
				if (oldLabel && oldLabel in qMap && oldLabel !== newLabel) {
					delete qMap[oldLabel];
				}
				if (newLabel) {
					qMap[newLabel] = amountForSize(ing, newLabel, factor);
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
			return {
				...current,
				sizes: current.sizes.filter((_, i) => i !== index),
				ingredients: current.ingredients.map((ingredient) => {
					const quantityBySize = { ...(ingredient.quantityBySize || {}) };
					if (removedLabel) delete quantityBySize[removedLabel];
					return { ...ingredient, quantityBySize };
				}),
			};
		});
	};

	const addRecipeIngredient = () => {
		const name = ingredientDraft.name.trim();
		const quantityUsed = Number(ingredientDraft.quantityUsed);
		const existingItem = (inventory || []).find((entry) => safeLower(safeItemName(entry)) === safeLower(name));
		if (!existingItem) {
			setRecipeError(`"${name}" is not in Inventory. Please pick an existing inventory item or click "+ Add in Inventory".`);
			return;
		}
		const stockUnit = (existingItem?.unit || ingredientDraft.stockUnit || "").trim();
		const unit = (ingredientDraft.unit || "").trim();
		const unitHint = separateAmountHint(ingredientDraft.quantityUsed, unit, stockUnit, name || "this ingredient");
		if (unitHint) {
			setRecipeError(unitHint);
			return;
		}
		if (!name || name.length > 160 || !stockUnit || stockUnit.length > 40 || !unit || unit.length > 40) {
			setRecipeError("Enter an ingredient name, stock unit, and recipe unit.");
			return;
		}
		if (!Number.isFinite(quantityUsed) || quantityUsed <= 0 || Number(quantityUsed.toFixed(6)) !== quantityUsed) {
			setRecipeError("Enter a positive amount with at most 6 decimal places.");
			return;
		}
		if (!convertRecipeAmount(quantityUsed, unit, stockUnit)) {
			setRecipeError(`“${unit}” and “${stockUnit}” cannot be converted automatically. Choose units from the same group (weight, volume, or count).`);
			return;
		}
		if ((formValues.ingredients || []).some((entry) => safeLower(entry?.name || entry?.item) === safeLower(name))) {
			setRecipeError("That ingredient is already in this recipe.");
			return;
		}
		setFormValues((current) => ({
			...current,
			ingredients: [...current.ingredients, {
				inventoryItemId: existingItem.id,
				name,
				quantityUsed,
				unit,
				stockUnit,
				quantityBySize: Object.fromEntries(
					(current.sizes || []).map((size, idx) => [
						size.label,
						amountForSize({ name, quantityUsed, unit }, size.label, defaultSizeFactor(size.factor, idx)),
					])
				),
			}],
		}));
		setIngredientDraft({ name: "", quantityUsed: "", unit: "pcs", stockUnit: "pcs" });
		setRecipeError("");
	};

	const addAddon = () => {
		const label = addonDraft.label.trim();
		const existingItem = (inventory || []).find((entry) => safeLower(safeItemName(entry)) === safeLower(label));
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
		const price = Number(addonDraft.price);
		const quantityUsed = Number(addonDraft.quantityUsed);
		if (!label || label.length > 100 || !stockUnit || stockUnit.length > 40 || !unit || unit.length > 40 || !Number.isFinite(price) || price < 0) {
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
			ingredients: current.ingredients.map((entry, entryIndex) => entryIndex === ingredientIndex
				? { ...entry, quantityBySize: { ...(entry.quantityBySize || {}), [sizeLabel]: quantityUsed } }
				: entry),
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
		if (file.size > MAX_IMAGE_BYTES) {
			setImageError("Image is larger than 5MB. Please choose a smaller file.");
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			setFormValues((current) => ({ ...current, image: reader.result }));
			setImageError("");
		};
		reader.onerror = () => setImageError("Could not read that file. Please try another.");
		reader.readAsDataURL(file);
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
		setShowForm(false);
		setEditingProduct(null);
		setEditingSizeIndex(null);
		setIngredientDraft({ name: "", quantityUsed: "", unit: "pcs", stockUnit: "pcs" });
		setRecipeError("");
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
		setImageError("");
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
		try {
			await updateProduct(id, { available: !products.find((product) => product.id === id)?.available });
		} catch (error) {
			window.alert(error.message);
		}
	};

	const handleDelete = (product) => {
		if (!product) return;
		setItemToDelete(product);
	};

	const confirmDelete = async () => {
		if (!itemToDelete) return;
		try {
			await deleteProduct(itemToDelete.id);
			setItemToDelete(null);
		} catch (error) {
			window.alert(error.message);
		}
	};

	const openEditForm = (product) => {
		if (!product) return;
		setEditingProduct(product);
		setEditingSizeIndex(null);

		const rawSizes = Array.isArray(product.sizes) ? product.sizes : [];
		const rawIngredients = Array.isArray(product.ingredients) ? product.ingredients.filter(Boolean) : [];
		const rawAddons = Array.isArray(product.addons) ? product.addons.filter(Boolean) : [];

		const sizes = rawSizes.filter(Boolean).map((size, idx) => {
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
				const invItem = (inventory || []).find((entry) => safeLower(safeItemName(entry)) === safeLower(ingredient));
				return {
					name: invItem ? safeItemName(invItem) : ingredient,
					unit: invItem?.unit || "pcs",
					stockUnit: invItem?.unit || "pcs",
					quantityUsed: "",
					quantityBySize: {},
				};
			}
			const invId = ingredient?.inventoryItemId != null ? Number(ingredient.inventoryItemId) : null;
			const invItem = (inventory || []).find((entry) => (invId !== null && Number(entry?.id) === invId) || safeLower(safeItemName(entry)) === safeLower(ingredient?.name));
			const quantityBySize = Object.fromEntries(
				sizes.map((size) => {
					const rawSizeObj = rawSizes.find((s) => s?.label === size.label);
					const sizedIngredient = Array.isArray(rawSizeObj?.ingredients)
						? rawSizeObj.ingredients.find((entry) => entry && Number(entry.inventoryItemId) === invId)
						: null;
					return [
						size.label,
						sizedIngredient && sizedIngredient.quantityUsed != null ? String(sizedIngredient.quantityUsed) : "0",
					];
				})
			);
			return {
				...ingredient,
				name: ingredient.name || safeItemName(invItem) || "",
				unit: ingredient.unit || invItem?.unit || "pcs",
				stockUnit: ingredient.stockUnit || invItem?.unit || ingredient.unit || "pcs",
				quantityUsed: ingredient.quantityUsed == null ? "" : String(ingredient.quantityUsed),
				quantityBySize,
			};
		});

		const addons = rawAddons.map((addon) => {
			const invId = addon?.inventoryItemId != null ? Number(addon.inventoryItemId) : null;
			const addonLabel = String(addon?.label || "");
			const invItem = (inventory || []).find((entry) => (invId !== null && Number(entry?.id) === invId) || safeLower(safeItemName(entry)) === safeLower(addonLabel));
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
			stock: product.stock != null ? String(product.stock) : "",
			description: product.description != null ? String(product.description) : "",
			category: product.category != null ? String(product.category) : (dbCategories[0]?.name || ""),
			image: product.image != null ? String(product.image) : "",
			sizes,
			ingredients,
			addons,
			available: product.available !== false,
		});
		setIngredientDraft({ name: "", quantityUsed: "", unit: "pcs", stockUnit: "pcs" });
		setRecipeError("");
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
		setImageError("");
		setShowForm(true);
	};

	// Amount an ingredient uses in one size; blank or 0 means "not used in this size".
	const sizeQty = (ing, label) => {
		if (!ing) return 0;
		const explicit = ing.quantityBySize?.[label];
		const fallback = ing.quantityUsed;
		const raw = explicit ?? fallback;
		const amount = Number(raw);
		return raw !== "" && raw != null && Number.isFinite(amount) && amount > 0 ? amount : 0;
	};

	const saveProduct = async (event) => {
		event.preventDefault();
		if (categoriesLoading || !formValues.category) {
			setRecipeError("Categories are still loading from database. Please wait.");
			return;
		}
		const name = String(formValues.name || "").trim();
		const description = String(formValues.description || "").trim();
		const numericPrice = Number(formValues.price);

		if (!name || !description || !Number.isFinite(numericPrice) || numericPrice < 0) return;

		// Clean and validate variation sizes
		const cleanSizes = (formValues.sizes || [])
			.map((s) => ({ label: String(s?.label || "").trim(), price: s?.price }))
			.filter((s) => s.label || (s.price !== "" && s.price !== null && s.price !== undefined));

		if (cleanSizes.length > 0) {
			for (const s of cleanSizes) {
				if (!s.label) {
					setRecipeError("Each variation must have a name (e.g. Large, Medium).");
					return;
				}
				const p = Number(s.price);
				if (s.price === "" || !Number.isFinite(p) || p < 0) {
					setRecipeError(`Please enter a valid price for variation "${s.label}".`);
					return;
				}
			}
			const lowerLabels = cleanSizes.map((s) => safeLower(s.label));
			if (new Set(lowerLabels).size !== lowerLabels.length) {
				setRecipeError("Each variation must have a unique name.");
				return;
			}
		}

		const finalSizes = cleanSizes.length
			? cleanSizes.map((size) => ({
					label: size.label,
					price: Number(size.price),
					ingredients: (formValues.ingredients || [])
						.map((ingredient) => ({
							...(ingredient?.inventoryItemId ? { inventoryItemId: Number(ingredient.inventoryItemId) } : {}),
							name: String(ingredient?.name || "").trim(),
							quantityUsed: sizeQty(ingredient, size.label),
							unit: ingredient?.unit || "pcs",
							stockUnit: ingredient?.stockUnit || ingredient?.unit || "pcs",
						}))
						.filter((ingredient) => ingredient.quantityUsed > 0),
				}))
			: [{
					label: "Regular",
					price: numericPrice,
					ingredients: (formValues.ingredients || [])
						.map((ing) => ({
							...(ing?.inventoryItemId ? { inventoryItemId: Number(ing.inventoryItemId) } : {}),
							name: String(ing?.name || "").trim(),
							quantityUsed: Number(ing?.quantityUsed ?? ing?.quantityBySize?.Regular ?? 0),
							unit: ing?.unit || "pcs",
							stockUnit: ing?.stockUnit || ing?.unit || "pcs",
						}))
						.filter((ing) => (ing.inventoryItemId || ing.name) && ing.quantityUsed > 0),
				}];

		if (finalSizes.some((size) => !Number.isFinite(size.price) || size.price < 0)) {
			setRecipeError("Enter a valid price for every serving size.");
			return;
		}
		const emptySize = (formValues.ingredients || []).length > 0 ? finalSizes.find((size) => !size.ingredients.length) : null;
		if (emptySize) {
			setRecipeError(`The ${emptySize.label} size has no ingredients. Enter an amount above 0 for at least one ingredient.`);
			return;
		}

		if (getCategoryFamily(formValues.category) === "drink") {
			if (cupInventoryItems.length === 0) {
				setRecipeError("No cups found in Inventory. Drinks require a cup for each size. Please add at least one cup in Inventory (under category Cups & Lids) before saving.");
				return;
			}
			for (const size of finalSizes) {
				const hasCup = (size.ingredients || []).some((ing) => isCupIngredient(ing) && ing.quantityUsed > 0);
				if (!hasCup) {
					setRecipeError(`Every drink size must have a cup selected from Inventory (variation "${size.label}" is missing a cup).`);
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
				setRecipeError(`Enter a valid non-negative price for add-on "${addonLabel || "unnamed"}".`);
				return;
			}
			if ((addon.inventoryItemId || addon.quantityUsed != null) && (!Number.isFinite(addonQty) || addonQty <= 0)) {
				setRecipeError(`Enter a positive quantity used for add-on "${addonLabel}".`);
				return;
			}
			if (Number.isFinite(addonQty) && addonQty > 0 && !convertRecipeAmount(addonQty, addonUnit, addonStockUnit)) {
				setRecipeError(`Add-on "${addonLabel}" unit "${addonUnit}" is not compatible with stock unit "${addonStockUnit}".`);
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
			description,
			category: formValues.category,
			image: formValues.image || "",
			available: formValues.available !== false,
			sizes: finalSizes,
			// Default recipe = the first size's recipe; every size also sends its own list.
			ingredients: finalSizes[0]?.ingredients || [],
			addons: (formValues.addons || []).map((addon) => ({ ...addon, price: Number(addon?.price || 0), quantityUsed: Number(addon?.quantityUsed || 1), unit: addon?.unit || "pcs", stockUnit: addon?.stockUnit || addon?.unit || "pcs" })),
		};

		try {
			if (editingProduct) await updateProduct(editingProduct.id, { ...productData, stock: cleanStock });
			else await addProduct({ ...productData, stock: cleanStock, available: formValues.available !== false, featured: false });
			await refreshInventory?.().catch(() => null);
			setSyncNotice(`${name} saved successfully.`);
			closeForm();
		} catch (error) {
			setRecipeError(error.message);
			window.alert(error.message);
		}
	};

	const availableCount = (products || []).filter((product) => product?.available).length;
	const lowStockCount = (products || []).filter((product) => product?.stock > 0 && product?.stock <= 7).length;
	const recipeDraftItem = (inventory || []).find((entry) => safeLower(safeItemName(entry)) === safeLower(ingredientDraft.name));

	const computeSizeCosting = (sizeLabel, rawSizePrice) => {
		const formPrice = Number(formValues?.price) || 0;
		const numericPrice = rawSizePrice !== "" && rawSizePrice !== null && rawSizePrice !== undefined && !Number.isNaN(Number(rawSizePrice))
			? Number(rawSizePrice)
			: formPrice;
		let rawCost = 0;
		const ingredients = (formValues.ingredients || []).filter(Boolean);
		let costComplete = ingredients.length > 0;
		for (const ing of ingredients) {
			if (!ing) continue;
			const ingName = safeLower(ing.name || ing.item);
			const invItemId = Number(ing.inventoryItemId);
			const invItem = (inventory || []).find((entry) => (invItemId > 0 && Number(entry?.id) === invItemId) || safeLower(safeItemName(entry)) === ingName);
			const unitCost = Number(invItem?.unitCost ?? invItem?.unit_cost ?? ing.unitCost ?? 0);
			const stockUnit = invItem?.unit || ing.stockUnit || ing.unit || "pcs";
			const recipeUnit = ing.unit || stockUnit;
			const rawSizeQty = sizeLabel ? ing.quantityBySize?.[sizeLabel] : undefined;
			if (rawSizeQty !== undefined && !(Number(rawSizeQty) > 0)) continue; // unused in this size
			const matchedSize = sizeLabel ? (formValues.sizes || []).find((s) => s?.label === sizeLabel) : null;
			const factor = matchedSize ? defaultSizeFactor(matchedSize.factor, 0) : 1.0;
			const qtyUsed = Number(sizeLabel ? (ing.quantityBySize?.[sizeLabel] ?? scaleIngredientAmount(ing.quantityUsed, factor, recipeUnit)) : ing.quantityUsed);
			const stockQty = convertRecipeAmount(qtyUsed, recipeUnit, stockUnit);
			if (!stockQty || !(unitCost > 0)) {
				costComplete = false;
			} else {
				rawCost += stockQty * unitCost;
			}
		}
		const safeRawCost = Number.isFinite(rawCost) ? rawCost : 0;
		const cost = Number(safeRawCost.toFixed(2));
		const grossProfit = numericPrice > 0 ? Number((numericPrice - cost).toFixed(2)) : 0;
		const margin = (numericPrice > 0 && Number.isFinite(cost)) ? Number((((numericPrice - cost) / numericPrice) * 100).toFixed(1)) : null;
		const foodCostPercent = (numericPrice > 0 && Number.isFinite(cost)) ? Number(((cost / numericPrice) * 100).toFixed(1)) : null;
		const suggestedPrice = safeRawCost > 0 ? Math.ceil((safeRawCost / 0.30) / 5) * 5 : null;
		return {
			cost: Number.isFinite(cost) ? cost : 0,
			costComplete,
			grossProfit: Number.isFinite(grossProfit) ? grossProfit : 0,
			margin: Number.isFinite(margin) ? margin : null,
			foodCostPercent: Number.isFinite(foodCostPercent) ? foodCostPercent : null,
			suggestedPrice,
		};
	};

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

	return (
		<div className={`admin-menu-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        role="admin"
        activeTab="menu"
        sidebarCollapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

			<main className="admin-menu-main">
				<header className="admin-menu-topbar"><div><span className="admin-menu-section-label">ADMIN PORTAL</span><h1>Menu Management</h1></div><div className="admin-menu-topbar-actions"><PortalNotificationButton /><div className="admin-menu-user"><div className="amaya-admin-avatar"><img src={adminAvatar} alt="" aria-hidden="true" /></div><div><strong>Administrator</strong><span>Admin</span></div></div></div></header>

				<div className="admin-menu-content custom-menu-scrollbar">
					<div className="admin-menu-workspace">
						<div className="admin-menu-main-pane">
							<section className="admin-menu-heading">
								<div>
									<span className="admin-menu-eyebrow">PRODUCT CATALOG</span>
									<h2>Everything on the menu</h2>
									<p>Keep your offerings fresh, organized, and ready for every customer.</p>
								</div>
								<div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
									<Link
										to="/admin/archive"
										className="admin-menu-archive-button"
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: "0.4rem",
											padding: "0.65rem 1rem",
											borderRadius: "10px",
											background: "#ffffff",
											color: "#2e261f",
											fontWeight: "600",
											fontSize: "0.88rem",
											textDecoration: "none",
											border: "1px solid #ece4df",
											boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
										}}
									>
										<Archive size={16} /> View Archive
									</Link>
									<button type="button" className="admin-menu-add-button" onClick={openAddForm}><span>+</span> Add new item</button>
								</div>
							</section>

							<section className="admin-menu-toolbar">
								<div className="admin-menu-tabs" role="tablist" aria-label="Menu categories">
									{categories.map((category) => (
										<button
											type="button"
											key={category}
											className={activeCategory === category ? "active" : ""}
											onClick={() => { setActiveCategory(category); setCurrentPage(1); }}
										>
											{category}
											<span>{category === "All items" ? products.length : products.filter((product) => product.category === category).length}</span>
										</button>
									))}
									<Link
										to="/admin/categories"
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: "4px",
											padding: "6px 12px",
											fontSize: "0.78rem",
											fontWeight: "600",
											color: "#5a3d28",
											background: "#f5ece5",
											borderRadius: "8px",
											textDecoration: "none",
											marginLeft: "4px"
										}}
										title="Manage Categories in Database"
									>
										⚙ Manage
									</Link>
								</div>
								<label className="admin-menu-search">
									<span>⌕</span>
									<input value={search} onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }} placeholder="Search menu items" aria-label="Search menu items" />
								</label>
							</section>

							<section className="admin-menu-list-header">
								<div>
									<h3>{activeCategory}</h3>
									<span>{visibleProducts.length} items in this view</span>
								</div>
								<select aria-label="Sort menu items" value={sortBy} onChange={(event) => { setSortBy(event.target.value); setCurrentPage(1); }}>
									<option value="popular">Sort: Featured first</option>
									<option value="name">Sort: Name A–Z</option>
									<option value="price">Sort: Price low to high</option>
								</select>
							</section>

							<section className="admin-menu-grid">
								{pageProducts.map((product) => (
									<article className={`admin-product-card ${!product.available ? "unavailable" : ""}`} key={product.id}>
										<div className="admin-product-image">
											<img src={product.image} alt={product.name} onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement.classList.add("image-unavailable"); }} />
											{product.featured && <span className="featured-label">★ Featured</span>}
											<button type="button" className="product-menu-button" aria-label={`Edit ${product.name}`} onClick={() => openEditForm(product)}>•••</button>
										</div>
										<div className="admin-product-body">
											<div className="admin-product-meta"><span>{product.category}</span><strong>{product.price}</strong></div>
											<h4>{product.name}</h4>
											{Number(product.cost) > 0 && (
												<div className="admin-product-cost-badge">
													COGS ₱{safeToFixed(product.cost, 2)}{product.margin != null ? ` · ${safeToFixed(product.margin, 1)}% margin` : ""}
												</div>
											)}
											<p>{product.description}</p>
											<div className="admin-product-footer">
												<span className={`stock-label ${product.stock === 0 ? "out" : product.stock <= 7 ? "low" : ""}`}>
													{product.stock === 0 ? "Out of stock" : `${product.stock} in stock`}
												</span>
												<label className="availability-toggle">
													<input type="checkbox" checked={product.available} onChange={() => toggleAvailability(product.id)} />
													<span></span>
													<small>{product.available ? "Available" : "Hidden"}</small>
												</label>
												<button type="button" className="product-delete-button" onClick={() => handleDelete(product)} aria-label={`Delete ${product.name}`}>Delete</button>
											</div>
										</div>
									</article>
								))}
								{!visibleProducts.length && (
									<div className="admin-menu-empty" role={menuError ? "alert" : undefined}>
										<strong>{menuError ? "Could not load menu items" : "No menu items found"}</strong>
										<span>{menuError || "Try another category or search term."}</span>
									</div>
								)}
							</section>

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
											<strong className="metric-value">{products.filter((product) => product.featured).length}</strong>
											<span className="metric-hint">Shown on homepage</span>
										</div>
									</article>
								</div>
							</div>
						</aside>
					</div>
				</div>
			</main>

			{itemToDelete && (
				<div
					className="admin-menu-modal-backdrop delete-backdrop"
					role="presentation"
					onClick={() => setItemToDelete(null)}
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

						<div className="delete-confirm-actions">
							<button type="button" className="delete-confirm-cancel" onClick={() => setItemToDelete(null)}>
								Cancel
							</button>
							<button type="button" className="delete-confirm-submit" onClick={confirmDelete}>
								Move to Archive
							</button>
						</div>
					</div>
				</div>
			)}

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
					<div className="admin-menu-modal-backdrop" role="presentation" onClick={closeForm}>
					<form
						className="admin-menu-modal menu-builder"
						onSubmit={saveProduct}
						role="dialog"
						aria-modal="true"
						aria-labelledby="edit-item-title"
						onClick={(event) => event.stopPropagation()}
					>
						<header className="menu-builder-header">
							<span className="menu-builder-header-icon" aria-hidden="true">
								<ClipboardList size={18} strokeWidth={1.9} />
							</span>
							<div>
								<span className="admin-menu-eyebrow">CATALOG UPDATE</span>
								<h3 id="edit-item-title">{editingProduct ? "Edit Menu Item" : "Add Menu Item"}</h3>
								<p>
									{editingProduct
										? "Update this item's catalog details below."
										: "Create a new menu item for your catalog. Fill in the details below."}
								</p>
							</div>
							<button type="button" className="menu-builder-close" onClick={closeForm} aria-label="Close form">
								×
							</button>
						</header>

						<div className="menu-builder-layout">
							{/* ---------------- Left: product image ---------------- */}
							<aside className="menu-builder-media">
								<h4 className="menu-builder-legend">Product Image</h4>
								<p className="menu-builder-hint">Upload an image of the menu item.</p>

								{formValues.image ? (
									<div className="menu-builder-active-image-card">
										<div className="menu-builder-image-wrap">
											<img src={formValues.image} alt="Menu item preview" />
											<span className="menu-builder-active-badge">Active Image</span>
										</div>
										<div className="menu-builder-image-actions">
											<label className="menu-builder-change-btn" title="Choose a new file to replace this image">
												<input
													type="file"
													accept="image/png,image/jpeg,image/webp"
													onChange={handleImageUpload}
													aria-label="Change product image"
												/>
												<FolderOpen size={13} strokeWidth={2.2} />
												<span>Change Image</span>
											</label>
											<button
												type="button"
												className="menu-builder-remove-btn"
												onClick={() => {
													setFormValues((prev) => ({ ...prev, image: "" }));
													setImageError("");
												}}
												title="Remove this image"
											>
												<Trash2 size={13} strokeWidth={2} />
												<span>Remove</span>
											</button>
										</div>
									</div>
								) : (
									<label
										className="menu-builder-dropzone"
										onDragOver={(event) => event.preventDefault()}
										onDrop={handleImageDrop}
									>
										<input
											type="file"
											accept="image/png,image/jpeg,image/webp"
											onChange={handleImageUpload}
											aria-label="Upload product image"
										/>
										<span className="menu-builder-dropzone-icon" aria-hidden="true">
											<ImagePlus size={22} strokeWidth={1.8} />
										</span>
										<strong>Click to upload or drag and drop</strong>
										<small>PNG, JPG, JPEG, WEBP (Max 5MB)</small>
										<span className="menu-builder-dropzone-cta">
											<FolderOpen size={14} strokeWidth={2} /> Choose File
										</span>
									</label>
								)}

								{imageError ? <p className="menu-builder-error" role="alert">{imageError}</p> : null}
							</aside>

							{/* ---------------- Right: form sections ---------------- */}
							<div className="menu-builder-sections">
								<section className="menu-builder-card">
									<h4 className="menu-builder-legend">Basic Information</h4>

									<label className="menu-builder-field">
										Item Name
										<input
											type="text"
											value={formValues.name}
											onChange={(event) => setFormValues({ ...formValues, name: event.target.value })}
											placeholder="e.g. Classic Milk Tea"
											required
										/>
									</label>

									<div className="menu-builder-grid">
										<label className="menu-builder-field">
											Category
											<select
												value={formValues.category}
												onChange={(event) => setFormValues({ ...formValues, category: event.target.value })}
												disabled={categoriesLoading}
											>
												{categoriesLoading ? (
													<option value="">Loading categories from database...</option>
												) : (
													dbCategories.map((category) => (
														<option key={category.id || category.name} value={category.name}>{category.name}</option>
													))
												)}
											</select>
										</label>

										<label className="menu-builder-field">
											Base Price
											<div className="menu-builder-price">
												<span aria-hidden="true">₱</span>
												<input
													type="number"
													value={formValues.price}
													onChange={(event) => updateBasePrice(event.target.value)}
													inputMode="decimal"
													placeholder="0.00"
													min="0"
													required
												/>
											</div>
										</label>

										<label className="menu-builder-field">
											Stock Quantity
											<div className="menu-builder-price">
												<input
													type="number"
													value={formValues.stock}
													onChange={(e) => setFormValues({ ...formValues, stock: e.target.value })}
													placeholder={formValues.ingredients.length > 0 ? "Calculated from Recipe" : "0"}
													min="0"
													step="1"
												/>
											</div>
											<small className="menu-field-hint" style={{ fontSize: "0.75rem", color: "#8a7a6e", marginTop: "2px" }}>
												{formValues.ingredients.length > 0
													? "Auto-calculated from ingredients on hand"
													: "Direct stock balance for retail/prepared items"}
											</small>
										</label>
									</div>

									<div className="menu-builder-field">
										Status
										<div className="menu-builder-toggle-row">
											<button
												type="button"
												className={`menu-builder-toggle ${formValues.available ? "on" : "off"}`}
												role="switch"
												aria-checked={formValues.available}
												onClick={() => setFormValues((prev) => ({ ...prev, available: !prev.available }))}
											>
												<span className="menu-builder-toggle-track" aria-hidden="true">
													<span className="menu-builder-toggle-thumb" />
												</span>
												<span className="menu-builder-toggle-text">
													{formValues.available ? "Available" : "Unavailable"}
												</span>
											</button>
										</div>
									</div>
								</section>

								<section className="menu-builder-card">
									<div className="menu-builder-section-header">
										<label className="menu-builder-legend with-icon">
											<List aria-hidden="true" size={13} strokeWidth={2.2} />
											Item Variations &amp; Sizes
										</label>
										<div className="menu-builder-variations-actions">
											<button
												type="button"
												className="menu-builder-auto-size-btn"
												onClick={() => handleApplyVariationPreset([
													{ label: "Small", factor: 1.0 },
													{ label: "Medium", factor: 1.25 },
													{ label: "Large", factor: 1.5 },
												])}
												title="Preset: Small, Medium, Large"
											>
												<Sparkles size={12} strokeWidth={2.2} /> S / M / L
											</button>

											<button
												type="button"
												className="menu-builder-auto-size-btn"
												onClick={() => handleApplyVariationPreset([
													{ label: "8oz", factor: 1.0 },
													{ label: "12oz", factor: 1.25 },
													{ label: "16oz", factor: 1.5 },
												])}
												title="Preset: 8oz, 12oz, 16oz"
											>
												<Sparkles size={12} strokeWidth={2.2} /> 8oz / 12oz / 16oz
											</button>

											{getCategoryFamily(formValues.category) === "fries" && (
												<button
													type="button"
													className="menu-builder-auto-size-btn"
													onClick={() => handleApplyVariationPreset(VARIATION_PRESETS.fries)}
													title="Auto-generate Regular, Large, and Jumbo / Party portions"
												>
													<Sparkles size={12} strokeWidth={2.2} /> Fries (R/L/Jumbo)
												</button>
											)}

											{getCategoryFamily(formValues.category) === "snack_pieces" && (
												<button
													type="button"
													className="menu-builder-auto-size-btn"
													onClick={() => handleApplyVariationPreset(VARIATION_PRESETS.snack_pieces)}
													title="Auto-generate 4 pcs (Solo), 6 pcs (Sharing), and 12 pcs (Party)"
												>
													<Sparkles size={12} strokeWidth={2.2} /> Counts (4/6/12s)
												</button>
											)}

											{formValues.sizes.length > 0 && (
												<button
													type="button"
													className="menu-builder-auto-size-btn"
													onClick={handleClearVariations}
													title="Clear all variations to sell at the single base price"
												>
													<Archive size={12} strokeWidth={2.2} /> Clear
												</button>
											)}

											<button
												type="button"
												className="menu-builder-add-btn"
												onClick={addVariation}
												title="Add a new variation"
											>
												<Plus size={14} strokeWidth={2.4} /> Add Variation
											</button>
										</div>
									</div>

									{getCategoryFamily(formValues.category) === "single_fixed" && formValues.sizes.length === 0 && (
										<div className="menu-builder-cups-detection" style={{ background: "#f8f6f2", borderColor: "#e6e0d8", color: "#5a4d41" }}>
											<div className="menu-builder-cups-title">
												<Utensils size={13} strokeWidth={2.2} />
												<span>Fixed Price Item: No size variations needed. Base price (₱{safeToFixed(formValues.price, 2)}) is the customer price. Click &ldquo;+ Add Variation&rdquo; only if offering special sizes or combo portions.</span>
											</div>
										</div>
									)}

									{getCategoryFamily(formValues.category) === "drink" && cupInventoryItems.length === 0 && (
										<div className="menu-builder-cups-detection" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>
											<div className="menu-builder-cups-title" style={{ color: "#991b1b" }}>
												<Coffee size={13} strokeWidth={2.2} />
												<span>No cups found in Inventory. Drinks require a cup for each size. Please <a href="/admin/inventory" style={{ textDecoration: "underline", fontWeight: "bold", color: "#991b1b" }}>add a cup in Inventory first</a> (under category Cups &amp; Lids) before saving.</span>
											</div>
										</div>
									)}

									{getCategoryFamily(formValues.category) === "drink" && cupInventoryItems.length > 0 && (
										<div className="menu-builder-cups-detection">
											<div className="menu-builder-cups-title">
												<Coffee size={13} strokeWidth={2.2} />
												<span>Available Cups in Inventory (Category: Cups &amp; Lids):</span>
											</div>
											<div className="menu-builder-cups-chips">
												{cupInventoryItems.map((cup) => {
													const cupName = safeItemName(cup);
													const label = cupName.replace(/\s*cup\s*/i, "").trim() || cupName;
													const isAdded = formValues.sizes.some((s) => safeLower(s?.label) === safeLower(label) || s.cupId === cup.id);
													return (
														<button
															key={cup.id}
															type="button"
															className={`menu-cup-chip ${isAdded ? "is-added" : ""}`}
															onClick={() => addSingleCupVariation(cup)}
															title={isAdded ? `${label} is already in the variations list` : `Click to add ${label} variation (${cup.quantity} pcs in stock)`}
														>
															<span className="cup-chip-label">{label}</span>
															<span className="cup-chip-name">{cupName}</span>
															<span className="cup-chip-stock">{Number(cup.quantity)} pcs</span>
															{isAdded ? <Check size={12} strokeWidth={2.4} /> : <Plus size={12} strokeWidth={2.4} />}
														</button>
													);
												})}
											</div>
										</div>
									)}

									{formValues.sizes.length ? (
										<div className="menu-builder-size-list">
											{formValues.sizes.map((size, index) => {
												const isEditing = editingSizeIndex === index;
												const sizeCosting = computeSizeCosting(size?.label, size?.price) || { cost: 0, costComplete: false, grossProfit: 0, margin: null, suggestedPrice: null };
												const factor = defaultSizeFactor(size?.factor, index);
												const recipeSummary = (formValues.ingredients || [])
													.map((ing) => {
														if (!ing) return "";
														const rawQty = ing.quantityBySize?.[size?.label];
														if (rawQty !== undefined && !(Number(rawQty) > 0)) return "";
														const qty = rawQty ?? scaleIngredientAmount(ing.quantityUsed, factor, ing.unit);
														return `${qty}${ing.unit || ""} ${ing.name || ""}`.trim();
													})
													.filter(Boolean)
													.join(", ");
												const marginTone = sizeCosting?.margin == null
													? "neutral"
													: sizeCosting.margin >= 50
														? "good"
														: sizeCosting.margin >= 30
															? "warn"
															: "low";
												return (
													<div
														className={`menu-builder-size-row ${isEditing ? "editing" : "normal"}`}
														key={index}
														ref={isEditing ? editingSizeRef : null}
													>
														{isEditing ? (
															<div className="size-row-edit-content">
																<input
																	type="text"
																	className="size-label-input"
																	value={size?.label || ""}
																	placeholder="Variation name (e.g. Large, Medium)"
																	onChange={(e) => updateSizeLabel(index, e.target.value)}
																	autoFocus
																	onKeyDown={(e) => {
																		if (e.key === "Enter") {
																			e.preventDefault();
																			setEditingSizeIndex(null);
																		}
																	}}
																	aria-label="Variation name"
																/>
																<div className="size-price-input-wrap">
																	<span className="size-currency-sign">₱</span>
																	<input
																		type="number"
																		min="0"
																		step="0.01"
																		className="size-price-input"
																		value={size?.price ?? ""}
																		placeholder={formValues.price || "0.00"}
																		onChange={(e) => updateSizePrice(index, e.target.value)}
																		onKeyDown={(e) => {
																			if (e.key === "Enter") {
																				e.preventDefault();
																				setEditingSizeIndex(null);
																			}
																		}}
																		aria-label={`${size?.label || "Variation"} price`}
																	/>
																</div>
																<div className="size-factor-input-wrap" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
																	<span style={{ fontSize: "11px", color: "#6b7280" }}>Scale:</span>
																	<input
																		type="number"
																		min="0.1"
																		max="10"
																		step="0.05"
																		style={{ width: "60px", padding: "4px 6px", fontSize: "12px", borderRadius: "4px", border: "1px solid #d1d5db" }}
																		value={size?.factor ?? factor}
																		onChange={(e) => updateSizeFactor(index, e.target.value)}
																		aria-label={`${size?.label || "Variation"} scale factor`}
																	/>
																</div>
																{getCategoryFamily(formValues.category) === "drink" && (
																	<div className="size-cup-select-wrap" style={{ display: "flex", alignItems: "center", gap: "4px" }}>
																		<select
																			value={size?.cupId || ""}
																			onChange={(e) => assignCupToSize(index, e.target.value)}
																			style={{ fontSize: "12px", padding: "4px 6px", borderRadius: "4px", border: "1px solid #d1d5db" }}
																			aria-label={`Cup for ${size?.label || "Variation"}`}
																		>
																			<option value="">-- Select Cup --</option>
																			{(cupInventoryItems || []).map((cup) => (
																				<option key={cup.id} value={cup.id}>
																					{safeItemName(cup)} ({cup.quantity} {cup.unit})
																				</option>
																			))}
																		</select>
																	</div>
																)}
															</div>
														) : (
															<div className="size-row-display-content">
																<button
																	type="button"
																	className="size-name-btn"
																	onClick={() => setEditingSizeIndex(index)}
																	title="Click to edit variation name"
																>
																	<strong className={String(size?.label || "").trim() ? "" : "empty-placeholder"}>
																		{String(size?.label || "").trim() ? size.label : "Untitled Variation"}
																	</strong>
																</button>
																{getCategoryFamily(formValues.category) === "drink" && (
																	<span
																		style={{ fontSize: "11px", background: "#f3f4f6", padding: "2px 6px", borderRadius: "4px", color: size?.cupId ? "#1f2937" : "#9ca3af", cursor: "pointer" }}
																		onClick={() => setEditingSizeIndex(index)}
																		title="Click to change assigned cup"
																	>
																		☕ {safeItemName((inventory || []).find((i) => Number(i?.id) === Number(size?.cupId))) || "No cup selected"}
																	</span>
																)}
																<div
																	className="size-price-display"
																	onClick={() => setEditingSizeIndex(index)}
																	title="Click to edit price"
																>
																	<span className="price-caption">Serving price</span>
																	<strong className="price-tag">
																		₱{safeToFixed(size?.price !== "" && size?.price != null ? size.price : formValues.price, 2)}
																	</strong>
																</div>
															</div>
														)}

														<button
															type="button"
															className={`size-toggle-chevron-btn ${isEditing ? "active" : ""}`}
															onClick={() => setEditingSizeIndex(isEditing ? null : index)}
															aria-label={isEditing ? "Close variation editor" : "Edit variation"}
															title={isEditing ? "Close editor" : "Edit name & price"}
														>
															<ChevronRight size={15} strokeWidth={2.4} className={`chevron-icon ${isEditing ? "rotated" : ""}`} />
														</button>

														<button
															type="button"
															className="size-delete-btn"
															onClick={() => removeSize(index)}
															aria-label={`Remove ${size?.label || "variation"}`}
															title="Remove variation"
														>
															×
														</button>

														<div className="size-costing-strip">
															{(formValues.ingredients || []).length === 0 ? (
																<span className="size-costing-note">Add recipe ingredients below to calculate COGS &amp; suggested price</span>
															) : (
																<>
																	<span className="size-recipe-pill" title={`${factor}x Recipe (${recipeSummary})`}>
																		<Beaker size={11} strokeWidth={2} />
																		{factor}x Recipe{recipeSummary ? ` (${recipeSummary})` : ""}
																	</span>
																	<span>COGS <strong>₱{safeToFixed(sizeCosting?.cost, 2)}</strong></span>
																	<span>·</span>
																	<span>Profit <strong>₱{safeToFixed(sizeCosting?.grossProfit ?? 0, 2)}</strong></span>
																	<span className={`size-margin-badge ${marginTone}`}>
																		Margin {sizeCosting?.margin != null && Number.isFinite(sizeCosting.margin) ? `${safeToFixed(sizeCosting.margin, 1)}%` : "—"}
																	</span>
																	{sizeCosting?.suggestedPrice != null && (
																		<>
																			<span>Suggested <strong>₱{sizeCosting.suggestedPrice}</strong> (30% food cost)</span>
																			<button
																				type="button"
																				className="size-apply-suggested-btn"
																				onClick={() => applySuggestedSizePrice(index, sizeCosting.suggestedPrice)}
																			>
																				Apply ₱{sizeCosting.suggestedPrice}
																			</button>
																		</>
																	)}
																	{!sizeCosting?.costComplete && (
																		<span className="size-costing-warning">Some ingredients have ₱0 unit cost in Inventory</span>
																	)}
																</>
															)}
														</div>
													</div>
												);
											})}
										</div>
									) : (
										<div className="menu-builder-empty-variations">
											<div className="empty-variations-msg">
												No variations added yet. Click &ldquo;+ Add Variation&rdquo; to add sizes like Medium or Large, or populate from detected cups in inventory:
											</div>
											{(cupInventoryItems || []).length > 0 && (
												<div className="empty-variations-cups-actions">
													<button
														type="button"
														className="empty-variations-all-cups-btn"
														onClick={handleAutoSetFromCups}
													>
														<Sparkles size={13} strokeWidth={2.2} /> Auto-Generate All {cupInventoryItems.length} Cup Sizes ({(cupInventoryItems || []).map((c) => safeItemName(c)).join(", ")})
													</button>
												</div>
											)}
										</div>
									)}

									<p className="menu-recipe-help">
										Set a price for each size. Click &ldquo;+ Add Variation&rdquo; to add sizes. Click the variation button or the (&gt;) control to edit its name and price.
									</p>
								</section>

								<section className="menu-builder-card">
									<label className="menu-builder-legend with-icon">
										<Beaker aria-hidden="true" size={13} strokeWidth={2.2} />
										Ingredients &amp; Recipe
									</label>
					<p className="menu-recipe-help">Set the amount used for one serving. Choose recipe and stock units from the same group: weight, volume, or count. Compatible units convert automatically.</p>
					<div className="menu-recipe-entry menu-conversion-entry">
						<input list="menu-inventory-items" value={ingredientDraft.name} onChange={(event) => { const name = event.target.value; const existing = findInventoryItem(name); setIngredientDraft((current) => ({ ...current, name, stockUnit: existing?.unit || current.stockUnit, unit: existing?.unit || current.unit })); setRecipeError(""); }} aria-label="Ingredient name" placeholder="Pick from inventory..." />
						<label className="menu-recipe-field"><span>Amount per serving</span><input type="number" min="0.000001" step="0.000001" value={ingredientDraft.quantityUsed} onChange={(event) => { setIngredientDraft((current) => ({ ...current, quantityUsed: event.target.value })); setRecipeError(""); }} aria-label="Amount used per serving" placeholder="e.g. 5" /></label>
						<label className="menu-recipe-field"><span>Recipe unit</span><UnitSelect value={ingredientDraft.unit} compatibleWith={recipeDraftItem?.unit || ingredientDraft.stockUnit} onChange={(unit) => { setIngredientDraft((current) => ({ ...current, unit })); setRecipeError(""); }} ariaLabel="Ingredient recipe unit" /></label>
						<label className="menu-recipe-field"><span>Stock unit</span><UnitSelect value={recipeDraftItem?.unit || ingredientDraft.stockUnit} disabled={Boolean(recipeDraftItem)} onChange={(stockUnit) => { setIngredientDraft((current) => ({ ...current, stockUnit, unit: current.unit === current.stockUnit ? stockUnit : current.unit })); setRecipeError(""); }} ariaLabel="Ingredient stock unit" /></label>
						<button type="button" onClick={addRecipeIngredient} disabled={!ingredientDraft.name.trim() || !ingredientDraft.quantityUsed}>
							<Plus size={14} strokeWidth={2.4} /> Add ingredient
						</button>
						<a
							href="/admin/inventory"
							target="_blank"
							rel="noopener noreferrer"
							className="menu-builder-auto-size-btn"
							style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "4px", padding: "6px 10px" }}
							title="Open Inventory in a new tab to add stock items"
						>
							<ExternalLink size={12} strokeWidth={2.2} /> + New in Inventory
						</a>
					</div>
					{convertRecipeAmount(ingredientDraft.quantityUsed, ingredientDraft.unit, recipeDraftItem?.unit || ingredientDraft.stockUnit) != null && <p className="menu-recipe-help">Uses {convertRecipeAmount(ingredientDraft.quantityUsed, ingredientDraft.unit, recipeDraftItem?.unit || ingredientDraft.stockUnit).toLocaleString(undefined, { maximumFractionDigits: 6 })} {recipeDraftItem?.unit || ingredientDraft.stockUnit} from inventory per serving.</p>}
					{inventory.some((entry) => safeLower(safeItemName(entry)) === safeLower(ingredientDraft.name) && amountAttachedToUnit(entry.unit)) && <p className="menu-recipe-error" role="alert">This inventory item has an amount inside its unit. Edit it in Inventory so its quantity and unit are separate (for example, quantity 5 and unit kg).</p>}
					<datalist id="menu-inventory-items">{inventory.map((entry) => <option key={entry.id} value={safeItemName(entry)}>{entry.quantity} {entry.unit} in stock</option>)}</datalist>
									{recipeError && <p className="menu-recipe-error" role="alert">{recipeError}</p>}
									{formValues.ingredients.length > 0 && formValues.sizes.length > 0 && (
										<div className="menu-size-recipe-summary-card">
											<div className="menu-size-recipe-summary-header">
												<div>
													<h4>Recipe Breakdown by Size</h4>
													<p>Live portion preview per cup based on your configured amounts.</p>
												</div>
												<span className="summary-size-count">
													{formValues.sizes.length} {formValues.sizes.length === 1 ? "Size" : "Sizes"}
												</span>
											</div>
											<ul className="menu-size-recipe-summary" aria-label="Ingredients per size">
												{formValues.sizes.map((size) => {
													const used = formValues.ingredients.filter((ing) => sizeQty(ing, size.label) > 0);
													return (
														<li key={size.label} className={`menu-size-recipe-item ${used.length ? "" : "is-empty"}`}>
															<div className="size-summary-row">
																<span className="size-summary-badge">{size.label || "Unnamed size"}</span>
																<div className="size-ingredients-wrap">
																	{used.length ? (
																		used.map((ing, i) => (
																			<span className="size-ingredient-chip" key={`${ing.name}-${i}`}>
																				<span className="chip-name">{ing.name}</span>
																				<strong className="chip-qty">{sizeQty(ing, size.label)} {ing.unit || ""}</strong>
																			</span>
																		))
																	) : (
																		<span className="size-empty-warning" role="alert">
																			No ingredients configured. Enter an amount above 0 for this size.
																		</span>
																	)}
																</div>
															</div>
														</li>
													);
												})}
											</ul>
										</div>
									)}
									{formValues.ingredients.length > 0 && (
										<div className="menu-recipe-list">
										{formValues.ingredients.map((ingredient, index) => {
								const inventoryItem = findInventoryItem(ingredient.name);
								const ingredientName = safeItemName(inventoryItem) || ingredient.name || "Missing inventory item";
								return (
									<div className="menu-recipe-row" key={`${ingredientName}-${index}`}>
														<div className="menu-recipe-name"><strong>{ingredientName}</strong><small>{inventoryItem ? `On hand: ${inventoryItem.quantity} ${inventoryItem.unit}` : `New stock unit: ${ingredient.stockUnit || "pcs"}`}</small>{(formValues.sizes.length ? formValues.sizes.every((size) => sizeQty(ingredient, size.label) === 0) : sizeQty(ingredient) === 0) && <small className="menu-recipe-error" role="alert">Amount is 0 for every size, so this ingredient will be removed when you save.</small>}</div>
										<label className="menu-recipe-unit">Recipe unit<UnitSelect value={ingredient.unit || "pcs"} compatibleWith={inventoryItem?.unit || ingredient.stockUnit || "pcs"} onChange={(unit) => updateRecipeUnit(index, unit)} ariaLabel={`${ingredientName} recipe unit`} /></label>
														<div className="menu-recipe-size-grid">
															{formValues.sizes.map((size) => (
																		<label key={size.label}>{size.label}<input type="number" min="0" step="0.000001" value={ingredient.quantityBySize?.[size.label] ?? ingredient.quantityUsed ?? ""} onChange={(event) => updateSizeRecipeQuantity(index, size.label, event.target.value)} aria-label={`${ingredientName} amount for ${size.label} (0 or blank if not used)`} /></label>
															))}
														</div>
														<button type="button" onClick={() => removeIngredient(index)} aria-label={`Remove ${ingredientName} from recipe`}>×</button>
													</div>
												);
											})}
										</div>
									)}
								</section>

								<section className="menu-builder-card">
									<label className="menu-builder-legend with-icon">
										<Sparkles aria-hidden="true" size={13} strokeWidth={2.2} />
										Add-ons &amp; Customizations
									</label>
					<p className="menu-recipe-help">The add-on amount is what one serving consumes. Choose recipe and stock units from the same group: weight, volume, or count. Compatible units convert automatically; weight and volume need a density conversion and cannot be mixed directly.</p>
					<div className="menu-recipe-entry menu-addon-entry menu-conversion-entry">
						<input list="menu-inventory-items" value={addonDraft.label} onChange={(event) => { const label = event.target.value; const existing = findInventoryItem(label); setAddonDraft((current) => ({ ...current, label, stockUnit: existing?.unit || current.stockUnit, unit: existing?.unit || current.unit })); setRecipeError(""); }} aria-label="Add-on inventory name" placeholder="Add-on name" />
						<input type="number" min="0" step="0.01" value={addonDraft.price} onChange={(event) => setAddonDraft((current) => ({ ...current, price: event.target.value }))} aria-label="Add-on price" placeholder="Price" />
						<label className="menu-recipe-field"><span>Amount / serving</span><input type="number" min="0.000001" step="0.000001" value={addonDraft.quantityUsed} onChange={(event) => setAddonDraft((current) => ({ ...current, quantityUsed: event.target.value }))} aria-label="Add-on amount used per serving" placeholder="e.g. 5" /></label>
						<label className="menu-recipe-field"><span>Recipe unit</span><UnitSelect value={addonDraft.unit} compatibleWith={findInventoryItem(addonDraft.label)?.unit || addonDraft.stockUnit} onChange={(unit) => setAddonDraft((current) => ({ ...current, unit }))} ariaLabel="Add-on recipe unit" /></label>
						<label className="menu-recipe-field"><span>Stock unit</span><UnitSelect value={findInventoryItem(addonDraft.label)?.unit || addonDraft.stockUnit} disabled={Boolean(findInventoryItem(addonDraft.label))} onChange={(stockUnit) => setAddonDraft((current) => ({ ...current, stockUnit, unit: current.unit === current.stockUnit ? stockUnit : current.unit }))} ariaLabel="Add-on stock unit" /></label>
						<button type="button" onClick={addAddon} disabled={!addonDraft.label.trim() || addonDraft.price === "" || !addonDraft.quantityUsed}>
							<Plus size={14} strokeWidth={2.4} /> Add
						</button>
					</div>
					{convertRecipeAmount(addonDraft.quantityUsed, addonDraft.unit, findInventoryItem(addonDraft.label)?.unit || addonDraft.stockUnit) != null && <p className="menu-recipe-help">Uses {convertRecipeAmount(addonDraft.quantityUsed, addonDraft.unit, findInventoryItem(addonDraft.label)?.unit || addonDraft.stockUnit).toLocaleString(undefined, { maximumFractionDigits: 6 })} {findInventoryItem(addonDraft.label)?.unit || addonDraft.stockUnit} from inventory per serving.</p>}
					{inventory.some((entry) => safeLower(safeItemName(entry)) === safeLower(addonDraft.label) && amountAttachedToUnit(entry.unit)) && <p className="menu-recipe-error" role="alert">This inventory item has an amount inside its unit. Edit it in Inventory so its quantity and unit are separate (for example, quantity 5 and unit kg).</p>}

					{formValues.addons.length ? (
						<div className="menu-addon-list">
							{formValues.addons.map((addon, index) => {
								const addonInv = (inventory || []).find((entry) => entry && ((addon.inventoryItemId && Number(entry.id) === Number(addon.inventoryItemId)) || safeLower(safeItemName(entry)) === safeLower(addon.label)));
								const addonStockUnit = addonInv?.unit || addon.stockUnit || "pcs";
								const addonUnitCost = Number(addonInv?.unitCost ?? addonInv?.unit_cost ?? addon.unitCost ?? 0);
								const addonStockQty = convertRecipeAmount(addon.quantityUsed, addon.unit || addonStockUnit, addonStockUnit);
								const addonCost = addonStockQty && addonUnitCost > 0 ? Number((addonStockQty * addonUnitCost).toFixed(2)) : 0;
								const addonPriceNum = Number(addon.price || 0);
								const addonMargin = addonPriceNum > 0 ? Number((((addonPriceNum - addonCost) / addonPriceNum) * 100).toFixed(1)) : null;
								return (
									<div className="menu-addon-row" key={`${addon.label}-${index}`}>
										<div className="menu-addon-name">
											<strong>{addon.label}</strong>
											<small>Stock: {addonInv?.quantity ?? 0} {addonStockUnit}</small>
											<span className="addon-cost-pill">
												COGS ₱{safeToFixed(addonCost, 2)} · {addonMargin != null ? `${addonMargin.toFixed(1)}% margin` : "—"}
											</span>
										</div>
										<label>Price <input type="number" min="0" step="0.01" value={addon.price} onChange={(event) => updateAddon(index, "price", event.target.value)} aria-label={`${addon.label} price`} /></label>
										<label>Used / serving <input type="number" min="0.000001" step="0.000001" value={addon.quantityUsed} onChange={(event) => updateAddon(index, "quantityUsed", event.target.value)} aria-label={`${addon.label} inventory used per serving`} /></label>
										<label>Recipe unit <UnitSelect value={addon.unit || "pcs"} compatibleWith={addonStockUnit} onChange={(unit) => updateAddon(index, "unit", unit)} ariaLabel={`${addon.label} recipe unit`} /></label>
										<button
											type="button"
											onClick={() => removeAddon(index)}
											aria-label={`Remove ${addon.label}`}
										>
											×
										</button>
									</div>
								);
							})}
						</div>
					) : null}

					<small>New add-ons are added to Inventory at zero stock. Restock them in Inventory before selling.</small>
								</section>

								<section className="menu-builder-card">
									<h4 className="menu-builder-legend">Description</h4>
									<label className="menu-builder-field">
										Item Description
										<textarea
											value={formValues.description}
											onChange={(event) => setFormValues({ ...formValues, description: event.target.value })}
											placeholder="Describe this menu item"
											rows={3}
											required
										/>
									</label>
								</section>
							</div>
						</div>

						<footer className="menu-builder-footer">
							<button type="button" className="menu-builder-cancel" onClick={closeForm}>
								Cancel
							</button>
							<button type="submit" className="menu-builder-save" disabled={categoriesLoading}>
								{categoriesLoading ? "Loading..." : (editingProduct ? "Save Item" : "Add Item")}
							</button>
						</footer>
					</form>
				</div>
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
