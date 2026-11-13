import { apiFetchBlobWithMeta } from "./api.js";

export function peso(value) {
  const num = Number(value || 0);
  const safe = Number.isFinite(num) ? num : 0;
  return `₱${safe.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function compactPeso(value) {
  const num = Number(value || 0);
  const safe = Number.isFinite(num) ? num : 0;
  const abs = Math.abs(safe);
  const sign = safe < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return `${sign}₱${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    return `${sign}₱${(abs / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${sign}₱${Math.round(abs).toLocaleString("en-PH")}`;
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function initials(name) {
  const clean = String(name || "").trim();
  if (!clean) return "ST";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

export function getManilaDateInputValue(offsetDays = 0) {
  const base = new Date(Date.now() + Number(offsetDays || 0) * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

const MOVEMENT_LABELS = {
  restock: "Restock",
  adjustment: "Adjustment",
  usage: "Order Usage",
  spoilage: "Void Spoilage",
  void_restore: "Void Restore",
};

const MOVEMENT_TONES = {
  restock: "positive",
  void_restore: "positive",
  adjustment: "neutral",
  usage: "usage",
  spoilage: "warning",
};

export function getMovementLabel(type) {
  const key = String(type || "").toLowerCase().trim();
  return MOVEMENT_LABELS[key] || (key ? key.replace(/_/g, " ") : "Movement");
}

export function getMovementTone(type) {
  const key = String(type || "").toLowerCase().trim();
  return MOVEMENT_TONES[key] || "neutral";
}

export async function downloadAuthenticatedCsv(urlPath, filename) {
  const { blob, truncated, totalCount, exportedCount } = await apiFetchBlobWithMeta(urlPath);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename || "amaya-export.csv";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 1000);
  return { truncated, totalCount, exportedCount };
}
