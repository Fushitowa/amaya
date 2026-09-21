import amayaLogo from "../assets/images/amayalogo.png";
import { Link } from "react-router-dom";

function Header() {
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
        </nav>

        
        <Link to="/login" className="header-button">
          Log In
        </Link>

      </div>
    </header>
  );
}

export default Header;