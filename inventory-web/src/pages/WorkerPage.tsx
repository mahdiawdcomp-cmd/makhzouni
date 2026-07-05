import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "../components/ui/use-toast"
import {
  createTransfer,
  getBranches,
  getMyApprovals,
  getProducts,
} from "../api/endpoints"
import type { Product } from "../types/api"
import { CameraScanModal } from "../components/CameraScanModal"
import { useAuthStore } from "../store/authStore"

/**
 * Warehouse-worker page (/worker) — deliberately self-contained:
 *  - Local ar/ur dictionary (does NOT touch the global LanguageProvider, which
 *    forces Arabic on non-administration paths).
 *  - NO money is ever rendered; the backend already strips price fields for
 *    VIEW_WITHOUT_PRICES holders (batch 24B), and scrubProduct() below removes
 *    them again client-side as defense in depth.
 *  - Transfers go through the normal POST /transfers endpoint: STAFF requests
 *    become PendingApproval — stock only moves after an admin approves.
 */

type WorkerLang = "ar" | "ur"

const STRINGS = {
  title: { ar: "عامل المخزن", ur: "گودام ورکر" },
  searchPlaceholder: { ar: "ابحث بالاسم أو رقم الآيتم أو الباركود", ur: "نام، آئٹم نمبر یا بارکوڈ سے تلاش کریں" },
  search: { ar: "بحث", ur: "تلاش کریں" },
  scanBarcode: { ar: "مسح الباركود", ur: "بارکوڈ اسکین کریں" },
  cameraUnsupported: {
    ar: "الكاميرا غير مدعومة في هذا المتصفح، استخدم البحث اليدوي.",
    ur: "اس براؤزر میں کیمرہ سپورٹ نہیں ہے، براہ کرم دستی تلاش استعمال کریں۔",
  },
  noResults: { ar: "لا توجد نتائج", ur: "کوئی نتیجہ نہیں ملا" },
  itemNumber: { ar: "رقم الآيتم", ur: "آئٹم نمبر" },
  barcode: { ar: "الباركود", ur: "بارکوڈ" },
  category: { ar: "التصنيف", ur: "زمرہ" },
  location: { ar: "الموقع / الرف", ur: "جگہ / شیلف" },
  notes: { ar: "ملاحظات", ur: "نوٹس" },
  totalQty: { ar: "الكمية الإجمالية", ur: "کل مقدار" },
  qtyByWarehouse: { ar: "الكمية حسب المخزن", ur: "ہر گودام میں دستیاب مقدار" },
  availableQty: { ar: "الكمية المتوفرة", ur: "دستیاب مقدار" },
  warehouse: { ar: "المخزن", ur: "گودام" },
  piece: { ar: "قطعة", ur: "عدد" },
  transferRequest: { ar: "طلب تحويل", ur: "منتقلی کی درخواست" },
  fromWarehouse: { ar: "من مخزن", ur: "کس گودام سے" },
  toWarehouse: { ar: "إلى مخزن", ur: "کس گودام تک" },
  quantity: { ar: "الكمية (قطع)", ur: "مقدار (عدد)" },
  noteOptional: { ar: "ملاحظة (اختياري)", ur: "نوٹ (اختیاری)" },
  sendTransfer: { ar: "إرسال طلب تحويل", ur: "منتقلی کی درخواست بھیجیں" },
  transferSent: {
    ar: "تم إرسال طلب التحويل — بانتظار موافقة الإدارة",
    ur: "منتقلی کی درخواست بھیج دی گئی — انتظامیہ کی منظوری کا انتظار ہے",
  },
  chooseWarehouses: { ar: "اختر المخزنين والكمية", ur: "دونوں گودام اور مقدار منتخب کریں" },
  sameWarehouse: { ar: "المخزنان يجب أن يكونا مختلفين", ur: "دونوں گودام مختلف ہونے چاہئیں" },
  myRequests: { ar: "طلباتي", ur: "میری درخواستیں" },
  pending: { ar: "بانتظار الموافقة", ur: "منظوری کا انتظار ہے" },
  approved: { ar: "تمت الموافقة", ur: "منظور ہو گئی" },
  rejected: { ar: "مرفوض", ur: "مسترد" },
  noRequests: { ar: "لا توجد طلبات بعد", ur: "ابھی کوئی درخواست نہیں" },
  loading: { ar: "جارِ التحميل...", ur: "لوڈ ہو رہا ہے..." },
  language: { ar: "اردو", ur: "عربي" }, // label shows the OTHER language
  back: { ar: "رجوع للنتائج", ur: "نتائج پر واپس" },
} as const

type StringKey = keyof typeof STRINGS

/** Defense in depth: even if a money field ever reaches the client, drop it. */
const MONEY_FIELDS = [
  "salePrice", "purchasePrice", "retailPrice", "costPrice", "oldPrice",
  "profit", "profitMargin", "totalValue", "price",
] as const

function scrubProduct(product: Product): Product {
  const copy = { ...(product as unknown as Record<string, unknown>) }
  for (const field of MONEY_FIELDS) delete copy[field]
  return copy as unknown as Product
}

function statusLabel(status: string, t: (k: StringKey) => string) {
  if (status === "APPROVED") return t("approved")
  if (status === "REJECTED") return t("rejected")
  return t("pending")
}

function statusColor(status: string) {
  if (status === "APPROVED") return "bg-emerald-100 text-emerald-700"
  if (status === "REJECTED") return "bg-red-100 text-red-700"
  return "bg-amber-100 text-amber-700"
}

type TransferApprovalData = {
  body?: { fromBranchId?: string; toBranchId?: string; items?: { quantity?: number }[] }
  snapshot?: { fromName?: string; toName?: string; items?: { productName?: string; quantity?: number }[] }
}

export function WorkerPage() {
  const user = useAuthStore((s) => s.user)
  const queryClient = useQueryClient()

  const canAccess =
    user?.role === "ADMIN" ||
    (user?.permissions ?? []).some(
      (p) => p === "VIEW_WITHOUT_PRICES" || p === "REQUEST_TRANSFER"
    )

  const [lang, setLang] = useState<WorkerLang>(() =>
    localStorage.getItem("worker_lang") === "ur" ? "ur" : "ar"
  )
  const t = (key: StringKey) => STRINGS[key][lang]
  const switchLang = () => {
    const next: WorkerLang = lang === "ar" ? "ur" : "ar"
    setLang(next)
    localStorage.setItem("worker_lang", next)
  }

  const [searchText, setSearchText] = useState("")
  const [submittedSearch, setSubmittedSearch] = useState("")
  const [cameraOpen, setCameraOpen] = useState(false)
  const [selected, setSelected] = useState<Product | null>(null)

  // Transfer-request form state
  const [fromBranchId, setFromBranchId] = useState("")
  const [toBranchId, setToBranchId] = useState("")
  const [quantity, setQuantity] = useState("")
  const [note, setNote] = useState("")

  const cameraSupported =
    typeof window !== "undefined" && "BarcodeDetector" in window

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches(),
  })

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["worker-search", submittedSearch],
    queryFn: async () => {
      const rows = await getProducts({ search: submittedSearch, limit: 20 })
      return rows.map(scrubProduct)
    },
    enabled: submittedSearch.trim().length > 0,
  })

  const { data: myApprovals = [] } = useQuery({
    queryKey: ["my-approvals"],
    queryFn: getMyApprovals,
    refetchInterval: 30_000,
  })

  const myTransferRequests = useMemo(
    () => myApprovals.filter((a) => a.requestType === "CREATE_TRANSFER"),
    [myApprovals]
  )

  const transferMutation = useMutation({
    mutationFn: createTransfer,
    onSuccess: () => {
      toast({ title: t("transferSent") })
      setQuantity("")
      setNote("")
      queryClient.invalidateQueries({ queryKey: ["my-approvals"] })
    },
    onError: () => toast({ title: "تعذر إرسال الطلب / درخواست ناکام", variant: "destructive" }),
  })

  function runSearch(value?: string) {
    const term = (value ?? searchText).trim()
    if (!term) return
    setSelected(null)
    setSubmittedSearch(term)
  }

  function submitTransfer() {
    if (!selected) return
    const qty = Number(quantity)
    if (!fromBranchId || !toBranchId || !Number.isInteger(qty) || qty <= 0) {
      toast({ title: t("chooseWarehouses"), variant: "destructive" })
      return
    }
    if (fromBranchId === toBranchId) {
      toast({ title: t("sameWarehouse"), variant: "destructive" })
      return
    }
    transferMutation.mutate({
      fromBranchId,
      toBranchId,
      notes: note.trim() || undefined,
      items: [{ productId: selected.id, quantity: qty, unit: "PIECE" }],
    })
  }

  const activeBranches = branches.filter((b) => b.isActive !== false)

  if (!canAccess) {
    return (
      <div dir="rtl" className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-4xl">🚫</p>
        <p className="font-bold">غير مصرح لك بالوصول لهذه الصفحة</p>
        <p className="text-sm text-slate-500">آپ کو اس صفحے تک رسائی کی اجازت نہیں ہے</p>
      </div>
    )
  }

  return (
    <div dir="rtl" className="mx-auto max-w-2xl p-3 pb-24 space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-3 text-white">
        <div>
          <h1 className="text-lg font-bold">{t("title")}</h1>
          <p className="text-xs text-slate-300">{user?.name}</p>
        </div>
        <button
          onClick={switchLang}
          className="rounded-xl bg-white/15 px-4 py-2 text-sm font-bold hover:bg-white/25"
        >
          {t("language")}
        </button>
      </div>

      {/* ── Search ── */}
      <div className="space-y-2 rounded-2xl border bg-white p-3 shadow-sm">
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch()}
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-xl border px-4 py-3 text-base"
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => runSearch()}
            className="rounded-xl bg-blue-600 py-3 text-base font-bold text-white hover:bg-blue-700"
          >
            🔍 {t("search")}
          </button>
          <button
            onClick={() => {
              if (!cameraSupported) {
                toast({ title: t("cameraUnsupported"), variant: "destructive" })
                return
              }
              setCameraOpen(true)
            }}
            className="rounded-xl bg-emerald-600 py-3 text-base font-bold text-white hover:bg-emerald-700"
          >
            📷 {t("scanBarcode")}
          </button>
        </div>
        {!cameraSupported && (
          <p className="text-xs text-amber-600">{t("cameraUnsupported")}</p>
        )}
      </div>

      {/* ── Results list ── */}
      {!selected && submittedSearch && (
        <div className="space-y-2">
          {isFetching && <p className="text-center text-sm text-slate-500">{t("loading")}</p>}
          {!isFetching && results.length === 0 && (
            <p className="rounded-xl bg-slate-100 py-6 text-center text-slate-500">{t("noResults")}</p>
          )}
          {results.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelected(p)}
              className="flex w-full items-center gap-3 rounded-2xl border bg-white p-3 text-right shadow-sm hover:bg-slate-50"
            >
              {p.thumbnailUrl || p.imageUrl ? (
                <img
                  src={p.thumbnailUrl ?? p.imageUrl ?? ""}
                  alt=""
                  className="h-14 w-14 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-2xl">📦</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{p.name}</p>
                <p className="text-xs text-slate-500">{t("itemNumber")}: {p.itemNumber}</p>
              </div>
              <div className="text-left">
                <p className="text-lg font-bold text-blue-700">{p.currentStock ?? 0}</p>
                <p className="text-[10px] text-slate-400">{t("piece")}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── Product detail (NO prices, ever) ── */}
      {selected && (
        <div className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm">
          <button onClick={() => setSelected(null)} className="text-sm font-bold text-blue-600">
            ← {t("back")}
          </button>

          <div className="flex items-start gap-3">
            {selected.imageUrl || selected.thumbnailUrl ? (
              <img
                src={selected.imageUrl ?? selected.thumbnailUrl ?? ""}
                alt=""
                className="h-28 w-28 rounded-2xl border object-cover"
              />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-2xl bg-slate-100 text-4xl">📦</div>
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <h2 className="text-lg font-bold">{selected.name}</h2>
              <p className="text-sm text-slate-600">{t("itemNumber")}: <b>{selected.itemNumber}</b></p>
              {selected.qrCode && (
                <p className="break-all text-xs text-slate-500">{t("barcode")}: {selected.qrCode}</p>
              )}
              {selected.category && (
                <p className="text-xs text-slate-500">{t("category")}: {selected.category}</p>
              )}
              {selected.storageLocation && (
                <p className="text-xs text-slate-500">{t("location")}: {selected.storageLocation}</p>
              )}
            </div>
          </div>

          {(selected as unknown as { notes?: string | null }).notes && (
            <p className="rounded-xl bg-slate-50 p-2 text-sm text-slate-600">
              {t("notes")}: {(selected as unknown as { notes?: string | null }).notes}
            </p>
          )}

          <div className="rounded-xl bg-blue-50 p-3 text-center">
            <p className="text-sm text-slate-600">{t("totalQty")}</p>
            <p className="text-3xl font-black text-blue-700">
              {selected.currentStock ?? 0} <span className="text-sm font-normal">{t("piece")}</span>
            </p>
          </div>

          {/* Per-warehouse quantities */}
          <div>
            <p className="mb-1 text-sm font-bold text-slate-700">{t("qtyByWarehouse")}</p>
            <div className="space-y-1">
              {(selected.warehouseStocks ?? []).map((ws) => (
                <div key={ws.warehouseId} className="flex items-center justify-between rounded-xl border px-3 py-2">
                  <span className="text-sm">🏬 {ws.warehouse?.name ?? ws.warehouseId}</span>
                  <span className="font-bold">{ws.quantityPieces} {t("piece")}</span>
                </div>
              ))}
              {(selected.warehouseStocks ?? []).length === 0 && (
                <p className="text-xs text-slate-400">{t("availableQty")}: {selected.currentStock ?? 0}</p>
              )}
            </div>
          </div>

          {/* ── Transfer request (PendingApproval for STAFF) ── */}
          <div className="space-y-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 p-3">
            <p className="font-bold text-emerald-800">🔄 {t("transferRequest")}</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-600">{t("fromWarehouse")}</label>
                <select
                  value={fromBranchId}
                  onChange={(e) => setFromBranchId(e.target.value)}
                  className="w-full rounded-xl border px-2 py-3 text-sm"
                >
                  <option value="">—</option>
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-600">{t("toWarehouse")}</label>
                <select
                  value={toBranchId}
                  onChange={(e) => setToBranchId(e.target.value)}
                  className="w-full rounded-xl border px-2 py-3 text-sm"
                >
                  <option value="">—</option>
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-600">{t("quantity")}</label>
              <input
                type="number"
                min={1}
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full rounded-xl border px-3 py-3 text-base"
              />
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("noteOptional")}
              className="w-full rounded-xl border px-3 py-2 text-sm"
            />
            <button
              onClick={submitTransfer}
              disabled={transferMutation.isPending}
              className="w-full rounded-xl bg-emerald-600 py-3 text-base font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {transferMutation.isPending ? t("loading") : `✅ ${t("sendTransfer")}`}
            </button>
          </div>
        </div>
      )}

      {/* ── My requests ── */}
      <div className="rounded-2xl border bg-white p-3 shadow-sm">
        <p className="mb-2 font-bold text-slate-700">📋 {t("myRequests")}</p>
        {myTransferRequests.length === 0 && (
          <p className="py-3 text-center text-sm text-slate-400">{t("noRequests")}</p>
        )}
        <div className="space-y-2">
          {myTransferRequests.slice(0, 20).map((a) => {
            const data = (a.requestData ?? {}) as TransferApprovalData
            const item = data.snapshot?.items?.[0]
            return (
              <div key={a.id} className="rounded-xl border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-bold">
                    {item?.productName ?? t("transferRequest")}
                  </p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${statusColor(a.status)}`}>
                    {statusLabel(a.status, t)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {data.snapshot?.fromName ?? "?"} ← {data.snapshot?.toName ?? "?"}
                  {item?.quantity ? ` — ${item.quantity} ${t("piece")}` : ""}
                </p>
                {a.createdAt && (
                  <p className="text-[10px] text-slate-400">
                    {new Date(a.createdAt).toLocaleString("ar-IQ")}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {cameraOpen && (
        <CameraScanModal
          onDetect={(code) => {
            setCameraOpen(false)
            setSearchText(code)
            runSearch(code)
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>
  )
}
