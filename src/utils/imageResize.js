// Shrinks an uploaded photo to a compressed data URI that fits the database.
// Images are stored as base64 in one MariaDB row and XAMPP's max_allowed_packet is
// 1 MB, so the API rejects data URIs above ~850,000 characters (api/src/utils/validation.js).

export const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024; // raw phone photos are fine
const TARGET_DATA_URI_LENGTH = 500_000; // ~370 KB of image data, well under the API limit
const MAX_DIMENSION = 1024;
const MIN_DIMENSION = 320;
const QUALITIES = [0.85, 0.75, 0.65, 0.55];

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> decoding
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas, quality) {
  const webp = canvas.toDataURL("image/webp", quality);
  if (webp.startsWith("data:image/webp")) return webp;
  return canvas.toDataURL("image/jpeg", quality); // browsers without WebP encoding
}

/**
 * @param {File} file PNG, JPEG or WEBP image
 * @returns {Promise<string>} data URI no longer than TARGET_DATA_URI_LENGTH
 */
export async function shrinkImageToDataUri(file) {
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error("Image is larger than 15 MB. Please choose a smaller file.");
  }
  const source = await loadBitmap(file);
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  if (!width || !height) throw new Error("Could not read that image. Please try another.");

  let longest = Math.min(MAX_DIMENSION, Math.max(width, height));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  while (longest >= MIN_DIMENSION) {
    const scale = longest / Math.max(width, height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    // White background so transparent PNGs don't turn black if JPEG is the fallback.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (const quality of QUALITIES) {
      const dataUri = encode(canvas, quality);
      if (dataUri.length <= TARGET_DATA_URI_LENGTH) {
        source.close?.();
        return dataUri;
      }
    }
    longest = Math.floor(longest * 0.8);
  }
  source.close?.();
  throw new Error("This image could not be compressed enough. Please choose a simpler or smaller photo.");
}
