import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import { useOrders } from "../../context/OrdersContext.jsx";
import { useTheme } from "../../context/ThemeContext.jsx";

const paymentMethods = [
  { id: "Cash", label: "Cash", icon: "💵", description: "Direct counter cash" },
  { id: "GCash", label: "GCash", icon: "📱", description: "QR / e-wallet transfer" },
  { id: "Card", label: "Card / Maya", icon: "💳", description: "POS debit/credit terminal" },
];

function StaffOrderConfirmation() {
  const { darkMode } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { addOrder } = useOrders() || {};

  const order = useMemo(() => location.state?.order || [], [location.state?.order]);
  const initialCustomer = location.state?.customerName || "Walk-in Customer";
  const initialType = location.state?.orderType || "Counter";

  const [customerName, setCustomerName] = useState(initialCustomer);
  const [orderType, setOrderType] = useState(initialType);
  const [selectedPayment, setSelectedPayment] = useState("Cash");
  const [cashTendered, setCashTendered] = useState("");

  const subtotal = useMemo(() => {
    return order.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    );
  }, [order]);

  const tenderedAmount = Number(cashTendered) || 0;
  const changeDue = Math.max(0, tenderedAmount - subtotal);
  const isShort = selectedPayment === "Cash" && cashTendered !== "" && tenderedAmount < subtotal;

  const handlePresetCash = (amount) => {
    setCashTendered(String(amount));
  };

  const handleConfirmOrder = () => {
    if (order.length === 0) {
      navigate("/staff/menu");
      return;
    }

    let savedOrder;
    if (addOrder) {
      savedOrder = addOrder({
        items: order,
        customerName: customerName.trim() || "Walk-in Customer",
        type: orderType,
      });
    }

    const orderId = savedOrder?.id || `AM-${String(Date.now()).slice(-6)}`;

    // Transition immediately to the receipt page
    navigate("/staff/receipt", {
      state: {
        order,
        customerName: customerName.trim() || "Walk-in Customer",
        orderType,
        paymentMethod: selectedPayment,
        cashTendered: selectedPayment === "Cash" ? tenderedAmount : subtotal,
        changeDue: selectedPayment === "Cash" ? changeDue : 0,
        subtotal,
        total: subtotal,
        orderId,
      },
    });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: darkMode ? "#1a1714" : "linear-gradient(180deg, #f8f2ee 0%, #f4eee9 100%)",
        color: darkMode ? "#f8ede3" : "#2d1f1a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "30px 16px",
        fontFamily: "'DM Sans', 'Inter', sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "760px",
          background: darkMode ? "#231f1b" : "#ffffff",
          borderRadius: "18px",
          border: darkMode ? "1px solid #44382d" : "1px solid #ebdcd0",
          boxShadow: "0 20px 50px rgba(45, 31, 26, 0.12)",
          overflow: "hidden",
        }}
      >
        {/* Header Bar */}
        <header
          style={{
            padding: "24px 28px",
            borderBottom: darkMode ? "1px solid #44382d" : "1px solid #eee4da",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: darkMode ? "#29241f" : "#fdfaf7",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <img
              src={amayaLogo}
              alt="Amaya Logo"
              style={{ width: "48px", height: "48px", borderRadius: "50%", background: "#fff", padding: "3px", border: "1px solid #ded5cb" }}
            />
            <div>
              <span style={{ fontSize: "11px", fontWeight: 800, color: "#8b5e3c", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                Amaya Drinks & Bites · POS Checkout
              </span>
              <h1 style={{ margin: "2px 0 0", fontSize: "20px", fontWeight: 700, color: darkMode ? "#fff" : "#2d1f1a" }}>
                Order Confirmation & Payment
              </h1>
            </div>
          </div>

          <span
            style={{
              padding: "6px 14px",
              borderRadius: "20px",
              fontSize: "11px",
              fontWeight: 800,
              background: "#fff3dc",
              color: "#b87923",
              border: "1px solid #f9dfad",
            }}
          >
            AWAITING PAYMENT
          </span>
        </header>

        {/* Content Body */}
        <div style={{ padding: "28px" }}>
          {/* Order Details & Customer Info Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "24px", marginBottom: "24px" }}>
            {/* Left: Customer Info & Order Type */}
            <div>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#8a7c73", textTransform: "uppercase", marginBottom: "6px" }}>
                Customer Name / Table Number
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Walk-in Customer"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: "8px",
                  border: darkMode ? "1px solid #554536" : "1px solid #dcd2c8",
                  background: darkMode ? "#1d1a16" : "#ffffff",
                  color: darkMode ? "#fff" : "#2d1f1a",
                  fontSize: "13px",
                  fontWeight: 600,
                  outline: "none",
                  marginBottom: "12px",
                }}
              />

              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#8a7c73", textTransform: "uppercase", marginBottom: "6px" }}>
                Service Type
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
                {["Counter", "Takeout", "Dine-in"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setOrderType(type)}
                    style={{
                      padding: "8px",
                      borderRadius: "8px",
                      border: orderType === type ? "1.5px solid #8b5e3c" : "1px solid #e0d7ce",
                      background: orderType === type ? "#fbf5ef" : (darkMode ? "#29241f" : "#ffffff"),
                      color: orderType === type ? "#70482f" : (darkMode ? "#cfbfb2" : "#6a5749"),
                      fontWeight: 700,
                      fontSize: "11px",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Payment Method Selector */}
            <div>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#8a7c73", textTransform: "uppercase", marginBottom: "6px" }}>
                Select Payment Method
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {paymentMethods.map((pm) => {
                  const isSelected = selectedPayment === pm.id;
                  return (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => setSelectedPayment(pm.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "9px 14px",
                        borderRadius: "8px",
                        border: isSelected ? "2px solid #8b5e3c" : "1px solid #e0d7ce",
                        background: isSelected ? "#fbf5ef" : (darkMode ? "#29241f" : "#ffffff"),
                        color: isSelected ? "#70482f" : (darkMode ? "#ecd9cb" : "#3b2a20"),
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <span style={{ fontSize: "16px" }}>{pm.icon}</span>
                        <div>
                          <strong style={{ display: "block", fontSize: "12px" }}>{pm.label}</strong>
                          <small style={{ color: "#8a7c73", fontSize: "10px" }}>{pm.description}</small>
                        </div>
                      </div>
                      {isSelected && <span style={{ color: "#8b5e3c", fontWeight: 800 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Cash Change Calculator (When Cash is selected) */}
          {selectedPayment === "Cash" && (
            <div
              style={{
                background: darkMode ? "#2c2621" : "#fdf9f5",
                border: "1px solid #ebdcd0",
                borderRadius: "12px",
                padding: "16px 20px",
                marginBottom: "24px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <span style={{ fontWeight: 700, fontSize: "12px", color: "#8b5e3c", textTransform: "uppercase" }}>
                  💵 Cash Change Calculator
                </span>
                <span style={{ fontSize: "11px", color: "#8a7c73" }}>
                  Total Due: <strong>₱{subtotal.toFixed(2)}</strong>
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "16px", alignItems: "center" }}>
                <div>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <span style={{ position: "absolute", left: "12px", fontWeight: 700, color: "#8b5e3c", fontSize: "15px" }}>₱</span>
                    <input
                      type="number"
                      placeholder="Enter cash received..."
                      value={cashTendered}
                      onChange={(e) => setCashTendered(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "10px 12px 10px 30px",
                        borderRadius: "8px",
                        border: isShort ? "1.5px solid #dc2626" : "1.5px solid #8b5e3c",
                        fontSize: "16px",
                        fontWeight: 700,
                        color: "#2d1f1a",
                        background: "#ffffff",
                        outline: "none",
                      }}
                    />
                  </div>

                  {/* Preset Quick Buttons */}
                  <div style={{ display: "flex", gap: "6px", marginTop: "8px" }}>
                    <button
                      type="button"
                      onClick={() => handlePresetCash(subtotal)}
                      style={{ padding: "4px 8px", borderRadius: "5px", border: "1px solid #ded6ce", background: "#fff", fontSize: "10px", fontWeight: 700, color: "#5d4d43", cursor: "pointer" }}
                    >
                      Exact (₱{subtotal})
                    </button>
                    {[100, 200, 500, 1000].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => handlePresetCash(amt)}
                        style={{ padding: "4px 8px", borderRadius: "5px", border: "1px solid #ded6ce", background: "#fff", fontSize: "10px", fontWeight: 700, color: "#5d4d43", cursor: "pointer" }}
                      >
                        ₱{amt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Change Result Display */}
                <div
                  style={{
                    padding: "12px 16px",
                    borderRadius: "8px",
                    background: isShort ? "#fef2f2" : "#f0fdf4",
                    border: isShort ? "1px solid #fecaca" : "1px solid #bbf7d0",
                    textAlign: "right",
                  }}
                >
                  <span style={{ display: "block", fontSize: "11px", fontWeight: 700, color: isShort ? "#dc2626" : "#166534" }}>
                    {isShort ? "⚠️ SHORT CASH BY" : "CHANGE DUE"}
                  </span>
                  <strong style={{ display: "block", fontSize: "20px", fontWeight: 800, color: isShort ? "#dc2626" : "#15803d" }}>
                    ₱{isShort ? (subtotal - tenderedAmount).toFixed(2) : changeDue.toFixed(2)}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* Itemized Order Table */}
          <div
            style={{
              background: darkMode ? "#1e1b18" : "#faf7f4",
              border: darkMode ? "1px solid #44382d" : "1px solid #eee4db",
              borderRadius: "12px",
              overflow: "hidden",
              marginBottom: "20px",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.6fr 0.6fr 0.8fr",
                padding: "10px 16px",
                background: darkMode ? "#29241f" : "#f2ece5",
                fontSize: "11px",
                fontWeight: 700,
                color: "#7a6b61",
                letterSpacing: "0.5px",
                textTransform: "uppercase",
              }}
            >
              <span>Item & Modifiers</span>
              <span style={{ textAlign: "center" }}>Qty</span>
              <span style={{ textAlign: "right" }}>Amount</span>
            </div>

            <div style={{ maxHeight: "180px", overflowY: "auto" }}>
              {order.length > 0 ? (
                order.map((item, idx) => (
                  <div
                    key={`${item.title}-${idx}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.6fr 0.6fr 0.8fr",
                      padding: "12px 16px",
                      borderTop: idx > 0 ? "1px dashed #e8ded4" : "none",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: "12px", color: darkMode ? "#fff" : "#2d1f1a" }}>{item.title}</strong>
                      <div style={{ fontSize: "10px", color: "#8a7c73" }}>
                        {item.size || "Regular"}
                        {item.sugarLevel ? ` · ${item.sugarLevel}` : ""}
                        {item.addons && item.addons.length > 0 ? ` · +${item.addons.join(", ")}` : ""}
                      </div>
                    </div>
                    <span style={{ textAlign: "center", fontSize: "12px", fontWeight: 700 }}>{item.quantity}</span>
                    <strong style={{ textAlign: "right", fontSize: "12px", color: "#8b5e3c" }}>
                      ₱{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}
                    </strong>
                  </div>
                ))
              ) : (
                <div style={{ padding: "24px", textAlign: "center", color: "#8a7c73" }}>No items in order</div>
              )}
            </div>
          </div>

          {/* Totals Summary */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "24px" }}>
            <div style={{ width: "260px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#7a6b61" }}>
                <span>Subtotal:</span>
                <span>₱{subtotal.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#7a6b61" }}>
                <span>Tax / VAT (0%):</span>
                <span>₱0.00</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "18px",
                  fontWeight: 800,
                  paddingTop: "8px",
                  borderTop: "1px solid #ebdcd0",
                  color: "#8b5e3c",
                }}
              >
                <span>Total Due:</span>
                <span>₱{subtotal.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #eee4db", paddingTop: "20px" }}>
            <button
              type="button"
              onClick={() => navigate("/staff/menu")}
              style={{
                padding: "10px 18px",
                borderRadius: "8px",
                border: "1px solid #ded5cb",
                background: "#ffffff",
                color: "#6b5548",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ← Modify Order
            </button>

            <button
              type="button"
              disabled={order.length === 0 || isShort}
              onClick={handleConfirmOrder}
              style={{
                padding: "12px 24px",
                borderRadius: "8px",
                border: "none",
                background: isShort ? "#dcd4cc" : "linear-gradient(135deg, #8b5e3c, #70482f)",
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: isShort ? "not-allowed" : "pointer",
                boxShadow: isShort ? "none" : "0 8px 24px rgba(112, 72, 47, 0.28)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>Confirm & Print Receipt</span>
              <span>⎙</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StaffOrderConfirmation;
