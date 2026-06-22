import { useMemo, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams } from "react-router-dom"
import {
  Bell,
  BellOff,
  CalendarClock,
  ChevronLeft,
  FileText,
  MessageCircle,
  PackageSearch,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Wallet,
  X,
} from "lucide-react"
import {
  getCustomerPortal,
  getPortalOrders,
  getPortalArrivalSubscriptions,
  subscribeToProductArrival,
  cancelArrivalSubscription,
  getVapidPublicKey,
} from "../api/endpoints"
import { fmt } from "../utils/fmt"
import type { CustomerTransaction, ArrivalSubscription } from "../types/api"
import { toast } from "../components/ui/use-toast"

function formatDate(value?: string | null) {
  if (!value) return "-"
  return new Date(value).toLocaleString("ar-IQ", { dateStyle: "short", timeStyle: "short" })
}

function rowColors(row: CustomerTransaction) {
  const type = row.type.toUpperCase()
  if (row.status === "CANCELLED")
    return { border: "border-rose-400", bg: "bg-rose-50", badge: "bg-rose-100 text-rose-700" }
  if (type === "RECEIPT" || type === "PAYMENT")
    return { border: "border-emerald-400", bg: "bg-emerald-50", badge: "bg-emerald-100 text-emerald-700" }
  return { border: "border-sky-400", bg: "bg-sky-50", badge: "bg-sky-100 text-sky-700" }
}

function typeLabel(row: CustomerTransaction) {
  const type = row.type.toUpperCase()
  if (row.status === "CANCELLED") return "فاتورة ملغاة"
  if (type === "RECEIPT") return "سند قبض"
  if (type === "PAYMENT") return "سند دفع"
  if (type === "EXPENSE") return "مصاريف"
  if (type === "SALE") return "فاتورة بيع"
  if (type === "PURCHASE") return "فاتورة شراء"
  if (type === "SALES_RETURN") return "فاتورة مرتجع"
  if (type.includes("INVOICE")) return Number(row.debit) > 0 ? "فاتورة بيع" : "فاتورة"
  return row.type
}

function isInvoiceRow(row: CustomerTransaction) {
  const t = row.type.toUpperCase()
  return (t === "SALE" || t === "PURCHASE" || t === "SALES_RETURN" || t.includes("INVOICE")) && row.status !== "CANCELLED"
}

function orderStatusLabel(s: string) {
  if (s === "PENDING") return { label: "قيد الانتظار", cls: "bg-amber-100 text-amber-700" }
  if (s === "PROCESSING") return { label: "جاري التجهيز", cls: "bg-blue-100 text-blue-700" }
  if (s === "PREPARED") return { label: "جاهز للاستلام", cls: "bg-emerald-100 text-emerald-700" }
  if (s === "CANCELLED") return { label: "ملغي", cls: "bg-rose-100 text-rose-700" }
  return { label: s, cls: "bg-slate-100 text-slate-600" }
}

type Tab = "statement" | "orders" | "arrivals"

async function registerPush(vapidKey: string): Promise<PushSubscriptionJSON | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null
  const perm = await Notification.requestPermission()
  if (perm !== "granted") return null
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKey,
    })
    return sub.toJSON()
  } catch {
    return null
  }
}

export function ClientPortalPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>("statement")
  const [showInquiry, setShowInquiry] = useState(false)
  const [inquiryText, setInquiryText] = useState("")
  const [arrivalProduct, setArrivalProduct] = useState("")
  const [notifLoading, setNotifLoading] = useState(false)

  const query = useQuery({
    queryKey: ["client-portal", token],
    queryFn: () => getCustomerPortal(token!),
    enabled: Boolean(token),
    retry: false,
  })

  const ordersQuery = useQuery({
    queryKey: ["portal-orders", token],
    queryFn: () => getPortalOrders(token!),
    enabled: Boolean(token) && tab === "orders",
    retry: false,
  })

  const arrivalsQuery = useQuery({
    queryKey: ["portal-arrivals", token],
    queryFn: () => getPortalArrivalSubscriptions(token!),
    enabled: Boolean(token) && tab === "arrivals",
    retry: false,
  })

  const cancelSubMutation = useMutation({
    mutationFn: (subId: string) => cancelArrivalSubscription(token!, subId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-arrivals", token] }),
  })

  const data = query.data
  const totals = useMemo(() => {
    const rows = data?.transactions ?? []
    return {
      debit: rows.reduce((s, r) => s + Number(r.debit ?? 0), 0),
      credit: rows.reduce((s, r) => s + Number(r.credit ?? 0), 0),
      count: rows.length,
    }
  }, [data?.transactions])

  // PDF download
  async function downloadPdf() {
    if (!data) return
    try {
      const { Document, Page, Text, View, StyleSheet, pdf } = await import("@react-pdf/renderer")
      const styles = StyleSheet.create({
        page: { padding: 24, fontFamily: "Helvetica", fontSize: 10, direction: "rtl" },
        header: { marginBottom: 16 },
        title: { fontSize: 18, fontWeight: "bold", marginBottom: 4 },
        sub: { fontSize: 10, color: "#64748b" },
        row: { flexDirection: "row-reverse", borderBottomWidth: 1, borderColor: "#e2e8f0", paddingVertical: 4 },
        cell: { flex: 1, textAlign: "right" },
        bold: { fontWeight: "bold" },
        balance: { marginTop: 12, flexDirection: "row-reverse", justifyContent: "space-between" },
      })
      const rows = data.transactions
      const doc = (
        <Document>
          <Page size="A4" style={styles.page}>
            <View style={styles.header}>
              <Text style={styles.title}>{data.storeName} — كشف حساب</Text>
              <Text style={styles.sub}>{data.customer.name}</Text>
              {data.customer.phone && <Text style={styles.sub}>{data.customer.phone}</Text>}
              <Text style={styles.sub}>تاريخ الطباعة: {new Date().toLocaleDateString("ar-IQ")}</Text>
            </View>
            <View style={[styles.row, { backgroundColor: "#f1f5f9" }]}>
              <Text style={[styles.cell, styles.bold]}>التاريخ</Text>
              <Text style={[styles.cell, styles.bold]}>النوع</Text>
              <Text style={[styles.cell, styles.bold]}>مدين</Text>
              <Text style={[styles.cell, styles.bold]}>دائن</Text>
              <Text style={[styles.cell, styles.bold]}>الرصيد</Text>
            </View>
            {rows.map((r) => (
              <View key={r.id} style={styles.row}>
                <Text style={styles.cell}>{String(r.date).slice(0, 10)}</Text>
                <Text style={styles.cell}>{typeLabel(r)}</Text>
                <Text style={styles.cell}>{r.debit ? fmt(Number(r.debit)) : ""}</Text>
                <Text style={styles.cell}>{r.credit ? fmt(Number(r.credit)) : ""}</Text>
                <Text style={styles.cell}>{fmt(Number(r.runningBalance ?? 0))}</Text>
              </View>
            ))}
            <View style={styles.balance}>
              <Text style={styles.bold}>الرصيد النهائي: {fmt(data.customer.currentBalance)} {data.currency}</Text>
            </View>
          </Page>
        </Document>
      )
      const blob = await pdf(doc).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${data.customer.name}-كشف-حساب.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: "تعذر إنشاء PDF", variant: "destructive" })
    }
  }

  async function handleArrivalSubscribe() {
    if (!arrivalProduct.trim()) return
    setNotifLoading(true)
    try {
      let pushSub: PushSubscriptionJSON | null = null
      const vapidKey = await getVapidPublicKey()
      if (vapidKey) {
        pushSub = await registerPush(vapidKey)
      }
      await subscribeToProductArrival(token!, null, arrivalProduct.trim(), pushSub)
      setArrivalProduct("")
      qc.invalidateQueries({ queryKey: ["portal-arrivals", token] })
      toast({ title: "تم تسجيل طلب الإشعار" })
    } catch {
      toast({ title: "تعذر التسجيل", variant: "destructive" })
    } finally {
      setNotifLoading(false)
    }
  }

  if (query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100" dir="rtl">
        <div className="text-center text-slate-500">
          <div className="mb-3 text-4xl">📋</div>
          <div>جاري تحميل البوابة...</div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4" dir="rtl">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm">
          <div className="mb-3 text-4xl">🔗</div>
          <div className="text-lg font-bold">الرابط غير صالح أو منتهي</div>
          <p className="mt-2 text-sm text-slate-500">اطلب رابطاً جديداً من المحاسب.</p>
        </div>
      </div>
    )
  }

  const balance = Number(data.customer.currentBalance)
  const isDebt = balance > 0

  return (
    <div className="min-h-screen bg-slate-100 pb-8" dir="rtl">
      {/* Header */}
      <div className="px-4 pb-4 pt-6 text-white" style={{ background: "linear-gradient(135deg, #1e293b, #334155)" }}>
        <div className="mx-auto max-w-lg">
          <div className="text-xs font-medium uppercase tracking-widest text-white/50">{data.storeName}</div>
          <h1 className="mt-0.5 text-2xl font-bold">{data.customer.name}</h1>
          {data.customer.phone && <p className="mt-0.5 text-sm text-white/70">{data.customer.phone}</p>}

          <div className={`mt-3 inline-flex flex-col rounded-xl px-5 py-3 ${isDebt ? "bg-rose-500/90" : "bg-emerald-500/90"}`}>
            <span className="text-[11px] font-medium text-white/80">الرصيد الحالي</span>
            <span className="text-2xl font-bold">{fmt(balance)} {data.currency}</span>
            <span className="text-[11px] text-white/70">{isDebt ? "مستحق عليك" : "رصيد لصالحك"}</span>
          </div>

          {/* Action buttons */}
          <div className="mt-3 flex gap-2">
            <button
              onClick={downloadPdf}
              className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-medium text-white hover:bg-white/25 active:bg-white/30"
            >
              <FileText className="h-3.5 w-3.5" />
              تحميل PDF
            </button>
            {data.storePhone && (
              <button
                onClick={() => setShowInquiry(true)}
                className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-xs font-medium text-white hover:bg-white/25 active:bg-white/30"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                استفسار
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inquiry modal */}
      {showInquiry && data.storePhone && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4" dir="rtl">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold text-slate-800">أرسل استفسار</h2>
              <button onClick={() => setShowInquiry(false)}><X className="h-5 w-5 text-slate-400" /></button>
            </div>
            <textarea
              value={inquiryText}
              onChange={(e) => setInquiryText(e.target.value)}
              placeholder="اكتب استفسارك هنا..."
              className="w-full rounded-lg border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
              rows={4}
              dir="rtl"
            />
            <div className="mt-3 flex gap-2">
              <a
                href={`https://wa.me/${data.storePhone.replace(/\D/g, "")}?text=${encodeURIComponent(`مرحبا، أنا ${data.customer.name}.\n${inquiryText}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 rounded-lg bg-emerald-500 py-2.5 text-center text-sm font-semibold text-white hover:bg-emerald-600"
                onClick={() => setShowInquiry(false)}
              >
                إرسال عبر واتساب
              </a>
              <button
                onClick={() => setShowInquiry(false)}
                className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm text-slate-600"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-lg px-3 pt-3">
        {/* Metrics */}
        <div className="mb-3 grid grid-cols-2 gap-2">
          <MetricCard icon={<Wallet className="h-4 w-4" />} label="رصيد افتتاحي" value={`${fmt(data.customer.openingBalance)} ${data.currency}`} />
          <MetricCard icon={<FileText className="h-4 w-4" />} label="عدد الحركات" value={String(totals.count)} />
          <MetricCard icon={<CalendarClock className="h-4 w-4" />} label="آخر حركة" value={formatDate(data.customer.lastTransactionAt)} small />
          <MetricCard icon={<ReceiptText className="h-4 w-4" />} label="انتهاء الرابط" value={formatDate(data.expiresAt)} small />
        </div>

        {/* Tabs */}
        <div className="mb-3 flex rounded-xl bg-white p-1 shadow-sm">
          {(
            [
              { key: "statement", label: "كشف الحساب", icon: <ReceiptText className="h-4 w-4" /> },
              { key: "orders", label: "طلباتي", icon: <ShoppingBag className="h-4 w-4" /> },
              { key: "arrivals", label: "إشعار وصول", icon: <Bell className="h-4 w-4" /> },
            ] as { key: Tab; label: string; icon: ReactNode }[]
          ).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors ${
                tab === key ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Tab: Statement */}
        {tab === "statement" && (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold text-slate-800">حركات الحساب</h2>
            </div>
            {data.transactions.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">لا توجد حركات بعد</div>
            ) : (
              <div className="divide-y">
                {data.transactions.map((row) => {
                  const clickable = isInvoiceRow(row)
                  const { border, bg, badge } = rowColors(row)
                  const debit = Number(row.debit ?? 0)
                  const credit = Number(row.credit ?? 0)
                  const running = Number(row.runningBalance ?? 0)
                  return (
                    <div
                      key={`${row.id}-${row.type}`}
                      className={`border-r-4 ${border} ${bg} p-3 ${clickable ? "cursor-pointer active:brightness-95" : ""}`}
                      onClick={clickable ? () => navigate(`/client/${token}/invoice/${row.id}`) : undefined}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge}`}>{typeLabel(row)}</span>
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-xs text-slate-500">{row.referenceNumber}</span>
                          {clickable && <ChevronLeft className="h-3.5 w-3.5 text-slate-400" />}
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-end justify-between">
                        <span className="text-xs text-slate-500">{formatDate(row.date)}</span>
                        <div className="text-right">
                          <div className="text-[10px] text-slate-400">الرصيد</div>
                          <div className={`text-sm font-bold ${running > 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmt(running)}</div>
                        </div>
                      </div>
                      {(debit > 0 || credit > 0) && (
                        <div className="mt-1.5 flex gap-4 border-t border-black/5 pt-1.5 text-xs">
                          {debit > 0 && <span>مدين: <span className="font-semibold text-rose-600">{fmt(debit)}</span></span>}
                          {credit > 0 && <span>دائن: <span className="font-semibold text-emerald-600">{fmt(credit)}</span></span>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab: Orders */}
        {tab === "orders" && (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold text-slate-800">طلباتي السابقة</h2>
            </div>
            {ordersQuery.isLoading && (
              <div className="py-10 text-center text-sm text-slate-400">جاري التحميل...</div>
            )}
            {!ordersQuery.isLoading && (ordersQuery.data ?? []).length === 0 && (
              <div className="py-10 text-center text-sm text-slate-400">
                <ShoppingBag className="mx-auto mb-2 h-8 w-8 opacity-30" />
                لا توجد طلبات بعد
              </div>
            )}
            <div className="divide-y">
              {(ordersQuery.data ?? []).map((order) => {
                const { label, cls } = orderStatusLabel(order.status)
                return (
                  <div key={order.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-slate-800">طلب #{order.orderNumber}</div>
                        <div className="mt-0.5 text-xs text-slate-500">{formatDate(order.createdAt)}</div>
                      </div>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
                    </div>
                    {/* Items */}
                    <div className="mt-2 space-y-1">
                      {(order.items as { name: string; quantity: number; unitPrice: number }[]).slice(0, 3).map((item, i) => (
                        <div key={i} className="flex justify-between text-xs text-slate-600">
                          <span>{item.name}</span>
                          <span>{item.quantity} × {fmt(item.unitPrice)}</span>
                        </div>
                      ))}
                      {order.items.length > 3 && (
                        <div className="text-xs text-slate-400">+{order.items.length - 3} منتجات أخرى</div>
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
                      <span className="text-xs text-slate-500">الإجمالي</span>
                      <span className="font-bold text-slate-800">{fmt(order.total)} {data.currency}</span>
                    </div>
                    {/* Re-order button */}
                    {data.storePhone && (
                      <a
                        href={`https://wa.me/${data.storePhone.replace(/\D/g, "")}?text=${encodeURIComponent(
                          `مرحبا، أريد إعادة طلب مشترياتي من الطلب رقم #${order.orderNumber}:\n` +
                          (order.items as { name: string; quantity: number }[])
                            .map((i) => `- ${i.name} × ${i.quantity}`)
                            .join("\n")
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-50 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        اطلب مرة ثانية
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Tab: Arrivals */}
        {tab === "arrivals" && (
          <div className="space-y-3">
            {/* Subscribe form */}
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="mb-3 font-semibold text-slate-800">أشعرني عند وصول منتج</h2>
              <p className="mb-3 text-xs text-slate-500">
                اكتب اسم المنتج الذي تريد وصوله وسنرسل لك إشعاراً فور توفره.
              </p>
              <div className="flex gap-2">
                <input
                  value={arrivalProduct}
                  onChange={(e) => setArrivalProduct(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleArrivalSubscribe()}
                  placeholder="اسم المنتج..."
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                  dir="rtl"
                />
                <button
                  onClick={handleArrivalSubscribe}
                  disabled={notifLoading || !arrivalProduct.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  <Bell className="h-4 w-4" />
                  {notifLoading ? "..." : "سجّل"}
                </button>
              </div>
            </div>

            {/* Active subscriptions */}
            <div className="overflow-hidden rounded-xl bg-white shadow-sm">
              <div className="border-b px-4 py-3">
                <h3 className="font-semibold text-slate-800">طلبات الإشعار النشطة</h3>
              </div>
              {arrivalsQuery.isLoading && (
                <div className="py-6 text-center text-sm text-slate-400">جاري التحميل...</div>
              )}
              {!arrivalsQuery.isLoading && (arrivalsQuery.data ?? []).length === 0 && (
                <div className="py-8 text-center text-sm text-slate-400">
                  <PackageSearch className="mx-auto mb-2 h-8 w-8 opacity-30" />
                  لا توجد طلبات إشعار
                </div>
              )}
              <div className="divide-y">
                {(arrivalsQuery.data ?? []).map((sub: ArrivalSubscription) => (
                  <div key={sub.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <BellOff className="h-4 w-4 shrink-0 text-amber-500" />
                      <div>
                        <div className="text-sm font-medium text-slate-800">{sub.productName}</div>
                        <div className="text-xs text-slate-400">منذ {formatDate(sub.createdAt)}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => cancelSubMutation.mutate(sub.id)}
                      className="rounded-lg border border-rose-200 p-1.5 text-rose-500 hover:bg-rose-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="mt-4 text-center text-xs text-slate-400">
          هذا الرابط للعرض فقط.{" "}
          <Link className="underline" to="/login">دخول الإدارة</Link>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ icon, label, value, small }: {
  icon: ReactNode; label: string; value: string; small?: boolean
}) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">{icon}<span>{label}</span></div>
      <div className={`mt-1 font-bold ${small ? "text-sm" : "text-base"}`}>{value}</div>
    </div>
  )
}
