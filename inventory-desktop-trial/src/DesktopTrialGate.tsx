import { useState, useEffect, type ReactNode } from "react"
import { PackageCheck, Loader2 } from "lucide-react"
import { useAuthStore } from "./store/authStore"
import axios from "axios"
import { api } from "./api/client"

const SERVER_KEY = "makhzouni_server_url"
// The desktop app is a thin client to the real cloud backend — same data as the
// website (mahdi.mazbwoni.com). No local server / no separate local database.
const CLOUD_API = "https://api.mazbwoni.com/api"

export function DesktopTrialGate({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)

  if (user && token) return <>{children}</>

  // Always log in to the cloud (real data). No local-server mode.
  return <CloudLoginScreen />
}

// ── Cloud login (primary) ─────────────────────────────────────────────────────
function CloudLoginScreen() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const setSession = useAuthStore((s) => s.setSession)

  // Point the API at the cloud immediately so every request goes there.
  useEffect(() => {
    api.defaults.baseURL = CLOUD_API
    localStorage.setItem(SERVER_KEY, CLOUD_API)
  }, [])

  async function handleLogin() {
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
      setError(err?.response?.data?.message ?? "تعذر الاتصال بالسيرفر — تأكد من الإنترنت.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main dir="rtl" style={splashStyle}>
      <div style={{ ...cardStyle, gap: 0, padding: "36px 40px", background: "#1e293b", borderRadius: 20, border: "1px solid #334155", width: 380 }}>
        <div style={logoStyle}><PackageCheck size={34} color="white" /></div>
        <h1 style={{ color: "white", fontSize: 22, fontWeight: 800, margin: "14px 0 4px" }}>مخزوني مهدي عوض</h1>
        <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 22px" }}>سجّل الدخول بحسابك</p>

        {[
          { label: "اسم المستخدم", value: username, set: setUsername, type: "text" },
          { label: "كلمة المرور",  value: password, set: setPassword, type: showPass ? "text" : "password" },
        ].map(({ label, value, set, type }) => (
          <label key={label} style={{ display: "flex", flexDirection: "column", gap: 5, width: "100%", marginBottom: 12 }}>
            <span style={{ color: "#94a3b8", fontSize: 12 }}>{label}</span>
            <input
              value={value} onChange={(e) => set(e.target.value)}
              type={type} dir="ltr"
              onKeyDown={(e) => e.key === "Enter" && void handleLogin()}
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", color: "white", fontSize: 14, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" as const }}
            />
          </label>
        ))}
        <label style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "flex-start", marginBottom: 16, cursor: "pointer" }}>
          <input type="checkbox" checked={showPass} onChange={(e) => setShowPass(e.target.checked)} />
          <span style={{ color: "#64748b", fontSize: 12 }}>إظهار كلمة المرور</span>
        </label>

        {error && <p style={{ color: "#fca5a5", fontSize: 12, margin: "0 0 12px" }}>{error}</p>}

        <button onClick={() => void handleLogin()} disabled={loading} style={btnStyle}>
          {loading ? "جاري الدخول…" : "دخول"}
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
