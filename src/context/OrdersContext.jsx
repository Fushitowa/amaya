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
export const ORDER_STATUS_FLOW = ["Pending", "Preparing", "Ready", "Completed"];

export function getNextAllowedStatuses(currentStatus) {
  const index = ORDER_STATUS_FLOW.indexOf(currentStatus);
  return index < 0 || index === ORDER_STATUS_FLOW.length - 1 ? [] : [ORDER_STATUS_FLOW[index + 1]];
}

export function canTransitionTo(currentStatus, nextStatus) {
  return getNextAllowedStatuses(currentStatus).includes(nextStatus);
}

export function normalizeOrderCustomer(order) {
  return order && typeof order === "object" ? { ...order, customer: order.customer || WALK_IN_CUSTOMER_NAME } : order;
}

export function normalizeOrderPayment(order) {
  if (!order || typeof order !== "object") return order;
  return {
    ...order,
    payment: order.payment || PAYMENT_STATUS_PAID,
    paymentMethod: order.paymentMethod || DEFAULT_PAYMENT_METHOD,
    paidAt: order.paidAt || order.createdAt || null,
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
    return () => { active = false; window.clearInterval(interval); };
  }, [userId]);

  const value = useMemo(() => ({
    orders: user ? orders : [],
    refreshOrders,
    addOrder: async (payload) => {
      const order = await apiRequest("/orders", { method: "POST", body: JSON.stringify(payload) });
      const normalized = normalizeOrderPayment(normalizeOrderCustomer(order));
      setOrders((current) => [normalized, ...current]);
      notifyOrderCreated(normalized);
      return normalized;
    },
    updateOrderStatus: async (id, status) => {
      const current = orders.find((entry) => entry.id === id);
      if (!current || !canTransitionTo(current.status, status)) return;
      try {
        const updated = await apiRequest(`/orders/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
        const normalized = normalizeOrderPayment(normalizeOrderCustomer(updated));
        setOrders((items) => items.map((entry) => entry.id === id ? normalized : entry));
        if (status === "Completed") notifyOrderCompleted(normalized);
        return normalized;
      } catch (error) {
        window.alert(error.message);
        return undefined;
      }
    },
    printReceipt: (id) => {
      const order = orders.find((entry) => entry.id === id);
      if (order) notifyReceiptPrinted(order);
    },
    confirmOrder: async (id) => {
      try {
        const updated = await apiRequest(`/orders/${encodeURIComponent(id)}/confirm`, { method: "PATCH", body: "{}" });
        const normalized = normalizeOrderPayment(normalizeOrderCustomer(updated));
        setOrders((items) => items.map((entry) => entry.id === id ? normalized : entry));
        return normalized;
      } catch (error) { window.alert(error.message); return undefined; }
    },
    markOrderPaid: async (id, paymentMethod) => {
      try {
        const updated = await apiRequest(`/orders/${encodeURIComponent(id)}/payment`, { method: "PATCH", body: JSON.stringify({ paymentMethod }) });
        const normalized = normalizeOrderPayment(normalizeOrderCustomer(updated));
        setOrders((items) => items.map((entry) => entry.id === id ? normalized : entry));
        return normalized;
      } catch (error) { window.alert(error.message); return undefined; }
    },
    deleteOrder: async (id) => {
      try {
        await apiRequest(`/orders/${encodeURIComponent(id)}`, { method: "DELETE" });
        setOrders((current) => current.filter((entry) => entry.id !== id));
      } catch (error) { window.alert(error.message); }
    },
  }), [orders, refreshOrders, user]);

  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>;
}

export function useOrders() {
  return useContext(OrdersContext);
}

export function getOrderTime(createdAt) {
  return new Date(createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function isToday(createdAt) {
  const date = new Date(createdAt);
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

export function isOrderPaid(order) {
  return (order?.payment ?? PAYMENT_STATUS_PAID) === PAYMENT_STATUS_PAID;
}

export function getPaymentStatusLabel(order) {
  return isOrderPaid(order) ? "PAID" : String(order?.payment ?? "UNPAID").toUpperCase();
}

export function getPaymentMethodLabel(order) {
  return String(order?.paymentMethod || DEFAULT_PAYMENT_METHOD).toUpperCase();
}
