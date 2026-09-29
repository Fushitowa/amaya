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

// Turns "Extra Pearls: 15" into { label, price } for an add-on tag.
const parseAddonTag = (raw) => {
  const [label, price] = String(raw || "").split(":");
  const parsed = Number(price);
  return {
    label: (label || "").trim(),
    price: Number.isFinite(parsed) ? parsed : 0,
  };
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function AdminMenuManagement() {
	const { products, addProduct, updateProduct, deleteProduct } = useMenu();
	const { syncIngredientsFromMenu } = useInventory() || {};
	const { sidebarCollapsed, toggleSidebar } = useSidebar();
	const [activeCategory, setActiveCategory] = useState("All items");
	const [search, setSearch] = useState("");
	const [showForm, setShowForm] = useState(false);
	const [editingProduct, setEditingProduct] = useState(null);
	const [itemToDelete, setItemToDelete] = useState(null);
	const emptyForm = () => ({ name: "", price: "", description: "", category: "Milk Tea", image: "", sizes: ["Regular"], ingredients: [], addons: [], available: true });

	const [formValues, setFormValues] = useState(emptyForm());
	const [sizeInput, setSizeInput] = useState("");
	const [ingredientInput, setIngredientInput] = useState("");
	const [syncNotice, setSyncNotice] = useState("");
	const syncTimer = useRef(null);

	useEffect(() => {
    if (!syncNotice) return;
    syncTimer.current = setTimeout(() => setSyncNotice(""), 6000);
    return () => clearTimeout(syncTimer.current);
  }, [syncNotice]);
	const [addonInput, setAddonInput] = useState("");
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
		setIngredientInput("");
		setAddonInput("");
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

	const addIngredients = (raw) => {
		const tags = parseList(raw);
		if (!tags.length) return;
		setFormValues((current) => {
			const merged = [...current.ingredients];
			tags.forEach((tag) => {
				if (!merged.some((existing) => existing.toLowerCase() === tag.toLowerCase())) merged.push(tag);
			});
			return { ...current, ingredients: merged };
		});
		setIngredientInput("");
	};

	const addAddons = (raw) => {
		const tags = parseList(raw);
		if (!tags.length) return;
		setFormValues((current) => {
			const merged = [...current.addons];
			tags.forEach((tag) => {
				if (!merged.some((existing) => existing.label.toLowerCase() === tag.toLowerCase())) {
					merged.push(parseAddonTag(tag));
				}
			});
			return { ...current, addons: merged };
		});
		setAddonInput("");
	};

	const removeIngredient = (index) =>
		setFormValues((current) => ({ ...current, ingredients: current.ingredients.filter((_, i) => i !== index) }));

	const removeAddon = (index) =>
		setFormValues((current) => ({ ...current, addons: current.addons.filter((_, i) => i !== index) }));

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
		setIngredientInput("");
		setAddonInput("");
		setImageError("");
	};

	const visibleProducts = useMemo(() => {
		const query = search.toLowerCase().trim();
		return products.filter((product) => {
			const categoryMatches = activeCategory === "All items" || product.category === activeCategory;
			const searchMatches = !query || `${product.name} ${product.category}`.toLowerCase().includes(query);
			return categoryMatches && searchMatches;
		});
	}, [activeCategory, products, search]);

	const toggleAvailability = (id) => {
		updateProduct(id, { available: !products.find((product) => product.id === id)?.available });
	};

	const handleDelete = (product) => {
		setItemToDelete(product);
	};

	const confirmDelete = () => {
		if (!itemToDelete) return;
		deleteProduct(itemToDelete.id);
		setItemToDelete(null);
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
			ingredients: product.ingredients || [],
			addons: product.addons || [],
			available: product.available !== false,
		});
		setSizeInput("");
		setIngredientInput("");
		setAddonInput("");
		setImageError("");
		setShowForm(true);
	};

	const saveProduct = (event) => {
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
			image: formValues.image || products[0]?.image,
			sizes: sizes.length ? sizes : [{ label: "Regular", price: numericPrice }],
			ingredients: formValues.ingredients,
			addons: formValues.addons,
		};
		if (editingProduct) updateProduct(editingProduct.id, productData);
		else addProduct({ ...productData, stock: 20, available: formValues.available !== false, featured: false });

		// Recipe ingredients become inventory items automatically. Existing
		// items are left alone so their stock, unit and status are preserved.
		const { added } = syncIngredientsFromMenu(formValues.ingredients, {
			category: formValues.category,
		});

		if (added.length) {
			setSyncNotice(
				`${added.length} ingredient${added.length === 1 ? "" : "s"} added to Inventory: ${added.join(", ")}`
			);
		}

		closeForm();
	};

	const availableCount = products.filter((product) => product.available).length;
	const lowStockCount = products.filter((product) => product.stock > 0 && product.stock <= 7).length;

	return (
		<div className={`admin-menu-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <Sidebar
        role="admin"
        activeTab="menu"
        sidebarCollapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
      />

			<main className="admin-menu-main">
				<header className="admin-menu-topbar"><div><span className="admin-menu-section-label">ADMIN PORTAL</span><h1>Menu Management</h1></div><div className="admin-menu-topbar-actions"><PortalNotificationButton count={3} /><div className="admin-menu-user"><div className="amaya-admin-avatar"><img src={adminAvatar} alt="" aria-hidden="true" /></div><div><strong>Administrator</strong><span>Admin</span></div></div></div></header>

				<div className="admin-menu-content">
					<section className="admin-menu-heading"><div><span className="admin-menu-eyebrow">PRODUCT CATALOG</span><h2>Everything on the menu</h2><p>Keep your offerings fresh, organized, and ready for every customer.</p></div><button type="button" className="admin-menu-add-button" onClick={openAddForm}><span>+</span> Add new item</button></section>

					<section className="admin-menu-stats" aria-label="Menu summary">
						<div><span className="menu-stat-icon amber">☷</span><div><small>Total items</small><strong>{products.length}</strong><span>Across 4 categories</span></div></div>
						<div><span className="menu-stat-icon green">✓</span><div><small>Available now</small><strong>{availableCount}</strong><span className="positive">Ready to order</span></div></div>
						<div><span className="menu-stat-icon orange">◷</span><div><small>Low stock</small><strong>{lowStockCount}</strong><span className="warning">Needs restocking</span></div></div>
						<div><span className="menu-stat-icon plum">★</span><div><small>Featured items</small><strong>{products.filter((product) => product.featured).length}</strong><span>Shown on the homepage</span></div></div>
					</section>

					<section className="admin-menu-toolbar"><div className="admin-menu-tabs" role="tablist" aria-label="Menu categories">{categories.map((category) => <button type="button" key={category} className={activeCategory === category ? "active" : ""} onClick={() => setActiveCategory(category)}>{category}<span>{category === "All items" ? products.length : products.filter((product) => product.category === category).length}</span></button>)}</div><label className="admin-menu-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search menu items" aria-label="Search menu items" /></label></section>

					<section className="admin-menu-list-header"><div><h3>{activeCategory}</h3><span>{visibleProducts.length} items in this view</span></div><select aria-label="Sort menu items" defaultValue="popular"><option value="popular">Sort: Featured first</option><option value="name">Sort: Name</option><option value="price">Sort: Price</option></select></section>

					<section className="admin-menu-grid">
						{visibleProducts.map((product) => <article className={`admin-product-card ${!product.available ? "unavailable" : ""}`} key={product.id}>
							<div className="admin-product-image"><img src={product.image} alt={product.name} />{product.featured && <span className="featured-label">★ Featured</span>}<button type="button" className="product-menu-button" aria-label={`Edit ${product.name}`} onClick={() => openEditForm(product)}>•••</button></div>
							<div className="admin-product-body"><div className="admin-product-meta"><span>{product.category}</span><strong>{product.price}</strong></div><h4>{product.name}</h4><p>{product.description}</p><div className="admin-product-footer"><span className={`stock-label ${product.stock === 0 ? "out" : product.stock <= 7 ? "low" : ""}`}>{product.stock === 0 ? "Out of stock" : `${product.stock} in stock`}</span><label className="availability-toggle"><input type="checkbox" checked={product.available} onChange={() => toggleAvailability(product.id)} /><span></span><small>{product.available ? "Available" : "Hidden"}</small></label><button type="button" className="product-delete-button" onClick={() => handleDelete(product)} aria-label={`Delete ${product.name}`}>Delete</button></div></div>
						</article>)}
					</section>
					{!visibleProducts.length && <div className="admin-menu-empty"><strong>No menu items found</strong><span>Try another category or search term.</span></div>}
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
									<div className="menu-builder-taginput">
										<input
											type="text"
											value={ingredientInput}
											onChange={(event) => setIngredientInput(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													addIngredients(ingredientInput);
												}
											}}
											placeholder="Type an ingredient and press Enter..."
											aria-label="Add ingredient"
										/>
										<button type="button" onClick={() => addIngredients(ingredientInput)} disabled={!ingredientInput.trim()}>
											<Plus size={14} strokeWidth={2.4} /> Add
										</button>
									</div>

									{formValues.ingredients.length ? (
										<div className="menu-builder-tags">
											{formValues.ingredients.map((item, index) => (
												<span className="menu-builder-tag" key={`${item}-${index}`}>
													{item}
													<button
														type="button"
														onClick={() => removeIngredient(index)}
														aria-label={`Remove ${item}`}
													>
														×
													</button>
												</span>
											))}
										</div>
									) : null}

									<small>Press Enter after typing each ingredient to add it to the recipe list.</small>
								</section>

								<section className="menu-builder-card">
									<label className="menu-builder-legend with-icon">
										<Sparkles aria-hidden="true" size={13} strokeWidth={2.2} />
										Add-ons &amp; Customizations
									</label>
									<div className="menu-builder-taginput">
										<input
											type="text"
											value={addonInput}
											onChange={(event) => setAddonInput(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter") {
													event.preventDefault();
													addAddons(addonInput);
												}
											}}
											placeholder="e.g. Extra Pearls: 15 (Press Enter to add)"
											aria-label="Add add-on"
										/>
										<button type="button" onClick={() => addAddons(addonInput)} disabled={!addonInput.trim()}>
											<Plus size={14} strokeWidth={2.4} /> Add
										</button>
									</div>

									{formValues.addons.length ? (
										<div className="menu-builder-tags">
											{formValues.addons.map((addon, index) => (
												<span className="menu-builder-tag" key={`${addon.label}-${index}`}>
													{addon.label}
													{addon.price ? <em>+₱{addon.price}</em> : null}
													<button
														type="button"
														onClick={() => removeAddon(index)}
														aria-label={`Remove ${addon.label}`}
													>
														×
													</button>
												</span>
											))}
										</div>
									) : null}

									<small>Format as AddonName:Price (e.g., Espresso Shot: 25) and press Enter.</small>
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
