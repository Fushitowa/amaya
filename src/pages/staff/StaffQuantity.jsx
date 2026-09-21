import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import staffIcon from "../../assets/images/icon/staff.png";
import defaultProductImage from "../../assets/images/menu/milktea/chocolate.png";
import { useTheme } from "../../context/ThemeContext.jsx";

import "../../assets/css/staff/staff-quantity.css";

function StaffQuantity() {
  const { darkMode } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const selectedProduct = location.state?.product;
  const [quantity, setQuantity] = useState(1);
  const fallbackSizeOptions = selectedProduct?.sizeOptions || [{ label: "Regular", price: selectedProduct?.price || 75 }];
  const [size, setSize] = useState(fallbackSizeOptions[0]?.label || "Regular");

  const product = {
    title: selectedProduct?.title || "Blueberry Milk Tea",
    name: selectedProduct?.title || "Blueberry Milk Tea",
    category: selectedProduct?.category || "Milktea",
    image: selectedProduct?.image || defaultProductImage,
    price: selectedProduct?.price || 89,
    description: selectedProduct?.description || "Creamy and sweet milktea selections.",
    sizeOptions: selectedProduct?.sizeOptions || fallbackSizeOptions,
  };

  const selectedSizeObject = product.sizeOptions.find((option) => option.label === size) || product.sizeOptions[0];
  const total = selectedSizeObject.price * quantity;

  const addToOrderAndReturn = () => {
    navigate("/staff/menu", {
      replace: false,
      state: {
        itemToAdd: {
          title: product.title,
          image: product.image,
          category: product.category,
          description: product.description,
          price: selectedSizeObject.price,
          quantity,
          size,
        },
      },
    });
  };

  return (
    <div className={`staff-quantity-page ${darkMode ? "dark-mode" : ""}`}>
      <div className="staff-quantity-shell">
        <section className="staff-quantity-top">
          <div className="staff-quantity-brand">
            <img src={amayaLogo} alt="Amaya Logo" className="staff-quantity-logo" />
            <div>
              <span className="staff-quantity-kicker">Amaya</span>
              <span className="staff-quantity-label">Staff Order</span>
            </div>
          </div>

          <div className="staff-quantity-user">
            <span className="staff-quantity-user-icon">
              <img src={staffIcon} alt="" />
            </span>
            <span className="staff-quantity-user-name">Staff</span>
          </div>
        </section>

        <section className="staff-quantity-workspace">
          <section className="quantity-product-card">
            <div className="quantity-product-image-wrap">
              <img src={product.image} alt={product.title} className="quantity-product-image" />
            </div>

            <div className="quantity-product-info">
              <span className="quantity-product-category">{product.category}</span>
              <h2>{product.title}</h2>
              <div className="quantity-product-meta">
                <span className="price-label">Unit Price</span>
                <span className="unit-price">₱{product.price}</span>
              </div>
            </div>
          </section>

          <section className="quantity-form-card">
            <div className="quantity-form-header">
              <div>
                <span className="section-kicker">Menu Item</span>
                <h2>Set Quantity & Size</h2>
              </div>
              <span className="order-id">Order #NEW</span>
            </div>

            <div className="quantity-form-grid">
              <div className="quantity-form-group">
                <label className="quantity-label">Quantity</label>
                <div className="quantity-stepper">
                  <button type="button" className="quantity-button" onClick={() => setQuantity(Math.max(quantity - 1, 1))}>−</button>
                  <span className="quantity-value">{quantity}</span>
                  <button type="button" className="quantity-button" onClick={() => setQuantity(quantity + 1)}>+</button>
                </div>
              </div>

              <div className="quantity-form-group">
                <label className="quantity-label">Size</label>
                <div className="size-options">
                  {product.sizeOptions.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      className={`size-option ${size === option.label ? "selected" : ""}`}
                      onClick={() => setSize(option.label)}
                    >
                      {option.label}
                      <span> ₱{option.price}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="quantity-summary">
              <div className="summary-row">
                <span className="summary-label">Item</span>
                <span className="summary-value">{product.title}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Size</span>
                <span className="summary-value">{size}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Quantity</span>
                <span className="summary-value">{quantity}</span>
              </div>
              <div className="summary-row total-row">
                <span className="summary-label">Estimated Total</span>
                <span className="summary-total">₱{total}</span>
              </div>
            </div>

            <div className="quantity-actions">
              <Link to="/staff/menu" className="cancel-button">
                Cancel
              </Link>
              <button type="button" className="confirm-button" onClick={addToOrderAndReturn}>
                Add to Order
              </button>
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}

export default StaffQuantity;
