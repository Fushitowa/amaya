import { BrowserRouter, Routes, Route } from "react-router-dom"; 

import Home from "./pages/Home.jsx";
import Login from "./pages/Login.jsx";
import StaffDashboard from "./pages/staff/StaffDashboard.jsx";
import AdminDashboard from "./pages/admin/AdminDashboard.jsx";
import AdminOrder from "./pages/admin/AdminOrder.jsx";
import AdminInventory from "./pages/admin/AdminInventory.jsx";
import AdminMenuManagement from "./pages/admin/AdminMenuManagement.jsx";
import AdminReport from "./pages/admin/AdminReport.jsx";
import Contact from "./pages/Contact.jsx";
import About from "./pages/About.jsx";
import Menu from "./pages/Menu.jsx";
import StaffSetting from "./pages/staff/StaffSetting.jsx";
import StaffOrder from "./pages/staff/StaffOrder.jsx";
import StaffOrderConfirmation from "./pages/staff/StaffOrderConfirmation.jsx";
import StaffReceipt from "./pages/staff/StaffReceipt.jsx";
import StaffMenu from "./pages/staff/StaffMenu.jsx";
import StaffQuantity from "./pages/staff/StaffQuantity.jsx";

function App() {
  return (
    <BrowserRouter>
      <Routes>

        <Route path="/" element={<Home />} />

        <Route path="/login" element={<Login />} />

        <Route path="/staff" element={<StaffDashboard />} />

        <Route path="/admin" element={<AdminDashboard />} />

        <Route path="/admin/orders" element={<AdminOrder />} />

        <Route path="/admin/inventory" element={<AdminInventory />} />

        <Route path="/admin/menu" element={<AdminMenuManagement />} />

        <Route path="/admin/reports" element={<AdminReport />} />

        <Route path="/contact" element={<Contact />} /> 
        
        <Route path="/about" element={<About />} />

        <Route path="/menu" element={<Menu />} />

        <Route path="/staff/settings" element={<StaffSetting />} />

        <Route path="/staff/menu" element={<StaffMenu />} />

        <Route path="/staff/orders" element={<StaffOrder />} />

        <Route path="/staff/order-confirmation" element={<StaffOrderConfirmation />} />

        <Route path="/staff/receipt" element={<StaffReceipt />} />

        <Route path="/staff/quantity" element={<StaffQuantity />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;