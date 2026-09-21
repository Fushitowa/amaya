import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import amayaLogo from "../assets/images/amayalogo.png";
import "../assets/css/login.css";

function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (event) => {
  event.preventDefault();

  const username = event.target.username.value;
  const password = event.target.password.value;

  if (username === "staff" && password === "staff") {
    navigate("/staff");
  }

  else if (username === "admin" && password === "admin") {
    navigate("/admin");
  }

  else {
    alert("Invalid username or password.");
  }
};
  

  return (
    <main className="login-page">
      <div className="login-card">

        
        <div className="login-brand">
          <img
            src={amayaLogo}
            alt="Amaya Logo"
            className="login-logo"
          />

          <h1>Amaya</h1>
          <p>Management Portal</p>
        </div>

        
        <div className="login-heading">
          <h2>Welcome Back</h2>

          <p>
            Sign in to manage your Amaya business account.
          </p>
        </div>

        
        <form className="login-form" onSubmit={handleSubmit}>

          
          <div className="form-group">
            <label htmlFor="username">
              Username
            </label>

            <input
              type="text"
              id="username"
              name="username"
              placeholder="Enter your username"
              autoComplete="username"
              required
            />
          </div>

          
          <div className="form-group">
            <div className="password-label">
              <label htmlFor="password">
                Password
              </label>
            </div>

            <div className="password-input">
              <input
                type={showPassword ? "text" : "password"}
                id="password"
                name="password"
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={
                  showPassword
                    ? "Hide password"
                    : "Show password"
                }
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          
          <button
            type="submit"
            className="login-button"
          >
            Sign In
          </button>

        </form>

        
        <div className="login-notice">
          <span className="notice-icon">🔒</span>

          <p>
            This portal is restricted to authorized
            staff and administrators.
          </p>
        </div>

        
        <Link
          to="/"
          className="back-home"
        >
          ← Back to Amaya
        </Link>

      </div>
    </main>
  );
}

export default Login;