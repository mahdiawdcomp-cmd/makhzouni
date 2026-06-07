import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createCustomer,
  createReceipt,
  getCustomer,
  getCustomerAny,
  getCustomerInvoices,
  getCustomerTransactions,
  getCustomers,
  getLastCustomerTransaction,
  getVouchers,
  updateCustomer,
} from "../api/endpoints"
import type { CustomerPayload, ReceiptPayload } from "../types/api"

export function useCustomers(isSupplier?: boolean) {
  const queryClient = useQueryClient()
  const customersQuery = useQuery({
    queryKey: ["customers", isSupplier],
    queryFn: () => getCustomers({ isSupplier }),
  })

  const createMutation = useMutation({
    mutationFn: (payload: CustomerPayload) => createCustomer(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customers"] }),
  })

  const receiptMutation = useMutation({
    mutationFn: (payload: ReceiptPayload) => createReceipt(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] })
      queryClient.invalidateQueries({ queryKey: ["vouchers"] })
    },
  })

  return { customersQuery, createMutation, receiptMutation }
}

export function useUpdateCustomer(id: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Partial<CustomerPayload>) => updateCustomer(id!, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] })
      queryClient.invalidateQueries({ queryKey: ["customers", id] })
    },
  })
}

/** For account lookup — fetches customers including soft-deleted ones */
export function useAllCustomers() {
  return useQuery({
    queryKey: ["customers", "all-including-deleted"],
    queryFn: () => getCustomers({ includeDeleted: true, limit: 100 }),
    staleTime: 30_000,
  })
}

export function useCustomerDetails(id: string | undefined, includeDeleted = false) {
  const customerQuery = useQuery({
    queryKey: ["customers", id, includeDeleted ? "any" : "active"],
    queryFn: () => includeDeleted ? getCustomerAny(id!) : getCustomer(id!),
    enabled: Boolean(id),
  })
  const transactionsQuery = useQuery({
    queryKey: ["customers", id, "transactions"],
    queryFn: () => getCustomerTransactions(id!),
    enabled: Boolean(id),
  })
  const lastTransactionQuery = useQuery({
    queryKey: ["customers", id, "last"],
    queryFn: () => getLastCustomerTransaction(id!),
    enabled: Boolean(id),
  })
  const invoicesQuery = useQuery({
    queryKey: ["customers", id, "invoices"],
    queryFn: () => getCustomerInvoices(id!),
    enabled: Boolean(id),
  })
  const vouchersQuery = useQuery({
    queryKey: ["vouchers", id],
    queryFn: () => getVouchers({ customerId: id }),
    enabled: Boolean(id),
  })
  return { customerQuery, transactionsQuery, lastTransactionQuery, invoicesQuery, vouchersQuery }
}
