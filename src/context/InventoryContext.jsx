/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../utils/api.js";
import { useAuth } from "./AuthContext.jsx";

const InventoryContext = createContext(null);

export const INVENTORY_CATEGORIES = [];
export const DEFAULT_INGREDIENT_CATEGORY = "";

export function getInventoryStatus(quantity, maximumStock) {
  if (Number(quantity) <= 0) return "Out of Stock";
  if (Number(maximumStock) > 0 && Number(quantity) > Number(maximumStock)) return "Over Maximum";
  return "In Stock";
}

function InventoryProvider({ children }) {
  const [inventory, setInventory] = useState([]);
  const [categories, setCategories] = useState([]);
  const [wasteLogs, setWasteLogs] = useState([]);
  const [wasteSummary, setWasteSummary] = useState({
    total: 0,
    totalWasteEventsToday: 0,
    totalWasteLossToday: null,
    topWastedItems: [],
  });
  const [wasteLogsLoading, setWasteLogsLoading] = useState(false);
  const [wasteOwnerId, setWasteOwnerId] = useState(null);
  const [wasteLogsError, setWasteLogsError] = useState("");
  const [loadedUserId, setLoadedUserId] = useState(null);
  const [error, setError] = useState("");
  const lastWasteQueryRef = useRef({ scope: "today", limit: 20 });
  const wasteRequestSeqRef = useRef(0);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const activeUserIdRef = useRef(userId);

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

  const fetchWasteLogs = useCallback(async (params = {}) => {
    const targetUserId = user?.id ?? null;
    if (!targetUserId) {
      return { items: [], total: 0, totalWasteEventsToday: 0 };
    }
    const reqSeq = ++wasteRequestSeqRef.current;
    const merged = { ...lastWasteQueryRef.current, ...params };
    lastWasteQueryRef.current = merged;
    const query = new URLSearchParams();
    if (merged.scope) query.set("scope", merged.scope);
    if (merged.reason) query.set("reason", merged.reason);
    if (merged.itemId) query.set("itemId", String(merged.itemId));
    if (merged.from) query.set("from", merged.from);
    if (merged.to) query.set("to", merged.to);
    if (merged.page) query.set("page", String(merged.page));
    if (merged.limit) query.set("limit", String(merged.limit));
    setWasteLogsLoading(true);
    try {
      const data = await apiRequest(`/inventory/waste-logs?${query.toString()}`);
      if (activeUserIdRef.current !== targetUserId || wasteRequestSeqRef.current !== reqSeq) {
        return data;
      }
      setWasteLogs(Array.isArray(data?.items) ? data.items : []);
      setWasteSummary({
        total: Number(data?.total || 0),
        totalWasteEventsToday: Number(data?.totalWasteEventsToday || 0),
        totalWasteLossToday: data?.totalWasteLossToday !== undefined ? Number(data.totalWasteLossToday || 0) : null,
        topWastedItems: Array.isArray(data?.topWastedItems) ? data.topWastedItems : [],
      });
      setWasteOwnerId(targetUserId);
      setWasteLogsError("");
      return data;
    } catch (requestError) {
      if (activeUserIdRef.current === targetUserId && wasteRequestSeqRef.current === reqSeq) {
        setWasteOwnerId(targetUserId);
        setWasteLogsError(requestError.message || "Could not load waste logs.");
      }
      throw requestError;
    } finally {
      if (activeUserIdRef.current === targetUserId && wasteRequestSeqRef.current === reqSeq) {
        setWasteLogsLoading(false);
      }
    }
  }, [user]);

  useEffect(() => {
    activeUserIdRef.current = userId;
    wasteRequestSeqRef.current += 1;
    lastWasteQueryRef.current = { scope: "today", limit: 20 };
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
      fetchWasteLogs(lastWasteQueryRef.current).catch((requestError) => {
        if (active) {
          console.warn("Could not load waste logs:", requestError.message);
        }
      });
    };
    load();
    const interval = window.setInterval(load, 30000);
    window.addEventListener("amaya:stock-mutated", load);
    window.addEventListener("amaya:session-changed", load);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("amaya:stock-mutated", load);
      window.removeEventListener("amaya:session-changed", load);
    };
  }, [fetchWasteLogs, refreshCategories, userId]);

  const recordInventoryWaste = useCallback(async (id, payload) => {
    const saved = await apiRequest(`/inventory/${id}/waste`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setInventory((current) =>
      current.map((item) =>
        item.id === Number(id) && saved?.afterQuantity !== undefined
          ? { ...item, quantity: Number(saved.afterQuantity) }
          : item,
      ),
    );
    window.dispatchEvent(new CustomEvent("amaya:stock-mutated"));
    window.dispatchEvent(new Event("amaya:notifications-updated"));
    return saved;
  }, []);

  const reverseWasteLog = useCallback(async (movementId, reason) => {
    const result = await apiRequest(`/inventory/waste-logs/${movementId}/reverse`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
    await refreshInventory().catch((requestError) => {
      console.warn("Could not refresh inventory after waste reversal:", requestError.message);
    });
    window.dispatchEvent(new CustomEvent("amaya:stock-mutated"));
    window.dispatchEvent(new Event("amaya:notifications-updated"));
    return result;
  }, [refreshInventory]);

  const value = useMemo(() => {
    const isInventoryCurrent = Boolean(user && loadedUserId === user.id);
    const isWasteCurrent = Boolean(user && wasteOwnerId === user.id);
    const visibleInventory = isInventoryCurrent ? inventory : [];
    const visibleCategories = isInventoryCurrent ? categories : [];

    return {
    inventory: visibleInventory,
    categories: visibleCategories,
    wasteLogs: isWasteCurrent ? wasteLogs : [],
    wasteSummary: isWasteCurrent
      ? wasteSummary
      : { total: 0, totalWasteEventsToday: 0, totalWasteLossToday: null, topWastedItems: [] },
    wasteLogsLoading: user ? (wasteLogsLoading || !isWasteCurrent) : false,
    wasteLogsError: isWasteCurrent ? wasteLogsError : "",
    categoryNames: ["All", ...(visibleCategories.filter((c) => c.isActive !== false).map((c) => c.name))],
    loading: Boolean(user && !isInventoryCurrent),
    error: isInventoryCurrent ? error : "",
    refreshInventory,
    refreshCategories,
    fetchWasteLogs,
    recordInventoryWaste,
    reverseWasteLog,
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
    reassignAndDeleteCategory: async (id, targetCategoryId) => {
      const result = await apiRequest(`/inventory/categories/${id}/reassign-and-delete`, {
        method: "PUT",
        body: JSON.stringify({ targetCategoryId }),
      });
      setCategories((current) => current.filter((c) => c.id !== id));
      await refreshInventory();
      return result;
    },
    totalInventoryValue: visibleInventory.reduce(
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
    restockInventoryItem: async (id, quantity, metaOrBatchCost) => {
      const isMetaObj = metaOrBatchCost !== null && typeof metaOrBatchCost === "object";
      const batchCost = isMetaObj ? metaOrBatchCost.batchCost : metaOrBatchCost;
      const supplierName = isMetaObj ? String(metaOrBatchCost.supplierName || "").trim() : "";
      const referenceNo = isMetaObj ? String(metaOrBatchCost.referenceNo || "").trim() : "";
      const creditAccountCode = isMetaObj ? String(metaOrBatchCost.creditAccountCode || "").trim() : "";
      const diluteZeroCost = isMetaObj ? Boolean(metaOrBatchCost.diluteZeroCost) : false;
      const payload = {
        quantity,
        ...(batchCost !== undefined && batchCost !== null && String(batchCost).trim() !== ""
          ? { batchCost: Number(batchCost) }
          : {}),
        ...(supplierName ? { supplierName } : {}),
        ...(referenceNo ? { referenceNo } : {}),
        ...(creditAccountCode ? { creditAccountCode } : {}),
        ...(diluteZeroCost ? { diluteZeroCost: true } : {}),
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
    };
  }, [
    categories,
    error,
    fetchWasteLogs,
    inventory,
    loadedUserId,
    recordInventoryWaste,
    refreshCategories,
    refreshInventory,
    reverseWasteLog,
    user,
    wasteLogs,
    wasteLogsError,
    wasteLogsLoading,
    wasteOwnerId,
    wasteSummary,
  ]);

  return <InventoryContext.Provider value={value}>{children}</InventoryContext.Provider>;
}

export function useInventory() {
  return useContext(InventoryContext);
}

export default InventoryProvider;
