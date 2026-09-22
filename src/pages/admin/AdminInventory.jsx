import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";
import "../../assets/css/admin/AdminInventory.css";
import "../../assets/css/sidebar-collapse.css";

const initialInventory = [
  { id: 1, item: "Coca-Cola", category: "Soft Drinks", quantity: 18, unit: "bottles/cans", minimumStock: 8 },
  { id: 2, item: "Chocolate Syrup", category: "Syrup", quantity: 6, unit: "bottle/L", minimumStock: 4 },
  { id: 3, item: "Blueberry Syrup", category: "Syrup", quantity: 9, unit: "bottle/L", minimumStock: 4 },
  { id: 4, item: "Green Apple Syrup", category: "Syrup", quantity: 5, unit: "bottle/L", minimumStock: 4 },
  { id: 5, item: "Strawberry Syrup", category: "Syrup", quantity: 10, unit: "bottle/L", minimumStock: 4 },
  { id: 6, item: "Strawberry Milk Syrup", category: "Syrup", quantity: 7, unit: "bottle/L", minimumStock: 4 },
  { id: 7, item: "Mango Syrup", category: "Syrup", quantity: 8, unit: "bottle/L", minimumStock: 4 },
  { id: 8, item: "Fresh Milk", category: "Dairy", quantity: 15, unit: "liters", minimumStock: 6 },
  { id: 9, item: "Vanilla Ice Cream", category: "Dairy", quantity: 12, unit: "liters", minimumStock: 5 },
  { id: 10, item: "Ice", category: "Supplies", quantity: 22, unit: "kg", minimumStock: 10 },
  { id: 11, item: "Black Tea", category: "Tea", quantity: 9, unit: "kg", minimumStock: 5 },
  { id: 12, item: "Milk Powder", category: "Dairy", quantity: 6, unit: "kg", minimumStock: 4 },
  { id: 13, item: "Tapioca Pearls", category: "Toppings", quantity: 8, unit: "kg", minimumStock: 4 },
  { id: 14, item: "French Fries", category: "Frozen Food", quantity: 12, unit: "kg", minimumStock: 8 },
  { id: 15, item: "Burger Patties", category: "Meat", quantity: 45, unit: "pcs", minimumStock: 20 },
  { id: 16, item: "Burger Buns", category: "Bakery", quantity: 30, unit: "pcs", minimumStock: 12 },
  { id: 17, item: "Hotdog", category: "Meat", quantity: 20, unit: "pcs", minimumStock: 10 },
  { id: 18, item: "Hotdog Buns", category: "Bakery", quantity: 28, unit: "pcs", minimumStock: 12 },
  { id: 19, item: "Tempura", category: "Frozen Food", quantity: 17, unit: "pcs/kg", minimumStock: 8 },
  { id: 20, item: "Fish Balls", category: "Frozen Food", quantity: 25, unit: "pcs/kg", minimumStock: 10 },
  { id: 21, item: "Siomai", category: "Frozen Food", quantity: 14, unit: "pcs", minimumStock: 6 },
  { id: 22, item: "Lumpia", category: "Frozen Food", quantity: 19, unit: "pcs", minimumStock: 8 },
  { id: 23, item: "Cooking Oil", category: "Cooking Supplies", quantity: 6, unit: "liters", minimumStock: 3 },
  { id: 24, item: "Ketchup", category: "Condiments", quantity: 8, unit: "bottle", minimumStock: 3 },
  { id: 25, item: "Mayonnaise", category: "Condiments", quantity: 5, unit: "bottle", minimumStock: 3 },
  { id: 26, item: "Cheese", category: "Dairy", quantity: 2, unit: "slices/kg", minimumStock: 4 },
  { id: 27, item: "Mango", category: "Fruit", quantity: 4, unit: "kg", minimumStock: 3 },
  { id: 28, item: "Graham Crackers", category: "Dessert Ingredients", quantity: 10, unit: "packs/kg", minimumStock: 5 },
  { id: 29, item: "All-Purpose Cream", category: "Dairy", quantity: 7, unit: "liters", minimumStock: 3 },
  { id: 30, item: "Condensed Milk", category: "Dairy", quantity: 9, unit: "cans", minimumStock: 4 },
  { id: 31, item: "Small Drink Cups", category: "Packaging", quantity: 350, unit: "pcs", minimumStock: 120 },
  { id: 32, item: "Medium Drink Cups", category: "Packaging", quantity: 275, unit: "pcs", minimumStock: 120 },
  { id: 33, item: "12oz Milktea Cups", category: "Packaging", quantity: 310, unit: "pcs", minimumStock: 120 },
  { id: 34, item: "Drink Lids", category: "Packaging", quantity: 180, unit: "pcs", minimumStock: 100 },
  { id: 35, item: "Straws", category: "Packaging", quantity: 110, unit: "pcs", minimumStock: 150 },
  { id: 36, item: "Burger Boxes", category: "Packaging", quantity: 84, unit: "pcs", minimumStock: 30 },
  { id: 37, item: "Food Containers", category: "Packaging", quantity: 120, unit: "pcs", minimumStock: 40 },
  { id: 38, item: "Paper Bags", category: "Packaging", quantity: 42, unit: "pcs", minimumStock: 20 },
  { id: 39, item: "Plastic Bags", category: "Packaging", quantity: 60, unit: "pcs", minimumStock: 25 },
  { id: 40, item: "Napkins", category: "Supplies", quantity: 8, unit: "packs", minimumStock: 4 },
  { id: 41, item: "Disposable Forks", category: "Supplies", quantity: 200, unit: "pcs", minimumStock: 80 },
  { id: 42, item: "Disposable Spoons", category: "Supplies", quantity: 160, unit: "pcs", minimumStock: 80 },
];

const categories = [
  "All",
  "Soft Drinks",
  "Syrup",
  "Tea",
  "Dairy",
  "Frozen Food",
  "Meat",
  "Bakery",
  "Supplies",
  "Condiments",
  "Toppings",
  "Packaging",
  "Dessert Ingredients",
  "Fruit",
  "Cooking Supplies",
];

const getInventoryStatus = (quantity, minimumStock) => {
  if (quantity === 0) return "Out of Stock";
  if (quantity <= minimumStock) return "Low Stock";
  return "In Stock";
};

function AdminInventory() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inventory, setInventory] = useState(initialInventory);
  const [activeCategory, setActiveCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formValues, setFormValues] = useState({
    item: "",
    category: "Soft Drinks",
    quantity: "",
    unit: "",
    minimumStock: "",
  });

  const filteredInventory = useMemo(() => {
    const query = search.trim().toLowerCase();

    return inventory.filter((entry) => {
      const matchesCategory = activeCategory === "All" || entry.category === activeCategory;
      const matchesSearch =
        !query ||
        `${entry.item} ${entry.category} ${entry.unit}`.toLowerCase().includes(query);

      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, inventory, search]);

  const totalItems = inventory.length;
  const lowStockCount = inventory.filter((item) => getInventoryStatus(item.quantity, item.minimumStock) === "Low Stock").length;
  const outOfStockCount = inventory.filter((item) => getInventoryStatus(item.quantity, item.minimumStock) === "Out of Stock").length;
  const inStockCount = inventory.filter((item) => getInventoryStatus(item.quantity, item.minimumStock) === "In Stock").length;

  const resetForm = () => {
    setShowForm(false);
    setEditingItem(null);
    setFormValues({
      item: "",
      category: "Soft Drinks",
      quantity: "",
      unit: "",
      minimumStock: "",
    });
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setFormValues({
      item: item.item,
      category: item.category,
      quantity: String(item.quantity),
      unit: item.unit,
      minimumStock: String(item.minimumStock),
    });
    setShowForm(true);
  };

  const handleDelete = (id) => {
    setInventory((currentInventory) => currentInventory.filter((item) => item.id !== id));
  };

  const handleRestock = (id) => {
    setInventory((currentInventory) =>
      currentInventory.map((item) => {
        if (item.id !== id) return item;

        return {
          ...item,
          quantity: item.quantity + Math.max(item.minimumStock, 5),
        };
      })
    );
  };

  const handleSave = (event) => {
    event.preventDefault();

    const itemName = formValues.item.trim();
    const category = formValues.category.trim();
    const unit = formValues.unit.trim();
    const quantity = Number(formValues.quantity);
    const minimumStock = Number(formValues.minimumStock);

    if (!itemName || !category || !unit || !Number.isFinite(quantity) || !Number.isFinite(minimumStock)) {
      return;
    }

    if (editingItem) {
      setInventory((currentInventory) =>
        currentInventory.map((item) =>
          item.id === editingItem.id
            ? {
                ...item,
                item: itemName,
                category,
                quantity,
                unit,
                minimumStock,
              }
            : item
        )
      );
    } else {
      setInventory((currentInventory) => [
        ...currentInventory,
        {
          id: Date.now(),
          item: itemName,
          category,
          quantity,
          unit,
          minimumStock,
        },
      ]);
    }

    resetForm();
  };

  return (
    <div className={`admin-inventory-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="admin-inventory-sidebar">
        <div className="admin-inventory-brand">
          <SidebarLogoButton logo={amayaLogo} alt="Amaya logo" collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)} />
          <div>
            <strong>Amaya</strong>
            <span>Admin Portal</span>
          </div>
        </div>

        <nav className="admin-inventory-nav" aria-label="Admin navigation">
          <span className="admin-inventory-nav-label">MAIN MENU</span>
          <Link to="/admin" className="admin-inventory-nav-link"><span>▦</span>Dashboard</Link>
          <Link to="/admin/orders" className="admin-inventory-nav-link"><span>▤</span>Orders</Link>
          <Link to="/admin/inventory" className="admin-inventory-nav-link active"><span>☷</span>Inventory</Link>
          <Link to="/admin/menu" className="admin-inventory-nav-link"><span>☷</span>Menu Management</Link>
          <span className="admin-inventory-nav-label nav-label-spaced">MANAGEMENT</span>
          <Link to="/admin/reports" className="admin-inventory-nav-link"><span>▥</span>Reports</Link>
          <Link to="/admin/settings" className="admin-inventory-nav-link"><span>⚙</span>Settings</Link>
        </nav>

        <div className="admin-inventory-sidebar-bottom">
          <Link to="/" className="admin-inventory-nav-link"><span>←</span>Back to Website</Link>
          <Link to="/login" className="admin-inventory-nav-link logout-link"><span>↪</span>Log Out</Link>
        </div>
      </aside>

      <main className="admin-inventory-main">
        <header className="admin-inventory-topbar">
          <div>
            <span className="admin-inventory-section-label">ADMIN PORTAL</span>
            <h1>Inventory</h1>
          </div>
          <div className="admin-inventory-topbar-actions">
            <button type="button" className="admin-inventory-icon-button" aria-label="Notifications">♢<b>0</b></button>
            <div className="admin-inventory-user">
              <div className="admin-inventory-avatar">A</div>
              <div>
                <strong>Administrator</strong>
                <span>Admin</span>
              </div>
            </div>
          </div>
        </header>

        <div className="admin-inventory-content">
          <section className="admin-inventory-heading">
            <div>
              <span className="admin-inventory-eyebrow">STOCK OVERVIEW</span>
              <h2>Inventory management</h2>
              <p>Track ingredients, packaging, and supplies needed for your daily operations.</p>
            </div>
            <button type="button" className="admin-inventory-add-button" onClick={() => setShowForm(true)}>
              <span>＋</span> Add inventory
            </button>
          </section>

          <section className="admin-inventory-stats" aria-label="Inventory summary">
            <div>
              <span className="inventory-stat-icon amber">☷</span>
              <div>
                <small>Total items</small>
                <strong>{totalItems}</strong>
                <span>Tracked inventory</span>
              </div>
            </div>
            <div>
              <span className="inventory-stat-icon green">✓</span>
              <div>
                <small>In stock</small>
                <strong>{inStockCount}</strong>
                <span>Ready to use</span>
              </div>
            </div>
            <div>
              <span className="inventory-stat-icon orange">◷</span>
              <div>
                <small>Low stock</small>
                <strong>{lowStockCount}</strong>
                <span>Restock soon</span>
              </div>
            </div>
            <div>
              <span className="inventory-stat-icon plum">!</span>
              <div>
                <small>Out of stock</small>
                <strong>{outOfStockCount}</strong>
                <span>Needs ordering</span>
              </div>
            </div>
          </section>

          <section className="admin-inventory-toolbar">
            <div className="admin-inventory-tabs" role="tablist" aria-label="Inventory categories">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={activeCategory === category ? "active" : ""}
                  onClick={() => setActiveCategory(category)}
                >
                  {category}
                  <span>
                    {category === "All"
                      ? inventory.length
                      : inventory.filter((item) => item.category === category).length}
                  </span>
                </button>
              ))}
            </div>

            <label className="admin-inventory-search">
              <span>⌕</span>
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search inventory"
                aria-label="Search inventory"
              />
            </label>
          </section>

          <section className="admin-inventory-panel">
            <div className="admin-inventory-table-wrap">
              <table className="admin-inventory-table">
                <thead>
                  <tr>
                    <th>Inventory Item</th>
                    <th>Category</th>
                    <th>Quantity</th>
                    <th>Unit</th>
                    <th>Minimum Stock</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map((item) => {
                    const status = getInventoryStatus(item.quantity, item.minimumStock);

                    return (
                      <tr key={item.id}>
                        <td>{item.item}</td>
                        <td>{item.category}</td>
                        <td>{item.quantity}</td>
                        <td>{item.unit}</td>
                        <td>{item.minimumStock}</td>
                        <td>
                          <span className={`inventory-status ${status.toLowerCase().replace(/\s+/g, "-")}`}>
                            {status}
                          </span>
                        </td>
                        <td>
                          <div className="inventory-actions">
                            <button type="button" onClick={() => handleEdit(item)}>Edit</button>
                            <button type="button" onClick={() => handleRestock(item.id)}>Restock</button>
                            <button type="button" className="danger" onClick={() => handleDelete(item.id)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!filteredInventory.length && (
              <div className="admin-inventory-empty">
                <strong>No inventory items found</strong>
                <span>Try another search term or category.</span>
              </div>
            )}
          </section>
        </div>
      </main>

      {showForm && (
        <div className="admin-inventory-modal-backdrop" role="presentation" onClick={resetForm}>
          <form className="admin-inventory-modal" onSubmit={handleSave} role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="admin-inventory-modal-header">
              <div>
                <span className="admin-inventory-eyebrow">INVENTORY UPDATE</span>
                <h3>{editingItem ? "Edit inventory item" : "Add inventory item"}</h3>
              </div>
              <button type="button" onClick={resetForm} aria-label="Close form">×</button>
            </div>

            <div className="admin-inventory-form-grid">
              <label>
                Inventory Item
                <input
                  type="text"
                  value={formValues.item}
                  onChange={(event) => setFormValues({ ...formValues, item: event.target.value })}
                  placeholder="e.g. Coca-Cola"
                  required
                />
              </label>

              <label>
                Category
                <select
                  value={formValues.category}
                  onChange={(event) => setFormValues({ ...formValues, category: event.target.value })}
                >
                  {categories.filter((category) => category !== "All").map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </label>

              <label>
                Quantity
                <input
                  type="number"
                  value={formValues.quantity}
                  onChange={(event) => setFormValues({ ...formValues, quantity: event.target.value })}
                  min="0"
                  required
                />
              </label>

              <label>
                Unit
                <input
                  type="text"
                  value={formValues.unit}
                  onChange={(event) => setFormValues({ ...formValues, unit: event.target.value })}
                  placeholder="e.g. liters, pcs, kg"
                  required
                />
              </label>

              <label>
                Minimum Stock
                <input
                  type="number"
                  value={formValues.minimumStock}
                  onChange={(event) => setFormValues({ ...formValues, minimumStock: event.target.value })}
                  min="0"
                  required
                />
              </label>
            </div>

            <div className="admin-inventory-modal-actions">
              <button type="button" className="modal-cancel" onClick={resetForm}>Cancel</button>
              <button type="submit" className="modal-save">{editingItem ? "Save changes" : "Add item"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default AdminInventory;
