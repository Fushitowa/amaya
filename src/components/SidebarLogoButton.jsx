function SidebarLogoButton({ logo, alt, collapsed, onToggle, className = "" }) {
  return (
    <button
      type="button"
      className={`sidebar-logo-button ${className}`.trim()}
      onClick={onToggle}
      aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
      title={collapsed ? "Expand navigation" : "Collapse navigation"}
    >
      <img src={logo} alt={alt} />
    </button>
  );
}

export default SidebarLogoButton;
