/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { notifyMenuAdded, notifyMenuDeleted } from "../utils/notifications.js";
import { apiRequest } from "../utils/api.js";
import { useAuth } from "./AuthContext.jsx";
import {
  findProductById,
  normaliseLabel,
  parseMenuPrice,
  resolveProductAddons,
  resolveProductSizes,
} from "../utils/menuCatalogHelpers.js";

export {
  findProductById,
  normaliseLabel,
  parseMenuPrice,
  resolveProductAddons,
  resolveProductSizes,
};

const MenuContext = createContext(null);

export function MenuProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [menuError, setMenuError] = useState("");
  const [categoriesError, setCategoriesError] = useState("");
  const { user } = useAuth() || {};
  const isPortal = import.meta.env.MODE === "portal";
  const isSignedIn = Boolean(user);
  const userRole = user?.role;

  const withLocalImage = useCallback((product) => {
    if (!product?.image || !/(?:^|[\\/])(?:src[\\/])?assets[\\/]images[\\/]menu[\\/]/i.test(product.image)) {
      return product;
    }
    // Catalog records can outlive local image files. Treat old local paths as
    // missing so the UI can render its built-in placeholder instead.
    return { ...product, image: "" };
  }, []);

  const refreshCategories = useCallback(async (signal = undefined) => {
    try {
      const query = isSignedIn ? "?all=true" : "";
      const saved = await apiRequest(`/menu/categories${query}`, signal ? { signal } : {});
      setCategories(saved);
      setCategoriesError("");
      return saved;
    } catch (error) {
      if (error?.name === "AbortError") return null;
      console.warn("Could not load menu categories:", error.message);
      setCategoriesError(error?.message || "Could not load menu categories.");
      return null;
    }
  }, [isSignedIn]);

  const refreshProducts = useCallback(async () => {
    try {
      const query = isSignedIn ? "?all=true&media=url" : "?media=url";
      const saved = await apiRequest(`/menu${query}`);
      const mapped = saved.map(withLocalImage);
      setMenuError("");
      setProducts(mapped);
      setLoading(false);
      return mapped;
    } catch (error) {
      setLoading(false);
      setMenuError(error?.message || "Could not load menu items from server.");
      throw error;
    }
  }, [isSignedIn, withLocalImage]);

  useEffect(() => {
    let current = true;
    let controller = null;
    const load = () => {
      if (controller) controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      const query = isSignedIn ? "?all=true&media=url" : "?media=url";
      apiRequest(`/menu${query}`, { signal })
        .then((saved) => {
          if (current) {
            setMenuError("");
            setProducts(saved.map(withLocalImage));
            setLoading(false);
          }
        })
        .catch((error) => {
          if (error?.name === "AbortError") return;
          console.error("Could not load menu:", error.message);
          if (current) {
            setMenuError(error?.message || "Could not load menu items from server.");
            setLoading(false);
          }
        });
      refreshCategories(signal);
    };
    load();

    if (!isPortal) {
      return () => {
        current = false;
        if (controller) controller.abort();
      };
    }

    const onInterval = () => {
      if (document.visibilityState === "hidden") return;
      load();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") load();
    };
    const interval = window.setInterval(onInterval, 30000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("amaya:stock-mutated", load);
    return () => {
      current = false;
      if (controller) controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("amaya:stock-mutated", load);
    };
  }, [isPortal, isSignedIn, refreshCategories, userRole, withLocalImage]);

  const value = useMemo(() => ({
    products: isSignedIn ? products : products.filter((product) => product.available),
    categories,
    categoryNames: ["All items", ...categories.filter((c) => c.isActive !== false).map((c) => c.name)],
    loading,
    error: menuError,
    menuError,
    categoriesError,
    refreshProducts,
    refreshCategories,
    addCategory: async (categoryData) => {
      const saved = await apiRequest("/menu/categories", {
        method: "POST",
        body: JSON.stringify(categoryData),
      });
      setCategories((current) => [...current, saved]);
      return saved;
    },
    updateCategory: async (id, categoryData) => {
      const saved = await apiRequest(`/menu/categories/${id}`, {
        method: "PUT",
        body: JSON.stringify(categoryData),
      });
      setCategories((current) => current.map((c) => c.id === id ? saved : c));
      await refreshProducts();
      return saved;
    },
    deleteCategory: async (id) => {
      await apiRequest(`/menu/categories/${id}`, { method: "DELETE" });
      setCategories((current) => current.filter((c) => c.id !== id));
    },
    reassignAndDeleteCategory: async (id, targetCategoryId) => {
      const result = await apiRequest(`/menu/categories/${id}/reassign-and-delete`, {
        method: "PUT",
        body: JSON.stringify({ targetCategoryId }),
      });
      setCategories((current) => current.filter((c) => c.id !== id));
      await refreshProducts();
      return result;
    },
    addProduct: async (product) => {
      const created = withLocalImage(await apiRequest("/menu", { method: "POST", body: JSON.stringify(product) }));
      setProducts((current) => [...current, created]);
      notifyMenuAdded(created);
      return created;
    },
    updateProduct: async (id, updates) => {
      const saved = withLocalImage(await apiRequest(`/menu/${id}`, { method: "PUT", body: JSON.stringify({ ...products.find((product) => product.id === id), ...updates }) }));
      setProducts((current) => current.map((product) => product.id === id ? saved : product));
      return saved;
    },
    deleteProduct: async (id) => {
      const product = products.find((entry) => entry.id === id);
      await apiRequest(`/menu/${id}`, { method: "DELETE" });
      setProducts((current) => current.filter((entry) => entry.id !== id));
      if (product) notifyMenuDeleted(product);
    },
  }), [categories, categoriesError, isSignedIn, loading, menuError, products, refreshCategories, refreshProducts, withLocalImage]);

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

export function useMenu() {
  return useContext(MenuContext);
}

