import amayaLogo from "../assets/images/amayalogo.png";
import { Link } from "react-router-dom";
import { useBusiness } from "../context/BusinessContext.jsx";

function Header() {
  const { businessSettings } = useBusiness() || {};
  return (
    <header className="header">
      <div className="header-container">

        
        <Link to="/" className="logo">
          <img src={amayaLogo} alt="Amaya Logo" />
        </Link>

        
        <nav className="nav">
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
          <Link to="/menu">Menu</Link>
          <Link to="/contact">Contact</Link>
          {businessSettings?.isTemporarilyClosed && (
            <span
              style={{
                padding: "4px 10px",
                borderRadius: "999px",
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#b91c1c",
                fontSize: "11px",
                fontWeight: 700,
              }}
            >
              Temporarily Closed
            </span>
          )}
        </nav>

        
      </div>
    </header>
  );
}

export default Header;
