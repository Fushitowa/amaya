/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const ordersStorageKey = "amaya-orders";
const OrdersContext = createContext(null);

export const defaultInitialOrders = [
  {
    id: "AM-104821",
    customer: "Kent Carbonell",
    items: [
      { title: "Matcha Milk Tea", quantity: 2, price: 39, size: "Regular", category: "Milk Tea" },
      { title: "Takoyaki", quantity: 1, price: 30, size: "Regular", category: "Snacks" },
    ],
    total: 108,
    status: "Pending",
    type: "Counter",
    payment: "Paid",
    createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
  },
  {
    id: "AM-104819",
    customer: "Jessie Cataya",
    items: [
      { title: "Classic Milk Tea", quantity: 1, price: 39, size: "Regular", category: "Milk Tea" },
      { title: "Burger", quantity: 1, price: 55, size: "Regular", category: "Snacks" },
    ],
    total: 94,
    status: "Preparing",
    type: "Counter",
    payment: "Paid",
    createdAt: new Date(Date.now() - 1000 * 60 * 35).toISOString(),
  },
  {
    id: "AM-104815",
    customer: "Maria Santos",
    items: [
      { title: "Cookies & Cream", quantity: 2, price: 39, size: "Regular", category: "Milk Tea" },
      { title: "Lumpia", quantity: 2, price: 20, size: "Regular", category: "Snacks" },
    ],
    total: 118,
    status: "Ready",
    type: "Takeout",
    payment: "Paid",
    createdAt: new Date(Date.now() - 1000 * 60 * 55).toISOString(),
  },
  {
    id: "AM-104810",
    customer: "Mark Dela Cruz",
    items: [
      { title: "Mango Float", quantity: 1, price: 95, size: "Regular", category: "Desserts" },
      { title: "Coke Float", quantity: 1, price: 25, size: "Regular", category: "Drinks" },
    ],
    total: 120,
    status: "Completed",
    type: "Dine-in",
    payment: "Paid",
    createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
  },
  {
    id: "AM-104802",
    customer: "Ana Reyes",
    items: [
      { title: "Hotdog Bun", quantity: 2, price: 45, size: "Regular", category: "Snacks" },
      { title: "Strawberry Milk", quantity: 1, price: 30, size: "Regular", category: "Drinks" },
    ],
    total: 120,
    status: "Pending",
    type: "Counter",
    payment: "Unpaid",
    createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
  },
];

function readOrders() {
  try {
    const savedOrders = localStorage.getItem(ordersStorageKey);
    if (savedOrders) {
      const parsed = JSON.parse(savedOrders);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
    return defaultInitialOrders;
  } catch {
    return defaultInitialOrders;
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
        setOrders(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed values written by another tab.
      }
    };

    window.addEventListener("storage", syncOrders);
    return () => window.removeEventListener("storage", syncOrders);
  }, []);

  const value = useMemo(() => ({
    orders,
    addOrder: ({ items, customerName = "Walk-in Customer", type = "Counter" }) => {
      const total = getOrderTotal(items);
      const createdAt = new Date().toISOString();
      const order = {
        id: `AM-${String(Date.now()).slice(-6)}`,
        customer: customerName,
        items: items.map((item) => ({
          title: item.title,
          quantity: Number(item.quantity || 0),
          price: Number(item.price || 0),
          size: item.size || "Regular",
          category: item.category || "Menu item",
        })),
        total,
        status: "Pending",
        type,
        payment: "Unpaid",
        createdAt,
      };

      setOrders((currentOrders) => [order, ...currentOrders]);
      return order;
    },
    updateOrderStatus: (id, status) => {
      setOrders((currentOrders) => currentOrders.map((order) => (
        order.id === id ? { ...order, status } : order
      )));
    },
    deleteOrder: (id) => {
      setOrders((currentOrders) => currentOrders.filter((order) => order.id !== id));
    },
    resetOrders: () => {
      setOrders(defaultInitialOrders);
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


