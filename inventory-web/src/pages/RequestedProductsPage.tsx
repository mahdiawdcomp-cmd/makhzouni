import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Bell, CheckCircle2, Loader2, PackageSearch, Phone, RotateCcw, Trash2 } from "lucide-react"
import { usePageTitle } from "../hooks/usePageTitle"
import {
  deleteAiEscalation,
  deleteRequestedProduct,
  getAiEscalations,
  getRequestedProducts,
  markAiEscalationHandled,
  markRequestedProductHandled,
  reopenAiEscalation,
  reopenRequestedProduct,
  type AiEscalation,
  type RequestedProduct,
} from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { toast } from "../components/ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"

// «تنبيهات الموظف الذكي» — everything the WhatsApp agent needs a human for,
// in one place with its own unread count. Kept out of «الرسائل الواردة» on
// purpose: a real order does not belong in the same list as "شكرا".

function formatBaghdad(iso?: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short" })
}

type TabId = "escalations" | "products"
type StatusFilter = "OPEN" | "HANDLED"

export function RequestedProductsPage() {
  usePageTitle("تنبيهات الموظف الذكي")
  const qc = useQueryClient()
  const [tab, setTab] = useState<TabId>("escalations")
  const [status, setStatus] = useState<StatusFilter>("OPEN")
  const [busyId, setBusyId] = useState<string | null>(null)

  const escalations = useQuery({
    queryKey: ["ai-escalations", status],
    queryFn: () => getAiEscalations(status),
    refetchInterval: 30000,
  })
  const products = useQuery({
    queryKey: ["requested-products", status],
    queryFn: () => getRequestedProducts(status),
    refetchInterval: 60000,
  })

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["ai-escalations"] })
    void qc.invalidateQueries({ queryKey: ["requested-products"] })
    void qc.invalidateQueries({ queryKey: ["ai-alerts-open-count"] })
  }

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id)
    try {
      await action()
      invalidate()
    } catch (error) {
      toast({ title: apiErrorMessage(error), variant: "destructive" })
    } finally {
      setBusyId(null)
    }
  }

  const openEscalations = escalations.data?.length ?? 0
  const openProducts = products.data?.length ?? 0
  const isLoading = tab === "escalations" ? escalations.isLoading : products.isLoading

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Bell className="h-6 w-6 text-red-600" /> تنبيهات الموظف الذكي
        </h1>
        <p className="text-xs text-slate-500">كل شي يحتاج قرارك من محادثات الواتساب</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700">
        <div className="flex gap-1">
          <button onClick={() => setTab("escalations")}
            className={cn("flex items-center gap-2 rounded-t-lg px-3 py-2 text-sm", tab === "escalations" ? "border-b-2 border-red-600 font-semibold text-red-700" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}>
            طلبيات وتنبيهات
            {status === "OPEN" && openEscalations > 0 && (
              <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">{openEscalations}</span>
            )}
          </button>
          <button onClick={() => setTab("products")}
            className={cn("flex items-center gap-2 rounded-t-lg px-3 py-2 text-sm", tab === "products" ? "border-b-2 border-amber-600 font-semibold text-amber-700" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}>
            منتجات مطلوبة
            {status === "OPEN" && openProducts > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{openProducts}</span>
            )}
          </button>
        </div>
        <div className="flex gap-1 pb-1">
          {([["OPEN", "الجديدة"], ["HANDLED", "المعالجة"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setStatus(id)}
              className={cn("rounded-full px-3 py-1 text-xs", status === id ? "bg-slate-200 font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-100" : "text-slate-500")}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
      ) : tab === "escalations" ? (
        <EscalationList
          rows={escalations.data ?? []}
          status={status}
          busyId={busyId}
          onHandle={(id) => void run(id, () => markAiEscalationHandled(id))}
          onReopen={(id) => void run(id, () => reopenAiEscalation(id))}
          onDelete={(id, label) => {
            if (!window.confirm(`حذف «${label}» نهائياً؟`)) return
            void run(id, () => deleteAiEscalation(id))
          }}
        />
      ) : (
        <ProductList
          rows={products.data ?? []}
          status={status}
          busyId={busyId}
          onHandle={(id) => void run(id, () => markRequestedProductHandled(id))}
          onReopen={(id) => void run(id, () => reopenRequestedProduct(id))}
          onDelete={(id, label) => {
            if (!window.confirm(`حذف طلب «${label}» نهائياً؟`)) return
            void run(id, () => deleteRequestedProduct(id))
          }}
        />
      )}
    </div>
  )
}

function EscalationList({
  rows, status, busyId, onHandle, onReopen, onDelete,
}: {
  rows: AiEscalation[]
  status: StatusFilter
  busyId: string | null
  onHandle: (id: string) => void
  onReopen: (id: string) => void
  onDelete: (id: string, label: string) => void
}) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-slate-500">
        {status === "OPEN" ? "ماكو تنبيهات جديدة — كل شي تحت السيطرة 👌" : "ماكو تنبيهات معالجة"}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <Card key={row.id} className={status === "OPEN" ? "border-r-4 border-r-red-500" : undefined}>
          <CardContent className="space-y-2 p-3">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{row.summary}</p>
                <p className="mt-1 rounded bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  رسالة الزبون: {row.customerText || "—"}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {row.phone}</span>
                  {row.customerName && <span>· {row.customerName}</span>}
                  <span>· {formatBaghdad(row.createdAt)}</span>
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <a href={`https://wa.me/${row.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="text-emerald-700">رد بالواتساب</Button>
                </a>
                {status === "OPEN" ? (
                  <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => onHandle(row.id)}>
                    {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CheckCircle2 className="ml-1 h-3.5 w-3.5" /> تمت معالجته</>}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => onReopen(row.id)}>
                    {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><RotateCcw className="ml-1 h-3.5 w-3.5" /> إرجاعه</>}
                  </Button>
                )}
                <Button size="sm" variant="outline" className="text-red-600" disabled={busyId === row.id}
                  onClick={() => onDelete(row.id, row.summary)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function ProductList({
  rows, status, busyId, onHandle, onReopen, onDelete,
}: {
  rows: RequestedProduct[]
  status: StatusFilter
  busyId: string | null
  onHandle: (id: string) => void
  onReopen: (id: string) => void
  onDelete: (id: string, label: string) => void
}) {
  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-slate-500">
        {status === "OPEN" ? "ماكو طلبات — أي منتج يطلبه زبون وما يلكيه راح يظهر هنا" : "ماكو طلبات معالجة"}
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <Card key={row.id}>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <span className={cn(
              "flex h-10 min-w-10 items-center justify-center rounded-full px-2 text-sm font-bold",
              row.requestCount > 1 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
            )}>
              {row.requestCount}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate font-medium">
                <PackageSearch className="h-4 w-4 shrink-0 text-amber-600" /> {row.productName}
              </p>
              <p className="text-xs text-slate-500">آخر طلب: {formatBaghdad(row.updatedAt)} · من: {row.lastPhone}</p>
              {row.lastNote && <p className="truncate text-xs text-slate-400">ملاحظة: {row.lastNote}</p>}
            </div>
            {status === "OPEN" ? (
              <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => onHandle(row.id)}>
                {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><CheckCircle2 className="ml-1 h-3.5 w-3.5" /> تمت معالجته</>}
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={busyId === row.id} onClick={() => onReopen(row.id)}>
                {busyId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><RotateCcw className="ml-1 h-3.5 w-3.5" /> إرجاعه</>}
              </Button>
            )}
            <Button size="sm" variant="outline" className="text-red-600" disabled={busyId === row.id}
              onClick={() => onDelete(row.id, row.productName)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
