import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Save } from "lucide-react"
import { createCoupon, getCoupons, updateCoupon } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"

export function CouponsPage() {
  const queryClient = useQueryClient()
  const couponsQuery = useQuery({ queryKey: ["coupons"], queryFn: getCoupons })
  const [form, setForm] = useState({
    code: "",
    name: "",
    discountType: "AMOUNT" as "AMOUNT" | "PERCENT",
    discountValue: 0,
    startsAt: "",
    endsAt: "",
    maxUses: "",
  })

  const createMutation = useMutation({
    mutationFn: () =>
      createCoupon({
        ...form,
        startsAt: form.startsAt || undefined,
        endsAt: form.endsAt || undefined,
        maxUses: form.maxUses ? Number(form.maxUses) : undefined,
        isActive: true,
      }),
    onSuccess: () => {
      setForm({ code: "", name: "", discountType: "AMOUNT", discountValue: 0, startsAt: "", endsAt: "", maxUses: "" })
      void queryClient.invalidateQueries({ queryKey: ["coupons"] })
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => updateCoupon(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["coupons"] }),
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">الكوبونات والعروض</h1>
        <p className="text-slate-500">كود خصم أو عرض موسمي يتطبق كخصم بالفاتورة بدون ضريبة.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>كوبون جديد</CardTitle></CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[160px_1fr_150px_130px_150px_150px_120px_auto]">
          <Input value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="EID2026" />
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="اسم العرض" />
          <select className="h-10 rounded-md border px-3 text-sm" value={form.discountType} onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value as "AMOUNT" | "PERCENT" }))}>
            <option value="AMOUNT">مبلغ</option>
            <option value="PERCENT">نسبة</option>
          </select>
          <Input type="number" value={form.discountValue} onChange={(e) => setForm((f) => ({ ...f, discountValue: Number(e.target.value) }))} placeholder="القيمة" />
          <Input type="date" value={form.startsAt} onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))} />
          <Input type="date" value={form.endsAt} onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))} />
          <Input type="number" value={form.maxUses} onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))} placeholder="عدد" />
          <Button onClick={() => createMutation.mutate()} disabled={!form.code || !form.name || form.discountValue <= 0 || createMutation.isPending}>
            <Plus className="h-4 w-4" /> إضافة
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الكوبونات</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR><TH>الكود</TH><TH>الاسم</TH><TH>الخصم</TH><TH>الفترة</TH><TH>الاستخدام</TH><TH>الحالة</TH><TH>إجراء</TH></TR>
            </THead>
            <TBody>
              {(couponsQuery.data ?? []).map((coupon) => (
                <TR key={coupon.id}>
                  <TD className="font-bold">{coupon.code}</TD>
                  <TD>{coupon.name}</TD>
                  <TD>{coupon.discountType === "PERCENT" ? `${coupon.discountValue}%` : coupon.discountValue.toLocaleString("ar-IQ")}</TD>
                  <TD>{coupon.startsAt?.slice(0, 10) ?? "-"} / {coupon.endsAt?.slice(0, 10) ?? "-"}</TD>
                  <TD>{coupon.usedCount ?? 0}{coupon.maxUses ? ` / ${coupon.maxUses}` : ""}</TD>
                  <TD>{coupon.isActive ? "نشط" : "متوقف"}</TD>
                  <TD>
                    <Button variant="outline" size="sm" onClick={() => toggleMutation.mutate({ id: coupon.id, isActive: !coupon.isActive })}>
                      <Save className="h-4 w-4" /> {coupon.isActive ? "إيقاف" : "تفعيل"}
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
