import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createInvoice, getInvoice, getInvoices } from "../api/endpoints"
import type { CreateInvoicePayload, InvoiceType } from "../types/api"

export function useInvoices(params?: {
  from?: string
  to?: string
  status?: "ACTIVE" | "CANCELLED"
  type?: InvoiceType
  paymentType?: "CASH" | "CREDIT" | "PARTIAL"
}) {
  return useQuery({
    queryKey: ["invoices", params],
    queryFn: () => getInvoices(params),
  })
}

export function useInvoice(id: string | undefined) {
  return useQuery({
    queryKey: ["invoices", id],
    queryFn: () => getInvoice(id!),
    enabled: Boolean(id),
  })
}

export function useCreateInvoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: CreateInvoicePayload) => createInvoice(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invoices"] }),
  })
}
