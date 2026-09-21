import { Link } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import "../../assets/css/admin/AdminReport.css";

const weeklySales = [];

const inventory = [
	{ product: "Burger", stock: 8, status: "Low Stock", tone: "low" },
	{ product: "Milk Tea", stock: 25, status: "Available", tone: "available" },
	{ product: "Matcha Latte", stock: 4, status: "Critical", tone: "critical" },
	{ product: "Fries", stock: 30, status: "Available", tone: "available" },
];

function AdminReport() {
	const liveDate = new Date().toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
	});

	return (
		<div className="admin-report-page">
			<aside className="admin-report-sidebar">
				<div className="admin-report-brand">
					<img src={amayaLogo} alt="Amaya logo" />
					<div><strong>Amaya</strong><span>Admin Portal</span></div>
				</div>

				<nav className="admin-report-nav" aria-label="Admin navigation">
					<span className="admin-report-nav-label">MAIN MENU</span>
					<Link to="/admin" className="admin-report-nav-link"><span>▦</span>Dashboard</Link>
					<Link to="/admin/orders" className="admin-report-nav-link"><span>▤</span>Orders</Link>
					<Link to="/admin/menu" className="admin-report-nav-link"><span>☷</span>Menu Management</Link>
					<span className="admin-report-nav-label nav-label-spaced">MANAGEMENT</span>
					<Link to="/admin/reports" className="admin-report-nav-link active"><span>▥</span>Reports</Link>
					<Link to="/admin/settings" className="admin-report-nav-link"><span>⚙</span>Settings</Link>
				</nav>

				<div className="admin-report-sidebar-bottom">
					<Link to="/" className="admin-report-nav-link"><span>←</span>Back to Website</Link>
					<Link to="/login" className="admin-report-nav-link logout-link"><span>↪</span>Log Out</Link>
				</div>
			</aside>

			<main className="admin-report-main">
				<header className="admin-report-topbar">
					<div><span className="admin-report-section-label">ADMIN PORTAL</span><h1>Reports</h1></div>
					<div className="admin-report-topbar-actions">
						<button type="button" className="admin-report-icon-button" aria-label="Notifications">♢<b>3</b></button>
						<div className="admin-report-user"><div className="admin-report-avatar">A</div><div><strong>Administrator</strong><span>Admin</span></div></div>
					</div>
				</header>

				<div className="admin-report-content">
					<section className="admin-report-heading">
						<div><span className="admin-report-eyebrow">BUSINESS OVERVIEW</span><h2>Reports at a glance</h2><p>Track sales performance and keep an eye on your inventory.</p></div>
						<div className="admin-report-date"><span>REPORT DATE</span><strong>{liveDate}</strong></div>
					</section>

					<section className="admin-report-sales-layout" aria-label="Sales report">
						<div className="admin-report-panel sales-summary">
							<div className="panel-heading"><div><span className="admin-report-eyebrow">SALES REPORT</span><h3>{liveDate}</h3></div><span className="report-panel-icon">₱</span></div>
							<div className="sales-metrics">
								<div><span>Total Sales</span><strong>₱0.00</strong></div>
								<div><span>Total Orders</span><strong>0</strong></div>
								<div><span>Average Order</span><strong>₱0.00</strong></div>
							</div>
						</div>

						<div className="admin-report-panel weekly-sales">
							<div className="panel-heading"><div><span className="admin-report-eyebrow">THIS WEEK</span><h3>Sales This Week</h3></div><span className="weekly-total">₱0.00</span></div>
							<div className="sales-chart" aria-label="Weekly sales chart">
								{weeklySales.length ? weeklySales.map((sale) => <div className="sales-chart-row" key={sale.day}><span>{sale.day}</span><div className="sales-bar-track"><div className="sales-bar" style={{ width: `${(sale.amount / 310) * 100}%` }}></div></div><strong>₱{sale.amount}</strong></div>) : <div className="admin-orders-empty">No sales data yet.</div>}
							</div>
						</div>
					</section>

					<section className="admin-report-panel inventory-panel" aria-label="Inventory report">
						<div className="panel-heading"><div><span className="admin-report-eyebrow">INVENTORY REPORT</span><h3>Current inventory</h3></div><span className="inventory-count">4 products</span></div>
						<div className="inventory-table-wrap">
							<table className="inventory-table"><thead><tr><th>Product</th><th>Stock</th><th>Status</th></tr></thead><tbody>{inventory.map((item) => <tr key={item.product}><td>{item.product}</td><td>{item.stock}</td><td><span className={`inventory-status ${item.tone}`}>{item.status}</span></td></tr>)}</tbody></table>
						</div>
					</section>
				</div>
			</main>
		</div>
	);
}

export default AdminReport;
