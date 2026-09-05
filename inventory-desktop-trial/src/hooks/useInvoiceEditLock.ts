import { useEffect } from "react"

import { heartbeatInvoiceEdit, releaseInvoiceEdit } from "../api/endpoints"

/** Refreshed often enough that a live editor is never mistaken for a stale one. */
const HEARTBEAT_MS = 15_000

/**
 * Tell the server "this invoice is being edited right now" for as long as the
 * edit screen is open.
 *
 * It exists for one reader: the public «جرد الفاتورة» page, which pauses its
 * counter instead of letting them count a document being rewritten underneath.
 * It never blocks anyone in the shop, so a failed heartbeat is ignored rather
 * than surfaced — the worst case is a counter waiting a few extra seconds.
 */
export function useInvoiceEditLock(invoiceId: string | null | undefined) {
  useEffect(() => {
    if (!invoiceId) return
    let cancelled = false

    const beat = () => {
      if (cancelled) return
      void heartbeatInvoiceEdit(invoiceId).catch(() => undefined)
    }

    beat()
    const timer = window.setInterval(beat, HEARTBEAT_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      void releaseInvoiceEdit(invoiceId).catch(() => undefined)
    }
  }, [invoiceId])
}
