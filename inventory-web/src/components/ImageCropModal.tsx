import { useCallback, useEffect, useRef, useState } from "react"
import { Check, X } from "lucide-react"
import { Button } from "./ui/button"
import { cn } from "../utils/cn"

interface CropRect { x: number; y: number; w: number; h: number } // 0-100 % of displayed image

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move"

interface DragState {
  handle: Handle
  startPtr: { x: number; y: number }
  startCrop: CropRect
  imgW: number
  imgH: number
}

const MIN_PCT = 5 // minimum crop size (% of image)

function clamp(val: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, val)) }

function handleCursors(): Record<Handle, string> {
  return { nw: "nw-resize", n: "n-resize", ne: "ne-resize", e: "e-resize", se: "se-resize", s: "s-resize", sw: "sw-resize", w: "w-resize", move: "move" }
}

/** Resize handles: [{handle, left%, top%}] */
const HANDLES: { id: Handle; lx: number; ly: number }[] = [
  { id: "nw", lx: 0,   ly: 0 },
  { id: "n",  lx: 50,  ly: 0 },
  { id: "ne", lx: 100, ly: 0 },
  { id: "e",  lx: 100, ly: 50 },
  { id: "se", lx: 100, ly: 100 },
  { id: "s",  lx: 50,  ly: 100 },
  { id: "sw", lx: 0,   ly: 100 },
  { id: "w",  lx: 0,   ly: 50 },
]

export function ImageCropModal({
  src,
  onDone,
  onCancel,
}: {
  src: string
  onDone: (croppedDataUrl: string) => void
  onCancel: () => void
}) {
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [crop, setCrop] = useState<CropRect>({ x: 5, y: 5, w: 90, h: 90 })

  const onPointerDown = useCallback((e: React.PointerEvent, handle: Handle) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const img = imgRef.current
    if (!img) return
    dragRef.current = {
      handle,
      startPtr: { x: e.clientX, y: e.clientY },
      startCrop: { ...crop },
      imgW: img.getBoundingClientRect().width,
      imgH: img.getBoundingClientRect().height,
    }
  }, [crop])

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = dragRef.current
      if (!d) return
      const dx = ((e.clientX - d.startPtr.x) / d.imgW) * 100
      const dy = ((e.clientY - d.startPtr.y) / d.imgH) * 100
      const c = { ...d.startCrop }

      if (d.handle === "move") {
        const newX = clamp(c.x + dx, 0, 100 - c.w)
        const newY = clamp(c.y + dy, 0, 100 - c.h)
        setCrop({ ...c, x: newX, y: newY })
        return
      }

      let { x, y, w, h } = c
      if (d.handle.includes("n")) { const ny = clamp(y + dy, 0, y + h - MIN_PCT); h = y + h - ny; y = ny }
      if (d.handle.includes("s")) { h = clamp(h + dy, MIN_PCT, 100 - y) }
      if (d.handle.includes("w")) { const nx = clamp(x + dx, 0, x + w - MIN_PCT); w = x + w - nx; x = nx }
      if (d.handle.includes("e")) { w = clamp(w + dx, MIN_PCT, 100 - x) }

      setCrop({ x: clamp(x, 0, 100), y: clamp(y, 0, 100), w: clamp(w, MIN_PCT, 100), h: clamp(h, MIN_PCT, 100) })
    }
    function onUp() { dragRef.current = null }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp) }
  }, [])

  function applyCrop() {
    const img = imgRef.current
    if (!img) return
    const scaleX = img.naturalWidth / img.getBoundingClientRect().width
    const scaleY = img.naturalHeight / img.getBoundingClientRect().height
    const x = (crop.x / 100) * img.getBoundingClientRect().width * scaleX
    const y = (crop.y / 100) * img.getBoundingClientRect().height * scaleY
    const w = (crop.w / 100) * img.getBoundingClientRect().width * scaleX
    const h = (crop.h / 100) * img.getBoundingClientRect().height * scaleY
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(w)
    canvas.height = Math.round(h)
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h)
    onDone(canvas.toDataURL("image/jpeg", 0.92))
  }

  const cursors = handleCursors()

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-black/80 p-3" dir="rtl">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h3 className="font-bold text-slate-800 dark:text-slate-100">اقتصاص الصورة</h3>
          <button onClick={onCancel} className="rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Image + crop overlay */}
        <div
          ref={containerRef}
          className="relative flex items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-800"
          style={{ maxHeight: "60vh" }}
        >
          <img
            ref={imgRef}
            src={src}
            alt="للاقتصاص"
            className="block select-none"
            style={{ maxHeight: "60vh", maxWidth: "100%", objectFit: "contain", touchAction: "none" }}
            draggable={false}
          />

          {/* Dark overlay outside crop */}
          <div className="pointer-events-none absolute inset-0">
            {/* top */}
            <div className="absolute left-0 right-0 top-0 bg-black/50" style={{ height: `${crop.y}%` }} />
            {/* bottom */}
            <div className="absolute left-0 right-0 bottom-0 bg-black/50" style={{ height: `${100 - crop.y - crop.h}%` }} />
            {/* left */}
            <div className="absolute bg-black/50"
              style={{ left: 0, top: `${crop.y}%`, width: `${crop.x}%`, height: `${crop.h}%` }} />
            {/* right */}
            <div className="absolute bg-black/50"
              style={{ right: 0, top: `${crop.y}%`, width: `${100 - crop.x - crop.w}%`, height: `${crop.h}%` }} />
          </div>

          {/* Crop box */}
          <div
            className="absolute border-2 border-white"
            style={{
              left: `${crop.x}%`,
              top: `${crop.y}%`,
              width: `${crop.w}%`,
              height: `${crop.h}%`,
              cursor: cursors.move,
              touchAction: "none",
            }}
            onPointerDown={(e) => onPointerDown(e, "move")}
          >
            {/* Rule-of-thirds grid lines */}
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute h-full border-r border-white/30" style={{ left: "33.33%" }} />
              <div className="absolute h-full border-r border-white/30" style={{ left: "66.66%" }} />
              <div className="absolute w-full border-b border-white/30" style={{ top: "33.33%" }} />
              <div className="absolute w-full border-b border-white/30" style={{ top: "66.66%" }} />
            </div>

            {/* Corner brackets */}
            {(["nw","ne","sw","se"] as const).map((c) => (
              <div
                key={c}
                className={cn(
                  "pointer-events-none absolute h-4 w-4 border-white",
                  c === "nw" && "top-0 left-0 border-t-2 border-l-2",
                  c === "ne" && "top-0 right-0 border-t-2 border-r-2",
                  c === "sw" && "bottom-0 left-0 border-b-2 border-l-2",
                  c === "se" && "bottom-0 right-0 border-b-2 border-r-2",
                )}
              />
            ))}

            {/* Resize handles */}
            {HANDLES.map(({ id, lx, ly }) => (
              <div
                key={id}
                onPointerDown={(e) => onPointerDown(e, id)}
                className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md active:scale-110"
                style={{
                  left: `${lx}%`,
                  top: `${ly}%`,
                  cursor: cursors[id],
                  touchAction: "none",
                }}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-700">
          <p className="text-xs text-slate-500">اسحب الزوايا للضبط • اسحب الوسط للتحريك</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>إلغاء</Button>
            <Button onClick={applyCrop} className="gap-1.5">
              <Check className="h-4 w-4" /> قص وحفظ
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
