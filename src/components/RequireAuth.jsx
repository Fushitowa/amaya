import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function RequireAuth({ roles, children }) {
  const { user, authReady } = useAuth();
  const location = useLocation();
  if (!authReady) return <div className="app-loading" role="status">Checking your session…</div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={user.role === "admin" ? "/admin" : "/staff/menu"} replace />;
  return children;
}
