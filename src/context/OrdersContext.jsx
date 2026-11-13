/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../utils/api.js";
import { useAuth } from "./AuthContext.jsx";
import {
  notifyOrderCompleted,
  notifyOrderCreated,
  notifyReceiptPrinted,
} from "../utils/notifications.js";

const OrdersContext = createContext(null);

export const PAYMENT_STATUS_PAID = "Paid";
export const DEFAULT_PAYMENT_METHOD = "Cash";
export const WALK_IN_CUSTOMER_NAME = "Walk-in Customer";
export const WALK_IN_INITIALS = "WC";
export const ORDER_STATUS_FLOW = ["Pending", "Preparing", "Completed"];

export function getNextAllowedStatuses(currentStatus) {
  if (currentStatus === "Cancelled") return [];
  const index = ORDER_STATUS_FLOW.indexOf(currentStatus);
  return index < 0 || index === ORDER_STATUS_FLOW.length - 1
    ? []
    : ORDER_STATUS_FLOW.slice(index + 1);
}

export function canTransitionTo(currentStatus, nextStatus) {
  return getNextAllowedStatuses(currentStatus).includes(nextStatus);
}

export function normalizeOrderCustomer(order) {
  return order && typeof order === "object"
    ? { ...order, customer: order.customer || WALK_IN_CUSTOMER_NAME }
    : order;
}

export function normalizeOrderPayment(order) {
  if (!order || typeof order !== "object") return order;
  const isCancelled = order.status === "Cancelled";
  const payment = isCancelled
    ? (order.payment && order.payment !== PAYMENT_STATUS_PAID ? order.payment : "Voided")
    : (order.payment || PAYMENT_STATUS_PAID);
  return {
    ...order,
    payment,
    paymentMethod: order.paymentMethod || DEFAULT_PAYMENT_METHOD,
    paidAt: isCancelled ? null : (order.paidAt || order.createdAt || null),
  };
}

export function OrdersProvider({ children }) {
  const [orders, setOrders] = useState([]);
  const { user } = useAuth();
  const userId = user?.id;

  const refreshOrders = useCallback(async () => {
    if (!userId) return [];
    const saved = await apiRequest("/orders");
    const normalized = saved.map((order) => normalizeOrderPayment(normalizeOrderCustomer(order)));
    setOrders(normalized);
    return normalized;
  }, [userId]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    const refresh = () => apiRequest("/orders").then((saved) => {
      if (active) setOrders(saved.map((order) => normalizeOrderPayment(normalizeOrderCustomer(order))));
    }).catch((error) => console.error("Could not load orders:", error.message));
    refresh();
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener("amaya:session-changed", refresh);
    window.addEventListener("amaya:stock-mutated", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("amaya:session-changed", refresh);
      window.removeEventListener("amaya:stock-mutated", refresh);
    };
  }, [userId]);

  const fetchOrderDetails = useCallback(async (orderNumber) => {
    const details = await apiRequest(`/orders/${encodeURIComponent(orderNumber)}`);
    return normalizeOrderPayment(normalizeOrderCustomer(details));
  }, []);

  const value = useMemo(() => ({
    orders: user ? orders : [],
    refreshOrders,
    fetchOrderDetails,
    addOrder: async (payload) => {
      const order = await apiRequest("/orders", { method: "POST", body: JSON.stringify(payload) });
      const normalized = normalizeOrderPayment(normalizeOrderCustomer(order));
      setOrders((current) => [normalized, ...current]);
      notifyOrderCreated(normalized);
      window.dispatchEvent(new CustomEvent("amaya:stock-mutated"));
      return normalized;
    },
    updateOrderStatus: async (id, status) => {
      const current = orders.find((entry) => entry.id === id);
      if (!current || !canTransitionTo(current.status, status)) return undefined;
      const updated = await apiRequest(`/orders/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      const normalized = normalizeOrderPayment(normalizeOrderCustomer(updated));
      setOrders((items) => items.map((entry) => entry.id === id ? normalized : entry));
      if (status === "Completed") notifyOrderCompleted(normalized);
      return normalized;
    },
    printReceipt: (id) => {
      const order = orders.find((entry) => entry.id === id);
      if (order) notifyReceiptPrinted(order);
    },
    confirmOrder: async (id) => {
      const updated = await apiRequest(`/orders/${encodeURIComponent(id)}/confirm`, {
        method: "PATCH",
        body: "{}",
      });
      const normalized = normalizeOrderPayment(normalizeOrderCustomer(updated));
      setOrders((items) => items.map((entry) => entry.id === id ? normalized : entry));
      return normalized;
    },
    markOrderPaid: async (id, paymentMethod) => {
      const updated = await apiRequest(`/orders/${encodeURIComponent(id)}/payment`, {
        method: "PATCH",
        body: JSON.stringify({ paymentMethod }),
      });
      const normalized = normalizeOrderPayment(normalizeOrderCustomer(updated));
      setOrders((items) => items.map((entry) => entry.id === id ? normalized : entry));
      return normalized;
    },
    voidOrder: async (orderNumber, { reason, restoreStock }) => {
      const updated = await apiRequest(`/orders/${encodeURIComponent(orderNumber)}/void`, {
        method: "POST",
        body: JSON.stringify({ reason, restoreStock }),
      });
      const normalized = normalizeOrderPayment(normalizeOrderCustomer(updated));
      setOrders((items) => items.map((entry) => entry.id === orderNumber ? normalized : entry));
      window.dispatchEvent(new CustomEvent("amaya:stock-mutated"));
      return normalized;
    },
    revertOrderItem: async (orderNumber, itemId, { quantity, reason, restoreStock, authorizationPassword, adminPassword } = {}) => {
      const updated = await apiRequest(
        `/orders/${encodeURIComponent(orderNumber)}/items/${encodeURIComponent(itemId)}/revert`,
        {
          method: "POST",
          body: JSON.stringify({
            quantity,
            reason,
            restoreStock,
            authorizationPassword: authorizationPassword ?? adminPassword,
            adminPassword: adminPassword ?? authorizationPassword,
          }),
        },
      );
      const normalized = normalizeOrderPayment(normalizeOrderCustomer(updated));
      setOrders((items) => items.map((entry) => entry.id === orderNumber ? normalized : entry));
      window.dispatchEvent(new CustomEvent("amaya:stock-mutated"));
      return normalized;
    },
  }), [fetchOrderDetails, orders, refreshOrders, user]);

  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>;
}

export function useOrders() {
  return useContext(OrdersContext);
}

export function getOrderTime(createdAt) {
  return new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const MANILA_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function isToday(createdAt) {
  if (!createdAt) return false;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return false;
  return MANILA_DATE_FORMAT.format(date) === MANILA_DATE_FORMAT.format(new Date());
}

export function isOrderPaid(order) {
  return Boolean(order && order.status !== "Cancelled" && order.payment === PAYMENT_STATUS_PAID);
}

export function getPaymentStatusLabel(order) {
  if (order?.status === "Cancelled") return "VOIDED";
  if (order?.payment === undefined && order?.status === undefined) return "PAID";
  return isOrderPaid(order) ? "PAID" : String(order?.payment ?? "UNPAID").toUpperCase();
}

export function getPaymentMethodLabel(order) {
  return String(order?.paymentMethod || DEFAULT_PAYMENT_METHOD).toUpperCase();
}
