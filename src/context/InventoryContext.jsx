/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../utils/api.js";
import { notifyInventoryLevels } from "../utils/notifications.js";
import { useAuth } from "./AuthContext.jsx";

const InventoryContext = createContext(null);

export const INVENTORY_CATEGORIES = [
  "All",
  "Cups & Lids",
  "Packaging & Disposables",
  "Snack Ingredients & Meats",
  "Bakery & Breads",
  "Dairy & Ice Cream",
  "Syrups & Purees",
  "Powders & Seasonings",
  "Toppings & Add-ons",
  "Cooking & Condiments",
  "Store & Cleaning Supplies",
];
export const DEFAULT_INGREDIENT_CATEGORY = "Cups & Lids";

export function getInventoryStatus(quantity, maximumStock) {
  if (Number(quantity) <= 0) return "Out of Stock";
  if (Number(maximumStock) > 0 && Number(quantity) > Number(maximumStock)) return "Over Maximum";
  return "In Stock";
}

function InventoryProvider({ children }) {
  const [inventory, setInventory] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loadedUserId, setLoadedUserId] = useState(null);
  const [error, setError] = useState("");
  const { user } = useAuth();
  const userId = user?.id;

  const refreshCategories = useCallback(async () => {
    if (!user) return [];
    try {
      const saved = await apiRequest("/inventory/categories?all=true");
      setCategories(saved);
      return saved;
    } catch (requestError) {
      console.warn("Could not load inventory categories:", requestError.message);
      return [];
    }
  }, [user]);

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
    const load = () => {
      apiRequest("/inventory")
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
      refreshCategories();
    };
    load();
    const interval = window.setInterval(load, 30000);
    window.addEventListener("amaya:stock-mutated", load);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("amaya:stock-mutated", load);
    };
  }, [refreshCategories, userId]);

  useEffect(() => {
    if (!userId || loadedUserId !== userId) return;
    notifyInventoryLevels().catch(() => {});
  }, [inventory, loadedUserId, userId]);

  const value = useMemo(() => ({
    inventory: user ? inventory : [],
    categories: categories.length ? categories : INVENTORY_CATEGORIES.filter((c) => c !== "All").map((c, i) => ({ id: i + 1, name: c, isCupCategory: c === "Cups" || c === "Cups & Lids", isSystem: true, displayOrder: i + 1, isActive: true, itemCount: 0 })),
    categoryNames: ["All", ...(categories.length ? categories.filter((c) => c.isActive !== false).map((c) => c.name) : INVENTORY_CATEGORIES.filter((c) => c !== "All"))],
    loading: Boolean(user && loadedUserId !== user.id),
    error: user ? error : "",
    refreshInventory,
    refreshCategories,
    addCategory: async (categoryData) => {
      const saved = await apiRequest("/inventory/categories", {
        method: "POST",
        body: JSON.stringify(categoryData),
      });
      setCategories((current) => [...current, saved]);
      return saved;
    },
    updateCategory: async (id, categoryData) => {
      const saved = await apiRequest(`/inventory/categories/${id}`, {
        method: "PUT",
        body: JSON.stringify(categoryData),
      });
      setCategories((current) => current.map((c) => c.id === id ? saved : c));
      await refreshInventory();
      return saved;
    },
    deleteCategory: async (id) => {
      await apiRequest(`/inventory/categories/${id}`, { method: "DELETE" });
      setCategories((current) => current.filter((c) => c.id !== id));
    },
    totalInventoryValue: inventory.reduce(
      (sum, item) => sum + (Number(item.quantity || 0) * Number(item.unitCost || item.unit_cost || 0)),
      0,
    ),
    addInventoryItem: async (item) => {
      const saved = await apiRequest("/inventory", { method: "POST", body: JSON.stringify(item) });
      setInventory((current) => [...current, saved]);
      window.dispatchEvent(new CustomEvent("amaya:stock-mutated"));
      return saved;
    },
    updateInventoryItem: async (id, updates) => {
      const existing = inventory.find((item) => item.id === id);
      if (!existing) return null;
      const saved = await apiRequest(`/inventory/${id}`, { method: "PUT", body: JSON.stringify({ ...existing, ...updates }) });
      setInventory((current) => current.map((item) => item.id === id ? saved : item));
      window.dispatchEvent(new CustomEvent("amaya:stock-mutated"));
      return saved;
    },
    restockInventoryItem: async (id, quantity, batchCost) => {
      const payload = {
        quantity,
        ...(batchCost !== undefined && batchCost !== null && String(batchCost).trim() !== ""
          ? { batchCost: Number(batchCost) }
          : {}),
      };
      const saved = await apiRequest(`/inventory/${id}/restock`, { method: "POST", body: JSON.stringify(payload) });
      setInventory((current) => current.map((item) => item.id === id ? saved : item));
      window.dispatchEvent(new CustomEvent("amaya:stock-mutated"));
      return saved;
    },
    removeInventoryItem: async (id) => {
      await apiRequest(`/inventory/${id}`, { method: "DELETE" });
      setInventory((current) => current.filter((item) => item.id !== id));
      window.dispatchEvent(new CustomEvent("amaya:stock-mutated"));
    },
  }), [error, inventory, loadedUserId, refreshInventory, user]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory() {
  return useContext(InventoryContext);
}

export default InventoryProvider;
