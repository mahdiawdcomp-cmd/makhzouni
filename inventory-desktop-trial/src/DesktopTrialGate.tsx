import { useState, useEffect, type ReactNode } from "react"
import { PackageCheck, Server, User, Lock, Eye, EyeOff, Wifi, WifiOff, AlertCircle } from "lucide-react"
import { useAuthStore } from "./store/authStore"
import axios from "axios"
import { api } from "./api/client"

const SERVER_KEY = "makhzouni_server_url"
const DEFAULT_SERVER = "https://api.mazbwoni.com/api"

function getSavedServer(): string {
  return localStorage.getItem(SERVER_KEY) || DEFAULT_SERVER
}

export function DesktopTrialGate({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)

  if (user && token) return <>{children}</>
  return <SetupScreen />
}

function SetupScreen() {
  const [serverUrl, setServerUrl] = useState(getSavedServer)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [online, setOnline] = useState(navigator.onLine)
  const setSession = useAuthStore((s) => s.setSession)

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off) }
  }, [])

  async function handleLogin() {
    if (!username.trim() || !password.trim()) {
      setError("أدخل اسم المستخدم وكلمة المرور.")
      return
    }
    if (!serverUrl.trim()) {
      setError("أدخل رابط السيرفر.")
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
      if (!res.data.token || !res.data.user) throw new Error("استجابة غير صحيحة من السيرفر")

      // Save server URL and update axios base
      localStorage.setItem(SERVER_KEY, base)
      api.defaults.baseURL = base
      ;(api.defaults as Record<string, unknown>).baseURL = base

      setSession(res.data.token, res.data.user as Parameters<typeof setSession>[1], true)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      if (msg) setError(msg)
      else if (!navigator.onLine) setError("لا يوجد اتصال بالإنترنت.")
      else setError("تعذر الاتصال بالسيرفر. تحقق من الرابط واسم المستخدم وكلمة المرور.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main dir="rtl" style={{
      minHeight: "100vh", display: "flex", background: "#0f172a",
      fontFamily: "'Cairo', Tahoma, Arial, sans-serif"
    }}>
      {/* Right panel - branding */}
      <div style={{
        flex: 1, background: "linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)",
        display: "flex", flexDirection: "column", justifyContent: "center",
        alignItems: "flex-end", padding: "48px", gap: "24px",
        borderLeft: "1px solid #1e293b"
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: 18,
          background: "linear-gradient(135deg, #3b82f6, #0ea5e9)",
          display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <PackageCheck size={36} color="white" />
        </div>
        <h1 style={{ color: "white", fontSize: 36, fontWeight: 800, margin: 0, textAlign: "right", lineHeight: 1.3 }}>
          مخزوني<br />مهدي عوض
        </h1>
        <p style={{ color: "#94a3b8", fontSize: 16, margin: 0, textAlign: "right", maxWidth: 280, lineHeight: 1.7 }}>
          نظام إدارة المخزون والحسابات — برنامج كمبيوتر متكامل
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "flex-end", marginTop: 16 }}>
          {[
            "يشتغل بدون متصفح",
            "بياناتك على جهازك وعلى السيرفر",
            "يكمل بدون نت ويزامن لما يرجع"
          ].map((f) => (
            <div key={f} style={{ display: "flex", gap: 8, alignItems: "center", color: "#cbd5e1", fontSize: 14 }}>
              <span style={{ color: "#22c55e" }}>✓</span>
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* Left panel - login form */}
      <div style={{
        width: 460, display: "flex", flexDirection: "column",
        justifyContent: "center", padding: "48px 40px", gap: 24,
        background: "#0f172a"
      }}>
        {/* Online indicator */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          color: online ? "#22c55e" : "#f59e0b", fontSize: 13
        }}>
          {online ? <Wifi size={14} /> : <WifiOff size={14} />}
          {online ? "متصل بالإنترنت" : "غير متصل — تأكد من النت قبل تسجيل الدخول"}
        </div>

        <div>
          <h2 style={{ color: "white", fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>تسجيل الدخول</h2>
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>ادخل بياناتك للاتصال بالنظام</p>
        </div>

        {/* Server URL */}
        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ color: "#94a3b8", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <Server size={14} /> رابط السيرفر
          </span>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            dir="ltr"
            placeholder="https://api.mazbwoni.com/api"
            style={inputStyle}
          />
        </label>

        {/* Username */}
        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ color: "#94a3b8", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <User size={14} /> اسم المستخدم
          </span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="mahdi"
            dir="ltr"
            style={inputStyle}
            onKeyDown={(e) => e.key === "Enter" && void handleLogin()}
          />
        </label>

        {/* Password */}
        <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ color: "#94a3b8", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            <Lock size={14} /> كلمة المرور
          </span>
          <div style={{ position: "relative" }}>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPass ? "text" : "password"}
              placeholder="••••••••"
              dir="ltr"
              style={{ ...inputStyle, paddingLeft: 40 }}
              onKeyDown={(e) => e.key === "Enter" && void handleLogin()}
            />
            <button
              onClick={() => setShowPass(!showPass)}
              style={{
                position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 4
              }}
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        {error && (
          <div style={{
            background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 8,
            padding: "10px 14px", color: "#fca5a5", fontSize: 13,
            display: "flex", gap: 8, alignItems: "flex-start"
          }}>
            <AlertCircle size={15} style={{ marginTop: 1, flexShrink: 0 }} />
            {error}
          </div>
        )}

        <button
          onClick={() => void handleLogin()}
          disabled={loading || !online}
          style={{
            background: loading || !online ? "#1e293b" : "linear-gradient(135deg, #3b82f6, #0ea5e9)",
            color: loading || !online ? "#64748b" : "white",
            border: "none", borderRadius: 10, padding: "13px 24px",
            fontSize: 16, fontWeight: 700, cursor: loading || !online ? "not-allowed" : "pointer",
            fontFamily: "inherit", transition: "all 0.2s"
          }}
        >
          {loading ? "جاري الاتصال..." : "دخول"}
        </button>

        <p style={{ color: "#334155", fontSize: 12, textAlign: "center", margin: 0 }}>
          v1.0.0 — مخزوني مهدي عوض
        </p>
      </div>
    </main>
  )
}

const inputStyle: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 8,
  padding: "11px 14px",
  color: "white",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
}
