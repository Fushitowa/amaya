import { useEffect, useMemo, useRef, useState } from "react";

import Sidebar from "../../components/Sidebar.jsx";
import PortalNotificationButton from "../../components/PortalNotificationButton.jsx";
import { AlertTriangle, Beaker, ClipboardList, FolderOpen, ImageOff, ImagePlus, List, Plus, Sparkles } from "lucide-react";
import adminAvatar from "../../assets/images/icon/admin1.svg";
import { useSidebar } from "../../context/useSidebar.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import { useInventory } from "../../context/InventoryContext.jsx";

import "../../assets/css/admin/AdminMenuManagement.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const categories = ["All items", "Milk Tea", "Drinks", "Snacks", "Desserts"];

const parseList = (raw) =>
  String(raw || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const parseSizes = (raw, fallbackPrice) =>
  (Array.isArray(raw) ? raw : parseList(raw))
    .map((entry) => {
      const [label, price] = typeof entry === "object" && entry !== null
        ? [entry.label, entry.price]
        : String(entry).split(":");
      const parsed = Number(price);
      return {
        label: (label || "").trim(),
        price: Number.isFinite(parsed) && String(price).trim() !== "" ? parsed : Number(fallbackPrice) || 0,
      };
    })
    .filter((entry) => entry.label && Number.isFinite(entry.price));

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

function AdminMenuManagement() {
	const { products, addProduct, updateProduct, deleteProduct } = useMenu();
	const { inventory = [], refreshInventory } = useInventory() || {};
	const { sidebarCollapsed, toggleSidebar } = useSidebar();
	const [activeCategory, setActiveCategory] = useState("All items");
	const [search, setSearch] = useState("");
	const [sortBy, setSortBy] = useState("popular");
	const [currentPage, setCurrentPage] = useState(1);
	const [showForm, setShowForm] = useState(false);
	const [editingProduct, setEditingProduct] = useState(null);
	const [itemToDelete, setItemToDelete] = useState(null);
	const emptyForm = () => ({ name: "", price: "", description: "", category: "Milk Tea", image: "", sizes: [{ label: "Regular", price: "" }], ingredients: [], addons: [], available: true });

	const [formValues, setFormValues] = useState(emptyForm());
	const [sizeInput, setSizeInput] = useState("");
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
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [itemToDelete, showForm]);

	const openAddForm = () => {
		setEditingProduct(null);
		setFormValues(emptyForm());
		setSizeInput("");
		setIngredientDraft({ name: "", quantityUsed: "", unit: "pcs", stockUnit: "pcs" });
		setRecipeError("");
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
		setImageError("");
		setShowForm(true);
	};

	const addSizes = (raw) => {
		const tags = parseList(raw);
		if (!tags.length) return;
		setFormValues((current) => {
			const merged = [...current.sizes];
			tags.forEach((tag) => {
				const [rawLabel, rawPrice] = tag.split(":");
				const label = rawLabel.trim();
				if (!label || merged.some((existing) => existing.label.toLowerCase() === label.toLowerCase())) return;
				merged.push({ label, price: rawPrice?.trim() || current.price || "" });
			});
			const ingredients = current.ingredients.map((ingredient) => ({
				...ingredient,
				quantityBySize: Object.fromEntries(merged.map((size) => [
					size.label,
					ingredient.quantityBySize?.[size.label] ?? ingredient.quantityUsed ?? "",
				])),
			}));
			return { ...current, sizes: merged, ingredients };
		});
		setSizeInput("");
	};

	const updateSize = (index, key, value) =>
		setFormValues((current) => ({
			...current,
			...(key === "price" && (current.sizes[index]?.label.toLowerCase() === "regular" || index === 0) ? { price: value } : {}),
			sizes: current.sizes.map((size, sizeIndex) => sizeIndex === index ? { ...size, [key]: value } : size),
		}));

	const updateBasePrice = (value) =>
		setFormValues((current) => {
			const regularIndex = current.sizes.findIndex((size) => size.label.toLowerCase() === "regular");
			const priceIndex = regularIndex >= 0 ? regularIndex : current.sizes.length ? 0 : -1;
			return {
				...current,
				price: value,
				sizes: priceIndex < 0 ? current.sizes : current.sizes.map((size, index) => index === priceIndex ? { ...size, price: value } : size),
			};
		});

	const removeSize = (index) =>
		setFormValues((current) => {
			const removedLabel = current.sizes[index]?.label;
			return {
				...current,
				sizes: current.sizes.filter((_, i) => i !== index),
				ingredients: current.ingredients.map((ingredient) => {
					const quantityBySize = { ...(ingredient.quantityBySize || {}) };
					delete quantityBySize[removedLabel];
					return { ...ingredient, quantityBySize };
				}),
			};
		});

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
				quantityBySize: Object.fromEntries(current.sizes.map((size) => [size.label, String(quantityUsed)])),
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
		setSizeInput("");
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
		setFormValues({
			name: product.name,
			price: String(product.price || "").replace("₱", ""),
			description: product.description,
			category: product.category,
			image: product.image,
			// A size priced at the base price round-trips as a bare label.
			sizes: (product.sizes || []).map((size) => ({ label: size.label, price: String(size.price) })),
			ingredients: (product.ingredients || []).map((ingredient) => {
				if (typeof ingredient === "string") {
					const inventoryItem = inventory.find((entry) => entry.item.toLowerCase() === ingredient.toLowerCase());
				return { name: inventoryItem?.item || ingredient, unit: inventoryItem?.unit || "pcs", stockUnit: inventoryItem?.unit || "pcs", quantityUsed: "", quantityBySize: {} };
				}
				const inventoryItem = inventory.find((entry) => entry.id === Number(ingredient.inventoryItemId));
				const quantityBySize = Object.fromEntries((product.sizes || []).map((size) => {
					const sizedIngredient = size.ingredients?.find((entry) => Number(entry.inventoryItemId) === Number(ingredient.inventoryItemId));
					return [size.label, String(sizedIngredient?.quantityUsed ?? ingredient.quantityUsed ?? "")];
				}));
				return { ...ingredient, name: ingredient.name || inventoryItem?.item || "", unit: ingredient.unit || inventoryItem?.unit || "pcs", stockUnit: ingredient.stockUnit || inventoryItem?.unit || ingredient.unit || "pcs", quantityUsed: ingredient.quantityUsed == null ? "" : String(ingredient.quantityUsed), quantityBySize };
			}),
			addons: (product.addons || []).map((addon) => {
				const inventoryItem = inventory.find((entry) => entry.item.toLowerCase() === addon.label.toLowerCase());
				return { ...addon, quantityUsed: addon.quantityUsed == null ? 1 : addon.quantityUsed, unit: addon.unit || inventoryItem?.unit || "pcs", stockUnit: addon.stockUnit || inventoryItem?.unit || addon.unit || "pcs" };
			}),
			available: product.available !== false,
		});
		setSizeInput("");
		setIngredientDraft({ name: "", quantityUsed: "", unit: "pcs", stockUnit: "pcs" });
		setRecipeError("");
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs", stockUnit: "pcs" });
		setImageError("");
		setShowForm(true);
	};

	const saveProduct = async (event) => {
		event.preventDefault();
		const name = formValues.name.trim();
		const description = formValues.description.trim();
		const numericPrice = Number(formValues.price);
		const sizes = parseSizes(formValues.sizes, numericPrice).map((size) => ({
			...size,
			ingredients: formValues.ingredients.map((ingredient) => ({
				name: String(ingredient.name || "").trim(),
				quantityUsed: Number(ingredient.quantityBySize?.[size.label] ?? ingredient.quantityUsed),
				unit: ingredient.unit || "pcs",
				stockUnit: ingredient.stockUnit || ingredient.unit || "pcs",
			})),
		}));

		if (!name || !description || !Number.isFinite(numericPrice) || numericPrice < 0) return;
		if (sizes.some((size) => !Number.isFinite(size.price) || size.price < 0 || size.ingredients.some((ingredient) => !Number.isFinite(ingredient.quantityUsed) || ingredient.quantityUsed <= 0))) {
			setRecipeError("Enter a valid price and a positive ingredient amount for every serving size.");
			return;
		}
		const productBasePrice = sizes.find((size) => size.label.trim().toLowerCase() === "regular")?.price ?? sizes[0]?.price ?? numericPrice;
		const productData = {
			name,
			price: `₱${productBasePrice.toFixed(2)}`,
			description,
			category: formValues.category,
			image: formValues.image || "",
			sizes: sizes.length ? sizes : [{ label: "Regular", price: numericPrice, ingredients: [] }],
			ingredients: formValues.ingredients.map((ingredient) => ({
				name: String(ingredient.name || "").trim(),
				quantityUsed: Number(ingredient.quantityBySize?.[sizes[0]?.label] ?? ingredient.quantityUsed),
				unit: ingredient.unit || "pcs",
				stockUnit: ingredient.stockUnit || ingredient.unit || "pcs",
			})),
			addons: formValues.addons.map((addon) => ({ ...addon, quantityUsed: Number(addon.quantityUsed), unit: addon.unit || "pcs", stockUnit: addon.stockUnit || addon.unit || "pcs" })),
		};
		try {
			if (editingProduct) await updateProduct(editingProduct.id, productData);
			else await addProduct({ ...productData, stock: 20, available: formValues.available !== false, featured: false });
			await refreshInventory?.().catch(() => null);
			setSyncNotice(`${name} saved. New ingredients and add-ons were added to Inventory at zero stock; matching names reuse the existing stock item.`);
			closeForm();
		} catch (error) {
			window.alert(error.message);
		}
	};

	const availableCount = products.filter((product) => product.available).length;
	const lowStockCount = products.filter((product) => product.stock > 0 && product.stock <= 7).length;
	const recipeDraftItem = inventory.find((entry) => entry.item.toLowerCase() === ingredientDraft.name.trim().toLowerCase());

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
					<div className="admin-menu-controls">
					<section className="admin-menu-heading"><div><span className="admin-menu-eyebrow">PRODUCT CATALOG</span><h2>Everything on the menu</h2><p>Keep your offerings fresh, organized, and ready for every customer.</p></div><button type="button" className="admin-menu-add-button" onClick={openAddForm}><span>+</span> Add new item</button></section>

					<section className="admin-menu-stats" aria-label="Menu summary">
						<div><span className="menu-stat-icon amber">☷</span><div><small>Total items</small><strong>{products.length}</strong><span>Across 4 categories</span></div></div>
						<div><span className="menu-stat-icon green">✓</span><div><small>Available now</small><strong>{availableCount}</strong><span className="positive">Ready to order</span></div></div>
						<div><span className="menu-stat-icon orange">◷</span><div><small>Low stock</small><strong>{lowStockCount}</strong><span className="warning">Needs restocking</span></div></div>
						<div><span className="menu-stat-icon plum">★</span><div><small>Featured items</small><strong>{products.filter((product) => product.featured).length}</strong><span>Shown on the homepage</span></div></div>
					</section>
					</div>

					<section className="admin-menu-toolbar"><div className="admin-menu-tabs" role="tablist" aria-label="Menu categories">{categories.map((category) => <button type="button" key={category} className={activeCategory === category ? "active" : ""} onClick={() => { setActiveCategory(category); setCurrentPage(1); }}>{category}<span>{category === "All items" ? products.length : products.filter((product) => product.category === category).length}</span></button>)}</div><label className="admin-menu-search"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setCurrentPage(1); }} placeholder="Search menu items" aria-label="Search menu items" /></label></section>

					<section className="admin-menu-list-header"><div><h3>{activeCategory}</h3><span>{visibleProducts.length} items in this view</span></div><select aria-label="Sort menu items" value={sortBy} onChange={(event) => { setSortBy(event.target.value); setCurrentPage(1); }}><option value="popular">Sort: Featured first</option><option value="name">Sort: Name A–Z</option><option value="price">Sort: Price low to high</option></select></section>

					<section className="admin-menu-grid">
						{pageProducts.map((product) => <article className={`admin-product-card ${!product.available ? "unavailable" : ""}`} key={product.id}>
							<div className="admin-product-image"><img src={product.image} alt={product.name} onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.parentElement.classList.add("image-unavailable"); }} />{product.featured && <span className="featured-label">★ Featured</span>}<button type="button" className="product-menu-button" aria-label={`Edit ${product.name}`} onClick={() => openEditForm(product)}>•••</button></div>
							<div className="admin-product-body"><div className="admin-product-meta"><span>{product.category}</span><strong>{product.price}</strong></div><h4>{product.name}</h4><p>{product.description}</p><div className="admin-product-footer"><span className={`stock-label ${product.stock === 0 ? "out" : product.stock <= 7 ? "low" : ""}`}>{product.stock === 0 ? "Out of stock" : `${product.stock} in stock`}</span><label className="availability-toggle"><input type="checkbox" checked={product.available} onChange={() => toggleAvailability(product.id)} /><span></span><small>{product.available ? "Available" : "Hidden"}</small></label><button type="button" className="product-delete-button" onClick={() => handleDelete(product)} aria-label={`Delete ${product.name}`}>Delete</button></div></div>
						</article>)}
						{!visibleProducts.length && <div className="admin-menu-empty"><strong>No menu items found</strong><span>Try another category or search term.</span></div>}
					</section>
					{visibleProducts.length > 0 && <nav className="admin-menu-pagination" aria-label="Menu catalog pages">
						<span>Showing {(safePage - 1) * MENU_PAGE_SIZE + 1}–{Math.min(safePage * MENU_PAGE_SIZE, visibleProducts.length)} of {visibleProducts.length} items</span>
						<div>
							<button type="button" onClick={() => setCurrentPage(Math.max(1, safePage - 1))} disabled={safePage === 1}>Previous</button>
							<span>Page {safePage} of {pageCount}</span>
							<button type="button" onClick={() => setCurrentPage(Math.min(pageCount, safePage + 1))} disabled={safePage === pageCount}>Next</button>
						</div>
					</nav>}
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
							<h3 id="delete-item-title">Delete Menu Item?</h3>
							<p id="delete-item-message">
								Are you sure you want to delete <strong>{itemToDelete.name}</strong>? This item
								will be permanently removed from the customer menu and POS catalog.
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
								Confirm Delete
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

								{imageError ? <p className="menu-builder-error" role="alert">{imageError}</p> : null}

								<div className="menu-builder-preview-card">
									{formValues.image ? (
										<>
											<img src={formValues.image} alt="" />
											<span>Image preview</span>
										</>
									) : (
										<span className="menu-builder-preview-empty">
											<ImageOff size={18} strokeWidth={1.7} />
											No image selected - Your image will appear here.
										</span>
									)}
								</div>
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
									</div>

									<div className="menu-builder-field">
										Status
										<div className="menu-builder-toggle-row">
											<button
												type="button"
												className={`menu-builder-toggle ${formValues.available ? "on" : ""}`}
												role="switch"
												aria-checked={formValues.available}
												onClick={() => setFormValues({ ...formValues, available: !formValues.available })}
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
									<label className="menu-builder-legend with-icon">
										<List aria-hidden="true" size={13} strokeWidth={2.2} />
										Item Variations &amp; Sizes
									</label>
									<div className="menu-builder-taginput">
										<input
											type="text"
											value={sizeInput}
											onChange={(event) => setSizeInput(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													addSizes(sizeInput);
												}
											}}
											placeholder="e.g. Large: 59 or Medium"
											aria-label="Add size"
										/>
										<button type="button" onClick={() => addSizes(sizeInput)} disabled={!sizeInput.trim()}>
											<Plus size={14} strokeWidth={2.4} /> Add
										</button>
									</div>

									{formValues.sizes.length ? (
										<div className="menu-builder-size-list">
											{formValues.sizes.map((size, index) => (
												<div className="menu-builder-size-row" key={`${size.label}-${index}`}>
													<strong>{size.label}</strong>
													<label>Serving price <span>₱</span><input type="number" min="0" step="0.01" value={size.price ?? ""} placeholder={formValues.price || "0.00"} onChange={(event) => updateSize(index, "price", event.target.value)} aria-label={`${size.label} serving price`} /></label>
													<button type="button" onClick={() => removeSize(index)} aria-label={`Remove ${size.label}`}>×</button>
												</div>
											))}
										</div>
									) : null}

									<small>Set a price for each size. Enter a size as “Large: 59” to add it with a price, or edit the price after adding.</small>
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
									{formValues.ingredients.length > 0 && (
										<div className="menu-recipe-list">
										{formValues.ingredients.map((ingredient, index) => {
								const inventoryItem = inventory.find((entry) => entry.item.toLowerCase() === String(ingredient.name || "").toLowerCase());
								const ingredientName = inventoryItem?.item || ingredient.name || "Missing inventory item";
								return (
									<div className="menu-recipe-row" key={`${ingredientName}-${index}`}>
														<div className="menu-recipe-name"><strong>{ingredientName}</strong><small>{inventoryItem ? `On hand: ${inventoryItem.quantity} ${inventoryItem.unit}` : `New stock unit: ${ingredient.stockUnit || "pcs"}`}</small></div>
										<label className="menu-recipe-unit">Recipe unit<UnitSelect value={ingredient.unit || "pcs"} compatibleWith={inventoryItem?.unit || ingredient.stockUnit || "pcs"} onChange={(unit) => updateRecipeUnit(index, unit)} ariaLabel={`${ingredientName} recipe unit`} /></label>
														<div className="menu-recipe-size-grid">
															{formValues.sizes.map((size) => (
																		<label key={size.label}>{size.label}<input type="number" min="0.000001" step="0.000001" value={ingredient.quantityBySize?.[size.label] ?? ingredient.quantityUsed ?? ""} onChange={(event) => updateSizeRecipeQuantity(index, size.label, event.target.value)} aria-label={`${ingredientName} amount for ${size.label}`} /></label>
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
							{formValues.addons.map((addon, index) => (
								<div className="menu-addon-row" key={`${addon.label}-${index}`}>
									<div className="menu-addon-name"><strong>{addon.label}</strong><small>Stock: {inventory.find((entry) => entry.item.toLowerCase() === addon.label.toLowerCase())?.quantity ?? 0} {addon.stockUnit || "pcs"}</small></div>
									<label>Price <input type="number" min="0" step="0.01" value={addon.price} onChange={(event) => updateAddon(index, "price", event.target.value)} aria-label={`${addon.label} price`} /></label>
									<label>Used / serving <input type="number" min="0.000001" step="0.000001" value={addon.quantityUsed} onChange={(event) => updateAddon(index, "quantityUsed", event.target.value)} aria-label={`${addon.label} inventory used per serving`} /></label>
									<label>Recipe unit <UnitSelect value={addon.unit || "pcs"} compatibleWith={inventory.find((entry) => entry.item.toLowerCase() === addon.label.toLowerCase())?.unit || addon.stockUnit || "pcs"} onChange={(unit) => updateAddon(index, "unit", unit)} ariaLabel={`${addon.label} recipe unit`} /></label>
									<button
										type="button"
														onClick={() => removeAddon(index)}
														aria-label={`Remove ${addon.label}`}
													>
														×
													</button>
								</div>
											))}
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
