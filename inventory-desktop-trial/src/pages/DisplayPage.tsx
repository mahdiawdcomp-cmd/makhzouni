import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Check, LayoutGrid, List, Rows3, Search, Settings, X } from "lucide-react"
import { getDisplayProducts, type DisplayData, type DisplayProduct } from "../api/endpoints"

function fmt(n: number) {
  return n.toLocaleString("en-US")
}

type Layout = "grid" | "showcase" | "list"
type Settings = { layout: Layout; category: string | null; ids: string[] | null }

const SETTINGS_KEY = "display_settings"
const PAGE_SIZE: Record<Layout, number> = { grid: 18, showcase: 6, list: 22 }

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "")
    return { layout: s.layout ?? "grid", category: s.category ?? null, ids: Array.isArray(s.ids) ? s.ids : null }
  } catch {
    return { layout: "grid", category: null, ids: null }
  }
}

// ── Price block, reused across layouts ────────────────────────────────────────
function Prices({ product, currency, big }: { product: DisplayProduct; currency: string; big?: boolean }) {
  const showRetail = product.retailPrice > 0 && product.retailPrice !== product.salePrice
  return (
    <div className="flex items-end justify-between gap-2">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-white/40">الجملة</div>
        <div className={`font-extrabold text-amber-300 ${big ? "text-3xl" : "text-base"}`}>
          {fmt(product.salePrice)} <span className="text-xs font-normal text-white/40">{currency}</span>
        </div>
      </div>
      {showRetail && (
        <div className="text-left">
          <div className="text-[10px] uppercase tracking-wider text-white/40">المفرد</div>
          <div className={`font-bold text-white/90 ${big ? "text-xl" : "text-sm"}`}>
            {fmt(product.retailPrice)} <span className="text-[11px] font-normal text-white/40">{currency}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function ProductImage({ product, className }: { product: DisplayProduct; className: string }) {
  return product.imageUrl ? (
    <img src={product.imageUrl} alt={product.name} className={`${className} object-cover`} loading="lazy" />
  ) : (
    <div className={`${className} flex items-center justify-center bg-white/[0.04] font-black text-white/15`}>
      {product.name.slice(0, 2)}
    </div>
  )
}

function GridCard({ product, currency }: { product: DisplayProduct; currency: string }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] shadow-xl shadow-black/30 backdrop-blur-md transition-colors duration-300 hover:border-amber-300/30">
      <ProductImage product={product} className="h-36 w-full" />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex-1">
          {product.category && (
            <span className="mb-1 inline-block rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/60">{product.category}</span>
          )}
          <h3 className="mt-0.5 line-clamp-2 text-sm font-bold leading-snug text-white">{product.name}</h3>
        </div>
        <Prices product={product} currency={currency} />
      </div>
    </div>
  )
}

function ShowcaseCard({ product, currency }: { product: DisplayProduct; currency: string }) {
  return (
    <div className="flex overflow-hidden rounded-3xl border border-white/10 bg-white/[0.06] shadow-2xl shadow-black/40 backdrop-blur-md transition-colors duration-300 hover:border-amber-300/30">
      <ProductImage product={product} className="h-44 w-44 shrink-0" />
      <div className="flex flex-1 flex-col justify-between gap-3 p-5">
        <div>
          {product.category && (
            <span className="mb-2 inline-block rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold text-white/60">{product.category}</span>
          )}
          <h3 className="line-clamp-2 text-xl font-extrabold leading-tight text-white">{product.name}</h3>
        </div>
        <Prices product={product} currency={currency} big />
      </div>
    </div>
  )
}

function ListRow({ product, currency }: { product: DisplayProduct; currency: string }) {
  const showRetail = product.retailPrice > 0 && product.retailPrice !== product.salePrice
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 backdrop-blur-sm">
      <ProductImage product={product} className="h-11 w-11 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-bold text-white">{product.name}</div>
        {product.category && <div className="truncate text-[11px] text-white/40">{product.category}</div>}
      </div>
      <div className="text-left">
        <div className="text-base font-extrabold text-amber-300">{fmt(product.salePrice)} <span className="text-[10px] font-normal text-white/40">{currency}</span></div>
        {showRetail && <div className="text-[11px] font-semibold text-white/70">مفرد {fmt(product.retailPrice)}</div>}
      </div>
    </div>
  )
}

export function DisplayPage() {
  const [data, setData] = useState<DisplayData | null>(null)
  const [page, setPage] = useState(0)
  const [error, setError] = useState("")
  const [tick, setTick] = useState(0)
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelSearch, setPanelSearch] = useState("")
  const time = useCurrentTime()

  const ROTATE_INTERVAL = 9000
  const REFRESH_INTERVAL = 60_000

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const d = await getDisplayProducts()
        if (!cancelled) { setData(d); setError("") }
      } catch {
        if (!cancelled) setError("تعذر تحميل البيانات")
      }
    }
    void load()
    const refreshTimer = setInterval(load, REFRESH_INTERVAL)
    return () => { cancelled = true; clearInterval(refreshTimer) }
  }, [])

  const categories = useMemo(() => {
    if (!data) return [] as string[]
    return [...new Set(data.products.map((p) => p.category).filter((c): c is string => !!c))]
  }, [data])

  // Products actually shown = category filter + explicit selection (null = all).
  const shown = useMemo(() => {
    if (!data) return [] as DisplayProduct[]
    return data.products.filter((p) => {
      if (settings.category && p.category !== settings.category) return false
      if (settings.ids && !settings.ids.includes(p.id)) return false
      return true
    })
  }, [data, settings.category, settings.ids])

  const pageSize = PAGE_SIZE[settings.layout]
  const totalPages = Math.max(1, Math.ceil(shown.length / pageSize))

  useEffect(() => { setPage(0) }, [settings.layout, settings.category, settings.ids])

  useEffect(() => {
    if (totalPages <= 1) return
    const timer = setInterval(() => {
      setPage((prev) => (prev + 1) % totalPages)
      setTick((t) => t + 1)
    }, ROTATE_INTERVAL)
    return () => clearInterval(timer)
  }, [totalPages])

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-white">
        <div className="space-y-3 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-400" />
          <div className="text-lg">{error}</div>
        </div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-amber-300" />
      </div>
    )
  }

  const visible = shown.slice(page * pageSize, (page + 1) * pageSize)
  const panelList = data.products.filter((p) =>
    !panelSearch.trim() || p.name.toLowerCase().includes(panelSearch.trim().toLowerCase()),
  )

  function toggleId(id: string) {
    setSettings((s) => {
      const cur = s.ids ?? data!.products.map((p) => p.id)
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      return { ...s, ids: next.length === data!.products.length ? null : next }
    })
  }

  return (
    <div
      dir="rtl"
      className="relative flex h-screen flex-col overflow-hidden select-none"
      style={{ background: "radial-gradient(circle at 20% 10%, #1e1b4b 0%, #0b1020 45%, #070a14 100%)", fontFamily: '"Cairo", system-ui, sans-serif' }}
    >
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-indigo-600/15 blur-3xl" />
        <div className="absolute -bottom-40 -right-40 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative flex items-center justify-between border-b border-white/10 bg-black/20 px-8 py-4 backdrop-blur-md">
        <div className="flex items-center gap-4">
          {data.storeLogo && <img src={data.storeLogo} alt="" className="h-11 w-11 rounded-xl object-contain ring-1 ring-white/20" />}
          <div>
            <div className="text-xl font-extrabold tracking-tight text-white">{data.storeName}</div>
            <div className="flex items-center gap-2 text-xs text-amber-300/70">
              <span className="h-1 w-1 rounded-full bg-amber-300/60" /> قائمة الأسعار
            </div>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-left">
            <div className="text-2xl font-bold tabular-nums text-white">{time}</div>
            <div className="text-xs text-white/40">{totalPages > 1 ? `صفحة ${page + 1} / ${totalPages}` : `${shown.length} منتج`}</div>
          </div>
          <button type="button" onClick={() => setPanelOpen(true)} aria-label="إعدادات العرض" className="cursor-pointer rounded-xl border border-white/15 bg-white/5 p-2.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white">
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Body */}
      <main className="relative flex-1 overflow-hidden p-5">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-white/40">لا توجد منتجات للعرض — افتح الإعدادات لاختيار البضاعة</div>
        ) : settings.layout === "list" ? (
          <div key={`${page}-${tick}`} className="grid h-full grid-cols-2 content-start gap-2 duration-700 animate-in fade-in">
            {visible.map((p) => <ListRow key={p.id} product={p} currency={data.currency} />)}
          </div>
        ) : settings.layout === "showcase" ? (
          <div key={`${page}-${tick}`} className="grid h-full grid-cols-2 content-start gap-4 duration-700 animate-in fade-in xl:grid-cols-3">
            {visible.map((p) => <ShowcaseCard key={p.id} product={p} currency={data.currency} />)}
          </div>
        ) : (
          <div key={`${page}-${tick}`} className="grid h-full gap-3 duration-700 animate-in fade-in" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))" }}>
            {visible.map((p) => <GridCard key={p.id} product={p} currency={data.currency} />)}
          </div>
        )}
      </main>

      {/* Footer dots */}
      {totalPages > 1 && (
        <div className="relative flex items-center justify-center gap-1.5 py-2.5">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button key={i} type="button" onClick={() => setPage(i)} aria-label={`صفحة ${i + 1}`} className={`h-1.5 cursor-pointer rounded-full transition-all duration-300 ${i === page ? "w-7 bg-amber-300" : "w-1.5 bg-white/25"}`} />
          ))}
        </div>
      )}

      {/* Settings panel */}
      {panelOpen && (
        <div className="absolute inset-0 z-30 flex" dir="rtl">
          <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setPanelOpen(false)} />
          <div className="flex h-full w-[380px] max-w-[90vw] flex-col bg-slate-900 text-white shadow-2xl duration-300 animate-in slide-in-from-left">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="text-lg font-bold">إعدادات العرض</div>
              <button type="button" onClick={() => setPanelOpen(false)} aria-label="إغلاق" className="cursor-pointer rounded-lg p-1.5 text-white/60 hover:bg-white/10"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              {/* Layout */}
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">طريقة العرض</div>
                <div className="grid grid-cols-3 gap-2">
                  {([["grid", "شبكة", LayoutGrid], ["showcase", "عرض فاخر", Rows3], ["list", "قائمة", List]] as const).map(([id, label, Icon]) => (
                    <button key={id} type="button" onClick={() => setSettings((s) => ({ ...s, layout: id }))} className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-semibold transition-colors ${settings.layout === id ? "border-amber-300 bg-amber-300/10 text-amber-200" : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"}`}>
                      <Icon className="h-5 w-5" /> {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Category */}
              {categories.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">القسم</div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => setSettings((s) => ({ ...s, category: null }))} className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors ${!settings.category ? "bg-amber-300 text-slate-900" : "bg-white/10 text-white/70 hover:bg-white/15"}`}>الكل</button>
                    {categories.map((c) => (
                      <button key={c} type="button" onClick={() => setSettings((s) => ({ ...s, category: s.category === c ? null : c }))} className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors ${settings.category === c ? "bg-amber-300 text-slate-900" : "bg-white/10 text-white/70 hover:bg-white/15"}`}>{c}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Product selection */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-xs font-semibold uppercase tracking-wider text-white/40">اختيار البضاعة</div>
                  <div className="flex gap-2 text-[11px]">
                    <button type="button" onClick={() => setSettings((s) => ({ ...s, ids: null }))} className="cursor-pointer font-semibold text-amber-300 hover:underline">الكل</button>
                    <button type="button" onClick={() => setSettings((s) => ({ ...s, ids: [] }))} className="cursor-pointer font-semibold text-white/50 hover:underline">إلغاء</button>
                  </div>
                </div>
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5">
                  <Search className="h-4 w-4 text-white/40" />
                  <input value={panelSearch} onChange={(e) => setPanelSearch(e.target.value)} placeholder="ابحث…" className="flex-1 bg-transparent py-2 text-sm text-white outline-none placeholder:text-white/30" />
                </div>
                <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                  {panelList.map((p) => {
                    const selected = settings.ids === null || settings.ids.includes(p.id)
                    return (
                      <button key={p.id} type="button" onClick={() => toggleId(p.id)} className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-right transition-colors hover:bg-white/5">
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${selected ? "border-amber-300 bg-amber-300 text-slate-900" : "border-white/25"}`}>{selected && <Check className="h-3.5 w-3.5" />}</span>
                        <span className="flex-1 truncate text-sm text-white/85">{p.name}</span>
                        <span className="text-[11px] text-amber-300/80">{fmt(p.salePrice)}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 p-4">
              <button type="button" onClick={() => setPanelOpen(false)} className="w-full cursor-pointer rounded-xl bg-amber-300 py-3 font-bold text-slate-900 transition-colors hover:bg-amber-200">تم</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function useCurrentTime() {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" }))
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })), 10_000)
    return () => clearInterval(id)
  }, [])
  return time
}
