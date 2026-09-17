import { useEffect, useState } from "react"

/** «باقي ٢ ساعة و١٠ دقايق» — ticks every second. */
export function useCountdown(endsAt: string | null, active: boolean, serverOffsetMs = 0) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  if (!endsAt) return { left: 0, label: "" }
  const left = Math.max(0, new Date(endsAt).getTime() - (now + serverOffsetMs))
  const s = Math.floor(left / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const label = d > 0 ? `${d} يوم و${h} ساعة` : h > 0 ? `${h} ساعة و${m} دقيقة` : `${m}:${String(sec).padStart(2, "0")}`
  return { left, label }
}
