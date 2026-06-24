import { useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { ArchiveX, ArrowRightLeft, ChevronLeft, ChevronRight, Eye, Plus, Search, X } from "lucide-react"
import { Link } from "react-router-dom"

import { getTransfers, createTransfer, getBranches, getProducts, createBranch } from "../api/endpoints"
import type { InventoryTransfer } from "../api/endpoints"
import type { Product } from "../types/api"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Label } from "../components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { toast } from "../components/ui/use-toast"
import { fmt } from "../utils/fmt"
import { usePageTitle } from "../hooks/usePageTitle"

function unitLabel(u: string) {
  if (u === "CARTON") return "كرتونة"
  if (u === "DOZEN") return "درزن"
  return "قطعة"
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Transfer Detail Dialog
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function TransferDetailDialog({
  transfer,
  onClose,
}: {
  transfer: InventoryTransfer | null
  onClose: () => void
}) {
  if (!transfer) return null
  return (
    <Dialog open={Boolean(transfer)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-indigo-600" />
            تفاصيل التحويل — {transfer.transferNumber}
          </DialogTitle>
        </DialogHeader>

        {/* Header info */}
        <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-900">
          <div>
            <div className="text-xs text-slate-500">من مخزن</div>
            <div className="font-bold text-rose-600">{transfer.fromBranch?.name ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">إلى مخزن</div>
            <div className="font-bold text-emerald-600">{transfer.toBranch?.name ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">التاريخ</div>
            <div className="font-semibold">{format(new Date(transfer.date), "yyyy-MM-dd HH:mm")}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">بواسطة</div>
            <div className="font-semibold">{transfer.creator?.name ?? "—"}</div>
          </div>
          {transfer.notes && (
            <div className="col-span-2">
              <div className="text-xs text-slate-500">ملاحظات</div>
              <div className="font-semibold">{transfer.notes}</div>
            </div>
          )}
        </div>

        {/* Items table */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="border-b bg-slate-50 px-4 py-2.5 font-semibold text-sm dark:bg-slate-900">
            المواد المحوّلة ({transfer.items.length})
          </div>
          <Table>
            <THead>
              <TR>
                <TH>المادة</TH>
                <TH>رقم الآيتم</TH>
                <TH>الكمية</TH>
                <TH>الوحدة</TH>
                <TH>بالقطعة</TH>
              </TR>
            </THead>
            <TBody>
              {transfer.items.map((item) => {
                const pcs = item.unit === "CARTON"
                  ? item.quantity * item.product.pcsPerCarton
                  : item.unit === "DOZEN" ? item.quantity * 12 : item.quantity
                return (
                  <TR key={item.id}>
                    <TD className="font-semibold">{item.product.name}</TD>
                    <TD className="font-mono text-xs text-slate-500">{item.product.itemNumber}</TD>
                    <TD className="font-bold">{fmt(item.quantity)}</TD>
                    <TD>{unitLabel(item.unit)}</TD>
                    <TD className="text-slate-500">{fmt(pcs)} ق</TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Main Page
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const PAGE_SIZE = 20

export function TransfersPage() {
  usePageTitle("التحويلات")
  const queryClient = useQueryClient()
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selected, setSelected] = useState<InventoryTransfer | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [page, setPage] = useState(1)

  const { data: transfers = [], isLoading } = useQuery({
    queryKey: ["transfers"],
    queryFn: () => getTransfers({ limit: 5000 }),
  })

  const filtered = transfers.filter((t) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      t.transferNumber.toLowerCase().includes(q) ||
      t.fromBranch?.name.toLowerCase().includes(q) ||
      t.toBranch?.name.toLowerCase().includes(q) ||
      t.creator?.name.toLowerCase().includes(q) ||
      t.items.some(
        (i) =>
          i.product.name.toLowerCase().includes(q) ||
          i.product.itemNumber.toLowerCase().includes(q),
      )
    )
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const totalItems = transfers.reduce((s, t) => s + (t.items?.length ?? 0), 0)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">التحويلات المخزنية</h1>
          <p className="text-slate-500">نقل المواد بين الفروع والمخازن.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/inventory/stale"><ArchiveX className="h-4 w-4" /> المواد الراكدة</Link>
          </Button>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="h-4 w-4" /> تحويل جديد
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">إجمالي التحويلات</div>
            <div className="text-2xl font-bold">{transfers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">إجمالي سطور المواد</div>
            <div className="text-2xl font-bold">{totalItems}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-slate-500">نتائج البحث</div>
            <div className="text-2xl font-bold">{filtered.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <Input
          className="pr-9"
          placeholder="بحث برقم التحويل أو المخزن أو المادة..."
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
        />
        {searchQuery && (
          <button
            className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            onClick={() => { setSearchQuery(""); setPage(1) }}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardHeader><CardTitle>جدول التحويلات</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
          ) : paginated.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              {searchQuery ? "لا توجد نتائج لبحثك" : "لا توجد تحويلات سابقة"}
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>رقم التحويل</TH>
                  <TH>التاريخ</TH>
                  <TH>من مخزن</TH>
                  <TH>إلى مخزن</TH>
                  <TH>المواد</TH>
                  <TH>بواسطة</TH>
                  <TH>الحالة</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {paginated.map((t) => (
                  <TR
                    key={t.id}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/50"
                    onDoubleClick={() => setSelected(t)}
                  >
                    <TD className="font-mono text-xs font-semibold">{t.transferNumber}</TD>
                    <TD className="text-slate-500 text-xs">{format(new Date(t.date), "yyyy-MM-dd HH:mm")}</TD>
                    <TD className="font-semibold text-rose-600">{t.fromBranch?.name ?? "—"}</TD>
                    <TD className="font-semibold text-emerald-600">{t.toBranch?.name ?? "—"}</TD>
                    <TD>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                        {t.items?.length ?? 0} مادة
                      </span>
                    </TD>
                    <TD className="text-slate-500 text-xs">{t.creator?.name ?? "—"}</TD>
                    <TD>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        مكتمل
                      </span>
                    </TD>
                    <TD>
                      <Button variant="ghost" size="sm" onClick={() => setSelected(t)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronRight className="h-4 w-4" /> السابق
              </Button>
              <span className="text-sm text-slate-500">
                صفحة {page} من {totalPages} — {filtered.length} تحويل
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                التالي <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail dialog */}
      <TransferDetailDialog transfer={selected} onClose={() => setSelected(null)} />

      {/* Create dialog */}
      <CreateTransferDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSuccess={() => {
          setIsCreateOpen(false)
          queryClient.invalidateQueries({ queryKey: ["transfers"] })
        }}
      />
    </div>
  )
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Create Transfer Dialog
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface TransferItem {
  productId: string
  productName: string
  itemNumber: string
  quantity: number
  unit: "PIECE" | "DOZEN" | "CARTON"
  currentStock: number
  pcsPerCarton: number
}

function CreateTransferDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}) {
  const queryClient = useQueryClient()
  const [fromBranchId, setFromBranchId] = useState("")
  const [toBranchId, setToBranchId]     = useState("")
  const [notes, setNotes]               = useState("")
  const [items, setItems]               = useState<TransferItem[]>([])
  const [newBranchName, setNewBranchName] = useState("")
  const [newBranchCode, setNewBranchCode] = useState("")

  const [productSearch, setProductSearch] = useState("")
  const [searchOpen, setSearchOpen]       = useState(false)
  const [activeIndex, setActiveIndex]     = useState(0)
  const [qty, setQty]                     = useState("1")
  const [unit, setUnit]                   = useState<"PIECE" | "DOZEN" | "CARTON">("PIECE")
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const { data: branches } = useQuery({ queryKey: ["branches"], queryFn: () => getBranches() })
  const { data: allProducts = [] } = useQuery({
    queryKey: ["products", "transfer", fromBranchId],
    queryFn: () => getProducts({ limit: 10000 }),
  })

  const sourceStockOf = (product: Product) =>
    product.warehouseStocks?.find((stock) => stock.warehouseId === fromBranchId)?.quantityPieces ?? 0

  const productSuggestions = productSearch.trim().length >= 1
    ? allProducts.filter((p) =>
        p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
        p.itemNumber.toLowerCase().includes(productSearch.toLowerCase()) ||
        (p.qrCode?.toLowerCase().includes(productSearch.toLowerCase()) ?? false)
      ).slice(0, 8)
    : []

  const mutation = useMutation({
    mutationFn: createTransfer,
    onSuccess: (res) => {
      toast({
        title: res?.message ?? "تم إرسال طلب التحويل للموافقة",
        description: res?.snapshot?.anyExceeds ? "بعض الكميات أكبر من المتوفر في المصدر — ستظهر للمسؤول عند الموافقة." : undefined,
      })
      setFromBranchId(""); setToBranchId(""); setItems([]); setNotes("")
      onSuccess()
    },
    onError: (err: any) => {
      toast({ title: "خطأ", description: err.response?.data?.message ?? "فشل إرسال الطلب", variant: "destructive" })
    },
  })

  const branchMutation = useMutation({
    mutationFn: () => createBranch({ name: newBranchName.trim(), code: newBranchCode.trim(), isActive: true }),
    onSuccess: (res) => {
      toast({ title: "تم إنشاء المخزن" })
      setNewBranchName(""); setNewBranchCode("")
      queryClient.invalidateQueries({ queryKey: ["branches"] })
      if (res.data?.id) setToBranchId(res.data.id)
    },
    onError: (err: any) => {
      toast({ title: "خطأ", description: err.response?.data?.message ?? "فشل إنشاء المخزن", variant: "destructive" })
    },
  })

  function pickProduct(product: Product) {
    setSelectedProduct(product); setProductSearch(product.name)
    setSearchOpen(false); setQty("1"); setUnit("PIECE")
  }

  function clearProduct() {
    setSelectedProduct(null); setProductSearch("")
    setQty("1"); setUnit("PIECE")
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  function addItem() {
    if (!selectedProduct) return
    if (!fromBranchId) { toast({ title: "اختر المخزن المصدر أولاً", variant: "destructive" }); return }
    const qtyNum = parseInt(qty, 10)
    if (isNaN(qtyNum) || qtyNum <= 0) return
    const requestedPieces = unit === "CARTON"
      ? qtyNum * selectedProduct.pcsPerCarton
      : unit === "DOZEN" ? qtyNum * 12 : qtyNum
    const sourceStock = sourceStockOf(selectedProduct)
    if (requestedPieces > sourceStock) {
      toast({
        title: "تنبيه: الكمية أكبر من رصيد المخزن المصدر",
        description: `المتوفر ${sourceStock} قطعة — سيُرسل الطلب وتظهر الكمية الزائدة للمسؤول.`,
      })
    }
    const existingIdx = items.findIndex((i) => i.productId === selectedProduct.id && i.unit === unit)
    if (existingIdx >= 0) {
      setItems(items.map((it, idx) => (idx === existingIdx ? { ...it, quantity: it.quantity + qtyNum } : it)))
    } else {
      setItems([...items, {
        productId: selectedProduct.id, productName: selectedProduct.name,
        itemNumber: selectedProduct.itemNumber, quantity: qtyNum, unit,
        currentStock: sourceStock, pcsPerCarton: selectedProduct.pcsPerCarton,
      }])
    }
    clearProduct()
  }

  function removeItem(productId: string, itemUnit: string) {
    setItems(items.filter((i) => !(i.productId === productId && i.unit === itemUnit)))
  }

  function handleSave() {
    if (!fromBranchId || !toBranchId) { toast({ title: "اختر الفرع المصدر والهدف", variant: "destructive" }); return }
    if (fromBranchId === toBranchId) { toast({ title: "الفرع المصدر والهدف متطابقان", variant: "destructive" }); return }
    if (items.length === 0) { toast({ title: "أضف مادة واحدة على الأقل", variant: "destructive" }); return }
    mutation.mutate({
      fromBranchId, toBranchId, notes: notes || undefined,
      items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, unit: i.unit })),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" /> إنشاء تحويل مخزني
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Branches */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>من فرع (المصدر) <span className="text-red-500">*</span></Label>
              <Select value={fromBranchId} onValueChange={setFromBranchId}>
                <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent>
                  {branches?.map((b) => (
                    <SelectItem key={b.id} value={b.id} disabled={b.id === toBranchId}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>إلى فرع (الهدف) <span className="text-red-500">*</span></Label>
              <Select value={toBranchId} onValueChange={setToBranchId}>
                <SelectTrigger><SelectValue placeholder="اختر الفرع" /></SelectTrigger>
                <SelectContent>
                  {branches?.map((b) => (
                    <SelectItem key={b.id} value={b.id} disabled={b.id === fromBranchId}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <Label className="text-xs text-slate-500">إضافة مخزن جديد سريعاً</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <Input value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} placeholder="اسم المخزن" />
              <Input value={newBranchCode} onChange={(e) => setNewBranchCode(e.target.value)} placeholder="كود" />
              <Button type="button" variant="outline" disabled={!newBranchName.trim() || !newBranchCode.trim() || branchMutation.isPending} onClick={() => branchMutation.mutate()}>
                <Plus className="h-4 w-4" /> إضافة
              </Button>
            </div>
          </div>

          {/* Product search */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900 space-y-3">
            <Label>إضافة مادة</Label>
            <div className="relative">
              <div className="relative flex items-center">
                <Search className="absolute right-3 h-4 w-4 text-slate-400 pointer-events-none" />
                <Input
                  ref={searchRef}
                  className="pr-9"
                  placeholder="ابحث بالاسم أو رقم الآيتم أو الباركود..."
                  value={productSearch}
                  onChange={(e) => { setProductSearch(e.target.value); setSelectedProduct(null); setSearchOpen(true); setActiveIndex(0) }}
                  onFocus={() => { if (productSearch) setSearchOpen(true) }}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (!searchOpen || productSuggestions.length === 0) { if (e.key === "Escape") setSearchOpen(false); return }
                    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, productSuggestions.length - 1)) }
                    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)) }
                    else if (e.key === "Enter") { e.preventDefault(); pickProduct(productSuggestions[Math.min(activeIndex, productSuggestions.length - 1)] ?? productSuggestions[0]) }
                    else if (e.key === "Escape") setSearchOpen(false)
                  }}
                />
                {productSearch && (
                  <button type="button" className="absolute left-2 rounded p-1 text-slate-400 hover:text-slate-600" onMouseDown={(e) => e.preventDefault()} onClick={clearProduct}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {searchOpen && productSuggestions.length > 0 && (
                <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-950">
                  {productSuggestions.map((product, idx) => {
                    const stock = sourceStockOf(product)
                    const isOut = stock <= 0
                    const isLow = stock <= product.minStock && stock > 0
                    return (
                      <button
                        key={product.id}
                        type="button"
                        className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-right text-sm dark:border-slate-800 ${idx === activeIndex ? "bg-blue-100 dark:bg-blue-900/40" : "hover:bg-blue-50 dark:hover:bg-blue-950/20"}`}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickProduct(product)}
                      >
                        <div className="flex-1">
                          <div className="font-semibold">{product.name}</div>
                          <div className="text-xs text-slate-500">{product.itemNumber}</div>
                        </div>
                        <div className={`text-xs font-bold ${isOut ? "text-red-600" : isLow ? "text-amber-600" : "text-emerald-600"}`}>
                          {fmt(stock)} ق
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {selectedProduct ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-blue-900 dark:text-blue-100">{selectedProduct.name}</span>
                  <span className="text-xs text-blue-600">{selectedProduct.itemNumber}</span>
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-xs mb-1 block">الكمية</Label>
                    <Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} onFocus={(e) => e.target.select()} autoFocus />
                  </div>
                  <div className="w-32">
                    <Label className="text-xs mb-1 block">الوحدة</Label>
                    <select className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950" value={unit} onChange={(e) => setUnit(e.target.value as "PIECE" | "DOZEN" | "CARTON")}>
                      <option value="PIECE">قطعة</option>
                      <option value="DOZEN">درزن</option>
                      <option value="CARTON">كرتونة</option>
                    </select>
                  </div>
                  <Button onClick={addItem} className="shrink-0">إضافة</Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">اكتب اسم المادة أو رقم الآيتم للبحث عنها</p>
            )}
          </div>

          {/* Items list */}
          {items.length > 0 && (
            <div className="space-y-2">
              <Label>المواد المضافة ({items.length})</Label>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((item) => {
                  const reqPieces = item.unit === "CARTON" ? item.quantity * item.pcsPerCarton : item.unit === "DOZEN" ? item.quantity * 12 : item.quantity
                  const exceeds = reqPieces > item.currentStock
                  return (
                    <div key={`${item.productId}:${item.unit}`} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <div className="font-semibold text-sm">{item.productName}</div>
                        <div className="text-xs text-slate-500">{item.itemNumber} · متوفر: {fmt(item.currentStock)}</div>
                        {exceeds && <div className="text-xs font-semibold text-amber-600">الكمية أكبر من الرصيد ({fmt(reqPieces)} ق)</div>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold dark:bg-slate-800">
                          {item.quantity} {unitLabel(item.unit)}
                        </span>
                        <button type="button" onClick={() => removeItem(item.productId, item.unit)} className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>ملاحظات (اختياري)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات حول التحويل..." />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={mutation.isPending}>
              {mutation.isPending ? "جار الحفظ..." : "تأكيد التحويل"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
