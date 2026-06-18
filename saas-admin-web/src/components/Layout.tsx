import { Outlet, NavLink, useNavigate } from "react-router-dom";

export default function Layout() {
  const navigate = useNavigate();

  function logout() {
    localStorage.removeItem("sa_token");
    navigate("/login");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {/* Top bar */}
      <header style={{
        background: "var(--bg2)",
        borderBottom: "1px solid var(--border)",
        padding: "0 24px",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <span style={{ fontWeight: 800, fontSize: 18, color: "var(--blue)" }}>
            ⚡ Super Admin
          </span>
          <NavLink
            to="/tenants"
            style={({ isActive }) => ({
              color: isActive ? "var(--text)" : "var(--text2)",
              fontWeight: isActive ? 700 : 500,
              fontSize: 14,
              padding: "4px 8px",
              borderRadius: 6,
              background: isActive ? "var(--bg3)" : "transparent",
            })}
          >
            الزبائن
          </NavLink>
        </div>
        <button className="btn-ghost" style={{ fontSize: 13, padding: "6px 14px" }} onClick={logout}>
          تسجيل خروج
        </button>
      </header>

      {/* Content */}
      <main style={{ flex: 1, padding: "24px", maxWidth: 1200, width: "100%", margin: "0 auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
