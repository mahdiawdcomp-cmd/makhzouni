import { useEffect } from "react"
import { useSettings } from "./useSettings"

export function usePageTitle(title: string) {
  const { data: settings } = useSettings()
  const storeName = settings?.storeName?.trim() || "مخزوني"

  useEffect(() => {
    document.title = title ? `${title} | ${storeName}` : storeName
  }, [title, storeName])
}
