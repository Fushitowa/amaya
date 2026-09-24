/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const ordersStorageKey = "amaya-orders";
const OrdersContext = createContext(null);

function readOrders() {
  try {
    const savedOrders = localStorage.getItem(ordersStorageKey);
    return savedOrders ? JSON.parse(savedOrders) : [];
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


