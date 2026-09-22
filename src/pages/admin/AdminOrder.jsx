import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import amayaLogo from "../../assets/images/amayalogo.png";
import SidebarLogoButton from "../../components/SidebarLogoButton.jsx";

import "../../assets/css/admin/AdminOrder.css";
import "../../assets/css/sidebar-collapse.css";

const orders = [];

const statusOptions = ["All orders", "Pending", "Preparing", "Ready", "Completed"];

function AdminOrder() {
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [activeStatus, setActiveStatus] = useState("All orders");
	const [search, setSearch] = useState("");
	const [selectedOrderId, setSelectedOrderId] = useState(null);

	const filteredOrders = useMemo(() => {
		const normalizedSearch = search.toLowerCase().trim();
		return orders.filter((order) => {
			const matchesStatus = activeStatus === "All orders" || order.status === activeStatus;
			const matchesSearch = !normalizedSearch || `${order.id} ${order.customer} ${order.summary}`.toLowerCase().includes(normalizedSearch);
			return matchesStatus && matchesSearch;
		});
	}, [activeStatus, search]);

	const selectedOrder = orders.find((order) => order.id === selectedOrderId) ?? null;

	return (
		<div className={`admin-orders-page ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
			<aside className="admin-orders-sidebar">
				<div className="admin-orders-brand"><SidebarLogoButton logo={amayaLogo} alt="Amaya logo" collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)} /><div><strong>Amaya</strong><span>Admin Portal</span></div></div>
				<nav className="admin-orders-nav" aria-label="Admin navigation">
					<span className="admin-orders-nav-label">MAIN MENU</span>
					<Link to="/admin" className="admin-orders-nav-link"><span>▦</span>Dashboard</Link>
					<Link to="/admin/orders" className="admin-orders-nav-link active"><span>▤</span>Orders<em>{orders.length}</em></Link>
					<Link to="/admin/inventory" className="admin-orders-nav-link"><span>☷</span>Inventory</Link>
					<Link to="/admin/menu" className="admin-orders-nav-link"><span>☷</span>Menu Management</Link>
					<span className="admin-orders-nav-label nav-label-spaced">MANAGEMENT</span>
					<Link to="/admin/reports" className="admin-orders-nav-link"><span>▥</span>Reports</Link>
					<Link to="/admin/settings" className="admin-orders-nav-link"><span>⚙</span>Settings</Link>
				</nav>
				<div className="admin-orders-sidebar-bottom"><Link to="/" className="admin-orders-nav-link"><span>←</span>Back to Website</Link><Link to="/login" className="admin-orders-nav-link logout-link"><span>↪</span>Log Out</Link></div>
			</aside>

			<main className="admin-orders-main">
				<header className="admin-orders-topbar"><div><span className="admin-orders-section-label">ADMIN PORTAL</span><h1>Orders</h1></div><div className="admin-orders-topbar-actions"><button type="button" className="admin-orders-icon-button" aria-label="Notifications">♢<b>0</b></button><div className="admin-orders-user"><div className="admin-orders-avatar">A</div><div><strong>Administrator</strong><span>Admin</span></div></div></div></header>

				<div className="admin-orders-content">
					<section className="admin-orders-heading"><div><span className="admin-orders-eyebrow">ORDER MANAGEMENT</span><h2>Customer orders</h2><p>Keep service moving with a clear view of every order in the queue.</p></div><button type="button" className="admin-orders-export">↓ <span>Export report</span></button></section>

					<section className="admin-orders-stats" aria-label="Order summary">
						<div><span className="stat-mark amber">◷</span><div><small>Pending</small><strong>0</strong><span className="stat-note warning">No pending orders</span></div></div>
						<div><span className="stat-mark blue">▤</span><div><small>In progress</small><strong>0</strong><span className="stat-note">No orders being prepared</span></div></div>
						<div><span className="stat-mark green">✓</span><div><small>Completed today</small><strong>0</strong><span className="stat-note positive">No completed orders yet</span></div></div>
						<div><span className="stat-mark plum">₱</span><div><small>Today's revenue</small><strong>₱0.00</strong><span className="stat-note positive">No sales recorded yet</span></div></div>
					</section>

					<section className="admin-orders-workspace">
						<div className="admin-orders-list-panel">
							<div className="admin-orders-list-header"><div><h3>Order queue</h3><span>{filteredOrders.length} orders shown</span></div><label className="admin-orders-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search orders" aria-label="Search orders" /></label></div>
							<div className="admin-orders-tabs" role="tablist" aria-label="Filter orders">{statusOptions.map((status) => <button key={status} type="button" className={activeStatus === status ? "active" : ""} onClick={() => setActiveStatus(status)}>{status}<span>{status === "All orders" ? orders.length : orders.filter((order) => order.status === status).length}</span></button>)}</div>
							<div className="admin-orders-table-wrap"><table className="admin-orders-table"><thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Total</th><th>Status</th><th><span className="sr-only">View</span></th></tr></thead>{filteredOrders.length ? (<tbody>{filteredOrders.map((order) => <tr key={order.id} className={selectedOrder?.id === order.id ? "selected" : ""} onClick={() => setSelectedOrderId(order.id)}><td><strong>{order.id}</strong><span>{order.time}</span></td><td><div className="order-customer"><span>{order.initials}</span><div><strong>{order.customer}</strong><small>{order.items} · {order.summary}</small></div></div></td><td><span className="order-type"><i className={order.type.toLowerCase()}></i>{order.type}</span></td><td><strong>{order.total}</strong><span className="payment-status">{order.payment}</span></td><td><span className={`order-status ${order.status.toLowerCase()}`}>{order.status}</span></td><td><button type="button" className="row-arrow" aria-label={`View ${order.id}`}>›</button></td></tr>)}</tbody>) : (<tbody><tr><td colSpan="6"><div className="admin-orders-empty">No orders yet.</div></td></tr></tbody>)}</table></div>
						</div>

						{selectedOrder ? (
							<aside className="admin-order-detail">
								<div className="detail-heading"><div><span className="admin-orders-eyebrow">ORDER DETAILS</span><h3>{selectedOrder.id}</h3></div><span className={`order-status ${selectedOrder.status.toLowerCase()}`}>{selectedOrder.status}</span></div>
								<div className="detail-customer"><span>{selectedOrder.initials}</span><div><strong>{selectedOrder.customer}</strong><small>Placed today at {selectedOrder.time}</small></div></div>
								<div className="detail-divider"></div>
								<div className="detail-section"><div className="detail-section-title"><strong>Order items</strong><span>{selectedOrder.items}</span></div><div className="detail-item"><span>1 × {selectedOrder.summary.split(", ")[0]}</span><strong>{selectedOrder.total}</strong></div>{selectedOrder.summary.includes(", ") && <div className="detail-item"><span>1 × {selectedOrder.summary.split(", ")[1]}</span><strong>Included</strong></div>}</div>
								<div className="detail-total"><span>Total amount</span><strong>{selectedOrder.total}</strong></div>
								<div className="detail-meta"><div><span>Order type</span><strong>{selectedOrder.type}</strong></div><div><span>Payment</span><strong className="paid">● {selectedOrder.payment}</strong></div></div>
								<div className="detail-actions"><button type="button" className="primary-action">Update status <span>⌄</span></button><button type="button" className="secondary-action">Print receipt</button></div>
							</aside>
						) : (
							<aside className="admin-order-detail">
								<div className="detail-heading"><div><span className="admin-orders-eyebrow">ORDER DETAILS</span><h3>No active order</h3></div></div>
								<div className="admin-orders-empty-state">
									<strong>No orders yet</strong>
									<span>New customer orders will appear here once they’re placed.</span>
								</div>
							</aside>
						)}
					</section>
				</div>
			</main>
		</div>
	);
}

export default AdminOrder;
