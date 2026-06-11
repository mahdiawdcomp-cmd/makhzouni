/**
 * useUnsavedWarning
 * Two-layer unsaved-changes guard:
 *  1. Browser close / refresh → native `beforeunload` prompt
 *  2. In-app navigation       → react-router `useBlocker`
 *
 * Pass savingRef to bypass the blocker while an active save is in flight.
 */

import { useEffect, type MutableRefObject } from "react"
import { useBlocker } from "react-router-dom"

export function useUnsavedWarning(isDirty: boolean, savingRef?: MutableRefObject<boolean>) {
  useEffect(() => {
    if (!isDirty) return
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  const blocker = useBlocker(() => isDirty && !(savingRef?.current ?? false))
  return blocker
}
