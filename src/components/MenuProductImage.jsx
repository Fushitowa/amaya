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
        color: "#7a573d",
        background: "radial-gradient(circle at 50% 40%, #faf6f1 0%, #ebe1d6 100%)",
        ...fallbackStyle,
      }}
    >
      <span
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "12px",
          display: "grid",
          placeItems: "center",
          background: "rgba(255, 255, 255, 0.72)",
          border: "1px solid rgba(139, 94, 60, 0.14)",
          boxShadow: "0 4px 10px rgba(45, 31, 22, 0.05)",
        }}
      >
        <CupSoda size={22} strokeWidth={1.75} aria-hidden="true" />
      </span>
    </div>
  );
}
