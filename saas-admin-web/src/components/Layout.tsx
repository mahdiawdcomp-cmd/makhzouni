import { Building2, LogOut, ShieldCheck } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

export default function Layout() {
  const navigate = useNavigate();
  return (
    <div className="app-shell" dir="rtl">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><ShieldCheck size={20} /></span>
          <div>
            <strong>مخزوني</strong>
            <small>الإدارة العليا</small>
          </div>
        </div>
        <nav>
          <NavLink to="/tenants" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
            <Building2 size={17} /> المحلات
          </NavLink>
        </nav>
        <button className="icon-command" title="تسجيل الخروج" onClick={() => {
          localStorage.removeItem("sa_token");
          navigate("/login");
        }}>
          <LogOut size={18} />
        </button>
      </header>
      <main className="page"><Outlet /></main>
    </div>
  );
}
