import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/client";

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await authApi.login(username, password);
      localStorage.setItem("sa_token", res.data.token);
      navigate("/tenants");
    } catch (err: any) {
      setError(err.response?.data?.error ?? "فشل تسجيل الدخول");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--bg)",
    }}>
      <div className="card" style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>⚡</div>
          <h1 style={{ fontSize: 22, fontWeight: 800 }}>Super Admin</h1>
          <p style={{ color: "var(--text2)", fontSize: 13, marginTop: 4 }}>لوحة تحكم الإدارة العليا</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="form-row">
            <label>اسم المستخدم</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="superadmin"
              autoFocus
              required
            />
          </div>
          <div className="form-row">
            <label>كلمة المرور</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? <span className="spinner" /> : "دخول"}
          </button>
        </form>
      </div>
    </div>
  );
}
