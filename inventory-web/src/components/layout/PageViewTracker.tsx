import { useEffect, useRef } from "react"
import { useLocation } from "react-router-dom"
import { recordPageView } from "../../api/endpoints"
import { useCurrentPageLabel } from "./Header"

// «سجل الصفحات» — records each page the signed-in account opens (owner reads
// it at /activity-log). Settled pages only: a path held for under a second
// (redirects, fast clicking through) is not logged. Failures are ignored.
export function PageViewTracker() {
  const { pathname } = useLocation()
  const label = useCurrentPageLabel()
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (last.current === pathname) return
    const t = setTimeout(() => {
      last.current = pathname
      recordPageView(pathname, label).catch(() => {})
    }, 1000)
    return () => clearTimeout(t)
  }, [pathname, label])
  return null
}
