import { useState } from "react";
import { LockKeyhole, ShieldCheck, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { authApi, getErrorMessage } from "../api/client";

export default function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await authApi.login(username, password);
      localStorage.setItem("sa_token", response.data.token);
      navigate("/tenants");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page" dir="rtl">
      <section className="login-panel">
        <div className="login-brand"><ShieldCheck size={28} /></div>
        <h1>الإدارة العليا لمخزوني</h1>
        <p>إدارة المحلات والاشتراكات والمزايا من مكان واحد</p>
        <form onSubmit={submit}>
          <label>اسم المستخدم</label>
          <div className="input-icon"><User size={18} /><input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required /></div>
          <label>كلمة المرور</label>
          <div className="input-icon"><LockKeyhole size={18} /><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          {error && <div className="alert error">{error}</div>}
          <button className="primary wide" disabled={loading}>{loading ? "جاري الدخول..." : "دخول آمن"}</button>
        </form>
      </section>
    </main>
  );
}
