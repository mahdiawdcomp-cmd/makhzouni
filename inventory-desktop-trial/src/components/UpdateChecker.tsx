import { useEffect, useState } from "react"
import { Download, X } from "lucide-react"

interface UpdateInfo {
  version: string
  body?: string
}

export function UpdateChecker() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [installing, setInstalling] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Only run in Tauri environment
    if (!("__TAURI__" in window)) return

    const checkUpdate = async () => {
      try {
        const { check } = await import("@tauri-apps/plugin-updater")
        const result = await check()
        if (result?.available) {
          setUpdate({ version: result.version, body: result.body ?? undefined })
        }
      } catch {
        // Updater not configured yet — silent fail
      }
    }

    // Check after 5 seconds (let app fully load first)
    const timer = setTimeout(() => void checkUpdate(), 5000)
    // Re-check every 4 hours
    const interval = setInterval(() => void checkUpdate(), 4 * 60 * 60 * 1000)

    return () => { clearTimeout(timer); clearInterval(interval) }
  }, [])

  async function installUpdate() {
    if (!update) return
    setInstalling(true)
    try {
      const { check } = await import("@tauri-apps/plugin-updater")
      const result = await check()
      if (result?.available) {
        await result.downloadAndInstall()
        const { relaunch } = await import("@tauri-apps/plugin-process")
        await relaunch()
      }
    } catch {
      setInstalling(false)
    }
  }

  if (!update || dismissed) return null

  return (
    <div style={{
      position: "fixed", bottom: 20, left: 20, zIndex: 9999,
      background: "#1e293b", border: "1px solid #3b82f6",
      borderRadius: 12, padding: "14px 18px", maxWidth: 320,
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      fontFamily: "'Cairo', Tahoma, Arial, sans-serif",
      direction: "rtl"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#60a5fa", fontWeight: 700, fontSize: 14 }}>
          <Download size={16} />
          تحديث جديد متاح — v{update.version}
        </div>
        <button onClick={() => setDismissed(true)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 2 }}>
          <X size={15} />
        </button>
      </div>
      {update.body && (
        <p style={{ color: "#94a3b8", fontSize: 12, margin: "0 0 12px", lineHeight: 1.6 }}>{update.body}</p>
      )}
      <button
        onClick={() => void installUpdate()}
        disabled={installing}
        style={{
          width: "100%", background: installing ? "#1e3a5f" : "#3b82f6",
          color: "white", border: "none", borderRadius: 8,
          padding: "8px 16px", fontSize: 13, fontWeight: 700,
          cursor: installing ? "not-allowed" : "pointer",
          fontFamily: "inherit"
        }}
      >
        {installing ? "جاري التحديث وإعادة التشغيل..." : "تحديث الآن"}
      </button>
    </div>
  )
}
