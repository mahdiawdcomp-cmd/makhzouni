import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { getBranches, importProductsExcel, getImportTemplateUrl, getCatalogCategories } from "../api/endpoints"
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { Download, Edit, Eye, FileText, Plus, Printer, ScanQrCode, Upload } from "lucide-react"
import { useProducts } from "../hooks/useProducts"
import { productCartonSheetPdf, productPieceLabelPdf } from "../api/endpoints"
import type { Product, ProductPayload, CatalogCategory } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { ModalForm } from "../components/ui/modal-form"
import { Badge } from "../components/ui/badge"

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
  openingBalancePcs: 0,
  cartonsAvailable: 0,
  pcsPerCarton: 1,
  purchasePrice: 0,
  salePrice: 0,
  minStock: 5,
  branchId: "",
  storageLocation: "",
}

async function compressProductImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const maxSide = 900
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Image compression failed")
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.82)
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
    "الحد الأدنى", "QR قطعة", "QR كرتونة",
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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { productsQuery, createMutation, updateMutation } = useProducts()
  const branchesQuery = useQuery({ queryKey: ["branches"], queryFn: () => getBranches() })
  const branches = branchesQuery.data ?? []
  const catalogCatsQuery = useQuery({ queryKey: ["catalog-categories"], queryFn: getCatalogCategories })
  const catalogCats: CatalogCategory[] = catalogCatsQuery.data ?? []
  const branchName = (branchId?: string | null) =>
    branchId ? branches.find((branch) => branch.id === branchId)?.name ?? "مخزن غير معروف" : "المخزن الرئيسي"
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [lowOnly, setLowOnly] = useState(false)
  const [missingFilter, setMissingFilter] = useState<"all" | "any" | "purchasePrice" | "salePrice" | "stock" | "category">("all")
  const [sortBy, setSortBy] = useState<ProductSort>("updatedDesc")
  const [sorting, setSorting] = useState<SortingState>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductFormState>(emptyForm)
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
      query.trim() === "" ||
      product.name.toLowerCase().includes(query.toLowerCase()) ||
      product.itemNumber.toLowerCase().includes(query.toLowerCase()) ||
      product.qrCode?.toLowerCase().includes(query.toLowerCase())
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
            <Button variant="outline" className="h-8 px-2" title="طباعة QR قطعة (2×2 سم)" onClick={() => void printPiece(row.original.id)}>
              <ScanQrCode className="h-4 w-4" />
            </Button>
            <Button variant="outline" className="h-8 px-2" title="طباعة QR كرتون (A4، 6 لاصقات)" onClick={() => void printCarton(row.original.id)}>
              <Printer className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [navigate],
  )

  const table = useReactTable({
    data: sortedProducts,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  function startCreate() {
    setEditing(null)
    setForm(emptyForm)
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
    setForm({
      itemNumber: product.itemNumber,
      name: product.name,
      qrCode: product.qrCode ?? "",
      cartonQrCode: product.cartonQrCode ?? "",
      imageUrl: product.imageUrl ?? null,
      category: product.category ?? "",
      categoryTags: product.categoryTags ?? [],
      typeTags: product.typeTags ?? [],
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
    const mutation = editing
      ? updateMutation.mutateAsync({ id: editing.id, payload })
      : createMutation.mutateAsync(payload)
    mutation.then(() => setOpen(false))
  }

  const totalQuantity =
    (form.openingBalancePcs ?? 0) + (form.cartonsAvailable ?? 0) * (form.pcsPerCarton ?? 1)

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold">المخزن</h1>
          <p className="text-slate-500">إدارة المنتجات و QR والمخزون.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/inventory/low-stock">المخزون الناقص</Link>
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
          <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800">
            <Upload className="h-4 w-4" />
            استيراد Excel
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                try {
                  const res = await importProductsExcel(file)
                  alert(`✓ تم استيراد ${res.created} منتج. تم تخطي ${res.skipped}.${res.errors.length ? `\nأخطاء:\n${res.errors.slice(0,5).join("\n")}` : ""}`)
                  e.target.value = ""
                } catch { alert("✗ فشل الاستيراد") }
              }}
            />
          </label>
          <a
            href={getImportTemplateUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800"
          >
            <Download className="h-4 w-4" /> قالب Excel
          </a>
          <Button onClick={startCreate}>
            <Plus className="h-4 w-4" />
            منتج جديد
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>جدول المنتجات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_200px_220px]">
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
          <div className="flex flex-wrap items-center gap-3">
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
          {/* ── Excel-style inventory table ── */}
          <div className="overflow-x-auto rounded-lg border border-gray-300 shadow-inner">
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
                          <ProductThumb product={p} />
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
                        <div className="font-semibold text-slate-700">{branchName(p.branchId)}</div>
                        {p.storageLocation ? <div className="text-slate-500">{p.storageLocation}</div> : null}
                      </td>
                      <td className="py-2 px-3 border-l border-gray-200 text-center font-bold text-blue-700 bg-blue-50/30">{p.cartonsAvailable}</td>
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
                          <Button variant="outline" className="h-7 w-7 p-0" title="QR قطعة" onClick={() => void printPiece(p.id)}><ScanQrCode className="h-3.5 w-3.5" /></Button>
                          <Button variant="outline" className="h-7 w-7 p-0" title="QR كرتون" onClick={() => void printCarton(p.id)}><Printer className="h-3.5 w-3.5" /></Button>
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
          <div className="flex items-center justify-between">
            <Button variant="outline" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>السابق</Button>
            <span className="text-sm text-slate-500">صفحة {table.getState().pagination.pageIndex + 1} من {table.getPageCount() || 1} — {filtered.length} منتج</span>
            <Button variant="outline" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>التالي</Button>
          </div>
        </CardContent>
      </Card>

      <ModalForm
        open={open}
        onOpenChange={(v) => {
          if (!v && !editing && form.name.trim()) {
            if (!window.confirm("لم تحفظ المادة بعد. هل تريد الخروج بدون حفظ؟")) return
            setForm(emptyForm)
          }
          setOpen(v)
        }}
        title={editing ? "تعديل منتج" : "إضافة منتج جديد"}
      >
        <form className="space-y-4" onSubmit={submit}>
          <div className="rounded-md bg-sky-50 p-3 text-xs text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            <FileText className="ml-1 inline h-3.5 w-3.5" />
            اسم المنتج هو الحقل الوحيد المطلوب. بقية الحقول اختيارية — رقم الآيتم و QR يتولّدان تلقائياً إذا تركتهما فارغة.
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center gap-3">
                {form.imageUrl ? (
                  <img src={form.imageUrl} alt={form.name || "صورة المادة"} className="h-20 w-20 rounded-xl object-cover ring-1 ring-slate-200" />
                ) : (
                  <div className="grid h-20 w-20 place-items-center rounded-xl bg-white text-xs font-bold text-slate-400 ring-1 ring-slate-200 dark:bg-slate-950">صورة</div>
                )}
                <div className="flex-1 space-y-2">
                  <div className="text-sm font-semibold">صورة المادة</div>
                  <div className="text-xs text-slate-500">تنضغط تلقائياً بحجم مناسب حتى تبقى واضحة وما تثقل النظام.</div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" asChild>
                      <label className="cursor-pointer">
                        اختيار صورة
                        <input
                          className="hidden"
                          type="file"
                          accept="image/*"
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            if (!file) return
                            void compressProductImage(file).then((imageUrl) => setForm((current) => ({ ...current, imageUrl })))
                            event.target.value = ""
                          }}
                        />
                      </label>
                    </Button>
                    {form.imageUrl ? (
                      <Button type="button" variant="outline" onClick={() => setForm({ ...form, imageUrl: null })}>حذف الصورة</Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
            <Field label="اسم المنتج *">
              <Input required placeholder="مثلاً: سيارة بطارية" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label="الفئة (اختياري)">
              <Input placeholder="مثلاً: ألعاب" value={form.category ?? ""} onChange={(event) => setForm({ ...form, category: event.target.value })} />
            </Field>

            {/* ── Multi-category tags ────────────────────────────────────── */}
            {catalogCats.length > 0 && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3 space-y-3 dark:border-indigo-900 dark:bg-indigo-950/20">
                <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-400">الفئات المتعددة (للكتالوج)</p>

                {/* Category chips */}
                <div className="flex flex-wrap gap-2">
                  {catalogCats.map((cat) => {
                    const selected = (form.categoryTags ?? []).includes(cat.name)
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          const tags = form.categoryTags ?? []
                          setForm({
                            ...form,
                            categoryTags: selected ? tags.filter(t => t !== cat.name) : [...tags, cat.name],
                            // remove typeTags that no longer belong to any selected category
                            typeTags: selected
                              ? (form.typeTags ?? []).filter(t => {
                                  const remaining = tags.filter(tt => tt !== cat.name)
                                  return remaining.some(cn => catalogCats.find(c => c.name === cn)?.types.includes(t))
                                })
                              : form.typeTags,
                          })
                        }}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          selected
                            ? "border-indigo-500 bg-indigo-600 text-white"
                            : "border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50"
                        }`}
                      >
                        {cat.name}
                      </button>
                    )
                  })}
                </div>

                {/* Types based on selected categories */}
                {(() => {
                  const selectedCats = catalogCats.filter(c => (form.categoryTags ?? []).includes(c.name))
                  const allTypes = [...new Set(selectedCats.flatMap(c => c.types))].sort()
                  if (!allTypes.length) return null
                  return (
                    <div>
                      <p className="text-xs font-medium text-indigo-600 mb-1.5">الأنواع</p>
                      <div className="flex flex-wrap gap-2">
                        {allTypes.map((t) => {
                          const selType = (form.typeTags ?? []).includes(t)
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => {
                                const tags = form.typeTags ?? []
                                setForm({ ...form, typeTags: selType ? tags.filter(x => x !== t) : [...tags, t] })
                              }}
                              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                                selType
                                  ? "border-violet-500 bg-violet-600 text-white"
                                  : "border-violet-200 bg-white text-violet-600 hover:bg-violet-50"
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
              </div>
            )}
            <Field label="رقم الآيتم" hint={editing ? "" : "اتركه فارغاً ليتولّد تلقائياً (مثل AB0001)"}>
              <Input placeholder="تلقائي" value={form.itemNumber ?? ""} onChange={(event) => setForm({ ...form, itemNumber: event.target.value })} />
            </Field>
            <Field label="QR للقطعة" hint={editing ? "" : "اتركه فارغاً ليتولّد تلقائياً"}>
              <Input placeholder="تلقائي" value={form.qrCode ?? ""} onChange={(event) => setForm({ ...form, qrCode: event.target.value })} />
            </Field>
            <Field label="QR للكرتون" hint={editing ? "" : "اتركه فارغاً ليتولّد تلقائياً"}>
              <Input placeholder="تلقائي" value={form.cartonQrCode ?? ""} onChange={(event) => setForm({ ...form, cartonQrCode: event.target.value })} />
            </Field>
            <div className="hidden md:block" />

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

            <Field label="سعر الشراء (للقطعة)">
              <Input type="number" value={form.purchasePrice ?? 0} onFocus={selectAllOnFocus} onChange={(event) => setForm({ ...form, purchasePrice: Number(event.target.value) })} />
            </Field>
            <Field label="سعر البيع (للقطعة)">
              <Input type="number" value={form.salePrice ?? 0} onFocus={selectAllOnFocus} onChange={(event) => setForm({ ...form, salePrice: Number(event.target.value) })} />
            </Field>
          </div>

          <div className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            الكمية الإجمالية المحسوبة: <span className="font-bold">{totalQuantity}</span> قطعة
          </div>

          {/* Branch + Floor — optional */}
          <div className="rounded-md border border-dashed border-slate-300 p-3 dark:border-slate-700">
            <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-400">📦 موقع المخزن (اختياري)</p>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="الفرع / المخزن" hint="اتركه فارغاً للمخزن الرئيسي تلقائياً">
                <select
                  className="h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  value={form.branchId ?? ""}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                >
                  <option value="">🏢 المخزن الرئيسي (افتراضي)</option>
                  {branches.filter((b) => b.isActive).map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} ({branch.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="الطابق / القسم" hint="مثال: الطابق الأول، القسم A">
                <Input
                  placeholder="اختياري"
                  value={form.storageLocation ?? ""}
                  onChange={(e) => setForm({ ...form, storageLocation: e.target.value })}
                />
              </Field>
            </div>
          </div>

          <Button className="w-full" type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
            {editing ? "تحديث" : "حفظ"}
          </Button>
        </form>
      </ModalForm>
    </div>
  )
}
