import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Lock, MessageSquare, RotateCcw, Search, Send, Unlock, UserRound, Users } from "lucide-react"
import {
  applyPricesDefaultToAll,
  getCredentialTargetCounts,
  getSettings,
  listStorefrontAccounts,
  sendStorefrontCredentials,
  sendStorefrontCredentialsToAll,
  sendStorefrontInvitesToAll,
  setCustomerPricesHidden,
  unlockStorefrontAccount,
  updateSettings,
  type StorefrontCustomerAccount,
  type StorefrontVisitorAccount,
} from "../api/endpoints"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { ConfirmDialog } from "./ui/confirm-dialog"
import { Input } from "./ui/input"
import { toast } from "./ui/use-toast"
import { cn } from "../utils/cn"
import { MarketingOptOutCard } from "./MarketingOptOutCard"
import { StorefrontInviteCard } from "./StorefrontInviteCard"

type Group = "customers" | "visitors"

/** Mirrors the backend default, shown as the textarea's placeholder so the
 *  shop can see exactly what goes out when they leave the field empty. */
const DEFAULT_APPROVED_TEMPLATE = [
  "أهلاً {{customerName}} 👋",
  "تمت الموافقة على طلبك، وصار عندك حساب في متجر {{storeName}}.",
  "",
  "👤 اسم المستخدم: {{username}}",
  "🔑 الرمز: {{code}}",
  "",
  "🔗 ادخل من هنا:",
  "{{link}}",
].join("\n")

const DEFAULT_CREDENTIALS_TEMPLATE = [
  "مرحباً {{customerName}} 👋",
  "هذا حسابك للدخول إلى متجر {{storeName}}:",
  "",
  "👤 اسم المستخدم: {{username}}",
  "🔑 الرمز: {{code}}",
  "",
  "🔗 رابط المتجر:",
  "{{link}}",
].join("\n")

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" }) : "—"

export function StorefrontAccountsTab() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [group, setGroup] = useState<Group>("customers")
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [confirmInvite, setConfirmInvite] = useState(false)

  const accountsQuery = useQuery({
    queryKey: ["storefront-accounts", search],
    queryFn: () => listStorefrontAccounts(search.trim() || undefined),
  })
  const customers = useMemo(() => accountsQuery.data?.customers ?? [], [accountsQuery.data])
  const visitors = useMemo(() => accountsQuery.data?.visitors ?? [], [accountsQuery.data])

  // The rows above are paged; these are the real totals a "send to all" hits.
  const countsQuery = useQuery({
    queryKey: ["credential-target-counts"],
    queryFn: getCredentialTargetCounts,
  })
  const totals = countsQuery.data ?? { customers: 0, visitors: 0 }
  const totalForGroup = group === "customers" ? totals.customers : totals.visitors

  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const [templateDraft, setTemplateDraft] = useState<string | null>(null)
  const [showTemplate, setShowTemplate] = useState(false)
  const savedTemplate = settingsQuery.data?.storefrontCredentialsTemplate ?? ""
  const template = templateDraft ?? savedTemplate
  const [approvedDraft, setApprovedDraft] = useState<string | null>(null)
  const [showApproved, setShowApproved] = useState(false)
  const savedApproved = settingsQuery.data?.catalogAccessApprovedTemplate ?? ""
  const approvedTemplate = approvedDraft ?? savedApproved
  const pricesVisible = settingsQuery.data?.catalogPricesVisibleByDefault !== false
  const requireLogin = settingsQuery.data?.catalogRequireLogin === true

  const settingsMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateSettings(patch),
    onSuccess: () => {
      toast({ title: "تم الحفظ" })
      void qc.invalidateQueries({ queryKey: ["settings"] })
    },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })

  const applyDefaultMut = useMutation({
    mutationFn: applyPricesDefaultToAll,
    onSuccess: (r) => {
      toast({ title: r.visible ? "الأسعار ظاهرة الآن لكل الزبائن" : "الأسعار مخفية الآن عن الجميع" })
      refresh()
    },
    onError: () => toast({ title: "تعذر التطبيق", variant: "destructive" }),
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["storefront-accounts"] })
    void qc.invalidateQueries({ queryKey: ["credential-target-counts"] })
  }

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
    // Server-resolved: building this from the loaded rows silently skipped
    // everyone past the list's page cap.
    mutationFn: () => sendStorefrontCredentialsToAll(group),
    onSuccess: (r) => {
      toast({ title: `أُرسلت ${r.sent} من ${r.total}${r.failed ? ` — فشل ${r.failed}` : ""}` })
      refresh()
    },
    onError: (e) => toast({
      title: e instanceof Error ? e.message : "تعذر الإرسال الجماعي",
      variant: "destructive",
    }),
  })

  const inviteMut = useMutation({
    mutationFn: () => sendStorefrontInvitesToAll(group),
    onSuccess: (r) => {
      toast({ title: `أُرسلت الدعوة إلى ${r.sent} من ${r.total}${r.failed ? ` — فشل ${r.failed}` : ""}` })
      refresh()
    },
    onError: (e) => toast({
      title: e instanceof Error ? e.message : "تعذر إرسال الدعوات",
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
  const currentCount = totalForGroup

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
              <UserRound className="h-4 w-4" /> زبائن ({totals.customers})
            </button>
            <button onClick={() => setGroup("visitors")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition",
                group === "visitors" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}>
              <Users className="h-4 w-4" /> جدد بدون حساب ({totals.visitors})
            </button>
          </div>

          <Button
            onClick={() => setConfirmInvite(true)}
            disabled={inviteMut.isPending || currentCount === 0}
            className="w-full"
          >
            <Send className="ml-1 h-4 w-4" />
            {inviteMut.isPending
              ? "جاري الإرسال..."
              : `إرسال دعوة الحساب لكل ${group === "customers" ? "الزبائن" : "الجدد"} (${currentCount})`}
          </Button>

          <Button
            variant="outline"
            onClick={() => setConfirmBulk(true)}
            disabled={bulkMut.isPending || currentCount === 0}
            className="w-full"
          >
            {bulkMut.isPending
              ? "جاري الإرسال..."
              : `إرسال بيانات الدخول مباشرة (${currentCount})`}
          </Button>

          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            الإرسال المباشر يوصل فقط للأرقام الي راسلتك خلال آخر ٢٤ ساعة — ميتا تسقط الباقي بصمت.
            الدعوة تشتغل مع الكل: الزبون يرد بكلمة «حسابي» ويوصله رمزه فوراً.
          </p>

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

      {/* Login + pricing rules for the whole shop */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-5 w-5 text-slate-600" />
            قواعد الدخول والأسعار
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
            <input type="checkbox" checked={requireLogin}
              onChange={(e) => settingsMut.mutate({ catalogRequireLogin: e.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 accent-slate-700" />
            <span>
              <span className="block text-sm font-bold text-slate-800">إلزام تسجيل الدخول</span>
              <span className="block text-xs text-slate-500">
                ما حد يتصفح المتجر بدون حساب. لما يكون مطفي، يبقى التصفح المفتوح حسب إعداد رمز التحقق.
              </span>
            </span>
          </label>

          <div className="rounded-xl border border-slate-200 p-3">
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={pricesVisible}
                onChange={(e) => settingsMut.mutate({ catalogPricesVisibleByDefault: e.target.checked })}
                className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
              <span>
                <span className="block text-sm font-bold text-slate-800">إظهار الأسعار لكل الزبائن</span>
                <span className="block text-xs text-slate-500">
                  الافتراضي لكل زبون مسجّل. مفتاح «إخفاء السعر» بجنب أي زبون يتجاوز هذا الإعداد له وحده.
                </span>
              </span>
            </label>
            <Button
              variant="outline"
              className="mt-2 w-full"
              disabled={applyDefaultMut.isPending}
              onClick={() => applyDefaultMut.mutate()}
            >
              <RotateCcw className="ml-1 h-4 w-4" />
              {applyDefaultMut.isPending ? "جاري التطبيق..." : "طبّق على الزبائن الحاليين الآن"}
            </Button>
            <p className="mt-1 text-[11px] text-slate-400">
              بدون هذا الزر، التغيير يوصل الزبون عند تسجيل دخوله الجاي فقط.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Credentials message */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-5 w-5 text-emerald-600" />
            نص رسالة بيانات الدخول
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <button
            onClick={() => setShowTemplate((v) => !v)}
            className="w-full rounded-xl bg-slate-100 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            {showTemplate ? "إخفاء المحرر" : "تعديل نص الرسالة"}
          </button>

          {showTemplate && (
            <>
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                المتغيرات المتاحة: <code>{"{{customerName}}"}</code> <code>{"{{storeName}}"}</code>{" "}
                <code>{"{{username}}"}</code> <code>{"{{code}}"}</code> <code>{"{{link}}"}</code>
                <br />
                اتركه فارغ لاستخدام النص الافتراضي.
              </p>
              <textarea
                value={template}
                onChange={(e) => setTemplateDraft(e.target.value)}
                rows={9}
                dir="rtl"
                placeholder={DEFAULT_CREDENTIALS_TEMPLATE}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400"
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setTemplateDraft("")}
                >
                  استخدم النص الافتراضي
                </Button>
                <Button
                  className="flex-[2]"
                  disabled={settingsMut.isPending || templateDraft === null}
                  onClick={() => {
                    settingsMut.mutate({ storefrontCredentialsTemplate: template })
                    setTemplateDraft(null)
                  }}
                >
                  {settingsMut.isPending ? "جاري الحفظ..." : "حفظ نص الرسالة"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <StorefrontInviteCard />

      <MarketingOptOutCard />

      {/* Message a newly approved customer receives */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-5 w-5 text-amber-600" />
            نص رسالة الموافقة على زبون جديد
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
            هذي الرسالة اللي تنرسل للزبون أول ما توافق على طلبه. صار الرمز السري ينرسل معها
            بنفس الرسالة، حتى يقدر يدخل مباشرة بدون ما تحتاج ترسل له شي ثاني.
          </p>

          <button
            onClick={() => setShowApproved((v) => !v)}
            className="w-full rounded-xl bg-slate-100 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
          >
            {showApproved ? "إخفاء المحرر" : "تعديل نص الرسالة"}
          </button>

          {showApproved && (
            <>
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                المتغيرات المتاحة: <code>{"{{customerName}}"}</code> <code>{"{{storeName}}"}</code>{" "}
                <code>{"{{username}}"}</code> <code>{"{{code}}"}</code> <code>{"{{link}}"}</code>
                <br />
                اتركه فارغ لاستخدام النص الافتراضي.
              </p>
              <textarea
                value={approvedTemplate}
                onChange={(e) => setApprovedDraft(e.target.value)}
                rows={9}
                dir="rtl"
                placeholder={DEFAULT_APPROVED_TEMPLATE}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-amber-400"
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setApprovedDraft("")}>
                  استخدم النص الافتراضي
                </Button>
                <Button
                  className="flex-[2]"
                  disabled={settingsMut.isPending || approvedDraft === null}
                  onClick={() => {
                    settingsMut.mutate({ catalogAccessApprovedTemplate: approvedTemplate })
                    setApprovedDraft(null)
                  }}
                >
                  {settingsMut.isPending ? "جاري الحفظ..." : "حفظ نص الرسالة"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmInvite}
        title="إرسال دعوة الحساب"
        description={
          `راح تنرسل دعوة إلى ${currentCount} ` +
          `${group === "customers" ? "زبون" : "رقم"} تطلب منهم الرد بكلمة «حسابي». ` +
          "الرمز ما ينولّد الآن — يوصل لكل واحد لحظة ما يرد، وأرقامهم الحالية تبقى شغالة."
        }
        confirmLabel="إرسال الدعوة"
        loading={inviteMut.isPending}
        onConfirm={() => { setConfirmInvite(false); inviteMut.mutate() }}
        onCancel={() => setConfirmInvite(false)}
      />

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
