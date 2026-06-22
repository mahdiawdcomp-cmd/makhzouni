import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { bulkReviewApprovals, getApprovals, getMyApprovals, reviewApproval } from "../api/endpoints"

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
    mutationFn: ({ id, status, allowPrices, showStock }: { id: string; status: "APPROVED" | "REJECTED"; allowPrices?: boolean; showStock?: boolean }) =>
      reviewApproval(id, status, { allowPrices, showStock }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  })

  const bulkReviewMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: "APPROVED" | "REJECTED" }) =>
      bulkReviewApprovals(ids, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  })

  return { approvalsQuery, myApprovalsQuery, reviewMutation, bulkReviewMutation }
}
