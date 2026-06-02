import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createProduct,
  getProduct,
  getProductMovement,
  getProducts,
  updateProduct,
} from "../api/endpoints"
import type { ProductPayload } from "../types/api"

export function useProducts() {
  const queryClient = useQueryClient()
  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["products"] })

  const createMutation = useMutation({
    mutationFn: (payload: ProductPayload) => createProduct(payload),
    onSuccess: invalidate,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ProductPayload }) => updateProduct(id, payload),
    onSuccess: invalidate,
  })

  return { productsQuery, createMutation, updateMutation }
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
