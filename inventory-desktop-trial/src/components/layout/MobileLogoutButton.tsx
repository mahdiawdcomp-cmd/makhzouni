import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "react-router-dom"
import { LogOut } from "lucide-react"
import { logout } from "../../api/endpoints"
import { useAuthStore } from "../../store/authStore"

// The desktop Header (with its user menu and «تسجيل الخروج») is hidden below
// lg, so phone users — the prep workers above all — had no way to sign out.
// Same steps as the Header's logout: server revoke, clear session AND the
// react-query cache (shared terminals), then /login.
export function MobileLogoutButton() {
  const navigate = useNavigate()
  const clearSession = useAuthStore((s) => s.logout)
  const queryClient = useQueryClient()
  const m = useMutation({
    mutationFn: logout,
    onSettled: () => {
      clearSession()
      queryClient.clear()
      navigate("/login", { replace: true })
    },
  })
  return (
    <button
      type="button"
      onClick={() => { if (window.confirm("تسجيل الخروج؟")) m.mutate() }}
      disabled={m.isPending}
      className="flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-500"
      aria-label="تسجيل الخروج"
    >
      <LogOut className="h-4 w-4" /> خروج
    </button>
  )
}
