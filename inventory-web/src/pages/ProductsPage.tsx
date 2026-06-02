import { useMemo, useState, type FormEvent, type ReactNode } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { getBranches } from "../api/endpoints"
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import { Download, Edit, Eye, FileText, Plus, Printer, ScanQrCode } from "lucide-react"
import { useProducts } from "../hooks/useProducts"
import { productCartonSheetPdf, productPieceLabelPdf } from "../api/endpoints"
import type { Product, ProductPayload } from "../types/api"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { ModalForm } from "../components/ui/modal-form"
import { Badge } from "../components/ui/badge"

function stockOf(product: Product) {
  return product.currentStock ?? product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton
}

interface ProductFormState extends ProductPayload {
  branchId?: string
  floor?: string
}

const emptyForm: ProductFormState = {
  itemNumber: "",
  name: "",
  qrCode: "",
  cartonQrCode: "",
  category: "",
  openingBalancePcs: 0,
  cartonsAvailable: 0,
  pcsPerCarton: 1,
  purchasePrice: 0,
  salePrice: 0,
  minStock: 5,
  branchId: "",
  floor: "",
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
        <td><div class="item-image">QR</div></td>
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
    .item-image { width: 42px; height: 42px; margin: auto; display: grid; place-items: center; border-radius: 8px; background: #eef2ff; color: #4f46e5; font-weight: 800; font-size: 11px; }
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
</body>
</html>`

  downloadFile(`inventory-designed-${new Date().toISOString().slice(0, 10)}.html`, html, "text/html;charset=utf-8")
}

function moneyForExport(value: number | string | undefined | null) {
  return Number(value ?? 0).toLocaleString("en-US")
}

export function ProductsPage() {
  const navigate = useNavigate()
  const { productsQuery, createMutation, updateMutation } = useProducts()
  const branchesQuery = useQuery({ queryKey: ["branches"], queryFn: () => getBranches() })
  const branches = branchesQuery.data ?? []
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const [lowOnly, setLowOnly] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductFormState>(emptyForm)
  const products = productsQuery.data ?? []
  const categories = Array.from(new Set(products.map((item) => item.category).filter(Boolean) as string[]))

  const filtered = products.filter((product) => {
    const matchesSearch =
      query.trim() === "" ||
      product.name.toLowerCase().includes(query.toLowerCase()) ||
      product.itemNumber.toLowerCase().includes(query.toLowerCase()) ||
      product.qrCode?.toLowerCase().includes(query.toLowerCase())
    const matchesCategory = category === "all" || product.category === category
    const matchesLow = !lowOnly || stockOf(product) <= product.minStock
    return matchesSearch && matchesCategory && matchesLow
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
    data: filtered,
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

  function startEdit(product: Product) {
    setEditing(product)
    setForm({
      itemNumber: product.itemNumber,
      name: product.name,
      qrCode: product.qrCode ?? "",
      cartonQrCode: product.cartonQrCode ?? "",
      category: product.category ?? "",
      openingBalancePcs: product.openingBalancePcs,
      cartonsAvailable: product.cartonsAvailable,
      pcsPerCarton: product.pcsPerCarton,
      purchasePrice: product.purchasePrice,
      salePrice: product.salePrice,
      minStock: product.minStock,
      branchId: "",
      floor: "",
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
      category: form.category?.trim() || undefined,
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
          <div className="grid gap-3 lg:grid-cols-[1fr_220px_180px]">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالاسم أو رقم الآيتم أو الباركود" />
            <select className="h-10 rounded-md border border-slate-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">كل الفئات</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 dark:border-slate-700">
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
                        <p className={`font-bold text-gray-900 ${isOut ? "line-through text-gray-400" : ""}`}>{p.name}</p>
                        <p className="text-xs text-gray-500 font-mono">{p.itemNumber}</p>
                      </td>
                      <td className="py-2 px-3 border-l border-gray-200 text-center text-xs text-gray-500">{p.category ?? "—"}</td>
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
                  <td colSpan={3} className="py-3 px-4 text-xs">الإجماليات ({filtered.length} صنف):</td>
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

      <ModalForm open={open} onOpenChange={setOpen} title={editing ? "تعديل منتج" : "إضافة منتج جديد"}>
        <form className="space-y-4" onSubmit={submit}>
          <div className="rounded-md bg-sky-50 p-3 text-xs text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
            <FileText className="ml-1 inline h-3.5 w-3.5" />
            اسم المنتج هو الحقل الوحيد المطلوب. بقية الحقول اختيارية — رقم الآيتم و QR يتولّدان تلقائياً إذا تركتهما فارغة.
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="اسم المنتج *">
              <Input required placeholder="مثلاً: سيارة بطارية" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label="الفئة (اختياري)">
              <Input placeholder="مثلاً: ألعاب" value={form.category ?? ""} onChange={(event) => setForm({ ...form, category: event.target.value })} />
            </Field>
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
                  value={form.floor ?? ""}
                  onChange={(e) => setForm({ ...form, floor: e.target.value })}
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
