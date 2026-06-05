import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getApprovals, getMyApprovals, reviewApproval } from "../api/endpoints"

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
    mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) =>
      reviewApproval(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  })

  return { approvalsQuery, myApprovalsQuery, reviewMutation }
}
