import { useState, type FormEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { z } from "zod"
import { changePassword } from "../../api/endpoints"
import { Button } from "../ui/button"
import { Card, CardContent } from "../ui/card"
import { Input } from "../ui/input"

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "اكتب كلمة المرور الحالية"),
    newPassword: z.string().min(6, "كلمة المرور الجديدة لازم تكون 6 أحرف على الأقل"),
    confirmPassword: z.string().min(1, "أكد كلمة المرور الجديدة"),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "كلمتا المرور غير متطابقتين",
  })

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setError("")
      setMessage("تم تغيير كلمة المرور")
    },
    onError: (err) => {
      setMessage("")
      setError(
        (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message ??
          (err as Error).message ??
          "تعذر تغيير كلمة المرور",
      )
    },
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setError("")
    setMessage("")
    const parsed = passwordSchema.safeParse({ currentPassword, newPassword, confirmPassword })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "تحقق من الحقول")
      return
    }
    mutation.mutate({
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    })
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div>
          <h2 className="font-bold">تغيير كلمة المرور</h2>
          <p className="text-sm text-slate-500">تحديث كلمة مرور حسابك الحالي.</p>
        </div>
        <form className="space-y-3" onSubmit={submit}>
          <Input
            type="password"
            placeholder="كلمة المرور الحالية"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <Input
            type="password"
            placeholder="كلمة المرور الجديدة"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <Input
            type="password"
            placeholder="تأكيد كلمة المرور الجديدة"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "جاري الحفظ..." : "حفظ كلمة المرور"}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
