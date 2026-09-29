/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import {
  notifyOrderCompleted,
  notifyOrderCreated,
  notifyReceiptPrinted,
} from "../utils/notifications.js";

const ordersStorageKey = "amaya-orders";
const OrdersContext = createContext(null);

export const PAYMENT_STATUS_PAID = "Paid";
export const DEFAULT_PAYMENT_METHOD = "Cash";
export const WALK_IN_CUSTOMER_NAME = "Walk-in Customer";
export const WALK_IN_INITIALS = "WC";

/* Sequential order lifecycle: Pending -> Preparing -> Ready -> Completed.
   Orders may only ever advance one step at a time, and Completed is final. */
export const ORDER_STATUS_FLOW = ["Pending", "Preparing", "Ready", "Completed"];

export function getNextAllowedStatuses(currentStatus) {
  const index = ORDER_STATUS_FLOW.indexOf(currentStatus);
  if (index < 0 || index === ORDER_STATUS_FLOW.length - 1) return [];
  return [ORDER_STATUS_FLOW[index + 1]];
}

export function canTransitionTo(currentStatus, nextStatus) {
  return getNextAllowedStatuses(currentStatus).includes(nextStatus);
}

export const defaultInitialOrders = [
  {
    id: "AM-104821",
    customer: WALK_IN_CUSTOMER_NAME,
    items: [
      { title: "Matcha Milk Tea", quantity: 2, price: 39, size: "Regular", category: "Milk Tea" },
      { title: "Takoyaki", quantity: 1, price: 30, size: "Regular", category: "Snacks" },
    ],
    total: 108,
    status: "Pending",
    type: "Counter",
    payment: PAYMENT_STATUS_PAID,
    paymentMethod: "Cash",
    paidAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
  {
    id: "AM-104819",
    customer: WALK_IN_CUSTOMER_NAME,
    items: [
      { title: "Classic Milk Tea", quantity: 1, price: 39, size: "Regular", category: "Milk Tea" },
      { title: "Burger", quantity: 1, price: 55, size: "Regular", category: "Snacks" },
    ],
    total: 94,
    status: "Preparing",
    type: "Counter",
    payment: PAYMENT_STATUS_PAID,
    paymentMethod: "GCash",
    paidAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: "AM-104815",
    customer: WALK_IN_CUSTOMER_NAME,
    items: [
      { title: "Cookies & Cream", quantity: 2, price: 39, size: "Regular", category: "Milk Tea" },
      { title: "Lumpia", quantity: 2, price: 20, size: "Regular", category: "Snacks" },
    ],
    total: 118,
    status: "Ready",
    type: "Takeout",
    payment: PAYMENT_STATUS_PAID,
    paymentMethod: "Cash",
    paidAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
  },
  {
    id: "AM-104810",
    customer: WALK_IN_CUSTOMER_NAME,
    items: [
      { title: "Mango Float", quantity: 1, price: 95, size: "Regular", category: "Desserts" },
      { title: "Coke Float", quantity: 1, price: 25, size: "Regular", category: "Drinks" },
    ],
    total: 120,
    status: "Completed",
    type: "Dine-in",
    payment: PAYMENT_STATUS_PAID,
    paymentMethod: "Card",
    paidAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: "AM-104802",
    customer: WALK_IN_CUSTOMER_NAME,
    items: [
      { title: "Hotdog Bun", quantity: 2, price: 45, size: "Regular", category: "Snacks" },
      { title: "Strawberry Milk", quantity: 1, price: 30, size: "Regular", category: "Drinks" },
    ],
    total: 120,
    status: "Pending",
    type: "Counter",
    payment: PAYMENT_STATUS_PAID,
    paymentMethod: "GCash",
    paidAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
];

export function normalizeOrderCustomer(order) {
  if (!order || typeof order !== "object") return order;

  return {
    ...order,
    customer: WALK_IN_CUSTOMER_NAME,
  };
}

function normalizeOrders(orders) {
  if (!Array.isArray(orders)) return orders;
  return orders.map(normalizeOrderCustomer);
}

export function normalizeOrderPayment(order) {
  if (!order || typeof order !== "object") return order;

  return {
    ...order,
    customer: WALK_IN_CUSTOMER_NAME,
    payment: PAYMENT_STATUS_PAID,
    paymentMethod: order.paymentMethod || DEFAULT_PAYMENT_METHOD,
    paidAt: order.paidAt || order.createdAt || new Date().toISOString(),
  };
}

function readOrders() {
  try {
    const savedOrders = localStorage.getItem(ordersStorageKey);
    if (savedOrders === null) return defaultInitialOrders;

    // Anything that is not a readable array means there is no order data to
    // show. Seeding demo orders here would render them as real ones, so an
    // empty queue is the honest result.
    const parsed = JSON.parse(savedOrders);
    return Array.isArray(parsed) ? normalizeOrders(parsed) : [];
  } catch {
    return [];
  }
}

function getOrderTotal(items) {
  return items.reduce(
    (sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0),
    0,
  );
}

export function OrdersProvider({ children }) {
  const [orders, setOrders] = useState(readOrders);

  useEffect(() => {
    localStorage.setItem(ordersStorageKey, JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
    const syncOrders = (event) => {
      if (event.key !== ordersStorageKey || !event.newValue) return;

      try {
        const parsed = JSON.parse(event.newValue);
        if (Array.isArray(parsed)) setOrders(normalizeOrders(parsed));
      } catch {
        // Ignore malformed values written by another tab.
      }
    };

    window.addEventListener("storage", syncOrders);
    return () => window.removeEventListener("storage", syncOrders);
  }, []);

  const value = useMemo(() => ({
    orders,
    addOrder: ({
      items,
      customerName = WALK_IN_CUSTOMER_NAME,
      type = "Takeout",
      paymentMethod = DEFAULT_PAYMENT_METHOD,
      cashTendered,
      changeDue,
    }) => {
      const total = getOrderTotal(items);
      const createdAt = new Date().toISOString();
      const order = {
        id: `AM-${String(Date.now()).slice(-6)}`,
        customer: customerName,
        items: items.map((item) => ({
          // productId keeps the line linked to its Admin catalog record.
          productId: item.productId,
          title: item.title,
          quantity: Number(item.quantity || 0),
          price: Number(item.price || 0),
          size: item.size || "Regular",
          category: item.category || "Menu item",
          sugarLevel: item.sugarLevel,
          addons: Array.isArray(item.addons) ? item.addons : [],
          instructions: item.instructions,
        })),
        total,
        status: "Pending",
        type,
        payment: PAYMENT_STATUS_PAID,
        paymentMethod,
        paidAt: createdAt,
        confirmed: false,
        ...(paymentMethod === "Cash"
          ? {
            cashTendered: Number(cashTendered || total),
            changeDue: Number(changeDue || 0),
          }
          : {}),
        createdAt,
      };

      setOrders((currentOrders) => [order, ...currentOrders]);
      notifyOrderCreated(order);
      return order;
    },
    updateOrderStatus: (id, status) => {
      let completedOrder = null;

      setOrders((currentOrders) => currentOrders.map((order) => {
        if (order.id !== id) return order;
        // Enforce the sequential workflow regardless of caller.
        if (!canTransitionTo(order.status, status)) return order;
        if (status === "Completed") completedOrder = { ...order, status };
        return { ...order, status };
      }));

      if (completedOrder) notifyOrderCompleted(completedOrder);
    },
    printReceipt: (id) => {
      const order = orders.find((entry) => entry.id === id);
      if (order) notifyReceiptPrinted(order);
    },
    confirmOrder: (id) => {
      setOrders((currentOrders) => currentOrders.map((order) => (
        order.id === id && !order.confirmed
          ? { ...order, confirmed: true, confirmedAt: new Date().toISOString() }
          : order
      )));
    },
    markOrderPaid: (id, paymentMethod) => {
      setOrders((currentOrders) => currentOrders.map((order) => (
        order.id === id
          ? {
            ...order,
            payment: PAYMENT_STATUS_PAID,
            ...(paymentMethod ? { paymentMethod } : {}),
            paidAt: new Date().toISOString(),
          }
          : order
      )));
    },
    deleteOrder: (id) => {
      setOrders((currentOrders) => currentOrders.filter((order) => order.id !== id));
    },
  }), [orders]);

  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>;
}

export function useOrders() {
  return useContext(OrdersContext);
}

export function getOrderTime(createdAt) {
  return new Date(createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
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


