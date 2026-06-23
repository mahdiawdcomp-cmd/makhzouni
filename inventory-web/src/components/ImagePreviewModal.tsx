import { useState } from "react"
import { Check, RotateCcw, RotateCw, X } from "lucide-react"

function rotateBitmap(src: string, degrees: number): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const swap = degrees === 90 || degrees === 270
      const canvas = document.createElement("canvas")
      canvas.width = swap ? img.height : img.width
      canvas.height = swap ? img.width : img.height
      const ctx = canvas.getContext("2d")!
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((degrees * Math.PI) / 180)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)
      resolve(canvas.toDataURL("image/jpeg", 0.88))
    }
    img.src = src
  })
}

export function ImagePreviewModal({
  src,
  onConfirm,
  onCancel,
}: {
  src: string
  onConfirm: (dataUrl: string) => void
  onCancel: () => void
}) {
  const [rotation, setRotation] = useState(0) // visual degrees, actual rotation applied on confirm
  const [rotCount, setRotCount] = useState(0) // 0-3 quarter-turns

  function rotateLeft() {
    setRotation((r) => r - 90)
    setRotCount((c) => (c + 3) % 4)
  }
  function rotateRight() {
    setRotation((r) => r + 90)
    setRotCount((c) => (c + 1) % 4)
  }

  async function confirm() {
    if (rotCount === 0) {
      onConfirm(src)
      return
    }
    const degrees = (rotCount * 90) as 90 | 180 | 270
    const rotated = await rotateBitmap(src, degrees)
    onConfirm(rotated)
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black" dir="rtl">
      {/* top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/60 shrink-0">
        <button
          onClick={onCancel}
          className="rounded-full p-2.5 bg-white/10 active:bg-white/25"
          aria-label="إلغاء"
        >
          <X className="h-6 w-6 text-white" />
        </button>

        <div className="flex items-center gap-4">
          <button
            onClick={rotateLeft}
            className="rounded-full p-2.5 bg-white/10 active:bg-white/25"
            aria-label="تدوير يسار"
          >
            <RotateCcw className="h-5 w-5 text-white" />
          </button>
          <button
            onClick={rotateRight}
            className="rounded-full p-2.5 bg-white/10 active:bg-white/25"
            aria-label="تدوير يمين"
          >
            <RotateCw className="h-5 w-5 text-white" />
          </button>
        </div>

        <button
          onClick={() => void confirm()}
          className="rounded-full p-2.5 bg-emerald-500 active:bg-emerald-600"
          aria-label="حفظ"
        >
          <Check className="h-6 w-6 text-white" />
        </button>
      </div>

      {/* image fills the rest */}
      <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
        <img
          src={src}
          alt="معاينة"
          className="max-h-full max-w-full object-contain select-none transition-transform duration-200"
          style={{ transform: `rotate(${rotation}deg)` }}
          draggable={false}
        />
      </div>

      {/* bottom hint */}
      <div className="shrink-0 py-3 text-center text-white/50 text-xs bg-black/40">
        استخدم ↺ ↻ للتدوير • ✓ للحفظ
      </div>
    </div>
  )
}
