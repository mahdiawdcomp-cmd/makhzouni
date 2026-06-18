import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import TenantsPage from "./pages/TenantsPage";
import TenantDetailPage from "./pages/TenantDetailPage";
import Layout from "./components/Layout";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("sa_token");
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/tenants" replace />} />
        <Route path="tenants" element={<TenantsPage />} />
        <Route path="tenants/:id" element={<TenantDetailPage />} />
      </Route>
    </Routes>
  );
}
