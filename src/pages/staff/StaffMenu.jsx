import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import "../../assets/css/staff/staff-menu.css";
import "../../assets/css/sidebar-collapse.css";

const categoryTitles = {
  drinks: "Drinks",
  snacks: "Snacks",
  milktea: "Milk Tea",
  dessert: "Desserts",
};

const categoryDescriptions = {
  drinks: "Refreshing drinks and crafted café favorites.",
  snacks: "Savory bites and comfort snack classics.",
  milktea: "Creamy and sweet milktea selections.",
  dessert: "Sweet desserts and finishing treats.",
};

function StaffMenu() {
  const { darkMode } = useTheme();
  const { products } = useMenu();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeCategory, setActiveCategory] = useState("drinks");
  const [searchTerm, setSearchTerm] = useState("");
  const [order, setOrder] = useState([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const imageGroups = products.filter((product) => product.available).reduce((groups, product) => {
    const category = Object.entries(categoryTitles).find(([, label]) => label === product.category)?.[0];
    if (!category) return groups;
    if (!groups[category]) groups[category] = [];
    groups[category].push({
      ...product,
      title: product.name,
      category: product.category,
      price: Number(String(product.price).replace("₱", "")),
      sizeOptions: product.sizes || [{ label: "Regular", price: Number(String(product.price).replace("₱", "")) }],
    });
    return groups;
  }, {});

  const visibleItems = (imageGroups[activeCategory] || []).filter((item) => {
    return `${item.title} ${item.description}`.toLowerCase().includes(searchTerm.toLowerCase());
  });

  const addToOrder = (item) => {
    setOrder((currentOrder) => {
      const existingItem = currentOrder.find((entry) => entry.title === item.title);

      if (existingItem) {
        return currentOrder.map((entry) =>
          entry.title === item.title ? { ...entry, quantity: entry.quantity + 1 } : entry
        );
      }

      return [...currentOrder, { ...item, quantity: 1 }];
    });
  };

  const updateOrderQuantity = (title, amount) => {
    setOrder((currentOrder) => {
      const selected = currentOrder.find((entry) => entry.title === title);

      if (!selected) return currentOrder;

      const nextQuantity = selected.quantity + amount;

      if (nextQuantity <= 0) {
        return currentOrder.filter((entry) => entry.title !== title);
      }

      return currentOrder.map((entry) =>
        entry.title === title ? { ...entry, quantity: nextQuantity } : entry
      );
    });
  };

  const clearCurrentOrder = () => {
    setOrder([]);
  };

  useEffect(() => {
    const itemToAdd = location.state?.itemToAdd;

    if (!itemToAdd) return;

    setOrder((currentOrder) => {
      const existingItem = currentOrder.find((entry) => entry.title === itemToAdd.title);

      if (existingItem) {
        return currentOrder.map((entry) =>
          entry.title === itemToAdd.title
            ? { ...entry, quantity: entry.quantity + itemToAdd.quantity, size: itemToAdd.size }
            : entry
        );
      }

      return [...currentOrder, itemToAdd];
    });
  }, [location.state]);

  const totalItems = order.reduce((sum, item) => sum + item.quantity, 0);
  const currentOrderTotal = order.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);

  const handlePlaceOrder = () => {
    if (order.length === 0) return;

    navigate("/staff/order-confirmation", {
      state: {
        order,
        customerName: "Walk-in Customer",
      },
    });
  };

  const openQuantityPage = (item) => {
    navigate("/staff/quantity", {
      state: {
        product: {
          ...item,
          category: categoryTitles[activeCategory],
          price: item.price ?? 75,
          sizeOptions: item.sizeOptions || [{ label: "Regular", price: item.price ?? 75 }],
        },
      },
    });
  };

  return (
    <div className={`staff-menu-page ${darkMode ? "dark-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="staff-menu-sidebar">
        <div className="staff-menu-brand">
          <SidebarLogoButton logo={amayaLogo} alt="Amaya" collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)} className="staff-menu-logo-image" />
          <div className="staff-menu-brand-text">
            <span className="brand-kicker">Amaya</span>
            <span className="brand-label">Staff Order Menu</span>
          </div>
        </div>

        <nav className="staff-menu-dashboard-navigation">
          <div className="staff-menu-nav-title">Main Menu</div>
          <Link to="/staff" className="staff-menu-nav-link">
            <span className="staff-menu-nav-icon">▦</span>
            <span>Dashboard</span>
          </Link>
          <Link to="/staff/orders" className="staff-menu-nav-link">
            <span className="staff-menu-nav-icon">▤</span>
            <span>Orders</span>
            <span className="staff-menu-nav-badge">5</span>
          </Link>
          <Link to="/staff/menu" className="staff-menu-nav-link active">
            <span className="staff-menu-nav-icon">☷</span>
            <span>Menu</span>
          </Link>
          <div className="staff-menu-nav-title spaced">Account</div>
          <Link to="/staff/settings" className="staff-menu-nav-link">
            <span className="staff-menu-nav-icon">⚙</span>
            <span>Settings</span>
          </Link>
        </nav>

        <div className="staff-menu-category-panel">
          <div className="staff-menu-nav-title">Categories</div>
          <nav className="staff-menu-category-nav">
            {Object.entries(categoryTitles).map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={`staff-menu-category-button ${activeCategory === id ? "active" : ""}`}
                onClick={() => setActiveCategory(id)}
              >
                <span className="category-icon">{id === "drinks" ? "☕" : id === "snacks" ? "☄" : id === "milktea" ? "✦" : "✎"}</span>
                <span>{label}</span>
                <span className="category-count">{imageGroups[id]?.length || 0}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="staff-menu-workstation">
          <span className="workstation-label">Order Station</span>
          <span className="workstation-time">Live</span>
        </div>
      </aside>

      <main className="staff-menu-main">
        <section className="staff-menu-top">
          <div>
            <span className="staff-menu-page-label">STAFF PORTAL</span>
            <h1>Customer Menu</h1>
          </div>
          <div className="staff-menu-top-actions">
            <div className="staff-menu-search">
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search menu..."
                aria-label="Search menu"
              />
            </div>
            <button type="button" className="staff-menu-refresh">
              ↻
            </button>
          </div>
        </section>

        <section className="staff-menu-category-header">
          <div>
            <span className="category-label">{categoryTitles[activeCategory]}</span>
            <p>{categoryDescriptions[activeCategory]}</p>
          </div>
          <span className="category-total">{visibleItems.length} Items</span>
        </section>

        <section className="staff-menu-grid">
          {visibleItems.length > 0 ? (
            visibleItems.map((item, index) => (
              <article
                className="staff-menu-card"
                key={`${item.title}-${index}`}
                onClick={() => openQuantityPage(item)}
                role="button"
                tabIndex="0"
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openQuantityPage(item);
                  }
                }}
              >
                <div className="staff-menu-card-image-wrap">
                  <img src={item.image} alt={item.title} className="staff-menu-card-image" />
                  <span className="staff-menu-category-pill">{categoryTitles[activeCategory]}</span>
                </div>

                <div className="staff-menu-card-body">
                  <div className="staff-menu-card-title-row">
                    <div>
                      <span className="staff-menu-card-category">{categoryTitles[activeCategory]}</span>
                      <h3>{item.title}</h3>
                    </div>
                    <button
                      type="button"
                      className="staff-menu-add-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        addToOrder(item);
                      }}
                      aria-label={`Add ${item.title} to order`}
                    >
                      +
                    </button>
                  </div>
                  <p>{item.description}</p>
                </div>
              </article>
            ))
          ) : (
            <div className="staff-menu-empty">
              <span>No menu items found</span>
            </div>
          )}
        </section>
      </main>

      <aside className="staff-menu-order-panel">
        <div className="staff-menu-order-card">
          <div className="staff-menu-order-card-head">
            <div>
              <span className="order-label">Current Order</span>
              <span className="order-count">{totalItems} item(s)</span>
            </div>
            <button type="button" className="clear-order-button" onClick={clearCurrentOrder}>
              Clear
            </button>
          </div>

          <div className="staff-menu-order-list">
            {order.length > 0 ? (
              order.map((item) => (
                <div className="staff-menu-order-row" key={item.title}>
                  <div className="order-row-left">
                    <span className="order-thumb">
                      <img src={item.image} alt="" />
                    </span>
                    <div>
                      <span className="order-title">{item.title}</span>
                      <span className="order-category">{categoryTitles[activeCategory]}</span>
                    </div>
                  </div>
                  <div className="order-controls">
                    <button type="button" onClick={() => updateOrderQuantity(item.title, -1)}>-</button>
                    <span>{item.quantity}</span>
                    <button type="button" onClick={() => updateOrderQuantity(item.title, 1)}>+</button>
                  </div>
                </div>
              ))
            ) : (
              <div className="staff-menu-empty-order">
                <span>No items selected</span>
              </div>
            )}
          </div>

          <div className="staff-menu-order-summary">
            <div className="summary-row">
              <span>Items</span>
              <span>{totalItems}</span>
            </div>
            <div className="summary-row total">
              <span>Total</span>
              <span>₱{currentOrderTotal.toFixed(2)}</span>
            </div>
          </div>

          <button
            type="button"
            className="staff-menu-submit-order"
            onClick={handlePlaceOrder}
            disabled={order.length === 0}
          >
            Place Order
          </button>
        </div>
      </aside>
    </div>
  );
}

export default StaffMenu;
