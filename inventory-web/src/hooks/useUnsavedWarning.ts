/**
 * useUnsavedWarning
 * ─────────────────
 * Two-layer unsaved-changes guard:
 *  1. Browser close / refresh → native `beforeunload` prompt
 *  2. In-app navigation       → react-router `useBlocker`
 *
 * Usage:
 *   const blocker = useUnsavedWarning(isDirty)
 *   // then render <UnsavedChangesDialog blocker={blocker} onSave={…} />
 */

import { useEffect } from "react"
import { useBlocker } from "react-router-dom"

export function useUnsavedWarning(isDirty: boolean) {
  // ── 1. Guard browser close / page refresh ─────────────────────────────────
  useEffect(() => {
    if (!isDirty) return
    function handler(e: BeforeUnloadEvent) {
      e.preventDefault()
      // Most modern browsers ignore the returnValue message but still show a
      // generic "Leave site?" prompt when returnValue is set to a non-empty string.
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  // ── 2. Guard in-app navigation (react-router) ──────────────────────────────
  const blocker = useBlocker(isDirty)
  return blocker
}
