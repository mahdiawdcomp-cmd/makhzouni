import { RefreshCw, Wifi, WifiOff } from "lucide-react"
import { Button } from "./ui/button"

export function PwaStatusBar({
  isOnline,
  pendingCount,
  needsRefresh,
  onRefresh,
  onSync,
}: {
  isOnline: boolean
  pendingCount: number
  needsRefresh: boolean
  onRefresh: () => void
  onSync: () => void
}) {
  // Only show the bar when offline or when there are pending sync operations.
  // The "update available" / "connection restored" state is intentionally hidden.
  if (isOnline && pendingCount === 0) return null

  if (!isOnline) {
    return (
      <div
        className="flex flex-col gap-1 border-b px-4 py-3 text-sm"
        style={{ backgroundColor: "#FEF3C7", borderColor: "#FDE68A", color: "#92400E" }}
        dir="rtl"
      >
        <div className="flex items-center gap-2 font-semibold">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>لا يوجد اتصال بالإنترنت — تعمل بوضع غير متصل</span>
        </div>
        <p className="text-xs opacity-80 pr-6">
          الفواتير والسندات والمنتجات ستُحفظ محلياً وتُزامن تلقائياً عند عودة الاتصال
          {pendingCount > 0 ? ` (${pendingCount} عمليات بانتظار المزامنة)` : ""}
        </p>
      </div>
    )
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm"
      style={{ backgroundColor: "#ECFDF5", borderColor: "#A7F3D0", color: "#047857" }}
    >
      <div className="flex items-center gap-2">
        <Wifi className="h-4 w-4" />
        <span>
          {pendingCount > 0
            ? `الاتصال رجع — ${pendingCount} عمليات بانتظار المزامنة`
            : needsRefresh
              ? "يوجد تحديث جديد للتطبيق"
              : "الاتصال رجع"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {pendingCount > 0 && (
          <Button variant="outline" size="sm" onClick={onSync}
            style={{ borderColor: "#A7F3D0", color: "#047857" }}>
            <RefreshCw className="h-3.5 w-3.5" />
            مزامنة الآن
          </Button>
        )}
        {needsRefresh && (
          <Button size="sm" onClick={onRefresh}>
            تحديث
          </Button>
        )}
      </div>
    </div>
  )
}
