/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../utils/api.js";
import { notifyInventoryLowStock } from "../utils/notifications.js";
import { useAuth } from "./AuthContext.jsx";

const InventoryContext = createContext(null);

export const INVENTORY_CATEGORIES = [
  "All", "Soft Drinks", "Syrup", "Tea", "Dairy", "Frozen Food", "Meat", "Bakery",
  "Supplies", "Condiments", "Toppings", "Packaging", "Dessert Ingredients", "Fruit", "Cooking Supplies",
];
export const DEFAULT_INGREDIENT_CATEGORY = "Supplies";

export function getInventoryStatus(quantity, minimumStock) {
  if (Number(quantity) <= 0) return "Out of Stock";
  if (Number(quantity) <= Number(minimumStock)) return "Low Stock";
  return "In Stock";
}

function InventoryProvider({ children }) {
  const [inventory, setInventory] = useState([]);
  const [loadedUserId, setLoadedUserId] = useState(null);
  const [error, setError] = useState("");
  const { user } = useAuth();
  const userId = user?.id;

  const refreshInventory = useCallback(async () => {
    if (!user) return [];
    try {
      const saved = await apiRequest("/inventory");
      setInventory(saved);
      setLoadedUserId(user.id);
      setError("");
      return saved;
    } catch (requestError) {
      setLoadedUserId(user.id);
      setError(requestError.message || "Could not load inventory.");
      throw requestError;
    }
  }, [user]);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    const load = () => apiRequest("/inventory")
      .then((saved) => {
        if (!active) return;
        setInventory(saved);
        setLoadedUserId(userId);
        setError("");
      })
      .catch((requestError) => {
        if (!active) return;
        setLoadedUserId(userId);
        setError(requestError.message || "Could not load inventory.");
      });
    load();
    const interval = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(interval); };
  }, [userId]);

  useEffect(() => {
    if (!userId || loadedUserId !== userId) return;
    notifyInventoryLowStock().catch(() => {});
  }, [inventory, loadedUserId, userId]);

  const value = useMemo(() => ({
    inventory: user ? inventory : [],
    loading: Boolean(user && loadedUserId !== user.id),
    error: user ? error : "",
    refreshInventory,
    addInventoryItem: async (item) => {
      const saved = await apiRequest("/inventory", { method: "POST", body: JSON.stringify(item) });
      setInventory((current) => [...current, saved]);
      return saved;
    },
    updateInventoryItem: async (id, updates) => {
      const existing = inventory.find((item) => item.id === id);
      if (!existing) return null;
      const saved = await apiRequest(`/inventory/${id}`, { method: "PUT", body: JSON.stringify({ ...existing, ...updates }) });
      setInventory((current) => current.map((item) => item.id === id ? saved : item));
      return saved;
    },
    restockInventoryItem: async (id, quantity) => {
      const saved = await apiRequest(`/inventory/${id}/restock`, { method: "POST", body: JSON.stringify({ quantity }) });
      setInventory((current) => current.map((item) => item.id === id ? saved : item));
      return saved;
    },
    removeInventoryItem: async (id) => {
      await apiRequest(`/inventory/${id}`, { method: "DELETE" });
      setInventory((current) => current.filter((item) => item.id !== id));
    },
  }), [error, inventory, loadedUserId, refreshInventory, user]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory() {
  return useContext(InventoryContext);
}

export default InventoryProvider;
