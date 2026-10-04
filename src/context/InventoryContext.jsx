/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../utils/api.js";
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
  const { user } = useAuth();

  const refreshInventory = useCallback(async () => {
    if (!user) return [];
    const saved = await apiRequest("/inventory");
    setInventory(saved);
    return saved;
  }, [user]);

  useEffect(() => {
    if (!user) {
      setInventory([]);
      return undefined;
    }
    let active = true;
    const load = () => apiRequest("/inventory")
      .then((saved) => { if (active) setInventory(saved); })
      .catch((error) => console.error("Could not load inventory:", error.message));
    load();
    const interval = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(interval); };
  }, [user?.role]);

  const value = useMemo(() => ({
    inventory,
    refreshInventory,
    syncIngredientsFromMenu: async () => {
      const before = new Set(inventory.map((item) => item.item.toLowerCase()));
      const saved = await refreshInventory();
      return { added: saved.filter((item) => !before.has(item.item.toLowerCase())).map((item) => item.item), skipped: [] };
    },
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
  }), [inventory, refreshInventory]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory() {
  return useContext(InventoryContext);
}

export default InventoryProvider;
