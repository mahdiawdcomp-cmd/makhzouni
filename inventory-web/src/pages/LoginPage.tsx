import { useState, type FormEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { Navigate, useNavigate } from "react-router-dom"
import { Boxes } from "lucide-react"
import { login } from "../api/endpoints"
import { useAuthStore } from "../store/authStore"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"

export function LoginPage() {
  const navigate = useNavigate()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated())
  const setSession = useAuthStore((state) => state.setSession)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (response) => {
      if (response.token && response.user) {
        setSession(response.token, response.user, rememberMe)
        navigate("/", { replace: true })
      } else {
        setError("استجابة الدخول غير مكتملة")
      }
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { message?: string } }; message?: string }
      const status = e?.response?.status
      const msg = e?.response?.data?.message ?? e?.message ?? "unknown"
      if (status === 401) {
        setError(`❌ كلمة المرور غير صحيحة (401)`)
      } else if (status === 422) {
        setError(`❌ أدخل البيانات (422)`)
      } else {
        setError(`خطأ ${status ?? "شبكة"}: ${msg}`)
      }
    },
  })

  if (isAuthenticated) return <Navigate to="/" replace />

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    mutation.mutate({ username, password })
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-4 dark:bg-slate-950">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-xl bg-slate-900 text-amber-400 dark:bg-amber-500 dark:text-slate-950">
            <Boxes className="h-7 w-7" />
          </div>
          <CardTitle className="text-2xl">مخزوني</CardTitle>
          <p className="text-sm text-slate-500">تسجيل الدخول إلى لوحة الإدارة</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium">اسم المستخدم</label>
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoFocus
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">كلمة المرور</label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              تذكرني
            </label>
            {error ? <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
            <Button className="w-full" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "جاري الدخول..." : "تسجيل الدخول"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
