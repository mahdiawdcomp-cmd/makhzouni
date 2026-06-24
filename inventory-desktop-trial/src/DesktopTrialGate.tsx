import { useState, useEffect, type ReactNode } from "react"
import { PackageCheck, Loader2 } from "lucide-react"
import { useAuthStore } from "./store/authStore"
import axios from "axios"
import { api } from "./api/client"

const LOCAL_API = "http://localhost:5050/api"
const LOCAL_CREDS_KEY = "makhzouni_local_creds"
const SERVER_KEY = "makhzouni_server_url"

const isTauri = Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)

function getLocalCreds(): { username: string; password: string } {
  try {
    const saved = localStorage.getItem(LOCAL_CREDS_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return { username: "admin", password: "Password123!" }
}

export function DesktopTrialGate({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)

  if (user && token) return <>{children}</>

  // In Tauri: auto-login to local backend, no screen needed
  if (isTauri) return <AutoLoginScreen />

  // Web mode: show normal login screen
  return <WebLoginScreen />
}

// ── Auto-login for Tauri (local mode) ────────────────────────────────────────
function AutoLoginScreen() {
  const [status, setStatus] = useState("جاري تشغيل النظام المحلي…")
  const [error, setError] = useState("")
  const setSession = useAuthStore((s) => s.setSession)

  useEffect(() => {
    api.defaults.baseURL = LOCAL_API
    localStorage.setItem(SERVER_KEY, LOCAL_API)
    void autoLogin()
  }, [])

  async function autoLogin(attempt = 0): Promise<void> {
    // Wait for local backend to be ready (max 30s)
    if (attempt > 30) {
      setError("تعذر تشغيل الخادم المحلي. أعد تشغيل البرنامج.")
      return
    }

    try {
      await axios.get(`http://localhost:5050/health`, { timeout: 1000 })
    } catch {
      setStatus(`جاري تشغيل النظام المحلي… (${attempt + 1})`)
      await new Promise((r) => setTimeout(r, 1000))
      return autoLogin(attempt + 1)
    }

    // Backend is ready — login
    setStatus("جاري الدخول…")
    const creds = getLocalCreds()
    try {
      const res = await axios.post<{ token: string; user: unknown }>(
        `${LOCAL_API}/auth/login`,
        { username: creds.username, password: creds.password },
        { timeout: 5000 }
      )
      if (!res.data.token || !res.data.user) throw new Error("no token")
      setSession(res.data.token, res.data.user as Parameters<typeof setSession>[1], true)
    } catch (err: any) {
      // If wrong password stored, show error with reset option
      const msg = err?.response?.data?.message
      setError(msg ?? "خطأ في تسجيل الدخول المحلي. تحقق من الإعدادات.")
    }
  }

  if (error) {
    return <CloudFallbackScreen localError={error} onRetry={() => { setError(""); void autoLogin(0) }} />
  }

  return (
    <main dir="rtl" style={splashStyle}>
      <div style={cardStyle}>
        <div style={logoStyle}>
          <PackageCheck size={40} color="white" />
        </div>
        <h1 style={{ color: "white", fontSize: 26, fontWeight: 800, margin: "16px 0 6px" }}>
          مخزوني مهدي عوض
        </h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: "0 0 28px" }}>
          نظام إدارة المخزون والحسابات
        </p>
        <Loader2 size={28} color="#3b82f6" style={{ animation: "spin 1s linear infinite" }} />
        <p style={{ color: "#475569", fontSize: 13, marginTop: 16 }}>{status}</p>
      </div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </main>
  )
}

// ── Cloud fallback when local server fails ────────────────────────────────────
function CloudFallbackScreen({ localError, onRetry }: { localError: string; onRetry: () => void }) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const setSession = useAuthStore((s) => s.setSession)

  const CLOUD_API = "https://api.mazbwoni.com/api"

  async function handleCloudLogin() {
    if (!username.trim() || !password.trim()) { setError("أدخل اسم المستخدم وكلمة المرور."); return }
    setLoading(true); setError("")
    try {
      const res = await axios.post<{ token: string; user: unknown }>(
        `${CLOUD_API}/auth/login`,
        { username: username.trim(), password },
        { timeout: 15000 }
      )
      if (!res.data.token || !res.data.user) throw new Error("no token")
      localStorage.setItem(SERVER_KEY, CLOUD_API)
      api.defaults.baseURL = CLOUD_API
      setSession(res.data.token, res.data.user as Parameters<typeof setSession>[1], true)
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "تعذر الاتصال بالسيرفر.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main dir="rtl" style={splashStyle}>
      <div style={{ ...cardStyle, gap: 0, padding: "36px 40px", background: "#1e293b", borderRadius: 20, border: "1px solid #334155", width: 380 }}>
        <PackageCheck size={42} color="#ef4444" style={{ marginBottom: 12 }} />
        <h2 style={{ color: "white", margin: "0 0 6px", fontSize: 18 }}>تعذّر تشغيل الخادم المحلي</h2>
        <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 24px", textAlign: "center" }}>{localError}</p>

        <div style={{ width: "100%", borderTop: "1px solid #334155", marginBottom: 20 }} />

        <p style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 16px", alignSelf: "flex-start" }}>
          سجّل دخول بالحساب السحابي بدلاً من ذلك:
        </p>

        {[
          { label: "اسم المستخدم", value: username, set: setUsername, type: "text" },
          { label: "كلمة المرور",  value: password, set: setPassword, type: showPass ? "text" : "password" },
        ].map(({ label, value, set, type }) => (
          <label key={label} style={{ display: "flex", flexDirection: "column", gap: 5, width: "100%", marginBottom: 12 }}>
            <span style={{ color: "#94a3b8", fontSize: 12 }}>{label}</span>
            <input
              value={value} onChange={(e) => set(e.target.value)}
              type={type} dir="ltr"
              onKeyDown={(e) => e.key === "Enter" && void handleCloudLogin()}
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "white", fontSize: 14, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" as const }}
            />
          </label>
        ))}
        <label style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", marginBottom: 16, cursor: "pointer" }}>
          <input type="checkbox" checked={showPass} onChange={(e) => setShowPass(e.target.checked)} />
          <span style={{ color: "#64748b", fontSize: 12 }}>إظهار كلمة المرور</span>
        </label>

        {error && <p style={{ color: "#fca5a5", fontSize: 12, margin: "0 0 12px" }}>{error}</p>}

        <button onClick={() => void handleCloudLogin()} disabled={loading} style={{ ...btnStyle, marginBottom: 8 }}>
          {loading ? "جاري الاتصال…" : "دخول بالحساب السحابي"}
        </button>
        <button onClick={onRetry} style={{ ...btnStyle, background: "#1e293b", border: "1px solid #334155", fontSize: 13 }}>
          إعادة المحاولة (محلي)
        </button>
      </div>
    </main>
  )
}

// ── Web login screen (non-Tauri) ──────────────────────────────────────────────
function WebLoginScreen() {
  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem(SERVER_KEY) || "https://api.mazbwoni.com/api"
  )
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const setSession = useAuthStore((s) => s.setSession)

  async function handleLogin() {
    if (!username.trim() || !password.trim() || !serverUrl.trim()) {
      setError("أدخل جميع البيانات.")
      return
    }
    setLoading(true)
    setError("")
    const base = serverUrl.replace(/\/+$/, "")
    try {
      const res = await axios.post<{ token: string; user: unknown }>(
        `${base}/auth/login`,
        { username: username.trim(), password },
        { timeout: 15000 }
      )
      if (!res.data.token || !res.data.user) throw new Error("no token")
      localStorage.setItem(SERVER_KEY, base)
      api.defaults.baseURL = base
      setSession(res.data.token, res.data.user as Parameters<typeof setSession>[1], true)
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "تعذر الاتصال بالسيرفر.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main dir="rtl" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", fontFamily: "'Cairo', Tahoma, sans-serif" }}>
      <div style={{ width: 400, display: "flex", flexDirection: "column", gap: 20, padding: 40, background: "#1e293b", borderRadius: 16, border: "1px solid #334155" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={logoStyle}><PackageCheck size={24} color="white" /></div>
          <h2 style={{ color: "white", margin: 0, fontSize: 20 }}>مخزوني مهدي عوض</h2>
        </div>
        {[
          { label: "رابط السيرفر", value: serverUrl, set: setServerUrl, type: "text", dir: "ltr" as const },
          { label: "اسم المستخدم", value: username, set: setUsername, type: "text", dir: "ltr" as const },
          { label: "كلمة المرور", value: password, set: setPassword, type: showPass ? "text" : "password", dir: "ltr" as const },
        ].map(({ label, value, set, type, dir }) => (
          <label key={label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>{label}</span>
            <input value={value} onChange={(e) => set(e.target.value)} type={type} dir={dir}
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", color: "white", fontSize: 14, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" }}
              onKeyDown={(e) => e.key === "Enter" && void handleLogin()} />
          </label>
        ))}
        {error && <p style={{ color: "#fca5a5", fontSize: 13, margin: 0 }}>{error}</p>}
        <button onClick={() => void handleLogin()} disabled={loading} style={btnStyle}>
          {loading ? "جاري الاتصال…" : "دخول"}
        </button>
      </div>
    </main>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const splashStyle: React.CSSProperties = {
  minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
  background: "#0f172a", fontFamily: "'Cairo', Tahoma, sans-serif",
}

const cardStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center",
  padding: "48px 40px", background: "#0f172a",
}

const logoStyle: React.CSSProperties = {
  width: 72, height: 72, borderRadius: 18,
  background: "linear-gradient(135deg, #3b82f6, #0ea5e9)",
  display: "flex", alignItems: "center", justifyContent: "center",
}

const btnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #3b82f6, #0ea5e9)",
  color: "white", border: "none", borderRadius: 10,
  padding: "12px 24px", fontSize: 15, fontWeight: 700,
  cursor: "pointer", fontFamily: "inherit", width: "100%",
}
