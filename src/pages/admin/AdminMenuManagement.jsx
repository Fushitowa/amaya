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
      const [label, price] = String(entry).split(":");
      const parsed = Number(price);
      return {
        label: (label || "").trim(),
        price: Number.isFinite(parsed) && String(price).trim() !== "" ? parsed : fallbackPrice,
      };
    })
    .filter((entry) => entry.label && Number.isFinite(entry.price));

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MENU_PAGE_SIZE = 16;

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
	const emptyForm = () => ({ name: "", price: "", description: "", category: "Milk Tea", image: "", sizes: ["Regular"], ingredients: [], addons: [], available: true });

	const [formValues, setFormValues] = useState(emptyForm());
	const [sizeInput, setSizeInput] = useState("");
	const [ingredientDraft, setIngredientDraft] = useState({ name: "", quantityUsed: "", unit: "pcs" });
	const [addonDraft, setAddonDraft] = useState({ label: "", price: "", quantityUsed: "1", unit: "pcs" });
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
		setIngredientDraft({ name: "", quantityUsed: "", unit: "pcs" });
		setRecipeError("");
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs" });
		setImageError("");
		setShowForm(true);
	};

	const addSizes = (raw) => {
		const tags = parseList(raw);
		if (!tags.length) return;
		setFormValues((current) => {
			const merged = [...current.sizes];
			tags.forEach((tag) => {
				if (!merged.some((existing) => existing.toLowerCase() === tag.toLowerCase())) merged.push(tag);
			});
			return { ...current, sizes: merged };
		});
		setSizeInput("");
	};

	const removeSize = (index) =>
		setFormValues((current) => ({ ...current, sizes: current.sizes.filter((_, i) => i !== index) }));

	const addRecipeIngredient = () => {
		const name = ingredientDraft.name.trim();
		const quantityUsed = Number(ingredientDraft.quantityUsed);
		const existingItem = inventory.find((entry) => entry.item.toLowerCase() === name.toLowerCase());
		const unit = (existingItem?.unit || ingredientDraft.unit || "").trim();
		if (!name || name.length > 160 || !unit || unit.length > 40) {
			setRecipeError("Enter an ingredient name and a stock unit.");
			return;
		}
		if (!Number.isFinite(quantityUsed) || quantityUsed <= 0 || Number(quantityUsed.toFixed(3)) !== quantityUsed) {
			setRecipeError("Enter a positive amount with at most 3 decimal places.");
			return;
		}
		if (formValues.ingredients.some((entry) => String(entry.name || entry.item || "").trim().toLowerCase() === name.toLowerCase())) {
			setRecipeError("That ingredient is already in this recipe.");
			return;
		}
		setFormValues((current) => ({
			...current,
			ingredients: [...current.ingredients, { name, quantityUsed, unit }],
		}));
		setIngredientDraft({ name: "", quantityUsed: "", unit: "pcs" });
		setRecipeError("");
	};

	const addAddon = () => {
		const label = addonDraft.label.trim();
		const existingItem = inventory.find((entry) => entry.item.toLowerCase() === label.toLowerCase());
		const unit = (existingItem?.unit || addonDraft.unit || "").trim();
		const price = Number(addonDraft.price);
		const quantityUsed = Number(addonDraft.quantityUsed);
		if (!label || label.length > 100 || !unit || unit.length > 40 || !Number.isFinite(price) || price < 0) {
			setRecipeError("Enter a valid add-on name, price, and stock unit.");
			return;
		}
		if (!Number.isFinite(quantityUsed) || quantityUsed <= 0 || Number(quantityUsed.toFixed(3)) !== quantityUsed) {
			setRecipeError("Enter the add-on quantity used per serving (up to 3 decimal places).");
			return;
		}
		if (formValues.addons.some((entry) => entry.label.trim().toLowerCase() === label.toLowerCase())) {
			setRecipeError("That add-on is already listed for this menu item.");
			return;
		}
		setFormValues((current) => ({ ...current, addons: [...current.addons, { label, price, quantityUsed, unit }] }));
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs" });
		setRecipeError("");
	};

	const removeIngredient = (index) =>
		setFormValues((current) => ({ ...current, ingredients: current.ingredients.filter((_, i) => i !== index) }));

	const updateRecipeQuantity = (index, quantityUsed) =>
		setFormValues((current) => ({
			...current,
			ingredients: current.ingredients.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantityUsed } : entry),
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
		setIngredientDraft({ name: "", quantityUsed: "", unit: "pcs" });
		setRecipeError("");
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs" });
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
		const basePrice = Number(String(product.price || "").replace("₱", "")) || 0;
		setEditingProduct(product);
		setFormValues({
			name: product.name,
			price: String(product.price || "").replace("₱", ""),
			description: product.description,
			category: product.category,
			image: product.image,
			// A size priced at the base price round-trips as a bare label.
			sizes: (product.sizes || []).map((size) =>
				size.price === basePrice ? size.label : `${size.label}:${size.price}`
			),
			ingredients: (product.ingredients || []).map((ingredient) => {
				if (typeof ingredient === "string") {
					const inventoryItem = inventory.find((entry) => entry.item.toLowerCase() === ingredient.toLowerCase());
					return { name: inventoryItem?.item || ingredient, unit: inventoryItem?.unit || "pcs", quantityUsed: "" };
				}
				return { ...ingredient, name: ingredient.name || inventory.find((entry) => entry.id === Number(ingredient.inventoryItemId))?.item || "", unit: ingredient.unit || inventory.find((entry) => entry.id === Number(ingredient.inventoryItemId))?.unit || "pcs", quantityUsed: ingredient.quantityUsed == null ? "" : String(ingredient.quantityUsed) };
			}),
			addons: (product.addons || []).map((addon) => {
				const inventoryItem = inventory.find((entry) => entry.item.toLowerCase() === addon.label.toLowerCase());
				return { ...addon, quantityUsed: addon.quantityUsed == null ? 1 : addon.quantityUsed, unit: addon.unit || inventoryItem?.unit || "pcs" };
			}),
			available: product.available !== false,
		});
		setSizeInput("");
		setIngredientDraft({ name: "", quantityUsed: "", unit: "pcs" });
		setRecipeError("");
		setAddonDraft({ label: "", price: "", quantityUsed: "1", unit: "pcs" });
		setImageError("");
		setShowForm(true);
	};

	const saveProduct = async (event) => {
		event.preventDefault();
		const name = formValues.name.trim();
		const description = formValues.description.trim();
		const numericPrice = Number(formValues.price);
		const sizes = parseSizes(formValues.sizes, numericPrice);

		if (!name || !description || !Number.isFinite(numericPrice) || numericPrice < 0) return;
		const productData = {
			name,
			price: `₱${numericPrice.toFixed(2)}`,
			description,
			category: formValues.category,
			image: formValues.image || "",
			sizes: sizes.length ? sizes : [{ label: "Regular", price: numericPrice }],
			ingredients: formValues.ingredients.map((ingredient) => ({
				name: String(ingredient.name || "").trim(),
				quantityUsed: Number(ingredient.quantityUsed),
				unit: ingredient.unit || "pcs",
			})),
			addons: formValues.addons.map((addon) => ({ ...addon, quantityUsed: Number(addon.quantityUsed), unit: addon.unit || "pcs" })),
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
													onChange={(event) => setFormValues({ ...formValues, price: event.target.value })}
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
											placeholder="e.g. Large: 59 or Regular"
											aria-label="Add size"
										/>
										<button type="button" onClick={() => addSizes(sizeInput)} disabled={!sizeInput.trim()}>
											<Plus size={14} strokeWidth={2.4} /> Add
										</button>
									</div>

									{formValues.sizes.length ? (
										<div className="menu-builder-tags">
											{formValues.sizes.map((size, index) => (
												<span className="menu-builder-tag" key={`${size}-${index}`}>
													{size}
													<button
														type="button"
														onClick={() => removeSize(index)}
														aria-label={`Remove ${size}`}
													>
														×
													</button>
												</span>
											))}
										</div>
									) : null}

									<small>Type a size label (e.g. Regular or Large:59) and press Enter to add.</small>
								</section>

								<section className="menu-builder-card">
									<label className="menu-builder-legend with-icon">
										<Beaker aria-hidden="true" size={13} strokeWidth={2.2} />
										Ingredients &amp; Recipe
									</label>
					<p className="menu-recipe-help">Enter how much of each ingredient one serving uses. New names appear in Inventory at zero stock; an existing name reuses its current stock. Keep the same unit.</p>
					<div className="menu-recipe-entry">
						<input list="menu-inventory-items" value={ingredientDraft.name} onChange={(event) => { const name = event.target.value; const existing = inventory.find((entry) => entry.item.toLowerCase() === name.trim().toLowerCase()); setIngredientDraft((current) => ({ ...current, name, unit: existing?.unit || current.unit })); setRecipeError(""); }} aria-label="Ingredient name" placeholder="Ingredient name" />
						<div className="menu-recipe-amount">
							<input type="number" min="0.001" step="0.001" value={ingredientDraft.quantityUsed} onChange={(event) => { setIngredientDraft((current) => ({ ...current, quantityUsed: event.target.value })); setRecipeError(""); }} aria-label="Amount used per serving" placeholder="Amount per serving" />
							<input type="text" value={recipeDraftItem?.unit || ingredientDraft.unit} onChange={(event) => { setIngredientDraft((current) => ({ ...current, unit: event.target.value })); setRecipeError(""); }} aria-label="Ingredient stock unit" placeholder="Unit" />
						</div>
						<button type="button" onClick={addRecipeIngredient} disabled={!ingredientDraft.name.trim() || !ingredientDraft.quantityUsed}>
							<Plus size={14} strokeWidth={2.4} /> Add ingredient
						</button>
					</div>
					<datalist id="menu-inventory-items">{inventory.map((entry) => <option key={entry.id} value={entry.item}>{entry.quantity} {entry.unit} in stock</option>)}</datalist>
									{recipeError && <p className="menu-recipe-error" role="alert">{recipeError}</p>}
									{formValues.ingredients.length > 0 && (
										<div className="menu-recipe-list">
											{formValues.ingredients.map((ingredient, index) => {
								const inventoryItem = inventory.find((entry) => entry.item.toLowerCase() === String(ingredient.name || "").toLowerCase());
								const ingredientName = inventoryItem?.item || ingredient.name || "Missing inventory item";
								const unit = inventoryItem?.unit || ingredient.unit || "unit";
								return (
									<div className="menu-recipe-row" key={`${ingredientName}-${index}`}>
										<div className="menu-recipe-name"><strong>{ingredientName}</strong><small>{inventoryItem ? `${inventoryItem.quantity} ${unit} available` : "Will be created in Inventory when saved"}</small></div>
														<input type="number" min="0.001" step="0.001" value={ingredient.quantityUsed} onChange={(event) => updateRecipeQuantity(index, event.target.value)} aria-label={`${ingredientName} amount per serving`} />
														<span className="menu-recipe-unit">{unit} / serving</span>
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
					<p className="menu-recipe-help">Each selected add-on also consumes its quantity from shared Inventory stock.</p>
					<div className="menu-recipe-entry menu-addon-entry">
						<input list="menu-inventory-items" value={addonDraft.label} onChange={(event) => { const label = event.target.value; const existing = inventory.find((entry) => entry.item.toLowerCase() === label.trim().toLowerCase()); setAddonDraft((current) => ({ ...current, label, unit: existing?.unit || current.unit })); setRecipeError(""); }} aria-label="Add-on inventory name" placeholder="Add-on name" />
						<input type="number" min="0" step="0.01" value={addonDraft.price} onChange={(event) => setAddonDraft((current) => ({ ...current, price: event.target.value }))} aria-label="Add-on price" placeholder="Price" />
						<input type="number" min="0.001" step="0.001" value={addonDraft.quantityUsed} onChange={(event) => setAddonDraft((current) => ({ ...current, quantityUsed: event.target.value }))} aria-label="Add-on stock used per serving" placeholder="Used / serving" />
						<input type="text" value={inventory.find((entry) => entry.item.toLowerCase() === addonDraft.label.trim().toLowerCase())?.unit || addonDraft.unit} onChange={(event) => setAddonDraft((current) => ({ ...current, unit: event.target.value }))} aria-label="Add-on stock unit" placeholder="Unit" />
						<button type="button" onClick={addAddon} disabled={!addonDraft.label.trim() || addonDraft.price === "" || !addonDraft.quantityUsed}>
							<Plus size={14} strokeWidth={2.4} /> Add
						</button>
					</div>

					{formValues.addons.length ? (
						<div className="menu-addon-list">
							{formValues.addons.map((addon, index) => (
								<div className="menu-addon-row" key={`${addon.label}-${index}`}>
									<strong>{addon.label}</strong>
									<label>Price <input type="number" min="0" step="0.01" value={addon.price} onChange={(event) => updateAddon(index, "price", event.target.value)} aria-label={`${addon.label} price`} /></label>
									<label>Used / serving <input type="number" min="0.001" step="0.001" value={addon.quantityUsed} onChange={(event) => updateAddon(index, "quantityUsed", event.target.value)} aria-label={`${addon.label} inventory used per serving`} /></label>
									<label>Unit <input type="text" value={addon.unit || "pcs"} onChange={(event) => updateAddon(index, "unit", event.target.value)} aria-label={`${addon.label} inventory unit`} /></label>
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
