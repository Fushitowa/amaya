import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { useMenu } from "../../context/MenuContext.jsx";
import { useOrders } from "../../context/OrdersContext.jsx";
import { StaffQuantityModal } from "./StaffQuantity.jsx";

import "../../assets/css/staff/staff-menu.css";
import "../../assets/css/sidebar-collapse.css";

const categoryTitles = {
  all: "All Items",
  drinks: "Drinks",
  milktea: "Milk Tea",
  snacks: "Snacks",
  dessert: "Desserts",
};

const categoryDescriptions = {
  all: "Browse the complete Amaya Drinks & Bites menu.",
  drinks: "Refreshing coolers, fruit juices, and classic café sodas.",
  milktea: "Creamy, rich milk teas with custom sweetness & toppings.",
  snacks: "Crispy bites, street food, and comfort snacks.",
  dessert: "Decadent desserts and sweet signature treats.",
};

function StaffMenu() {
  const { darkMode } = useTheme();
  const { products = [] } = useMenu() || {};
  const { orders = [] } = useOrders() || {};
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [orderType, setOrderType] = useState("Counter");
  const [customizingItem, setCustomizingItem] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Initialize order state, merging any itemToAdd from location state if supplied
  const [order, setOrder] = useState(() => {
    const initialItem = location.state?.itemToAdd;
    return initialItem ? [initialItem] : [];
  });

  // Group products by category key
  const allFormattedProducts = useMemo(() => {
    return products
      .filter((p) => p.available)
      .map((product) => {
        let categoryKey = "snacks";
        const cat = (product.category || "").toLowerCase();
        if (cat.includes("milk") || cat.includes("tea")) categoryKey = "milktea";
        else if (cat.includes("drink")) categoryKey = "drinks";
        else if (cat.includes("dessert")) categoryKey = "dessert";

        const basePrice = Number(String(product.price).replace(/[^0-9.]/g, "")) || 35;

        return {
          ...product,
          title: product.name || product.title,
          categoryKey,
          category: product.category,
          price: basePrice,
          sizeOptions: product.sizes || [
            { label: "Regular", price: basePrice },
            { label: "Large", price: basePrice + 15 },
          ],
        };
      });
  }, [products]);

  // Filter products by active category and search term
  const visibleItems = useMemo(() => {
    const query = searchTerm.toLowerCase().trim();
    return allFormattedProducts.filter((item) => {
      const matchesCategory = activeCategory === "all" || item.categoryKey === activeCategory;
      if (!matchesCategory) return false;
      if (!query) return true;

      const title = (item.title || "").toLowerCase();
      const desc = (item.description || "").toLowerCase();
      const cat = (item.category || "").toLowerCase();
      return title.includes(query) || desc.includes(query) || cat.includes(query);
    });
  }, [activeCategory, allFormattedProducts, searchTerm]);

  // Add standard regular item directly to cart
  const quickAddToOrder = (item) => {
    setOrder((currentOrder) => {
      const existing = currentOrder.find((entry) => entry.title === item.title && (entry.size === "Regular" || !entry.size));

      if (existing) {
        return currentOrder.map((entry) =>
          entry === existing ? { ...entry, quantity: entry.quantity + 1 } : entry
        );
      }

      return [
        ...currentOrder,
        {
          title: item.title,
          image: item.image,
          category: item.category,
          price: item.price,
          quantity: 1,
          size: "Regular",
        },
      ];
    });

    setToastMessage(`Added 1x ${item.title} to order`);
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Add customized item from the Modal
  const handleConfirmCustomized = (itemToAdd) => {
    setOrder((currentOrder) => {
      // If exactly identical item with same size & modifiers exists, increment quantity
      const existing = currentOrder.find(
        (entry) =>
          entry.title === itemToAdd.title &&
          entry.size === itemToAdd.size &&
          entry.sugarLevel === itemToAdd.sugarLevel &&
          JSON.stringify(entry.addons) === JSON.stringify(itemToAdd.addons)
      );

      if (existing) {
        return currentOrder.map((entry) =>
          entry === existing ? { ...entry, quantity: entry.quantity + itemToAdd.quantity } : entry
        );
      }

      return [...currentOrder, itemToAdd];
    });

    setCustomizingItem(null);
    setToastMessage(`Added ${itemToAdd.quantity}x ${itemToAdd.title} (${itemToAdd.size}) to order`);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const updateQuantity = (index, delta) => {
    setOrder((currentOrder) => {
      const target = currentOrder[index];
      if (!target) return currentOrder;

      const nextQty = target.quantity + delta;
      if (nextQty <= 0) {
        return currentOrder.filter((_, i) => i !== index);
      }

      return currentOrder.map((entry, i) =>
        i === index ? { ...entry, quantity: nextQty } : entry
      );
    });
  };

  const removeItem = (index) => {
    setOrder((currentOrder) => currentOrder.filter((_, i) => i !== index));
  };

  const clearCurrentOrder = () => {
    setOrder([]);
  };

  const totalItems = useMemo(() => {
    return order.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  }, [order]);

  const currentOrderTotal = useMemo(() => {
    return order.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  }, [order]);

  const handlePlaceOrder = () => {
    if (order.length === 0) return;

    navigate("/staff/order-confirmation", {
      state: {
        order,
        customerName: customerName.trim() || "Walk-in Customer",
        orderType,
      },
    });
  };

  return (
    <div className={`staff-menu-page ${darkMode ? "dark-mode" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {/* Sidebar Navigation */}
      <aside className="staff-menu-sidebar">
        <div className="staff-menu-brand">
          <SidebarLogoButton
            logo={amayaLogo}
            alt="Amaya"
            collapsed={sidebarCollapsed}
            onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
            className="staff-menu-logo-image"
          />
          <div className="staff-menu-brand-text">
            <span className="brand-kicker">Amaya</span>
            <span className="brand-label">Staff POS Menu</span>
          </div>
        </div>

        <nav className="staff-menu-dashboard-navigation">
          <div className="staff-menu-nav-title">MAIN MENU</div>
          <Link to="/staff" className="staff-menu-nav-link">
            <span className="staff-menu-nav-icon">▦</span>
            <span>Dashboard</span>
          </Link>
          <Link to="/staff/orders" className="staff-menu-nav-link">
            <span className="staff-menu-nav-icon">▤</span>
            <span>Orders</span>
            <span className="staff-menu-nav-badge">{orders.length}</span>
          </Link>
          <Link to="/staff/menu" className="staff-menu-nav-link active">
            <span className="staff-menu-nav-icon">☷</span>
            <span>POS Menu</span>
          </Link>

          <div className="staff-menu-nav-title" style={{ marginTop: "20px" }}>CONFIG</div>
          <Link to="/staff/settings" className="staff-menu-nav-link">
            <span className="staff-menu-nav-icon">⚙</span>
            <span>Settings</span>
          </Link>
        </nav>

        <div className="sidebar-bottom" style={{ marginTop: "auto", padding: "16px" }}>
          <Link to="/" className="back-to-site" style={{ display: "flex", gap: "8px", textDecoration: "none", color: "#6a5749", fontSize: "12px", fontWeight: 600 }}>
            <span>←</span> Back to Website
          </Link>
        </div>
      </aside>

      {/* Main Menu Grid Area */}
      <main className="staff-menu-main">
        <section className="staff-menu-top">
          <div>
            <span className="staff-menu-page-label">COUNTER POINT OF SALE</span>
            <h1>Menu & Quick Ordering</h1>
          </div>

          <div className="staff-menu-top-actions">
            <div className="staff-menu-search">
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search drinks, milk teas, snacks..."
                aria-label="Search menu items"
              />
            </div>
          </div>
        </section>

        {/* Category Tabs */}
        <section className="staff-menu-category-tabs" style={{ display: "flex", gap: "8px", overflowX: "auto", padding: "14px 0", borderBottom: "1px solid rgba(52, 39, 29, 0.08)" }}>
          {Object.entries(categoryTitles).map(([key, label]) => {
            const count = key === "all"
              ? allFormattedProducts.length
              : allFormattedProducts.filter((p) => p.categoryKey === key).length;

            return (
              <button
                key={key}
                type="button"
                className={`category-tab-btn ${activeCategory === key ? "active" : ""}`}
                onClick={() => setActiveCategory(key)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "8px",
                  border: activeCategory === key ? "1.5px solid #8b5e3c" : "1px solid #e5ded7",
                  background: activeCategory === key ? "#8b5e3c" : "#ffffff",
                  color: activeCategory === key ? "#ffffff" : "#5d4d43",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  whiteSpace: "nowrap",
                  transition: "all 0.18s ease",
                }}
              >
                <span>{label}</span>
                <span style={{ fontSize: "10px", opacity: 0.85 }}>({count})</span>
              </button>
            );
          })}
        </section>

        <section className="staff-menu-category-header" style={{ margin: "16px 0 12px" }}>
          <div>
            <span className="category-label" style={{ fontWeight: 700, color: "#8b5e3c", fontSize: "13px" }}>
              {categoryTitles[activeCategory]}
            </span>
            <p style={{ margin: "4px 0 0", color: "#8a7c73", fontSize: "12px" }}>
              {categoryDescriptions[activeCategory]}
            </p>
          </div>
          <span className="category-total" style={{ fontWeight: 600, fontSize: "12px", color: "#8a7c73" }}>
            {visibleItems.length} Available
          </span>
        </section>

        {/* Product Cards Grid */}
        <section className="staff-menu-grid">
          {visibleItems.length > 0 ? (
            visibleItems.map((item, index) => (
              <article
                className="staff-menu-card"
                key={`${item.title}-${index}`}
                style={{
                  background: "#ffffff",
                  border: "1px solid #ebdcd0",
                  borderRadius: "12px",
                  overflow: "hidden",
                  boxShadow: "0 4px 12px rgba(45, 31, 26, 0.04)",
                  display: "flex",
                  flexDirection: "column",
                  transition: "transform 0.18s ease, box-shadow 0.18s ease",
                }}
              >
                <div
                  className="staff-menu-card-image-wrap"
                  style={{ position: "relative", height: "130px", background: "#fcf9f6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                  onClick={() => setCustomizingItem(item)}
                  title="Click to customize modifiers"
                >
                  <img
                    src={item.image}
                    alt={item.title}
                    className="staff-menu-card-image"
                    style={{ maxHeight: "115px", objectFit: "contain" }}
                  />
                  <span
                    className="staff-menu-category-pill"
                    style={{ position: "absolute", top: "8px", left: "8px", background: "rgba(255, 255, 255, 0.9)", padding: "3px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700, color: "#70482f" }}
                  >
                    {item.category || categoryTitles[item.categoryKey]}
                  </span>
                  <span
                    style={{ position: "absolute", bottom: "8px", right: "8px", background: "#2d1f1a", color: "#fff", padding: "3px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 800 }}
                  >
                    ₱{item.price.toFixed(2)}
                  </span>
                </div>

                <div className="staff-menu-card-body" style={{ padding: "12px 14px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px", fontSize: "13.5px", fontWeight: 700, color: "#2d1f1a" }}>
                      {item.title}
                    </h3>
                    <p style={{ margin: 0, fontSize: "11px", color: "#8a7c73", lineHeight: 1.4, height: "30px", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.description || "Freshly made café staple."}
                    </p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "12px" }}>
                    <button
                      type="button"
                      onClick={() => setCustomizingItem(item)}
                      style={{
                        padding: "6px 8px",
                        borderRadius: "6px",
                        border: "1px solid #dcd1c6",
                        background: "#fff",
                        color: "#6b5548",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      ⚙ Customize
                    </button>

                    <button
                      type="button"
                      onClick={() => quickAddToOrder(item)}
                      style={{
                        padding: "6px 8px",
                        borderRadius: "6px",
                        border: "none",
                        background: "#8b5e3c",
                        color: "#fff",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                      }}
                    >
                      <span>+</span> Quick Add
                    </button>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <div className="staff-menu-empty" style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px 20px" }}>
              <p style={{ fontSize: "14px", color: "#8a7c73" }}>No menu items match &quot;{searchTerm}&quot; in this category.</p>
              <button
                type="button"
                onClick={() => { setActiveCategory("all"); setSearchTerm(""); }}
                style={{ padding: "8px 16px", borderRadius: "6px", background: "#8b5e3c", color: "#fff", border: "none", cursor: "pointer", marginTop: "10px", fontSize: "12px" }}
              >
                Reset Filters
              </button>
            </div>
          )}
        </section>
      </main>

      {/* Right Cart & POS Register Panel */}
      <aside className="staff-menu-order-panel" style={{ width: "340px", minWidth: "340px", borderLeft: "1px solid rgba(52, 39, 29, 0.09)", background: "#ffffff", padding: "20px", display: "flex", flexDirection: "column" }}>
        <div className="staff-menu-order-card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Cart Header */}
          <div className="staff-menu-order-card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #eee5dc", paddingBottom: "14px" }}>
            <div>
              <span className="order-label" style={{ display: "block", fontSize: "10px", fontWeight: 800, color: "#8b5e3c", letterSpacing: "1px" }}>
                CURRENT ORDER
              </span>
              <span className="order-count" style={{ fontSize: "14px", fontWeight: 700, color: "#2d1f1a" }}>
                {totalItems} item{totalItems === 1 ? "" : "s"}
              </span>
            </div>

            {order.length > 0 && (
              <button
                type="button"
                className="clear-order-button"
                onClick={clearCurrentOrder}
                style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", padding: "4px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700, cursor: "pointer" }}
              >
                Clear
              </button>
            )}
          </div>

          {/* Customer & Type Selector */}
          <div style={{ padding: "14px 0", borderBottom: "1px solid #eee5dc" }}>
            <label style={{ display: "block", fontSize: "10px", fontWeight: 700, color: "#8a7c73", textTransform: "uppercase", marginBottom: "4px" }}>
              Customer / Table
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer Name or Table #"
              style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1px solid #ded6ce", fontSize: "12px", color: "#2d1f1a", outline: "none", marginBottom: "8px" }}
            />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "4px" }}>
              {["Counter", "Takeout", "Dine-in"].map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setOrderType(type)}
                  style={{
                    padding: "5px 6px",
                    borderRadius: "6px",
                    border: orderType === type ? "1.5px solid #8b5e3c" : "1px solid #e5ded7",
                    background: orderType === type ? "#fbf5ef" : "#ffffff",
                    color: orderType === type ? "#70482f" : "#6a5749",
                    fontSize: "10px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Cart Items List */}
          <div className="staff-menu-order-list" style={{ flex: 1, overflowY: "auto", padding: "10px 0" }}>
            {order.length > 0 ? (
              order.map((item, idx) => (
                <div
                  className="staff-menu-order-row"
                  key={`${item.title}-${idx}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 0",
                    borderBottom: "1px dashed #efe7df",
                    gap: "8px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: "12px", color: "#2d1f1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: "10px", color: "#8a7c73" }}>
                      {item.size || "Regular"}
                      {item.sugarLevel ? ` · ${item.sugarLevel}` : ""}
                      {item.addons && item.addons.length > 0 ? ` · +${item.addons.join(", ")}` : ""}
                    </div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#8b5e3c", marginTop: "2px" }}>
                      ₱{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}
                    </div>
                  </div>

                  {/* Quantity Stepper */}
                  <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <button
                      type="button"
                      onClick={() => updateQuantity(idx, -1)}
                      style={{ width: "22px", height: "22px", borderRadius: "4px", border: "1px solid #dcd4cc", background: "#faf8f6", color: "#5d4d43", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
                    >
                      −
                    </button>
                    <span style={{ fontSize: "11px", fontWeight: 700, minWidth: "16px", textAlign: "center" }}>
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateQuantity(idx, 1)}
                      style={{ width: "22px", height: "22px", borderRadius: "4px", border: "1px solid #dcd4cc", background: "#faf8f6", color: "#5d4d43", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      style={{ background: "none", border: "none", color: "#b91c1c", fontSize: "14px", cursor: "pointer", marginLeft: "4px" }}
                      title="Remove item"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: "center", padding: "36px 12px", color: "#8a7c73" }}>
                <span style={{ fontSize: "28px", display: "block", marginBottom: "8px" }}>🛒</span>
                <strong style={{ display: "block", fontSize: "13px", color: "#3b2a20" }}>No items in order</strong>
                <span style={{ fontSize: "11px" }}>Tap any item card to customize or Quick Add to fill cart.</span>
              </div>
            )}
          </div>

          {/* Cart Footer & Checkout Button */}
          <div style={{ borderTop: "1px solid #eee5dc", paddingTop: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#7a6b63", marginBottom: "6px" }}>
              <span>Subtotal</span>
              <span>₱{currentOrderTotal.toFixed(2)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px", fontWeight: 800, color: "#2d1f1a", marginBottom: "14px" }}>
              <span>Total Due</span>
              <span style={{ color: "#8b5e3c" }}>₱{currentOrderTotal.toFixed(2)}</span>
            </div>

            <button
              type="button"
              disabled={order.length === 0}
              onClick={handlePlaceOrder}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "8px",
                border: "none",
                background: order.length > 0 ? "linear-gradient(135deg, #8b5e3c, #70482f)" : "#dcd4cc",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: order.length > 0 ? "pointer" : "not-allowed",
                boxShadow: order.length > 0 ? "0 8px 20px rgba(112, 72, 47, 0.25)" : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                transition: "all 0.2s ease",
              }}
            >
              <span>Place Order & Checkout</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Staff Quantity & Modifiers Modal (Inline Popup) */}
      {customizingItem && (
        <StaffQuantityModal
          product={customizingItem}
          onConfirm={handleConfirmCustomized}
          onCancel={() => setCustomizingItem(null)}
        />
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            background: "#2d1f1a",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: "8px",
            fontSize: "12px",
            fontWeight: 600,
            boxShadow: "0 6px 20px rgba(0, 0, 0, 0.25)",
            zIndex: 1200,
          }}
        >
          ✓ {toastMessage}
        </div>
      )}
    </div>
  );
}

export default StaffMenu;
