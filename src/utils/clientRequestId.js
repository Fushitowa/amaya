export function createClientRequestId(prefix = "req") {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(10);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${prefix}-${Date.now()}-${hex}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 12).padEnd(10, "0")}`;
}
