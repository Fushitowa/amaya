import { createHash } from "node:crypto";
import { Router } from "express";
import pool from "../database.js";
import { parsePositiveIntId } from "../utils/validation.js";

const router = Router();
const DATA_URI_RE = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/i;

export function resolveMediaUrl(kind, id, rawImage, updatedAt = null) {
  if (!rawImage) return "";
  const image = String(rawImage).trim();
  if (!image) return "";
  if (DATA_URI_RE.test(image)) {
    const version = updatedAt ? new Date(updatedAt).getTime() : 0;
    const suffix = Number.isFinite(version) && version > 0 ? `?v=${version}` : "";
    return `/api/media/${kind}/${Number(id)}${suffix}`;
  }
  return image;
}

function sendMediaResponse(request, response, rawImage) {
  if (!rawImage) {
    return response.status(404).end();
  }
  const image = String(rawImage).trim();
  if (!image) {
    return response.status(404).end();
  }

  const match = image.match(DATA_URI_RE);
  if (match) {
    const subtype = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
    const base64Body = match[2].replace(/\s+/g, "");
    const buffer = Buffer.from(base64Body, "base64");
    const etag = `"${createHash("sha256").update(buffer).digest("hex").slice(0, 16)}"`;

    response.set({
      "Content-Type": `image/${subtype}`,
      "Cache-Control": "public, max-age=86400",
      ETag: etag,
    });

    if (request.get("if-none-match") === etag) {
      return response.status(304).end();
    }
    return response.send(buffer);
  }

  if (/^(https?:\/\/|\/)/i.test(image)) {
    return response.redirect(302, image);
  }

  return response.status(404).end();
}

router.get("/menu/:id", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "menu item ID");
  const [[row]] = await pool.execute(
    "SELECT image_url FROM menu_products WHERE id = ? AND is_archived = FALSE LIMIT 1",
    [id],
  );
  return sendMediaResponse(request, response, row?.image_url);
});

router.get("/inventory/:id", async (request, response) => {
  const id = parsePositiveIntId(request.params.id, "inventory item ID");
  const [[row]] = await pool.execute(
    "SELECT image_url FROM inventory_items WHERE id = ? AND is_archived = FALSE LIMIT 1",
    [id],
  );
  return sendMediaResponse(request, response, row?.image_url);
});

export default router;
