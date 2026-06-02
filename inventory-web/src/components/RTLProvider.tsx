import { useEffect, type ReactNode } from "react"

export function RTLProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = "ar"
    document.documentElement.dir = "rtl"
  }, [])

  return <>{children}</>
}
