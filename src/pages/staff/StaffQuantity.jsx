import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import staffIcon from "../../assets/images/icon/staff.png";
import MenuProductImage from "../../components/MenuProductImage.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";
import {
  findProductById,
  parseMenuPrice,
  resolveProductAddons,
  resolveProductSizes,
  useMenu,
} from "../../context/MenuContext.jsx";

import "../../assets/css/staff/staff-quantity.css";

// Sugar-level presets were removed: drink sweetness is no longer chosen here.
// All size and add-on options come from the Admin catalog.

/**
 * Reusable Quantity & Modifiers Component used both as inline modal and standalone page
 */
export function QuantityModifierContent({ product, onConfirm, onCancel, orderId = "NEW" }) {
  const { products = [] } = useMenu() || {};
  const [quantity, setQuantity] = useState(1);

  // Admin Menu Management owns sizes/add-ons. Resolve the live catalog record
  // by the product's unique id so edits appear without a redeploy.
  const catalogProduct = useMemo(() => {
    if (!product) return null;
    return findProductById(products, product.id) || product;
  }, [product, products]);

  const basePrice = useMemo(() => parseMenuPrice(catalogProduct?.price), [catalogProduct]);
  const sizeOptions = useMemo(() => resolveProductSizes(catalogProduct), [catalogProduct]);
  const addonOptions = useMemo(() => resolveProductAddons(catalogProduct), [catalogProduct]);

  const [selectedSize, setSelectedSize] = useState(sizeOptions[0]?.label || "Regular");
  const [selectedAddons, setSelectedAddons] = useState([]);
  const [instructions, setInstructions] = useState("");

  const currentSizeObj = useMemo(() => {
    return sizeOptions.find((size) => size.label === selectedSize) || sizeOptions[0];
  }, [sizeOptions, selectedSize]);

  const addonsTotal = useMemo(() => {
    return selectedAddons.reduce((sum, label) => {
      const addon = addonOptions.find((option) => option.label === label);
      return sum + (addon ? addon.price : 0);
    }, 0);
  }, [selectedAddons, addonOptions]);

  const unitTotal = Number(currentSizeObj?.price ?? basePrice) + addonsTotal;
  const grandTotal = unitTotal * quantity;
  const itemName = catalogProduct?.title || catalogProduct?.name;

  const toggleAddon = (label) => {
    setSelectedAddons((prev) =>
      prev.includes(label) ? prev.filter((entry) => entry !== label) : [...prev, label]
    );
  };

  const handleAdd = () => {
    const itemToAdd = {
      productId: catalogProduct?.id,
      title: itemName,
      image: catalogProduct?.image,
      category: catalogProduct?.category,
      description: catalogProduct?.description,
      price: unitTotal,
      quantity,
      size: selectedSize,
      addons: [...selectedAddons],
      instructions: instructions.trim() || undefined,
    };

    onConfirm(itemToAdd);
  };

  return (
    <section className="staff-quantity-workspace">
      {/* Product Overview */}
      <section className="quantity-product-card">
        <div>
          <div className="quantity-product-image-wrap">
            <MenuProductImage
              src={catalogProduct?.image}
              alt={itemName || ""}
              className="quantity-product-image"
              fallbackStyle={{ width: 220, height: 220, borderRadius: 10 }}
            />
          </div>
          <span className="quantity-product-category">{catalogProduct?.category || "Menu Item"}</span>
          <h2 className="quantity-product-title">{itemName}</h2>
          <p className="quantity-product-description">
            {catalogProduct?.description || "Freshly crafted favorite from Amaya Drinks & Bites."}
          </p>
        </div>

        <div className="quantity-product-meta">
          <span className="price-label">Base price</span>
          <span className="unit-price">₱{basePrice.toFixed(2)}</span>
        </div>
      </section>

      {/* Modifiers & Quantity */}
      <section className="quantity-form-card">
        <div className="quantity-form-header">
          <div>
            <span className="section-kicker">CUSTOMIZE ITEM</span>
            <h2>Modifiers &amp; Quantity</h2>
          </div>
          <span className="order-id">Order #{orderId}</span>
        </div>

        <div className="quantity-form-grid">
          <div className="quantity-form-group">
            <label className="quantity-label">Quantity</label>
            <div className="quantity-stepper">
              <button
                type="button"
                className="quantity-button"
                onClick={() => setQuantity((q) => Math.max(q - 1, 1))}
                aria-label="Decrease quantity"
              >
                −
              </button>
              <span className="quantity-value">{quantity}</span>
              <button
                type="button"
                className="quantity-button"
                onClick={() => setQuantity((q) => q + 1)}
                aria-label="Increase quantity"
              >
                +
              </button>
            </div>
          </div>

          <div className="quantity-form-group">
            <label className="quantity-label">Serving size</label>
            <div className="size-options">
              {sizeOptions.map((size) => (
                <button
                  key={size.label}
                  type="button"
                  className={`size-option ${selectedSize === size.label ? "selected" : ""}`}
                  onClick={() => setSelectedSize(size.label)}
                  aria-pressed={selectedSize === size.label}
                >
                  <strong>{size.label}</strong>
                  <span>₱{size.price.toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Add-ons - driven entirely by the Admin catalog */}
        {addonOptions.length > 0 && (
          <div className="quantity-addons">
            <label className="quantity-label">Add-ons / Extras</label>
            <div className="addon-options">
              {addonOptions.map((addon) => {
                const isChecked = selectedAddons.includes(addon.label);

                return (
                  <button
                    key={addon.label}
                    type="button"
                    className={`addon-option ${isChecked ? "selected" : ""}`}
                    onClick={() => toggleAddon(addon.label)}
                    aria-pressed={isChecked}
                  >
                    <span className="addon-option-name">{addon.label}</span>
                    <span className="addon-option-price">+₱{addon.price.toFixed(2)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="quantity-note">
          <label className="quantity-label" htmlFor="quantity-kitchen-note">
            Special instructions / kitchen note
          </label>
          <input
            id="quantity-kitchen-note"
            type="text"
            placeholder="e.g. Less ice, extra sauce on the side..."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </div>

        {/* Order breakdown */}
        <div className="quantity-summary">
          <div className="summary-row">
            <span className="summary-label">Item</span>
            <span className="summary-value">{itemName}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Selected size</span>
            <span className="summary-value">
              {selectedSize} (₱{Number(currentSizeObj?.price ?? basePrice).toFixed(2)})
            </span>
          </div>
          {selectedAddons.length > 0 && (
            <div className="summary-row">
              <span className="summary-label">Add-ons (+₱{addonsTotal.toFixed(2)})</span>
              <span className="summary-value">{selectedAddons.join(", ")}</span>
            </div>
          )}
          <div className="summary-row">
            <span className="summary-label">Quantity</span>
            <span className="summary-value">{quantity}</span>
          </div>
          <div className="summary-row total-row">
            <span className="summary-label">Total amount</span>
            <span className="summary-total">₱{grandTotal.toFixed(2)}</span>
          </div>
        </div>

        <div className="quantity-actions">
          <button type="button" className="cancel-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm-button" onClick={handleAdd}>
            Add to Order · ₱{grandTotal.toFixed(2)}
          </button>
        </div>
      </section>
    </section>
  );
}

/**
 * Staff Quantity Modal: Can be directly mounted inline inside StaffMenu.jsx
 */
export function StaffQuantityModal({ product, onConfirm, onCancel }) {
  if (!product) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(35, 25, 20, 0.65)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1100,
        padding: "20px",
        overflowY: "auto",
      }}
      onClick={onCancel}
      role="presentation"
    >
      <div
        style={{
          width: "min(960px, 100%)",
          maxHeight: "92vh",
          overflowY: "auto",
          borderRadius: "16px",
          background: "#ffffff",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.35)",
          padding: "24px",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <QuantityModifierContent
          product={product}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </div>
    </div>
  );
}

/**
 * Default Route Component for /staff/quantity
 */
function StaffQuantity() {
  const { darkMode } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  // The product is always supplied by the menu, identified by its catalog id.
  // There is no built-in sample item any more.
  const selectedProduct = location.state?.product || null;

  const handleConfirm = (itemToAdd) => {
    navigate("/staff/menu", {
      state: { itemToAdd },
    });
  };

  const handleCancel = () => {
    navigate("/staff/menu");
  };

  return (
    <div className={`staff-quantity-page ${darkMode ? "dark-mode" : ""}`}>
      <div className="staff-quantity-shell">
        <section className="staff-quantity-top">
          <div className="staff-quantity-brand">
            <img src={amayaLogo} alt="Amaya Logo" className="staff-quantity-logo" />
            <div>
              <span className="staff-quantity-kicker">Amaya</span>
              <span className="staff-quantity-label">Staff POS Modifier</span>
            </div>
          </div>

          <div className="staff-quantity-user">
            <span className="staff-quantity-user-icon">
              <img src={staffIcon} alt="" />
            </span>
            <span className="staff-quantity-user-name">Staff Station #1</span>
          </div>
        </section>

        {selectedProduct ? (
          <QuantityModifierContent
            product={selectedProduct}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
          />
        ) : (
          <section className="quantity-form-card" style={{ textAlign: "center", padding: "48px 24px" }}>
            <h2 style={{ margin: "0 0 8px", fontSize: "17px", color: "#2d1f1a" }}>No item selected</h2>
            <p style={{ margin: "0 0 20px", fontSize: "12px", color: "#8a7c73" }}>
              Pick a menu item first, then choose its size and add-ons.
            </p>
            <button type="button" className="confirm-button" onClick={handleCancel}>
              Back to Menu
            </button>
          </section>
        )}
      </div>
    </div>
  );
}

export default StaffQuantity;
