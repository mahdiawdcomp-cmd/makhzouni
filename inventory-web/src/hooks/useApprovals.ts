import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getApprovals, reviewApproval } from "../api/endpoints"

export function useApprovals() {
  const queryClient = useQueryClient()
  const approvalsQuery = useQuery({
    queryKey: ["approvals"],
    queryFn: getApprovals,
  })
  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) =>
      reviewApproval(id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
  })

  return { approvalsQuery, reviewMutation }
}
