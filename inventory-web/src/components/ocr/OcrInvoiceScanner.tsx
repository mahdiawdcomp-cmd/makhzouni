import { useRef, useState } from "react"
import { AlertCircle, Camera, CheckCircle2, Loader2, Plus, Upload, X } from "lucide-react"
import { api } from "../../api/client"
import type { ApiEnvelope, Product } from "../../types/api"
import { Button } from "../ui/button"
import { cn } from "../../utils/cn"

interface OcrProduct {
  id: string
  name: string
  itemNumber: string
  purchasePrice: number
  salePrice?: number
  pcsPerCarton: number
}

interface OcrItem {
  extractedName: string
  quantity: number
  unit: "PIECE" | "DOZEN" | "CARTON"
  unitPrice: number
  product: OcrProduct | null
  suggestions?: OcrProduct[]
  matched: boolean
}

interface OcrResponse {
  success: boolean
  message: string
  supplierName: string | null
  invoiceDate: string | null
  items: OcrItem[]
}

export interface OcrReadyItem {
  productId: string
  productName: string
  product?: Product
  quantity: number
  unit: "PIECE" | "DOZEN" | "CARTON"
  unitPrice: number
}

interface RowDecision {
  action: "match" | "create" | "skip"
  productId: string
  name: string
  quantity: string
  unitPrice: string
  purchasePrice: string
  salePrice: string
  pcsPerCarton: string
}

interface Props {
  onItemsReady: (items: OcrReadyItem[]) => void
  onSupplierDetected?: (supplierName: string) => void
  onClose: () => void
}

function unitLabel(unit: OcrItem["unit"]) {
  if (unit === "CARTON") return "كارتون"
  if (unit === "DOZEN") return "درزن"
  return "قطعة"
}

function toNumber(value: string | number | undefined, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function createDecisions(items: OcrItem[]): RowDecision[] {
  return items.map((item) => {
    const productId = item.product?.id ?? item.suggestions?.[0]?.id ?? ""
    const price = item.unitPrice > 0 ? item.unitPrice : item.product?.purchasePrice ?? 0
    return {
      action: item.matched ? "match" : "create",
      productId,
      name: item.extractedName,
      quantity: String(Math.max(1, item.quantity || 1)),
      unitPrice: String(price),
      purchasePrice: String(price),
      salePrice: String(item.product?.salePrice ?? price),
      pcsPerCarton: String(item.product?.pcsPerCarton ?? 1),
    }
  })
}

export function OcrInvoiceScanner({ onItemsReady, onSupplierDetected, onClose }: Props) {
  const [status, setStatus] = useState<"idle" | "preview" | "loading" | "result" | "error">("idle")
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [supplierName, setSupplierName] = useState<string | null>(null)
  const [ocrItems, setOcrItems] = useState<OcrItem[]>([])
  const [decisions, setDecisions] = useState<RowDecision[]>([])
  const [creating, setCreating] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  function compressImage(dataUrl: string, maxWidth = 1200): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        const ratio = Math.min(1, maxWidth / img.width)
        canvas.width = Math.round(img.width * ratio)
        canvas.height = Math.round(img.height * ratio)
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL("image/jpeg", 0.82))
      }
      img.src = dataUrl
    })
  }

  function handleFile(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      void compressImage(String(reader.result)).then((compressed) => {
        setImageDataUrl(compressed)
        setStatus("preview")
      })
    }
    reader.readAsDataURL(file)
  }

  async function scanImage() {
    if (!imageDataUrl) return
    setStatus("loading")
    setMessage("جاري قراءة الفاتورة...")

    try {
      const { data } = await api.post<OcrResponse>("/ocr/invoice", { imageBase64: imageDataUrl })
      setOcrItems(data.items)
      setDecisions(createDecisions(data.items))
      setSupplierName(data.supplierName)
      setMessage(data.message)
      if (data.supplierName) onSupplierDetected?.(data.supplierName)
      setStatus("result")
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        "فشل الاتصال، حاول مرة ثانية"
      setStatus("error")
      setMessage(msg)
    }
  }

  function patchDecision(index: number, patch: Partial<RowDecision>) {
    setDecisions((current) =>
      current.map((decision, i) => (i === index ? { ...decision, ...patch } : decision)),
    )
  }

  async function createProductFromDecision(decision: RowDecision) {
    const payload = {
      name: decision.name.trim(),
      purchasePrice: Math.max(0, toNumber(decision.purchasePrice)),
      salePrice: Math.max(0, toNumber(decision.salePrice)),
      pcsPerCarton: Math.max(1, Math.round(toNumber(decision.pcsPerCarton, 1))),
      minStock: 0,
    }

    if (!payload.name) throw new Error("اسم المادة مطلوب")
    const { data } = await api.post<ApiEnvelope<Product>>("/products", payload)
    if (!data.data) {
      throw new Error(data.message ?? "لم يتم إنشاء المادة. قد تحتاج موافقة المدير.")
    }
    return data.data
  }

  async function confirmItems() {
    setCreating(true)
    setMessage("")
    try {
      const readyItems: OcrReadyItem[] = []

      for (let i = 0; i < ocrItems.length; i += 1) {
        const item = ocrItems[i]
        const decision = decisions[i]
        if (!decision || decision.action === "skip") continue

        const quantity = Math.max(1, toNumber(decision.quantity, item.quantity || 1))
        const unitPrice = Math.max(0, toNumber(decision.unitPrice, item.unitPrice))

        if (decision.action === "match") {
          const product =
            item.product?.id === decision.productId
              ? item.product
              : item.suggestions?.find((candidate) => candidate.id === decision.productId)
          if (!product) continue
          readyItems.push({
            productId: product.id,
            productName: product.name,
            quantity,
            unit: item.unit,
            unitPrice: unitPrice > 0 ? unitPrice : product.purchasePrice,
          })
          continue
        }

        const product = await createProductFromDecision(decision)
        readyItems.push({
          productId: product.id,
          productName: product.name,
          product,
          quantity,
          unit: item.unit,
          unitPrice: unitPrice > 0 ? unitPrice : product.purchasePrice,
        })
      }

      if (readyItems.length === 0) {
        setMessage("اختار مادة واحدة على الأقل أو أنشئ مادة جديدة.")
        return
      }

      onItemsReady(readyItems)
      onClose()
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : "تعذر تثبيت المواد")
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex max-h-[80vh] flex-col gap-4 overflow-hidden">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold">قراءة فاتورة من صورة</h2>
          <p className="text-xs text-slate-500">راجع المواد قبل تثبيتها حتى ما تنضاف مادة غلط.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {status === "idle" ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-4 text-sm font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300"
            >
              <Camera className="h-5 w-5" />
              تصوير
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300"
            >
              <Upload className="h-5 w-5" />
              رفع صورة
            </button>
          </div>
        </div>
      ) : null}

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => handleFile(event.target.files?.[0])}
      />

      {status === "preview" && imageDataUrl ? (
        <div className="flex flex-col gap-3">
          <img
            src={imageDataUrl}
            alt="فاتورة"
            className="max-h-64 w-full rounded-xl border border-slate-200 object-contain"
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { setStatus("idle"); setImageDataUrl(null) }}>
              تغيير الصورة
            </Button>
            <Button className="flex-1" onClick={() => void scanImage()}>
              قراءة الفاتورة
            </Button>
          </div>
        </div>
      ) : null}

      {status === "loading" ? (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="h-12 w-12 animate-spin text-indigo-500" />
          <p className="text-sm text-slate-500">{message}</p>
        </div>
      ) : null}

      {status === "error" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-4 dark:bg-rose-950/30">
            <AlertCircle className="h-5 w-5 shrink-0 text-rose-500" />
            <p className="text-sm text-rose-700 dark:text-rose-300">{message}</p>
          </div>
          <Button variant="outline" onClick={() => setStatus("idle")}>
            حاول مرة ثانية
          </Button>
        </div>
      ) : null}

      {status === "result" ? (
        <div className="flex min-h-0 flex-col gap-3">
          <div className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>{message}</span>
            </div>
            {supplierName ? <div className="mt-1 text-xs">المورد المقروء: {supplierName}</div> : null}
          </div>

          {message && creating ? (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              {message}
            </div>
          ) : null}

          <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
            {ocrItems.map((item, i) => {
              const decision = decisions[i]
              const suggestions = item.suggestions?.length ? item.suggestions : item.product ? [item.product] : []
              return (
                <div
                  key={`${item.extractedName}-${i}`}
                  className={cn(
                    "rounded-xl border p-3",
                    decision?.action === "create"
                      ? "border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"
                      : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900",
                  )}
                >
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{item.extractedName}</div>
                      <div className="text-xs text-slate-500">
                        {item.quantity} {unitLabel(item.unit)} - {item.unitPrice ? item.unitPrice.toLocaleString("en-US") : 0} د.ع
                      </div>
                    </div>
                    <select
                      value={decision?.action ?? "skip"}
                      onChange={(event) => patchDecision(i, { action: event.target.value as RowDecision["action"] })}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
                    >
                      {suggestions.length ? <option value="match">نفس مادة موجودة</option> : null}
                      <option value="create">إنشاء مادة جديدة</option>
                      <option value="skip">تجاهل</option>
                    </select>
                  </div>

                  {decision?.action === "match" ? (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                        هل هذه المادة الجديدة نفس مادة قديمة؟
                      </label>
                      <select
                        value={decision.productId}
                        onChange={(event) => patchDecision(i, { productId: event.target.value })}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                      >
                        {suggestions.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name} - {product.itemNumber}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {decision?.action === "create" ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-amber-800 dark:text-amber-300">
                        تريد أخلق هذه المادة بهذا الاسم والسعر والعدد؟
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={decision.name}
                          onChange={(event) => patchDecision(i, { name: event.target.value })}
                          className="col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          placeholder="اسم المادة"
                        />
                        <input
                          value={decision.quantity}
                          onChange={(event) => patchDecision(i, { quantity: event.target.value })}
                          inputMode="decimal"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          placeholder="العدد بالفاتورة"
                        />
                        <input
                          value={decision.unitPrice}
                          onChange={(event) => patchDecision(i, { unitPrice: event.target.value, purchasePrice: event.target.value })}
                          inputMode="decimal"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          placeholder="سعر الفاتورة"
                        />
                        <input
                          value={decision.salePrice}
                          onChange={(event) => patchDecision(i, { salePrice: event.target.value })}
                          inputMode="decimal"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          placeholder="سعر البيع"
                        />
                        <input
                          value={decision.pcsPerCarton}
                          onChange={(event) => patchDecision(i, { pcsPerCarton: event.target.value })}
                          inputMode="numeric"
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          placeholder="قطع الكارتون"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="flex gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
            <Button
              variant="outline"
              className="flex-1"
              disabled={creating}
              onClick={() => {
                setStatus("idle")
                setImageDataUrl(null)
                setOcrItems([])
                setDecisions([])
              }}
            >
              إعادة المسح
            </Button>
            <Button className="flex-1" disabled={creating} onClick={() => void confirmItems()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              تثبيت المواد
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
