import { useEffect, useInsertionEffect, useRef } from "react"

/* ══════════════════════════════════════════════════════════════════════
   Back closes the thing that is open, not the site.

   Every overlay in the storefront — the opened picture, the unit picker, the
   cart, the details step — used to leave the browser's history untouched. So
   a shopper deep in a gallery pressed back to close a photo and left the shop
   entirely, losing their basket's place and their scroll position. On a phone
   that gesture IS the close button, and it was throwing people out.

   Opening pushes one history entry; back pops it and runs onClose instead of
   navigating. Closing by any other route (the ✕, a tap outside) rewinds that
   entry so the history never fills up with ghosts.
══════════════════════════════════════════════════════════════════════ */

export function useBackClose(open: boolean, onClose: () => void) {
  // The latest onClose, so the popstate listener never calls a stale one.
  // Written in an effect rather than during render: touching a ref while
  // rendering breaks under concurrent React, which may render a component and
  // then throw the work away.
  const closeRef = useRef(onClose)
  useInsertionEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  // True only while OUR entry is the one on top, so a close that came from
  // somewhere else does not rewind an entry we never pushed.
  const pushedRef = useRef(false)

  useEffect(() => {
    if (!open) return

    const marker = { __overlay: Date.now() }
    window.history.pushState(marker, "")
    pushedRef.current = true

    const onPop = () => {
      // The browser already removed our entry by the time this fires, so the
      // cleanup below must not try to remove it a second time.
      pushedRef.current = false
      closeRef.current()
    }
    window.addEventListener("popstate", onPop)

    return () => {
      window.removeEventListener("popstate", onPop)
      // Closed some other way — take our entry back out, or the next press of
      // back would do nothing at all and feel broken.
      if (pushedRef.current) {
        pushedRef.current = false
        window.history.back()
      }
    }
  }, [open])
}
