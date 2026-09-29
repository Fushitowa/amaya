/*
 * Staff notification plumbing.
 *
 * One module owns the storage key, the event name and the type registry, so
 * producers (any page that changes system state) and the consumer (the bell in
 * the staff header) can never drift apart.
 *
 * Writing is deliberately done by the notifier rather than by the bell: a
 * notification raised while no bell is mounted (staff sitting on the menu page,
 * or an admin editing the catalog) must still persist.
 */

export const STAFF_NOTIFICATIONS_KEY = "amaya_staff_notifications";
export const STAFF_NOTIFY_EVENT = "notify_staff";

// Keeps localStorage bounded: a long-running till would otherwise grow forever.
export const MAX_STAFF_NOTIFICATIONS = 50;

export const STAFF_NOTIFICATION_TYPES = {
  order_new: { label: "New order", tone: "amber" },
  order_completed: { label: "Order completed", tone: "green" },
  receipt_printed: { label: "Receipt printed", tone: "blue" },
  menu_added: { label: "Menu updated", tone: "emerald" },
  menu_deleted: { label: "Menu updated", tone: "red" },
  info: { label: "Notice", tone: "stone" },
};

export function readStaffNotifications() {
  try {
    const raw = localStorage.getItem(STAFF_NOTIFICATIONS_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeStaffNotifications(list) {
  const capped = list.slice(0, MAX_STAFF_NOTIFICATIONS);
  localStorage.setItem(STAFF_NOTIFICATIONS_KEY, JSON.stringify(capped));
  return capped;
}

let sequence = 0;

function makeId() {
  sequence += 1;
  return `n-${Date.now()}-${sequence}`;
}

/**
 * Raises a staff notification. Persists first, then notifies open bells, so
 * the record survives a reload even if nobody is listening yet.
 */
export function notifyStaff(type, { title, message } = {}) {
  const definition = STAFF_NOTIFICATION_TYPES[type] || STAFF_NOTIFICATION_TYPES.info;

  const entry = {
    id: makeId(),
    type,
    title: title || definition.label,
    message: message || "",
    timestamp: new Date().toISOString(),
    read: false,
  };

  const updated = writeStaffNotifications([entry, ...readStaffNotifications()]);

  window.dispatchEvent(
    new CustomEvent(STAFF_NOTIFY_EVENT, { detail: { type, entry, notifications: updated } })
  );

  return entry;
}

/* ---- event shorthands used across the app ---- */

export const notifyOrderCreated = (order) =>
  notifyStaff("order_new", {
    title: "New POS order",
    message: `Order #${order?.id} created · ₱${Number(order?.total || 0).toFixed(2)}`,
  });

export const notifyOrderCompleted = (order) =>
  notifyStaff("order_completed", {
    title: "Order completed",
    message: `Order #${order?.id} marked as COMPLETED`,
  });

export const notifyReceiptPrinted = (order) =>
  notifyStaff("receipt_printed", {
    title: "Receipt printed",
    message: `Receipt printed for order #${order?.id}`,
  });

export const notifyMenuAdded = (product) =>
  notifyStaff("menu_added", {
    title: "New menu item",
    message: `New item “${product?.name}” added to menu`,
  });

export const notifyMenuDeleted = (product) =>
  notifyStaff("menu_deleted", {
    title: "Menu item removed",
    message: `Item “${product?.name}” removed from menu`,
  });

/* ---- relative time ---- */

export function formatRelativeTime(timestamp) {
  const then = new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return "";

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "Just now";
  if (seconds < 90) return "1m ago";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(then).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ---- audio ----
   Browsers block audio until the user interacts with the page, so the chime
   stays silent until a real gesture has been seen. No audio asset needed: the
   two-tone blip is synthesised. */

let audioContext = null;
let userHasInteracted = false;

function markInteraction() {
  if (userHasInteracted) return;
  userHasInteracted = true;
  if (audioContext) return;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (Ctor) audioContext = new Ctor();
}

if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", markInteraction, { once: true, passive: true });
  window.addEventListener("keydown", markInteraction, { once: true });
}

export function playNotificationChime() {
  if (!userHasInteracted) return;
  if (!audioContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    audioContext = new Ctor();
  }
  if (audioContext.state === "suspended") audioContext.resume?.();

  const now = audioContext.currentTime;

  [
    { at: 0, freq: 784 }, // G5
    { at: 0.11, freq: 1046.5 }, // C6
  ].forEach(({ at, freq }) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now + at);

    // Short envelope so it reads as a chime, not a beep.
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.12, now + at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.19);

    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(now + at);
    osc.stop(now + at + 0.22);
  });
}
