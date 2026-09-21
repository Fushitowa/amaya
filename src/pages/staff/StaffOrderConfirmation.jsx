import { useLocation, useNavigate } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";

function StaffOrderConfirmation() {
  const navigate = useNavigate();
  const location = useLocation();
  const order = location.state?.order || [];
  const customerName = location.state?.customerName || "Walk-in Customer";

  const subtotal = order.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );

  const serviceFee = subtotal * 0.1;
  const total = subtotal + serviceFee;

  const handleConfirm = () => {
    navigate("/staff/receipt", {
      state: {
        order,
        customerName,
        subtotal,
        serviceFee,
        total,
      },
    });
  };

  return (
    <div className="staff-order-confirmation-page" style={{
      minHeight: "100vh",
      background: "#f5efe9",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px 20px",
      fontFamily: "Inter, sans-serif",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "720px",
        background: "#fff",
        borderRadius: "20px",
        boxShadow: "0 18px 50px rgba(62, 45, 26, 0.12)",
        border: "1px solid #efe8df",
        overflow: "hidden",
      }}>
        <div style={{
          padding: "28px 28px 18px",
          borderBottom: "1px solid #f1e9e1",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
          background: "linear-gradient(135deg, #fffaf4, #f7f0eb)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <img src={amayaLogo} alt="Amaya Logo" style={{ width: "46px", height: "46px", borderRadius: "50%" }} />
            <div>
              <div style={{ fontSize: "12px", letterSpacing: "0.14em", color: "#9b7a5b", fontWeight: 700 }}>
                AMAYA
              </div>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "#351f14" }}>
                Order Confirmation
              </div>
            </div>
          </div>

          <div style={{
            background: "#f4ecdf",
            color: "#8d623d",
            borderRadius: "999px",
            padding: "8px 14px",
            fontSize: "11px",
            fontWeight: "700",
            letterSpacing: "0.08em",
          }}>
            PENDING REVIEW
          </div>
        </div>

        <div style={{ padding: "28px" }}>
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase", color: "#9a8d83" }}>
              Customer
            </div>
            <div style={{ fontSize: "24px", fontWeight: 700, color: "#2f241f", marginTop: "6px" }}>
              {customerName}
            </div>
          </div>

          <div style={{
            background: "#fbf8f5",
            border: "1px solid #efe6de",
            borderRadius: "14px",
            overflow: "hidden",
          }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 0.7fr 0.8fr",
              gap: "16px",
              padding: "14px 18px",
              background: "#f9f4ef",
              fontSize: "11px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#8c7a69",
              fontWeight: 700,
            }}>
              <span>Item</span>
              <span style={{ textAlign: "center" }}>Qty</span>
              <span style={{ textAlign: "right" }}>Amount</span>
            </div>

            {order.length > 0 ? (
              order.map((item) => (
                <div
                  key={item.title}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4fr 0.7fr 0.8fr",
                    gap: "16px",
                    padding: "16px 18px",
                    borderTop: "1px solid #f1eadf",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: "#352b26", marginBottom: "4px" }}>{item.title}</div>
                    <div style={{ fontSize: "11px", color: "#8a7b71" }}>{item.size || "Regular"}</div>
                  </div>
                  <div style={{ textAlign: "center", color: "#625750", fontWeight: 600 }}>{item.quantity}</div>
                  <div style={{ textAlign: "right", color: "#382d26", fontWeight: 700 }}>
                    ₱{((Number(item.price || 0) * Number(item.quantity || 0))).toFixed(2)}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: "26px 18px", textAlign: "center", color: "#8d8077" }}>
                No items in this order.
              </div>
            )}
          </div>

          <div style={{
            marginTop: "22px",
            marginLeft: "auto",
            maxWidth: "260px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#5d5049", fontSize: "14px" }}>
              <span>Subtotal</span>
              <strong>₱{subtotal.toFixed(2)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#5d5049", fontSize: "14px" }}>
              <span>Service Fee</span>
              <strong>₱{serviceFee.toFixed(2)}</strong>
            </div>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "19px",
              fontWeight: 800,
              color: "#2b211b",
              paddingTop: "10px",
              borderTop: "1px solid #ecdfd3",
            }}>
              <span>Total</span>
              <span>₱{total.toFixed(2)}</span>
            </div>
          </div>

          <div style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "12px",
            marginTop: "28px",
          }}>
            <button
              type="button"
              onClick={() => navigate("/staff/menu")}
              style={{
                padding: "12px 20px",
                borderRadius: "10px",
                border: "1px solid #d7cabd",
                background: "#fff",
                color: "#5e473a",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleConfirm}
              style={{
                padding: "12px 20px",
                borderRadius: "10px",
                border: "none",
                background: "linear-gradient(135deg, #8f5d36, #c88a52)",
                color: "#fff",
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 12px 26px rgba(143, 93, 54, 0.28)",
              }}
            >
              Confirm Order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StaffOrderConfirmation;
