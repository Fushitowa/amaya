import { useLocation, useNavigate } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import "../../assets/css/staff/staff-receipt.css";

function StaffReceipt() {
  const navigate = useNavigate();
  const location = useLocation();
  const order = location.state?.order || [];
  const customerName = location.state?.customerName || "Walk-in Customer";
  const subtotal = Number(location.state?.subtotal || 0);

  const orderNumber = `AM-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  const date = new Date().toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <main className="staff-receipt-page">
      <article className="staff-receipt">
        <header className="staff-receipt-header">
          <div className="staff-receipt-brand">
            <img src={amayaLogo} alt="Amaya logo" />
            <div>
              <strong>AMAYA</strong>
              <span>Staff receipt</span>
            </div>
          </div>
          <span className="staff-receipt-status">Confirmed</span>
        </header>

        <div className="staff-receipt-content">
          <div className="staff-receipt-meta">
            <div>
              <span>Receipt No.</span>
              <strong>{orderNumber}</strong>
            </div>
            <div>
              <span>Date</span>
              <strong>{date}</strong>
            </div>
          </div>

          <section className="staff-receipt-customer" aria-label="Customer">
            <span>Customer</span>
            <strong>{customerName}</strong>
          </section>

          <section className="staff-receipt-items" aria-label="Order items">
            <div className="staff-receipt-items-header">
              <span>Item</span>
              <span>Qty</span>
              <span>Amount</span>
            </div>

            {order.length > 0 ? (
              order.map((item) => (
                <div className="staff-receipt-item" key={item.title}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.size || "Regular"}</span>
                  </div>
                  <span>{item.quantity}</span>
                  <strong>
                    ₱{(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}
                  </strong>
                </div>
              ))
            ) : (
              <p className="staff-receipt-empty">No items recorded.</p>
            )}
          </section>

          <section className="staff-receipt-totals" aria-label="Receipt totals">
            <div>
              <span>Subtotal</span>
              <strong>₱{subtotal.toFixed(2)}</strong>
            </div>
            <div className="staff-receipt-total-row">
              <strong>Total</strong>
              <strong>₱{subtotal.toFixed(2)}</strong>
            </div>
          </section>

          <p className="staff-receipt-note">
            Thank you for your order!<br />
            Please keep this receipt for reference.
          </p>

          <button
            type="button"
            className="staff-receipt-back-button"
            onClick={() => navigate("/staff/menu")}
          >
            Back to Menu
          </button>
        </div>
      </article>
    </main>
  );
}

export default StaffReceipt;
