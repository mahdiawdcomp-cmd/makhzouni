import { useRef, useState } from "react"
import { Camera, Upload, Loader2, CheckCircle2, AlertCircle, X, Plus } from "lucide-react"
import { api } from "../../api/client"
import { Button } from "../ui/button"
import { cn } from "../../utils/cn"

// ── Types ─────────────────────────────────────────────────────────────────────

interface OcrProduct {
  id: string
  name: string
  itemNumber: string
  purchasePrice: number
  pcsPerCarton: number
}

interface OcrItem {
  extractedName: string
  quantity: number
  unit: "PIECE" | "DOZEN" | "CARTON"
  unitPrice: number
  product: OcrProduct | null
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
  quantity: number
  unit: "PIECE" | "DOZEN" | "CARTON"
  unitPrice: number
}

interface Props {
  onItemsReady: (items: OcrReadyItem[]) => void
  onClose: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function OcrInvoiceScanner({ onItemsReady, onClose }: Props) {
  const [status, setStatus] = useState<"idle" | "preview" | "loading" | "result" | "error">("idle")
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [ocrItems, setOcrItems] = useState<OcrItem[]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // ── تصغير الصورة قبل الإرسال (يمنع خطأ حجم الـ payload) ──────────────────
  function compressImage(dataUrl: string, maxWidth = 1200): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        const ratio = Math.min(1, maxWidth / img.width)
        canvas.width  = Math.round(img.width  * ratio)
        canvas.height = Math.round(img.height * ratio)
        const ctx = canvas.getContext("2d")
        if (!ctx) { resolve(dataUrl); return }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL("image/jpeg", 0.82))  // جودة 82% — كافية للـ OCR
      }
      img.src = dataUrl
    })
  }

  // ── تحميل الصورة ──────────────────────────────────────────────────────────
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

  // ── إرسال للـ API ──────────────────────────────────────────────────────────
  async function scanImage() {
    if (!imageDataUrl) return
    setStatus("loading")
    setMessage("جاري قراءة الفاتورة...")

    try {
      const { data } = await api.post<OcrResponse>("/ocr/invoice", {
        imageBase64: imageDataUrl,
      })

      setOcrItems(data.items)
      setMessage(data.message)

      // حدد تلقائياً العناصر المطابقة
      const autoSelected = new Set<number>()
      data.items.forEach((item, i) => {
        if (item.matched) autoSelected.add(i)
      })
      setSelected(autoSelected)
      setStatus("result")

    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })
          ?.response?.data?.message ?? "فشل الاتصال — حاول مرة ثانية"
      setStatus("error")
      setMessage(msg)
    }
  }

  // ── إضافة العناصر المحددة للفاتورة ────────────────────────────────────────
  function confirmItems() {
    const readyItems: OcrReadyItem[] = []

    ocrItems.forEach((item, i) => {
      if (!selected.has(i) || !item.product) return
      readyItems.push({
        productId:   item.product.id,
        productName: item.product.name,
        quantity:    item.quantity,
        unit:        item.unit,
        unitPrice:   item.unitPrice > 0 ? item.unitPrice : item.product.purchasePrice,
      })
    })

    if (readyItems.length === 0) return
    onItemsReady(readyItems)
    onClose()
  }

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-base">قراءة فاتورة بالكاميرا</h2>
        <button type="button" onClick={onClose}
          className="rounded-full p-1 hover:bg-slate-100 dark:hover:bg-slate-800">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* ── Idle: أزرار الرفع ── */}
      {status === "idle" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-500 text-center">
            صوّر فاتورة الشراء الورقية أو ارفع صورة منها
          </p>

          <div className="grid grid-cols-2 gap-3">
            {/* كاميرا الجوال */}
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed
                         border-indigo-300 bg-indigo-50 p-5 hover:bg-indigo-100
                         dark:border-indigo-700 dark:bg-indigo-950/30"
            >
              <Camera className="h-8 w-8 text-indigo-500" />
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                تصوير
              </span>
            </button>

            {/* رفع ملف */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed
                         border-slate-300 bg-slate-50 p-5 hover:bg-slate-100
                         dark:border-slate-700 dark:bg-slate-800/50"
            >
              <Upload className="h-8 w-8 text-slate-500" />
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                رفع صورة
              </span>
            </button>
          </div>

          {/* inputs مخفية */}
          <input ref={cameraInputRef} type="file" accept="image/*"
            capture="environment" className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])} />
          <input ref={fileInputRef} type="file" accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])} />
        </div>
      )}

      {/* ── Preview: معاينة الصورة ── */}
      {status === "preview" && imageDataUrl && (
        <div className="flex flex-col gap-3">
          <img
            src={imageDataUrl}
            alt="فاتورة"
            className="w-full max-h-64 object-contain rounded-xl border border-slate-200"
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1"
              onClick={() => { setStatus("idle"); setImageDataUrl(null) }}>
              تغيير الصورة
            </Button>
            <Button className="flex-1" onClick={() => void scanImage()}>
              قراءة الفاتورة ✨
            </Button>
          </div>
        </div>
      )}

      {/* ── Loading ── */}
      {status === "loading" && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="h-12 w-12 animate-spin text-indigo-500" />
          <p className="text-sm text-slate-500">{message}</p>
        </div>
      )}

      {/* ── Error ── */}
      {status === "error" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-rose-50 p-4
                          dark:bg-rose-950/30">
            <AlertCircle className="h-5 w-5 text-rose-500 shrink-0" />
            <p className="text-sm text-rose-700 dark:text-rose-300">{message}</p>
          </div>
          <Button variant="outline" onClick={() => setStatus("idle")}>
            حاول مرة ثانية
          </Button>
        </div>
      )}

      {/* ── Result: النتائج ── */}
      {status === "result" && (
        <div className="flex flex-col gap-3">
          {/* رسالة النجاح */}
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3
                          dark:bg-emerald-950/30">
            <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
            <p className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>
          </div>

          {/* قائمة المنتجات */}
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {ocrItems.map((item, i) => (
              <div
                key={i}
                onClick={() => {
                  if (!item.matched) return
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(i)) next.delete(i)
                    else next.add(i)
                    return next
                  })
                }}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3 transition",
                  item.matched
                    ? selected.has(i)
                      ? "border-indigo-400 bg-indigo-50 cursor-pointer dark:border-indigo-600 dark:bg-indigo-950/40"
                      : "border-slate-200 bg-white cursor-pointer hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-900"
                    : "border-amber-200 bg-amber-50 opacity-70 dark:border-amber-800 dark:bg-amber-950/30"
                )}
              >
                {/* Checkbox */}
                <div className={cn(
                  "mt-0.5 h-5 w-5 shrink-0 rounded border-2 flex items-center justify-center",
                  item.matched && selected.has(i)
                    ? "border-indigo-500 bg-indigo-500"
                    : "border-slate-300 dark:border-slate-600"
                )}>
                  {item.matched && selected.has(i) && (
                    <CheckCircle2 className="h-3 w-3 text-white" />
                  )}
                </div>

                {/* البيانات */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">
                      {item.product?.name ?? item.extractedName}
                    </span>
                    {!item.matched && (
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5
                                       rounded-full shrink-0 dark:bg-amber-900/40 dark:text-amber-300">
                        غير موجود
                      </span>
                    )}
                  </div>

                  {/* الاسم المستخرج إذا مختلف */}
                  {item.matched && item.product?.name !== item.extractedName && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      قرأ: "{item.extractedName}"
                    </p>
                  )}

                  <div className="flex gap-3 mt-1 text-xs text-slate-500">
                    <span>{item.quantity} {item.unit === "CARTON" ? "كرتون" : item.unit === "DOZEN" ? "درزن" : "قطعة"}</span>
                    {item.unitPrice > 0 && (
                      <span>{item.unitPrice.toLocaleString("en-US")} د.ع</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* أزرار التأكيد */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1"
              onClick={() => { setStatus("idle"); setImageDataUrl(null); setOcrItems([]) }}>
              إعادة المسح
            </Button>
            <Button
              className="flex-1"
              disabled={selected.size === 0}
              onClick={confirmItems}
            >
              <Plus className="h-4 w-4 ml-1" />
              إضافة {selected.size} منتج
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
