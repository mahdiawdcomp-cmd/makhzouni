import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { ArrowRight, Download, Edit, Printer, ScanQrCode, Trash2 } from "lucide-react"
import { useQuery } from "@tanstack/react-query"

import { getCatalogCategories, productCartonSheetPdf, productPieceLabelPdf, productQrObjectUrl } from "../api/endpoints"
import { useProductDetails, useProducts } from "../hooks/useProducts"
import { fmt } from "../utils/fmt"
import type { CatalogCategory, Product, ProductPayload } from "../types/api"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { ModalForm } from "../components/ui/modal-form"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { RecordNavigator } from "../components/RecordNavigator"

function stockOf(product: Product) {
  return product.currentStock ?? product.openingBalancePcs + product.cartonsAvailable * product.pcsPerCarton
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

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 text-sm dark:border-slate-800">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-right">{value}</span>
    </div>
  )
}

async function openPdf(promise: Promise<string>) {
  const url = await promise
  window.open(url, "_blank", "noopener,noreferrer")
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const emptyEditForm: ProductPayload = {
  itemNumber: "", name: "", qrCode: "", cartonQrCode: "", imageUrl: null, category: "",
  categoryTags: [], typeTags: [],
  openingBalancePcs: 0, cartonsAvailable: 0, pcsPerCarton: 1,
  purchasePrice: 0, salePrice: 0, retailPrice: 0, costPrice: 0, minStock: 5,
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

export function ProductDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { productQuery, movementQuery } = useProductDetails(id)
  const { productsQuery, updateMutation } = useProducts()
  const product = productQuery.data
  const movements = movementQuery.data ?? []
  const orderedProductIds = useMemo(
    () => [...(productsQuery.data ?? [])]
      .sort((a, b) => {
        const timeDifference = new Date(a.createdAt ?? a.updatedAt ?? 0).getTime() - new Date(b.createdAt ?? b.updatedAt ?? 0).getTime()
        return timeDifference || a.id.localeCompare(b.id)
      })
      .map((row) => row.id),
    [productsQuery.data],
  )

  const catalogCatsQuery = useQuery({ queryKey: ["catalog-categories"], queryFn: getCatalogCategories })
  const catalogCats: CatalogCategory[] = catalogCatsQuery.data ?? []

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState<ProductPayload>(emptyEditForm)

  // Delete confirm state
  const [deleteOpen, setDeleteOpen] = useState(false)

  // QR piece
  const [pieceQrUrl, setPieceQrUrl] = useState<string | null>(null)
  // QR carton
  const [cartonQrUrl, setCartonQrUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!product?.id) return
    let active = true
    let objPiece: string | null = null
    let objCarton: string | null = null

    void productQrObjectUrl(product.id, "piece").then((url) => {
      objPiece = url
      if (active) setPieceQrUrl(url)
    })
    void productQrObjectUrl(product.id, "carton").then((url) => {
      objCarton = url
      if (active) setCartonQrUrl(url)
    }).catch(() => {/* carton QR might not exist */})

    return () => {
      active = false
      if (objPiece)  URL.revokeObjectURL(objPiece)
      if (objCarton) URL.revokeObjectURL(objCarton)
    }
  }, [product?.id])

  function startEdit() {
    if (!product) return
    setEditForm({
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
      retailPrice: product.retailPrice ?? 0,
      costPrice: product.costPrice ?? 0,
      minStock: product.minStock,
    })
    setEditOpen(true)
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault()
    if (!product?.id || !editForm.name) return
    updateMutation.mutateAsync({ id: product.id, payload: editForm }).then(() => {
      setEditOpen(false)
      void productQuery.refetch()
    })
  }

  if (!product) {
    return <div className="py-10 text-center text-slate-500">جار تحميل المنتج...</div>
  }

  const totalStock = stockOf(product)
  const isLow      = totalStock <= product.minStock && totalStock > 0
  const isOut      = totalStock <= 0
  const stockColor = isOut ? "text-red-600" : isLow ? "text-amber-600" : "text-emerald-600"
  const stockBadge = isOut
    ? <Badge variant="danger">نفذت الكمية</Badge>
    : isLow
      ? <Badge variant="warning">مخزون منخفض</Badge>
      : <Badge variant="success">متوفر</Badge>

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button variant="ghost" className="px-0 mb-1" onClick={() => navigate(-1)}>
            <ArrowRight className="h-4 w-4 ml-1" /> رجوع
          </Button>
          <h1 className="text-2xl font-bold">{product.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-sm font-mono text-slate-500">{product.itemNumber}</span>
            {product.category ? <Badge variant="secondary">{product.category}</Badge> : null}
            {stockBadge}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RecordNavigator currentId={id} orderedIds={orderedProductIds} onNavigate={(target) => navigate(`/inventory/${target}`)} noun="مادة" />
          <Button variant="outline" onClick={() => void openPdf(productPieceLabelPdf(product.id))}>
            <Printer className="h-4 w-4" /> طباعة الملصق
          </Button>
          <Button variant="outline" onClick={startEdit}>
            <Edit className="h-4 w-4" /> تعديل
          </Button>
          <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" /> حذف
          </Button>
        </div>
      </div>

      {product.imageUrl ? (
        <img src={product.imageUrl} alt={product.name} className="h-44 w-full rounded-xl object-cover ring-1 ring-slate-200 md:h-64" />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Product info */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>بيانات المنتج</CardTitle></CardHeader>
            <CardContent>
              {/* Category + type tags */}
              {((product.categoryTags ?? []).length > 0 || (product.typeTags ?? []).length > 0) && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {(product.categoryTags ?? []).map(t => (
                    <span key={t} className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{t}</span>
                  ))}
                  {(product.typeTags ?? []).map(t => (
                    <span key={t} className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">{t}</span>
                  ))}
                </div>
              )}
              <div className="grid gap-x-6 md:grid-cols-2">
                <div>
                  <InfoRow label="رقم الآيتم (SKU)" value={product.itemNumber} />
                  <InfoRow label="الفئة" value={product.category ?? "—"} />
                  <InfoRow label="سعر الشراء" value={`${fmt(product.purchasePrice)} د.ع`} />
                  <InfoRow label="سعر الكلفة" value={`${fmt(product.costPrice ?? 0)} د.ع`} />
                  <InfoRow label="سعر البيع (جملة)" value={`${fmt(product.salePrice)} د.ع`} />
                  <InfoRow label="سعر المفرد" value={`${fmt(product.retailPrice ?? 0)} د.ع`} />
                </div>
                <div>
                  <InfoRow label="الكراتين المتوفرة" value={product.cartonsAvailable} />
                  <InfoRow label="قطع بالكرتونة" value={product.pcsPerCarton} />
                  <InfoRow label="قطع مفردة" value={product.openingBalancePcs} />
                  <InfoRow label="حد التنبيه" value={product.minStock} />
                </div>
              </div>
              {/* Stock total */}
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600 dark:text-slate-400">إجمالي المخزون الحالي</span>
                  <span className={`text-2xl font-extrabold ${stockColor}`}>
                    {fmt(totalStock)} قطعة
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {product.cartonsAvailable} كرتونة × {product.pcsPerCarton} = {product.cartonsAvailable * product.pcsPerCarton} + {product.openingBalancePcs} مفردة
                </div>
              </div>

              {/* Warehouse breakdown */}
              {(product.warehouseStocks ?? []).length > 0 && (
                <div className="mt-3">
                  <div className="mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">توزيع المخزون بالمخازن</div>
                  <div className="space-y-2">
                    {(product.warehouseStocks ?? []).map((ws) => {
                      const pct = totalStock > 0 ? Math.round((ws.quantityPieces / totalStock) * 100) : 0
                      const wsLow = ws.quantityPieces <= (ws.minStock ?? product.minStock) && ws.quantityPieces > 0
                      const wsOut = ws.quantityPieces <= 0
                      return (
                        <div key={ws.warehouseId} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <span className="font-semibold text-sm">{ws.warehouse.name}</span>
                              <span className="mr-2 text-xs text-slate-400">{ws.warehouse.code}</span>
                              {ws.storageLocation && (
                                <span className="mr-1 text-xs text-blue-600">📍 {ws.storageLocation}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {wsOut
                                ? <Badge variant="danger">نفذت</Badge>
                                : wsLow
                                  ? <Badge variant="warning">منخفض</Badge>
                                  : <Badge variant="success">متوفر</Badge>
                              }
                              <span className={`font-bold text-base ${wsOut ? "text-red-600" : wsLow ? "text-amber-600" : "text-emerald-700"}`}>
                                {fmt(ws.quantityPieces)} ق
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${wsOut ? "bg-red-400" : wsLow ? "bg-amber-400" : "bg-emerald-500"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="mt-1 text-right text-[11px] text-slate-400">{pct}% من الإجمالي</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Movement table */}
          <Card>
            <CardHeader><CardTitle>حركة المادة</CardTitle></CardHeader>
            <CardContent>
              {movements.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">لا توجد حركات مسجّلة.</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>التاريخ</TH>
                      <TH>نوع الحركة</TH>
                      <TH>الجهة / المخزن</TH>
                      <TH>الكمية</TH>
                      <TH>الوحدة</TH>
                      <TH>سعر المفرد</TH>
                      <TH>المرجع</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {movements.map((row, i) => (
                      <TR
                        key={`${row.invoiceNumber}-${i}`}
                        className="cursor-pointer"
                        onClick={() => row.invoiceId && navigate(`/invoices/${row.invoiceId}`)}
                      >
                        <TD>{String(row.date).slice(0, 10)}</TD>
                        <TD>
                          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                            {row.movementLabel ?? row.movementType ?? "حركة"}
                          </span>
                        </TD>
                        <TD>{row.customerName}</TD>
                        <TD className="font-semibold">{row.quantity}</TD>
                        <TD>{row.unit ?? "قطعة"}</TD>
                        <TD>{row.unitPrice == null ? "—" : fmt(row.unitPrice ?? row.price ?? 0)}</TD>
                        <TD>
                          <span className={`font-mono text-xs ${row.invoiceId ? "text-blue-600" : "text-slate-500"}`}>
                            {row.invoiceNumber}
                          </span>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* QR Codes — right column */}
        <div className="space-y-4">
          {/* QR for piece */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScanQrCode className="h-5 w-5 text-blue-600" />
                رمز القطعة المفردة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {pieceQrUrl ? (
                <img
                  className="mx-auto h-40 w-40 rounded-lg border-2 border-slate-200 object-contain p-1"
                  src={pieceQrUrl}
                  alt="رمز القطعة"
                />
              ) : (
                <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-xs text-slate-400">
                  جار التحميل...
                </div>
              )}
              <p className="text-center text-xs font-mono text-slate-500">{product.qrCode ?? "—"}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 text-xs"
                  disabled={!pieceQrUrl}
                  onClick={() => void openPdf(productPieceLabelPdf(product.id))}
                >
                  <Printer className="h-3.5 w-3.5" /> طباعة ملصق
                </Button>
                {pieceQrUrl ? (
                  <Button variant="outline" className="flex-1 text-xs" asChild>
                    <a href={pieceQrUrl} download={`${product.itemNumber}-piece-qr.png`}>
                      <Download className="h-3.5 w-3.5" /> تحميل
                    </a>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* QR for carton */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScanQrCode className="h-5 w-5 text-amber-600" />
                رمز الكرتونة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cartonQrUrl ? (
                <img
                  className="mx-auto h-40 w-40 rounded-lg border-2 border-amber-200 object-contain p-1"
                  src={cartonQrUrl}
                  alt="رمز الكرتون"
                />
              ) : (
                <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-lg border-2 border-dashed border-amber-200 text-xs text-slate-400">
                  {product.cartonQrCode ? "جار التحميل..." : "لا يوجد رمز للكرتون"}
                </div>
              )}
              <p className="text-center text-xs font-mono text-slate-500">{product.cartonQrCode ?? "—"}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 text-xs"
                  disabled={!product.cartonQrCode}
                  onClick={() => void openPdf(productCartonSheetPdf(product.id))}
                >
                  <Printer className="h-3.5 w-3.5" /> A4 (6 ملصقات)
                </Button>
                {cartonQrUrl ? (
                  <Button variant="outline" className="flex-1 text-xs" asChild>
                    <a href={cartonQrUrl} download={`${product.itemNumber}-carton-qr.png`}>
                      <Download className="h-3.5 w-3.5" /> تحميل
                    </a>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit Modal */}
      <ModalForm open={editOpen} onOpenChange={setEditOpen} title="تعديل المنتج">
        <form className="space-y-4" onSubmit={submitEdit}>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap items-center gap-3">
              {editForm.imageUrl ? (
                <img src={editForm.imageUrl} alt={editForm.name || "صورة المادة"} className="h-20 w-20 rounded-xl object-cover ring-1 ring-slate-200" />
              ) : (
                <div className="grid h-20 w-20 place-items-center rounded-xl bg-white text-xs font-bold text-slate-400 ring-1 ring-slate-200 dark:bg-slate-950">صورة</div>
              )}
              <div className="flex-1 space-y-2">
                <div className="text-sm font-semibold">صورة المادة</div>
                <div className="text-xs text-slate-500">تنضغط تلقائياً قبل الحفظ.</div>
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
                          void compressProductImage(file).then((imageUrl) => setEditForm((current) => ({ ...current, imageUrl })))
                          event.target.value = ""
                        }}
                      />
                    </label>
                  </Button>
                  {editForm.imageUrl ? <Button type="button" variant="outline" onClick={() => setEditForm({ ...editForm, imageUrl: null })}>حذف الصورة</Button> : null}
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="اسم المنتج *">
              <Input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
            </Field>
            {catalogCats.length === 0 && (
              <Field label="الفئة">
                <Input value={editForm.category ?? ""} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
              </Field>
            )}
            {/* Multi-category + multi-type when catalog categories exist */}
            {catalogCats.length > 0 && (
              <div className="md:col-span-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-3 dark:border-indigo-900 dark:bg-indigo-950/20">
                <p className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-400">الفئات والأنواع</p>
                <div>
                  <p className="mb-1.5 text-[11px] text-indigo-600">الفئة (اختر واحدة أو أكثر):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {catalogCats.map(c => {
                      const sel = (editForm.categoryTags ?? []).includes(c.name)
                      return (
                        <button key={c.id} type="button"
                          onClick={() => {
                            const tags = editForm.categoryTags ?? []
                            const newTags = sel ? tags.filter(t => t !== c.name) : [...tags, c.name]
                            const remainingCats = catalogCats.filter(x => newTags.includes(x.name))
                            const validTypes = new Set(remainingCats.flatMap(x => x.types))
                            setEditForm({
                              ...editForm,
                              category: newTags[0] ?? "",
                              categoryTags: newTags,
                              typeTags: (editForm.typeTags ?? []).filter(t => validTypes.has(t)),
                            })
                          }}
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition ${sel ? "border-indigo-500 bg-indigo-600 text-white" : "border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:bg-slate-900"}`}
                        >{c.name}</button>
                      )
                    })}
                  </div>
                </div>
                {(() => {
                  const selCats = catalogCats.filter(c => (editForm.categoryTags ?? []).includes(c.name))
                  const allTypes = [...new Set(selCats.flatMap(c => c.types))].sort()
                  if (!allTypes.length) return null
                  return (
                    <div>
                      <p className="mb-1.5 text-[11px] text-violet-600">النوع (اختر واحداً أو أكثر):</p>
                      <div className="flex flex-wrap gap-1.5">
                        {allTypes.map(t => {
                          const sel = (editForm.typeTags ?? []).includes(t)
                          return (
                            <button key={t} type="button"
                              onClick={() => {
                                const tags = editForm.typeTags ?? []
                                setEditForm({ ...editForm, typeTags: sel ? tags.filter(x => x !== t) : [...tags, t] })
                              }}
                              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition ${sel ? "border-violet-500 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:bg-slate-900"}`}
                            >{t}</button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}
            <Field label="رقم الآيتم">
              <Input value={editForm.itemNumber ?? ""} onChange={(e) => setEditForm({ ...editForm, itemNumber: e.target.value })} />
            </Field>
            <Field label="رمز القطعة">
              <Input value={editForm.qrCode ?? ""} onChange={(e) => setEditForm({ ...editForm, qrCode: e.target.value })} />
            </Field>
            <Field label="رمز الكرتون">
              <Input value={editForm.cartonQrCode ?? ""} onChange={(e) => setEditForm({ ...editForm, cartonQrCode: e.target.value })} />
            </Field>
            <div className="hidden md:block" />
            <Field label="قطع مفردة">
              <Input type="number" value={editForm.openingBalancePcs ?? 0} onFocus={selectAllOnFocus} onChange={(e) => setEditForm({ ...editForm, openingBalancePcs: Number(e.target.value) })} />
            </Field>
            <Field label="الكراتين المتوفرة">
              <Input type="number" value={editForm.cartonsAvailable ?? 0} onFocus={selectAllOnFocus} onChange={(e) => setEditForm({ ...editForm, cartonsAvailable: Number(e.target.value) })} />
            </Field>
            <Field label="قطع بالكرتونة">
              <Input type="number" min={1} value={editForm.pcsPerCarton ?? 1} onFocus={selectAllOnFocus} onChange={(e) => setEditForm({ ...editForm, pcsPerCarton: Number(e.target.value) })} />
            </Field>
            <Field label="حد التنبيه">
              <Input type="number" value={editForm.minStock ?? 0} onFocus={selectAllOnFocus} onChange={(e) => setEditForm({ ...editForm, minStock: Number(e.target.value) })} />
            </Field>
            <Field label="سعر الشراء">
              <Input type="number" value={editForm.purchasePrice ?? 0} onFocus={selectAllOnFocus} onChange={(e) => setEditForm({ ...editForm, purchasePrice: Number(e.target.value) })} />
            </Field>
            <Field label="سعر الكلفة">
              <Input type="number" value={editForm.costPrice ?? 0} onFocus={selectAllOnFocus} onChange={(e) => setEditForm({ ...editForm, costPrice: Number(e.target.value) })} />
            </Field>
            <Field label="سعر البيع (جملة)">
              <Input type="number" value={editForm.salePrice ?? 0} onFocus={selectAllOnFocus} onChange={(e) => setEditForm({ ...editForm, salePrice: Number(e.target.value) })} />
            </Field>
            <Field label="سعر المفرد (تجزئة)">
              <Input type="number" value={editForm.retailPrice ?? 0} onFocus={selectAllOnFocus} onChange={(e) => setEditForm({ ...editForm, retailPrice: Number(e.target.value) })} />
            </Field>
          </div>
          <Button className="w-full" type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "جار الحفظ..." : "حفظ التعديلات"}
          </Button>
        </form>
      </ModalForm>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600">تأكيد الحذف</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            هل تريد حذف <span className="font-bold">{product.name}</span>؟ هذا الإجراء لا يمكن التراجع عنه.
          </p>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" className="flex-1" onClick={() => setDeleteOpen(false)}>إلغاء</Button>
            <Button className="flex-1 bg-red-600 hover:bg-red-700" onClick={() => { setDeleteOpen(false); navigate(-1) }}>حذف</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
