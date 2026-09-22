/**
 * «المندوب» — data hooks and the one-tap guard shared by the rep's screens.
 */

import { useCallback, useRef, useState } from "react"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../../api/client"
import { toast } from "../../components/ui/use-toast"
import { apiErrorMessage } from "../../utils/apiError"
import { useAuthStore } from "../../store/authStore"
import { stableThumbnailBatches } from "../../utils/salesAgentCatalog"
import type { AgentProduct, CustomerPage, CustomerHeader } from "./model"

export function useAgentProducts() {
  return useQuery({
    queryKey: ["sales-agent", "products"],
    queryFn: async () => {
      const res = await api.get<{ data: AgentProduct[] }>("/sales-agent/products")
      return res.data.data ?? []
    },
    // The rep reopens this all day; a stale grid beats a spinner on a dead spot.
    staleTime: 5 * 60 * 1000,
    retry: 3,
  })
}

export function useMyCustomers(search: string, page: number, followUp = "", area = "", needsFollowUp = false) {
  return useQuery({
    queryKey: ["sales-agent", "customers", search, page, followUp, area, needsFollowUp],
    queryFn: async () => {
      const res = await api.get<{ data: CustomerPage }>("/sales-agent/customers", {
        params: {
          page,
          limit: 200,
          ...(search ? { search } : {}),
          ...(followUp ? { followUp } : {}),
          ...(area ? { area } : {}),
          // Filtered in the database, not here: filtering a fetched page would
          // hide customers who need following up on a later page and make
          // `total` describe a list the screen does not show.
          ...(needsFollowUp ? { needsFollowUp: true } : {}),
          // The follow-up reasons for this page. A fixed number of extra reads
          // regardless of page size, computed on the server.
          withReasons: true,
        },
      })
      return res.data.data
    },
    // Keeps the previous page on screen while the next one loads, instead of
    // blanking a list the rep is reading in the street.
    placeholderData: (prev) => prev,
    retry: 3,
  })
}

export function useCustomerHeader(customerId: string | null) {
  return useQuery({
    queryKey: ["sales-agent", "customer-header", customerId],
    enabled: Boolean(customerId),
    queryFn: async () => {
      const res = await api.get<{ data: CustomerHeader }>(`/sales-agent/customers/${customerId}/header`)
      return res.data.data
    },
    retry: 3,
  })
}

/**
 * Thumbnails for the cards currently on screen, fetched in batches.
 *
 * Cards report themselves visible through an IntersectionObserver attached by
 * callback ref. Ids collect for a beat, then go out as one request, so a fast
 * scroll produces a handful of calls rather than one per card.
 */
export function useThumbnails(allIds: string[], visibleIds: string[]) {
  const qc = useQueryClient()
  const userId = useAuthStore(s => s.user?.id)
  const batches = stableThumbnailBatches(allIds, visibleIds)
  const queries = useQueries({ queries: batches.map(({ ids, enabled }) => ({
    queryKey: ["sales-agent", "thumbnails", userId, ids],
    enabled,
    queryFn: async () => {
      const data = (await api.post<{ data: Record<string, string | null> }>("/sales-agent/products/thumbnails", { ids })).data.data
      for (const [id, src] of Object.entries(data)) qc.setQueryData(["sales-agent", "thumbnail", userId, id], src)
      return data
    },
    // A product's picture almost never changes, and every refetch re-reads the
    // base64 column from the database, so keep them for the whole shift.
    staleTime: 30 * 60 * 1000, gcTime: 60 * 60 * 1000, retry: 2, refetchOnWindowFocus: false,
  })) })
  const cached = Object.fromEntries(visibleIds.map(id => [id, qc.getQueryData<string | null>(["sales-agent", "thumbnail", userId, id]) ?? null]))
  return Object.assign(cached, ...queries.map(query => query.data ?? {})) as Record<string, string | null>
}

/* ── page ────────────────────────────────────────────────────────────── */

/**
 * One tap, one request.
 *
 * Two taps land in the same tick, before React can re-render the button as
 * disabled. Every save on this page produced a twin that way: two orders for
 * the same cart, two receipts for the same cash, two refusals, two price
 * requests. The server refuses duplicates too — this just stops the round trip.
 */
export function useOnce(mutation: {
  mutate: (vars: undefined, opts?: { onSettled?: () => void }) => void
}) {
  const busy = useRef(false)
  return useCallback(() => {
    if (busy.current) return
    busy.current = true
    mutation.mutate(undefined, { onSettled: () => (busy.current = false) })
  }, [mutation])
}

/**
 * «أرسل السند للزبون» — the shop's own receipt template, sent from the shop's
 * number by the server. The rep's device sends only WHICH receipt; the words
 * are never the rep's.
 *
 * `sending` holds the ids in flight, so a second tap on the same receipt is
 * ignored rather than reaching the server's one-minute cooldown as an error.
 */
export function useSendReceiptWhatsapp() {
  const inFlight = useRef(new Set<string>())
  const [sent, setSent] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const send = useCallback(async (voucherId: string) => {
    if (!voucherId || inFlight.current.has(voucherId)) return
    inFlight.current.add(voucherId)
    setBusy((b) => ({ ...b, [voucherId]: true }))
    try {
      const res = await api.post<{ data: { voucherNumber: string } }>(`/sales-agent/receipts/${voucherId}/send-whatsapp`)
      setSent((s) => ({ ...s, [voucherId]: true }))
      toast({ title: `انرسل السند ${res.data?.data?.voucherNumber ?? ""} للزبون ✓` })
    } catch (err) {
      toast({ title: "ما انرسل السند", description: apiErrorMessage(err), variant: "destructive" })
    } finally {
      inFlight.current.delete(voucherId)
      setBusy((b) => ({ ...b, [voucherId]: false }))
    }
  }, [])
  return { send, sent, busy }
}
