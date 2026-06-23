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

const QUERY_KEY = ["products"]

export function useProducts() {
  const qc = useQueryClient()

  const productsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getProducts({ limit: 5000 }),
    staleTime: 60_000,
  })

  const createMutation = useMutation({
    mutationFn: (payload: ProductPayload) => createProduct(payload),
    // Optimistic: append a placeholder so UI feels instant
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const prev = qc.getQueryData<Product[]>(QUERY_KEY)
      qc.setQueryData<Product[]>(QUERY_KEY, (old) => {
        const optimistic = { ...payload, id: "__optimistic__", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), currentStock: 0 } as unknown as Product
        return old ? [optimistic, ...old] : [optimistic]
      })
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ProductPayload }) => updateProduct(id, payload),
    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const prev = qc.getQueryData<Product[]>(QUERY_KEY)
      qc.setQueryData<Product[]>(QUERY_KEY, (old) =>
        old?.map((p) => p.id === id ? { ...p, ...payload } as Product : p) ?? old
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY })
      const prev = qc.getQueryData<Product[]>(QUERY_KEY)
      qc.setQueryData<Product[]>(QUERY_KEY, (old) => old?.filter((p) => p.id !== id) ?? old)
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
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
