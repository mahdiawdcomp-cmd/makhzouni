import { useEffect, useState } from "react"

const PREVIEW = 260
const GAP = 12

/**
 * A small product thumbnail that shows a large preview while the pointer rests
 * on it — no click. The preview is `position: fixed`, so a scrolling dropdown
 * (overflow: auto) cannot clip it; it opens beside the thumbnail on whichever
 * side has room and never catches the pointer itself.
 */
export function HoverZoomImage({
  src,
  largeSrc,
  alt = "",
  fallback,
  className = "h-10 w-10",
}: {
  src?: string | null
  /** Sharper image for the preview; falls back to `src`. */
  largeSrc?: string | null
  alt?: string
  /** Shown when there is no image at all. */
  fallback?: string
  className?: string
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Scrolling moves the thumbnail out from under a still pointer without a
  // mouseleave — close the preview rather than leave it floating elsewhere.
  useEffect(() => {
    if (!pos) return
    const hide = () => setPos(null)
    window.addEventListener("scroll", hide, true)
    return () => window.removeEventListener("scroll", hide, true)
  }, [pos])

  if (!src) {
    return (
      <span className={`grid shrink-0 place-items-center rounded bg-slate-100 text-[9px] font-bold text-slate-400 dark:bg-slate-800 ${className}`}>
        {fallback?.slice(0, 4)}
      </span>
    )
  }

  function show(e: React.MouseEvent<HTMLImageElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    // RTL layout: the page's free space is usually to the left of the thumbnail.
    const left = rect.left - GAP - PREVIEW >= 8
      ? rect.left - GAP - PREVIEW
      : Math.min(rect.right + GAP, window.innerWidth - PREVIEW - 8)
    const top = Math.min(Math.max(8, rect.top + rect.height / 2 - PREVIEW / 2), window.innerHeight - PREVIEW - 8)
    setPos({ left, top })
  }

  return (
    <>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        className={`shrink-0 cursor-zoom-in rounded object-cover ring-1 ring-slate-200 dark:ring-slate-700 ${className}`}
      />
      {pos && (
        <div
          className="pointer-events-none fixed z-[100] overflow-hidden rounded-xl border bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          style={{ left: pos.left, top: pos.top, width: PREVIEW, height: PREVIEW }}
        >
          <img src={largeSrc || src} alt={alt} className="h-full w-full object-contain" />
        </div>
      )}
    </>
  )
}
