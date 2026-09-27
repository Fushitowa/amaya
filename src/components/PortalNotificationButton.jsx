import { useState } from "react";

import NotificationIcon from "./NotificationIcon.jsx";

const palette = {
  border: "#E7E0D8",
  borderHover: "#D9CFC3",
  surface: "#FFFFFF",
  surfaceHover: "#F7F2ED",
  icon: "#5A3E2B",
  iconHover: "#3F2A1C",
  accent: "#B45309",
  ring: "rgba(90, 62, 43, 0.35)",
};

function PortalNotificationButton({
  count = null,
  hasUnread = false,
  label = "Notifications",
  iconSize = 20,
  className = "",
  onClick,
  ...rest
}) {
  const [isHovered, setIsHovered] = useState(false);

  const hasCount = Number.isFinite(count) && count > 0;
  const showDot = !hasCount && hasUnread;

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      aria-label={hasCount ? `${label}, ${count} unread` : label}
      title={hasCount ? `${label} (${count})` : label}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "40px",
        height: "40px",
        flex: "0 0 40px",
        padding: 0,
        borderRadius: "12px",
        border: `1px solid ${isHovered ? palette.borderHover : palette.border}`,
        background: isHovered ? palette.surfaceHover : palette.surface,
        color: isHovered ? palette.iconHover : palette.icon,
        cursor: "pointer",
        transition: "background-color 150ms ease, border-color 150ms ease, color 150ms ease",
        ...(isHovered ? { boxShadow: `0 0 0 3px ${palette.ring}` } : null),
      }}
      {...rest}
    >
      <NotificationIcon size={iconSize} />

      {hasCount ? (
        <span
          style={{
            position: "absolute",
            top: "-6px",
            right: "-6px",
            minWidth: "18px",
            padding: "2px 6px",
            borderRadius: "999px",
            background: palette.accent,
            color: "#FFFFFF",
            fontSize: "10px",
            fontWeight: 600,
            lineHeight: 1.4,
            textAlign: "center",
            boxShadow: "0 1px 2px rgba(45, 31, 26, 0.25)",
          }}
        >
          {count}
        </span>
      ) : null}

      {showDot ? (
        <span
          style={{
            position: "absolute",
            top: "-3px",
            right: "-3px",
            width: "9px",
            height: "9px",
            borderRadius: "50%",
            background: palette.accent,
            border: "2px solid #FFFFFF",
            boxShadow: "0 1px 2px rgba(45, 31, 26, 0.2)",
          }}
        />
      ) : null}
    </button>
  );
}

export default PortalNotificationButton;
