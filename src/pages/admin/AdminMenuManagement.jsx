import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";
import { useMenu } from "../../context/MenuContext.jsx";

import "../../assets/css/admin/AdminMenuManagement.css";
import "../../assets/css/sidebar-collapse.css";

const categories = ["All items", "Milk Tea", "Drinks", "Snacks", "Desserts"];

function AdminMenuManagement() {
	const { products, addProduct, updateProduct, deleteProduct } = useMenu();
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [activeCategory, setActiveCategory] = useState("All items");
	const [search, setSearch] = useState("");
	const [showForm, setShowForm] = useState(false);
	const [editingProduct, setEditingProduct] = useState(null);
	const [formValues, setFormValues] = useState({ name: "", price: "", description: "", category: "Milk Tea", image: "", sizes: "Regular" });

	const openAddForm = () => {
		setEditingProduct(null);
		setFormValues({ name: "", price: "", description: "", category: "Milk Tea", image: "", sizes: "Regular" });
		setShowForm(true);
	};

	const handleImageUpload = (event) => {
		const file = event.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => setFormValues((current) => ({ ...current, image: reader.result }));
		reader.readAsDataURL(file);
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
		if (window.confirm(`Delete ${product.name} from the menu?`)) {
			deleteProduct(product.id);
		}
	};

	const openEditForm = (product) => {
		setEditingProduct(product);
		setFormValues({
			name: product.name,
			price: product.price.replace("₱", ""),
			description: product.description,
			category: product.category,
			image: product.image,
			sizes: (product.sizes || []).map((size) => `${size.label}:${size.price}`).join(", "),
		});
		setShowForm(true);
	};

	const closeForm = () => {
		setShowForm(false);
		setEditingProduct(null);
	};

	const saveProduct = (event) => {
		event.preventDefault();
		const name = formValues.name.trim();
		const description = formValues.description.trim();
		const numericPrice = Number(formValues.price);
		const sizes = formValues.sizes.split(",").map((size) => {
			const [label, price] = size.split(":");
			return { label: label.trim(), price: Number(price || numericPrice) };
		}).filter((size) => size.label && Number.isFinite(size.price));

		if (!name || !description || !Number.isFinite(numericPrice) || numericPrice < 0) return;
		const productData = { name, price: `₱${numericPrice.toFixed(2)}`, description, category: formValues.category, image: formValues.image || products[0]?.image, sizes: sizes.length ? sizes : [{ label: "Regular", price: numericPrice }] };
		if (editingProduct) updateProduct(editingProduct.id, productData);
		else addProduct({ ...productData, stock: 20, available: true, featured: false });
		closeForm();
	};

	const availableCount = products.filter((product) => product.available).length;
	const lowStockCount = products.filter((product) => product.stock > 0 && product.stock <= 7).length;

	return (
		<div className={`admin-menu-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
			<aside className="admin-menu-sidebar">
				<div className="admin-menu-brand"><SidebarLogoButton logo={amayaLogo} alt="Amaya logo" collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)} /><div><strong>Amaya</strong><span>Admin Portal</span></div></div>
				<nav className="admin-menu-nav" aria-label="Admin navigation">
					<span className="admin-menu-nav-label">MAIN MENU</span>
					<Link to="/admin" className="admin-menu-nav-link"><span>▦</span>Dashboard</Link>
					<Link to="/admin/orders" className="admin-menu-nav-link"><span>▤</span>Orders</Link>
					<Link to="/admin/inventory" className="admin-menu-nav-link"><span>☷</span>Inventory</Link>
					<Link to="/admin/menu" className="admin-menu-nav-link active"><span>☷</span>Menu Management</Link>
					<span className="admin-menu-nav-label nav-label-spaced">MANAGEMENT</span>
					<Link to="/admin/reports" className="admin-menu-nav-link"><span>▥</span>Reports</Link>
					<Link to="/admin/settings" className="admin-menu-nav-link"><span>⚙</span>Settings</Link>
				</nav>
				<div className="admin-menu-sidebar-bottom"><Link to="/" className="admin-menu-nav-link"><span>←</span>Back to Website</Link><Link to="/login" className="admin-menu-nav-link logout-link"><span>↪</span>Log Out</Link></div>
			</aside>

			<main className="admin-menu-main">
				<header className="admin-menu-topbar"><div><span className="admin-menu-section-label">ADMIN PORTAL</span><h1>Menu Management</h1></div><div className="admin-menu-topbar-actions"><button type="button" className="admin-menu-icon-button" aria-label="Notifications">♢<b>3</b></button><div className="admin-menu-user"><div className="admin-menu-avatar">A</div><div><strong>Administrator</strong><span>Admin</span></div></div></div></header>

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

			{showForm && <div className="admin-menu-modal-backdrop" role="presentation" onClick={closeForm}><form className="admin-menu-modal" onSubmit={saveProduct} role="dialog" aria-modal="true" aria-labelledby="edit-item-title" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="admin-menu-eyebrow">CATALOG UPDATE</span><h3 id="edit-item-title">{editingProduct ? "Edit menu item" : "Add menu item"}</h3></div><button type="button" onClick={closeForm} aria-label="Close form">×</button></div><label>Item name<input value={formValues.name} onChange={(event) => setFormValues({ ...formValues, name: event.target.value })} placeholder="e.g. Strawberry Cream Tea" required /></label><div className="modal-form-row"><label>Category<select value={formValues.category} onChange={(event) => setFormValues({ ...formValues, category: event.target.value })}><option>Milk Tea</option><option>Drinks</option><option>Snacks</option><option>Desserts</option></select></label><label>Price<input value={formValues.price} onChange={(event) => setFormValues({ ...formValues, price: event.target.value })} inputMode="decimal" placeholder="0.00" required /></label></div><label>Sizes<input value={formValues.sizes} onChange={(event) => setFormValues({ ...formValues, sizes: event.target.value })} placeholder="Small:39, Large:59" /><small>Use comma-separated Label:Price values.</small></label><label>Product image<input type="file" accept="image/*" onChange={handleImageUpload} /><small>{formValues.image ? "Image ready to save." : "Choose an image from your device."}</small></label><label>Description<textarea value={formValues.description} onChange={(event) => setFormValues({ ...formValues, description: event.target.value })} placeholder="Describe this menu item" rows="3" required></textarea></label><div className="modal-actions"><button type="button" className="modal-cancel" onClick={closeForm}>Cancel</button><button type="submit" className="modal-save">{editingProduct ? "Save changes" : "Add item"}</button></div></form></div>}
		</div>
	);
}

export default AdminMenuManagement;
