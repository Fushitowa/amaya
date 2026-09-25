import { useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import { useBusiness, defaultBusinessSettings } from "../../context/BusinessContext.jsx";
import "../../assets/css/staff/staff-receipt.css";

function StaffReceipt() {
  const navigate = useNavigate();
  const location = useLocation();
  const { businessSettings } = useBusiness() || {};
  const business = businessSettings || defaultBusinessSettings;

  const order = useMemo(() => location.state?.order || [
    { title: "Matcha Milk Tea", quantity: 2, price: 39, size: "Regular" },
    { title: "Takoyaki", quantity: 1, price: 30, size: "Regular" },
  ], [location.state?.order]);

  const customerName = location.state?.customerName || "Walk-in Customer";
  const orderType = location.state?.orderType || "Counter";
  const paymentMethod = location.state?.paymentMethod || "CASH";
  const subtotal = Number(location.state?.subtotal || 108);
  const total = Number(location.state?.total || subtotal);
  const cashTendered = Number(location.state?.cashTendered || total);
  const changeDue = Number(location.state?.changeDue || 0);

  // Deterministic order number without impure Math.random() calls during render
  const orderNumber = location.state?.orderId || "AM-104821";

  const date = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  const time = useMemo(() => {
    return new Date().toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }, []);

  const handlePrint = () => {
    window.print();
  };

  return (
    <main className="staff-receipt-page">
      <div className="thermal-receipt-container">
        {/* Navigation & Action Bar (Hidden on Print) */}
        <div className="receipt-action-toolbar no-print">
          <button
            type="button"
            className="btn-print-receipt-main"
            onClick={handlePrint}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <polyline points="6 9 6 2 18 2 18 9"></polyline>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
              <rect x="6" y="14" width="12" height="8"></rect>
            </svg>
            Print Receipt (Thermal 80mm)
          </button>

          <button
            type="button"
            className="btn-secondary-receipt"
            onClick={() => navigate("/staff/menu")}
          >
            + New POS Order
          </button>

          <Link to="/staff/orders" className="btn-secondary-receipt">
            View Orders Queue
          </Link>
        </div>

        {/* 300px Thermal Restaurant Receipt Slip */}
        <article className="thermal-slip printable-receipt-area">
          <header className="slip-header">
            <img src={amayaLogo} alt="Amaya Logo" className="slip-logo" />
            <h2 className="slip-title">{business.businessName || "AMAYA DRINKS & BITES"}</h2>
            <p className="slip-meta-text">{business.address || "Barangay Lilingayon, Valencia City, Bukidnon"}</p>
            <p className="slip-meta-text">Contact: {business.phone || "09636017184"}</p>
            <p className="slip-meta-text">Store Hours: 9:00 AM - 7:00 PM</p>
          </header>

          <div className="slip-divider-dashed"></div>

          <div className="slip-meta-grid">
            <div className="slip-meta-row">
              <span>ORDER NO:</span>
              <strong>{orderNumber}</strong>
            </div>
            <div className="slip-meta-row">
              <span>DATE:</span>
              <span>{date}</span>
            </div>
            <div className="slip-meta-row">
              <span>TIME:</span>
              <span>{time}</span>
            </div>
            <div className="slip-meta-row">
              <span>STATION:</span>
              <strong>POS Terminal #1 (Staff)</strong>
            </div>
            <div className="slip-meta-row">
              <span>CUSTOMER:</span>
              <strong>{customerName}</strong>
            </div>
            <div className="slip-meta-row">
              <span>ORDER TYPE:</span>
              <strong>{String(orderType).toUpperCase()}</strong>
            </div>
            <div className="slip-meta-row">
              <span>PAYMENT:</span>
              <strong>{String(paymentMethod).toUpperCase()} (PAID)</strong>
            </div>
          </div>

          <div className="slip-divider-dashed"></div>

          <table className="slip-table">
            <thead>
              <tr>
                <th style={{ width: "32px" }}>QTY</th>
                <th>ITEM</th>
                <th className="th-right" style={{ width: "55px" }}>PRICE</th>
                <th className="th-right" style={{ width: "65px" }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {order.map((item, index) => (
                <tr key={`${item.title}-${index}`}>
                  <td>{item.quantity}</td>
                  <td>
                    {item.title}
                    {item.size && item.size !== "Regular" && (
                      <span style={{ fontSize: "9.5px", color: "#666", display: "block" }}>
                        Size: {item.size}
                      </span>
                    )}
                    {item.sugarLevel && (
                      <span style={{ fontSize: "9.5px", color: "#666", display: "block" }}>
                        Sugar: {item.sugarLevel}
                      </span>
                    )}
                    {item.addons && item.addons.length > 0 && (
                      <span style={{ fontSize: "9.5px", color: "#666", display: "block" }}>
                        +{item.addons.join(", ")}
                      </span>
                    )}
                  </td>
                  <td className="td-right">₱{Number(item.price || 0).toFixed(2)}</td>
                  <td className="td-right">
                    ₱{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="slip-divider-dashed"></div>

          <div className="slip-calc">
            <div className="slip-calc-row">
              <span>Subtotal:</span>
              <span>₱{subtotal.toFixed(2)}</span>
            </div>
            <div className="slip-calc-row">
              <span>Tax / VAT (0%):</span>
              <span>₱0.00</span>
            </div>
            <div className="slip-calc-row slip-calc-total">
              <strong>TOTAL AMOUNT:</strong>
              <strong>₱{total.toFixed(2)}</strong>
            </div>

            {String(paymentMethod).toLowerCase() === "cash" && (
              <>
                <div className="slip-calc-row" style={{ marginTop: "4px" }}>
                  <span>Cash Tendered:</span>
                  <span>₱{cashTendered.toFixed(2)}</span>
                </div>
                <div className="slip-calc-row" style={{ fontWeight: 700 }}>
                  <span>Change Due:</span>
                  <span>₱{changeDue.toFixed(2)}</span>
                </div>
              </>
            )}
          </div>

          <div className="slip-divider-dashed"></div>

          <div className="slip-barcode-area">
            <div className="slip-barcode-lines">||| | |||| ||| ||||||| | |||</div>
            <span style={{ fontSize: "10px", color: "#666", letterSpacing: "1px" }}>*{orderNumber}*</span>
          </div>

          <footer className="slip-footer">
            <p style={{ margin: "2px 0", fontWeight: 700 }}>Thank you for visiting Amaya!</p>
            <p style={{ margin: "2px 0" }}>Freshly crafted drinks & savory bites.</p>
            <p style={{ margin: "2px 0", fontSize: "9px" }}>Please present this slip when claiming order.</p>
          </footer>
        </article>
      </div>
    </main>
  );
}

export default StaffReceipt;
