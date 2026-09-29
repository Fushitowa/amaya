/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { notifyMenuAdded, notifyMenuDeleted } from "../utils/notifications.js";

const menuStorageKey = "amaya-admin-menu-products";
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

const categoryMap = {
  milktea: "Milk Tea",
  drinks: "Drinks",
  snacks: "Snacks",
  dessert: "Desserts",
};

const categoryDescriptions = {
  "Milk Tea": "Creamy and sweet milktea selections.",
  Drinks: "Refreshing drinks and crafted cafe favorites.",
  Snacks: "Savory bites and comfort snack classics.",
  Desserts: "Sweet desserts and finishing treats.",
};

const priceMap = {
  classic: 39,
  chocolate: 39,
  "cookie&cream": 39,
  matcha: 39,
  mango: 30,
  caramel: 39,
  cokefloat: 25,
  chocofloat: 25,
  blueberry: 25,
  greenapple: 25,
  stawberry: 25,
  stawberrymilk: 30,
  lumpia: 20,
  takoyaki: 30,
  burger: 55,
  hotdogbun: 45,
  tempura: 20,
  fishball: 20,
  siomai: 20,
  mangofloat: 95,
};

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

function initialProducts() {
  return Object.entries(imageImports).map(([path, image], index) => {
    const parts = path.split("/");
    const category = categoryMap[parts[parts.length - 2]] || "Drinks";
    const fileName = parts[parts.length - 1];
    const key = fileName.replace(/\.(png|jpe?g|webp)$/i, "").toLowerCase();
    const price = priceMap[key] || 75;

    return {
      id: index + 1,
      name: titleFromFile(fileName),
      category,
      price: `₱${price.toFixed(2)}`,
      image,
      description: categoryDescriptions[category],
      stock: 20,
      available: true,
      featured: index < 3,
      sizes: [{ label: "Regular", price }],
    };
  });
}

function readProducts() {
  try {
    const savedProducts = localStorage.getItem(menuStorageKey);
    return savedProducts ? JSON.parse(savedProducts) : initialProducts();
  } catch {
    return initialProducts();
  }
}

export function MenuProvider({ children }) {
  const [products, setProducts] = useState(readProducts);

  useEffect(() => {
    localStorage.setItem(menuStorageKey, JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    const syncProducts = (event) => {
      if (event.key !== menuStorageKey || !event.newValue) return;
      try {
        setProducts(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed values written by another tab.
      }
    };

    window.addEventListener("storage", syncProducts);
    return () => window.removeEventListener("storage", syncProducts);
  }, []);

  const value = useMemo(() => ({
    products,
    addProduct: (product) => {
      const created = { ...product, id: Date.now() };
      setProducts((current) => [...current, created]);
      notifyMenuAdded(created);
    },
    updateProduct: (id, updates) => setProducts((current) => current.map((product) => product.id === id ? { ...product, ...updates } : product)),
    deleteProduct: (id) => {
      const product = products.find((entry) => entry.id === id);
      setProducts((current) => current.filter((entry) => entry.id !== id));
      if (product) notifyMenuDeleted(product);
    },
  }), [products]);

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

export function useMenu() {
  return useContext(MenuContext);
}

