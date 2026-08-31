import { useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { toast } from "./ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import { downloadBlobUrl } from "../utils/download"
import { downloadInvoiceLabelsPdf, type InvoiceLabelRequest } from "../api/endpoints"
import { cartonBreakdown, unitToPieces } from "../utils/units"
import type { InvoiceItem } from "../types/api"

const MAX_LABELS = 500

type Row = {
  productId: string
  name: string
  itemNumber: string
  pcsPerCarton: number
  pieces: number
  cartons: number
  /** How many stickers of each kind the user wants. */
  cartonCount: number
  pieceCount: number
}

/**
 * «تحميل باركود المواد» — pick, per product on the invoice, how many carton and
 * piece stickers to get, then download them as ONE pdf. Deliberately a download
 * and not a print dialog: the labels go to a sticker printer from the saved
 * file, and browser print scaling silently ruins sticker sizes.
 */
export function InvoiceLabelsDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  items,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  invoiceNumber: string
  items: InvoiceItem[]
}) {
  const initialRows = useMemo<Row[]>(() => {
    // One row per PRODUCT: an invoice can carry the same product on several
    // lines (split across warehouses), and printing its stickers twice would
    // be wrong.
    const byProduct = new Map<string, Row>()
    for (const it of items) {
      const pcsPerCarton = it.product?.pcsPerCarton ?? 1
      const pieces = unitToPieces(it.unit, it.quantity, { pcsPerCarton, boxPieces: it.product?.boxPieces })
      const existing = byProduct.get(it.productId)
      if (existing) {
        existing.pieces += pieces
      } else {
        byProduct.set(it.productId, {
          productId: it.productId,
          name: it.productName ?? it.product?.name ?? it.productId,
          itemNumber: it.itemNumber ?? it.product?.itemNumber ?? "",
          pcsPerCarton,
          pieces,
          cartons: 0,
          cartonCount: 0,
          pieceCount: 0,
        })
      }
    }
    return [...byProduct.values()].map((r) => {
      const cartons = cartonBreakdown(r.pieces, r.pcsPerCarton).cartons
      // Prefilled with what the shipment actually contains: one sticker per
      // carton received. Piece stickers start at zero — you rarely want 3,600.
      return { ...r, cartons, cartonCount: cartons, pieceCount: 0 }
    })
  }, [items])

  const [rows, setRows] = useState<Row[] | null>(null)
  const effectiveRows = rows ?? initialRows
  const [busy, setBusy] = useState(false)

  function setRow(productId: string, patch: Partial<Row>) {
    setRows(effectiveRows.map((r) => (r.productId === productId ? { ...r, ...patch } : r)))
  }

  const total = effectiveRows.reduce((s, r) => s + r.cartonCount + r.pieceCount, 0)
  const overLimit = total > MAX_LABELS

  async function download() {
    const payload: InvoiceLabelRequest[] = []
    for (const r of effectiveRows) {
      if (r.cartonCount > 0) payload.push({ productId: r.productId, unit: "CARTON", count: r.cartonCount })
      if (r.pieceCount > 0) payload.push({ productId: r.productId, unit: "PIECE", count: r.pieceCount })
    }
    if (payload.length === 0) {
      toast({ title: "ما اخترت أي ملصق", description: "اكتب عدداً أكبر من صفر لمادة واحدة على الأقل", variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      const url = await downloadInvoiceLabelsPdf(invoiceId, payload)
      downloadBlobUrl(url, `باركود-${invoiceNumber}.pdf`)
      // Revoked late: the synthetic click needs the URL to still be alive.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      toast({ title: "تم تحميل الملف", description: `${total} ملصق` })
      onOpenChange(false)
    } catch (err) {
      toast({ title: "تعذّر تحميل الباركود", description: apiErrorMessage(err), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  function fillAll(kind: "carton" | "piece", mode: "shipment" | "one" | "zero") {
    setRows(
      effectiveRows.map((r) => {
        const value = mode === "zero" ? 0 : mode === "one" ? 1 : kind === "carton" ? r.cartons : r.pieces
        if (kind === "carton") return { ...r, cartonCount: r.pcsPerCarton > 1 ? value : 0 }
        return { ...r, pieceCount: value }
      }),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>تحميل باركود مواد الفاتورة</DialogTitle></DialogHeader>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-500">تعبئة سريعة:</span>
          <Button size="sm" variant="outline" onClick={() => fillAll("carton", "shipment")}>ملصق لكل كرتون واصل</Button>
          <Button size="sm" variant="outline" onClick={() => fillAll("carton", "one")}>كرتون واحد لكل مادة</Button>
          <Button size="sm" variant="outline" onClick={() => fillAll("piece", "one")}>قطعة واحدة لكل مادة</Button>
          <Button size="sm" variant="ghost" onClick={() => { fillAll("carton", "zero"); fillAll("piece", "zero") }}>تصفير الكل</Button>
        </div>

        <div className="max-h-96 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="p-2 text-right">المادة</th>
                <th className="p-2 text-center">الواصل</th>
                <th className="p-2 text-center">ملصقات كرتون</th>
                <th className="p-2 text-center">ملصقات قطعة</th>
              </tr>
            </thead>
            <tbody>
              {effectiveRows.map((r) => (
                <tr key={r.productId} className="border-t">
                  <td className="p-2">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-slate-500">{r.itemNumber || "—"}</div>
                  </td>
                  <td className="p-2 text-center text-xs text-slate-600 dark:text-slate-300">
                    {r.cartons > 0 ? `${r.cartons} كرتون` : "—"}
                    <div className="text-slate-400">{r.pieces} قطعة</div>
                  </td>
                  <td className="p-2 text-center">
                    <Input
                      type="number"
                      min={0}
                      className="mx-auto h-8 w-20 text-center"
                      value={r.cartonCount}
                      // A product with no carton size has no carton barcode to
                      // print — offering the field would produce junk stickers.
                      disabled={r.pcsPerCarton <= 1}
                      onChange={(e) => setRow(r.productId, { cartonCount: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </td>
                  <td className="p-2 text-center">
                    <Input
                      type="number"
                      min={0}
                      className="mx-auto h-8 w-20 text-center"
                      value={r.pieceCount}
                      onChange={(e) => setRow(r.productId, { pieceCount: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className={overLimit ? "text-sm font-semibold text-rose-600" : "text-sm text-slate-500"}>
            المجموع: {total} ملصق{overLimit ? ` — الحد ${MAX_LABELS} بالمرة الواحدة` : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button disabled={busy || total === 0 || overLimit} onClick={() => void download()}>
              {busy ? "جاري التحضير..." : "تحميل PDF"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
