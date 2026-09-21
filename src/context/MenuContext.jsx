/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from "react";

const menuStorageKey = "amaya-admin-menu-products";
const MenuContext = createContext(null);

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
    addProduct: (product) => setProducts((current) => [...current, { ...product, id: Date.now() }]),
    updateProduct: (id, updates) => setProducts((current) => current.map((product) => product.id === id ? { ...product, ...updates } : product)),
    deleteProduct: (id) => setProducts((current) => current.filter((product) => product.id !== id)),
  }), [products]);

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>;
}

export function useMenu() {
  return useContext(MenuContext);
}

