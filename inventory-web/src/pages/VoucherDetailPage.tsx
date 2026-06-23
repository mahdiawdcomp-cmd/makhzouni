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
  sendWhatsAppMessage,
  updateVoucher,
  voucherImageObjectUrl,
  voucherPdfObjectUrl,
} from "../api/endpoints"
import type { Voucher } from "../types/api"
import { useSettings } from "../hooks/useSettings"
import { fillTemplate, normalizePhone } from "../utils/whatsapp"
import { fmt } from "../utils/fmt"
import { Button } from "../components/ui/button"
import { RecordNavigator } from "../components/RecordNavigator"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
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
  "مرحباً {{customerName}}،\nاستلمنا منكم {{amount}} {{currency}} بسند رقم {{voucherNumber}} بتاريخ {{date}}.\nشكراً، {{storeName}}."

export function VoucherDetailPage() {
  const { id } = useParams()
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
  })

  const restoreMutation = useMutation({
    mutationFn: () => restoreVoucherApi(id!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vouchers"] })
      void qc.invalidateQueries({ queryKey: ["customers"] })
      void qc.invalidateQueries({ queryKey: ["customer"] })
    },
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
  })

  function openEdit() {
    if (!voucher) return
    setEditAmountDisplay(Number(voucher.amount).toLocaleString("en-US"))
    setEditNotes(voucher.notes ?? "")
    setEditDescription(voucher.description ?? "")
    setEditOpen(true)
  }

  const [waSending, setWaSending] = useState(false)
  async function sendWhatsApp() {
    if (!voucher) return
    if (voucher.type === "EXPENSE") {
      toast({ title: "سندات المصاريف داخلية ولا ترسل عبر واتساب.", variant: "destructive" })
      return
    }
    const phone = voucher.customer?.phone
    if (!phone) { toast({ title: "رقم الهاتف غير متوفر.", variant: "destructive" }); return }
    const tpl = settings?.voucherTemplate || DEFAULT_TEMPLATE
    const msg = fillTemplate(tpl, {
      customerName: voucher.customer?.name ?? "",
      voucherNumber: voucher.voucherNumber,
      amount: money(voucher.amount),
      date: String(voucher.date).slice(0, 10),
      currentBalance: money(voucher.customer?.currentBalance),
      currency: settings?.currency ?? "د.ع",
      storeName: settings?.storeName ?? "",
    })
    setWaSending(true)
    try {
      await sendWhatsAppMessage({ phone: normalizePhone(phone), message: msg })
      toast({ title: "✓ تم إرسال السند عبر واتساب." })
    } catch {
      toast({ title: "✗ تعذر الإرسال. تحقق من إعدادات واتساب.", variant: "destructive" })
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

            {voucher.type !== "EXPENSE" ? (
              <Button variant="outline" className="bg-white/95 hover:bg-white" onClick={() => void sendWhatsApp()} disabled={waSending}>
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
                disabled={cancelMutation.isPending}
              >
                <Ban className="h-4 w-4" /> تعطيل
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4" /> حذف نهائي
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>التفاصيل</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="النوع" value={meta.label} />
            <Row label="المبلغ" value={money(voucher.amount) + " " + (settings?.currency ?? "د.ع")} strong />
            <Row label="التاريخ" value={String(voucher.date).slice(0, 10)} />
            <Row label="رقم السند" value={voucher.voucherNumber} />
            {voucher.description ? <Row label="الوصف" value={voucher.description} /> : null}
            {voucher.notes ? <Row label="ملاحظات" value={voucher.notes} /> : null}
          </CardContent>
        </Card>

        {voucher.customer ? (
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle>الزبون</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="الاسم" value={voucher.customer.name} />
                <Row label="الهاتف" value={voucher.customer.phone ?? "-"} />
                <Row label="الرصيد الحالي" value={money(voucher.customer.currentBalance) + " " + (settings?.currency ?? "د.ع")} strong />
                <Button asChild variant="outline" className="mt-2">
                  <Link to={`/customers/${voucher.customer.id}`}>عرض كشف الزبون</Link>
                </Button>
              </CardContent>
            </Card>

            {/* Account summary for this voucher */}
            {(() => {
              const txs = transactionsQuery.data ?? []
              const thisTx = txs.find((t) => t.referenceNumber === voucher.voucherNumber || t.id === voucher.id)
              if (!thisTx) return null
              const txIndex = txs.indexOf(thisTx)
              const balanceAfter = thisTx.runningBalance
              const balanceBefore = balanceAfter - (thisTx.credit ?? 0) + (thisTx.debit ?? 0)
              const lastTx = txs[txIndex - 1]
              const cur = settings?.currency ?? "د.ع"
              return (
                <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20">
                  <CardHeader><CardTitle className="text-blue-800 dark:text-blue-200">ملخص الحساب</CardTitle></CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-white p-2 dark:bg-slate-900">
                        <div className="text-[11px] text-slate-500">قبل السند</div>
                        <div className={`mt-1 text-base font-bold ${balanceBefore > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {money(balanceBefore)} {cur}
                        </div>
                      </div>
                      <div className="rounded-lg bg-blue-100 p-2 dark:bg-blue-900/40">
                        <div className="text-[11px] text-blue-600">مبلغ السند</div>
                        <div className="mt-1 text-base font-bold text-blue-700 dark:text-blue-300">
                          {money(voucher.amount)} {cur}
                        </div>
                      </div>
                      <div className="rounded-lg bg-white p-2 dark:bg-slate-900">
                        <div className="text-[11px] text-slate-500">بعد السند</div>
                        <div className={`mt-1 text-base font-bold ${balanceAfter > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {money(balanceAfter)} {cur}
                        </div>
                      </div>
                    </div>
                    {lastTx && (
                      <div className="rounded-lg border border-slate-200 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                        <span className="text-slate-500">آخر تعامل قبله: </span>
                        <span className="font-semibold">{lastTx.referenceNumber}</span>
                        <span className="mx-1 text-slate-400">—</span>
                        <span>{String(lastTx.date).slice(0, 10)}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })()}
          </div>
        ) : (
          <Card>
            <CardHeader><CardTitle>ملاحظات</CardTitle></CardHeader>
            <CardContent className="text-sm text-slate-500">
              سند مصاريف داخلي - لا يرتبط بزبون.
            </CardContent>
          </Card>
        )}
      </div>

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
