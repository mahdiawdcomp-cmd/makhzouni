import { useMemo, useState } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  ArrowRight,
  Ban,
  FileDown,
  ImageDown,
  MessageCircle,
  Pencil,
  Receipt,
  ReceiptText,
  RefreshCw,
  Trash2,
  Wallet,
} from "lucide-react"
import {
  cancelVoucher as cancelVoucherApi,
  deleteVoucher as deleteVoucherApi,
  getCustomerTransactions,
  getVoucher,
  getVouchers,
  restoreVoucher as restoreVoucherApi,
  sendVoucherPdfWhatsapp,
  updateVoucher,
  voucherImageObjectUrl,
  voucherPdfObjectUrl,
  type WhatsAppSendChannel,
} from "../api/endpoints"
import { apiErrorMessage } from "../utils/apiError"
import { WhatsAppChannelDialog } from "../components/WhatsAppChannelDialog"
import type { Voucher } from "../types/api"
import { useSettings } from "../hooks/useSettings"
import { READ_ONLY_MESSAGE, useFeatureEnabled, useReadOnly } from "../hooks/useTenantConfig"
import { fillTemplate } from "../utils/whatsapp"
import { fmt } from "../utils/fmt"
import { Button } from "../components/ui/button"
import { RecordNavigator } from "../components/RecordNavigator"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"

function money(value: number | undefined) {
  return fmt(value)
}

const typeMeta: Record<Voucher["type"], { label: string; bg: string; icon: typeof Receipt }> = {
  RECEIPT: { label: "سند قبض", bg: "from-emerald-500 to-emerald-600", icon: Receipt },
  PAYMENT: { label: "سند دفع", bg: "from-orange-500 to-orange-600", icon: ReceiptText },
  EXPENSE: { label: "مصاريف", bg: "from-rose-500 to-rose-600", icon: Wallet },
}

const DEFAULT_TEMPLATE =
  "مرحباً {{customerName}}،\nاستلمنا منكم {{amount}} {{currency}} بسند رقم {{voucherNumber}} بتاريخ {{date}}.\nحسابكم السابق: {{previousBalance}} {{currency}}\nالحساب الحالي: {{currentBalance}} {{currency}}.\nشكراً، {{storeName}}."

export function VoucherDetailPage() {
  const { id } = useParams()
  const readOnly = useReadOnly()
  const whatsappVouchersEnabled = useFeatureEnabled("whatsappVouchers")
  const navigate = useNavigate()
  const qc = useQueryClient()
  const voucherQuery = useQuery({ queryKey: ["vouchers", id], queryFn: () => getVoucher(id!), enabled: !!id })
  const voucher = voucherQuery.data

  const voucherTypeLabel = voucher?.type === "RECEIPT" ? "سند قبض" : "سند دفع"
  const partyName = voucher?.customer?.name ?? ""
  usePageTitle(voucher ? `${voucherTypeLabel}${partyName ? ` (${partyName})` : ""}` : "تحميل السند...")
  const listQuery = useQuery({ queryKey: ["vouchers", "all-for-nav"], queryFn: () => getVouchers() })
  const transactionsQuery = useQuery({
    queryKey: ["transactions", voucher?.customer?.id],
    queryFn: () => getCustomerTransactions(voucher!.customer!.id),
    enabled: !!voucher?.customer?.id,
  })
  const settingsQuery = useSettings()
  const settings = settingsQuery.data

  const sorted = useMemo(
    () => [...(listQuery.data ?? [])].sort((a, b) => {
      const difference = new Date(a.createdAt ?? a.date).getTime() - new Date(b.createdAt ?? b.date).getTime()
      return difference || a.id.localeCompare(b.id)
    }),
    [listQuery.data],
  )

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const cancelMutation = useMutation({
    mutationFn: () => cancelVoucherApi(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vouchers"] })
      void qc.invalidateQueries({ queryKey: ["customers"] })
      void qc.invalidateQueries({ queryKey: ["customer"] })
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "تعذر تعطيل السند", variant: "destructive" }),
  })

  const restoreMutation = useMutation({
    mutationFn: () => restoreVoucherApi(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vouchers"] })
      void qc.invalidateQueries({ queryKey: ["customers"] })
      void qc.invalidateQueries({ queryKey: ["customer"] })
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "تعذر استعادة السند", variant: "destructive" }),
  })
  const [editAmountDisplay, setEditAmountDisplay] = useState("")
  const [editNotes, setEditNotes] = useState("")
  const [editDescription, setEditDescription] = useState("")

  function fmtNumInput(raw: string): string {
    const digits = raw.replace(/[^0-9]/g, "")
    if (!digits) return ""
    return Number(digits).toLocaleString("en-US")
  }

  const editMutation = useMutation({
    mutationFn: () =>
      updateVoucher(id!, {
        amount: Number(editAmountDisplay.replace(/,/g, "")),
        notes: editNotes || undefined,
        description: editDescription || undefined,
      }),
    onSuccess: () => {
      setEditOpen(false)
      void qc.invalidateQueries({ queryKey: ["vouchers"] })
      void qc.invalidateQueries({ queryKey: ["customers"] })
      void qc.invalidateQueries({ queryKey: ["customer"] })
      void qc.invalidateQueries({ queryKey: ["transactions"] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteVoucherApi(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vouchers"] })
      void qc.invalidateQueries({ queryKey: ["customers"] })
      void qc.invalidateQueries({ queryKey: ["customer"] })
      void qc.invalidateQueries({ queryKey: ["transactions"] })
      navigate(-1)
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "تعذر حذف السند", variant: "destructive" }),
  })

  function openEdit() {
    if (!voucher) return
    setEditAmountDisplay(Number(voucher.amount).toLocaleString("en-US"))
    setEditNotes(voucher.notes ?? "")
    setEditDescription(voucher.description ?? "")
    setEditOpen(true)
  }

  const [waSending, setWaSending] = useState(false)
  const [waChannelOpen, setWaChannelOpen] = useState(false)
  function buildVoucherMessage() {
    if (!voucher) return ""
    // Sign convention (matches getCustomerBalance on the backend): RECEIPT
    // reduces what the customer owes, PAYMENT increases it — so "before this
    // voucher" is the opposite adjustment of what currentBalance already reflects.
    const currentBalance = Number(voucher.customer?.currentBalance ?? 0)
    const previousBalance = currentBalance + (voucher.type === "RECEIPT" ? Number(voucher.amount) : -Number(voucher.amount))
    const tpl = settings?.voucherTemplate || DEFAULT_TEMPLATE
    return fillTemplate(tpl, {
      customerName: voucher.customer?.name ?? "",
      voucherNumber: voucher.voucherNumber,
      amount: money(voucher.amount),
      date: String(voucher.date).slice(0, 10),
      previousBalance: money(previousBalance),
      currentBalance: money(voucher.customer?.currentBalance),
      currency: settings?.currency ?? "د.ع",
      storeName: settings?.storeName ?? "",
    })
  }
  function openWaChannel() {
    if (!voucher) return
    if (voucher.type === "EXPENSE") {
      toast({ title: "سندات المصاريف داخلية ولا ترسل عبر واتساب.", variant: "destructive" })
      return
    }
    if (!voucher.customer?.phone) { toast({ title: "رقم الهاتف غير متوفر.", variant: "destructive" }); return }
    setWaChannelOpen(true)
  }
  async function sendWhatsApp(channel: WhatsAppSendChannel) {
    if (!voucher) return
    const phone = voucher.customer?.phone
    if (!phone) { toast({ title: "رقم الهاتف غير متوفر.", variant: "destructive" }); return }
    const msg = buildVoucherMessage()
    setWaSending(true)
    try {
      // Server generates the voucher PDF and attaches it as the Meta template's
      // document header (falls back to a plain PDF send if the template call
      // fails) — bodyParams are built server-side from the same balance snapshot
      // used to render the PDF, so the numbers always match.
      await sendVoucherPdfWhatsapp(voucher.id, msg, channel)
      setWaChannelOpen(false)
      toast({ title: "✓ تم إرسال السند عبر واتساب." })
    } catch (err) {
      toast({ title: "✗ تعذر الإرسال.", description: apiErrorMessage(err, "تحقق من إعدادات واتساب"), variant: "destructive" })
    } finally {
      setWaSending(false)
    }
  }

  if (voucherQuery.isLoading) return <div className="text-sm text-slate-500">جاري التحميل...</div>
  if (!voucher) return <div className="text-sm text-slate-500">السند غير موجود.</div>

  const meta = typeMeta[voucher.type]
  const Icon = meta.icon

  return (
    <div className="space-y-4">
      <Button variant="ghost" className="px-0" onClick={() => history.length > 1 ? navigate(-1) : navigate("/vouchers")}>
        <ArrowRight className="h-4 w-4" /> رجوع
      </Button>

      <div className={`rounded-xl bg-gradient-to-l ${meta.bg} p-5 text-white shadow-sm`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Icon className="h-7 w-7" />
            <div>
              <h1 className="text-xl font-bold">{meta.label} {voucher.voucherNumber}</h1>
              <p className="text-sm opacity-90">
                {String(voucher.date).slice(0, 10)} - <span className="text-base font-bold">{voucher.customer?.name ?? voucher.description ?? "-"}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <RecordNavigator currentId={id} orderedIds={sorted.map((row) => row.id)} onNavigate={(target) => navigate(`/vouchers/${target}`)} noun="سند" tone="dark" />

            {voucher.type !== "EXPENSE" && whatsappVouchersEnabled ? (
              <Button variant="outline" className="bg-white/95 hover:bg-white" onClick={openWaChannel} disabled={readOnly || waSending} title={readOnly ? READ_ONLY_MESSAGE : undefined}>
                <MessageCircle className="h-4 w-4 text-emerald-600" /> {waSending ? "جاري الإرسال..." : "واتساب"}
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="bg-white/95 hover:bg-white"
              onClick={async () => {
                const url = await voucherPdfObjectUrl(voucher.id)
                window.open(url, "_blank", "noopener,noreferrer")
                setTimeout(() => URL.revokeObjectURL(url), 60000)
              }}
            >
              <FileDown className="h-4 w-4" /> PDF
            </Button>
            <Button
              variant="outline"
              className="bg-white/95 hover:bg-white"
              onClick={async () => {
                const url = await voucherImageObjectUrl(voucher.id)
                window.open(url, "_blank", "noopener,noreferrer")
                setTimeout(() => URL.revokeObjectURL(url), 60000)
              }}
            >
              <ImageDown className="h-4 w-4" /> صورة
            </Button>
            <Button variant="outline" className="bg-white/95 hover:bg-white" onClick={openEdit}>
              <Pencil className="h-4 w-4" /> تعديل
            </Button>
            {voucher.cancelledAt ? (
              <>
                <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">معطل</span>
                <Button
                  variant="outline"
                  className="bg-white/95 hover:bg-white"
                  onClick={() => setConfirmRestore(true)}
                  disabled={restoreMutation.isPending}
                >
                  <RefreshCw className="h-4 w-4" /> استعادة
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                className="bg-white/95 hover:bg-white border-amber-300 text-amber-700"
                onClick={() => setConfirmCancel(true)}
                disabled={readOnly || cancelMutation.isPending}
                title={readOnly ? READ_ONLY_MESSAGE : undefined}
              >
                <Ban className="h-4 w-4" /> تعطيل
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={readOnly || deleteMutation.isPending}
              title={readOnly ? READ_ONLY_MESSAGE : undefined}
            >
              <Trash2 className="h-4 w-4" /> حذف نهائي
            </Button>
          </div>
        </div>
      </div>

      {/* ── قصة الحساب: قبل السند ← مبلغ السند ← الباقي بعده ─────────────── */}
      {voucher.customer ? (
        (() => {
          const cur = settings?.currency ?? "د.ع"
          const txs = transactionsQuery.data ?? []
          // Match by voucher id (most reliable) OR by voucherNumber as referenceNumber
          const txIndex = txs.findIndex((t) => t.id === voucher.id || t.referenceNumber === voucher.voucherNumber)
          const thisTx = txIndex >= 0 ? txs[txIndex] : null

          const isReceipt = voucher.type === "RECEIPT"
          const amt = Number(voucher.amount)
          const currentBalance = Number(voucher.customer?.currentBalance ?? 0)

          let balanceAfter: number
          let balanceBefore: number
          if (thisTx) {
            // Exact: balance before = runningBalance reversed by this transaction
            balanceAfter = thisTx.runningBalance
            balanceBefore = balanceAfter + (thisTx.credit ?? 0) - (thisTx.debit ?? 0)
          } else {
            // Approximate (only exact if this was the last transaction)
            balanceAfter = currentBalance
            balanceBefore = isReceipt ? currentBalance + amt : currentBalance - amt
          }

          const settled = Math.abs(balanceAfter) < 0.01
          const word = (v: number) => (v > 0 ? "عليه" : v < 0 ? "له" : "")

          return (
            <div className="mx-auto w-full max-w-xl space-y-3">
              {/* من / إلى */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-center dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs font-semibold text-slate-400">
                  {voucher.type === "PAYMENT" ? "دفعنا إلى السيد / السادة" : "استلمنا من السيد / السادة"}
                </p>
                <Link to={`/customers/${voucher.customer.id}`} className="mt-1 block text-2xl font-extrabold text-slate-800 hover:text-emerald-700 dark:text-slate-100">
                  {voucher.customer.name}
                </Link>
                {voucher.customer.phone ? <p className="mt-0.5 text-xs text-slate-400" dir="ltr">{voucher.customer.phone}</p> : null}
              </div>

              {/* الخطوة 1: قبل السند */}
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-700 dark:bg-slate-900/60">
                <span className="text-sm font-bold text-slate-500">{isReceipt ? "كان بذمته قبل السند" : "الحساب قبل السند"}</span>
                <span className="text-xl font-extrabold text-slate-600 dark:text-slate-300">
                  {money(Math.abs(balanceBefore))} {cur} <span className="text-sm font-bold text-slate-400">{word(balanceBefore)}</span>
                </span>
              </div>

              {/* الخطوة 2: مبلغ السند */}
              <div className="flex items-center justify-between rounded-2xl border-2 border-emerald-300 bg-emerald-50 px-5 py-5 dark:border-emerald-700 dark:bg-emerald-950/30">
                <span className="text-base font-extrabold text-emerald-700 dark:text-emerald-300">{isReceipt ? "استلمنا منه" : "دفعنا له"}</span>
                <span className="text-3xl font-extrabold text-emerald-700 dark:text-emerald-300">{money(amt)} {cur}</span>
              </div>

              {/* الخطوة 3: بعد السند */}
              <div className={`flex items-center justify-between rounded-2xl border-2 px-5 py-5 ${
                settled
                  ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30"
                  : "border-orange-300 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30"
              }`}>
                <span className={`text-base font-extrabold ${settled ? "text-emerald-700 dark:text-emerald-300" : "text-orange-800 dark:text-orange-300"}`}>
                  {isReceipt ? "الباقي بذمته بعد السند" : "الحساب بعد السند"}
                </span>
                <span className={`text-3xl font-extrabold ${settled ? "text-emerald-700 dark:text-emerald-300" : "text-orange-800 dark:text-orange-300"}`}>
                  {settled ? "صفر ✓" : <>{money(Math.abs(balanceAfter))} {cur} <span className="text-base">{word(balanceAfter)}</span></>}
                </span>
              </div>
              {settled ? (
                <p className="text-center text-sm font-bold text-emerald-600">تمت تسوية الحساب بالكامل — الذمة مبرأة ✓</p>
              ) : null}
              {!thisTx && transactionsQuery.isSuccess ? (
                <p className="text-center text-[11px] text-amber-600">الأرقام تقديرية بناءً على الرصيد الحالي</p>
              ) : null}
              {voucher.cancelledAt ? (
                <p className="rounded-lg bg-rose-50 py-2 text-center text-sm font-bold text-rose-600 dark:bg-rose-950/30">هذا السند معطل — لا يؤثر على الرصيد</p>
              ) : null}

              {/* التفاصيل */}
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                  <Row label="رقم السند" value={voucher.voucherNumber} />
                  <Row label="التاريخ" value={String(voucher.date).slice(0, 10)} />
                  <Row label="النوع" value={meta.label} />
                  <Row label="الرصيد الحالي" value={`${money(voucher.customer.currentBalance)} ${cur}`} strong />
                </div>
                {voucher.notes ? <div className="mt-2 border-t border-dashed pt-2 text-slate-500 dark:border-slate-700">ملاحظات: {voucher.notes}</div> : null}
                <Button asChild variant="outline" className="mt-3 w-full">
                  <Link to={`/customers/${voucher.customer.id}`}>عرض كشف الزبون الكامل</Link>
                </Button>
              </div>
            </div>
          )
        })()
      ) : (
        <div className="mx-auto w-full max-w-xl space-y-3">
          <div className="flex items-center justify-between rounded-2xl border-2 border-rose-300 bg-rose-50 px-5 py-5 dark:border-rose-800 dark:bg-rose-950/30">
            <span className="text-base font-extrabold text-rose-700 dark:text-rose-300">مبلغ المصروف</span>
            <span className="text-3xl font-extrabold text-rose-700 dark:text-rose-300">{money(voucher.amount)} {settings?.currency ?? "د.ع"}</span>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              <Row label="رقم السند" value={voucher.voucherNumber} />
              <Row label="التاريخ" value={String(voucher.date).slice(0, 10)} />
              {voucher.description ? <Row label="الوصف" value={voucher.description} /> : null}
            </div>
            {voucher.notes ? <div className="mt-2 border-t border-dashed pt-2 text-slate-500 dark:border-slate-700">ملاحظات: {voucher.notes}</div> : null}
            <p className="mt-2 text-xs text-slate-400">سند مصاريف داخلي — لا يرتبط بزبون.</p>
          </div>
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>تعديل السند</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input
              inputMode="numeric"
              value={editAmountDisplay}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setEditAmountDisplay(fmtNumInput(e.target.value))}
              placeholder="المبلغ"
              dir="ltr"
            />
            {voucher.type === "EXPENSE" ? (
              <Input
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="نوع المصروف"
              />
            ) : null}
            <Input
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              placeholder="ملاحظات"
            />
            <Button className="w-full" onClick={() => editMutation.mutate()} disabled={editMutation.isPending}>
              حفظ التعديلات
            </Button>
            {editMutation.isError ? (
              <div className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
                {editMutation.error instanceof Error ? editMutation.error.message : "تعذر التعديل"}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmCancel}
        title="تعطيل هذا السند؟"
        description="سيتم إلغاء تأثيره على حساب الزبون. يمكن استعادته لاحقاً."
        confirmLabel="تعطيل"
        destructive
        loading={cancelMutation.isPending}
        onConfirm={() => { setConfirmCancel(false); cancelMutation.mutate() }}
        onCancel={() => setConfirmCancel(false)}
      />
      <ConfirmDialog
        open={confirmRestore}
        title="استعادة هذا السند؟"
        description="سيعود تأثيره على حساب الزبون."
        confirmLabel="استعادة"
        loading={restoreMutation.isPending}
        onConfirm={() => { setConfirmRestore(false); restoreMutation.mutate() }}
        onCancel={() => setConfirmRestore(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="حذف هذا السند نهائياً؟"
        description="سيُحذف من قاعدة البيانات ولا يمكن التراجع عن هذا الإجراء."
        confirmLabel="حذف نهائي"
        destructive
        loading={deleteMutation.isPending}
        onConfirm={() => { setConfirmDelete(false); deleteMutation.mutate() }}
        onCancel={() => setConfirmDelete(false)}
      />
      <WhatsAppChannelDialog
        open={waChannelOpen}
        onClose={() => setWaChannelOpen(false)}
        sending={waSending}
        phone={voucher.customer?.phone}
        webMessage={buildVoucherMessage()}
        title="إرسال السند عبر واتساب"
        onSend={(channel) => void sendWhatsApp(channel)}
      />
    </div>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? "font-bold" : "font-medium"}>{value}</span>
    </div>
  )
}
