import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import staffIcon from "../../assets/images/icon/staff.png";
import defaultProductImage from "../../assets/images/menu/milktea/chocolate.png";
import { useTheme } from "../../context/ThemeContext.jsx";

import "../../assets/css/staff/staff-quantity.css";

// Sugar level presets for drinks & milk teas
const sugarLevels = ["100% (Normal)", "75% (Less)", "50% (Half)", "25% (Mild)", "0% (No Sugar)"];

// Available Add-ons with pricing
const addonOptions = [
  { id: "pearls", label: "Extra Pearls", price: 10 },
  { id: "nata", label: "Nata de Coco", price: 10 },
  { id: "cheese", label: "Cream Cheese Foam", price: 15 },
  { id: "sauce", label: "Extra Sauce / Drizzle", price: 10 },
];

/**
 * Reusable Quantity & Modifiers Component used both as inline modal and standalone page
 */
export function QuantityModifierContent({ product, onConfirm, onCancel, orderId = "NEW" }) {
  const [quantity, setQuantity] = useState(1);

  const fallbackSizes = useMemo(() => {
    return product?.sizeOptions || [
      { label: "Regular", price: Number(product?.price || 75) },
      { label: "Large", price: Number(product?.price || 75) + 15 },
    ];
  }, [product]);

  const [selectedSize, setSelectedSize] = useState(fallbackSizes[0]?.label || "Regular");
  const [selectedSugar, setSelectedSugar] = useState(sugarLevels[0]);
  const [selectedAddons, setSelectedAddons] = useState([]);
  const [instructions, setInstructions] = useState("");

  const currentSizeObj = useMemo(() => {
    return fallbackSizes.find((s) => s.label === selectedSize) || fallbackSizes[0];
  }, [fallbackSizes, selectedSize]);

  const addonsTotal = useMemo(() => {
    return selectedAddons.reduce((sum, addonId) => {
      const addon = addonOptions.find((a) => a.id === addonId);
      return sum + (addon ? addon.price : 0);
    }, 0);
  }, [selectedAddons]);

  const unitTotal = (Number(currentSizeObj?.price || product?.price || 75)) + addonsTotal;
  const grandTotal = unitTotal * quantity;

  const toggleAddon = (addonId) => {
    setSelectedAddons((prev) =>
      prev.includes(addonId) ? prev.filter((id) => id !== addonId) : [...prev, addonId]
    );
  };

  const isDrink = useMemo(() => {
    const cat = (product?.category || "").toLowerCase();
    return cat.includes("drink") || cat.includes("tea") || cat.includes("milk");
  }, [product]);

  const handleAdd = () => {
    const itemToAdd = {
      title: product.title || product.name,
      image: product.image,
      category: product.category,
      description: product.description,
      price: unitTotal,
      quantity,
      size: selectedSize,
      sugarLevel: isDrink ? selectedSugar : undefined,
      addons: selectedAddons.map((id) => addonOptions.find((a) => a.id === id)?.label).filter(Boolean),
      instructions: instructions.trim() || undefined,
    };

    onConfirm(itemToAdd);
  };

  return (
    <section className="staff-quantity-workspace">
      {/* Product Image & Details */}
      <section className="quantity-product-card">
        <div className="quantity-product-image-wrap">
          <img
            src={product.image || defaultProductImage}
            alt={product.title}
            className="quantity-product-image"
          />
        </div>

        <div className="quantity-product-info">
          <span className="quantity-product-category">{product.category || "Menu Item"}</span>
          <h2>{product.title}</h2>
          <p style={{ color: "#7a6a61", fontSize: "12px", margin: "6px 0 14px" }}>
            {product.description || "Freshly crafted favorite from Amaya Drinks & Bites."}
          </p>
          <div className="quantity-product-meta">
            <span className="price-label">Base Price</span>
            <span className="unit-price">₱{Number(product.price || 0).toFixed(2)}</span>
          </div>
        </div>
      </section>

      {/* Modifiers & Quantity Form */}
      <section className="quantity-form-card">
        <div className="quantity-form-header">
          <div>
            <span className="section-kicker">CUSTOMIZE ITEM</span>
            <h2>Modifiers & Quantity</h2>
          </div>
          <span className="order-id">Order #{orderId}</span>
        </div>

        <div className="quantity-form-grid">
          {/* Quantity Counter */}
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

          {/* Size Options */}
          <div className="quantity-form-group">
            <label className="quantity-label">Serving Size</label>
            <div className="size-options">
              {fallbackSizes.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  className={`size-option ${selectedSize === opt.label ? "selected" : ""}`}
                  onClick={() => setSelectedSize(opt.label)}
                >
                  <strong>{opt.label}</strong>
                  <span>₱{Number(opt.price || 0).toFixed(2)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sugar Level Modifier (For Drinks & Milktea) */}
        {isDrink && (
          <div style={{ marginTop: "16px" }}>
            <label className="quantity-label" style={{ display: "block", marginBottom: "8px", fontWeight: 700, fontSize: "11px", color: "#8a7c73" }}>
              Sugar Level
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {sugarLevels.map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setSelectedSugar(lvl)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    fontSize: "11px",
                    fontWeight: 600,
                    border: selectedSugar === lvl ? "1.5px solid #8b5e3c" : "1px solid #e2dad2",
                    background: selectedSugar === lvl ? "#fbf5ef" : "#ffffff",
                    color: selectedSugar === lvl ? "#70482f" : "#5d4d43",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Add-ons Selector */}
        <div style={{ marginTop: "16px" }}>
          <label className="quantity-label" style={{ display: "block", marginBottom: "8px", fontWeight: 700, fontSize: "11px", color: "#8a7c73" }}>
            Add-ons / Extras
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {addonOptions.map((addon) => {
              const isChecked = selectedAddons.includes(addon.id);
              return (
                <button
                  key={addon.id}
                  type="button"
                  onClick={() => toggleAddon(addon.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    fontSize: "11px",
                    fontWeight: 600,
                    border: isChecked ? "1.5px solid #8b5e3c" : "1px solid #e2dad2",
                    background: isChecked ? "#fbf5ef" : "#ffffff",
                    color: isChecked ? "#70482f" : "#5d4d43",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                >
                  <span>{isChecked ? "✓ " : "+ "}{addon.label}</span>
                  <span style={{ color: "#8b5e3c", fontWeight: 700 }}>+₱{addon.price}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Special Instructions Note */}
        <div style={{ marginTop: "16px" }}>
          <label className="quantity-label" style={{ display: "block", marginBottom: "6px", fontWeight: 700, fontSize: "11px", color: "#8a7c73" }}>
            Special Instructions / Kitchen Note
          </label>
          <input
            type="text"
            placeholder="e.g., Less ice, extra sauce on the side..."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "7px",
              border: "1px solid #ded5cc",
              fontSize: "12px",
              color: "#3b2a20",
              outline: "none",
            }}
          />
        </div>

        {/* Order Summary & Real-time Total */}
        <div className="quantity-summary" style={{ marginTop: "20px" }}>
          <div className="summary-row">
            <span className="summary-label">Item</span>
            <span className="summary-value">{product.title}</span>
          </div>
          <div className="summary-row">
            <span className="summary-label">Selected Size</span>
            <span className="summary-value">{selectedSize} (₱{currentSizeObj.price})</span>
          </div>
          {isDrink && (
            <div className="summary-row">
              <span className="summary-label">Sugar</span>
              <span className="summary-value">{selectedSugar}</span>
            </div>
          )}
          {selectedAddons.length > 0 && (
            <div className="summary-row">
              <span className="summary-label">Add-ons (+₱{addonsTotal})</span>
              <span className="summary-value">
                {selectedAddons.map((id) => addonOptions.find((a) => a.id === id)?.label).join(", ")}
              </span>
            </div>
          )}
          <div className="summary-row">
            <span className="summary-label">Quantity</span>
            <span className="summary-value">{quantity}</span>
          </div>
          <div className="summary-row total-row" style={{ paddingTop: "8px", borderTop: "1px solid #eadecf" }}>
            <span className="summary-label" style={{ fontWeight: 800, fontSize: "14px", color: "#2d1f1a" }}>
              Total Amount
            </span>
            <span className="summary-total" style={{ fontWeight: 800, fontSize: "18px", color: "#8b5e3c" }}>
              ₱{grandTotal.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="quantity-actions" style={{ marginTop: "18px" }}>
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

  const selectedProduct = location.state?.product || {
    title: "Classic Milk Tea",
    name: "Classic Milk Tea",
    category: "Milk Tea",
    image: defaultProductImage,
    price: 39,
    description: "Creamy and rich milk tea crafted with premium tea leaves.",
    sizeOptions: [
      { label: "Regular", price: 39 },
      { label: "Large", price: 54 },
    ],
  };

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

        <QuantityModifierContent
          product={selectedProduct}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      </div>
    </div>
  );
}

export default StaffQuantity;
