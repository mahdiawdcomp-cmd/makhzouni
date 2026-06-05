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
  if (isOnline && pendingCount === 0 && !needsRefresh) return null

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm"
      style={{
        backgroundColor: isOnline ? "#ECFDF5" : "#FEF3C7",
        borderColor: isOnline ? "#A7F3D0" : "#FDE68A",
        color: isOnline ? "#047857" : "#92400E",
      }}
    >
      <div className="flex items-center gap-2">
        {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        <span>
          {!isOnline ? "أنت تعمل بدون إنترنت" : "الاتصال رجع"}
          {pendingCount > 0 ? ` | عمليات بانتظار المزامنة: ${pendingCount}` : ""}
          {needsRefresh ? " | يوجد تحديث جديد للتطبيق" : ""}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {pendingCount > 0 && isOnline ? (
          <Button variant="outline" size="sm" onClick={onSync}>
            <RefreshCw className="h-3.5 w-3.5" />
            مزامنة الآن
          </Button>
        ) : null}
        {needsRefresh ? (
          <Button size="sm" onClick={onRefresh}>
            تحديث
          </Button>
        ) : null}
      </div>
    </div>
  )
}
