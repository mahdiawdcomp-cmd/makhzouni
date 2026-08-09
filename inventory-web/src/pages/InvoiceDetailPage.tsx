import { useMemo, useState } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams } from "react-router-dom"
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  FileDown,
  FileSpreadsheet,
  Image as ImageIcon,
  MessageCircle,
  Pencil,
  Printer,
  Plus,
  RefreshCw,
  ShoppingCart,
  Receipt as ReceiptIcon,
  Trash2,
  Users,
} from "lucide-react"
import { cancelInvoice, downloadCustomerImageInvoiceExcelBlob, downloadCustomerImageInvoicePdfBlob, getBranches, getInvoiceAuditTrail, permanentDeleteInvoice, reactivateInvoice, sendWhatsAppInvoice, sendWhatsAppInvoiceImage, sendWhatsAppMessage, updateInvoice, downloadInvoicePdfBlob, type WhatsAppSendChannel } from "../api/endpoints"
import { apiErrorMessage } from "../utils/apiError"
import { fmt } from "../utils/fmt"
import { useInvoice, useInvoices } from "../hooks/useInvoices"
import { useProducts } from "../hooks/useProducts"
import { useSettings } from "../hooks/useSettings"
import { balanceForCustomer, fillTemplate, normalizePhone } from "../utils/whatsapp"
import { parseDesigns, renderDesignHTML, renderDesignToPdfBlob, printHTML, type PaperSize, type PrintInvoice } from "../print/invoiceDesign"
import { downloadBlobUrl } from "../utils/download"
import type { InvoiceItem, Product } from "../types/api"
import { Button } from "../components/ui/button"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { toast } from "../components/ui/use-toast"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { ErrorExplain } from "../components/ui/error-explain"
import { RecordNavigator } from "../components/RecordNavigator"
import { WorkerSendModal } from "../components/WorkerSendModal"
import { WhatsAppChannelDialog } from "../components/WhatsAppChannelDialog"
import { READ_ONLY_MESSAGE, useFeatureEnabled, useReadOnly } from "../hooks/useTenantConfig"

function money(v: number | undefined) { return fmt(v) }

function invoicePdfFilename(invoiceNumber: string) {
  const safeNumber = String(invoiceNumber || "invoice").replace(/[\\/:*?"<>|]+/g, "_")
  return `invoice-${safeNumber}.pdf`
}

function customerImageInvoiceFilename(invoiceNumber: string, ext: "pdf" | "xlsx") {
  const safeNumber = String(invoiceNumber || "invoice").replace(/[\\/:*?"<>|]+/g, "_")
  return `فاتورة-بالصور-${safeNumber}.${ext}`
}

function unitLabel(unit: string) {
  if (unit === "CARTON") return "كرتونة"
  if (unit === "DOZEN") return "درزن"
  if (unit === "BOX") return "علبة"
  return "قطعة"
}

const DEFAULT_INVOICE_TEMPLATE =
  "مرحبا {{customerName}} تم اصدار {{invoiceTypeLabel}} رقم {{invoiceNumber}}\nبتاريخ {{date}}\nمبلغ الفاتورة {{total}} {{currency}}\nالمبلغ الواصل {{paid}} {{currency}}\nالمتبقي من الفاتورة {{remaining}} {{currency}}\nحسابك السابق قبل الفاتورة {{previousBalance}} {{currency}}\nالحساب النهائي {{finalBalance}} {{currency}}\nشكرا لتسوق من {{storeName}}\nنتمنى لك الرزق الوفير والكثير"

interface EditItem {
  productId: string; productName: string
  unit: "PIECE" | "DOZEN" | "BOX" | "CARTON"; quantity: number; unitPrice: number
  warehouseId?: string; warehouseName?: string
  notes?: string
}

// A single product can be split across warehouses (المحل + مخزن آخر) into multiple
// lines for accurate stock. The customer-facing invoice should show ONE line per
// product, so we merge lines that share product + unit + price, summing quantity
// and total. (Stock movements stay per-warehouse on the backend — display only.)
function mergeInvoiceItems(items: InvoiceItem[]): InvoiceItem[] {
  const merged: InvoiceItem[] = []
  const indexByKey = new Map<string, number>()
  for (const item of items) {
    const key = `${item.productId}|${item.unit}|${item.unitPrice}|${item.notes ?? ""}`
    const existing = indexByKey.get(key)
    if (existing === undefined) {
      indexByKey.set(key, merged.length)
      merged.push({ ...item })
    } else {
      merged[existing] = {
        ...merged[existing],
        quantity: merged[existing].quantity + item.quantity,
        totalPrice: merged[existing].totalPrice + item.totalPrice,
      }
    }
  }
  return merged
}

export function InvoiceDetailPage() {
  const { id } = useParams()
  const readOnly = useReadOnly()
  const whatsappInvoicesEnabled = useFeatureEnabled("whatsappInvoices")
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const invoiceQuery = useInvoice(id)
  const invoice = invoiceQuery.data

  const invoiceTypeLabel = invoice?.type === "PURCHASE" ? "فاتورة شراء" : invoice?.type === "SALES_RETURN" ? "مرتجع" : "فاتورة بيع"
  const partyName = invoice?.customer?.name ?? ""
  usePageTitle(invoice ? `${invoiceTypeLabel}${partyName ? ` (${partyName})` : ""}` : "تحميل الفاتورة...")
  const auditQuery = useQuery({
    queryKey: ["invoices", id, "audit-trail"],
    queryFn: () => getInvoiceAuditTrail(id!),
    enabled: Boolean(id),
  })
  const settingsQuery = useSettings()
  const settings = settingsQuery.data
  const { productsQuery } = useProducts()
  const allProducts = productsQuery.data ?? []
  const [pdfDownloading, setPdfDownloading] = useState(false)

  // Navigation within same type
  const listQuery = useInvoices({ limit: 1000 })
  const list = listQuery.data ?? []
  const sorted = useMemo(() => {
    return [...list]
      .sort((a, b) => {
        const difference = new Date(a.createdAt ?? a.date).getTime() - new Date(b.createdAt ?? b.date).getTime()
        return difference || a.id.localeCompare(b.id)
      })
  }, [list])

  // Shared payload for both print paths — always reflects the shop's own saved
  // design (settings.invoiceDesign), so "طباعة A4" and "تحميل PDF" never diverge.
  function buildDesignPrintPayload(paper: PaperSize) {
    const design = parseDesigns(settings?.invoiceDesign)[paper]
    const printInv: PrintInvoice = {
      number: invoice!.invoiceNumber,
      date: String(invoice!.date).slice(0, 10),
      customerName: invoice!.customer?.name ?? "",
      customerPhone: invoice!.customer?.phone ?? "",
      lines: (invoice!.items ?? []).map((it) => ({
        name: it.productName ?? "",
        unit: unitLabel(it.unit),
        qty: it.quantity,
        price: it.unitPrice,
        notes: it.notes ?? "",
        itemNumber: it.itemNumber ?? (it as any).product?.itemNumber ?? undefined,
        pcsPerCarton: (it as any).product?.pcsPerCarton ?? undefined,
      })),
      notes: invoice!.notes ?? "",
      subtotal: invoice!.subtotal,
      discount: invoice!.discount,
      tax: invoice!.tax,
      total: invoice!.totalAmount,
      paid: invoice!.paidAmount,
      remaining: invoice!.remainingAmount,
      previousBalance: invoice!.previousBalance ?? 0,
      finalBalance: invoice!.finalBalance,
      paymentType: invoice!.paymentType === "CASH" ? "نقد" : invoice!.paymentType === "PARTIAL" ? "جزئي" : "أجل",
      invoiceType: invoice!.type as "SALE" | "PURCHASE" | "SALES_RETURN",
    }
    const store = {
      storeName: settings?.storeName || "",
      storeLogo: settings?.storeLogo || "",
      storePhone: settings?.storePhone || "",
      storeAddress: settings?.storeAddress || "",
      currency: settings?.currency || "د.ع",
    }
    return { design, printInv, store }
  }

  // Print using the saved visual design (invoiceDesign)
  function printWithDesign(paper: PaperSize) {
    if (!invoice) return
    const { design, printInv, store } = buildDesignPrintPayload(paper)
    printHTML(renderDesignHTML(design, printInv, store))
  }

  // Downloaded PDF must look exactly like the shop's own A4 design — rasterize the
  // same renderDesignHTML() output used by "طباعة A4" into a real PDF file, instead
  // of the backend's separate hardcoded template.
  async function downloadA4Pdf() {
    if (!invoice) return
    setPdfDownloading(true)
    try {
      const { design, printInv, store } = buildDesignPrintPayload("a4")
      const html = renderDesignHTML(design, printInv, store)
      const blob = await renderDesignToPdfBlob(html, design.width, design.height)
      const url = URL.createObjectURL(blob)
      downloadBlobUrl(url, invoicePdfFilename(invoice.invoiceNumber))
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast({ title: "تم تحميل ملف PDF." })
    } catch {
      toast({ title: "تعذر تحميل PDF. جرّب طباعة A4.", variant: "destructive" })
    } finally {
      setPdfDownloading(false)
    }
  }

  // Send to preparation worker
  const [workerModalOpen, setWorkerModalOpen] = useState(false)

  // WhatsApp preview
  const [waPreview, setWaPreview] = useState(false)
  const [waMessage, setWaMessage] = useState("")
  const [waSending, setWaSending] = useState(false)
  // Which send the channel picker confirms: regular PDF invoice or image invoice.
  const [waChannelFor, setWaChannelFor] = useState<null | "invoice" | "invoiceImage">(null)
  function buildWaMessage() {
    if (!invoice) return ""
    // settings.invoiceTemplate is dual-purpose: the print designer stores its
    // layout JSON in the same key (see print/invoiceDesign.ts). A JSON value
    // must never leak into the WhatsApp message — fall back to the default text.
    const raw = (settings?.invoiceTemplate ?? "").trim()
    const tpl = raw && !raw.startsWith("{") && !raw.startsWith("[") ? raw : DEFAULT_INVOICE_TEMPLATE
    return fillTemplate(tpl, {
      customerName: invoice.customer?.name ?? "",
      invoiceNumber: invoice.invoiceNumber,
      date: String(invoice.date).slice(0, 10),
      invoiceTypeLabel:
        invoice.type === "PURCHASE" ? "فاتورة شراء"
        : invoice.type === "SALES_RETURN" ? "فاتورة مرتجع مبيعات"
        : "فاتورة بيع",
      total: money(invoice.totalAmount),
      paid: money(invoice.paidAmount),
      remaining: money(invoice.remainingAmount),
      // Balances carry a direction word so a supplier or a customer in
      // credit does not receive a bare negative number.
      previousBalance: balanceForCustomer(invoice.previousBalance ?? 0),
      finalBalance: balanceForCustomer(invoice.finalBalance),
      currency: settings?.currency ?? "د.ع",
      storeName: settings?.storeName ?? "مهدي عوض",
    })
  }
  function openWaPreview() {
    if (!invoice) return
    setWaMessage(buildWaMessage())
    setWaPreview(true)
  }
  async function sendWaMessage(channel: WhatsAppSendChannel) {
    if (!invoice) return
    const phone = invoice.customer?.phone
    if (!phone) { toast({ title: "رقم الهاتف غير متوفر.", variant: "destructive" }); return }
    setWaSending(true)
    try {
      // Try to send PDF with text caption; fall back to text-only if PDF fails
      try {
        await sendWhatsAppInvoice(invoice.id, channel)
      } catch {
        await sendWhatsAppMessage({ phone: normalizePhone(phone), message: waMessage, channel })
      }
      setWaChannelFor(null)
      setWaPreview(false)
      toast({ title: "✓ تم إرسال الفاتورة عبر واتساب." })
    } catch (err) {
      toast({ title: "✗ تعذر الإرسال.", description: apiErrorMessage(err, "تحقق من إعدادات واتساب"), variant: "destructive" })
    } finally {
      setWaSending(false)
    }
  }

  // New, separate option: send a customer-safe image invoice (product photos,
  // no purchase price/cost/profit). Does not touch the sendWaMessage flow above.
  const [waImageSending, setWaImageSending] = useState(false)
  function openWaImageChannel() {
    if (!invoice) return
    if (invoice.type !== "SALE") {
      toast({ title: "صور الفاتورة بالمنتجات متاحة لفواتير البيع فقط.", variant: "destructive" })
      return
    }
    if (!invoice.customer?.phone) { toast({ title: "رقم الهاتف غير متوفر.", variant: "destructive" }); return }
    setWaMessage(buildWaMessage())
    setWaChannelFor("invoiceImage")
  }
  async function sendWaImageInvoice(channel: WhatsAppSendChannel) {
    if (!invoice) return
    setWaImageSending(true)
    try {
      await sendWhatsAppInvoiceImage(invoice.id, channel)
      setWaChannelFor(null)
      toast({ title: "✓ تم إرسال الفاتورة بالصور عبر واتساب." })
    } catch (err) {
      toast({ title: "✗ تعذر إرسال الفاتورة بالصور.", description: apiErrorMessage(err, "تحقق من إعدادات واتساب"), variant: "destructive" })
    } finally {
      setWaImageSending(false)
    }
  }

  // Customer-safe "invoice with product photos" downloads (PDF / Excel) —
  // same allowlist DTO as sendWaImageInvoice above, never purchase price/cost
  // price/profit/margin/internal notes. Independent of the WhatsApp send flow.
  const [customerPdfDownloading, setCustomerPdfDownloading] = useState(false)
  const [customerExcelDownloading, setCustomerExcelDownloading] = useState(false)
  const [customerBothDownloading, setCustomerBothDownloading] = useState(false)

  async function downloadCustomerImagePdf() {
    if (!invoice) return
    setCustomerPdfDownloading(true)
    try {
      const blob = await downloadCustomerImageInvoicePdfBlob(invoice.id)
      const url = URL.createObjectURL(blob)
      downloadBlobUrl(url, customerImageInvoiceFilename(invoice.invoiceNumber, "pdf"))
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast({ title: "تم تحميل فاتورة بالصور PDF." })
    } catch {
      toast({ title: "تعذر تحميل فاتورة بالصور PDF.", variant: "destructive" })
    } finally {
      setCustomerPdfDownloading(false)
    }
  }

  async function downloadCustomerImageExcel() {
    if (!invoice) return
    setCustomerExcelDownloading(true)
    try {
      const blob = await downloadCustomerImageInvoiceExcelBlob(invoice.id)
      const url = URL.createObjectURL(blob)
      downloadBlobUrl(url, customerImageInvoiceFilename(invoice.invoiceNumber, "xlsx"))
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast({ title: "تم تحميل فاتورة بالصور Excel." })
    } catch {
      toast({ title: "تعذر تحميل فاتورة بالصور Excel.", variant: "destructive" })
    } finally {
      setCustomerExcelDownloading(false)
    }
  }

  async function downloadCustomerImageBoth() {
    if (!invoice) return
    setCustomerBothDownloading(true)
    try {
      const [pdfBlob, excelBlob] = await Promise.all([
        downloadCustomerImageInvoicePdfBlob(invoice.id),
        downloadCustomerImageInvoiceExcelBlob(invoice.id),
      ])
      const pdfUrl = URL.createObjectURL(pdfBlob)
      const excelUrl = URL.createObjectURL(excelBlob)
      downloadBlobUrl(pdfUrl, customerImageInvoiceFilename(invoice.invoiceNumber, "pdf"))
      downloadBlobUrl(excelUrl, customerImageInvoiceFilename(invoice.invoiceNumber, "xlsx"))
      setTimeout(() => { URL.revokeObjectURL(pdfUrl); URL.revokeObjectURL(excelUrl) }, 5000)
      toast({ title: "تم تحميل PDF + Excel." })
    } catch {
      toast({ title: "تعذر تحميل الملفين.", variant: "destructive" })
    } finally {
      setCustomerBothDownloading(false)
    }
  }

  const cancelMutation = useMutation({
    mutationFn: (returnWarehouseId?: string) => cancelInvoice(id!, returnWarehouseId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id, "audit-trail"] })
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: () => reactivateInvoice(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id, "audit-trail"] })
    },
  })

  function fmtNumInput(raw: string): string {
    const digits = raw.replace(/[^0-9]/g, "")
    if (!digits) return ""
    return Number(digits).toLocaleString("en-US")
  }

  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmReactivate, setConfirmReactivate] = useState(false)
  const [confirmPermanentDelete, setConfirmPermanentDelete] = useState(false)
  const [returnWarehouseId, setReturnWarehouseId] = useState("")

  const { data: warehouses = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: () => getBranches({ isActive: true }),
    enabled: confirmCancel || confirmPermanentDelete,
  })

  const permanentDeleteMutation = useMutation({
    mutationFn: (returnWarehouseId?: string) => permanentDeleteInvoice(id!, returnWarehouseId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      navigate("/invoices")
    },
  })

  // Full edit dialog
  const [editOpen, setEditOpen] = useState(false)
  const [editDiscount, setEditDiscount] = useState("")
  const [editTax] = useState("")
  const [editPaid, setEditPaid] = useState("")
  const [editPaymentType, setEditPaymentType] = useState<"CREDIT" | "CASH" | "PARTIAL">("CREDIT")
  const [editNotes, setEditNotes] = useState("")
  const [editItems, setEditItems] = useState<EditItem[]>([])
  const [editProductSearch, setEditProductSearch] = useState("")
  const [editProductOpen, setEditProductOpen] = useState(false)

  const filteredEditProducts = useMemo(
    () => allProducts.filter((p) => {
      const q = editProductSearch.toLowerCase()
      return !q || p.name.toLowerCase().includes(q) || p.itemNumber.toLowerCase().includes(q)
    }).slice(0, 12), [allProducts, editProductSearch])

  function addEditProduct(p: Product) {
    const isSale = invoice?.type === "SALE"
    let warehouseId: string | undefined
    let warehouseName: string | undefined
    if (isSale) {
      const shopStock = p.shopStock ?? 0
      if (shopStock === 0) {
        const best = (p.warehouseStocks ?? [])
          .filter((ws) => ws.quantityPieces > 0)
          .sort((a, b) => b.quantityPieces - a.quantityPieces)[0]
        if (best) { warehouseId = best.warehouseId; warehouseName = best.warehouse?.name }
      }
    }
    setEditItems((prev) => [...prev, {
      productId: p.id, productName: p.name, unit: "PIECE", quantity: 1,
      unitPrice: (invoice?.type === "PURCHASE" ? p.purchasePrice : p.salePrice) ?? 0,
      warehouseId, warehouseName,
    }])
    setEditProductOpen(false); setEditProductSearch("")
  }

  const editSubtotal = editItems.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
  const editTotal = editSubtotal - Number(editDiscount) + Number(editTax)

  const editMutation = useMutation({
    mutationFn: () => updateInvoice(id!, {
      type: invoice?.type, customerId: invoice?.customerId ?? "",
      discount: Number(editDiscount), tax: 0, paidAmount: Number(editPaid.replace(/,/g, "")),
      paymentType: editPaymentType,
      notes: editNotes.trim() || undefined,
      items: editItems.map((it) => ({ productId: it.productId, unit: it.unit, quantity: it.quantity, unitPrice: it.unitPrice, warehouseId: it.warehouseId, notes: it.notes?.trim() || undefined })),
    }),
    onSuccess: () => {
      setEditOpen(false)
      void queryClient.invalidateQueries({ queryKey: ["invoices"] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id] })
      void queryClient.invalidateQueries({ queryKey: ["invoices", id, "audit-trail"] })
    },
  })

  if (invoiceQuery.isLoading) return <div className="text-sm text-slate-500">جاري تحميل الفاتورة...</div>
  if (!invoice) return <div className="text-sm text-slate-500">الفاتورة غير موجودة.</div>

  const isPurchase = invoice.type === "PURCHASE"
  const isReturn = invoice.type === "SALES_RETURN"
  const accentColor = isPurchase ? "#f59e0b" : isReturn ? "#dc2626" : "#4F46E5"
  const customerLabel = isPurchase ? "المورد" : "الزبون / العميل"
  const typeLabel = isPurchase ? "فاتورة شراء" : isReturn ? "فاتورة مرتجع مبيعات" : "فاتورة مبيعات"
  const currency = settings?.currency ?? "د.ع"
  const a4PreviewHtml = (() => {
    if (!invoice) return ""
    const design = parseDesigns(settings?.invoiceDesign).a4
    const printInv: PrintInvoice = {
      number: invoice.invoiceNumber,
      date: String(invoice.date).slice(0, 10),
      customerName: invoice.customer?.name ?? "",
      customerPhone: invoice.customer?.phone ?? "",
      lines: mergeInvoiceItems(invoice.items ?? []).map((item) => ({
        name: item.productName ?? item.productId,
        unit: unitLabel(item.unit),
        qty: item.quantity,
        price: item.unitPrice,
        notes: item.notes ?? "",
        itemNumber: item.itemNumber ?? (item as any).product?.itemNumber ?? undefined,
        pcsPerCarton: (item as any).product?.pcsPerCarton ?? undefined,
      })),
      notes: invoice.notes ?? "",
      subtotal: invoice.subtotal,
      discount: invoice.discount,
      tax: invoice.tax,
      total: invoice.totalAmount,
      paid: invoice.paidAmount,
      remaining: invoice.remainingAmount,
      previousBalance: invoice.previousBalance ?? 0,
      finalBalance: invoice.finalBalance,
      paymentType: invoice.paymentType === "CASH" ? "نقد" : invoice.paymentType === "PARTIAL" ? "جزئي" : "أجل",
      invoiceType: invoice.type as "SALE" | "PURCHASE" | "SALES_RETURN",
    }
    return renderDesignHTML(design, printInv, {
      storeName: settings?.storeName || "",
      storeLogo: settings?.storeLogo || "",
      storePhone: settings?.storePhone || "",
      storeAddress: settings?.storeAddress || "",
      currency,
    })
  })()

  const lastEditNote = invoice.updatedAt && invoice.updatedAt !== invoice.createdAt
    ? `آخر تعديل: ${new Date(invoice.updatedAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}${invoice.creator ? ` | ${invoice.creator.name}` : ""}`
    : null

  return (
    <div className="space-y-3 max-w-4xl mx-auto">
      {/* Toolbar — hidden on print */}
      <div className="print:hidden flex flex-wrap items-center gap-2">
        <Button variant="ghost" className="px-0" onClick={() => history.length > 1 ? navigate(-1) : navigate("/invoices")}>
          <ArrowRight className="h-4 w-4" /> رجوع
        </Button>
        {/* Navigation */}
        <RecordNavigator currentId={id} orderedIds={sorted.map((row) => row.id)} onNavigate={(target) => navigate(`/invoices/${target}`)} noun="فاتورة" />
        <div className="mr-auto flex flex-wrap gap-1.5">
          {whatsappInvoicesEnabled && (
            <Button variant="outline" size="sm" onClick={openWaPreview} disabled={readOnly} title={readOnly ? READ_ONLY_MESSAGE : undefined}>
              <MessageCircle className="h-3.5 w-3.5 text-emerald-600" /> واتساب
            </Button>
          )}
          {whatsappInvoicesEnabled && invoice.type === "SALE" && (
            <Button
              variant="outline"
              size="sm"
              onClick={openWaImageChannel}
              disabled={readOnly || waImageSending}
              title={readOnly ? READ_ONLY_MESSAGE : "إرسال فاتورة بالصور — بدون سعر الشراء أو الأرباح"}
            >
              <ImageIcon className="h-3.5 w-3.5 text-emerald-600" /> {waImageSending ? "جاري الإرسال..." : "إرسال فاتورة بالصور"}
            </Button>
          )}
          {whatsappInvoicesEnabled && (
            <Button variant="outline" size="sm" onClick={() => setWorkerModalOpen(true)}>
              <Users className="h-3.5 w-3.5 text-emerald-600" /> إرسال للعامل
            </Button>
          )}
          {invoice.type === "SALE" && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadCustomerImagePdf()}
                disabled={customerPdfDownloading}
                title="فاتورة بالصور — بدون سعر الشراء أو الأرباح"
              >
                <FileDown className="h-3.5 w-3.5 text-indigo-600" /> {customerPdfDownloading ? "جاري التحميل..." : "تحميل فاتورة بالصور PDF"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadCustomerImageExcel()}
                disabled={customerExcelDownloading}
                title="فاتورة بالصور — بدون سعر الشراء أو الأرباح"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-indigo-600" /> {customerExcelDownloading ? "جاري التحميل..." : "تحميل فاتورة بالصور Excel"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadCustomerImageBoth()}
                disabled={customerBothDownloading}
                title="فاتورة بالصور — بدون سعر الشراء أو الأرباح"
              >
                <FileDown className="h-3.5 w-3.5 text-indigo-600" /> {customerBothDownloading ? "جاري التحميل..." : "تحميل PDF + Excel"}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => printWithDesign("80mm")}><Printer className="h-3.5 w-3.5" /> طباعة حرارية</Button>
          <Button variant="outline" size="sm" onClick={() => printWithDesign("a4")}><FileDown className="h-3.5 w-3.5" /> طباعة A4</Button>
          <Button variant="outline" size="sm" onClick={() => void downloadA4Pdf()} disabled={pdfDownloading}><FileDown className="h-3.5 w-3.5" /> {pdfDownloading ? "جاري التحميل..." : "تحميل PDF"}</Button>
          {invoice.status === "ACTIVE" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => navigate(`/invoices/${id}/edit`)}><Pencil className="h-3.5 w-3.5" /> تعديل</Button>
              <Button variant="destructive" size="sm" onClick={() => setConfirmCancel(true)} disabled={cancelMutation.isPending}>
                <Ban className="h-3.5 w-3.5" /> تعطيل
              </Button>
            </>
          ) : (
            <>
              <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">معطلة</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmReactivate(true)}
                disabled={reactivateMutation.isPending}
              >
                <RefreshCw className="h-3.5 w-3.5" /> إرجاع نشطة
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            className="border-red-300 text-red-600 hover:bg-red-50"
            onClick={() => setConfirmPermanentDelete(true)}
            disabled={permanentDeleteMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" /> حذف
          </Button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          PRINTABLE INVOICE — matches the HTML design exactly   */}
      <div className="rounded-xl border border-slate-200 bg-slate-100 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <iframe
          title={`فاتورة ${invoice.invoiceNumber}`}
          srcDoc={a4PreviewHtml}
          className="mx-auto block w-full rounded-lg bg-white shadow"
          style={{ height: "1123px", maxWidth: "794px" }}
        />
      </div>

      <div className="hidden">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-8 py-6">
          <div>
            <div className="flex items-center gap-2">
              {isPurchase ? <ShoppingCart className="h-7 w-7" style={{ color: accentColor }} /> : isReturn ? <RefreshCw className="h-7 w-7" style={{ color: accentColor }} /> : <ReceiptIcon className="h-7 w-7" style={{ color: accentColor }} />}
              <h1 className="text-2xl font-extrabold" style={{ color: accentColor }}>{typeLabel}</h1>
            </div>
            <p className="mt-1.5 text-base font-bold text-gray-800">{settings?.storeName ?? "مخزوني"}</p>
            {settings?.storePhone ? <p className="text-sm text-gray-600 mt-0.5">الهاتف: <span className="font-bold">{settings.storePhone}</span></p> : null}
            {settings?.storeAddress ? <p className="text-sm text-gray-600 mt-0.5">{settings.storeAddress}</p> : null}
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
            <p className="text-gray-600">رقم الفاتورة: <span className="font-bold text-gray-800">{invoice.invoiceNumber}</span></p>
            <p className="text-gray-600 mt-1">التاريخ: <span className="font-bold text-gray-800">{String(invoice.date).slice(0, 10)}</span></p>
            <p className="text-gray-600 mt-1">نوع الدفع: <span className="font-bold text-gray-800">{invoice.paymentType}</span></p>
            <p className={`mt-1 text-xs font-semibold ${invoice.status === "ACTIVE" ? "text-emerald-700" : "text-rose-700"}`}>
              {invoice.status === "ACTIVE" ? "✓ نشطة" : "✗ ملغاة"}
            </p>
            {lastEditNote ? <p className="mt-1 text-xs text-gray-400">{lastEditNote}</p> : null}
          </div>
        </div>

        {/* Customer info */}
        <div className="mx-8 mt-5 rounded-lg border border-gray-100 bg-gray-50 px-5 py-4">
          <p className="text-xs font-bold text-gray-500 mb-1">{customerLabel}:</p>
          <h2 className="text-xl font-bold text-gray-800">{invoice.customer?.name ?? "—"}</h2>
          {invoice.customer?.phone ? <p className="text-sm text-gray-600 mt-0.5">هاتف: {invoice.customer.phone}</p> : null}
        </div>

        {/* Items table */}
        <div className="px-8 mt-5">
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="text-white text-sm" style={{ backgroundColor: accentColor }}>
                <th className="rounded-r-lg py-3 px-4">#</th>
                <th className="py-3 px-4 text-right">اسم الصنف</th>
                <th className="py-3 px-4 text-center">الوحدة</th>
                <th className="py-3 px-4 text-center">الكمية</th>
                <th className="py-3 px-4 text-center">سعر الوحدة</th>
                <th className="rounded-l-lg py-3 px-4 text-left">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {mergeInvoiceItems(invoice.items ?? []).map((item, i) => (
                <tr key={item.id ?? i} className="border-b border-gray-100 hover:bg-gray-50 transition">
                  <td className="py-3 px-4 text-gray-500 font-bold">{i + 1}</td>
                  <td className="py-3 px-4">
                    <p className="font-bold text-gray-800">{item.productName ?? item.productId}</p>
                    <p className="text-xs text-gray-500">{unitLabel(item.unit)}</p>
                    {item.notes ? <p className="mt-0.5 text-xs font-medium text-amber-700">📝 {item.notes}</p> : null}
                  </td>
                  <td className="py-3 px-4 text-center">{unitLabel(item.unit)}</td>
                  <td className="py-3 px-4 text-center font-bold">{fmt(item.quantity)}</td>
                  <td className="py-3 px-4 text-center">{money(item.unitPrice)} {currency}</td>
                  <td className="py-3 px-4 text-left font-bold" style={{ color: accentColor }}>{money(item.totalPrice)} {currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Invoice-level notes — were saved but never displayed anywhere */}
        {invoice.notes ? (
          <div className="mx-8 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-bold text-amber-700 mb-0.5">📝 ملاحظات الفاتورة</p>
            <p className="text-sm text-amber-900 whitespace-pre-wrap">{invoice.notes}</p>
          </div>
        ) : null}

        {/* Two-column summary — matches HTML design */}
        <div className="mx-8 mt-6 mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Left: Invoice details */}
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-2">
            <h3 className="font-bold text-gray-800 border-b border-gray-200 pb-2 mb-3">تفاصيل الفاتورة الحالية</h3>
            <SummaryRow label="قيمة الفاتورة" value={`${money(invoice.subtotal)} ${currency}`} />
            {Number(invoice.discount) > 0 ? <SummaryRow label="الخصم" value={`${money(invoice.discount)} ${currency}`} /> : null}
            <SummaryRow label="الإجمالي" value={`${money(invoice.totalAmount)} ${currency}`} strong />
            <SummaryRow label="الواصل (المدفوع)" value={`${money(invoice.paidAmount)} ${currency}`} color="text-emerald-600" />
            <div className="flex items-center justify-between rounded-lg bg-gray-200 px-3 py-2 mt-1">
              <span className="font-bold text-lg">الباقي من الفاتورة:</span>
              <span className="font-extrabold text-xl text-rose-600">{money(invoice.remainingAmount)} {currency}</span>
            </div>
          </div>

          {/* Right: Full account */}
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 space-y-2">
            <h3 className="font-bold text-blue-900 border-b border-blue-200 pb-2 mb-3">كشف الحساب الكلي</h3>
            <SummaryRow label="الحساب السابق" value={`${money(invoice.previousBalance)} ${currency}`} />
            <SummaryRow label={isPurchase || isReturn ? "يطرح المتبقي" : "يضاف المتبقي"} value={`${money(invoice.remainingAmount)} ${currency}`} />
            <div className="flex items-center justify-between rounded-lg bg-blue-200 px-3 py-2 mt-1">
              <span className="font-bold text-blue-900 text-lg">الحساب النهائي:</span>
              <span className="font-extrabold text-xl text-blue-900">{money(invoice.finalBalance)} {currency}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mx-8 mb-6 border-t border-gray-100 pt-4 text-center text-xs text-gray-500">
          شكراً لتعاملكم معنا! — {settings?.storeName ?? "مخزوني"}
          {settings?.storePhone ? ` — ${settings.storePhone}` : ""}
        </div>
      </div>
      {/* End printable section */}

      <div className="print:hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-indigo-500"></span>
            سجل التعديلات
          </h2>
          <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-full px-2 py-0.5">{auditQuery.data?.length ?? 0} حركة</span>
        </div>
        {!auditQuery.isLoading && (auditQuery.data ?? []).length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-400">لا توجد تعديلات مسجلة على هذه الفاتورة.</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {(auditQuery.data ?? []).map((entry) => {
              const isEdit = entry.actionLabel?.includes("تعديل")
              const isCreate = entry.actionLabel?.includes("إنشاء") || entry.actionLabel?.includes("إضافة")
              const dotColor = isCreate ? "bg-emerald-500" : isEdit ? "bg-amber-500" : "bg-slate-400"
              const user = entry.user?.name ?? entry.user?.username ?? "مجهول"
              const time = new Date(entry.createdAt).toLocaleString("ar-IQ", { dateStyle: "short", timeStyle: "short" })
              return (
                <div key={entry.id} className="px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                        <span className="font-semibold text-sm text-slate-800 dark:text-slate-100">{entry.actionLabel}</span>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="font-medium text-slate-600 dark:text-slate-300">{user}</span>
                          <span>•</span>
                          <span>{time}</span>
                        </div>
                      </div>
                      {entry.changes.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {entry.changes.some((change) => !change.itemsDiff) && (
                            <div className="flex flex-wrap gap-2">
                              {entry.changes.filter((change) => !change.itemsDiff).map((change) => (
                                <div key={`${entry.id}-${change.field}`} className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs">
                                  <span className="font-medium text-slate-600 dark:text-slate-400">{change.label}: </span>
                                  <span className="text-rose-500 line-through ml-1">{change.before}</span>
                                  <span className="mx-1 text-slate-400">←</span>
                                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">{change.after}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {entry.changes.filter((change) => change.itemsDiff).map((change) => (
                            <div key={`${entry.id}-${change.field}-items`} className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs space-y-1.5">
                              <div className="font-medium text-slate-600 dark:text-slate-400">{change.label}</div>
                              {change.itemsDiff!.added.map((line, i) => (
                                <div key={`add-${i}`} className="text-emerald-600 dark:text-emerald-400">+ {line}</div>
                              ))}
                              {change.itemsDiff!.removed.map((line, i) => (
                                <div key={`rem-${i}`} className="text-rose-500 line-through">- {line}</div>
                              ))}
                              {change.itemsDiff!.changed.map((c, i) => (
                                <div key={`chg-${i}`} className="space-y-0.5">
                                  <div className="font-medium text-slate-700 dark:text-slate-200">{c.productName}</div>
                                  <div className="text-rose-500 line-through">{c.before}</div>
                                  <div className="text-emerald-600 dark:text-emerald-400">{c.after}</div>
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* WhatsApp preview dialog */}
      <Dialog open={waPreview} onOpenChange={setWaPreview}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>معاينة رسالة واتساب</DialogTitle></DialogHeader>
          <div className="rounded-xl bg-emerald-50 p-4 text-sm whitespace-pre-wrap">{waMessage}</div>
          <div className="flex gap-2">
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => setWaChannelFor("invoice")} disabled={waSending}>
              <MessageCircle className="h-4 w-4" /> {waSending ? "جاري الإرسال..." : "إرسال"}
            </Button>
            <Button variant="outline" onClick={() => setWaPreview(false)}>إلغاء</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Channel picker — official / personal / open in WhatsApp Web */}
      <WhatsAppChannelDialog
        open={waChannelFor !== null}
        onClose={() => setWaChannelFor(null)}
        sending={waSending || waImageSending}
        phone={invoice.customer?.phone}
        webMessage={waMessage}
        title={waChannelFor === "invoiceImage" ? "إرسال فاتورة بالصور" : "إرسال الفاتورة عبر واتساب"}
        onSend={(channel) => {
          if (waChannelFor === "invoiceImage") void sendWaImageInvoice(channel)
          else void sendWaMessage(channel)
        }}
        webFile={{
          getBlob: () => (waChannelFor === "invoiceImage"
            ? downloadCustomerImageInvoicePdfBlob(invoice.id)
            : downloadInvoicePdfBlob(invoice.id)),
          filename: waChannelFor === "invoiceImage"
            ? customerImageInvoiceFilename(invoice.invoiceNumber, "pdf")
            : `${invoice.invoiceNumber}.pdf`,
        }}
        onWebOpen={() => {
          // wa.me can't attach files — download the same PDF the Meta send
          // attaches so the employee drags it into the opened chat.
          const mode = waChannelFor
          void (async () => {
            try {
              const blob = mode === "invoiceImage"
                ? await downloadCustomerImageInvoicePdfBlob(invoice.id)
                : await downloadInvoicePdfBlob(invoice.id)
              const url = URL.createObjectURL(blob)
              downloadBlobUrl(url, mode === "invoiceImage"
                ? customerImageInvoiceFilename(invoice.invoiceNumber, "pdf")
                : `${invoice.invoiceNumber}.pdf`)
              setTimeout(() => URL.revokeObjectURL(url), 5000)
              toast({ title: "انفتحت المحادثة ونزل ملف PDF", description: "اسحب الملف المنزّل إلى المحادثة قبل الإرسال." })
            } catch {
              toast({ title: "انفتحت المحادثة لكن تعذر تنزيل الـ PDF", variant: "destructive" })
            }
          })()
        }}
      />

      <WorkerSendModal
        invoiceId={invoice.id}
        open={workerModalOpen}
        onClose={() => setWorkerModalOpen(false)}
      />

      {/* Full edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>تعديل الفاتورة {invoice.invoiceNumber}</DialogTitle>
            <p className="text-xs text-slate-500">التاريخ ورقم الفاتورة ثابتان.</p>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">الأصناف</span>
              <Button size="sm" onClick={() => setEditProductOpen(true)}><Plus className="h-4 w-4" /> أضف</Button>
            </div>
            <Table>
              <THead><TR><TH>الاسم</TH><TH>الوحدة</TH><TH>العدد</TH><TH>السعر</TH><TH>الإجمالي</TH><TH>الملاحظات</TH><TH>×</TH></TR></THead>
              <TBody>
                {editItems.map((it, i) => (
                  <TR key={i}>
                    <TD className="text-sm font-medium">
                      {it.productName}
                      {it.warehouseName ? <span className="block text-xs text-slate-500">📦 {it.warehouseName}</span> : null}
                    </TD>
                    <TD>
                      <select className="h-8 rounded border bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950" value={it.unit}
                        onChange={(e) => setEditItems((p) => p.map((x, j) => j === i ? { ...x, unit: e.target.value as "PIECE" | "DOZEN" | "BOX" | "CARTON" } : x))}>
                        <option value="PIECE">قطعة</option><option value="DOZEN">درزن</option><option value="BOX">علبة</option><option value="CARTON">كرتونة</option>
                      </select>
                    </TD>
                    <TD><Input type="number" className="w-20 h-8 text-sm" value={it.quantity} onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditItems((p) => p.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} /></TD>
                    <TD><Input type="number" className="w-24 h-8 text-sm" value={it.unitPrice} onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditItems((p) => p.map((x, j) => j === i ? { ...x, unitPrice: Number(e.target.value) } : x))} /></TD>
                    <TD><Input type="number" className="w-28 h-8 text-sm font-semibold" value={Math.round(it.quantity * it.unitPrice)}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const tot = Number(e.target.value); const qty = it.quantity || 1
                        setEditItems((p) => p.map((x, j) => j === i ? { ...x, unitPrice: Math.round(tot / qty * 100) / 100 } : x))
                      }} /></TD>
                    <TD><Input className="min-w-36 h-8 text-sm" value={it.notes ?? ""} placeholder="ملاحظة للمادة"
                      onChange={(e) => setEditItems((p) => p.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))} /></TD>
                    <TD><Button variant="ghost" size="sm" onClick={() => setEditItems((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5 text-rose-500" /></Button></TD>
                  </TR>
                ))}
                {editItems.length === 0 ? <TR><TD colSpan={6} className="py-4 text-center text-sm text-slate-400">لا يوجد أصناف</TD></TR> : null}
              </TBody>
            </Table>
            <div>
              <label className="mb-1 block text-xs text-slate-500">ملاحظات عامة للفاتورة</label>
              <Input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="ملاحظات عامة (اختياري)" />
            </div>
            {editProductOpen ? (
              <div className="rounded-lg border p-3 bg-slate-50 dark:bg-slate-900 dark:border-slate-700">
                <Input autoFocus placeholder="بحث بالاسم أو رقم الصنف" value={editProductSearch} onChange={(e) => setEditProductSearch(e.target.value)} className="mb-2" />
                <div className="max-h-48 overflow-auto">
                  {filteredEditProducts.map((p) => (
                    <button key={p.id} type="button" className="flex w-full justify-between rounded px-3 py-2 text-sm hover:bg-white dark:hover:bg-slate-800 text-right"
                      onClick={() => addEditProduct(p)}>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-slate-500">{p.itemNumber}</span>
                    </button>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-1" onClick={() => setEditProductOpen(false)}>إغلاق</Button>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-slate-500">الخصم</label>
                <Input type="number" value={editDiscount} onFocus={(e) => e.target.select()} onChange={(e) => setEditDiscount(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">المبلغ المدفوع</label>
                <Input inputMode="numeric" dir="ltr" value={editPaid} onFocus={(e) => e.target.select()} onChange={(e) => setEditPaid(fmtNumInput(e.target.value))} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-500">طريقة الدفع</label>
              <div className="flex gap-2">
                {([["CASH", "نقد"], ["CREDIT", "آجل"], ["PARTIAL", "جزئي"]] as const).map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setEditPaymentType(val)}
                    className={`flex-1 rounded-md border py-2 text-sm font-medium transition-colors ${editPaymentType === val ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-3 text-sm flex justify-between font-bold text-base">
              <span>الإجمالي بعد التعديل</span><span>{fmt(editTotal)}</span>
            </div>
            {editTotal < 0 ? <div className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800"><AlertTriangle className="h-4 w-4" /> الخصم أكبر من المجموع</div> : null}
            <Button className="w-full" onClick={() => editMutation.mutate()} disabled={editMutation.isPending || editItems.length === 0 || editTotal < 0}>
              {editMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin ml-2" /> : null} حفظ التعديلات
            </Button>
            {editMutation.isError ? <ErrorExplain error={editMutation.error} fallback="تعذر تعديل الفاتورة" /> : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel / Permanent-delete dialogs show WHERE each item's stock goes back */}
      {(confirmCancel || confirmPermanentDelete) && invoice && (
        <Dialog open onOpenChange={(v) => { if (!v) { setConfirmCancel(false); setConfirmPermanentDelete(false) } }}>
          <DialogContent className="max-w-sm" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-rose-600">
                {confirmCancel ? "تعطيل الفاتورة؟" : "حذف الفاتورة؟"}
              </DialogTitle>
            </DialogHeader>
            {invoice.type === "SALE" && invoice.items && invoice.items.length > 0 && (
              <>
                <p className="text-sm text-slate-600 dark:text-slate-400">المخزون الذي سيُرجع:</p>
                <div className="space-y-1 rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-900">
                  {invoice.items.map((it) => (
                    <div key={it.id} className="flex justify-between gap-2">
                      <span className="font-medium">{it.productName}</span>
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                        +{it.quantity} {it.unit === "CARTON" ? "كرتونة" : it.unit === "DOZEN" ? "درزن" : "قطعة"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">إرجاع المواد إلى مخزن:</label>
                  <select
                    className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                    value={returnWarehouseId}
                    onChange={(e) => setReturnWarehouseId(e.target.value)}
                  >
                    <option value="">المحل (الافتراضي)</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {confirmPermanentDelete && (
              <p className="text-xs text-rose-600">
                ⚠ الفاتورة ستُخفى من القوائم وتبقى محفوظة للتدقيق، ويمكن استرجاعها خلال 48 ساعة من «المحذوفة مؤخراً».
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setConfirmCancel(false); setConfirmPermanentDelete(false) }}>تراجع</Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={cancelMutation.isPending || permanentDeleteMutation.isPending}
                onClick={() => {
                  const wh = returnWarehouseId || undefined
                  if (confirmCancel) { setConfirmCancel(false); cancelMutation.mutate(wh) }
                  else { setConfirmPermanentDelete(false); permanentDeleteMutation.mutate(wh) }
                  setReturnWarehouseId("")
                }}
              >
                {cancelMutation.isPending || permanentDeleteMutation.isPending
                  ? "..."
                  : confirmCancel ? "تعطيل" : "حذف"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <ConfirmDialog
        open={confirmReactivate}
        title="إرجاع الفاتورة نشطة؟"
        description="سيتم إرجاع تأثيرها على الحساب والمخزون."
        confirmLabel="إرجاع نشطة"
        loading={reactivateMutation.isPending}
        onConfirm={() => { setConfirmReactivate(false); reactivateMutation.mutate() }}
        onCancel={() => setConfirmReactivate(false)}
      />
    </div>
  )
}

function SummaryRow({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-gray-600">{label}</span>
      <span className={`${strong ? "font-bold" : "font-medium"} ${color ?? ""}`}>{value}</span>
    </div>
  )
}
