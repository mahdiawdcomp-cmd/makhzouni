import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createUser, deactivateUser, deleteUserPermanently, getUsers, updateUser } from "../api/endpoints"
import type { CreateUserPayload, Role, UpdateUserPayload, User } from "../types/api"

export function useUsers() {
  const queryClient = useQueryClient()
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: getUsers,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] })

  const createMutation = useMutation({
    mutationFn: (payload: CreateUserPayload) => createUser(payload),
    onSuccess: invalidate,
  })

  const roleMutation = useMutation({
    mutationFn: ({ user, role }: { user: User; role: Role }) => updateUser(user.id, { role }),
    onSuccess: invalidate,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserPayload }) => updateUser(id, payload),
    onSuccess: invalidate,
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateUser(id),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteUserPermanently(id),
    onSuccess: invalidate,
  })

  return {
    usersQuery,
    createMutation,
    roleMutation,
    updateMutation,
    deactivateMutation,
    deleteMutation,
  }
}
