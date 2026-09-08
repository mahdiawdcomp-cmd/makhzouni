import { useEffect, useInsertionEffect, useRef } from "react"

/* ══════════════════════════════════════════════════════════════════════
   Back closes the thing that is open, not the site.

   On a phone, back IS the close gesture. Without this, a shopper deep in a
   gallery pressed back to close a photo and left the shop entirely, losing
   their basket and their place.

   ONE guard for the whole page, not one per overlay. The first version gave
   every overlay its own history entry and its own cleanup, and the cleanups
   called history.back() — so closing a unit picker that sat on top of a photo
   fired two pops at once and the second one walked out of the site. Adding to
   the cart did exactly that.

   So: a single entry exists while anything is open, and it is re-pushed if
   closing one layer reveals another. The suppress flag makes the difference
   between "the user pressed back" and "we are rewinding our own entry",
   which is the distinction the broken version had no way to make.
══════════════════════════════════════════════════════════════════════ */

export function useBackGuard(closeTop: (() => void) | null) {
  // The latest closer, written in an effect: touching a ref during render
  // breaks under concurrent React, which may render and throw the work away.
  const closeRef = useRef(closeTop)
  useInsertionEffect(() => {
    closeRef.current = closeTop
  }, [closeTop])

  /** Whether OUR entry is currently on the stack. */
  const pushed = useRef(false)
  /** Set while we rewind our own entry, so that pop is not read as a press. */
  const rewinding = useRef(false)

  const isOpen = closeTop != null

  useEffect(() => {
    if (isOpen && !pushed.current) {
      pushed.current = true
      window.history.pushState({ __overlay: true }, "")
      return
    }
    if (!isOpen && pushed.current) {
      pushed.current = false
      rewinding.current = true
      window.history.back()
    }
  }, [isOpen])

  useEffect(() => {
    function onPop() {
      if (rewinding.current) {
        // Our own rewind coming back. Consume it and change nothing.
        rewinding.current = false
        return
      }
      if (!pushed.current) return
      // The browser has already dropped our entry; closing the top layer may
      // reveal another, and the effect above pushes a fresh one for it.
      pushed.current = false
      closeRef.current?.()
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
}
