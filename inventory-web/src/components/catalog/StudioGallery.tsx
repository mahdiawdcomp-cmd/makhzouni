import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, ImageOff, Search, X } from "lucide-react"
import { getCatalogMediums } from "../../api/endpoints"
import type { PublicCatalogProduct } from "../../types/api"

/* ══════════════════════════════════════════════════════════════════════
   «المعرض» — the shop as a photo gallery

   A tile is a picture and nothing else: no price, no name, no badge. The
   whole point is that the goods sell themselves the way they do in a phone's
   photo album, and every label added to a tile is a step back toward the
   grid the shopper already has.

   Everything the shop would have printed on the tile — price, stock, the buy
   button — waits inside the picture, one tap away.
══════════════════════════════════════════════════════════════════════ */

export interface StudioTokens {
  bg: string
  cardBg: string
  cardBorder: string
  text: string
  subtext: string
  accent: string
  accentLight: string
  catIdle: string
  catIdleText: string
  divider: string
  skeletonBg: string
  radiusSm: string
  radiusMd: string
  radiusLg: string
  shadowMd: string
  fs: { xs: string; sm: string; md: string; lg: string; xl: string }
}

export interface StudioAlbum {
  key: string
  label: string
  count: number
}

export function StudioGallery({
  products,
  albums,
  album,
  onAlbum,
  search,
  onSearch,
  perRow,
  shape,
  offerDot,
  accessToken,
  visitorToken,
  tk,
  onOpen,
}: {
  products: PublicCatalogProduct[]
  albums: StudioAlbum[]
  album: string
  onAlbum: (key: string) => void
  search: string
  onSearch: (v: string) => void
  perRow: number
  shape: "square" | "natural"
  offerDot: boolean
  accessToken: string
  visitorToken: string
  tk: StudioTokens
  onOpen: (index: number) => void
}) {
  // Pictures are fetched for what is about to be drawn, never for the whole
  // catalog — the same rule the store's grid follows, at a bigger size.
  const [pics, setPics] = useState<Record<string, string | null>>({})
  const askedRef = useRef<Set<string>>(new Set())

  const visibleIds = useMemo(() => products.slice(0, 60).map((p) => p.id), [products])

  useEffect(() => {
    const missing = visibleIds.filter((id) => !askedRef.current.has(id))
    if (missing.length === 0) return
    missing.forEach((id) => askedRef.current.add(id))
    let cancelled = false
    void (async () => {
      try {
        const got = await getCatalogMediums(missing, {
          access: accessToken || undefined,
          visitor: visitorToken || undefined,
        })
        if (!cancelled) setPics((prev) => ({ ...prev, ...got }))
      } catch {
        // A failed fetch leaves the tile on its placeholder rather than
        // emptying the gallery — the shopper can still scroll and tap.
        missing.forEach((id) => askedRef.current.delete(id))
      }
    })()
    return () => { cancelled = true }
  }, [visibleIds, accessToken, visitorToken])

  const cols = Math.max(1, Math.min(5, perRow))

  return (
    <div className="flex flex-col" style={{ background: tk.bg }}>
      {/* ── Albums. The shop's categories, read the way a phone reads them. ── */}
      {albums.length > 1 && (
        <div className="sticky top-0 z-10 overflow-x-auto scrollbar-hide px-3 py-2.5"
          style={{ background: tk.bg, borderBottom: `1px solid ${tk.divider}` }}>
          <div className="flex gap-2">
            {albums.map((a) => {
              const on = album === a.key
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => onAlbum(a.key)}
                  aria-pressed={on}
                  className="press flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-4 font-bold transition-colors duration-200"
                  style={{
                    background: on ? tk.accent : tk.catIdle,
                    color: on ? "#ffffff" : tk.catIdleText,
                    fontSize: tk.fs.sm,
                  }}
                >
                  {a.label}
                  <span className="rounded-full px-1.5 font-extrabold"
                    style={{
                      background: on ? "rgba(255,255,255,0.25)" : tk.cardBg,
                      color: on ? "#ffffff" : tk.subtext,
                      fontSize: tk.fs.xs,
                    }}>
                    {a.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Search. The only other control in here. ── */}
      <div className="px-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: tk.subtext }} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="ابحث بالصور..."
            aria-label="ابحث بالصور"
            className="h-11 w-full border-0 pr-9 pl-3 outline-none transition-colors duration-200"
            style={{
              background: tk.cardBg, color: tk.text, borderRadius: tk.radiusMd,
              border: `1px solid ${tk.divider}`, fontSize: tk.fs.md,
            }}
          />
          {search && (
            <button type="button" onClick={() => onSearch("")} aria-label="امسح البحث"
              className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full transition-colors duration-200"
              style={{ color: tk.subtext }}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {products.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full" style={{ background: tk.catIdle }}>
            <ImageOff className="h-7 w-7" style={{ color: tk.subtext }} aria-hidden="true" />
          </div>
          <p className="font-extrabold" style={{ color: tk.text, fontSize: tk.fs.lg }}>ما اكو صور بهذا الألبوم</p>
          <p style={{ color: tk.subtext, fontSize: tk.fs.sm }}>جرب ألبوم ثاني أو كلمة بحث مختلفة</p>
        </div>
      )}

      {/* ── The gallery itself. ── */}
      <div className="grid gap-1 p-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {products.map((p, i) => (
          <Tile
            key={p.id}
            product={p}
            src={pics[p.id] ?? p.thumbnailUrl ?? null}
            shape={shape}
            offerDot={offerDot}
            // The pictures are data the browser already holds, not files it
            // has to go and fetch — so deferring the first two screenfuls
            // bought nothing and made the gallery look like it was stalling
            // until you scrolled. Past that, laziness is still worth it.
            eager={i < 24}
            tk={tk}
            onOpen={() => onOpen(i)}
          />
        ))}
      </div>
    </div>
  )
}

function Tile({ product, src, shape, offerDot, eager, tk, onOpen }: {
  product: PublicCatalogProduct
  src: string | null
  shape: "square" | "natural"
  offerDot: boolean
  eager: boolean
  tk: StudioTokens
  onOpen: () => void
}) {
  // A picture that is already decoded fires onLoad before this ever renders,
  // so gating opacity on it left tiles blank forever. Only the deferred ones
  // fade in, and only until they land.
  const [loaded, setLoaded] = useState(false)
  const showing = eager || loaded

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`افتح صورة ${product.name}`}
      className="tile-enter press group relative block w-full cursor-pointer overflow-hidden hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{
        // Square reserves its space, so nothing on the page jumps as pictures
        // arrive. Natural has to guess, and 4:5 is the common shape of a
        // product photo taken on a phone.
        aspectRatio: shape === "square" ? "1 / 1" : "4 / 5",
        background: tk.skeletonBg,
        borderRadius: tk.radiusSm,
        outlineColor: tk.accent,
      }}
    >
      {src ? (
        <img
          src={src}
          alt={product.name}
          decoding="async"
          onLoad={() => setLoaded(true)}
          loading={eager ? "eager" : "lazy"}
          className="h-full w-full object-cover transition-opacity duration-300"
          style={{ opacity: showing ? 1 : 0 }}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <ImageOff className="h-6 w-6" style={{ color: tk.subtext, opacity: 0.35 }} aria-hidden="true" />
        </span>
      )}

      {/* An offer would be invisible on a bare tile, so it keeps one dot. */}
      {offerDot && product.isOffer && (
        <span
          className="absolute right-1.5 top-1.5 block h-2.5 w-2.5 rounded-full ring-2 ring-white/70"
          style={{ background: "#e11d48" }}
          aria-label="عرض"
        />
      )}
    </button>
  )
}

/* ══════════════════════════════════════════════════════════════════════
   The opened picture

   Full resolution, swipe or arrow to the next, and everything the tile
   deliberately withheld — price, stock, the buy button — on a sheet beneath
   it. Closing goes back to exactly where the shopper was in the grid.
══════════════════════════════════════════════════════════════════════ */
export function StudioViewer({
  products,
  index,
  fullSrc,
  fallbackSrc,
  loading,
  tk,
  onIndex,
  onClose,
  children,
}: {
  products: PublicCatalogProduct[]
  index: number
  fullSrc: string | null
  fallbackSrc: string | null
  loading: boolean
  tk: StudioTokens
  onIndex: (next: number) => void
  onClose: () => void
  children: React.ReactNode
}) {
  const product = products[index]
  const touchX = useRef<number | null>(null)

  // Escape closes and the arrows move, so the gallery works on a laptop too.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
      // RTL: «next» is to the LEFT of the current picture on screen.
      if (e.key === "ArrowLeft" && index < products.length - 1) onIndex(index + 1)
      if (e.key === "ArrowRight" && index > 0) onIndex(index - 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, products.length, onIndex, onClose])

  if (!product) return null

  const go = (delta: number) => {
    const next = index + delta
    if (next >= 0 && next < products.length) onIndex(next)
  }

  return (
    <div
      /* z-140 is deliberate and load-bearing: the opened picture is a PAGE
         surface, not a dialog. Above the header (30) and the store's own
         layers, but BELOW every sheet from 150 up — the unit picker, the
         cart, the appearance sheet. At 190 it covered them all, so adding to
         the cart from inside a photo opened the picker behind the photo and
         looked like a dead button. */
      className="viewer-enter fixed inset-0 z-[130] flex flex-col"
      style={{ background: "rgba(0,0,0,0.94)", overscrollBehavior: "contain" }}
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-label={product.name}
    >
      {/* Close + position. Kept off the picture so a tap never misfires. */}
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="إغلاق"
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-200 hover:bg-white/10"
        >
          <X className="h-6 w-6 text-white" />
        </button>
        <span className="font-bold text-white/70" style={{ fontSize: tk.fs.sm }} dir="ltr">
          {index + 1} / {products.length}
        </span>
      </div>

      {/* The picture. */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-2"
        onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
        onTouchEnd={(e) => {
          if (touchX.current == null) return
          const dx = e.changedTouches[0].clientX - touchX.current
          touchX.current = null
          // 60px so a scroll never counts as a swipe. RTL again: dragging the
          // picture to the RIGHT reveals the one after it.
          if (Math.abs(dx) < 60) return
          go(dx > 0 ? 1 : -1)
        }}
      >
        {(fullSrc || fallbackSrc) && (
          <img
            key={product.id}
            src={fullSrc ?? fallbackSrc ?? ""}
            alt={product.name}
            className="viewer-enter max-h-full max-w-full object-contain"
            style={{ opacity: fullSrc ? 1 : 0.65, transition: "opacity 200ms ease-out" }}
            draggable={false}
          />
        )}
        {loading && !fullSrc && (
          <span className="absolute bottom-3 rounded-full bg-black/60 px-3 py-1 font-bold text-white/80"
            style={{ fontSize: tk.fs.xs }}>
            جاري تحميل الصورة الكاملة...
          </span>
        )}

        {/* Arrows for a mouse. Hidden from a screen reader — the keyboard
            handler above already covers the same movement. */}
        {index > 0 && (
          <button type="button" onClick={() => go(-1)} aria-label="السابق"
            className="absolute right-2 hidden h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-black/40 transition-colors duration-200 hover:bg-black/70 sm:flex">
            <ChevronRight className="h-6 w-6 text-white" />
          </button>
        )}
        {index < products.length - 1 && (
          <button type="button" onClick={() => go(1)} aria-label="التالي"
            className="absolute left-2 hidden h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-black/40 transition-colors duration-200 hover:bg-black/70 sm:flex">
            <ChevronLeft className="h-6 w-6 text-white" />
          </button>
        )}
      </div>

      {/* Everything the tile withheld. */}
      <div className="sheet-enter shrink-0 overflow-y-auto" style={{ background: tk.cardBg, maxHeight: "45vh" }}>
        {children}
      </div>
    </div>
  )
}
