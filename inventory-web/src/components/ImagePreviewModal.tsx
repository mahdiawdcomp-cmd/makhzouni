import { Check, X } from "lucide-react"

export function ImagePreviewModal({
  src,
  onConfirm,
  onCancel,
}: {
  src: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black" dir="rtl">
      {/* top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/60">
        <button onClick={onCancel} className="rounded-full p-2 bg-white/10 active:bg-white/20">
          <X className="h-6 w-6 text-white" />
        </button>
        <span className="text-white font-bold text-base">تعديل</span>
        <button onClick={onConfirm} className="rounded-full p-2 bg-emerald-500 active:bg-emerald-600">
          <Check className="h-6 w-6 text-white" />
        </button>
      </div>

      {/* image fills the rest */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        <img
          src={src}
          alt="معاينة"
          className="max-h-full max-w-full object-contain select-none"
          draggable={false}
        />
      </div>
    </div>
  )
}
