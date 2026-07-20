import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { ImageOff, X } from "lucide-react"
import { getTelegramChannelStatus } from "../api/endpoints"
import { useAuthStore } from "../store/authStore"

/**
 * One-line amber strip (admin only, no notifications by design): counts the
 * in-stock products that have no image, so they are published neither in the
 * wholesale catalog posts nor in the Telegram channel. Dismissible per session.
 */
export function MissingImageBanner() {
  const isAdmin = useAuthStore((s) => s.user?.role === "ADMIN")
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem("missing-image-banner-dismissed") === "1",
  )
  const query = useQuery({
    queryKey: ["telegram-channel-status", "banner"],
    queryFn: getTelegramChannelStatus,
    enabled: isAdmin && !dismissed,
    staleTime: 30 * 60_000,
    refetchInterval: 60 * 60_000,
    retry: 1,
  })

  const count = query.data?.missingImageCount ?? 0
  if (!isAdmin || dismissed || count <= 0) return null

  return (
    <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-1.5 text-sm text-amber-800 dark:text-amber-200">
      <ImageOff className="h-4 w-4 shrink-0" />
      <span className="truncate">
        {count} مادة متوفرة بدون صورة — ما تنشر بقناة تيليگرام.
        {" "}
        <Link to="/inventory" className="underline font-medium">أكمل الصور من المخزون</Link>
      </span>
      <button
        type="button"
        className="mr-auto p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900"
        aria-label="إخفاء التنبيه"
        onClick={() => {
          sessionStorage.setItem("missing-image-banner-dismissed", "1")
          setDismissed(true)
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
