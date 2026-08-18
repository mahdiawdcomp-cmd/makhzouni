import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Lock, Search, Send, Unlock, UserRound, Users } from "lucide-react"
import {
  listStorefrontAccounts,
  sendStorefrontCredentials,
  sendStorefrontCredentialsBulk,
  setCustomerPricesHidden,
  unlockStorefrontAccount,
  type StorefrontCustomerAccount,
  type StorefrontVisitorAccount,
} from "../api/endpoints"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { ConfirmDialog } from "./ui/confirm-dialog"
import { Input } from "./ui/input"
import { toast } from "./ui/use-toast"
import { cn } from "../utils/cn"

type Group = "customers" | "visitors"

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" }) : "—"

export function StorefrontAccountsTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [group, setGroup] = useState<Group>("customers")
  const [confirmBulk, setConfirmBulk] = useState(false)

  const accountsQuery = useQuery({
    queryKey: ["storefront-accounts", search],
    queryFn: () => listStorefrontAccounts(search.trim() || undefined),
  })
  const customers = useMemo(() => accountsQuery.data?.customers ?? [], [accountsQuery.data])
  const visitors = useMemo(() => accountsQuery.data?.visitors ?? [], [accountsQuery.data])

  const refresh = () => void qc.invalidateQueries({ queryKey: ["storefront-accounts"] })

  const sendOneMut = useMutation({
    mutationFn: (t: { kind: "CUSTOMER" | "VISITOR"; id?: string; phone?: string }) =>
      sendStorefrontCredentials(t),
    onSuccess: () => { toast({ title: "تم إرسال بيانات الدخول" }); refresh() },
    onError: (e) => toast({
      title: e instanceof Error ? e.message : "تعذر الإرسال",
      variant: "destructive",
    }),
  })

  const bulkMut = useMutation({
    mutationFn: () => {
      const targets = group === "customers"
        ? customers.map((c) => ({ kind: "CUSTOMER" as const, id: c.id }))
        : visitors.map((v) => ({ kind: "VISITOR" as const, phone: v.phone }))
      return sendStorefrontCredentialsBulk(targets)
    },
    onSuccess: (r) => {
      toast({ title: `أُرسلت ${r.sent} من ${r.total}${r.failed ? ` — فشل ${r.failed}` : ""}` })
      refresh()
    },
    onError: (e) => toast({
      title: e instanceof Error ? e.message : "تعذر الإرسال الجماعي",
      variant: "destructive",
    }),
  })

  const unlockMut = useMutation({
    mutationFn: (t: { kind: "CUSTOMER" | "VISITOR"; idOrPhone: string }) =>
      unlockStorefrontAccount(t.kind, t.idOrPhone),
    onSuccess: () => { toast({ title: "تم فك القفل" }); refresh() },
    onError: () => toast({ title: "تعذر فك القفل", variant: "destructive" }),
  })

  const pricesMut = useMutation({
    mutationFn: (t: { id: string; hidden: boolean }) => setCustomerPricesHidden(t.id, t.hidden),
    onSuccess: () => refresh(),
    onError: () => toast({ title: "تعذر التحديث", variant: "destructive" }),
  })

  const rowShell = "flex items-center gap-3 rounded-xl border bg-white p-3"
  const currentCount = group === "customers" ? customers.length : visitors.length

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-5 w-5 text-indigo-600" />
            حسابات الدخول للمتجر
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
            الزبون يدخل برقم هاتفه ورمز من 6 أرقام. الرمز يُحفظ مشفّراً — ما نقدر نعرضه لك مرة ثانية،
            فإعادة الإرسال تولّد رمز جديد ويبطل القديم تلقائياً.
          </p>

          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pr-9" placeholder="ابحث بالاسم أو رقم الهاتف"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="flex gap-1.5">
            <button onClick={() => setGroup("customers")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition",
                group === "customers" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}>
              <UserRound className="h-4 w-4" /> زبائن ({customers.length})
            </button>
            <button onClick={() => setGroup("visitors")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition",
                group === "visitors" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}>
              <Users className="h-4 w-4" /> جدد بدون حساب ({visitors.length})
            </button>
          </div>

          <Button
            onClick={() => setConfirmBulk(true)}
            disabled={bulkMut.isPending || currentCount === 0}
            className="w-full"
          >
            <Send className="ml-1 h-4 w-4" />
            {bulkMut.isPending
              ? "جاري الإرسال..."
              : `إرسال بيانات الدخول لكل ${group === "customers" ? "الزبائن" : "الجدد"} (${currentCount})`}
          </Button>

          {accountsQuery.isLoading && <p className="py-6 text-center text-sm text-slate-400">جاري التحميل...</p>}

          {group === "customers" && (
            <div className="space-y-2">
              {customers.map((c: StorefrontCustomerAccount) => (
                <div key={c.id} className={rowShell}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-400" dir="ltr">{c.phone}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {c.hasCode ? `أُرسل الرمز ${fmtDate(c.codeSetAt)}` : "ما عنده رمز بعد"}
                      {c.lastLoginAt ? ` · آخر دخول ${fmtDate(c.lastLoginAt)}` : ""}
                    </p>
                    {c.locked && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">
                        <Lock className="h-3 w-3" /> مقفل مؤقتاً
                      </span>
                    )}
                  </div>

                  <label className="flex shrink-0 flex-col items-center gap-1 text-[10px] font-semibold text-slate-500">
                    <input type="checkbox" checked={c.pricesHidden}
                      onChange={(e) => pricesMut.mutate({ id: c.id, hidden: e.target.checked })}
                      className="h-4 w-4 accent-amber-600" />
                    إخفاء السعر
                  </label>

                  {c.locked && (
                    <button onClick={() => unlockMut.mutate({ kind: "CUSTOMER", idOrPhone: c.id })}
                      className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                      title="فك القفل">
                      <Unlock className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => sendOneMut.mutate({ kind: "CUSTOMER", id: c.id })}
                    disabled={sendOneMut.isPending}
                    className="shrink-0 rounded-lg bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50">
                    {c.hasCode ? "رمز جديد" : "إرسال"}
                  </button>
                </div>
              ))}
              {!accountsQuery.isLoading && customers.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-400">ما في زبائن مطابقين</p>
              )}
            </div>
          )}

          {group === "visitors" && (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-400">
                أرقام دخلت الكتلوك وما صارت زبائن بعد. لما يدخل ويرسل بياناته، يوصلك طلب بصفحة الموافقات
                تعدله وتوافق عليه قبل ما يصير حساب زبون.
              </p>
              {visitors.map((v: StorefrontVisitorAccount) => (
                <div key={v.phone} className={rowShell}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800" dir="ltr">{v.phone}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {v.hasCode ? `أُرسل الرمز ${fmtDate(v.codeSetAt)}` : "ما عنده رمز بعد"}
                      {v.lastLoginAt ? ` · آخر دخول ${fmtDate(v.lastLoginAt)}` : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {v.detailsSubmitted && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                          أرسل بياناته — بانتظار موافقتك
                        </span>
                      )}
                      {v.locked && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-600">
                          <Lock className="h-3 w-3" /> مقفل مؤقتاً
                        </span>
                      )}
                    </div>
                  </div>
                  {v.locked && (
                    <button onClick={() => unlockMut.mutate({ kind: "VISITOR", idOrPhone: v.phone })}
                      className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                      title="فك القفل">
                      <Unlock className="h-4 w-4" />
                    </button>
                  )}
                  <button onClick={() => sendOneMut.mutate({ kind: "VISITOR", phone: v.phone })}
                    disabled={sendOneMut.isPending}
                    className="shrink-0 rounded-lg bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50">
                    {v.hasCode ? "رمز جديد" : "إرسال"}
                  </button>
                </div>
              ))}
              {!accountsQuery.isLoading && visitors.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-400">ما في أرقام جديدة</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmBulk}
        title="إرسال بيانات الدخول"
        description={
          `راح يتولّد رمز جديد لكل ${currentCount} ` +
          `${group === "customers" ? "زبون" : "رقم"} ويُرسل لهم على الواتساب. ` +
          "أي رمز قديم يبطل فوراً."
        }
        confirmLabel="إرسال"
        loading={bulkMut.isPending}
        onConfirm={() => { setConfirmBulk(false); bulkMut.mutate() }}
        onCancel={() => setConfirmBulk(false)}
      />
    </div>
  )
}
