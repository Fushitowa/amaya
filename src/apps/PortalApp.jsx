import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import RequireAuth from "../components/RequireAuth.jsx";
import Login from "../pages/Login.jsx";
import StaffMenu from "../pages/staff/StaffMenu.jsx";
import StaffOrder from "../pages/staff/StaffOrder.jsx";
import StaffDashboard from "../pages/staff/StaffDashboard.jsx";
import StaffSetting from "../pages/staff/StaffSetting.jsx";
import StaffOrderConfirmation from "../pages/staff/StaffOrderConfirmation.jsx";
import StaffReceipt from "../pages/staff/StaffReceipt.jsx";
import StaffQuantity from "../pages/staff/StaffQuantity.jsx";
import AdminDashboard from "../pages/admin/AdminDashboard.jsx";
import AdminInventory from "../pages/admin/AdminInventory.jsx";
import AdminMenuManagement from "../pages/admin/AdminMenuManagement.jsx";
import AdminCategories from "../pages/admin/AdminCategories.jsx";
import AdminReport from "../pages/admin/AdminReport.jsx";
import AdminSettings from "../pages/admin/AdminSettings.jsx";
import AdminArchive from "../pages/admin/AdminArchive.jsx";
import { SidebarProvider } from "../context/SidebarContext.jsx";

export default function PortalApp() {
  return (
    <BrowserRouter>
      <SidebarProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/staff" element={<Navigate to="/staff/menu" replace />} />
          <Route element={<RequireAuth roles={["staff"]}><Outlet /></RequireAuth>}>
            <Route path="/staff/menu" element={<StaffMenu />} />
            <Route path="/staff/orders" element={<StaffOrder />} />
            <Route path="/staff/dashboard" element={<StaffDashboard />} />
            <Route path="/staff/settings" element={<StaffSetting />} />
            <Route path="/staff/order-confirmation" element={<StaffOrderConfirmation />} />
            <Route path="/staff/receipt" element={<StaffReceipt />} />
            <Route path="/staff/quantity" element={<StaffQuantity />} />
          </Route>
          <Route element={<RequireAuth roles={["admin"]}><Outlet /></RequireAuth>}>
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/orders" element={<Navigate to="/admin" replace />} />
            <Route path="/admin/inventory" element={<AdminInventory />} />
            <Route path="/admin/menu" element={<AdminMenuManagement />} />
            <Route path="/admin/categories" element={<AdminCategories />} />
            <Route path="/admin/reports" element={<AdminReport />} />
            <Route path="/admin/archive" element={<AdminArchive />} />
            <Route path="/admin/settings" element={<AdminSettings />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </SidebarProvider>
    </BrowserRouter>
  );
}
