import { Link } from "react-router-dom";
import { useBusiness } from "../context/BusinessContext.jsx";

function Hero() {
  const { businessSettings } = useBusiness();
  const { businessName } = businessSettings;

  return (
    <section className="hero">
      <div className="hero-container">
        <div className="hero-content">
          <span className="hero-subtitle">
            WELCOME TO {businessName.toUpperCase()}
          </span>

          <h1>
            Good Food.
            <br />
            Great Moments.
          </h1>

          <p>
            Enjoy delicious food, refreshing drinks, and a warm atmosphere
            made for every moment.
          </p>

          <div className="hero-buttons">
            <Link to="/menu" className="hero-primary-button">
              Explore Our Menu
            </Link>

            <Link to="/about" className="hero-secondary-button">
              Discover {businessName}
            </Link>
          </div>

        </div>
      </div>
    </section>
  );
}

export default Hero;