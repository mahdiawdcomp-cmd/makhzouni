import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { MessageCircle } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { getWhatsappUnreadCount } from "../../api/endpoints"
import { useAuthStore } from "../../store/authStore"
import { cn } from "../../utils/cn"

const SOUND_MUTED_KEY = "whatsapp_sound_muted"
const SOUND_COOLDOWN_MS = 4_000

// Short two-tone "pop-pop" chime approximating WhatsApp's own notification —
// WebAudio only, no audio file. Inbound messages only (outbound sends never
// increment unreadCount, so this only fires when a customer actually writes).
function playWhatsappChime() {
  try {
    const ctx = new AudioContext()
    const beep = (freq: number, startAt: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = freq
      gain.gain.value = 0.06
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(ctx.currentTime + startAt)
      osc.stop(ctx.currentTime + startAt + dur)
    }
    beep(1046, 0, 0.09)
    beep(1568, 0.08, 0.12)
  } catch {
    // Browsers may block audio until the user interacts with the page.
  }
}

// Desktop notification for a new inbound WhatsApp message — no service worker
// needed since it's shown from the already-open tab. Silently does nothing if
// the browser doesn't support Notification or the user never grants it.
function notifyNewWhatsappMessage(onClick: () => void) {
  if (!("Notification" in window)) return
  const show = () => {
    const n = new Notification("رسالة واتساب جديدة", {
      body: "وصلتك رسالة جديدة — اضغط للفتح",
      icon: "/pwa-icon.svg",
      tag: "whatsapp-chat", // collapses rapid-fire notifications into one
    })
    n.onclick = () => {
      window.focus()
      onClick()
      n.close()
    }
  }
  if (Notification.permission === "granted") show()
  else if (Notification.permission === "default") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") show()
    })
  }
}

export function WhatsappChatButton() {
  const navigate = useNavigate()
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const canAccess = hasPermission("ACCESS_WHATSAPP_CHAT")
  const [muted, setMuted] = useState<boolean>(() => {
    try { return localStorage.getItem(SOUND_MUTED_KEY) === "true" } catch { return false }
  })
  const prevCount = useRef<number | null>(null)
  const lastPlayedAt = useRef(0)

  const { data: count = 0 } = useQuery({
    queryKey: ["whatsapp-unread-count"],
    queryFn: getWhatsappUnreadCount,
    refetchInterval: 30_000,
    enabled: canAccess,
  })

  useEffect(() => {
    if (!canAccess) return
    // Skip the very first reading (page load) so old unread counts never chime.
    if (prevCount.current === null) {
      prevCount.current = count
      return
    }
    if (count > prevCount.current) {
      if (!muted && Date.now() - lastPlayedAt.current > SOUND_COOLDOWN_MS) {
        lastPlayedAt.current = Date.now()
        playWhatsappChime()
      }
      // Desktop notification only when the tab isn't the one the user is looking
      // at right now — avoids a redundant popup while the chat is already open.
      if (document.hidden || !window.location.pathname.startsWith("/whatsapp")) {
        notifyNewWhatsappMessage(() => navigate("/whatsapp"))
      }
    }
    prevCount.current = count
  }, [count, muted, canAccess, navigate])

  function toggleMute(e: React.MouseEvent) {
    e.stopPropagation()
    setMuted((m) => {
      const next = !m
      try { localStorage.setItem(SOUND_MUTED_KEY, String(next)) } catch {}
      return next
    })
  }

  if (!canAccess) return null

  return (
    <motion.button
      type="button"
      onClick={() => navigate("/whatsapp")}
      onContextMenu={toggleMute}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="relative flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-slate-100 dark:hover:bg-slate-800"
      style={{ color: "var(--theme-textSecondary)" }}
      aria-label="محادثات الواتساب"
      title={muted ? "محادثات الواتساب (الصوت مكتوم — كليك يمين للتفعيل)" : "محادثات الواتساب (كليك يمين لكتم الصوت)"}
    >
      <MessageCircle className={cn("h-4 w-4", muted && "opacity-60")} />
      {count > 0 ? (
        <span className="absolute -left-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </motion.button>
  )
}
