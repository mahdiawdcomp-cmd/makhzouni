import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getSettings, updateSettings } from "../api/endpoints"
import type { AppSettings } from "../types/api"

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
    // Cache settings for the whole session — they don't change often.
    staleTime: 5 * 60 * 1000,
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Partial<AppSettings>) => updateSettings(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  })
}
