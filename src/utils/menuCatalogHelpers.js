/**
 * Pure catalog read & normalization helpers shared across storefront, POS, and tests.
 */

export function parseMenuPrice(raw) {
  const value = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

export function findProductById(products, id) {
  if (id === null || id === undefined) return null;
  return (products || []).find((product) => product.id === id) || null;
}

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
    sizes.push({
      label,
      price: parseMenuPrice(size?.price),
      ingredients: Array.isArray(size?.ingredients) ? size.ingredients : [],
    });
  });

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
    addons.push({
      ...addon,
      label,
      price: parseMenuPrice(addon?.price),
      quantityUsed: Number(addon?.quantityUsed || 0),
      unit: addon?.unit || addon?.stockUnit || "pcs",
      stockUnit: addon?.stockUnit || "pcs",
    });
  });

  return addons;
}
