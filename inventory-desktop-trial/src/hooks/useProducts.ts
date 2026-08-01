import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createProduct,
  deleteProduct,
  getProduct,
  getProductMovement,
  getProducts,
  updateProduct,
} from "../api/endpoints"
import type { Product, ProductPayload } from "../types/api"

// WHY THE GUARDS BELOW EXIST - "sometimes the products vanish".
//
// Every mutation starts with `cancelQueries`, which aborts an IN-FLIGHT initial
// fetch. On a shop connection this list is ~4.75 MB and takes seconds, so a user
// who saves a product while the page is still loading cancels that load. The
// snapshot (`prev`) is then `undefined`, the optimistic writer used to fabricate
// a one-item array from nothing, and `onSettled` invalidated with
// `refetchType: "none"` - marking the cache stale WITHOUT refetching.
//
// Net effect: the catalogue collapsed to a single product (or to nothing for
// update/delete) and STAYED that way, because staleTime is 5 minutes and
// nothing forced a reload. `onError` could not rescue it either, since its
// rollback was guarded on `ctx?.prev` being truthy - exactly the value that is
// undefined in this scenario.
//
// The rule now: never fabricate a list we never had. When there was no baseline
// we skip the optimistic patch entirely and force a real refetch on settle.
const QUERY_KEY = ["products"]

export function useProducts() {
  const qc = useQueryClient()

  const productsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getProducts({ limit: 5000 }),
    // Mutations already patch this cache directly (see onSuccess below) instead
    // of refetching, so a longer staleTime only affects how soon OTHER users'
    // concurrent changes are picked up — not correctness for this user's own
    // edits. Measured on production: ~4.75MB / ~200ms server time for 481
    // products (thumbnails only, full images already omitted server-side).
    // Not the "huge base64 image" issue the comments below describe — that
    // was already fixed — but still real bytes worth not re-fetching every
    // 60s during an active session.
    staleTime: 5 * 60_000,
  })

  const createMutation = useMutation({
    mutationFn: (payload: ProductPayload) => createProduct(payload),
    // Optimistic: append a placeholder so UI feels instant
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const prev = qc.getQueryData<Product[]>(QUERY_KEY)
      const hadData = prev !== undefined
      // No baseline (first load still in flight, and we just cancelled it) -
      // a one-item optimistic list would BE the whole catalogue. Skip it.
      if (hadData) {
        qc.setQueryData<Product[]>(QUERY_KEY, (old) => {
          const optimistic = { ...payload, id: "__optimistic__", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), currentStock: 0 } as unknown as Product
          return old ? [optimistic, ...old] : [optimistic]
        })
      }
      return { prev, hadData }
    },
    onError: (_e, _v, ctx) => {
      // `prev` is undefined when the initial load was the thing we cancelled.
      // Dropping the entry (rather than leaving a fabricated one) makes the
      // query refetch cleanly instead of showing a truncated catalogue.
      if (ctx?.hadData) qc.setQueryData(QUERY_KEY, ctx.prev)
      else qc.removeQueries({ queryKey: QUERY_KEY })
    },
    // Use the server's authoritative product to replace the placeholder — do NOT
    // refetch the whole list, just to avoid an unnecessary ~5MB round trip.
    onSuccess: (res) => {
      const created = res?.data
      if (!created) { void qc.invalidateQueries({ queryKey: QUERY_KEY, refetchType: "none" }); return }
      qc.setQueryData<Product[]>(QUERY_KEY, (old) => {
        // Only patch a list that actually exists - otherwise this would create
        // a single-product catalogue out of nothing.
        if (old === undefined) return old
        const without = old.filter((p) => p.id !== "__optimistic__" && p.id !== created.id)
        return [created, ...without]
      })
    },
    // Had a baseline -> the cache is already correct, just mark it stale.
    // Had none -> we MUST actually refetch, or the list stays missing.
    onSettled: (_d, _e, _v, ctx) =>
      qc.invalidateQueries({ queryKey: QUERY_KEY, refetchType: ctx?.hadData ? "none" : "active" }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ProductPayload }) => updateProduct(id, payload),
    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const prev = qc.getQueryData<Product[]>(QUERY_KEY)
      const hadData = prev !== undefined
      qc.setQueryData<Product[]>(QUERY_KEY, (old) =>
        old?.map((p) => {
          if (p.id !== id) return p
          const merged = { ...p, ...payload } as Product
          // When the image changed, the old server thumbnail is now stale — drop
          // it so the list immediately falls back to the new full image instead
          // of showing the previous thumbnail until the server thumbnail loads.
          if (payload.imageUrl !== undefined) merged.thumbnailUrl = null
          return merged
        }) ?? old
      )
      return { prev, hadData }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.hadData) qc.setQueryData(QUERY_KEY, ctx.prev)
      else qc.removeQueries({ queryKey: QUERY_KEY })
    },
    // Merge the server's authoritative product into the cache instead of
    // refetching the entire ~5MB list on every edit.
    onSuccess: (res, vars) => {
      const updated = res?.data
      qc.setQueryData<Product[]>(QUERY_KEY, (old) =>
        old?.map((p) => p.id === vars.id ? (updated ?? p) : p) ?? old
      )
    },
    onSettled: (_d, _e, _v, ctx) =>
      qc.invalidateQueries({ queryKey: QUERY_KEY, refetchType: ctx?.hadData ? "none" : "active" }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const prev = qc.getQueryData<Product[]>(QUERY_KEY)
      const hadData = prev !== undefined
      qc.setQueryData<Product[]>(QUERY_KEY, (old) => old?.filter((p) => p.id !== id) ?? old)
      return { prev, hadData }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.hadData) qc.setQueryData(QUERY_KEY, ctx.prev)
      else qc.removeQueries({ queryKey: QUERY_KEY })
    },
    // Optimistic filter already removed it; avoid refetching the heavy list -
    // unless we never had one, in which case we must fetch it for real.
    onSettled: (_d, _e, _v, ctx) =>
      qc.invalidateQueries({ queryKey: QUERY_KEY, refetchType: ctx?.hadData ? "none" : "active" }),
  })

  return { productsQuery, createMutation, updateMutation, deleteMutation }
}

export function useProductDetails(id: string | undefined) {
  const productQuery = useQuery({
    queryKey: ["products", id],
    queryFn: () => getProduct(id!),
    enabled: Boolean(id),
  })
  const movementQuery = useQuery({
    queryKey: ["products", id, "movement"],
    queryFn: () => getProductMovement(id!),
    enabled: Boolean(id),
  })
  return { productQuery, movementQuery }
}
