import { useEffect, useMemo, useRef, useState } from "react"
import { useSettings, useUpdateSettings } from "../hooks/useSettings"
import {
  DEFAULT_TEMPLATE,
  parseTemplate,
  renderInvoiceHTML,
  SAMPLE_INVOICE,
  type InvoiceTemplate,
  type PrintStore,
} from "../print/invoiceTemplate"

// Visual invoice/receipt designer. Edits a template stored in
// AppSettings.invoiceTemplate (shared across all devices) and shows a live
// print-accurate preview. Same renderer is used for the real print.

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="text-[color:var(--theme-textPrimary)]/80">{label}</span>
      {children}
    </label>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-[color:var(--theme-accent)]" : "bg-slate-400/40"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-0.5" : "left-[22px]"}`}
      />
    </button>
  )
}

export function InvoiceDesignerPage() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()
  const [tpl, setTpl] = useState<InvoiceTemplate>(DEFAULT_TEMPLATE)
  const [saved, setSaved] = useState(false)
  const printRef = useRef<HTMLIFrameElement>(null)

  // Load stored template once settings arrive.
  useEffect(() => {
    if (settings) setTpl(parseTemplate(settings.invoiceTemplate))
  }, [settings])

  const store: PrintStore = useMemo(
    () => ({
      storeName: settings?.storeName || "اسم المحل",
      storeLogo: settings?.storeLogo || "",
      storePhone: settings?.storePhone || "",
      storeAddress: settings?.storeAddress || "",
      currency: settings?.currency || "د.ع",
    }),
    [settings],
  )

  const html = useMemo(() => renderInvoiceHTML(tpl, SAMPLE_INVOICE, store), [tpl, store])

  const set = <K extends keyof InvoiceTemplate>(k: K, v: InvoiceTemplate[K]) => {
    setTpl((p) => ({ ...p, [k]: v }))
    setSaved(false)
  }

  const handleSave = () => {
    updateSettings.mutate(
      { invoiceTemplate: JSON.stringify(tpl) },
      { onSuccess: () => setSaved(true) },
    )
  }

  const handlePrint = () => {
    const iframe = printRef.current
    if (!iframe) return
    iframe.srcdoc = html
    iframe.onload = () => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    }
  }

  const is80 = tpl.paper === "80mm"

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-[color:var(--theme-textPrimary)]">🎨 مصمّم الفاتورة</h1>
          <p className="text-sm text-[color:var(--theme-textPrimary)]/60">
            صمّم شكل فاتورتك ثم احفظه — يُطبع بنفس الشكل على كل أجهزتك.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="rounded-xl border border-[color:var(--theme-cardBorder)] px-4 py-2 text-sm font-bold text-[color:var(--theme-textPrimary)] hover:bg-black/5"
          >
            🖨️ طباعة تجريبية
          </button>
          <button
            onClick={handleSave}
            disabled={updateSettings.isPending}
            className="rounded-xl px-5 py-2 text-sm font-bold text-white shadow"
            style={{ background: "var(--theme-primaryBtn)" }}
          >
            {updateSettings.isPending ? "جارٍ الحفظ…" : saved ? "✓ تم الحفظ" : "💾 حفظ التصميم"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        {/* ── Controls ── */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-[color:var(--theme-cardBorder)] bg-[color:var(--theme-cardBg)] p-4">
            <h3 className="mb-2 text-sm font-black text-[color:var(--theme-textPrimary)]">الورق والألوان</h3>

            <Row label="حجم الورق">
              <div className="flex gap-1 rounded-lg bg-black/10 p-1">
                {(["80mm", "a4"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => set("paper", p)}
                    className={`rounded-md px-3 py-1 text-xs font-bold ${tpl.paper === p ? "bg-[color:var(--theme-accent)] text-white" : "text-[color:var(--theme-textPrimary)]/70"}`}
                  >
                    {p === "80mm" ? "حراري 80mm" : "A4"}
                  </button>
                ))}
              </div>
            </Row>

            <Row label="اللون الأساسي">
              <input
                type="color"
                value={tpl.accent}
                onChange={(e) => set("accent", e.target.value)}
                className="h-8 w-14 cursor-pointer rounded border-0 bg-transparent"
              />
            </Row>

            <Row label={`حجم الخط (${tpl.fontScale.toFixed(2)}x)`}>
              <input
                type="range"
                min={0.8}
                max={1.3}
                step={0.05}
                value={tpl.fontScale}
                onChange={(e) => set("fontScale", Number(e.target.value))}
              />
            </Row>
          </div>

          <div className="rounded-2xl border border-[color:var(--theme-cardBorder)] bg-[color:var(--theme-cardBg)] p-4">
            <h3 className="mb-2 text-sm font-black text-[color:var(--theme-textPrimary)]">النصوص</h3>

            <label className="block py-2 text-sm">
              <span className="text-[color:var(--theme-textPrimary)]/80">عنوان الفاتورة</span>
              <input
                value={tpl.title}
                onChange={(e) => set("title", e.target.value)}
                className="mt-1 w-full rounded-lg border border-[color:var(--theme-cardBorder)] bg-transparent px-3 py-2 text-sm text-[color:var(--theme-textPrimary)]"
              />
            </label>

            <label className="block py-2 text-sm">
              <span className="text-[color:var(--theme-textPrimary)]/80">التذييل (رسالة الشكر)</span>
              <input
                value={tpl.footer}
                onChange={(e) => set("footer", e.target.value)}
                className="mt-1 w-full rounded-lg border border-[color:var(--theme-cardBorder)] bg-transparent px-3 py-2 text-sm text-[color:var(--theme-textPrimary)]"
              />
            </label>
          </div>

          <div className="rounded-2xl border border-[color:var(--theme-cardBorder)] bg-[color:var(--theme-cardBg)] p-4">
            <h3 className="mb-2 text-sm font-black text-[color:var(--theme-textPrimary)]">العناصر الظاهرة</h3>
            <Row label="شعار المحل (اللوغو)"><Toggle on={tpl.showLogo} onChange={(v) => set("showLogo", v)} /></Row>
            <Row label="بيانات الزبون"><Toggle on={tpl.showCustomer} onChange={(v) => set("showCustomer", v)} /></Row>
            <Row label="عمود الكمية"><Toggle on={tpl.showQtyCol} onChange={(v) => set("showQtyCol", v)} /></Row>
            <Row label="عمود السعر"><Toggle on={tpl.showPriceCol} onChange={(v) => set("showPriceCol", v)} /></Row>
            <Row label="الملاحظات"><Toggle on={tpl.showNotes} onChange={(v) => set("showNotes", v)} /></Row>
            <Row label="ختم المحل"><Toggle on={tpl.showStamp} onChange={(v) => set("showStamp", v)} /></Row>
            {tpl.showStamp && (
              <input
                value={tpl.stampText}
                onChange={(e) => set("stampText", e.target.value)}
                placeholder="نص الختم"
                className="mt-1 w-full rounded-lg border border-[color:var(--theme-cardBorder)] bg-transparent px-3 py-2 text-sm text-[color:var(--theme-textPrimary)]"
              />
            )}
          </div>
        </div>

        {/* ── Live preview ── */}
        <div className="rounded-2xl border border-[color:var(--theme-cardBorder)] bg-slate-200/40 p-4">
          <div className="mb-2 text-center text-xs font-bold text-[color:var(--theme-textPrimary)]/60">
            معاينة حيّة — {is80 ? "حراري 80mm" : "A4"}
          </div>
          <div className="flex justify-center overflow-auto">
            <iframe
              title="preview"
              srcDoc={html}
              className="rounded-lg border border-slate-300 bg-white shadow-lg"
              style={{ width: is80 ? "320px" : "595px", height: is80 ? "560px" : "780px" }}
            />
          </div>
        </div>
      </div>

      {/* Hidden iframe used for the actual print */}
      <iframe ref={printRef} title="print" style={{ position: "fixed", width: 0, height: 0, border: 0, left: -9999 }} />
    </div>
  )
}

export default InvoiceDesignerPage
