import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useDebounce } from "../hooks/useDebounce"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getBranches, getCatalogCategories, getDeletedProducts, restoreProduct } from "../api/endpoints"
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { ChevronDown, ChevronUp, Download, Edit, Eye, FileText, FolderTree, Plus, Printer, ScanQrCode, Trash2, Undo2, X } from "lucide-react"
import { useProducts } from "../hooks/useProducts"
import { productCartonSheetPdf, productPieceLabelPdf } from "../api/endpoints"
import type { Product, ProductPayload, CatalogCategory } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { Input } from "../components/ui/input"
import { ModalForm } from "../components/ui/modal-form"
import { Badge } from "../components/ui/badge"
import { useToast } from "../components/ui/use-toast"
import { CatalogCategoriesManager } from "../components/CatalogCategoriesManager"
import { ImageCropModal } from "../components/ImageCropModal"

function stockOf(product: Product) {
  return product.currentStock ?? product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton
}

type ProductSort = "updatedDesc" | "nameAsc" | "stockDesc" | "stockAsc" | "purchaseDesc" | "saleDesc" | "valueDesc"

function dateValue(value?: string | null) {
  return value ? new Date(value).getTime() || 0 : 0
}

interface ProductFormState extends ProductPayload {
  branchId?: string
  storageLocation?: string | null
}

const emptyForm: ProductFormState = {
  itemNumber: "",
  name: "",
  qrCode: "",
  cartonQrCode: "",
  imageUrl: null,
  category: "",
  categoryTags: [],
  typeTags: [],
  isNewArrival: false,
  isOffer: false,
  oldPrice: null,
  openingBalancePcs: 0,
  cartonsAvailable: 0,
  pcsPerCarton: 1,
  purchasePrice: 0,
  salePrice: 0,
  retailPrice: 0,
  minStock: 5,
  branchId: "",
  storageLocation: "",
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Return a source the crop editor can safely draw to canvas: data URLs are
 * returned as-is; remote URLs are fetched and converted to a data URL so the
 * canvas is never "tainted" (which would block cropping/saving). If the fetch
 * fails (e.g. CORS), the original URL is returned and the editor handles it.
 */
async function toEditableSrc(src: string): Promise<string> {
  if (src.startsWith("data:")) return src
  try {
    const res = await fetch(src, { mode: "cors" })
    const blob = await res.blob()
    return await readFileAsDataUrl(blob)
  } catch {
    return src
  }
}

function drawToJpeg(source: CanvasImageSource, w: number, h: number): string {
  const maxSide = 900
  const scale = Math.min(1, maxSide / Math.max(w, h))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Image compression failed")
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.82)
}

async function compressProductImage(file: Blob): Promise<string> {
  // Preferred path: createImageBitmap (fast). Falls back to an <img> decode,
  // which is more widely supported (older iOS Safari, some Android WebViews).
  try {
    const bitmap = await createImageBitmap(file)
    return drawToJpeg(bitmap, bitmap.width, bitmap.height)
  } catch {
    const dataUrl = await readFileAsDataUrl(file)
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = dataUrl
    })
    return drawToJpeg(img, img.naturalWidth, img.naturalHeight)
  }
}


function ProductThumb({ product, className = "" }: { product: Pick<Product, "name" | "imageUrl" | "itemNumber">; className?: string }) {
  if (product.imageUrl) {
    return <img src={product.imageUrl} alt={product.name} className={`h-11 w-11 rounded-lg object-cover ring-1 ring-slate-200 ${className}`} />
  }
  return (
    <div className={`grid h-11 w-11 place-items-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200 ${className}`}>
      {product.itemNumber?.slice(0, 3) || "IMG"}
    </div>
  )
}

function selectAllOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.target.select()
}

function moveToNextProductField(event: ReactKeyboardEvent<HTMLFormElement>) {
  if (event.key !== "Enter" || event.shiftKey) return

  const target = event.target
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return
  if (target instanceof HTMLTextAreaElement) return

  const fields = Array.from(
    event.currentTarget.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      'input:not([type="file"]):not([type="hidden"]):not([type="checkbox"]), select',
    ),
  ).filter((field) => !field.disabled && field.offsetParent !== null)

  const currentIndex = fields.indexOf(target)
  const nextField = fields[currentIndex + 1]
  if (!nextField) return

  event.preventDefault()
  nextField.focus()
  if (nextField instanceof HTMLInputElement) nextField.select()
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-slate-500">{hint}</span> : null}
    </label>
  )
}

async function openBlob(url: string) {
  window.open(url, "_blank", "noopener,noreferrer")
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function exportInventoryCsv(products: Product[]) {
  const today = new Date().toLocaleDateString("en-US")
  const bom = "﻿" // UTF-8 BOM for Excel Arabic support
  const headers = [
    "رقم الصنف", "اسم المادة", "الفئة", "الكراتين", "قطع بالكرتونة",
    "القطع المفردة", "إجمالي القطع", "سعر الشراء", "سعر البيع",
    "الحد الأدنى", "رمز القطعة", "رمز الكرتون",
    "الكمية الفعلية (للجرد)", "ملاحظات"
  ]
  const rows = products.map((p) => {
    const total = p.currentStock ?? (p.openingBalancePcs + p.cartonsAvailable * p.pcsPerCarton)
    return [
      p.itemNumber, p.name, p.category ?? "", p.cartonsAvailable, p.pcsPerCarton,
      p.openingBalancePcs, total, p.purchasePrice, p.salePrice,
      p.minStock, p.qrCode ?? "", p.cartonQrCode ?? "",
      "", "" // Empty columns for manual count
    ]
  })
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`
  const csv = [
    `"جرد المخزون - تاريخ: ${today}"`,
    headers.map(esc).join(","),
    ...rows.map((r) => r.map(esc).join(","))
  ].join("\n")
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url; a.download = `inventory-${today.replace(/\//g, "-")}.csv`; a.click()
  URL.revokeObjectURL(url)
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
}

function inventoryStatus(product: Product) {
  const total = stockOf(product)
  if (total <= 0) return { label: "نفذت الكمية", className: "danger", rowClass: "out" }
  if (total <= product.minStock) return { label: "قارب على النفاذ", className: "warning", rowClass: "" }
  return { label: "متوفر", className: "ok", rowClass: "" }
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportInventoryDesignedHtml(products: Product[]) {
  const today = new Date().toLocaleDateString("ar-IQ")
  const rows = products.map((p, index) => {
    const total = stockOf(p)
    const totalCost = total * Number(p.purchasePrice ?? 0)
    const status = inventoryStatus(p)
    return `
      <tr class="${status.rowClass}">
        <td>${index + 1}</td>
        <td>${p.imageUrl ? `<button class="image-button" data-src="${escapeHtml(p.imageUrl)}" data-title="${escapeHtml(p.name)}" onclick="showImage(this.dataset.src,this.dataset.title)"><img class="item-image" src="${escapeHtml(p.imageUrl)}" /></button>` : `<div class="item-image">IMG</div>`}</td>
        <td class="mono">${escapeHtml(p.itemNumber)}</td>
        <td class="name">${escapeHtml(p.name)}</td>
        <td>${escapeHtml(p.category ?? "-")}</td>
        <td class="blue">${moneyForExport(p.cartonsAvailable)}</td>
        <td class="blue">${moneyForExport(p.pcsPerCarton)}</td>
        <td class="total">${moneyForExport(total)}</td>
        <td class="purchase">${moneyForExport(p.purchasePrice)}</td>
        <td class="sale">${moneyForExport(p.salePrice)}</td>
        <td class="total">${moneyForExport(totalCost)}</td>
        <td><span class="badge ${status.className}">${status.label}</span></td>
      </tr>`
  }).join("")

  const totalCartons = products.reduce((sum, p) => sum + p.cartonsAvailable, 0)
  const totalPieces = products.reduce((sum, p) => sum + stockOf(p), 0)
  const totalCost = products.reduce((sum, p) => sum + stockOf(p) * Number(p.purchasePrice ?? 0), 0)

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>جرد المخزن الشامل</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; font-family: Tahoma, Arial, sans-serif; background: #f3f4f6; color: #374151; }
    .sheet { max-width: 95%; margin: 0 auto; background: #fff; padding: 24px; border-radius: 16px; box-shadow: 0 12px 30px rgba(15, 23, 42, .12); }
    .header { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px; }
    h1 { margin: 0 0 6px; color: #1f2937; font-size: 28px; }
    .date { margin: 0; color: #6b7280; font-size: 14px; }
    .summary { background: #4f46e5; color: white; padding: 10px 16px; border-radius: 10px; font-weight: 700; }
    .table-wrap { overflow-x: auto; border: 1px solid #d1d5db; border-radius: 10px; box-shadow: inset 0 1px 4px rgba(0,0,0,.05); }
    table { width: 100%; border-collapse: collapse; text-align: right; font-size: 13px; }
    th { background: #f3f4f6; color: #374151; border-left: 1px solid #d1d5db; border-bottom: 2px solid #d1d5db; padding: 12px 10px; white-space: nowrap; }
    td { border-left: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; padding: 10px; vertical-align: middle; }
    tbody tr:hover { background: #fffbeb; }
    .out { background: #fef2f2; }
    .mono { font-family: Consolas, monospace; font-size: 12px; }
    .name { font-weight: 700; color: #111827; min-width: 220px; }
    .blue { background: rgba(239, 246, 255, .8); color: #1d4ed8; text-align: center; font-weight: 700; }
    .total { text-align: center; font-weight: 800; }
    .purchase { color: #dc2626; text-align: center; }
    .sale { color: #16a34a; text-align: center; }
    .item-image { width: 42px; height: 42px; margin: auto; display: grid; place-items: center; border-radius: 8px; background: #eef2ff; color: #4f46e5; font-weight: 800; font-size: 11px; object-fit: cover; }
    .image-button { border: 0; background: transparent; padding: 0; cursor: zoom-in; display: block; margin: auto; }
    .lightbox { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(15, 23, 42, .82); z-index: 50; padding: 24px; }
    .lightbox.open { display: flex; }
    .lightbox-card { max-width: min(92vw, 900px); max-height: 90vh; background: white; border-radius: 16px; padding: 14px; box-shadow: 0 24px 60px rgba(0,0,0,.35); }
    .lightbox-card img { display: block; max-width: 100%; max-height: 76vh; object-fit: contain; border-radius: 12px; }
    .lightbox-title { margin: 8px 4px 0; font-weight: 800; color: #111827; text-align: center; }
    .badge { display: inline-block; padding: 5px 9px; border-radius: 8px; font-size: 12px; font-weight: 800; white-space: nowrap; }
    .ok { background: #dcfce7; color: #15803d; }
    .warning { background: #fef3c7; color: #a16207; }
    .danger { background: #fee2e2; color: #b91c1c; }
    tfoot td { background: #1f2937; color: white; font-weight: 800; border-color: #4b5563; }
    tfoot .gold { color: #facc15; }
    @media print {
      body { background: white; padding: 0; }
      .sheet { max-width: 100%; border-radius: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <div>
        <h1>جرد المخزن الشامل</h1>
        <p class="date">تم التحديث: ${escapeHtml(today)}</p>
      </div>
      <div class="summary">${products.length} صنف</div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>صورة</th>
            <th>كود الصنف (SKU)</th>
            <th>اسم الصنف والوصف</th>
            <th>التصنيف</th>
            <th>رصيد الكراتين</th>
            <th>عدد الحبات (بالكرتون)</th>
            <th>إجمالي الحبات</th>
            <th>سعر الشراء</th>
            <th>سعر الجملة</th>
            <th>إجمالي التكلفة</th>
            <th>الحالة</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="5">الإجماليات الكلية:</td>
            <td>${moneyForExport(totalCartons)} كرتون</td>
            <td>-</td>
            <td>${moneyForExport(totalPieces)} حبة</td>
            <td colspan="2"></td>
            <td class="gold">${moneyForExport(totalCost)} د.ع</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
  <div id="lightbox" class="lightbox" onclick="hideImage()">
    <div class="lightbox-card" onclick="event.stopPropagation()">
      <img id="lightbox-img" alt="" />
      <div id="lightbox-title" class="lightbox-title"></div>
    </div>
  </div>
  <script>
    function showImage(src, title) {
      document.getElementById('lightbox-img').src = src;
      document.getElementById('lightbox-title').textContent = title || '';
      document.getElementById('lightbox').classList.add('open');
    }
    function hideImage() {
      document.getElementById('lightbox').classList.remove('open');
    }
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') hideImage();
    });
  </script>
</body>
</html>`

  downloadFile(`inventory-designed-${new Date().toISOString().slice(0, 10)}.html`, html, "text/html;charset=utf-8")
}

function moneyForExport(value: number | string | undefined | null) {
  return Number(value ?? 0).toLocaleString("en-US")
}

export function ProductsPage() {
  usePageTitle("المخزن")
  const navigate = useNavigate()

  // Handle Esc key for lightbox
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxImage(null)
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast } = useToast()
  const { productsQuery, createMutation, updateMutation, deleteMutation } = useProducts()
  const branchesQuery = useQuery({ queryKey: ["branches"], queryFn: () => getBranches() })
  const branches = branchesQuery.data ?? []
  const catalogCatsQuery = useQuery({ queryKey: ["catalog-categories"], queryFn: getCatalogCategories })
  const catalogCats: CatalogCategory[] = catalogCatsQuery.data ?? []
  const branchName = (branchId?: string | null) =>
    branchId ? branches.find((branch) => branch.id === branchId)?.name ?? "مخزن غير معروف" : "المخزن الرئيسي"
  const [query, setQuery] = useState("")
  const debouncedQuery = useDebounce(query, 250)
  const [category, setCategory] = useState("all")
  const [lowOnly, setLowOnly] = useState(false)
  const [missingFilter, setMissingFilter] = useState<"all" | "any" | "purchasePrice" | "salePrice" | "stock" | "category">("all")
  const [sortBy, setSortBy] = useState<ProductSort>("updatedDesc")
  const [sorting, setSorting] = useState<SortingState>([])
  const [open, setOpen] = useState(false)
  const [showCategories, setShowCategories] = useState(false)
  // Optional opening-stock split across warehouses (pieces per warehouse), used
  // on initial product entry only.
  const [dist, setDist] = useState<Record<string, number>>({})
  const [closeProductConfirm, setCloseProductConfirm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null)
  const [restoreConfirm, setRestoreConfirm] = useState<Product | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const qc = useQueryClient()

  const deletedProductsQuery = useQuery({
    queryKey: ["products", "deleted"],
    queryFn: getDeletedProducts,
    staleTime: 30_000,
  })

  const restoreProductMutation = useMutation({
    mutationFn: (id: string) => restoreProduct(id),
    onSuccess: () => {
      setRestoreConfirm(null)
      void qc.invalidateQueries({ queryKey: ["products"] })
    },
    onError: (err: Error) => toast({ title: err.message ?? "تعذر الاسترجاع", variant: "destructive" }),
  })
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductFormState>(emptyForm)
  const [lightboxImage, setLightboxImage] = useState<{ url: string; title: string } | null>(null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const products = productsQuery.data ?? []
  const categories = Array.from(new Set(products.map((item) => item.category).filter(Boolean) as string[]))

  function getMissing(product: Product): string[] {
    const missing: string[] = []
    if (!product.purchasePrice || product.purchasePrice === 0) missing.push("purchasePrice")
    if (!product.salePrice || product.salePrice === 0) missing.push("salePrice")
    if (!product.category) missing.push("category")
    if (stockOf(product) <= 0 && product.openingBalancePcs === 0 && product.cartonsAvailable === 0) missing.push("stock")
    return missing
  }

  const filtered = products.filter((product) => {
    const matchesSearch =
      debouncedQuery.trim() === "" ||
      product.name.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
      product.itemNumber.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
      product.qrCode?.toLowerCase().includes(debouncedQuery.toLowerCase())
    const matchesCategory = category === "all" || product.category === category
    const matchesLow = !lowOnly || stockOf(product) <= product.minStock
    const missing = getMissing(product)
    const matchesMissing =
      missingFilter === "all" ? true :
      missingFilter === "any" ? missing.length > 0 :
      missing.includes(missingFilter)
    return matchesSearch && matchesCategory && matchesLow && matchesMissing
  })

  const sortedProducts = [...filtered].sort((a, b) => {
    if (sortBy === "nameAsc") return a.name.localeCompare(b.name)
    if (sortBy === "stockDesc") return stockOf(b) - stockOf(a)
    if (sortBy === "stockAsc") return stockOf(a) - stockOf(b)
    if (sortBy === "purchaseDesc") return Number(b.purchasePrice) - Number(a.purchasePrice)
    if (sortBy === "saleDesc") return Number(b.salePrice) - Number(a.salePrice)
    if (sortBy === "valueDesc") return stockOf(b) * Number(b.purchasePrice ?? 0) - stockOf(a) * Number(a.purchasePrice ?? 0)
    return dateValue(b.updatedAt) - dateValue(a.updatedAt)
  })

  async function printPiece(id: string) {
    await openBlob(await productPieceLabelPdf(id))
  }
  async function printCarton(id: string) {
    await openBlob(await productCartonSheetPdf(id))
  }

  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      { accessorKey: "itemNumber", header: "رقم الآيتم" },
      { accessorKey: "name", header: "الاسم" },
      { id: "stock", header: "الكمية الكلية", accessorFn: stockOf },
      { accessorKey: "cartonsAvailable", header: "الكراتين المتوفرة" },
      { accessorKey: "purchasePrice", header: "سعر الشراء" },
      { accessorKey: "salePrice", header: "سعر البيع" },
      {
        id: "status",
        header: "الحالة",
        cell: ({ row }) =>
          stockOf(row.original) <= row.original.minStock ? (
            <Badge variant="danger">ناقص</Badge>
          ) : (
            <Badge variant="success">جيد</Badge>
          ),
      },
      {
        id: "actions",
        header: "إجراءات",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            <Button variant="outline" className="h-8 px-2" title="عرض" onClick={() => navigate(`/inventory/${row.original.id}`)}>
              <Eye className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="h-8 px-2" title="تعديل" onClick={() => startEdit(row.original)}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="h-8 px-2" title="طباعة رمز القطعة (2×2 سم)" onClick={() => void printPiece(row.original.id)}>
              <ScanQrCode className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="h-8 px-2" title="طباعة رمز الكرتون (A4، 6 لاصقات)" onClick={() => void printCarton(row.original.id)}>
              <Printer className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-50" title="حذف" onClick={() => setDeleteConfirm(row.original)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [navigate],
  )

  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })

  const table = useReactTable({
    data: sortedProducts,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  function startCreate() {
    setEditing(null)
    setForm(emptyForm)
    setDist({})
    setOpen(true)
  }

  useEffect(() => {
    if (searchParams.get("new") !== "1") return

    const initialName = searchParams.get("name")?.trim() ?? ""
    setEditing(null)
    setForm({ ...emptyForm, name: initialName })
    setOpen(true)

    const next = new URLSearchParams(searchParams)
    next.delete("new")
    next.delete("name")
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  function startEdit(product: Product) {
    setEditing(product)
    // Pre-fill dist with the product's current per-warehouse quantities
    const initialDist: Record<string, number> = {}
    for (const ws of product.warehouseStocks ?? []) {
      initialDist[ws.warehouseId] = ws.quantityPieces
    }
    setDist(initialDist)
    setForm({
      itemNumber: product.itemNumber,
      name: product.name,
      qrCode: product.qrCode ?? "",
      cartonQrCode: product.cartonQrCode ?? "",
      imageUrl: product.imageUrl ?? null,
      category: product.category ?? "",
      categoryTags: product.categoryTags ?? [],
      typeTags: product.typeTags ?? [],
      isNewArrival: product.isNewArrival ?? false,
      isOffer: product.isOffer ?? false,
      oldPrice: product.oldPrice ?? null,
      openingBalancePcs: product.openingBalancePcs,
      cartonsAvailable: product.cartonsAvailable,
      pcsPerCarton: product.pcsPerCarton,
      purchasePrice: product.purchasePrice,
      salePrice: product.salePrice,
      minStock: product.minStock,
      branchId: product.branchId ?? "",
      storageLocation: product.storageLocation ?? "",
    })
    setOpen(true)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.name) return
    // Strip empty optional strings so the backend generates / clears them properly.
    const payload: ProductPayload = {
      ...form,
      itemNumber: form.itemNumber?.trim() || undefined,
      qrCode: form.qrCode?.trim() || undefined,
      cartonQrCode: form.cartonQrCode?.trim() || undefined,
      imageUrl: form.imageUrl ?? null,
      category: form.category?.trim() || undefined,
      storageLocation: form.storageLocation?.trim() || null,
      branchId: form.branchId?.trim() || undefined,
    }
    const activeWarehouses = branches.filter((b) => b.isActive)
    const distEntries = Object.entries(dist)
      .map(([warehouseId, pieces]) => ({ warehouseId, pieces: Number(pieces) || 0 }))
      .filter((d) => d.pieces >= 0)

    if (editing && activeWarehouses.length > 1) {
      // Edit mode: always send the full per-warehouse distribution.
      // Backend will apply each warehouse value directly and recompute totals.
      payload.warehouseDistribution = distEntries
      // Strip raw quantity fields — they'll be derived from distribution by the backend.
      delete payload.openingBalancePcs
      delete payload.cartonsAvailable
    } else if (!editing && totalQuantity > 0 && activeWarehouses.length > 1) {
      // Create mode: distribution is mandatory when total > 0.
      const sum = distEntries.reduce((s, d) => s + d.pieces, 0)
      if (distEntries.length === 0) {
        alert(`وزّع الكمية (${totalQuantity} قطعة) على المخازن قبل الحفظ.`)
        return
      }
      if (sum !== totalQuantity) {
        alert(`مجموع التوزيع (${sum}) لا يساوي الكمية الكلية (${totalQuantity}). صحّح التوزيع قبل الحفظ.`)
        return
      }
      payload.warehouseDistribution = distEntries
    } else if (!editing && distEntries.length > 0) {
      payload.warehouseDistribution = distEntries
    }
    const mutation = editing
      ? updateMutation.mutateAsync({ id: editing.id, payload })
      : createMutation.mutateAsync(payload)
    mutation
      .then(() => setOpen(false))
      .catch((e: Error) => toast({ title: e.message ?? "تعذر الحفظ", variant: "destructive" }))
  }

  const distSum = Object.values(dist).reduce((s, v) => s + (Number(v) || 0), 0)
  const totalQuantity = editing
    ? distSum
    : (form.openingBalancePcs ?? 0) + (form.cartonsAvailable ?? 0) * (form.pcsPerCarton ?? 1)

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold">المخزن</h1>
          <p className="text-slate-500">إدارة المنتجات والرموز والمخزون.</p>
        </div>
        <Button className="h-12 w-full text-base shadow-lg md:hidden" onClick={startCreate}>
          <Plus className="h-5 w-5" />
          إضافة منتج جديد
        </Button>
        <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible md:pb-0">
          <Button variant="outline" asChild>
            <Link to="/inventory/low-stock">المخزون الناقص</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/inventory/variety">تحويل إلى متنوع</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => exportInventoryCsv(products)}
            title="تصدير ملف CSV للجرد — يفتح بـ Excel"
          >
            <Download className="h-4 w-4" /> جرد المخزن (Excel)
          </Button>
          <Button
            variant="outline"
            onClick={() => exportInventoryDesignedHtml(products)}
            title="تحميل ملف جرد مصمم قابل للطباعة أو الحفظ PDF من المتصفح"
          >
            <Download className="h-4 w-4" /> تحميل الجرد المصمم
          </Button>
          <Button variant="outline" asChild>
            <Link to="/inventory/stocktake">
              <FileText className="h-4 w-4" /> الجرد الدوري
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setShowCategories((v) => !v)}>
            <FolderTree className="h-4 w-4" /> {showCategories ? "إخفاء الفئات" : "إدارة الفئات"}
          </Button>
          <Button className="hidden md:inline-flex" onClick={startCreate}>
            <Plus className="h-4 w-4" />
            منتج جديد
          </Button>
        </div>
      </div>

      {showCategories && <CatalogCategoriesManager />}

      <Card className="overflow-hidden">
        <CardHeader className="px-4 py-3 md:px-5 md:py-4">
          <CardTitle>جدول المنتجات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-3 md:p-5">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_200px_220px]">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالاسم أو رقم الآيتم أو الباركود" />
            <select className="h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">كل الفئات</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950"
              value={sortBy}
              onChange={(event) => {
                setSortBy(event.target.value as ProductSort)
                setSorting([])
              }}
            >
              <option value="updatedDesc">آخر تعديل</option>
              <option value="nameAsc">الاسم أ-ي</option>
              <option value="stockDesc">أعلى كمية</option>
              <option value="stockAsc">أقل كمية</option>
              <option value="purchaseDesc">أعلى سعر شراء</option>
              <option value="saleDesc">أعلى سعر بيع</option>
              <option value="valueDesc">أعلى قيمة مخزون</option>
            </select>
          </div>
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <select
              className={`h-9 rounded-md border px-3 text-sm dark:bg-slate-950 ${missingFilter !== "all" ? "border-amber-400 bg-amber-50 font-semibold text-amber-800 dark:border-amber-600 dark:bg-amber-950/20 dark:text-amber-300" : "border-slate-200 bg-white dark:border-slate-700"}`}
              value={missingFilter}
              onChange={(event) => setMissingFilter(event.target.value as typeof missingFilter)}
            >
              <option value="all">كل المواد</option>
              <option value="any">⚠️ ناقصة معلومات (الكل)</option>
              <option value="purchasePrice">⚠️ ناقص سعر الشراء</option>
              <option value="salePrice">⚠️ ناقص سعر البيع</option>
              <option value="stock">⚠️ ناقص الكمية</option>
              <option value="category">⚠️ ناقص الفئة</option>
            </select>
            {missingFilter !== "all" && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                {filtered.length} مادة
              </span>
            )}
            <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700">
              <input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />
              نقص المخزون
            </label>
          </div>
          {/* Loading skeleton */}
          {productsQuery.isLoading && (
            <div className="space-y-2 py-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-9 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" style={{ opacity: 1 - i * 0.1 }} />
              ))}
            </div>
          )}

          {/* Error state */}
          {productsQuery.isError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-800 dark:bg-rose-950/30">
              <p className="font-semibold text-rose-700 dark:text-rose-400">تعذر تحميل المنتجات</p>
              <p className="mt-1 text-sm text-rose-500">تحقق من الاتصال بالخادم ثم اضغط إعادة المحاولة.</p>
              <button
                onClick={() => void productsQuery.refetch()}
                className="mt-3 rounded-lg bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700"
              >
                إعادة المحاولة
              </button>
            </div>
          )}

          {/* ── Excel-style inventory table ── */}
          {!productsQuery.isLoading && !productsQuery.isError && (
          <>
          <div className="space-y-3 md:hidden">
            {table.getRowModel().rows.map((row) => {
              const p = row.original
              const totalPcs = stockOf(p)
              const isNegative = totalPcs < 0
              const isOut = totalPcs <= 0
              const isLow = !isNegative && totalPcs <= p.minStock && totalPcs > 0
              const activeStocks = p.warehouseStocks?.filter((ws) => ws.quantityPieces > 0) ?? []

              return (
                <article
                  key={p.id}
                  className={`overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-slate-950 ${
                    isNegative
                      ? "border-purple-200 dark:border-purple-900"
                      : isOut
                        ? "border-rose-200 dark:border-rose-900"
                        : isLow
                          ? "border-amber-200 dark:border-amber-900"
                          : "border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/inventory/${p.id}`)}
                    className="flex w-full items-start gap-3 p-3 text-right"
                  >
                    <ProductThumb product={p} className="h-16 w-16 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-bold text-slate-900 dark:text-slate-100">{p.name}</h3>
                          <p className="mt-0.5 font-mono text-[11px] text-slate-500">{p.itemNumber}</p>
                        </div>
                        {isNegative ? (
                          <Badge variant="danger">سالب</Badge>
                        ) : isOut ? (
                          <Badge variant="danger">نافد</Badge>
                        ) : isLow ? (
                          <Badge variant="warning">قليل</Badge>
                        ) : (
                          <Badge variant="success">متوفر</Badge>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {p.category ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{p.category}</span> : null}
                        {activeStocks.slice(0, 2).map((ws) => (
                          <span key={ws.warehouseId} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                            {ws.warehouse.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>

                  <div className="grid grid-cols-3 border-y border-slate-100 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="p-2.5 text-center">
                      <p className="text-[10px] text-slate-500">الكمية</p>
                      <p className="mt-0.5 text-sm font-extrabold text-slate-900 dark:text-white">{totalPcs.toLocaleString("en-US")}</p>
                    </div>
                    <div className="border-x border-slate-200 p-2.5 text-center dark:border-slate-800">
                      <p className="text-[10px] text-slate-500">سعر الشراء</p>
                      <p className="mt-0.5 text-sm font-bold text-rose-600">{Number(p.purchasePrice).toLocaleString("en-US")}</p>
                    </div>
                    <div className="p-2.5 text-center">
                      <p className="text-[10px] text-slate-500">سعر البيع</p>
                      <p className="mt-0.5 text-sm font-bold text-emerald-600">{Number(p.salePrice).toLocaleString("en-US")}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-5 gap-1 p-2">
                    <Button variant="ghost" className="h-11 flex-col gap-0.5 px-1 text-[10px]" onClick={() => navigate(`/inventory/${p.id}`)}>
                      <Eye className="h-4 w-4" /> عرض
                    </Button>
                    <Button variant="ghost" className="h-11 flex-col gap-0.5 px-1 text-[10px]" onClick={() => startEdit(p)}>
                      <Edit className="h-4 w-4" /> تعديل
                    </Button>
                    <Button variant="ghost" className="h-11 flex-col gap-0.5 px-1 text-[10px]" onClick={() => void printPiece(p.id)}>
                      <ScanQrCode className="h-4 w-4" /> قطعة
                    </Button>
                    <Button variant="ghost" className="h-11 flex-col gap-0.5 px-1 text-[10px]" onClick={() => void printCarton(p.id)}>
                      <Printer className="h-4 w-4" /> كرتون
                    </Button>
                    <Button variant="ghost" className="h-11 flex-col gap-0.5 px-1 text-[10px] text-rose-600" onClick={() => setDeleteConfirm(p)}>
                      <Trash2 className="h-4 w-4" /> حذف
                    </Button>
                  </div>
                </article>
              )
            })}

            {table.getRowModel().rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                لا توجد منتجات مطابقة.
              </div>
            ) : null}
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-gray-300 shadow-inner md:block">
            <table className="w-full text-right text-sm">
              <thead className="bg-gray-100 border-b-2 border-gray-300 sticky top-0">
                <tr className="text-gray-700">
                  <th className="py-3 px-3 border-l border-gray-300 w-10 text-center cursor-pointer" onClick={() => table.setSorting([{ id: "itemNumber", desc: false }])}>
                    #
                  </th>
                  <th className="py-3 px-3 border-l border-gray-300 cursor-pointer min-w-[180px]" onClick={() => table.setSorting([{ id: "name", desc: false }])}>
                    اسم الصنف ↕
                  </th>
                  <th className="py-3 px-3 border-l border-gray-300 text-center">الفئة</th>
                  <th className="py-3 px-3 border-l border-gray-300 text-center">المخزن / الموقع</th>
                  <th className="py-3 px-3 border-l border-gray-300 text-center bg-blue-50 cursor-pointer" onClick={() => table.setSorting([{ id: "stock", desc: true }])}>
                    رصيد الكراتين ↕
                  </th>
                  <th className="py-3 px-3 border-l border-gray-300 text-center bg-blue-50">ق/كرتون</th>
                  <th className="py-3 px-3 border-l border-gray-300 text-center font-bold">إجمالي القطع</th>
                  <th className="py-3 px-3 border-l border-gray-300 text-center text-red-600">شراء</th>
                  <th className="py-3 px-3 border-l border-gray-300 text-center text-green-600">بيع</th>
                  <th className="py-3 px-3 border-l border-gray-300 text-center">تكلفة المخزون</th>
                  <th className="py-3 px-3 border-l border-gray-300 text-center">الحالة</th>
                  <th className="py-3 px-3 text-center">إجراءات</th>
                </tr>
              </thead>
              <tbody className="text-gray-700 font-medium">
                {table.getRowModel().rows.map((row, idx2) => {
                  const p = row.original
                  const totalPcs = stockOf(p)
                  const totalCost = totalPcs * Number(p.purchasePrice ?? 0)
                  const isNegative = totalPcs < 0
                  const isLow = !isNegative && totalPcs <= p.minStock && totalPcs > 0
                  const isOut = totalPcs <= 0

                  const rowBg = isNegative
                    ? "bg-purple-50"
                    : isOut
                      ? "bg-red-50"
                      : isLow
                        ? "bg-white"
                        : "bg-white"

                  const badge = isNegative
                    ? <Badge variant="danger">سالب ⚠</Badge>
                    : isOut
                      ? <Badge variant="danger">نفذت الكمية</Badge>
                      : isLow
                        ? <Badge variant="warning">قارب النفاذ</Badge>
                        : <Badge variant="success">متوفر</Badge>

                  return (
                    <tr key={row.id} className={`border-b border-gray-200 hover:bg-yellow-50 transition ${rowBg}`}>
                      <td className="py-2 px-3 border-l border-gray-200 text-center text-gray-500 text-xs">{idx2 + 1}</td>
                      <td className="py-2 px-3 border-l border-gray-200">
                        <div className="flex items-center gap-3">
                          {p.imageUrl ? (
                            <button
                              type="button"
                              onClick={() => setLightboxImage({ url: p.imageUrl!, title: p.name })}
                              className="cursor-zoom-in hover:opacity-80 transition"
                              title="اضغط للتكبير"
                            >
                              <ProductThumb product={p} />
                            </button>
                          ) : (
                            <ProductThumb product={p} />
                          )}
                          <div>
                            <p className={`font-bold text-gray-900 ${isOut ? "line-through text-gray-400" : ""}`}>{p.name}</p>
                            <p className="text-xs text-gray-500 font-mono">{p.itemNumber}</p>
                            {getMissing(p).length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {getMissing(p).map((m) => (
                                  <span key={m} className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                    {m === "purchasePrice" ? "بلا سعر شراء" : m === "salePrice" ? "بلا سعر بيع" : m === "stock" ? "بلا كمية" : "بلا فئة"}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-3 border-l border-gray-200 text-center text-xs text-gray-500">{p.category ?? "—"}</td>
                      <td className="py-2 px-3 border-l border-gray-200 text-center text-xs">
                        {p.warehouseStocks && p.warehouseStocks.filter(ws => ws.quantityPieces > 0).length > 0 ? (
                          <div className="flex flex-wrap justify-center gap-1">
                            {p.warehouseStocks.filter(ws => ws.quantityPieces > 0).map(ws => (
                              <div key={ws.warehouseId} className="relative group/ws">
                                <span className="cursor-default rounded px-1.5 py-0.5 bg-slate-100 text-slate-700 font-semibold whitespace-nowrap hover:bg-blue-100 transition">
                                  {ws.warehouse.name}
                                </span>
                                <div className="pointer-events-none absolute bottom-full mb-1.5 right-1/2 translate-x-1/2 z-50 hidden group-hover/ws:block bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-xl">
                                  <div className="font-bold">{ws.warehouse.name}</div>
                                  <div>{ws.quantityPieces.toLocaleString("en-US")} قطعة · {(ws.quantityPieces / p.pcsPerCarton).toLocaleString("en-US", { maximumFractionDigits: 2 })} كرتون</div>
                                  {ws.storageLocation && <div className="text-slate-300">📍 {ws.storageLocation}</div>}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div>
                            <div className="font-semibold text-slate-700">{branchName(p.branchId)}</div>
                            {p.storageLocation ? <div className="text-slate-500">{p.storageLocation}</div> : null}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 border-l border-gray-200 text-center font-bold text-blue-700 bg-blue-50/30">
                        {p.pcsPerCarton > 1
                          ? (totalPcs / p.pcsPerCarton).toLocaleString("en-US", { maximumFractionDigits: 2 })
                          : totalPcs.toLocaleString("en-US")}
                      </td>
                      <td className="py-2 px-3 border-l border-gray-200 text-center text-xs bg-blue-50/30">{p.pcsPerCarton}</td>
                      <td className={`py-2 px-3 border-l border-gray-200 text-center font-bold ${isNegative ? "text-purple-700" : ""}`}>{totalPcs.toLocaleString("en-US")}</td>
                      <td className="py-2 px-3 border-l border-gray-200 text-center text-red-600">{Number(p.purchasePrice).toLocaleString("en-US")}</td>
                      <td className="py-2 px-3 border-l border-gray-200 text-center text-green-600">{Number(p.salePrice).toLocaleString("en-US")}</td>
                      <td className="py-2 px-3 border-l border-gray-200 text-center font-bold">{totalCost.toLocaleString("en-US")}</td>
                      <td className="py-2 px-3 border-l border-gray-200 text-center">{badge}</td>
                      <td className="py-2 px-3 text-center">
                        <div className="flex justify-center gap-1">
                          <Button variant="outline" className="h-7 w-7 p-0" title="عرض" onClick={() => navigate(`/inventory/${p.id}`)}><Eye className="h-3.5 w-3.5" /></Button>
                          <Button variant="outline" className="h-7 w-7 p-0" title="تعديل" onClick={() => startEdit(p)}><Edit className="h-3.5 w-3.5" /></Button>
                          <Button variant="outline" className="h-7 w-7 p-0" title="رمز القطعة" onClick={() => void printPiece(p.id)}><ScanQrCode className="h-3.5 w-3.5" /></Button>
                          <Button variant="outline" className="h-7 w-7 p-0" title="رمز الكرتون" onClick={() => void printCarton(p.id)}><Printer className="h-3.5 w-3.5" /></Button>
                          <Button variant="outline" className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50" title="حذف" onClick={() => setDeleteConfirm(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {/* Footer totals */}
              <tfoot className="bg-gray-800 text-white font-bold">
                <tr>
                  <td colSpan={4} className="py-3 px-4 text-xs">الإجماليات ({filtered.length} صنف):</td>
                  <td className="py-3 px-3 text-center border-l border-gray-600">
                    {filtered.reduce((s, p) => s + p.cartonsAvailable, 0).toLocaleString("en-US")} كرتون
                  </td>
                  <td className="py-3 px-3 border-l border-gray-600"></td>
                  <td className="py-3 px-3 text-center border-l border-gray-600">
                    {filtered.reduce((s, p) => s + stockOf(p), 0).toLocaleString("en-US")} قطعة
                  </td>
                  <td colSpan={2} className="py-3 px-3 border-l border-gray-600"></td>
                  <td className="py-3 px-3 text-center text-yellow-400 border-l border-gray-600">
                    {filtered.reduce((s, p) => s + stockOf(p) * Number(p.purchasePrice ?? 0), 0).toLocaleString("en-US")}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-20 md:pb-0">
            <div className="flex items-center gap-1">
              {[10, 50, 100].map((n) => (
                <Button key={n} size="sm" variant={pagination.pageSize === n ? "default" : "outline"}
                  onClick={() => setPagination({ pageIndex: 0, pageSize: n })}>
                  {n}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="px-3" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>السابق</Button>
              <span className="text-center text-xs text-slate-500 md:text-sm">صفحة {table.getState().pagination.pageIndex + 1} من {table.getPageCount() || 1} — {filtered.length} منتج</span>
              <Button variant="outline" className="px-3" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>التالي</Button>
            </div>
          </div>
          </>
          )}
        </CardContent>
      </Card>

      <ModalForm
        open={open}
        onOpenChange={(v) => {
          if (!v && !editing && form.name.trim()) {
            setCloseProductConfirm(true); return
          }
          setOpen(v)
        }}
        title={editing ? "تعديل منتج" : "إضافة منتج جديد"}
        contentClassName="inset-0 left-0 top-0 h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-none border-0 px-4 pb-0 pt-5 sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[92vh] sm:w-[calc(100%-3rem)] sm:max-w-4xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border sm:p-6"
      >
        <form className="space-y-4 pb-24 sm:pb-0" onSubmit={submit} onKeyDown={moveToNextProductField}>
          <div className="rounded-md bg-sky-50 p-3 text-xs text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            <FileText className="ml-1 inline h-3.5 w-3.5" />
            ابدأ برقم الآيتم واسم المنتج، ثم أكمل الكمية والأسعار. اضغط Enter للانتقال إلى الحقل التالي.
          </div>

          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div className="col-span-2 flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">1</span>
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">معلومات المنتج</p>
                <p className="text-[11px] text-slate-500">رقم الآيتم والاسم والصورة والتصنيف.</p>
              </div>
            </div>
            <Field label="رقم الآيتم" hint={editing ? "" : "إذا تركته فارغاً يولّده النظام تلقائياً"}>
              <Input
                autoFocus
                placeholder="مثلاً: AB0001"
                value={form.itemNumber ?? ""}
                onChange={(event) => setForm({ ...form, itemNumber: event.target.value })}
              />
            </Field>
            <Field label="اسم المنتج *">
              <Input required placeholder="مثلاً: سيارة بطارية" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center gap-3">
                {/* Preview */}
                {form.imageUrl ? (
                  <button
                    type="button"
                    onClick={async () => setCropSrc(await toEditableSrc(form.imageUrl!))}
                    className="group relative h-20 w-20 overflow-hidden rounded-xl ring-2 ring-offset-1 ring-indigo-400 cursor-pointer"
                    title="اضغط لتعديل الصورة"
                  >
                    <img src={form.imageUrl} alt={form.name || "صورة المادة"} className="h-full w-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
                      <span className="text-[10px] font-bold text-white">تعديل</span>
                    </div>
                  </button>
                ) : (
                  <div className="grid h-20 w-20 place-items-center rounded-xl bg-white text-xs font-bold text-slate-400 ring-1 ring-slate-200 dark:bg-slate-950">صورة</div>
                )}

                <div className="flex-1 space-y-2">
                  <div className="text-sm font-semibold">صورة المادة</div>
                  <div className="text-xs text-slate-500">بعد الالتقاط تظهر لك شاشة التعديل للاقتصاص والتدوير.</div>
                  <div className="flex flex-wrap gap-2">
                    {/* Camera */}
                    <Button type="button" variant="outline" asChild className="gap-1.5">
                      <label className="cursor-pointer">
                        📷 كاميرا
                        <input
                          className="hidden"
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={async (event) => {
                            const file = event.target.files?.[0]
                            if (!file) return
                            event.target.value = ""
                            const dataUrl = await readFileAsDataUrl(file)
                            setCropSrc(dataUrl)
                          }}
                        />
                      </label>
                    </Button>

                    {/* File picker */}
                    <Button type="button" variant="outline" asChild className="gap-1.5">
                      <label className="cursor-pointer">
                        📁 اختيار صورة
                        <input
                          className="hidden"
                          type="file"
                          accept="image/*"
                          onChange={async (event) => {
                            const file = event.target.files?.[0]
                            if (!file) return
                            event.target.value = ""
                            const dataUrl = await readFileAsDataUrl(file)
                            setCropSrc(dataUrl)
                          }}
                        />
                      </label>
                    </Button>

                    {/* Edit existing */}
                    {form.imageUrl && (
                      <Button type="button" variant="outline" className="gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                        onClick={async () => setCropSrc(await toEditableSrc(form.imageUrl!))}>
                        ✂️ تعديل الصورة
                      </Button>
                    )}

                    {/* Delete */}
                    {form.imageUrl && (
                      <Button type="button" variant="outline" className="text-red-500 hover:bg-red-50 border-red-200"
                        onClick={() => setForm({ ...form, imageUrl: null })}>
                        🗑️ حذف
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── الفئات والأنواع (متعددة) ─────────────────────────────── */}
            <div className="col-span-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-3 dark:border-indigo-900 dark:bg-indigo-950/20">
              <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">
                الفئات والأنواع — يمكن اختيار أكثر من فئة وأكثر من نوع
              </p>

              {catalogCats.length === 0 ? (
                <div className="space-y-1.5">
                  <Field label="الفئة">
                    <Input
                      placeholder="مثلاً: مشروبات"
                      value={form.category ?? ""}
                      onChange={(event) => setForm({ ...form, category: event.target.value })}
                    />
                  </Field>
                  <p className="text-[11px] text-indigo-500">
                    لإضافة قائمة فئات وأنواع: اضغط زر «إدارة الفئات» بأعلى صفحة المخزون.
                  </p>
                </div>
              ) : (
                <>
                  {/* ── Category chips (multi-select) ── */}
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                      الفئة الرئيسية (اختر واحدة أو أكثر):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {catalogCats.map(c => {
                        const sel = (form.categoryTags ?? []).includes(c.name)
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              const tags = form.categoryTags ?? []
                              const newTags = sel ? tags.filter(t => t !== c.name) : [...tags, c.name]
                              // Remove typeTags that belong only to the removed category
                              const remainingCats = catalogCats.filter(x => newTags.includes(x.name))
                              const validTypes = new Set(remainingCats.flatMap(x => x.types))
                              const newTypeTags = (form.typeTags ?? []).filter(t => validTypes.has(t))
                              setForm({
                                ...form,
                                category: newTags[0] ?? "",
                                categoryTags: newTags,
                                typeTags: newTypeTags,
                              })
                            }}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                              sel
                                ? "border-indigo-500 bg-indigo-600 text-white"
                                : "border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:bg-slate-900 dark:text-indigo-300"
                            }`}
                          >
                            {c.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* ── Type chips from selected categories (multi-select) ── */}
                  {(() => {
                    const selCats = catalogCats.filter(c => (form.categoryTags ?? []).includes(c.name))
                    const allTypes = [...new Set(selCats.flatMap(c => c.types))].sort()
                    if (!allTypes.length) return null
                    return (
                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold text-violet-600 dark:text-violet-400">
                          النوع (اختر واحداً أو أكثر):
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {allTypes.map(t => {
                            const sel = (form.typeTags ?? []).includes(t)
                            return (
                              <button
                                key={t}
                                type="button"
                                onClick={() => {
                                  const tags = form.typeTags ?? []
                                  setForm({
                                    ...form,
                                    typeTags: sel ? tags.filter(x => x !== t) : [...tags, t],
                                  })
                                }}
                                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                                  sel
                                    ? "border-violet-500 bg-violet-600 text-white"
                                    : "border-violet-200 bg-white text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:bg-slate-900 dark:text-violet-300"
                                }`}
                              >
                                {t}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  {/* ── Summary chips ── */}
                  {((form.categoryTags ?? []).length > 0 || (form.typeTags ?? []).length > 0) && (
                    <div className="flex flex-wrap gap-1.5 border-t border-indigo-100 pt-2 dark:border-indigo-800">
                      <span className="text-[10px] text-slate-400 self-center">المحدد:</span>
                      {(form.categoryTags ?? []).map(t => (
                        <span key={t} className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700 dark:bg-indigo-900/40">{t}</span>
                      ))}
                      {(form.typeTags ?? []).map(t => (
                        <span key={t} className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-900/40">{t}</span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="col-span-2 mt-1 flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 text-sm font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">2</span>
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">الكمية والمخزون</p>
                <p className="text-[11px] text-slate-500">أدخل القطع المفردة والكراتين الموجودة حالياً.</p>
              </div>
            </div>
            <Field label="رصيد افتتاحي (قطع مفرّدة)" hint="عدد القطع المنفصلة الموجودة بالمخزن الآن">
              <Input type="number" value={form.openingBalancePcs ?? 0} onFocus={selectAllOnFocus} onChange={(event) => setForm({ ...form, openingBalancePcs: Number(event.target.value) })} />
            </Field>
            <Field label="الكراتين المتوفرة" hint="عدد الكراتين الكاملة بالمخزن">
              <Input type="number" value={form.cartonsAvailable ?? 0} onFocus={selectAllOnFocus} onChange={(event) => setForm({ ...form, cartonsAvailable: Number(event.target.value) })} />
            </Field>
            <Field label="عدد القطع داخل الكرتون" hint="مثلاً 24 = الكرتون يحوي 24 قطعة">
              <Input type="number" min={1} value={form.pcsPerCarton ?? 1} onFocus={selectAllOnFocus} onChange={(event) => setForm({ ...form, pcsPerCarton: Number(event.target.value) })} />
            </Field>
            <Field label="الحد الأدنى للتنبيه" hint="ينبّهك عند نزول المخزون لهذا الرقم">
              <Input type="number" value={form.minStock ?? 0} onFocus={selectAllOnFocus} onChange={(event) => setForm({ ...form, minStock: Number(event.target.value) })} />
            </Field>

            <div className="col-span-2 mt-1 flex items-center gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-sm font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">3</span>
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">الأسعار</p>
                <p className="text-[11px] text-slate-500">سعر الشراء والجملة والمفرد للقطعة الواحدة.</p>
              </div>
            </div>
            <Field label="سعر الشراء (للقطعة)">
              <Input type="number" value={form.purchasePrice ?? 0} onFocus={selectAllOnFocus} onChange={(event) => setForm({ ...form, purchasePrice: Number(event.target.value) })} />
            </Field>
            <Field label="سعر البيع (جملة — للقطعة)">
              <Input type="number" value={form.salePrice ?? 0} onFocus={selectAllOnFocus} onChange={(event) => setForm({ ...form, salePrice: Number(event.target.value) })} />
            </Field>
            <Field label="سعر المفرد (تجزئة — اختياري)">
              <Input type="number" value={form.retailPrice ?? 0} onFocus={selectAllOnFocus} onChange={(event) => setForm({ ...form, retailPrice: Number(event.target.value) })} />
            </Field>
          </div>

          {/* ── عرض الكتلوج: جديد / عرض ─────────────────────────────── */}
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-3 dark:border-amber-900 dark:bg-amber-950/20">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">عرض المادة في كتلوج الجملة</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, isNewArrival: !form.isNewArrival })}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  form.isNewArrival
                    ? "border-emerald-500 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                }`}
              >
                ✨ جديد
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, isOffer: !form.isOffer })}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  form.isOffer
                    ? "border-rose-500 bg-rose-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                }`}
              >
                🏷️ عليها عرض
              </button>
            </div>
            {form.isOffer && (
              <Field label="السعر القديم (يظهر مشطوب فوق السعر الحالي)" hint="اتركه فارغاً إذا ماكو سعر قديم">
                <Input
                  type="number"
                  value={form.oldPrice ?? ""}
                  onFocus={selectAllOnFocus}
                  onChange={(event) => setForm({ ...form, oldPrice: event.target.value === "" ? null : Number(event.target.value) })}
                  placeholder="مثال: 15000"
                />
              </Field>
            )}
          </div>

          <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            الكمية الإجمالية المحسوبة: <span className="font-bold">{totalQuantity}</span> قطعة
          </div>

          {/* Initial distribution across warehouses (only on create) */}
          {!editing && totalQuantity > 0 && branches.filter((b) => b.isActive).length > 1 && (() => {
            const distSum = Object.values(dist).reduce((s, v) => s + (Number(v) || 0), 0)
            const ok = distSum === totalQuantity
            return (
              <div className={`rounded-xl border p-3 space-y-2 ${ok ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-rose-300 bg-rose-50/50 dark:border-rose-800 dark:bg-rose-950/20"}`}>
                <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                  توزيع الكمية على المخازن <span className="text-rose-500">*</span> — إجباري: حدّد وين راحت كل قطعة (المجموع لازم يساوي الكمية الكلية)
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {branches.filter((b) => b.isActive).map((b) => (
                    <label key={b.id} className="text-xs">
                      <span className="mb-1 block text-slate-500">{b.name}</span>
                      <Input
                        type="number"
                        min={0}
                        value={dist[b.id] ?? ""}
                        onFocus={selectAllOnFocus}
                        onChange={(e) => setDist({ ...dist, [b.id]: Number(e.target.value) })}
                        placeholder="0"
                      />
                    </label>
                  ))}
                </div>
                <p className={`text-xs font-semibold ${ok ? "text-emerald-600" : "text-rose-600"}`}>
                  مجموع التوزيع: {distSum} / {totalQuantity} {ok ? "✓ مطابق" : "✗ يجب أن يساوي الكمية الكلية قبل الحفظ"}
                </p>
              </div>
            )
          })()}

          {/* Edit mode: editable per-warehouse distribution */}
          {editing && branches.filter((b) => b.isActive).length > 1 && (() => {
            const distSum = Object.values(dist).reduce((s, v) => s + (Number(v) || 0), 0)
            return (
              <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3 space-y-2 dark:border-sky-800 dark:bg-sky-950/20">
                <p className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                  توزيع المخزون على المخازن — عدّل الكمية في كل مخزن مباشرة
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {branches.filter((b) => b.isActive).map((b) => (
                    <label key={b.id} className="text-xs">
                      <span className="mb-1 block text-slate-500">{b.name}</span>
                      <Input
                        type="number"
                        min={0}
                        value={dist[b.id] ?? 0}
                        onFocus={selectAllOnFocus}
                        onChange={(e) => setDist({ ...dist, [b.id]: Number(e.target.value) })}
                        placeholder="0"
                      />
                    </label>
                  ))}
                </div>
                <p className="text-xs text-sky-700 dark:text-sky-400 font-semibold">
                  المجموع الكلي: {distSum} قطعة
                </p>
              </div>
            )
          })()}

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
            <div className="mb-3 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-200 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">4</span>
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100">الباركودات</p>
                <p className="text-[11px] text-slate-500">اختيارية — اتركها فارغة وسيولدها النظام تلقائياً.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <Field label="باركود القطعة" hint={editing ? "" : "اتركه فارغاً للتوليد التلقائي"}>
                <Input placeholder="تلقائي" value={form.qrCode ?? ""} onChange={(event) => setForm({ ...form, qrCode: event.target.value })} />
              </Field>
              <Field label="باركود الكرتون" hint={editing ? "" : "اتركه فارغاً للتوليد التلقائي"}>
                <Input placeholder="تلقائي" value={form.cartonQrCode ?? ""} onChange={(event) => setForm({ ...form, cartonQrCode: event.target.value })} />
              </Field>
            </div>
          </div>

          <div className="sticky bottom-0 z-20 -mx-4 border-t border-slate-200 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
            <Button className="h-12 w-full text-base" type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "جارٍ الحفظ..." : editing ? "تحديث المنتج" : "حفظ المنتج"}
            </Button>
          </div>
        </form>

        {/* Image editor — rendered INSIDE the dialog so Radix's modal pointer-events
            lock doesn't swallow clicks on the crop/save controls */}
        {cropSrc && (
          <ImageCropModal
            src={cropSrc}
            onCancel={() => setCropSrc(null)}
            onDone={async (croppedDataUrl) => {
              setCropSrc(null)
              try {
                // compress the cropped result before saving to form
                const resp = await fetch(croppedDataUrl)
                const blob = await resp.blob()
                const file = new File([blob], "cropped.jpg", { type: "image/jpeg" })
                const imageUrl = await compressProductImage(file)
                setForm((f) => ({ ...f, imageUrl }))
              } catch {
                // If compression fails for any reason, still keep the cropped image.
                setForm((f) => ({ ...f, imageUrl: croppedDataUrl }))
              }
            }}
          />
        )}
      </ModalForm>

      {!open ? (
        <Button
          onClick={startCreate}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-40 h-14 rounded-full px-6 text-base shadow-2xl md:hidden"
          aria-label="إضافة منتج جديد"
        >
          <Plus className="h-5 w-5" />
          إضافة منتج
        </Button>
      ) : null}

      <ConfirmDialog
        open={closeProductConfirm}
        title="خروج بدون حفظ؟"
        description="لم تحفظ المادة بعد."
        confirmLabel="خروج"
        onConfirm={() => { setCloseProductConfirm(false); setForm(emptyForm); setOpen(false) }}
        onCancel={() => setCloseProductConfirm(false)}
      />

      <ConfirmDialog
        open={!!deleteConfirm}
        title={`حذف "${deleteConfirm?.name ?? ""}"؟`}
        description="ستُحذف المادة من قائمة المواد لكنها تبقى مسجّلة في الفواتير القديمة."
        confirmLabel="حذف"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (!deleteConfirm) return
          deleteMutation.mutate(deleteConfirm.id, {
            onSuccess: () => setDeleteConfirm(null),
            onError: (e) => toast({ title: e instanceof Error ? e.message : "تعذر الحذف", variant: "destructive" }),
          })
        }}
        onCancel={() => setDeleteConfirm(null)}
      />

      <ConfirmDialog
        open={!!restoreConfirm}
        title={`استرجاع "${restoreConfirm?.name ?? ""}"؟`}
        description="ستعود المادة لقائمة المواد وتصبح متاحة للفواتير."
        confirmLabel="استرجاع"
        loading={restoreProductMutation.isPending}
        onConfirm={() => { if (restoreConfirm) restoreProductMutation.mutate(restoreConfirm.id) }}
        onCancel={() => setRestoreConfirm(null)}
      />

      {/* Recently deleted products (48h restore window) */}
      {(deletedProductsQuery.data?.length ?? 0) > 0 && (
        <div className="fixed bottom-20 left-4 z-30 w-72 rounded-xl border border-amber-200 bg-amber-50 shadow-lg dark:bg-amber-950/30">
          <button
            className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold text-amber-700 dark:text-amber-400"
            onClick={() => setTrashOpen((v) => !v)}
          >
            <span className="flex items-center gap-1.5">
              <Trash2 className="h-4 w-4" />
              محذوفات ({deletedProductsQuery.data?.length})
            </span>
            {trashOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {trashOpen && (
            <div className="max-h-52 overflow-y-auto border-t border-amber-200 px-3 py-2 space-y-1.5">
              {deletedProductsQuery.data?.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg bg-white dark:bg-slate-900 px-2.5 py-1.5 shadow-sm">
                  <span className="text-xs font-medium truncate max-w-[140px]">{p.name}</span>
                  <Button size="sm" variant="outline" className="h-6 px-2 text-xs gap-1 border-emerald-300 text-emerald-700"
                    onClick={() => setRestoreConfirm(p)}>
                    <Undo2 className="h-3 w-3" /> رجّع
                  </Button>
                </div>
              ))}
              <p className="text-center text-[10px] text-amber-600 py-1">الاسترجاع متاح خلال 48 ساعة</p>
            </div>
          )}
        </div>
      )}

      {/* Lightbox for product images */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-h-[90vh] max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightboxImage(null)}
              className="absolute -top-10 right-0 p-2 text-white hover:bg-white/20 rounded-lg transition"
              title="إغلاق (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="bg-white rounded-lg overflow-hidden shadow-2xl">
              <img src={lightboxImage.url} alt={lightboxImage.title} className="w-full h-auto object-contain max-h-[80vh]" />
              <div className="bg-slate-900 px-4 py-3 text-white text-sm font-medium text-center">
                {lightboxImage.title}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
