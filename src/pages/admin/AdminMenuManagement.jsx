import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import Sidebar from "../../components/Sidebar.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import { AlertTriangle, Archive, Beaker, Check, CheckCircle2, ChevronRight, ClipboardList, Clock, Coffee, FolderOpen, ImagePlus, List, Package, Plus, Sparkles, Trash2, Utensils } from "lucide-react";
import adminAvatar from "../../assets/images/icon/admin1.svg";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import { useInventory } from "../../context/InventoryContext.jsx";
import { apiRequest } from "../../utils/api.js";

import "../../assets/css/admin/AdminMenuManagement.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const DEFAULT_MENU_CATEGORIES = [
	"Foods / Snacks",
	"Fries & Sip",
	"Burgers and Hotdogs",
	"Desserts",
	"Milktea",
	"Float Series",
	"Fruity Soda",
	"Fruity Milk",
	"Iced Coffee",
];

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
const convertRecipeAmount = (amount, recipeUnit, stockUnit) => {
	const sourceName = String(recipeUnit || "").trim().toLowerCase();
	const targetName = String(stockUnit || "").trim().toLowerCase();
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

const getCategoryFamily = (category) => {
	const cat = String(category || "").toLowerCase();
	if (cat.includes("milktea") || cat.includes("float") || cat.includes("soda") || cat.includes("milk") || cat.includes("coffee") || cat.includes("drink")) {
		return "drink";
	}
	if (cat.includes("fries")) {
		return "fries";
	}
	if (cat.includes("foods") || cat.includes("snack")) {
		return "snack_pieces";
	}
	if (cat.includes("burger") || cat.includes("hotdog") || cat.includes("dessert")) {
		return "single_fixed";
	}
	return "general";
};

const getCupVariationInfo = (cupItem, index = 0) => {
	const name = String(cupItem?.item || "").trim();
	const ozMatch = name.match(/(\d+(?:\.\d+)?)\s*oz/i);
	const oz = ozMatch ? `${ozMatch[1]}oz` : "";
	const lower = name.toLowerCase();
	let tier;
	let factor;
	if (oz === "8oz" || lower.includes("8oz")) {
		tier = "Small";
		factor = 1.0;
	} else if (oz === "12oz" || lower.includes("12oz")) {
		tier = "Large";
		factor = 1.35;
	} else if (lower.includes("regular") || lower.includes("small") || oz === "16oz") {
		tier = "Regular";
		factor = 1.0;
	} else if (lower.includes("medium") || oz === "18oz" || oz === "20oz") {
		tier = "Medium";
		factor = 1.25;
	} else if (lower.includes("large") || oz === "22oz") {
		tier = "Large";
		factor = 1.5;
	} else if (lower.includes("xl") || oz === "24oz") {
		tier = "Extra Large";
		factor = 1.75;
	} else {
		tier = name.replace(/cup/i, "").replace(/[()]/g, "").trim() || `Size ${index + 1}`;
		factor = Number((1.0 + index * 0.25).toFixed(2));
	}
	const label = oz ? `${tier} (${oz})` : (tier || name);
	return { label, factor, cupItem };
};

const getSizeScaleFactor = (label = "", index = 0) => {
	const clean = String(label || "").toLowerCase().trim();
	if (clean.includes("24oz") || clean.includes("xl") || clean.includes("extra large")) return 1.75;
	if (clean.includes("22oz")) return 1.5;
	if (clean.includes("12oz")) return 1.35;
	if (clean.includes("large") || clean.includes("venti")) return 1.35;
	if (clean.includes("medium") || clean.includes("18oz") || clean.includes("20oz") || clean.includes("grande")) return 1.25;
	if (clean.includes("regular") || clean.includes("16oz") || clean.includes("small") || clean.includes("8oz") || clean.includes("tall")) return 1.0;
	if (clean.includes("party") || clean.includes("12 pcs") || clean.includes("jumbo")) return 2.2;
	if (clean.includes("sharing") || clean.includes("6 pcs")) return 1.5;
	if (clean.includes("solo") || clean.includes("4 pcs")) return 1.0;
	if (index === 0) return 1.0;
	if (index === 1) return 1.25;
	if (index === 2) return 1.5;
	return Number((1.0 + index * 0.25).toFixed(2));
};

const scaleIngredientAmount = (baseQty, factor, unit) => {
	const numQty = Number(baseQty);
	if (!Number.isFinite(numQty) || numQty <= 0) return "";
	const unitDef = unitFactors.get(String(unit || "").toLowerCase());
	if (unitDef?.dimension === "count" || ["pcs", "pc", "piece", "pieces", "ea", "each", "unit", "units", "cup", "cups"].includes(String(unit || "").toLowerCase())) {
		return String(numQty);
	}
	const scaled = Number((numQty * factor).toFixed(2));
	return String(scaled);
};

// Volume key (oz) for a cup name or size label, e.g. "22oz Cup (Large)" / "Large (22oz)" -> 22. null = unknown.
const cupSizeKey = (text) => {
	const value = String(text || "").toLowerCase();
	const oz = value.match(/(\d+(?:\.\d+)?)\s*oz/);
	if (oz) return Number(oz[1]);
	if (/\b(xl|extra large)\b/.test(value)) return 24;
	if (/\blarge\b/.test(value)) return 12;
	if (/\bmedium\b/.test(value)) return 18;
	if (/\b(small|regular)\b/.test(value)) return 8;
	return null;
};
// Mirrors the backend guard in api/src/routes/menu.js: a cup only belongs to the size with the same volume.
const cupMatchesSize = (cupName, sizeLabel) => {
	const cup = cupSizeKey(cupName);
	const size = cupSizeKey(sizeLabel);
	return cup == null || size == null || cup === size;
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
	const { products, menuError, addProduct, updateProduct, deleteProduct } = useMenu();
	const { inventory = [], refreshInventory } = useInventory() || {};
	const cupInventoryItems = useMemo(() => {
		return (inventory || [])
			.filter((item) => (item.category === "Cups & Lids" || item.category === "Cups" || String(item.item || "").toLowerCase().includes("cup")) && !item.isArchived)
			.sort((a, b) => {
				const ozA = Number(String(a.item).match(/(\d+(?:\.\d+)?)\s*oz/i)?.[1] || 999);
				const ozB = Number(String(b.item).match(/(\d+(?:\.\d+)?)\s*oz/i)?.[1] || 999);
				return ozA - ozB || a.item.localeCompare(b.item);
			});
	}, [inventory]);
	const { sidebarCollapsed, toggleSidebar } = useSidebar();
	const [categories, setCategories] = useState(["All items", ...DEFAULT_MENU_CATEGORIES]);
	const [activeCategory, setActiveCategory] = useState("All items");
	const [search, setSearch] = useState("");
	const [sortBy, setSortBy] = useState("popular");
	const [currentPage, setCurrentPage] = useState(1);
	const [showForm, setShowForm] = useState(false);
	const [editingProduct, setEditingProduct] = useState(null);
	const [itemToDelete, setItemToDelete] = useState(null);
	const emptyForm = () => ({ name: "", price: "", stock: "", description: "", category: "Foods / Snacks", image: "", sizes: [], ingredients: [], addons: [], available: true });

	useEffect(() => {
		let isMounted = true;
		apiRequest("/menu/categories")
			.then((data) => {
				if (!isMounted || !Array.isArray(data) || !data.length) return;
				const categoryNames = data.map((cat) => (typeof cat === "string" ? cat : cat.name)).filter(Boolean);
				if (categoryNames.length) {
					setCategories(["All items", ...categoryNames]);
				}
			})
			.catch((err) => {
				console.warn("Failed to fetch menu categories:", err);
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
		const name = String(ing?.name || "").trim().toLowerCase();
		const invItem = inventory.find((entry) => Number(entry.id) === Number(ing?.inventoryItemId) || entry.item.toLowerCase() === name);
		return invItem?.category === "Cups & Lids" || invItem?.category === "Cups" || name.includes("cup");
	};

	// Per-size amount: cups are 1 only on their matching size (never cloned), everything else scales.
	const amountForSize = (ing, sizeLabel, factor) => {
		if (isCupIngredient(ing)) return cupMatchesSize(ing.name, sizeLabel) ? "1" : "0";
		return scaleIngredientAmount(ing.quantityUsed, factor, ing.unit);
	};

	const calculateCostForFactor = (factor, ingredients = formValues.ingredients) => {
		let rawCost = 0;
		for (const ing of ingredients) {
			const invItem = inventory.find((entry) => entry.item.toLowerCase() === String(ing.name || "").trim().toLowerCase());
			const unitCost = Number(invItem?.unitCost ?? invItem?.unit_cost ?? ing.unitCost ?? 0);
			const stockUnit = invItem?.unit || ing.stockUnit || ing.unit || "pcs";
			const recipeUnit = ing.unit || stockUnit;
			const scaledQty = Number(scaleIngredientAmount(ing.quantityUsed, factor, recipeUnit));
			const stockQty = convertRecipeAmount(scaledQty, recipeUnit, stockUnit);
			if (stockQty && unitCost > 0) {
				rawCost += stockQty * unitCost;
			}
		}
		return Number(rawCost.toFixed(2));
	};

	const addVariation = () => {
		const family = getCategoryFamily(formValues.category);
		const presets = VARIATION_PRESETS[family] || STANDARD_SIZES;
		const existingLabels = formValues.sizes.map((s) => String(s.label || "").toLowerCase());
		const nextStandard = presets.find((std) => !existingLabels.some((lbl) => lbl.includes(std.label.toLowerCase().slice(0, 5))))
			|| { label: `Size ${formValues.sizes.length + 1}`, factor: Number((1.0 + formValues.sizes.length * 0.25).toFixed(2)) };

		const newIndex = formValues.sizes.length;
		const factor = nextStandard.factor || getSizeScaleFactor(nextStandard.label, newIndex);
		const basePrice = Number(formValues.price) > 0 ? Number(formValues.price) : 40;
		const baseCost = calculateCostForFactor(1.0);
		const sizeCost = calculateCostForFactor(factor);
		const price = computeInventoryBasedSizePrice(sizeCost, baseCost, basePrice, factor, newIndex);

		setFormValues((current) => {
			const newSizes = [...current.sizes, { label: nextStandard.label, price }];
			const updatedIngredients = current.ingredients.map((ing) => {
				const qMap = { ...(ing.quantityBySize || {}) };
				qMap[nextStandard.label] = amountForSize(ing, nextStandard.label, factor);
				return { ...ing, quantityBySize: qMap };
			});
			return { ...current, sizes: newSizes, ingredients: updatedIngredients };
		});
		setEditingSizeIndex(newIndex);
	};

	const handleApplyVariationPreset = (presetList) => {
		const basePrice = Number(formValues.price) > 0 ? Number(formValues.price) : 40;
		const baseCost = calculateCostForFactor(1.0);

		const newSizes = presetList.map((preset, index) => {
			const sizeCost = calculateCostForFactor(preset.factor);
			const price = computeInventoryBasedSizePrice(sizeCost, baseCost, basePrice, preset.factor, index);
			return {
				label: preset.label,
				price,
			};
		});

		const updatedIngredients = formValues.ingredients.map((ing) => {
			const qMap = { ...(ing.quantityBySize || {}) };
			presetList.forEach((preset) => {
				qMap[preset.label] = amountForSize(ing, preset.label, preset.factor);
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
			ingredients: current.ingredients.map((ing) => ({
				...ing,
				quantityBySize: {},
			})),
		}));
		setEditingSizeIndex(null);
	};

	const handleAutoSetStandardSizes = () => {
		const basePrice = Number(formValues.price) > 0 ? Number(formValues.price) : 40;
		const baseCost = calculateCostForFactor(1.0);

		const newSizes = STANDARD_SIZES.map((std, index) => {
			const sizeCost = calculateCostForFactor(std.factor);
			const price = computeInventoryBasedSizePrice(sizeCost, baseCost, basePrice, std.factor, index);
			return {
				label: std.label,
				price,
			};
		});

		const updatedIngredients = formValues.ingredients.map((ing) => {
			const qMap = { ...(ing.quantityBySize || {}) };
			STANDARD_SIZES.forEach((std) => {
				qMap[std.label] = amountForSize(ing, std.label, std.factor);
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

	const handleAutoSetFromCups = () => {
		const cupsToUse = cupInventoryItems.length ? cupInventoryItems : null;
		if (!cupsToUse || cupsToUse.length === 0) {
			handleAutoSetStandardSizes();
			return;
		}

		const basePrice = Number(formValues.price) > 0 ? Number(formValues.price) : 40;
		const baseCost = calculateCostForFactor(1.0);

		const newSizes = cupsToUse.map((cup, index) => {
			const info = getCupVariationInfo(cup, index);
			const sizeCost = calculateCostForFactor(info.factor);
			const price = computeInventoryBasedSizePrice(sizeCost, baseCost, basePrice, info.factor, index);
			return {
				label: info.label,
				price,
			};
		});

		// Separate non-cup ingredients from cup ingredients
		const nonCupIngredients = formValues.ingredients.filter((ing) => {
			const invItem = inventory.find((entry) => entry.item.toLowerCase() === String(ing.name || "").trim().toLowerCase());
			return !(invItem?.category === "Cups & Lids" || invItem?.category === "Cups" || String(ing.name || "").toLowerCase().includes("cup"));
		});

		// Scale non-cup ingredients across sizes
		const scaledNonCupIngredients = nonCupIngredients.map((ing) => {
			const qMap = {};
			cupsToUse.forEach((cup, idx) => {
				const info = getCupVariationInfo(cup, idx);
				qMap[info.label] = scaleIngredientAmount(ing.quantityUsed, info.factor, ing.unit);
			});
			return { ...ing, quantityBySize: qMap };
		});

		// For each cup in cupsToUse, create an ingredient with quantity 1 for that size and 0 for others
		const cupIngredients = cupsToUse.map((cup, cupIdx) => {
			const qMap = {};
			cupsToUse.forEach((otherCup, otherIdx) => {
				const otherInfo = getCupVariationInfo(otherCup, otherIdx);
				qMap[otherInfo.label] = cupIdx === otherIdx ? "1" : "0";
			});
			return {
				inventoryItemId: cup.id,
				name: cup.item,
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
		const info = getCupVariationInfo(cup, formValues.sizes.length);
		const existingLabels = formValues.sizes.map((s) => String(s.label || "").toLowerCase());
		if (existingLabels.includes(info.label.toLowerCase())) {
			return;
		}

		const newIndex = formValues.sizes.length;
		const factor = info.factor;
		const basePrice = Number(formValues.price) > 0 ? Number(formValues.price) : 40;
		const baseCost = calculateCostForFactor(1.0);
		const sizeCost = calculateCostForFactor(factor);
		const price = computeInventoryBasedSizePrice(sizeCost, baseCost, basePrice, factor, newIndex);

		setFormValues((current) => {
			const newSizes = [...current.sizes, { label: info.label, price }];
			let hasThisCup = false;

			const updatedIngredients = current.ingredients.map((ing) => {
				const invItem = inventory.find((entry) => entry.item.toLowerCase() === String(ing.name || "").trim().toLowerCase());
				const isCup = invItem?.category === "Cups & Lids" || invItem?.category === "Cups" || String(ing.name || "").toLowerCase().includes("cup");
				const isThisCup = (invItem && invItem.id === cup.id) || String(ing.name || "").toLowerCase() === cup.item.toLowerCase();
				if (isThisCup) hasThisCup = true;

				const qMap = { ...(ing.quantityBySize || {}) };
				if (isCup) {
					qMap[info.label] = isThisCup ? "1" : "0";
				} else {
					qMap[info.label] = scaleIngredientAmount(ing.quantityUsed, factor, ing.unit);
				}
				return { ...ing, quantityBySize: qMap };
			});

			if (!hasThisCup) {
				const qMap = {};
				newSizes.forEach((s) => {
					qMap[s.label] = s.label.toLowerCase() === info.label.toLowerCase() ? "1" : "0";
				});
				updatedIngredients.push({
					inventoryItemId: cup.id,
					name: cup.item,
					unit: cup.unit || "pcs",
					stockUnit: cup.unit || "pcs",
					quantityUsed: current.sizes.length === 0 ? "1" : "0",
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
			const factor = getSizeScaleFactor(newLabel, index);
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
		const existingItem = inventory.find((entry) => entry.item.toLowerCase() === name.toLowerCase());
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
		if (formValues.ingredients.some((entry) => String(entry.name || entry.item || "").trim().toLowerCase() === name.toLowerCase())) {
			setRecipeError("That ingredient is already in this recipe.");
			return;
		}
		setFormValues((current) => ({
			...current,
			ingredients: [...current.ingredients, {
				name,
				quantityUsed,
				unit,
				stockUnit,
				quantityBySize: Object.fromEntries(
					current.sizes.map((size, idx) => [
						size.label,
						amountForSize({ name, quantityUsed, unit }, size.label, getSizeScaleFactor(size.label, idx)),
					])
				),
			}],
		}));
		setIngredientDraft({ name: "", quantityUsed: "", unit: "pcs", stockUnit: "pcs" });
		setRecipeError("");
	};

	const addAddon = () => {
		const label = addonDraft.label.trim();
		const existingItem = inventory.find((entry) => entry.item.toLowerCase() === label.toLowerCase());
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
		if (formValues.addons.some((entry) => entry.label.trim().toLowerCase() === label.toLowerCase())) {
			setRecipeError("That add-on is already listed for this menu item.");
			return;
		}
		setFormValues((current) => ({ ...current, addons: [...current.addons, { label, price, quantityUsed, unit, stockUnit }] }));
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
		const query = search.toLowerCase().trim();
		const filtered = products.filter((product) => {
			const categoryMatches = activeCategory === "All items" || product.category === activeCategory;
			const searchMatches = !query || `${product.name} ${product.category}`.toLowerCase().includes(query);
			return categoryMatches && searchMatches;
		});
		return [...filtered].sort((left, right) => {
			if (sortBy === "name") return left.name.localeCompare(right.name);
			const leftPrice = Number(String(left.price || "").replace(/[^0-9.]/g, "")) || 0;
			const rightPrice = Number(String(right.price || "").replace(/[^0-9.]/g, "")) || 0;
			if (sortBy === "price") return leftPrice - rightPrice || left.name.localeCompare(right.name);
			return Number(right.featured) - Number(left.featured) || left.name.localeCompare(right.name);
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
		setEditingProduct(product);
		setEditingSizeIndex(null);
		setFormValues({
			name: product.name,
			price: String(product.price || "").replace(/[^0-9.]/g, ""),
			stock: product.stock != null ? String(product.stock) : "",
			description: product.description,
			category: product.category,
			image: product.image,
			// A size priced at the base price round-trips as a bare label.
			sizes: (product.sizes || []).map((size) => ({ label: size.label, price: String(size.price) })),
			// Default recipe plus any ingredient that only some sizes use (e.g. a size-specific cup).
			ingredients: [
				...(product.ingredients || []),
				...(product.sizes || []).flatMap((size) => size.ingredients || []).filter((entry, index, all) =>
					typeof entry !== "string"
					&& !(product.ingredients || []).some((base) => Number(base.inventoryItemId) === Number(entry.inventoryItemId))
					&& all.findIndex((other) => Number(other.inventoryItemId) === Number(entry.inventoryItemId)) === index),
			].map((ingredient) => {
				if (typeof ingredient === "string") {
					const inventoryItem = inventory.find((entry) => entry.item.toLowerCase() === ingredient.toLowerCase());
				return { name: inventoryItem?.item || ingredient, unit: inventoryItem?.unit || "pcs", stockUnit: inventoryItem?.unit || "pcs", quantityUsed: "", quantityBySize: {} };
				}
				const inventoryItem = inventory.find((entry) => entry.id === Number(ingredient.inventoryItemId));
				const quantityBySize = Object.fromEntries((product.sizes || []).map((size) => {
					const sizedIngredient = size.ingredients?.find((entry) => Number(entry.inventoryItemId) === Number(ingredient.inventoryItemId));
					return [size.label, sizedIngredient ? String(sizedIngredient.quantityUsed) : "0"];
				}));
				return { ...ingredient, name: ingredient.name || inventoryItem?.item || "", unit: ingredient.unit || inventoryItem?.unit || "pcs", stockUnit: ingredient.stockUnit || inventoryItem?.unit || ingredient.unit || "pcs", quantityUsed: ingredient.quantityUsed == null ? "" : String(ingredient.quantityUsed), quantityBySize };
			}),
			addons: (product.addons || []).map((addon) => {
				const inventoryItem = inventory.find((entry) => Number(entry.id) === Number(addon.inventoryItemId) || entry.item.toLowerCase() === addon.label.toLowerCase());
				return { ...addon, quantityUsed: addon.quantityUsed == null ? 1 : addon.quantityUsed, unit: addon.unit || inventoryItem?.unit || "pcs", stockUnit: addon.stockUnit || inventoryItem?.unit || addon.unit || "pcs" };
			}),
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
		const explicit = ing.quantityBySize?.[label];
		// A cup with no explicit amount for this size only falls back to its base amount on its matching size.
		const fallback = isCupIngredient(ing) && !cupMatchesSize(ing.name, label) ? 0 : ing.quantityUsed;
		const raw = explicit ?? fallback;
		const amount = Number(raw);
		return raw !== "" && raw != null && Number.isFinite(amount) && amount > 0 ? amount : 0;
	};

	const saveProduct = async (event) => {
		event.preventDefault();
		const name = formValues.name.trim();
		const description = formValues.description.trim();
		const numericPrice = Number(formValues.price);

		if (!name || !description || !Number.isFinite(numericPrice) || numericPrice < 0) return;

		// Clean and validate variation sizes
		const cleanSizes = formValues.sizes
			.map((s) => ({ label: String(s.label || "").trim(), price: s.price }))
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
			const lowerLabels = cleanSizes.map((s) => s.label.toLowerCase());
			if (new Set(lowerLabels).size !== lowerLabels.length) {
				setRecipeError("Each variation must have a unique name.");
				return;
				}
		}

		const finalSizes = cleanSizes.length
			? cleanSizes.map((size) => ({
					label: size.label,
					price: Number(size.price),
					ingredients: formValues.ingredients
						.map((ingredient) => ({
							...(ingredient.inventoryItemId ? { inventoryItemId: Number(ingredient.inventoryItemId) } : {}),
							name: String(ingredient.name || "").trim(),
							quantityUsed: sizeQty(ingredient, size.label),
							unit: ingredient.unit || "pcs",
							stockUnit: ingredient.stockUnit || ingredient.unit || "pcs",
						}))
						.filter((ingredient) => ingredient.quantityUsed > 0),
				}))
			: [{
					label: "Regular",
					price: numericPrice,
					ingredients: (formValues.ingredients || [])
						.map((ing) => ({
							...(ing.inventoryItemId ? { inventoryItemId: Number(ing.inventoryItemId) } : {}),
							name: String(ing.name || "").trim(),
							quantityUsed: Number(ing.quantityUsed ?? ing.quantityBySize?.Regular ?? 0),
							unit: ing.unit || "pcs",
							stockUnit: ing.stockUnit || ing.unit || "pcs",
						}))
						.filter((ing) => (ing.inventoryItemId || ing.name) && ing.quantityUsed > 0),
				}];

		if (finalSizes.some((size) => !Number.isFinite(size.price) || size.price < 0)) {
			setRecipeError("Enter a valid price for every serving size.");
			return;
		}
		const emptySize = formValues.ingredients.length > 0 ? finalSizes.find((size) => !size.ingredients.length) : null;
		if (emptySize) {
			setRecipeError(`The ${emptySize.label} size has no ingredients. Enter an amount above 0 for at least one ingredient.`);
			return;
		}

		for (const addon of formValues.addons || []) {
			const addonLabel = String(addon.label || "").trim();
			const addonPrice = Number(addon.price);
			const addonQty = Number(addon.quantityUsed);
			const matchedInv = addon.inventoryItemId
				? inventory.find((entry) => Number(entry.id) === Number(addon.inventoryItemId))
				: inventory.find((entry) => entry.item.toLowerCase() === addonLabel.toLowerCase());
			const addonUnit = String(addon.unit || matchedInv?.unit || "pcs").trim();
			const addonStockUnit = String(matchedInv?.unit || addon.stockUnit || addonUnit || "pcs").trim();

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

		const productBasePrice = finalSizes.find((size) => size.label.trim().toLowerCase() === "regular")?.price ?? finalSizes[0]?.price ?? numericPrice;
		const cleanStock = formValues.stock !== "" && !Number.isNaN(Number(formValues.stock))
			? Math.max(0, parseInt(formValues.stock, 10))
			: 0;

		const productData = {
			name,
			price: `₱${productBasePrice.toFixed(2)}`,
			description,
			category: formValues.category,
			image: formValues.image || "",
			available: formValues.available !== false,
			sizes: finalSizes,
			// Default recipe = the first size's recipe; every size also sends its own list.
			ingredients: finalSizes[0].ingredients,
			addons: formValues.addons.map((addon) => ({ ...addon, price: Number(addon.price), quantityUsed: Number(addon.quantityUsed), unit: addon.unit || "pcs", stockUnit: addon.stockUnit || addon.unit || "pcs" })),
		};

		try {
			if (editingProduct) await updateProduct(editingProduct.id, { ...productData, stock: cleanStock });
			else await addProduct({ ...productData, stock: cleanStock, available: formValues.available !== false, featured: false });
			await refreshInventory?.().catch(() => null);
			setSyncNotice(`${name} saved. New ingredients and add-ons were added to Inventory at zero stock; matching names reuse the existing stock item.`);
			closeForm();
		} catch (error) {
			setRecipeError(error.message);
			window.alert(error.message);
		}
	};

	const availableCount = products.filter((product) => product.available).length;
	const lowStockCount = products.filter((product) => product.stock > 0 && product.stock <= 7).length;
	const recipeDraftItem = inventory.find((entry) => entry.item.toLowerCase() === ingredientDraft.name.trim().toLowerCase());

	const computeSizeCosting = (sizeLabel, rawSizePrice) => {
		const numericPrice = rawSizePrice !== "" && rawSizePrice !== null && rawSizePrice !== undefined && !Number.isNaN(Number(rawSizePrice))
			? Number(rawSizePrice)
			: (Number(formValues.price) || 0);
		let rawCost = 0;
		let costComplete = formValues.ingredients.length > 0;
		for (const ing of formValues.ingredients) {
			const invItem = inventory.find((entry) => entry.item.toLowerCase() === String(ing.name || "").trim().toLowerCase());
			const unitCost = Number(invItem?.unitCost ?? invItem?.unit_cost ?? ing.unitCost ?? 0);
			const stockUnit = invItem?.unit || ing.stockUnit || ing.unit || "pcs";
			const recipeUnit = ing.unit || stockUnit;
			const rawSizeQty = sizeLabel ? ing.quantityBySize?.[sizeLabel] : undefined;
			if (rawSizeQty !== undefined && !(Number(rawSizeQty) > 0)) continue; // unused in this size
			const factor = sizeLabel ? getSizeScaleFactor(sizeLabel) : 1.0;
			const qtyUsed = Number(sizeLabel ? (ing.quantityBySize?.[sizeLabel] ?? scaleIngredientAmount(ing.quantityUsed, factor, recipeUnit)) : ing.quantityUsed);
			const stockQty = convertRecipeAmount(qtyUsed, recipeUnit, stockUnit);
			if (!stockQty || !(unitCost > 0)) {
				costComplete = false;
			} else {
				rawCost += stockQty * unitCost;
			}
		}
		const cost = Number(rawCost.toFixed(2));
		const grossProfit = numericPrice > 0 ? Number((numericPrice - cost).toFixed(2)) : null;
		const margin = numericPrice > 0 ? Number((((numericPrice - cost) / numericPrice) * 100).toFixed(1)) : null;
		const foodCostPercent = numericPrice > 0 ? Number(((cost / numericPrice) * 100).toFixed(1)) : null;
		const suggestedPrice = rawCost > 0 ? Math.ceil((rawCost / 0.30) / 5) * 5 : null;
		return { cost, costComplete, grossProfit, margin, foodCostPercent, suggestedPrice };
	};

	const applySuggestedSizePrice = (index, suggestedPrice) => {
		if (suggestedPrice == null) return;
		const nextPrice = String(suggestedPrice);
		setFormValues((current) => {
			const targetLabel = String(current.sizes[index]?.label || "").toLowerCase();
			const shouldUpdateBase = index === 0 || targetLabel.includes("regular");
			return {
				...current,
				price: shouldUpdateBase ? nextPrice : current.price,
				sizes: current.sizes.map((s, i) => (i === index ? { ...s, price: nextPrice } : s)),
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
													COGS ₱{Number(product.cost).toFixed(2)}{product.margin != null ? ` · ${Number(product.margin).toFixed(1)}% margin` : ""}
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
											>
												{categories
													.filter((category) => category !== "All items")
													.map((category) => (
														<option key={category} value={category}>{category}</option>
													))}
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
											{getCategoryFamily(formValues.category) === "drink" && (
												<button
													type="button"
													className="menu-builder-auto-size-btn"
													onClick={cupInventoryItems.length ? handleAutoSetFromCups : handleAutoSetStandardSizes}
													title={cupInventoryItems.length ? `Auto-detect ${cupInventoryItems.length} cups in inventory and configure size variations with 1-per-size stock deduction` : "Auto-generate Regular (16oz), Medium (18oz), and Large (22oz) with scaled recipes & prices"}
												>
													<Sparkles size={13} strokeWidth={2.2} /> {cupInventoryItems.length ? `Auto-set from Cups & Lids (${cupInventoryItems.length})` : "Standard R / M / L"}
												</button>
											)}

											{getCategoryFamily(formValues.category) === "fries" && (
												<button
													type="button"
													className="menu-builder-auto-size-btn"
													onClick={() => handleApplyVariationPreset(VARIATION_PRESETS.fries)}
													title="Auto-generate Regular, Large, and Jumbo / Party portions"
												>
													<Sparkles size={13} strokeWidth={2.2} /> Auto-set Portion Sizes (R/L/Jumbo)
												</button>
											)}

											{getCategoryFamily(formValues.category) === "snack_pieces" && (
												<button
													type="button"
													className="menu-builder-auto-size-btn"
													onClick={() => handleApplyVariationPreset(VARIATION_PRESETS.snack_pieces)}
													title="Auto-generate 4 pcs (Solo), 6 pcs (Sharing), and 12 pcs (Party)"
												>
													<Sparkles size={13} strokeWidth={2.2} /> Auto-set Piece Counts (4/6/12s)
												</button>
											)}

											{getCategoryFamily(formValues.category) === "single_fixed" && formValues.sizes.length > 0 && (
												<button
													type="button"
													className="menu-builder-auto-size-btn"
													onClick={handleClearVariations}
													title="Clear all variations to sell at the single base price"
												>
													<Archive size={13} strokeWidth={2.2} /> Clear Variations (Single Price)
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
												<span>Fixed Price Item: No size variations needed. Base price (₱{Number(formValues.price || 0).toFixed(2)}) is the customer price. Click &ldquo;+ Add Variation&rdquo; only if offering special sizes or combo portions.</span>
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
												{cupInventoryItems.map((cup, idx) => {
													const info = getCupVariationInfo(cup, idx);
													const isAdded = formValues.sizes.some((s) => s.label.toLowerCase() === info.label.toLowerCase());
													return (
														<button
															key={cup.id}
															type="button"
															className={`menu-cup-chip ${isAdded ? "is-added" : ""}`}
															onClick={() => addSingleCupVariation(cup)}
															title={isAdded ? `${info.label} is already in the variations list` : `Click to add ${info.label} variation (${cup.quantity} pcs in stock)`}
														>
															<span className="cup-chip-label">{info.label}</span>
															<span className="cup-chip-name">{cup.item}</span>
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
												const sizeCosting = computeSizeCosting(size.label, size.price);
												const factor = getSizeScaleFactor(size.label, index);
												const recipeSummary = formValues.ingredients
													.map((ing) => {
														const rawQty = ing.quantityBySize?.[size.label];
																		if (rawQty !== undefined && !(Number(rawQty) > 0)) return "";
																		const qty = rawQty ?? scaleIngredientAmount(ing.quantityUsed, factor, ing.unit);
														return `${qty}${ing.unit || ""} ${ing.name}`.trim();
													})
													.filter(Boolean)
													.join(", ");
												const marginTone = sizeCosting.margin == null
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
																	value={size.label}
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
																		value={size.price ?? ""}
																		placeholder={formValues.price || "0.00"}
																		onChange={(e) => updateSizePrice(index, e.target.value)}
																		onKeyDown={(e) => {
																			if (e.key === "Enter") {
																				e.preventDefault();
																				setEditingSizeIndex(null);
																			}
																		}}
																		aria-label={`${size.label || "Variation"} price`}
																	/>
																</div>
															</div>
														) : (
															<div className="size-row-display-content">
																<button
																	type="button"
																	className="size-name-btn"
																	onClick={() => setEditingSizeIndex(index)}
																	title="Click to edit variation name"
																>
																	<strong className={size.label.trim() ? "" : "empty-placeholder"}>
																		{size.label.trim() ? size.label : "Untitled Variation"}
																	</strong>
																</button>
																<div
																	className="size-price-display"
																	onClick={() => setEditingSizeIndex(index)}
																	title="Click to edit price"
																>
																	<span className="price-caption">Serving price</span>
																	<strong className="price-tag">
																		₱{size.price !== "" && !isNaN(Number(size.price)) ? Number(size.price).toFixed(2) : formValues.price ? Number(formValues.price).toFixed(2) : "0.00"}
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
															aria-label={`Remove ${size.label || "variation"}`}
															title="Remove variation"
														>
															×
														</button>

														<div className="size-costing-strip">
															{formValues.ingredients.length === 0 ? (
																<span className="size-costing-note">Add recipe ingredients below to calculate COGS &amp; suggested price</span>
															) : (
																<>
																	<span className="size-recipe-pill" title={`${factor}x Recipe (${recipeSummary})`}>
																		<Beaker size={11} strokeWidth={2} />
																		{factor}x Recipe{recipeSummary ? ` (${recipeSummary})` : ""}
																	</span>
																	<span>COGS <strong>₱{sizeCosting.cost.toFixed(2)}</strong></span>
																	<span>·</span>
																	<span>Profit <strong>₱{(sizeCosting.grossProfit ?? 0).toFixed(2)}</strong></span>
																	<span className={`size-margin-badge ${marginTone}`}>
																		Margin {sizeCosting.margin != null ? `${sizeCosting.margin.toFixed(1)}%` : "—"}
																	</span>
																	{sizeCosting.suggestedPrice != null && (
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
																	{!sizeCosting.costComplete && (
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
											{cupInventoryItems.length > 0 && (
												<div className="empty-variations-cups-actions">
													<button
														type="button"
														className="empty-variations-all-cups-btn"
														onClick={handleAutoSetFromCups}
													>
														<Sparkles size={13} strokeWidth={2.2} /> Auto-Generate All {cupInventoryItems.length} Cup Sizes ({cupInventoryItems.map((c) => getCupVariationInfo(c).label).join(", ")})
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
					<p className="menu-recipe-help">Set the amount used for one serving. Choose recipe and stock units from the same group: weight, volume, or count. Compatible units convert automatically (for example, 5 g to kg); weight and volume cannot mix without a density conversion. New ingredients start at zero stock.</p>
					<div className="menu-recipe-entry menu-conversion-entry">
						<input list="menu-inventory-items" value={ingredientDraft.name} onChange={(event) => { const name = event.target.value; const existing = inventory.find((entry) => entry.item.toLowerCase() === name.trim().toLowerCase()); setIngredientDraft((current) => ({ ...current, name, stockUnit: existing?.unit || current.stockUnit, unit: existing?.unit || current.unit })); setRecipeError(""); }} aria-label="Ingredient name" placeholder="Ingredient name" />
						<label className="menu-recipe-field"><span>Amount per serving</span><input type="number" min="0.000001" step="0.000001" value={ingredientDraft.quantityUsed} onChange={(event) => { setIngredientDraft((current) => ({ ...current, quantityUsed: event.target.value })); setRecipeError(""); }} aria-label="Amount used per serving" placeholder="e.g. 5" /></label>
						<label className="menu-recipe-field"><span>Recipe unit</span><UnitSelect value={ingredientDraft.unit} compatibleWith={recipeDraftItem?.unit || ingredientDraft.stockUnit} onChange={(unit) => { setIngredientDraft((current) => ({ ...current, unit })); setRecipeError(""); }} ariaLabel="Ingredient recipe unit" /></label>
						<label className="menu-recipe-field"><span>Stock unit</span><UnitSelect value={recipeDraftItem?.unit || ingredientDraft.stockUnit} disabled={Boolean(recipeDraftItem)} onChange={(stockUnit) => { setIngredientDraft((current) => ({ ...current, stockUnit, unit: current.unit === current.stockUnit ? stockUnit : current.unit })); setRecipeError(""); }} ariaLabel="Ingredient stock unit" /></label>
						<button type="button" onClick={addRecipeIngredient} disabled={!ingredientDraft.name.trim() || !ingredientDraft.quantityUsed}>
							<Plus size={14} strokeWidth={2.4} /> Add ingredient
						</button>
					</div>
					{convertRecipeAmount(ingredientDraft.quantityUsed, ingredientDraft.unit, recipeDraftItem?.unit || ingredientDraft.stockUnit) != null && <p className="menu-recipe-help">Uses {convertRecipeAmount(ingredientDraft.quantityUsed, ingredientDraft.unit, recipeDraftItem?.unit || ingredientDraft.stockUnit).toLocaleString(undefined, { maximumFractionDigits: 6 })} {recipeDraftItem?.unit || ingredientDraft.stockUnit} from inventory per serving.</p>}
					{inventory.some((entry) => entry.item.toLowerCase() === ingredientDraft.name.trim().toLowerCase() && amountAttachedToUnit(entry.unit)) && <p className="menu-recipe-error" role="alert">This inventory item has an amount inside its unit. Edit it in Inventory so its quantity and unit are separate (for example, quantity 5 and unit kg).</p>}
					<datalist id="menu-inventory-items">{inventory.map((entry) => <option key={entry.id} value={entry.item}>{entry.quantity} {entry.unit} in stock</option>)}</datalist>
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
								const inventoryItem = inventory.find((entry) => entry.item.toLowerCase() === String(ingredient.name || "").toLowerCase());
								const ingredientName = inventoryItem?.item || ingredient.name || "Missing inventory item";
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
						<input list="menu-inventory-items" value={addonDraft.label} onChange={(event) => { const label = event.target.value; const existing = inventory.find((entry) => entry.item.toLowerCase() === label.trim().toLowerCase()); setAddonDraft((current) => ({ ...current, label, stockUnit: existing?.unit || current.stockUnit, unit: existing?.unit || current.unit })); setRecipeError(""); }} aria-label="Add-on inventory name" placeholder="Add-on name" />
						<input type="number" min="0" step="0.01" value={addonDraft.price} onChange={(event) => setAddonDraft((current) => ({ ...current, price: event.target.value }))} aria-label="Add-on price" placeholder="Price" />
						<label className="menu-recipe-field"><span>Amount / serving</span><input type="number" min="0.000001" step="0.000001" value={addonDraft.quantityUsed} onChange={(event) => setAddonDraft((current) => ({ ...current, quantityUsed: event.target.value }))} aria-label="Add-on amount used per serving" placeholder="e.g. 5" /></label>
						<label className="menu-recipe-field"><span>Recipe unit</span><UnitSelect value={addonDraft.unit} compatibleWith={inventory.find((entry) => entry.item.toLowerCase() === addonDraft.label.trim().toLowerCase())?.unit || addonDraft.stockUnit} onChange={(unit) => setAddonDraft((current) => ({ ...current, unit }))} ariaLabel="Add-on recipe unit" /></label>
						<label className="menu-recipe-field"><span>Stock unit</span><UnitSelect value={inventory.find((entry) => entry.item.toLowerCase() === addonDraft.label.trim().toLowerCase())?.unit || addonDraft.stockUnit} disabled={Boolean(inventory.find((entry) => entry.item.toLowerCase() === addonDraft.label.trim().toLowerCase()))} onChange={(stockUnit) => setAddonDraft((current) => ({ ...current, stockUnit, unit: current.unit === current.stockUnit ? stockUnit : current.unit }))} ariaLabel="Add-on stock unit" /></label>
						<button type="button" onClick={addAddon} disabled={!addonDraft.label.trim() || addonDraft.price === "" || !addonDraft.quantityUsed}>
							<Plus size={14} strokeWidth={2.4} /> Add
						</button>
					</div>
					{convertRecipeAmount(addonDraft.quantityUsed, addonDraft.unit, inventory.find((entry) => entry.item.toLowerCase() === addonDraft.label.trim().toLowerCase())?.unit || addonDraft.stockUnit) != null && <p className="menu-recipe-help">Uses {convertRecipeAmount(addonDraft.quantityUsed, addonDraft.unit, inventory.find((entry) => entry.item.toLowerCase() === addonDraft.label.trim().toLowerCase())?.unit || addonDraft.stockUnit).toLocaleString(undefined, { maximumFractionDigits: 6 })} {inventory.find((entry) => entry.item.toLowerCase() === addonDraft.label.trim().toLowerCase())?.unit || addonDraft.stockUnit} from inventory per serving.</p>}
					{inventory.some((entry) => entry.item.toLowerCase() === addonDraft.label.trim().toLowerCase() && amountAttachedToUnit(entry.unit)) && <p className="menu-recipe-error" role="alert">This inventory item has an amount inside its unit. Edit it in Inventory so its quantity and unit are separate (for example, quantity 5 and unit kg).</p>}

					{formValues.addons.length ? (
						<div className="menu-addon-list">
							{formValues.addons.map((addon, index) => {
								const addonInv = inventory.find((entry) => Number(entry.id) === Number(addon.inventoryItemId) || entry.item.toLowerCase() === addon.label.toLowerCase());
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
												COGS ₱{addonCost.toFixed(2)} · {addonMargin != null ? `${addonMargin.toFixed(1)}% margin` : "—"}
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
							<button type="submit" className="menu-builder-save">
								{editingProduct ? "Save Item" : "Add Item"}
							</button>
						</footer>
					</form>
				</div>
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
