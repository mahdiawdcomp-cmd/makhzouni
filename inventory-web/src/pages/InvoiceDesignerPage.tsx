import { useEffect, useMemo, useRef, useState } from "react"
import { useSettings, useUpdateSettings } from "../hooks/useSettings"
import {
  defaultDesign, renderDesignHTML, resolveField,
  PAPER_PX, FIELD_LABELS, newId, SAMPLE_INVOICE,
  type Design, type El, type ElType, type FieldKey, type PaperSize, type PrintStore,
} from "../print/invoiceDesign"

type DesignsByPaper = Record<PaperSize, Design>

const SCALE: Record<PaperSize, number> = { a4: 0.62, "80mm": 1.15 }
const GRID = 5

function loadStored(json: string | null | undefined): DesignsByPaper {
  const result: DesignsByPaper = { a4: defaultDesign("a4"), "80mm": defaultDesign("80mm") }
  if (json) {
    try {
      const obj = JSON.parse(json)
      if (obj?.designs?.a4) result.a4 = obj.designs.a4
      if (obj?.designs?.["80mm"]) result["80mm"] = obj.designs["80mm"]
      else if (obj?.v === 2 && obj.paper) result[obj.paper as PaperSize] = obj // legacy single
    } catch { /* defaults */ }
  }
  return result
}

export function InvoiceDesignerPage() {
  const { data: settings } = useSettings()
  const updateSettings = useUpdateSettings()

  const [paper, setPaper] = useState<PaperSize>("a4")
  const [designs, setDesigns] = useState<DesignsByPaper>(() => ({ a4: defaultDesign("a4"), "80mm": defaultDesign("80mm") }))
  const [selId, setSelId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [snap, setSnap] = useState(true)
  const [past, setPast] = useState<DesignsByPaper[]>([])
  const [future, setFuture] = useState<DesignsByPaper[]>([])
  const lastSnap = useRef(0)
  const loaded = useRef(false)
  const printRef = useRef<HTMLIFrameElement>(null)
  const drag = useRef<{ mode: "move" | "resize" } | null>(null)

  // Load stored design ONCE (not on every settings refetch — that would wipe edits).
  useEffect(() => {
    if (settings && !loaded.current) { loaded.current = true; setDesigns(loadStored(settings.invoiceDesign)) }
  }, [settings])

  const design = designs[paper]
  const scale = SCALE[paper]
  const sel = design.elements.find((e) => e.id === selId) || null

  const store: PrintStore = useMemo(() => ({
    storeName: settings?.storeName || "اسم المحل",
    storeLogo: settings?.storeLogo || "",
    storePhone: settings?.storePhone || "",
    storeAddress: settings?.storeAddress || "",
    currency: settings?.currency || "د.ع",
  }), [settings])

  // ── history ──
  const snapshot = (force = false) => {
    const now = Date.now()
    if (!force && now - lastSnap.current < 400) return
    lastSnap.current = now
    setPast((p) => [...p.slice(-49), designs])
    setFuture([])
  }
  const undo = () => {
    if (!past.length) return
    setFuture((f) => [designs, ...f].slice(0, 50))
    setDesigns(past[past.length - 1])
    setPast((p) => p.slice(0, -1))
    setSaved(false)
  }
  const redo = () => {
    if (!future.length) return
    setPast((p) => [...p, designs].slice(-50))
    setDesigns(future[0])
    setFuture((f) => f.slice(1))
    setSaved(false)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // ── mutations ──
  const patchEl = (id: string, patch: Partial<El>) => {
    snapshot()
    setDesigns((d) => ({ ...d, [paper]: { ...d[paper], elements: d[paper].elements.map((e) => e.id === id ? { ...e, ...patch } : e) } }))
    setSaved(false)
  }
  const addEl = (type: ElType, extra: Partial<El> = {}) => {
    snapshot(true)
    const el: El = {
      id: newId(), type, x: 40, y: 40, w: type === "items" ? 260 : 180, h: type === "items" ? 200 : type === "line" ? 3 : 28,
      fontSize: 14, bold: false, color: "#0f172a", align: "right",
      ...(type === "text" ? { text: "نص جديد" } : {}),
      ...(type === "field" ? { field: "storeName" as FieldKey } : {}),
      ...(type === "image" ? { src: "logo" as const, w: 120, h: 80 } : {}),
      ...(type === "items" ? { accent: "#4f46e5", showQty: true, showPrice: true } : {}),
      ...(type === "line" ? { color: "#4f46e5" } : {}),
      ...(type === "box" ? { borderColor: "#cbd5e1", radius: 8 } : {}),
      ...extra,
    }
    setDesigns((d) => ({ ...d, [paper]: { ...d[paper], elements: [...d[paper].elements, el] } }))
    setSelId(el.id); setSaved(false)
  }
  const removeEl = (id: string) => {
    snapshot(true)
    setDesigns((d) => ({ ...d, [paper]: { ...d[paper], elements: d[paper].elements.filter((e) => e.id !== id) } }))
    setSelId(null); setSaved(false)
  }
  const dupEl = (el: El) => {
    snapshot(true)
    const c = { ...el, id: newId(), x: el.x + 12, y: el.y + 12 }
    setDesigns((d) => ({ ...d, [paper]: { ...d[paper], elements: [...d[paper].elements, c] } }))
    setSelId(c.id); setSaved(false)
  }

  const snapVal = (v: number) => (snap ? Math.round(v / GRID) * GRID : Math.round(v))

  // ── drag / resize ──
  const startDrag = (e: React.PointerEvent, id: string, mode: "move" | "resize") => {
    e.stopPropagation()
    setSelId(id)
    snapshot(true)
    drag.current = { mode }
    let lastX = e.clientX, lastY = e.clientY
    const move = (ev: PointerEvent) => {
      if (!drag.current) return
      const dx = (ev.clientX - lastX) / scale
      const dy = (ev.clientY - lastY) / scale
      lastX = ev.clientX; lastY = ev.clientY
      setDesigns((d) => ({
        ...d,
        [paper]: {
          ...d[paper],
          elements: d[paper].elements.map((el) => {
            if (el.id !== id) return el
            if (drag.current!.mode === "move") return { ...el, x: snapVal(Math.max(0, el.x - dx)), y: snapVal(Math.max(0, el.y + dy)) }
            return { ...el, w: snapVal(Math.max(24, el.w - dx)), h: snapVal(Math.max(12, el.h + dy)) }
          }),
        },
      }))
      setSaved(false)
    }
    const up = () => { drag.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up) }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  // ── image upload ──
  const onUpload = (id: string, file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => patchEl(id, { dataUrl: String(reader.result) })
    reader.readAsDataURL(file)
  }

  // ── save / print ──
  const handleSave = () => {
    updateSettings.mutate(
      { invoiceDesign: JSON.stringify({ v: 2, designs }) },
      {
        onSuccess: () => setSaved(true),
        onError: () => setSaved(false),
      },
    )
  }
  const handlePrint = () => {
    const html = renderDesignHTML(design, SAMPLE_INVOICE, store)
    const iframe = printRef.current
    if (!iframe) return
    iframe.srcdoc = html
    iframe.onload = () => { iframe.contentWindow?.focus(); iframe.contentWindow?.print() }
  }
  const resetPaper = () => {
    if (!confirm("إرجاع تصميم هذا الورق للوضع الافتراضي؟")) return
    snapshot(true)
    setDesigns((d) => ({ ...d, [paper]: defaultDesign(paper) }))
    setSelId(null); setSaved(false)
  }

  // ── element preview content (in editor) ──
  const renderInner = (el: El) => {
    if (el.type === "text") return el.text
    if (el.type === "field") return `${el.prefix || ""}${resolveField(el.field || "storeName", SAMPLE_INVOICE, store)}${el.suffix || ""}`
    if (el.type === "image") {
      const src = el.dataUrl || (el.src === "logo" ? store.storeLogo : "")
      return src ? <img src={src} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <span style={{ color: "#94a3b8", fontSize: 11 }}>{el.src === "logo" ? "شعار" : "ختم"}</span>
    }
    if (el.type === "items") {
      return (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: (el.fontSize || 12) * scale }}>
          <thead><tr>{["#", "الصنف", ...(el.showQty ? ["كمية"] : []), ...(el.showPrice ? ["سعر"] : []), "مجموع"].map((c, i) => (
            <th key={i} style={{ background: (el.accent || "#4f46e5") + "22", color: el.accent || "#4f46e5", padding: 2, borderBottom: `2px solid ${el.accent || "#4f46e5"}` }}>{c}</th>
          ))}</tr></thead>
          <tbody>{SAMPLE_INVOICE.lines.slice(0, 4).map((l, i) => (
            <tr key={i}>{[`${i + 1}`, l.name, ...(el.showQty ? [`${l.qty}`] : []), ...(el.showPrice ? [`${l.price}`] : []), `${l.qty * l.price}`].map((c, j) => (
              <td key={j} style={{ padding: 2, borderBottom: "1px solid #e5e7eb", textAlign: j === 1 ? "right" : "center" }}>{c}</td>
            ))}</tr>
          ))}</tbody>
        </table>
      )
    }
    return null
  }

  const PAPER = PAPER_PX[paper]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-[color:var(--theme-textPrimary)]">🎨 مصمّم الفاتورة الاحترافي</h1>
          <p className="text-xs text-[color:var(--theme-textPrimary)]/60">اسحب أي عنصر وحرّكه، كبّره، وغيّر كل شي. يتزامن على كل أجهزتك.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={undo} disabled={!past.length} className="rounded-xl border border-[color:var(--theme-cardBorder)] px-3 py-2 text-xs font-bold text-[color:var(--theme-textPrimary)] disabled:opacity-40">↶ تراجع</button>
          <button onClick={redo} disabled={!future.length} className="rounded-xl border border-[color:var(--theme-cardBorder)] px-3 py-2 text-xs font-bold text-[color:var(--theme-textPrimary)] disabled:opacity-40">↷ إعادة</button>
          <button onClick={() => setSnap((s) => !s)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${snap ? "border-[color:var(--theme-accent)] text-[color:var(--theme-accent)]" : "border-[color:var(--theme-cardBorder)] text-[color:var(--theme-textPrimary)]"}`}>⊞ محاذاة {snap ? "ON" : "OFF"}</button>
          <div className="flex gap-1 rounded-lg bg-black/10 p-1">
            {(["80mm", "a4"] as const).map((p) => (
              <button key={p} onClick={() => { setPaper(p); setSelId(null) }} className={`rounded-md px-3 py-1 text-xs font-bold ${paper === p ? "bg-[color:var(--theme-accent)] text-white" : "text-[color:var(--theme-textPrimary)]/70"}`}>{p === "80mm" ? "حراري 80mm" : "A4"}</button>
            ))}
          </div>
          <button onClick={resetPaper} className="rounded-xl border border-[color:var(--theme-cardBorder)] px-3 py-2 text-xs font-bold text-[color:var(--theme-textPrimary)] hover:bg-black/5">↺ افتراضي</button>
          <button onClick={handlePrint} className="rounded-xl border border-[color:var(--theme-cardBorder)] px-3 py-2 text-xs font-bold text-[color:var(--theme-textPrimary)] hover:bg-black/5">🖨️ طباعة تجريبية</button>
          <button onClick={handleSave} disabled={updateSettings.isPending} className="rounded-xl px-5 py-2 text-sm font-bold text-white shadow" style={{ background: "var(--theme-primaryBtn)" }}>
            {updateSettings.isPending ? "جارٍ الحفظ…" : saved ? "✓ تم الحفظ" : "💾 حفظ"}
          </button>
          {updateSettings.isError ? <span className="text-xs font-bold text-rose-600">فشل الحفظ. تحقق من رسالة الخادم وحاول مرة أخرى.</span> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[180px_1fr_260px]">
        {/* ── palette ── */}
        <div className="rounded-2xl border border-[color:var(--theme-cardBorder)] bg-[color:var(--theme-cardBg)] p-3">
          <h3 className="mb-2 text-xs font-black text-[color:var(--theme-textPrimary)]/70">أضف عنصر</h3>
          <div className="grid grid-cols-2 gap-2">
            {([
              ["field", "🔖 حقل"], ["text", "✏️ نص"], ["image", "🖼️ صورة"],
              ["items", "📋 جدول"], ["line", "➖ خط"], ["box", "⬜ صندوق"],
            ] as [ElType, string][]).map(([t, label]) => (
              <button key={t} onClick={() => addEl(t)} className="rounded-lg border border-[color:var(--theme-cardBorder)] py-2 text-[11px] font-bold text-[color:var(--theme-textPrimary)] hover:bg-[color:var(--theme-accent)]/10">{label}</button>
            ))}
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-[color:var(--theme-textPrimary)]/50">اضغط عنصر بالورقة لتحديده، اسحبه ليتحرك، واسحب الزاوية لتكبيره.</p>
        </div>

        {/* ── canvas ── */}
        <div className="flex justify-center overflow-auto rounded-2xl border border-[color:var(--theme-cardBorder)] bg-slate-300/30 p-4"
          style={snap ? { backgroundImage: "radial-gradient(rgba(99,102,241,.18) 1px, transparent 1px)", backgroundSize: `${GRID * 2}px ${GRID * 2}px` } : undefined}>
          <div
            onPointerDown={() => setSelId(null)}
            dir="rtl"
            style={{ position: "relative", width: PAPER.width * scale, height: PAPER.height * scale, background: "#fff", boxShadow: "0 4px 24px rgba(0,0,0,.2)", flexShrink: 0 }}
          >
            {design.elements.map((el) => {
              const isSel = el.id === selId
              const common: React.CSSProperties = {
                position: "absolute", right: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale,
                fontSize: (el.fontSize || 13) * scale, fontWeight: el.bold ? 800 : 500,
                color: el.color || "#0f172a", textAlign: el.align || "right",
                background: el.type === "line" ? (el.color || "#4f46e5") : el.bg, borderRadius: el.radius,
                border: isSel ? "2px solid #6366f1" : el.borderColor ? `1px solid ${el.borderColor}` : "1px dashed transparent",
                display: "flex", alignItems: el.type === "items" || el.type === "image" ? "flex-start" : "center",
                justifyContent: el.align === "center" ? "center" : el.align === "left" ? "flex-start" : "flex-end",
                overflow: "hidden", cursor: "move", userSelect: "none", padding: el.bg ? "0 4px" : 0, lineHeight: 1.3,
              }
              return (
                <div key={el.id} style={common} onPointerDown={(e) => startDrag(e, el.id, "move")}>
                  {el.type === "items" || el.type === "image" ? <div style={{ width: "100%" }}>{renderInner(el)}</div> : renderInner(el)}
                  {isSel && (
                    <div onPointerDown={(e) => startDrag(e, el.id, "resize")}
                      style={{ position: "absolute", bottom: -6, left: -6, width: 14, height: 14, background: "#6366f1", borderRadius: 3, cursor: "nwse-resize", border: "2px solid #fff" }} />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── properties ── */}
        <div className="rounded-2xl border border-[color:var(--theme-cardBorder)] bg-[color:var(--theme-cardBg)] p-3">
          {!sel ? (
            <p className="text-xs text-[color:var(--theme-textPrimary)]/50">اضغط على أي عنصر بالورقة لتعديله.</p>
          ) : (
            <div className="space-y-2 text-sm text-[color:var(--theme-textPrimary)]">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-black">خصائص العنصر</h3>
                <div className="flex gap-1">
                  <button onClick={() => dupEl(sel)} title="نسخ" className="rounded bg-black/10 px-2 py-1 text-[11px]">⎘</button>
                  <button onClick={() => removeEl(sel.id)} title="حذف" className="rounded bg-rose-500/15 px-2 py-1 text-[11px] text-rose-500">🗑</button>
                </div>
              </div>

              {sel.type === "text" && <Field label="النص"><input value={sel.text || ""} onChange={(e) => patchEl(sel.id, { text: e.target.value })} className={inp} /></Field>}
              {sel.type === "field" && (
                <Field label="نوع الحقل">
                  <select value={sel.field} onChange={(e) => patchEl(sel.id, { field: e.target.value as FieldKey })} className={inp}>
                    {(Object.keys(FIELD_LABELS) as FieldKey[]).map((k) => <option key={k} value={k}>{FIELD_LABELS[k]}</option>)}
                  </select>
                </Field>
              )}
              {sel.type === "field" && <Field label="نص قبل الحقل"><input value={sel.prefix || ""} onChange={(e) => patchEl(sel.id, { prefix: e.target.value })} className={inp} placeholder="مثال: الزبون: " /></Field>}

              {sel.type === "image" && (
                <>
                  <Field label="ارفع صورة من جهازك">
                    <input type="file" accept="image/*" onChange={(e) => onUpload(sel.id, e.target.files?.[0])} className="mt-1 w-full text-[11px] text-[color:var(--theme-textPrimary)]" />
                  </Field>
                  {sel.dataUrl && <button onClick={() => patchEl(sel.id, { dataUrl: undefined })} className="text-[11px] text-rose-500">إزالة الصورة المرفوعة</button>}
                  {!sel.dataUrl && (
                    <Field label="أو استخدم">
                      <select value={sel.src} onChange={(e) => patchEl(sel.id, { src: e.target.value as "logo" | "stamp" })} className={inp}>
                        <option value="logo">شعار المحل المحفوظ</option><option value="stamp">فراغ ختم</option>
                      </select>
                    </Field>
                  )}
                </>
              )}
              {sel.type === "items" && (
                <>
                  <Toggle label="عمود الكمية" on={!!sel.showQty} onChange={(v) => patchEl(sel.id, { showQty: v })} />
                  <Toggle label="عمود السعر" on={!!sel.showPrice} onChange={(v) => patchEl(sel.id, { showPrice: v })} />
                </>
              )}

              {sel.type !== "image" && sel.type !== "line" && (
                <>
                  <Field label={`حجم الخط (${sel.fontSize || 13})`}><input type="range" min={8} max={36} value={sel.fontSize || 13} onChange={(e) => patchEl(sel.id, { fontSize: Number(e.target.value) })} className="w-full" /></Field>
                  <Toggle label="عريض" on={!!sel.bold} onChange={(v) => patchEl(sel.id, { bold: v })} />
                  <Field label="المحاذاة">
                    <div className="flex gap-1 rounded bg-black/10 p-1">
                      {(["right", "center", "left"] as const).map((a) => (
                        <button key={a} onClick={() => patchEl(sel.id, { align: a })} className={`rounded px-2 py-1 text-[11px] ${sel.align === a ? "bg-[color:var(--theme-accent)] text-white" : ""}`}>{a === "right" ? "يمين" : a === "center" ? "وسط" : "يسار"}</button>
                      ))}
                    </div>
                  </Field>
                </>
              )}

              <Field label="اللون"><input type="color" value={sel.color || "#0f172a"} onChange={(e) => patchEl(sel.id, { color: e.target.value })} className="h-8 w-14 rounded" /></Field>
              {(sel.type === "field" || sel.type === "text" || sel.type === "box") && (
                <Field label="لون الخلفية"><input type="color" value={sel.bg || "#ffffff"} onChange={(e) => patchEl(sel.id, { bg: e.target.value })} className="h-8 w-14 rounded" /></Field>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1">
                <Num label="عرض" v={sel.w} onChange={(n) => patchEl(sel.id, { w: n })} />
                <Num label="ارتفاع" v={sel.h} onChange={(n) => patchEl(sel.id, { h: n })} />
              </div>
            </div>
          )}
        </div>
      </div>

      <iframe ref={printRef} title="print" style={{ position: "fixed", width: 0, height: 0, border: 0, left: -9999 }} />
    </div>
  )
}

const inp = "mt-1 w-full rounded-lg border border-[color:var(--theme-cardBorder)] bg-transparent px-2 py-1.5 text-sm text-[color:var(--theme-textPrimary)]"

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-[11px] text-[color:var(--theme-textPrimary)]/60">{label}</span>{children}</label>
}
function Num({ label, v, onChange }: { label: string; v: number; onChange: (n: number) => void }) {
  return <label className="block"><span className="text-[11px] text-[color:var(--theme-textPrimary)]/60">{label}</span><input type="number" value={Math.round(v)} onChange={(e) => onChange(Number(e.target.value))} className={inp} /></label>
}
function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 py-1 text-sm">
      <span className="text-[color:var(--theme-textPrimary)]/80">{label}</span>
      <button type="button" onClick={() => onChange(!on)} className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-[color:var(--theme-accent)]" : "bg-slate-400/40"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-0.5" : "left-[18px]"}`} />
      </button>
    </label>
  )
}

export default InvoiceDesignerPage
