import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import cashIcon from "../../assets/images/icon/cash.svg";
import gcashIcon from "../../assets/images/icon/gcash.svg";
import { PAYMENT_STATUS_PAID, useOrders } from "../../context/OrdersContext.jsx";
import "../../assets/css/staff/staff-order-confirmation.css";

const paymentMethods = [
  { id: "Cash", label: "Cash", icon: cashIcon, description: "Direct counter cash" },
  { id: "GCash", label: "GCash", icon: gcashIcon, description: "QR / e-wallet transfer" },
];

const cashPresets = [100, 200, 500];

const theme = {
  page: "#FBF8F5",
  card: "#FFFFFF",
  panel: "#FBF8F5",
  panelAlt: "#F5EFE9",
  border: "#EBE0D6",
  borderSoft: "#F1E9E1",
  text: "#2D1F1A",
  textMuted: "#8A7C73",
  earth: "#5A3E2B",
  earthMid: "#8B5E3C",
  earthSoft: "#F4EBE3",
  green: "#15803D",
  greenSoft: "#E9F5EC",
  greenBorder: "#BFE3C9",
  amber: "#B87923",
  amberSoft: "#FFF3DC",
  amberBorder: "#F9DFAD",
  danger: "#DC2626",
  dangerSoft: "#FEF2F2",
  dangerBorder: "#FECACA",
};

function StaffOrderConfirmation() {
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
  const [isNarrow, setIsNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const sync = () => setIsNarrow(query.matches);

    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const subtotal = useMemo(() => {
    return order.reduce(
      (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
      0
    );
  }, [order]);

  const tenderedAmount = Number(cashTendered) || 0;
  const changeDue = Math.max(0, tenderedAmount - subtotal);
  const isShort = selectedPayment === "Cash" && cashTendered !== "" && tenderedAmount < subtotal;
  const isCash = selectedPayment === "Cash";

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
        paymentMethod: selectedPayment,
        cashTendered: isCash ? tenderedAmount : subtotal,
        changeDue: isCash ? changeDue : 0,
      });
    }

    const orderId = savedOrder?.id || `AM-${String(Date.now()).slice(-6)}`;

    navigate("/staff/receipt", {
      state: {
        order,
        customerName: customerName.trim() || "Walk-in Customer",
        orderType,
        paymentMethod: selectedPayment,
        paymentStatus: PAYMENT_STATUS_PAID,
        cashTendered: isCash ? tenderedAmount : subtotal,
        changeDue: isCash ? changeDue : 0,
        subtotal,
        total: subtotal,
        orderId,
      },
    });
  };

  const gridColumns = isNarrow ? "minmax(0, 1fr)" : "minmax(0, 1.08fr) minmax(0, 0.92fr)";
  const itemRowGrid = "minmax(0, 1fr) 58px 92px";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: theme.page,
        color: theme.text,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "28px 16px 40px",
        fontFamily: "'DM Sans', 'Inter', sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "880px",
          background: theme.card,
          borderRadius: "20px",
          border: `1px solid ${theme.border}`,
          boxShadow: "0 18px 44px rgba(45, 31, 26, 0.09)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "22px 28px",
            borderBottom: `1px solid ${theme.borderSoft}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            background: theme.panel,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "14px", minWidth: 0 }}>
            <img
              src={amayaLogo}
              alt="Amaya Logo"
              style={{
                width: "46px",
                height: "46px",
                flex: "0 0 46px",
                objectFit: "contain",
                borderRadius: "50%",
                background: "#fff",
                padding: "3px",
                border: `1px solid ${theme.border}`,
              }}
            />
            <div style={{ minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: "10.5px",
                  fontWeight: 800,
                  color: theme.earth,
                  letterSpacing: "1.3px",
                  textTransform: "uppercase",
                }}
              >
                Amaya&apos;s drinks and bites - POS checkout
              </span>
              <h1 style={{ margin: "3px 0 0", fontSize: "20px", fontWeight: 700, color: theme.text }}>
                Order confirmation and payment
              </h1>
            </div>
          </div>

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              flex: "0 0 auto",
              padding: "7px 15px",
              borderRadius: "999px",
              fontSize: "10.5px",
              fontWeight: 800,
              letterSpacing: "0.9px",
              textTransform: "uppercase",
              background: theme.greenSoft,
              color: theme.green,
              border: `1px solid ${theme.greenBorder}`,
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: "7px", height: "7px", borderRadius: "50%", background: theme.green }}
            />
            Paid at counter
          </span>
        </header>

        <div style={{ padding: "24px 28px 28px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isNarrow ? "minmax(0, 1fr)" : "minmax(0, 1.4fr) minmax(0, 1fr)",
              gap: "14px",
              alignItems: "end",
              marginBottom: "20px",
            }}
          >
            <div>
              <label
                htmlFor="confirm-customer"
                style={{
                  display: "block",
                  fontSize: "10px",
                  fontWeight: 700,
                  color: theme.textMuted,
                  letterSpacing: "0.8px",
                  textTransform: "uppercase",
                  marginBottom: "6px",
                }}
              >
                Customer name / table number
              </label>
              <input
                id="confirm-customer"
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Walk-in Customer"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: `1px solid ${theme.border}`,
                  background: theme.card,
                  color: theme.text,
                  fontSize: "13px",
                  fontWeight: 600,
                  outline: "none",
                }}
              />
            </div>

            <div>
              <span
                style={{
                  display: "block",
                  fontSize: "10px",
                  fontWeight: 700,
                  color: theme.textMuted,
                  letterSpacing: "0.8px",
                  textTransform: "uppercase",
                  marginBottom: "6px",
                }}
              >
                Service type
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px" }}>
                {["Counter", "Takeout", "Dine-in"].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setOrderType(type)}
                    aria-pressed={orderType === type}
                    style={{
                      padding: "9px 6px",
                      borderRadius: "10px",
                      border: orderType === type ? `1.5px solid ${theme.earth}` : `1px solid ${theme.border}`,
                      background: orderType === type ? theme.earthSoft : theme.card,
                      color: orderType === type ? theme.earth : theme.textMuted,
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
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: gridColumns,
              gap: "18px",
              alignItems: "start",
            }}
          >
            <section
              style={{
                padding: "18px 20px",
                borderRadius: "16px",
                background: theme.card,
                border: `1px solid ${theme.border}`,
              }}
            >
              <h2
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  margin: "0 0 14px",
                  fontSize: "11px",
                  fontWeight: 800,
                  letterSpacing: "1.1px",
                  textTransform: "uppercase",
                  color: theme.earth,
                }}
              >
                <img src={cashIcon} alt="" aria-hidden="true" style={{ width: "18px", height: "18px", objectFit: "contain" }} />
                Cash change calculator
              </h2>

              <div
                role="radiogroup"
                aria-label="Payment method"
                style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "14px" }}
              >
                {paymentMethods.map((pm) => {
                  const isSelected = selectedPayment === pm.id;

                  return (
                    <button
                      key={pm.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedPayment(pm.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px 12px",
                        borderRadius: "12px",
                        border: isSelected ? `2px solid ${theme.earth}` : `1px solid ${theme.border}`,
                        background: isSelected ? theme.earthSoft : theme.card,
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span
                        style={{
                          display: "grid",
                          placeItems: "center",
                          width: "34px",
                          height: "34px",
                          flex: "0 0 34px",
                          borderRadius: "9px",
                          background: isSelected ? theme.card : theme.panel,
                          border: `1px solid ${theme.border}`,
                        }}
                      >
                        <img src={pm.icon} alt="" aria-hidden="true" style={{ width: "19px", height: "19px", objectFit: "contain" }} />
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <strong style={{ display: "block", fontSize: "12px", color: theme.text }}>{pm.label}</strong>
                        <small style={{ display: "block", color: theme.textMuted, fontSize: "9.5px", lineHeight: 1.3 }}>{pm.description}</small>
                      </span>
                    </button>
                  );
                })}
              </div>

              {isCash ? (
                <>
                  <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                    <span
                      aria-hidden="true"
                      style={{ position: "absolute", left: "14px", fontWeight: 700, color: theme.earth, fontSize: "15px" }}
                    >
                      ₱
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      aria-label="Cash received"
                      placeholder="Enter cash received"
                      value={cashTendered}
                      onChange={(e) => setCashTendered(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "11px 12px 11px 32px",
                        borderRadius: "10px",
                        border: `1.5px solid ${isShort ? theme.danger : theme.earth}`,
                        background: theme.card,
                        color: theme.text,
                        fontSize: "17px",
                        fontWeight: 700,
                        outline: "none",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
                    <button
                      type="button"
                      onClick={() => setCashTendered(String(subtotal))}
                      style={{
                        padding: "7px 12px",
                        borderRadius: "9px",
                        border: "none",
                        background: theme.earth,
                        color: "#fff",
                        fontSize: "11px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Exact
                    </button>
                    {cashPresets.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => setCashTendered(String(amount))}
                        style={{
                          padding: "7px 12px",
                          borderRadius: "9px",
                          border: `1px solid ${theme.border}`,
                          background: theme.card,
                          color: theme.earthMid,
                          fontSize: "11px",
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        ₱{amount}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "13px 14px",
                    borderRadius: "10px",
                    background: theme.greenSoft,
                    border: `1px solid ${theme.greenBorder}`,
                  }}
                >
                  <img src={gcashIcon} alt="" aria-hidden="true" style={{ width: "20px", height: "20px", objectFit: "contain" }} />
                  <span style={{ fontSize: "11.5px", fontWeight: 700, color: theme.green }}>
                    Settled instantly via {selectedPayment}
                  </span>
                </div>
              )}
            </section>

            <section
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "18px 20px",
                borderRadius: "16px",
                background: theme.panel,
                border: `1px solid ${theme.border}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
                <span style={{ fontSize: "11px", color: theme.textMuted }}>
                  Total due: <strong style={{ color: theme.text }}>₱{subtotal.toFixed(2)}</strong>
                </span>
              </div>

              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "4px",
                  padding: "20px 16px",
                  borderRadius: "14px",
                  textAlign: "center",
                  background: isShort ? theme.dangerSoft : theme.greenSoft,
                  border: `1px solid ${isShort ? theme.dangerBorder : theme.greenBorder}`,
                }}
              >
                <span
                  style={{
                    fontSize: "10.5px",
                    fontWeight: 800,
                    letterSpacing: "1.2px",
                    textTransform: "uppercase",
                    color: isShort ? theme.danger : theme.green,
                  }}
                >
                  {isShort ? "Short cash by" : "Change due"}
                </span>
                <strong
                  style={{
                    fontSize: "30px",
                    fontWeight: 800,
                    lineHeight: 1.1,
                    letterSpacing: "-0.5px",
                    color: isShort ? theme.danger : theme.green,
                  }}
                >
                  ₱{isShort ? (subtotal - tenderedAmount).toFixed(2) : changeDue.toFixed(2)}
                </strong>
                {!isCash ? (
                  <span style={{ fontSize: "10.5px", color: theme.textMuted }}>No cash change for {selectedPayment}</span>
                ) : null}
              </div>
            </section>

            <section
              style={{
                padding: "18px 20px 8px",
                borderRadius: "16px",
                background: theme.card,
                border: `1px solid ${theme.border}`,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  marginBottom: "12px",
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    fontSize: "11px",
                    fontWeight: 800,
                    letterSpacing: "1.1px",
                    textTransform: "uppercase",
                    color: theme.earth,
                  }}
                >
                  Order items
                </h2>
                <span style={{ fontSize: "10.5px", color: theme.textMuted }}>
                  {order.length} item{order.length === 1 ? "" : "s"}
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: itemRowGrid,
                  padding: "8px 0",
                  borderTop: `1px solid ${theme.borderSoft}`,
                  borderBottom: `1px solid ${theme.borderSoft}`,
                  background: theme.panelAlt,
                  fontSize: "10px",
                  fontWeight: 700,
                  color: theme.textMuted,
                  letterSpacing: "0.6px",
                  textTransform: "uppercase",
                }}
              >
                <span style={{ paddingLeft: "12px" }}>Item</span>
                <span style={{ textAlign: "center" }}>Qty</span>
                <span style={{ textAlign: "right", paddingRight: "12px" }}>Amount</span>
              </div>

              <div className="amaya-item-scroll">
                {order.length > 0 ? (
                  order.map((item, idx) => (
                    <div
                      key={`${item.title}-${idx}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: itemRowGrid,
                        alignItems: "center",
                        padding: "9px 0",
                        borderTop: idx > 0 ? `1px dashed ${theme.borderSoft}` : "none",
                      }}
                    >
                      <div style={{ minWidth: 0, paddingLeft: "12px" }}>
                        <strong style={{ display: "block", fontSize: "12.5px", color: theme.text }}>{item.title}</strong>
                        {(item.size || item.sugarLevel || (item.addons && item.addons.length > 0)) ? (
                          <span style={{ display: "block", marginTop: "2px", fontSize: "10px", color: theme.textMuted, lineHeight: 1.35 }}>
                            {item.size || "Regular"}
                            {item.sugarLevel ? ` · ${item.sugarLevel}` : ""}
                            {item.addons && item.addons.length > 0 ? ` · +${item.addons.join(", ")}` : ""}
                          </span>
                        ) : null}
                      </div>
                      <span style={{ textAlign: "center", fontSize: "12.5px", fontWeight: 700, color: theme.text }}>
                        {item.quantity}
                      </span>
                      <strong style={{ textAlign: "right", paddingRight: "12px", fontSize: "12.5px", color: theme.earth }}>
                        ₱{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}
                      </strong>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: "28px 12px", textAlign: "center", color: theme.textMuted, fontSize: "12px" }}>
                    No items in this order yet
                  </div>
                )}
              </div>
            </section>

            <section
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "18px 20px",
                borderRadius: "16px",
                background: theme.panel,
                border: `1px solid ${theme.border}`,
              }}
            >
              <h2
                style={{
                  margin: "0 0 14px",
                  fontSize: "11px",
                  fontWeight: 800,
                  letterSpacing: "1.1px",
                  textTransform: "uppercase",
                  color: theme.earth,
                }}
              >
                Order summary
              </h2>

              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "7px 0", fontSize: "12.5px", color: theme.textMuted }}>
                <span>Subtotal</span>
                <span style={{ color: theme.text, fontWeight: 700 }}>₱{subtotal.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "7px 0", fontSize: "12.5px", color: theme.textMuted }}>
                <span>Tax / VAT (0%)</span>
                <span style={{ color: theme.text, fontWeight: 700 }}>₱0.00</span>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  marginTop: "10px",
                  padding: "16px",
                  borderRadius: "14px",
                  background: theme.greenSoft,
                  border: `1px solid ${theme.greenBorder}`,
                }}
              >
                <span
                  style={{
                    fontSize: "11.5px",
                    fontWeight: 800,
                    letterSpacing: "0.9px",
                    textTransform: "uppercase",
                    color: theme.green,
                  }}
                >
                  Total due
                </span>
                <strong style={{ fontSize: "24px", fontWeight: 800, letterSpacing: "-0.5px", color: theme.green }}>
                  ₱{subtotal.toFixed(2)}
                </strong>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginTop: "12px",
                  padding: "9px 12px",
                  borderRadius: "10px",
                  background: theme.card,
                  border: `1px solid ${theme.borderSoft}`,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ width: "7px", height: "7px", flex: "0 0 7px", borderRadius: "50%", background: theme.green }}
                />
                <span style={{ fontSize: "10.5px", fontWeight: 700, color: theme.green }}>
                  Payment status: PAID
                </span>
              </div>
            </section>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              flexWrap: "wrap",
              marginTop: "22px",
              paddingTop: "20px",
              borderTop: `1px solid ${theme.borderSoft}`,
            }}
          >
            <button
              type="button"
              onClick={() => navigate("/staff/menu")}
              style={{
                padding: "11px 18px",
                borderRadius: "10px",
                border: `1px solid ${theme.border}`,
                background: theme.card,
                color: theme.earthMid,
                fontSize: "12.5px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Back to menu
            </button>

            <button
              type="button"
              disabled={order.length === 0 || isShort}
              onClick={handleConfirmOrder}
              style={{
                padding: "13px 24px",
                borderRadius: "10px",
                border: "none",
                background: isShort ? "#DCD4CC" : theme.earth,
                color: "#ffffff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: isShort ? "not-allowed" : "pointer",
                boxShadow: isShort ? "none" : "0 8px 22px rgba(90, 62, 43, 0.26)",
                display: "flex",
                alignItems: "center",
                gap: "9px",
              }}
            >
              <span>Confirm &amp; print receipt</span>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StaffOrderConfirmation;
