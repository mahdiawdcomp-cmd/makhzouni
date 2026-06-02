import { useQuery } from "@tanstack/react-query"
import {
  getCustomerDebts,
  getDashboardReport,
  getEndOfDayReport,
  getInventoryValuation,
  getSalesReport,
  getTopCustomers,
} from "../api/endpoints"

export function useDashboardReport() {
  return useQuery({
    queryKey: ["reports", "dashboard"],
    queryFn: getDashboardReport,
  })
}

export function useSalesReport(params: { from?: string; to?: string; groupBy?: "day" | "week" | "month" }) {
  return useQuery({
    queryKey: ["reports", "sales", params],
    queryFn: () => getSalesReport(params),
  })
}

export function useInventoryReport() {
  return useQuery({
    queryKey: ["reports", "inventory"],
    queryFn: getInventoryValuation,
  })
}

export function useDebtReport(params: { minDays?: number; maxDays?: number }) {
  return useQuery({
    queryKey: ["reports", "debts", params],
    queryFn: () => getCustomerDebts(params),
  })
}

export function useTopCustomers(params: { from?: string; to?: string; limit?: number }) {
  return useQuery({
    queryKey: ["reports", "top-customers", params],
    queryFn: () => getTopCustomers(params),
  })
}

export function useEndOfDayReport(date?: string) {
  return useQuery({
    queryKey: ["reports", "end-of-day", date],
    queryFn: () => getEndOfDayReport(date),
  })
}
