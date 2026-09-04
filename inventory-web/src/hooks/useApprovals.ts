import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { addApprovalCustomer, bulkReviewApprovals, getApprovals, getMyApprovals, reviewApproval } from "../api/endpoints"

export function useApprovals() {
  const queryClient = useQueryClient()
  const approvalsQuery = useQuery({
    queryKey: ["approvals"],
    queryFn: getApprovals,
    refetchInterval: 30_000,
  })
  const myApprovalsQuery = useQuery({
    queryKey: ["approvals", "my-requests"],
    queryFn: getMyApprovals,
    refetchInterval: 30_000,
  })
  const reviewMutation = useMutation({
    mutationFn: ({ id, status, allowPrices, showStock, catalogOrderMode, reviewNote }: {
      id: string; status: "APPROVED" | "REJECTED"; allowPrices?: boolean; showStock?: boolean
      catalogOrderMode?: "INVOICE" | "PREPARE"
      // Only sent on a rejection — the reason the requester reads instead of
      // telephoning to ask what to fix.
      reviewNote?: string
    }) => reviewApproval(id, status, { allowPrices, showStock, catalogOrderMode, reviewNote }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  })

  // Adding the customer changes what the order row can do next, so the list
  // is refreshed rather than left showing a stranger who is now on the books.
  const addCustomerMutation = useMutation({
    mutationFn: (approvalId: string) => addApprovalCustomer(approvalId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  })

  const bulkReviewMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: "APPROVED" | "REJECTED" }) =>
      bulkReviewApprovals(ids, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  })

  return { approvalsQuery, myApprovalsQuery, reviewMutation, bulkReviewMutation, addCustomerMutation }
}
