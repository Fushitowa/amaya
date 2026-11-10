import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  CakeSlice,
  ChevronUp,
  Coffee,
  Cookie,
  CupSoda,
  GlassWater,
  LayoutGrid,
  Menu,
  Plus,
  Sandwich,
  Search,
  Settings,
  ShoppingBag,
  Utensils,
  X,
} from "lucide-react";

import Sidebar from "../../components/Sidebar.jsx";
import StaffNotificationBell from "../../components/StaffNotificationBell.jsx";
import StaffOperationsBar from "../../components/StaffOperationsBar.jsx";
import MenuProductImage from "../../components/MenuProductImage.jsx";
import staffAvatar from "../../assets/images/icon/staff1.svg";
import { useAuth } from "../../context/AuthContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import { useMenu, resolveProductSizes } from "../../context/MenuContext.jsx";
import { useOrders } from "../../context/OrdersContext.jsx";
import {
  canFulfillCartAddition,
  getDefaultProductSize,
  normalizeBaseSizeLabel,
} from "../../utils/cartStock.js";
import { StaffQuantityModal } from "./StaffQuantity.jsx";

import "../../assets/css/staff/staff-menu.css";
import "../../assets/css/portal-user.css";
import "../../assets/css/sidebar.css";
import "../../assets/css/sidebar-collapse.css";

const categoryTitles = {
  all: "All Items",
  "foods / snacks": "Foods & Snacks",
  "fries & sip": "Fries & Sip",
  "burgers and hotdogs": "Burgers & Hotdogs",
  desserts: "Desserts",
  dessert: "Desserts",
  milktea: "Milk Tea",
  "milk tea": "Milk Tea",
  "float series": "Float Series",
  "fruity soda": "Fruity Soda",
  "fruity milk": "Fruity Milk",
  "iced coffee": "Iced Coffee",
  drinks: "Drinks",
  snacks: "Snacks",
};

const categoryIcons = {
  all: LayoutGrid,
  "foods / snacks": Utensils,
  "fries & sip": Utensils,
  "burgers and hotdogs": Sandwich,
  desserts: CakeSlice,
  dessert: CakeSlice,
  milktea: CupSoda,
  "milk tea": CupSoda,
  "float series": CupSoda,
  "fruity soda": GlassWater,
  "fruity milk": GlassWater,
  "iced coffee": Coffee,
  drinks: CupSoda,
  snacks: Cookie,
};

const getCategoryTitle = (key) => {
  if (!key) return "General";
  if (key === "all") return "All Items";
  const normalized = String(key).toLowerCase().trim();
  return Object.hasOwn(categoryTitles, normalized) ? categoryTitles[normalized] : key;
};

function StaffMenu() {
  const { darkMode } = useTheme();
  const { user } = useAuth() || {};
  const cashierName = user?.displayName || "Cashier";
  const { products = [] } = useMenu() || {};
  const { orders = [] } = useOrders() || {};
  const navigate = useNavigate();
  const location = useLocation();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 800px)").matches
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const sync = () => setIsMobile(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [customerName, setCustomerName] = useState("Walk-in Customer");
  const [customerNote, setCustomerNote] = useState("");
  const [orderType, setOrderType] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("amaya-staff-preferences") || "{}");
      return saved.defaultOrderType === "Takeout" ? "Takeout" : "Dine-in";
    } catch {
      return "Dine-in";
    }
  });
  const [customizingItem, setCustomizingItem] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // Initialize order state, merging any itemToAdd from location state if supplied
  const [order, setOrder] = useState(() => {
    const initialItem = location.state?.itemToAdd;
    return initialItem ? [initialItem] : [];
  });

  // Group products and normalize base pricing
  const allFormattedProducts = useMemo(() => {
    return products
      .filter((p) => p.available !== false)
      .map((product) => {
        const basePrice = Number(String(product.price).replace(/[^0-9.]/g, "")) || 35;
        const stockNum = Number(product.stock);

        return {
          ...product,
          title: product.name || product.title,
          category: product.category || "General",
          price: basePrice,
          stock: Number.isFinite(stockNum) ? stockNum : Infinity,
          id: product.id,
          // Size variants come from the Admin catalog only.
          sizeOptions: resolveProductSizes(product),
        };
      });
  }, [products]);

  // Derive dynamic category list based on catalog products
  const dynamicCategories = useMemo(() => {
    const rawCategories = allFormattedProducts.map((p) => String(p.category || "").trim()).filter(Boolean);
    const unique = Array.from(new Set(rawCategories));
    return ["all", ...unique];
  }, [allFormattedProducts]);

  // Filter products by active category and search term
  const visibleItems = useMemo(() => {
    const query = String(searchTerm || "").toLowerCase().trim();
    return allFormattedProducts.filter((item) => {
      const matchesCategory = activeCategory === "all" || item.category === activeCategory;
      if (!matchesCategory) return false;
      if (!query) return true;

      const title = String(item.title || "").toLowerCase();
      const desc = String(item.description || "").toLowerCase();
      const cat = String(item.category || "").toLowerCase();
      return title.includes(query) || desc.includes(query) || cat.includes(query);
    });
  }, [activeCategory, allFormattedProducts, searchTerm]);

  const isItemOutOfStock = (item) => {
    if (Number(item.stock) <= 0) return true;
    if (Array.isArray(item.ingredientShortages) && item.ingredientShortages.length > 0) return true;
    const defaultSize = getDefaultProductSize(item);
    const defaultSizeLabel = defaultSize?.label || "Regular";
    const check = canFulfillCartAddition({
      cartItems: [],
      catalogProducts: products,
      targetProduct: item,
      sizeLabel: defaultSizeLabel,
      addons: [],
      addQuantity: 1,
    });
    return !check.allowed;
  };

  // Add standard regular item directly to cart using the product's catalog default size
  const quickAddToOrder = (item) => {
    const defaultSize = getDefaultProductSize(item);
    const defaultSizeLabel = defaultSize?.label || "Regular";
    const defaultSizePrice = Number(defaultSize?.price ?? item.price);

    // Quick Add always sells the DEFAULT size, so its cap comes from that size's
    // own ingredient stock (never the product-level stock, which may be the max
    // across sizes). Products with no recipe fall back to catalog stock inside
    // canFulfillCartAddition.
    const hasShortages = Array.isArray(item.ingredientShortages) && item.ingredientShortages.length > 0;
    const defaultSizeStock = canFulfillCartAddition({
      cartItems: [],
      catalogProducts: products,
      targetProduct: item,
      sizeLabel: defaultSizeLabel,
      addons: [],
      addQuantity: 1,
    });
    if (item.recipeConfigured === false || hasShortages || !defaultSizeStock.allowed) {
      setToastMessage(`${item.title} cannot be quick-added due to insufficient stock or recipe setup`);
      setTimeout(() => setToastMessage(null), 2500);
      return;
    }

    let added = false;
    setOrder((currentOrder) => {
      const stockCheck = canFulfillCartAddition({
        cartItems: currentOrder,
        catalogProducts: products,
        targetProduct: item,
        sizeLabel: defaultSizeLabel,
        addons: [],
        addQuantity: 1,
      });
      if (!stockCheck.allowed) {
        return currentOrder;
      }

      const existing = currentOrder.find(
        (entry) =>
          entry.productId === item.id &&
          normalizeBaseSizeLabel(entry.size) === normalizeBaseSizeLabel(defaultSizeLabel) &&
          (!entry.addons || entry.addons.length === 0) &&
          !entry.instructions &&
          !entry.notes
      );

      if (existing) {
        added = true;
        return currentOrder.map((entry) =>
          entry === existing
            ? {
                ...entry,
                size: defaultSizeLabel,
                price: defaultSizePrice,
                quantity: entry.quantity + 1,
              }
            : entry
        );
      }

      added = true;
      return [
        ...currentOrder,
        {
          productId: item.id,
          title: item.title,
          image: item.image,
          category: item.category,
          price: defaultSizePrice,
          quantity: 1,
          size: defaultSizeLabel,
        },
      ];
    });

    if (added) {
      setToastMessage(`Added 1x ${item.title} (${defaultSizeLabel}) to order`);
    } else {
      setToastMessage(`Maximum available stock reached for ${item.title}`);
    }
    setTimeout(() => setToastMessage(null), 2500);
  };

  // Add customized item from the Modal
  const handleConfirmCustomized = (itemToAdd) => {
    setOrder((currentOrder) => {
      // Items merge only when they are the same catalog product with the same
      // size & modifiers. Catalog id wins when present so two distinct menu
      // items that share a title never collapse into one line.
      const existing = currentOrder.find(
        (entry) => {
          const sameProduct =
            entry.productId != null && itemToAdd.productId != null
              ? entry.productId === itemToAdd.productId
              : entry.title === itemToAdd.title;

          return (
            sameProduct &&
            normalizeBaseSizeLabel(entry.size) === normalizeBaseSizeLabel(itemToAdd.size) &&
            entry.sugarLevel === itemToAdd.sugarLevel &&
            JSON.stringify(entry.addons || []) === JSON.stringify(itemToAdd.addons || []) &&
            String(entry.instructions || entry.notes || "") === String(itemToAdd.instructions || itemToAdd.notes || "")
          );
        }
      );

      if (existing) {
        return currentOrder.map((entry) =>
          entry === existing
            ? { ...entry, size: itemToAdd.size, price: itemToAdd.price, quantity: entry.quantity + itemToAdd.quantity }
            : entry
        );
      }

      return [...currentOrder, itemToAdd];
    });

    setCustomizingItem(null);
    setToastMessage(`Added ${itemToAdd.quantity}x ${itemToAdd.title} (${itemToAdd.size}) to order`);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const updateQuantity = (index, delta) => {
    let blockedByStock = false;
    let blockedTitle = "";
    setOrder((currentOrder) => {
      const target = currentOrder[index];
      if (!target) return currentOrder;

      const catalogMatch = allFormattedProducts.find((p) => p.id === target.productId || p.title === target.title);
      if (delta > 0) {
        const stockCheck = canFulfillCartAddition({
          cartItems: currentOrder,
          catalogProducts: products,
          targetProduct: catalogMatch || target,
          sizeLabel: target.size,
          addons: target.addons || [],
          addQuantity: delta,
        });
        if (!stockCheck.allowed) {
          blockedByStock = true;
          blockedTitle = target.title;
          return currentOrder;
        }
      }

      // Stock for increases was already validated live by canFulfillCartAddition above.
      const nextQty = target.quantity + delta;
      if (nextQty <= 0) {
        return currentOrder.filter((_, i) => i !== index);
      }

      return currentOrder.map((entry, i) =>
        i === index ? { ...entry, quantity: nextQty } : entry
      );
    });

    if (blockedByStock) {
      setToastMessage(`Maximum available ingredient stock reached for ${blockedTitle}`);
      setTimeout(() => setToastMessage(null), 2500);
    }
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
        notes: customerNote.trim() || undefined,
      },
    });
  };

  return (
    <div
      className={`staff-menu-page ${darkMode ? "dark-mode" : ""} ${
        sidebarCollapsed ? "sidebar-collapsed" : ""
      } ${mobileNavOpen ? "mobile-nav-open" : ""} ${isMobile ? "is-mobile" : ""} ${
        mobileCartOpen ? "mobile-cart-open" : ""
      }`}
    >
      {/* Mobile Sidebar Backdrop */}
      {mobileNavOpen && (
        <div
          className="staff-menu-mobile-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Navigation */}
      <Sidebar
        role="staff"
        activeTab="menu"
        orderCount={orders.filter((o) => o.status === "Pending").length}
        sidebarCollapsed={sidebarCollapsed}
        onToggle={() => {
          if (typeof window !== "undefined" && window.innerWidth <= 800) {
            setMobileNavOpen(false);
          } else {
            setSidebarCollapsed((c) => !c);
          }
        }}
      />

      {/* Main Menu Grid Area */}
      <main className="staff-menu-main">
        {/* Full-Width Edge-to-Edge POS Topbar */}
        <header className="staff-menu-top">
          <div className="staff-menu-top-brand-row">
            <button
              type="button"
              className="staff-menu-mobile-nav-btn"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation menu"
            >
              <Menu size={20} strokeWidth={2.2} />
            </button>

            <div className="staff-menu-top-left">
              <span className="staff-menu-top-eyebrow">STAFF PORTAL · POS REGISTER</span>
              <div className="staff-menu-top-heading">
                <h1 className="staff-menu-title">Menu &amp; Quick Ordering</h1>
                <span className="staff-menu-count-badge" aria-live="polite">
                  {visibleItems.length} Available
                </span>
              </div>
            </div>
          </div>

          <div className="staff-menu-top-actions">
            <div className="staff-menu-search">
              <span className="staff-menu-search-icon" aria-hidden="true">
                <Search size={16} strokeWidth={2.1} />
              </span>
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search drinks, bites, or categories..."
                aria-label="Search menu items"
              />
              {searchTerm && (
                <button
                  type="button"
                  className="staff-menu-search-clear"
                  onClick={() => setSearchTerm("")}
                  aria-label="Clear search"
                >
                  <X size={13} strokeWidth={2.4} aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="staff-menu-top-utility">
              <StaffOperationsBar variant="compact" darkMode={darkMode} />

              <StaffNotificationBell />

              <div className="staff-menu-user" title="Active POS Cashier">
                <div className="amaya-user-avatar">
                  <img src={staffAvatar} alt="" aria-hidden="true" className="tinted" />
                </div>
                <div className="staff-menu-user-info">
                  <strong>{cashierName}</strong>
                  <span>Barista &amp; Cashier</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Slim Horizontal Category Pill Row */}
        <section className="staff-menu-category-tabs" aria-label="Menu categories">
          {dynamicCategories.map((key) => {
            const label = getCategoryTitle(key);
            const isActive = activeCategory === key;
            const Icon = categoryIcons[String(key).toLowerCase().trim()] || Coffee;
            const count =
              key === "all"
                ? allFormattedProducts.length
                : allFormattedProducts.filter((p) => p.category === key).length;

            return (
              <button
                key={key}
                type="button"
                className={`category-tab-btn ${isActive ? "active" : ""}`}
                onClick={() => setActiveCategory(key)}
                aria-pressed={isActive}
              >
                <span className="category-tab-icon" aria-hidden="true">
                  <Icon size={15} strokeWidth={2.1} />
                </span>
                <span className="category-tab-label">{label}</span>
                <span className="category-tab-count">{count}</span>
              </button>
            );
          })}
        </section>

        {/* Product Cards Grid */}
        <section className="staff-menu-grid">
          {visibleItems.length > 0 ? (
            visibleItems.map((item, index) => {
              const isOutOfStock = isItemOutOfStock(item);
              const inCartQty = order
                .filter((o) => o.productId === item.id)
                .reduce((n, o) => n + Number(o.quantity || 0), 0);

              return (
                <article
                  className={`staff-menu-card ${isOutOfStock ? "out-of-stock" : ""} ${
                    inCartQty > 0 ? "is-selected" : ""
                  }`}
                  key={`${item.title}-${index}`}
                  onClick={() => {
                    if (!isOutOfStock) quickAddToOrder(item);
                  }}
                  role="button"
                  tabIndex={isOutOfStock ? -1 : 0}
                  aria-disabled={isOutOfStock}
                  onKeyDown={(e) => {
                    if (!isOutOfStock && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      quickAddToOrder(item);
                    }
                  }}
                  title={
                    isOutOfStock
                      ? `${item.title} is currently out of stock`
                      : `Click anywhere to add ${item.title} to order`
                  }
                >
                  <div className="staff-menu-card-image-wrap">
                    <MenuProductImage
                      src={item.image}
                      alt={item.title}
                      className="staff-menu-card-image"
                    />
                    <div className="staff-menu-card-image-badges">
                      <span className="staff-menu-category-pill">
                        {item.category || "Menu Item"}
                      </span>
                      {isOutOfStock ? (
                        <span className="staff-menu-out-of-stock-pill">
                          Out of Stock
                        </span>
                      ) : inCartQty > 0 ? (
                        <span className="staff-menu-in-cart-pill">
                          {inCartQty} in order
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="staff-menu-card-body">
                    <div className="staff-menu-card-head-row">
                      <h3 className="staff-menu-card-title" title={item.title}>
                        {item.title}
                      </h3>
                      <span className="staff-menu-card-price">
                        ₱{item.price.toFixed(2)}
                      </span>
                    </div>

                    <p
                      className="staff-menu-card-desc"
                      title={item.description || item.title}
                    >
                      {item.description || "Freshly prepared café signature item."}
                    </p>

                    <div
                      className="staff-menu-card-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="staff-menu-card-btn-custom"
                        onClick={() => setCustomizingItem(item)}
                        title="Customize size & modifiers"
                      >
                        <Settings size={13.5} strokeWidth={2.1} />
                        <span>Options</span>
                      </button>

                      <button
                        type="button"
                        className="staff-menu-card-btn-add"
                        onClick={() => quickAddToOrder(item)}
                        disabled={isOutOfStock}
                        title={
                          isOutOfStock
                            ? "This item is currently out of stock"
                            : "Add default size to order"
                        }
                      >
                        {isOutOfStock ? (
                          <span>Unavailable</span>
                        ) : (
                          <>
                            <Plus size={14} strokeWidth={2.6} aria-hidden="true" />
                            <span>{inCartQty > 0 ? `Add More (${inCartQty})` : "Add to Order"}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="staff-menu-empty">
              <p>
                No menu items match &quot;{searchTerm}&quot; in this category.
              </p>
              <button
                type="button"
                className="staff-menu-empty-reset"
                onClick={() => {
                  setActiveCategory("all");
                  setSearchTerm("");
                }}
              >
                Reset Filters
              </button>
            </div>
          )}
        </section>
      </main>

      {/* Mobile Cart Sheet Backdrop */}
      {mobileCartOpen && (
        <div
          className="staff-menu-cart-backdrop"
          onClick={() => setMobileCartOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Right Cart & POS Register Panel */}
      <aside className="staff-menu-order-panel">
        <div className="staff-menu-order-card">
          <div
            className="staff-menu-order-sheet-handle"
            onClick={() => setMobileCartOpen(false)}
            aria-hidden="true"
          >
            <span />
          </div>
          <div className="staff-menu-order-card-head">
            <div>
              <span className="order-label">
                Current Order
              </span>
              <span className="order-count">
                {totalItems} item{totalItems === 1 ? "" : "s"} · {order.length} line{order.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="staff-menu-order-head-actions">
              <span className="staff-menu-order-status">Draft</span>
              <button
                type="button"
                className="staff-menu-cart-close"
                onClick={() => setMobileCartOpen(false)}
                aria-label="Close order drawer"
              >
                <X size={18} strokeWidth={2.2} />
              </button>
            </div>
          </div>

          <section className="staff-menu-order-setup" aria-label="Order details">
            <div className="staff-menu-order-type-group">
              <span className="staff-menu-field-label">Order Type</span>
              <div className="staff-menu-order-types">
                {[{ name: "Takeout", Icon: ShoppingBag }, { name: "Dine-in", Icon: Utensils }].map(({ name, Icon }) => (
                  <button
                    key={name}
                    type="button"
                    className={`staff-menu-order-type${orderType === name ? " active" : ""}`}
                    onClick={() => setOrderType(name)}
                    aria-pressed={orderType === name}
                  >
                    <Icon size={16} strokeWidth={2} aria-hidden="true" />{name}
                  </button>
                ))}
              </div>
            </div>

            <label className="staff-menu-order-field" htmlFor="staff-order-customer">
              <span className="staff-menu-field-label">Customer Info</span>
              <input
                id="staff-order-customer"
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Walk-in Customer"
              />
            </label>

            <label className="staff-menu-order-field" htmlFor="staff-order-note">
              <span className="staff-menu-field-label">Customer Note</span>
              <textarea
                id="staff-order-note"
                rows="2"
                value={customerNote}
                onChange={(e) => setCustomerNote(e.target.value)}
                placeholder="Add a note for the kitchen..."
              />
            </label>
          </section>

          <div className="staff-menu-order-list-heading">
            <h2>Order List</h2>
            {order.length > 0 && (
              <button type="button" className="clear-order-button" onClick={clearCurrentOrder}>Remove all</button>
            )}
          </div>

          <div className="staff-menu-order-list">
            {order.length > 0 ? (
              order.map((item, idx) => {
                const catalogItem = allFormattedProducts.find((product) => product.id === item.productId);
                const image = item.image || catalogItem?.image;
                return (
                  <article className="staff-menu-order-row" key={`${item.title}-${idx}`}>
                    <div className="staff-menu-order-thumb">
                      {image ? <MenuProductImage src={image} alt="" /> : <CupSoda size={24} strokeWidth={1.8} aria-hidden="true" />}
                    </div>
                    <div className="staff-menu-order-item">
                      <div className="staff-menu-order-item-title" title={item.title}>{item.title}</div>
                      <div className="staff-menu-order-item-meta">
                        {item.size || "Regular"}{item.sugarLevel ? ` · ${item.sugarLevel}` : ""}{item.addons?.length ? ` · ${item.addons.join(", ")}` : ""}
                      </div>
                      {item.instructions || item.notes ? <div className="staff-menu-order-item-note">Note: {item.instructions || item.notes}</div> : null}
                      <div className="staff-menu-order-item-price">₱{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}</div>
                    </div>
                    <div className="staff-menu-order-quantity">
                      <button type="button" onClick={() => updateQuantity(idx, -1)} aria-label={`Decrease ${item.title} quantity`}>−</button>
                      <span>{item.quantity}</span>
                      <button type="button" onClick={() => updateQuantity(idx, 1)} aria-label={`Increase ${item.title} quantity`}>+</button>
                      <button type="button" className="staff-menu-remove-item" onClick={() => removeItem(idx)} title="Remove item" aria-label={`Remove ${item.title}`}>
                        ×
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="staff-menu-empty-order">
                <span className="empty-order-icon" aria-hidden="true"><ShoppingBag size={22} strokeWidth={1.8} /></span>
                <strong>No items yet</strong>
                <small>Choose a menu item to start this order.</small>
              </div>
            )}
          </div>

          <footer className="staff-menu-order-footer">
            <div className="staff-menu-summary-line">
              <span>Subtotal</span>
              <span>₱{currentOrderTotal.toFixed(2)}</span>
            </div>
            <div className="staff-menu-summary-line staff-menu-summary-total">
              <span>Total Due</span>
              <span>₱{currentOrderTotal.toFixed(2)}</span>
            </div>

            <button
              type="button"
              className="staff-menu-submit-order"
              disabled={order.length === 0}
              onClick={handlePlaceOrder}
            >
              Place Order &amp; Checkout <span aria-hidden="true">→</span>
            </button>
          </footer>
        </div>
      </aside>

      {/* Mobile Sticky Bottom Cart Bar */}
      <div className="staff-menu-mobile-cart-bar" role="region" aria-label="Order summary bar">
        <button
          type="button"
          className="staff-menu-mobile-cart-trigger"
          onClick={() => setMobileCartOpen((open) => !open)}
          aria-expanded={mobileCartOpen}
        >
          <span className="staff-menu-mobile-cart-badge">
            <ShoppingBag size={18} strokeWidth={2.2} />
            {totalItems > 0 && <b className="staff-menu-mobile-cart-count">{totalItems}</b>}
          </span>
          <span className="staff-menu-mobile-cart-meta">
            <strong>₱{currentOrderTotal.toFixed(2)}</strong>
            <small>
              {totalItems > 0
                ? `${totalItems} item${totalItems === 1 ? "" : "s"} · Tap to review order`
                : "No items yet · Tap to open register"}
            </small>
          </span>
          <ChevronUp
            size={18}
            strokeWidth={2.4}
            className={`staff-menu-mobile-cart-chevron ${mobileCartOpen ? "open" : ""}`}
            aria-hidden="true"
          />
        </button>

        <button
          type="button"
          className="staff-menu-mobile-cart-checkout"
          disabled={order.length === 0}
          onClick={handlePlaceOrder}
        >
          Checkout <span aria-hidden="true">→</span>
        </button>
      </div>

      {/* Staff Quantity & Modifiers Modal (Inline Popup) */}
      {customizingItem && (
        <StaffQuantityModal
          product={customizingItem}
          order={order}
          onConfirm={handleConfirmCustomized}
          onCancel={() => setCustomizingItem(null)}
        />
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="staff-menu-toast" role="status" aria-live="polite">
          ✓ {toastMessage}
        </div>
      )}
    </div>
  );
}

export default StaffMenu;
