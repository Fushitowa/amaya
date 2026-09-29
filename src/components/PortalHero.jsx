import { CalendarDays } from "lucide-react";

function PortalHero({
  label,
  greeting,
  highlight,
  subtitle,
  dateLabel = "Today",
  date,
  statusTitle = "System active",
  className = "",
}) {
  return (
    <section className={`portal-hero ${className}`.trim()}>
      <span className="portal-hero-glow portal-hero-glow-lg" aria-hidden="true" />
      <span className="portal-hero-glow portal-hero-glow-sm" aria-hidden="true" />
      <span className="portal-hero-shimmer" aria-hidden="true" />

      <div className="portal-hero-body">
        <div className="portal-hero-copy">
          <div className="portal-hero-label-row">
            <span className="portal-hero-label">{label}</span>
            <span className="portal-hero-dot" title={statusTitle} aria-hidden="true" />
          </div>

          <h2 className="portal-hero-headline">
            {greeting}, <span className="portal-hero-accent">{highlight}</span>
          </h2>

          <p className="portal-hero-subtitle">{subtitle}</p>
        </div>

        <div className="portal-hero-date">
          <span className="portal-hero-date-icon" aria-hidden="true">
            <CalendarDays size={16} strokeWidth={2} />
          </span>
          <span className="portal-hero-date-text">
            <span className="portal-hero-date-label">{dateLabel}</span>
            <strong>{date}</strong>
          </span>
        </div>
      </div>
    </section>
  );
}

export default PortalHero;
