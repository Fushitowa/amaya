/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { notifyMenuAdded, notifyMenuDeleted } from "../utils/notifications.js";
import { apiRequest } from "../utils/api.js";
import { useAuth } from "./AuthContext.jsx";

const MenuContext = createContext(null);

/**
 * Catalog read helpers.
 *
 * Admin Menu Management is the single source of truth for size variants and
 * add-ons: staff never define their own, they read what the catalog says.
 * These helpers are the one place that normalises those fields, so the
 * Staff Portal and the Admin Portal cannot drift apart.
 */

// Catalog prices are stored as display strings (e.g. "\u20b139.00") in some
// legacy records and as numbers in others; accept both.
export function parseMenuPrice(raw) {
  const value = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

export function findProductById(products, id) {
  if (id === null || id === undefined) return null;
  return (products || []).find((product) => product.id === id) || null;
}

// Admins type catalog labels in whatever case they like ("extra large", "LARGE").
// Staff-facing option pills read better normalised, so title-case them once here
// rather than relying on CSS text-transform, which would not affect the
// summary text or the stored selection key.
export function normaliseLabel(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function resolveProductSizes(product) {
  const base = parseMenuPrice(product?.price);
  const configured = Array.isArray(product?.sizes) ? product.sizes : [];
  const seen = new Set();
  const sizes = [];

  configured.forEach((size) => {
    const label = normaliseLabel(size?.label);
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    sizes.push({ label, price: parseMenuPrice(size?.price) });
  });

  // No configured variants: one default priced at the item's own base price.
  // Derived from the product, never a hard-coded size table.
  return sizes.length ? sizes : [{ label: "Regular", price: base }];
}

export function resolveProductAddons(product) {
  const configured = Array.isArray(product?.addons) ? product.addons : [];
  const seen = new Set();
  const addons = [];

  configured.forEach((addon) => {
    const label = normaliseLabel(addon?.label);
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    addons.push({ label, price: parseMenuPrice(addon?.price) });
  });

  return addons;
}

const imageImports = import.meta.glob("../assets/images/menu/**/*.{png,jpg,jpeg,webp}", {
  eager: true,
  import: "default",
});

function titleFromFile(fileName) {
  return fileName
    .replace(/\.(png|jpe?g|webp)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/&/g, " & ")
    .replace(/\bstawberry\b/gi, "strawberry")
    .replace(/\bstawberrymilk\b/gi, "strawberry milk")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function MenuProvider({ children }) {
  const [products, setProducts] = useState([]);
  const { user } = useAuth();

  const withLocalImage = useCallback((product) => {
    if (product.image) return product;
    const imageEntry = Object.entries(imageImports).find(([path]) => {
      const fileName = path.split("/").at(-1);
      return titleFromFile(fileName).toLowerCase() === product.name.toLowerCase();
    });
    return imageEntry ? { ...product, image: imageEntry[1] } : product;
  }, []);

  const refreshProducts = useCallback(async () => {
    const query = user ? "?all=true" : "";
    const saved = await apiRequest(`/menu${query}`);
    setProducts(saved.map(withLocalImage));
    return saved.map(withLocalImage);
  }, [user, withLocalImage]);

  useEffect(() => {
    let current = true;
    const load = () => apiRequest(`/menu${user ? "?all=true" : ""}`)
      .then((saved) => { if (current) setProducts(saved.map(withLocalImage)); })
      .catch((error) => console.error("Could not load menu:", error.message));
    load();
    const interval = window.setInterval(load, 30000);
    return () => { current = false; window.clearInterval(interval); };
  }, [user?.role, withLocalImage]);

  const value = useMemo(() => ({
    products,
    refreshProducts,
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
  }), [products, user, refreshProducts, withLocalImage]);

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

export function useMenu() {
  return useContext(MenuContext);
}

