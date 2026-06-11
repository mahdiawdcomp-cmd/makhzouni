import { useEffect, useState } from "react"
import { getDisplayProducts, type DisplayData, type DisplayProduct } from "../api/endpoints"

function fmt(n: number) {
  return n.toLocaleString("ar-IQ")
}

function ProductCard({ product, currency }: { product: DisplayProduct; currency: string }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 shadow-lg transition-transform duration-300 hover:scale-[1.02]">
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt={product.name}
          className="h-40 w-full object-cover"
        />
      ) : (
        <div className="flex h-40 items-center justify-center bg-white/5 text-4xl font-bold text-white/30">
          {product.name.slice(0, 2)}
        </div>
      )}
      <div className="flex flex-1 flex-col p-3">
        <div className="flex-1">
          {product.category && (
            <span className="mb-1 inline-block rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/70">
              {product.category}
            </span>
          )}
          <h3 className="mt-1 text-sm font-bold leading-snug text-white line-clamp-2">{product.name}</h3>
        </div>
        <div className="mt-2 flex items-end justify-between gap-1">
          <div>
            <div className="text-xs text-white/50">الجملة</div>
            <div className="text-base font-extrabold text-emerald-300">
              {fmt(product.salePrice)} <span className="text-xs font-normal opacity-70">{currency}</span>
            </div>
          </div>
          {product.retailPrice > 0 && product.retailPrice !== product.salePrice && (
            <div className="text-right">
              <div className="text-xs text-white/50">المفرد</div>
              <div className="text-sm font-bold text-amber-300">
                {fmt(product.retailPrice)} <span className="text-xs font-normal opacity-70">{currency}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function DisplayPage() {
  const [data, setData] = useState<DisplayData | null>(null)
  const [page, setPage] = useState(0)
  const [error, setError] = useState("")
  const [tick, setTick] = useState(0)

  const PAGE_SIZE = 18
  const ROTATE_INTERVAL = 8000
  const REFRESH_INTERVAL = 60_000

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

  useEffect(() => {
    if (!data) return
    const totalPages = Math.ceil(data.products.length / PAGE_SIZE)
    if (totalPages <= 1) return
    const timer = setInterval(() => {
      setPage((prev) => (prev + 1) % totalPages)
      setTick((t) => t + 1)
    }, ROTATE_INTERVAL)
    return () => clearInterval(timer)
  }, [data])

  const time = useCurrentTime()

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        <div className="text-center space-y-2">
          <div className="text-4xl">⚠️</div>
          <div className="text-lg">{error}</div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-900">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      </div>
    )
  }

  const visible = data.products.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(data.products.length / PAGE_SIZE)

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden select-none"
      style={{
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 40%, #0f172a 100%)",
        fontFamily: '"Cairo", system-ui, sans-serif',
      }}
    >
      {/* Animated background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-700/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-violet-700/20 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600/10 blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative flex items-center justify-between border-b border-white/10 bg-black/30 px-8 py-4 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          {data.storeLogo && (
            <img src={data.storeLogo} alt="logo" className="h-10 w-10 rounded-xl object-contain" />
          )}
          <div>
            <div className="text-xl font-extrabold text-white tracking-tight">{data.storeName}</div>
            <div className="text-xs text-white/40">قائمة الأسعار</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-white tabular-nums">{time}</div>
          <div className="text-xs text-white/40">
            {totalPages > 1 ? `صفحة ${page + 1} / ${totalPages}` : `${data.products.length} منتج`}
          </div>
        </div>
      </header>

      {/* Products grid */}
      <main className="relative flex-1 overflow-hidden p-4">
        <div
          key={`${page}-${tick}`}
          className="grid h-full gap-3 animate-in fade-in duration-700"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
        >
          {visible.map((product) => (
            <ProductCard key={product.id} product={product} currency={data.currency} />
          ))}
        </div>
      </main>

      {/* Footer dots */}
      {totalPages > 1 && (
        <div className="relative flex items-center justify-center gap-1.5 py-2">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setPage(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === page ? "w-6 bg-white" : "w-1.5 bg-white/30"}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function useCurrentTime() {
  const [time, setTime] = useState(() =>
    new Date().toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" })
  )
  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" }))
    }, 10_000)
    return () => clearInterval(id)
  }, [])
  return time
}
