import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Products from './pages/Products';
import Sync from './pages/Sync';
import Stock from './pages/Stock';
import Reports from './pages/Reports';
import Login from './pages/Login';
import Shift from './pages/Shift';
import Customers from './pages/Customers';
import Settings from './pages/Settings';
import Employees from './pages/Employees';
import Profile from './pages/Profile';
import More from './pages/More';
import { authService } from './services/authService';
import type { PermissionCode } from './services/db';

function ProtectedRoute() {
  const user = authService.getCurrentUser();
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

function PermissionGate({ permission, children }: { permission: PermissionCode; children: ReactNode }) {
  const user = authService.getCurrentUser();
  if (!user) return <Navigate to="/login" replace />;
  if (!authService.can(user, permission)) return <Navigate to="/pos" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <Toaster position="top-center" toastOptions={{ duration: 3000, style: { borderRadius: '10px', background: '#333', color: '#fff' } }} />
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/pos" replace />} />
            <Route path="dashboard" element={<PermissionGate permission="dashboard:view"><Dashboard /></PermissionGate>} />
            <Route path="pos" element={<PermissionGate permission="pos:use"><POS /></PermissionGate>} />
            <Route path="products" element={<PermissionGate permission="products:read"><Products /></PermissionGate>} />
            <Route path="stock" element={<PermissionGate permission="stock:read"><Stock /></PermissionGate>} />
            <Route path="shift" element={<PermissionGate permission="shift:manage"><Shift /></PermissionGate>} />
            <Route path="reports" element={<PermissionGate permission="reports:view"><Reports /></PermissionGate>} />
            <Route path="customers" element={<PermissionGate permission="customers:manage"><Customers /></PermissionGate>} />
            <Route path="sync" element={<PermissionGate permission="sync:manage"><Sync /></PermissionGate>} />
            <Route path="settings" element={<PermissionGate permission="settings:manage"><Settings /></PermissionGate>} />
            <Route path="employees" element={<PermissionGate permission="users:manage"><Employees /></PermissionGate>} />
            <Route path="profile" element={<Profile />} />
            <Route path="more" element={<More />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
