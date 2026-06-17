import { useRef, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { ArrowRightLeft, Plus, Search, X } from "lucide-react"

import { getTransfers, createTransfer, getBranches, getProducts, createBranch } from "../api/endpoints"
import type { InventoryTransfer } from "../api/endpoints"
import type { Product } from "../types/api"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Label } from "../components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { Badge } from "../components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { toast } from "../components/ui/use-toast"
import { fmt } from "../utils/fmt"

export function TransfersPage() {
  const queryClient = useQueryClient()
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const { data: transfers, isLoading } = useQuery({
    queryKey: ["transfers"],
    queryFn: () => getTransfers(),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">التحويلات المخزنية</h1>
          <p className="text-slate-500">نقل المواد بين الفروع والمخازن.</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="h-4 w-4" /> تحويل جديد
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>جدول التحويلات</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead>
                <tr>
                  <th className="px-5 py-3 text-right font-semibold text-slate-500 uppercase text-[11px] tracking-wide">رقم التحويل</th>
                  <th className="px-5 py-3 text-right font-semibold text-slate-500 uppercase text-[11px] tracking-wide">التاريخ</th>
                  <th className="px-5 py-3 text-right font-semibold text-slate-500 uppercase text-[11px] tracking-wide">من فرع</th>
                  <th className="px-5 py-3 text-right font-semibold text-slate-500 uppercase text-[11px] tracking-wide">إلى فرع</th>
                  <th className="px-5 py-3 text-right font-semibold text-slate-500 uppercase text-[11px] tracking-wide">المواد</th>
                  <th className="px-5 py-3 text-right font-semibold text-slate-500 uppercase text-[11px] tracking-wide">بواسطة</th>
                  <th className="px-5 py-3 text-right font-semibold text-slate-500 uppercase text-[11px] tracking-wide">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">جار التحميل...</td></tr>
                ) : transfers?.length === 0 ? (
                  <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">لا توجد تحويلات سابقة</td></tr>
                ) : transfers?.map((t: InventoryTransfer) => (
                  <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50 transition dark:border-slate-800 dark:hover:bg-slate-900">
                    <td className="px-5 py-3 font-mono text-xs font-semibold">{t.transferNumber}</td>
                    <td className="px-5 py-3 text-slate-500">{format(new Date(t.date), "yyyy-MM-dd HH:mm")}</td>
                    <td className="px-5 py-3 font-semibold text-red-600">{t.fromBranch?.name ?? "—"}</td>
                    <td className="px-5 py-3 font-semibold text-emerald-600">{t.toBranch?.name ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                        {t.items?.length ?? 0} {t.items?.length === 1 ? "مادة" : "مواد"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{t.creator?.name ?? "—"}</td>
                    <td className="px-5 py-3">
                      <Badge variant="success">مكتمل</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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

  // Product search state
  const [productSearch, setProductSearch] = useState("")
  const [searchOpen, setSearchOpen]       = useState(false)
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
    ? allProducts
        .filter((p) =>
          p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
          p.itemNumber.toLowerCase().includes(productSearch.toLowerCase()) ||
          (p.qrCode?.toLowerCase().includes(productSearch.toLowerCase()) ?? false)
        )
        .slice(0, 8)
    : []

  const mutation = useMutation({
    mutationFn: createTransfer,
    onSuccess: (res) => {
      toast({
        title: res?.message ?? "تم إرسال طلب التحويل للموافقة",
        description: res?.snapshot?.anyExceeds ? "⚠️ بعض الكميات أكبر من المتوفر في المصدر — ستظهر للمسؤول عند الموافقة." : undefined,
      })
      setFromBranchId(""); setToBranchId(""); setItems([]); setNotes("")
      onSuccess()
    },
    onError: (err: any) => {
      toast({ title: "خطأ", description: err.response?.data?.message ?? "فشل إرسال الطلب", variant: "destructive" })
    },
  })

  const branchMutation = useMutation({
    mutationFn: () => createBranch({
      name: newBranchName.trim(),
      code: newBranchCode.trim(),
      isActive: true,
    }),
    onSuccess: (res) => {
      toast({ title: "تم إنشاء المخزن" })
      setNewBranchName("")
      setNewBranchCode("")
      queryClient.invalidateQueries({ queryKey: ["branches"] })
      if (res.data?.id) setToBranchId(res.data.id)
    },
    onError: (err: any) => {
      toast({ title: "خطأ", description: err.response?.data?.message ?? "فشل إنشاء المخزن", variant: "destructive" })
    },
  })

  function pickProduct(product: Product) {
    setSelectedProduct(product)
    setProductSearch(product.name)
    setSearchOpen(false)
    setQty("1")
    setUnit("PIECE")
  }

  function clearProduct() {
    setSelectedProduct(null)
    setProductSearch("")
    setQty("1")
    setUnit("PIECE")
    setTimeout(() => searchRef.current?.focus(), 50)
  }

  function addItem() {
    if (!selectedProduct) return
    if (!fromBranchId) {
      toast({ title: "اختر المخزن المصدر أولاً", variant: "destructive" })
      return
    }
    const qtyNum = parseInt(qty, 10)
    if (isNaN(qtyNum) || qtyNum <= 0) return
    const requestedPieces = unit === "CARTON"
      ? qtyNum * selectedProduct.pcsPerCarton
      : unit === "DOZEN" ? qtyNum * 12 : qtyNum
    const sourceStock = sourceStockOf(selectedProduct)
    if (requestedPieces > sourceStock) {
      toast({
        title: "الكمية أكبر من رصيد المخزن المصدر",
        description: `المتوفر ${sourceStock} قطعة`,
        variant: "destructive",
      })
      return
    }

    // Prevent duplicate
    if (items.some((i) => i.productId === selectedProduct.id)) {
      toast({ title: "المادة موجودة مسبقاً في القائمة", variant: "destructive" })
      return
    }

    setItems([...items, {
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      itemNumber: selectedProduct.itemNumber,
      quantity: qtyNum,
      unit,
      currentStock: sourceStockOf(selectedProduct),
      pcsPerCarton: selectedProduct.pcsPerCarton,
    }])
    clearProduct()
  }

  function removeItem(productId: string) {
    setItems(items.filter((i) => i.productId !== productId))
  }

  function handleSave() {
    if (!fromBranchId || !toBranchId) {
      toast({ title: "اختر الفرع المصدر والهدف", variant: "destructive" })
      return
    }
    if (fromBranchId === toBranchId) {
      toast({ title: "الفرع المصدر والهدف متطابقان", variant: "destructive" })
      return
    }
    if (items.length === 0) {
      toast({ title: "أضف مادة واحدة على الأقل", variant: "destructive" })
      return
    }
    mutation.mutate({
      fromBranchId,
      toBranchId,
      notes: notes || undefined,
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
                    <SelectItem key={b.id} value={b.id} disabled={b.id === toBranchId}>
                      {b.name}
                    </SelectItem>
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
                    <SelectItem key={b.id} value={b.id} disabled={b.id === fromBranchId}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
            <Label>إضافة مخزن/فرع ثاني سريعاً</Label>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_140px_auto]">
              <Input
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="مثال: المخزن الرئيسي"
              />
              <Input
                value={newBranchCode}
                onChange={(e) => setNewBranchCode(e.target.value)}
                placeholder="كود"
              />
              <Button
                type="button"
                variant="outline"
                disabled={!newBranchName.trim() || !newBranchCode.trim() || branchMutation.isPending}
                onClick={() => branchMutation.mutate()}
              >
                <Plus className="h-4 w-4" /> إضافة
              </Button>
            </div>
          </div>

          {/* Product search — searchable text box */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900 space-y-3">
            <Label>إضافة مادة</Label>

            {/* Search box */}
            <div className="relative">
              <div className="relative flex items-center">
                <Search className="absolute right-3 h-4 w-4 text-slate-400 pointer-events-none" />
                <Input
                  ref={searchRef}
                  className="pr-9"
                  placeholder="ابحث بالاسم أو رقم الآيتم أو الباركود..."
                  value={productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value)
                    setSelectedProduct(null)
                    setSearchOpen(true)
                  }}
                  onFocus={() => { if (productSearch) setSearchOpen(true) }}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && productSuggestions.length > 0) {
                      pickProduct(productSuggestions[0])
                    }
                    if (e.key === "Escape") setSearchOpen(false)
                  }}
                />
                {productSearch && (
                  <button
                    type="button"
                    className="absolute left-2 rounded p-1 text-slate-400 hover:text-slate-600"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={clearProduct}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Suggestions dropdown */}
              {searchOpen && productSuggestions.length > 0 && (
                <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-950">
                  {productSuggestions.map((product) => {
                    const stock = sourceStockOf(product)
                    const isLow = stock <= product.minStock && stock > 0
                    const isOut = stock <= 0
                    return (
                      <button
                        key={product.id}
                        type="button"
                        className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-right text-sm hover:bg-blue-50 dark:border-slate-800 dark:hover:bg-blue-950/20"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickProduct(product)}
                      >
                        <div className="flex-1">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{product.name}</div>
                          <div className="text-xs text-slate-500">{product.itemNumber}</div>
                        </div>
                        <div className="text-left shrink-0">
                          <div className={`text-xs font-bold ${isOut ? "text-red-600" : isLow ? "text-amber-600" : "text-emerald-600"}`}>
                            {fmt(stock)} ق
                          </div>
                          <div className="text-[10px] text-slate-400">{product.cartonsAvailable} كرتون</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Selected product + qty + unit */}
            {selectedProduct ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-blue-900 dark:text-blue-100">{selectedProduct.name}</span>
                  <span className="text-xs text-blue-600">{selectedProduct.itemNumber}</span>
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-xs mb-1 block">الكمية</Label>
                    <Input
                      type="number"
                      min="1"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      onFocus={(e) => e.target.select()}
                      autoFocus
                    />
                  </div>
                  <div className="w-32">
                    <Label className="text-xs mb-1 block">الوحدة</Label>
                    <select
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value as "PIECE" | "DOZEN" | "CARTON")}
                    >
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

          {/* Added items list */}
          {items.length > 0 && (
            <div className="space-y-2">
              <Label>المواد المضافة ({items.length})</Label>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                {items.map((item) => {
                  const unitLabel = item.unit === "CARTON" ? "كرتونة" : item.unit === "DOZEN" ? "درزن" : "قطعة"
                  return (
                    <div key={item.productId} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <div className="font-semibold text-sm">{item.productName}</div>
                        <div className="text-xs text-slate-500">{item.itemNumber} · متوفر: {fmt(item.currentStock)}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold dark:bg-slate-800">
                          {item.quantity} {unitLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeItem(item.productId)}
                          className="rounded p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
                        >
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

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={mutation.isPending}>
              {mutation.isPending ? "جار الحفظ..." : "✓ تأكيد التحويل"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
