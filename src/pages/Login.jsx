import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import amayaLogo from "../assets/images/amayalogo.png";
import "../assets/css/Login.css";

function Login() {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const user = await login(String(form.get("username") || ""), String(form.get("password") || ""));
      const fallback = user.role === "admin" ? "/admin" : "/staff/menu";
      const requestedPath = location.state?.from?.pathname;
      navigate(requestedPath?.startsWith(user.role === "admin" ? "/admin" : "/staff") ? requestedPath : fallback, { replace: true });
    } catch (loginError) {
      setError(loginError.message);
    } finally {
      setSubmitting(false);
    }
  };
  

  return (
    <main className="login-page">
      <div className="login-shell">
        <aside className="login-showcase" aria-label="Amaya portal introduction">
          <div className="showcase-brand">
            <img src={amayaLogo} alt="" className="showcase-logo" />
            <span>Amaya</span>
          </div>
          <div className="showcase-copy">
            <span className="showcase-eyebrow">AMAYA MANAGEMENT PORTAL</span>
            <h1>Great service starts behind the counter.</h1>
            <p>One secure place for your team to manage the menu, orders, and inventory.</p>
          </div>
          <div className="showcase-note">
            <span className="showcase-note-mark" aria-hidden="true">A</span>
            <span><strong>Made for the Amaya team</strong><small>Staff and administrator access</small></span>
          </div>
          <svg className="showcase-food-illustration" viewBox="0 0 220 220" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="tea-fill" x1="76" y1="76" x2="150" y2="180" gradientUnits="userSpaceOnUse">
                <stop stopColor="#EBC18F" />
                <stop offset="1" stopColor="#9A5B34" />
              </linearGradient>
              <linearGradient id="glass-fill" x1="61" y1="68" x2="164" y2="183" gradientUnits="userSpaceOnUse">
                <stop stopColor="#FFF8EE" stopOpacity=".24" />
                <stop offset="1" stopColor="#F3D9BD" stopOpacity=".07" />
              </linearGradient>
            </defs>
            <ellipse cx="112" cy="190" rx="70" ry="11" fill="#1E120D" fillOpacity=".2" />
            <path d="M111 75 135 20" stroke="#F1D6B4" strokeWidth="8" strokeLinecap="round" />
            <path d="M111 75 135 20" stroke="#A96F48" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" />
            <path d="M62 68C62 62 67 58 73 58H151C157 58 162 62 162 68L151 169C150 179 142 186 132 186H92C82 186 74 179 73 169L62 68Z" fill="url(#glass-fill)" stroke="#F7E7D4" strokeOpacity=".82" strokeWidth="3" />
            <path d="M68 91H156L149 166C148 174 141 180 133 180H92C84 180 77 174 76 166L68 91Z" fill="url(#tea-fill)" fillOpacity=".84" />
            <path d="M63 66C63 59 69 54 76 54H148C155 54 161 59 161 66V74H63V66Z" fill="#F9EBDC" fillOpacity=".88" stroke="#FFF6EA" strokeWidth="3" />
            <path d="M69 84C89 90 132 90 155 84" stroke="#FFF2E2" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" />
            <path d="M80 100 86 153" stroke="#FFF5E8" strokeOpacity=".36" strokeWidth="4" strokeLinecap="round" />
            <circle cx="91" cy="158" r="7" fill="#4B2D20" />
            <circle cx="111" cy="165" r="7" fill="#4B2D20" />
            <circle cx="132" cy="156" r="7" fill="#4B2D20" />
            <circle cx="103" cy="145" r="6" fill="#4B2D20" />
            <circle cx="124" cy="143" r="6" fill="#4B2D20" />
            <path d="M49 104 53 114 63 118 53 121 49 132 46 121 36 118 46 114 49 104Z" fill="#E3BC8E" />
            <circle cx="174" cy="78" r="4" fill="#E3BC8E" />
            <circle cx="48" cy="153" r="3" fill="#FFF4E7" fillOpacity=".8" />
          </svg>
          <span className="showcase-orbit showcase-orbit-one" aria-hidden="true" />
          <span className="showcase-orbit showcase-orbit-two" aria-hidden="true" />
        </aside>

        <section className="login-card" aria-labelledby="login-title">
          <div className="login-mobile-brand">
            <img src={amayaLogo} alt="Amaya" className="login-logo" />
            <span>AMAYA MANAGEMENT PORTAL</span>
          </div>

          <div className="login-heading">
            <span className="login-kicker">PORTAL ACCESS</span>
            <h2 id="login-title">Welcome back</h2>
            <p>Sign in with your team account to continue.</p>
          </div>

          <form className="login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="username">Username</label>
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
              <label htmlFor="password">Password</label>
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
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            <button type="submit" className="login-button" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign In"}
            </button>

            {error && <p className="login-error" role="alert">{error}</p>}
          </form>

          <div className="login-notice">
            <span className="notice-icon" aria-hidden="true"><span /></span>
            <p>
              <strong>Authorized team members only</strong>
              <span>This portal is for Amaya staff and administrators.</span>
            </p>
          </div>

          <a href={import.meta.env.VITE_CUSTOMER_URL || "http://localhost:5173/"} className="back-home">
            <span aria-hidden="true">←</span> Visit customer website
          </a>
        </section>
      </div>
    </main>
  );
}

export default Login;
