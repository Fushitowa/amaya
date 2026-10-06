import { useState } from "react";
import { CupSoda } from "lucide-react";

/** Renders a graceful placeholder when a catalog image is missing or unavailable. */
export default function MenuProductImage({ src, alt = "Menu item", className = "", style, fallbackStyle }) {
  const [failedSource, setFailedSource] = useState("");
  const hasImage = Boolean(src) && failedSource !== src;

  if (hasImage) {
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        style={style}
        onError={() => setFailedSource(src)}
      />
    );
  }

  return (
    <div
      className={`menu-product-image-fallback ${className}`.trim()}
      role="img"
      aria-label={`${alt} image unavailable`}
      style={{
        display: "grid",
        placeItems: "center",
        color: "#8b6040",
        background: "linear-gradient(145deg, #fffaf4, #eee2d5)",
        ...fallbackStyle,
      }}
    >
      <CupSoda size={42} strokeWidth={1.5} aria-hidden="true" />
    </div>
  );
}
