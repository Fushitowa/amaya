import { Link } from "react-router-dom";

import amayaLogo from "../assets/images/amayalogo.png";
import { formatBusinessTime, useBusiness } from "../context/BusinessContext.jsx";

function Footer() {
  const currentYear = new Date().getFullYear();
  const { businessSettings } = useBusiness();
  const { businessName, email, phone, address, openingTime, closingTime } = businessSettings;
  const formattedHours = `${formatBusinessTime(openingTime)} - ${formatBusinessTime(closingTime)}`;

  return (
    <footer className="footer">
      <div className="footer-main">
        <div className="footer-container">
          <div className="footer-brand">
            <Link to="/" className="footer-logo">
              <img src={amayaLogo} alt="Amaya logo" />
              <span>{businessName}</span>
            </Link>

            <p>
              Good food, refreshing drinks, and meaningful moments. Welcome to
              {businessName}.
            </p>

            <Link to="/menu" className="footer-menu-link">
              Explore Our Menu
              <span>→</span>
            </Link>
          </div>

          <div className="footer-section">
            <h3>Quick Links</h3>

            <nav className="footer-links" aria-label="Footer navigation">
              <Link to="/">Home</Link>
              <Link to="/about">About Us</Link>
              <Link to="/menu">Our Menu</Link>
              <Link to="/contact">Contact</Link>
            </nav>
          </div>

          <div className="footer-section">
            <h3>Opening Hours</h3>

            <dl className="footer-hours">
              <div className="footer-hours-row">
                <dt>Monday - Friday</dt>
                <dd>{formattedHours}</dd>
              </div>

              <div className="footer-hours-row">
                <dt>Saturday - Sunday</dt>
                <dd>{formattedHours}</dd>
              </div>
            </dl>
          </div>

          <div className="footer-section footer-contact">
            <h3>Get In Touch</h3>

            <div className="footer-contact-list">
              <a href={`tel:${phone}`}>{phone}</a>

              <a href={`mailto:${email}`}>{email}</a>

              <address>{address}</address>
            </div>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="footer-container footer-bottom-container">
          <p>&copy; {currentYear} {businessName}. All Rights Reserved.</p>

          <nav className="footer-socials" aria-label="Social media">
            <a
              href="https://facebook.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Visit Amaya on Facebook"
            >
              Facebook
            </a>

            <span>•</span>

            <a
              href="https://instagram.com"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Visit Amaya on Instagram"
            >
              Instagram
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}

export default Footer;



