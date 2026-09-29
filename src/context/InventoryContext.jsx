/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export const INVENTORY_STORAGE_KEY = "amaya-inventory";

const InventoryContext = createContext(null);

export const INVENTORY_CATEGORIES = [
  "All",
  "Soft Drinks",
  "Syrup",
  "Tea",
  "Dairy",
  "Frozen Food",
  "Meat",
  "Bakery",
  "Supplies",
  "Condiments",
  "Toppings",
  "Packaging",
  "Dessert Ingredients",
  "Fruit",
  "Cooking Supplies",
];

// Where recipe ingredients land when the menu category has no inventory equivalent.
export const DEFAULT_INGREDIENT_CATEGORY = "Supplies";

export function getInventoryStatus(quantity, minimumStock) {
  if (quantity === 0) return "Out of Stock";
  if (quantity <= minimumStock) return "Low Stock";
  return "In Stock";
}

// Starts empty by design: staff build the catalog with "+ Add inventory".
// A stored empty array is a valid permanent state, so only a missing key seeds.
function readInventory() {
  try {
    const saved = localStorage.getItem(INVENTORY_STORAGE_KEY);
    if (saved === null) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const normaliseName = (value) => String(value || "").trim().toLowerCase();

function InventoryProvider({ children }) {
  const [inventory, setInventory] = useState(readInventory);

  useEffect(() => {
    localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(inventory));
  }, [inventory]);

  useEffect(() => {
    const syncInventory = (event) => {
      if (event.key !== INVENTORY_STORAGE_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        if (Array.isArray(parsed)) setInventory(parsed);
      } catch {
        // Ignore malformed values written by another tab.
      }
    };

    window.addEventListener("storage", syncInventory);
    return () => window.removeEventListener("storage", syncInventory);
  }, []);

  /**
   * Registers recipe ingredients as inventory items.
   *
   * Existing items are never touched, so real stock levels, units and status
   * survive an admin re-saving a menu item. Only genuinely new names are added,
   * and they start at zero stock so they surface as "Out of Stock" for ordering.
   *
   * `status` is intentionally not stored: it is derived from quantity/minimum
   * by getInventoryStatus, and persisting a copy would go stale the moment
   * someone restocks the item.
   */
  const syncIngredientsFromMenu = useCallback(
    (ingredientNames, options = {}) => {
      const cleaned = (ingredientNames || [])
        .map((name) => String(name || "").trim())
        .filter(Boolean);

      if (!cleaned.length) return { added: [], skipped: [] };

      const category = INVENTORY_CATEGORIES.includes(options.category)
        ? options.category
        : DEFAULT_INGREDIENT_CATEGORY;

      const seen = new Set(inventory.map((entry) => normaliseName(entry.item)));
      const now = new Date().toISOString();
      const pending = [];
      const skipped = [];

      cleaned.forEach((name) => {
        const key = normaliseName(name);
        if (seen.has(key)) {
          skipped.push(name);
          return;
        }
        seen.add(key);
        pending.push({
          id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          item: name,
          category,
          quantity: 0,
          unit: "pcs",
          minimumStock: 10,
          addedFromMenu: true,
          lastUpdated: now,
        });
      });

      if (pending.length) setInventory((current) => [...current, ...pending]);

      return { added: pending.map((entry) => entry.item), skipped };
    },
    [inventory],
  );

  const addInventoryItem = useCallback((item) => {
    setInventory((current) => [
      ...current,
      {
        id: item.id ?? `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        item: item.item,
        category: item.category || DEFAULT_INGREDIENT_CATEGORY,
        quantity: Number(item.quantity || 0),
        unit: item.unit || "pcs",
        minimumStock: Number(item.minimumStock || 0),
      },
    ]);
  }, []);

  const updateInventoryItem = useCallback((id, updates) => {
    setInventory((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...updates, lastUpdated: new Date().toISOString() } : entry)),
    );
  }, []);

  const removeInventoryItem = useCallback((id) => {
    setInventory((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      inventory,
      setInventory,
      syncIngredientsFromMenu,
      addInventoryItem,
      updateInventoryItem,
      removeInventoryItem,
    }),
    [inventory, syncIngredientsFromMenu, addInventoryItem, updateInventoryItem, removeInventoryItem],
  );

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory() {
  return useContext(InventoryContext);
}

export default InventoryProvider;
