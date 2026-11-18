import { httpError } from "../middleware/auth.js";

export const CLIENT_REQUEST_ID_REGEX = /^[A-Za-z0-9:_-]{16,96}$/;

/**
 * Validate optional idempotency key from request bodies/headers.
 * Accepts string length 16..96 matching [A-Za-z0-9:_-] (supports UUIDs and prefixed keys).
 */
export function parseOptionalClientRequestId(rawValue, options = {}) {
  const maxLength = typeof options === "number" ? options : (options.maxLength ?? 96);
  const fieldName = typeof options === "object" && options ? (options.fieldName || "clientRequestId") : "clientRequestId";
  const hasField = rawValue !== undefined && rawValue !== null && String(rawValue) !== "";
  if (!hasField) return null;
  if (typeof rawValue !== "string") {
    throw httpError(400, `Invalid ${fieldName} format.`);
  }
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  if (!CLIENT_REQUEST_ID_REGEX.test(trimmed) || trimmed.length > maxLength) {
    throw httpError(400, `Invalid ${fieldName} format. Expected 16-${maxLength} characters matching [A-Za-z0-9:_-].`);
  }
  return trimmed;
}

/**
 * Escape SQL LIKE wildcard characters (\, %, _) so user search terms match literally.
 */
export function escapeLikePattern(rawValue) {
  return String(rawValue ?? "").replace(/[\\%_]/g, "\\$&");
}

/**
 * Parse and validate a strictly positive integer ID parameter.
 */
export function parsePositiveIntId(rawValue, label = "ID") {
  const id = Number(rawValue);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw httpError(400, `Invalid ${label}.`);
  }
  return id;
}

/**
 * Unified image URL / base64 data-URI validator across menu products and inventory items.
 * Rejects SVG uploads, restricts data URIs to PNG/JPG/JPEG/WEBP/GIF under maxBytes,
 * and allows relative (/...) or http(s) URLs under maxLength characters.
 */
export function validateImageUrl(
  rawImage,
  {
    label = "Image",
    maxBytes = 5 * 1024 * 1024,
    maxLength = 8_000_000,
    undefinedAs = undefined,
  } = {},
) {
  if (rawImage === undefined) return undefinedAs;
  if (rawImage == null || rawImage === "") return null;

  const image = String(rawImage).trim();
  if (!image) return null;

  if (image.length > maxLength) {
    throw httpError(413, `${label} is too large. Choose an image under 5 MB.`);
  }

  if (/^data:image\/svg\+xml/i.test(image)) {
    throw httpError(400, "SVG image uploads are not permitted. Use PNG, JPG, WEBP, or GIF.");
  }

  const dataUriMatch = image.match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (dataUriMatch) {
    const base64Clean = dataUriMatch[2].replace(/\s+/g, "");
    const padding = base64Clean.endsWith("==") ? 2 : base64Clean.endsWith("=") ? 1 : 0;
    const decodedBytes = Math.max(0, Math.floor((base64Clean.length * 3) / 4) - padding);
    if (decodedBytes > maxBytes) {
      throw httpError(413, `${label} is too large. Choose an image under 5 MB.`);
    }
    return image;
  }

  if (/^(https?:\/\/|\/)/i.test(image)) {
    return image;
  }

  throw httpError(400, `${label} must be a PNG, JPG, WEBP, or GIF upload or a valid image URL.`);
}
