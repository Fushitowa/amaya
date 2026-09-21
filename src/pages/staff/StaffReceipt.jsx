import { useLocation, useNavigate } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";

function StaffReceipt() {
  const navigate = useNavigate();
  const location = useLocation();
  const order = location.state?.order || [];
  const customerName = location.state?.customerName || "Walk-in Customer";
  const subtotal = Number(location.state?.subtotal || 0);
  const serviceFee = Number(location.state?.serviceFee || 0);
  const total = Number(location.state?.total || 0);

  const orderNumber = `AM-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const date = new Date().toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #f7f1ea, #efe5d8)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px 18px",
      fontFamily: "Inter, sans-serif",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "760px",
        background: "#fffdfb",
        borderRadius: "24px",
        boxShadow: "0 20px 60px rgba(63, 43, 20, 0.12)",
        border: "1px solid #f0e4d6",
        overflow: "hidden",
      }}>
        <div style={{
          background: "linear-gradient(135deg, #3a281e, #584439)",
          color: "#fff",
          padding: "28px 30px 20px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <img src={amayaLogo} alt="Amaya Logo" style={{ width: "52px", height: "52px", borderRadius: "50%" }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: "22px", letterSpacing: "0.04em" }}>AMAYA</div>
                <div style={{ fontSize: "12px", letterSpacing: "0.12em", opacity: 0.75, textTransform: "uppercase" }}>
                  Staff Receipt
                </div>
              </div>
            </div>

            <div style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "999px",
              padding: "8px 14px",
              fontSize: "11px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}>
              Confirmed
            </div>
          </div>
        </div>

        <div style={{ padding: "30px 30px 18px" }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            marginBottom: "18px",
            flexWrap: "wrap",
          }}>
            <div>
              <div style={{ fontSize: "12px", letterSpacing: "0.1em", color: "#9a8c7f", textTransform: "uppercase" }}>
                Receipt No.
              </div>
              <div style={{ fontSize: "22px", fontWeight: 800, color: "#2d221d" }}>{orderNumber}</div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "12px", letterSpacing: "0.1em", color: "#9a8c7f", textTransform: "uppercase" }}>
                Date
              </div>
              <div style={{ fontSize: "14px", color: "#554c45", fontWeight: 600 }}>{date}</div>
            </div>
          </div>

          <div style={{
            background: "#f9f4ef",
            borderRadius: "16px",
            padding: "18px",
            border: "1px solid #f0e6dd",
            marginBottom: "20px",
          }}>
            <div style={{ fontSize: "12px", letterSpacing: "0.1em", color: "#9a8c7f", textTransform: "uppercase" }}>
              Customer
            </div>
            <div style={{ fontSize: "18px", fontWeight: 700, color: "#2d221d", marginTop: "6px" }}>
              {customerName}
            </div>
          </div>

          <div style={{ border: "1px solid #efe4d8", borderRadius: "16px", overflow: "hidden" }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "1.5fr 0.8fr 0.9fr",
              gap: "12px",
              padding: "14px 18px",
              background: "#f8f1ec",
              fontSize: "11px",
              fontWeight: 800,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "#8b7565",
            }}>
              <span>Item</span>
              <span style={{ textAlign: "center" }}>Qty</span>
              <span style={{ textAlign: "right" }}>Price</span>
            </div>

            {order.length > 0 ? (
              order.map((item) => (
                <div
                  key={item.title}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.5fr 0.8fr 0.9fr",
                    gap: "12px",
                    padding: "16px 18px",
                    borderTop: "1px solid #f0e8e0",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, color: "#352e2a" }}>{item.title}</div>
                    <div style={{ fontSize: "11px", color: "#8e7e72", marginTop: "4px" }}>{item.size || "Regular"}</div>
                  </div>
                  <div style={{ textAlign: "center", color: "#5c4d45", fontWeight: 700 }}>{item.quantity}</div>
                  <div style={{ textAlign: "right", color: "#352e2a", fontWeight: 700 }}>
                    ₱{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}
                  </div>
                </div>
              ))
            ) : (
              <div style={{ padding: "22px 18px", textAlign: "center", color: "#8f8177" }}>
                No items recorded.
              </div>
            )}
          </div>

          <div style={{
            marginTop: "26px",
            marginLeft: "auto",
            maxWidth: "300px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", color: "#584d47" }}>
              <span>Subtotal</span>
              <strong>₱{subtotal.toFixed(2)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", color: "#584d47" }}>
              <span>Service Fee</span>
              <strong>₱{serviceFee.toFixed(2)}</strong>
            </div>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "20px",
              fontWeight: 800,
              color: "#251d19",
              paddingTop: "12px",
              borderTop: "1px solid #ecdfd3",
            }}>
              <span>Total</span>
              <span>₱{total.toFixed(2)}</span>
            </div>
          </div>

          <div style={{
            marginTop: "28px",
            paddingTop: "18px",
            borderTop: "1px dashed #e7d9ca",
            textAlign: "center",
            color: "#7f685c",
            fontSize: "12px",
            lineHeight: "1.7",
          }}>
            Thank you for choosing Amaya.<br />
            Please present this receipt for pickup.
          </div>

          <div style={{ display: "flex", justifyContent: "center", marginTop: "24px" }}>
            <button
              type="button"
              onClick={() => navigate("/staff/menu")}
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
              Back to Menu
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default StaffReceipt;
