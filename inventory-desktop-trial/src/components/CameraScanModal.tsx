import { useEffect, useRef, useState } from "react"
import { Button } from "./ui/button"

/**
 * Camera-based QR / barcode scanner. Uses the native BarcodeDetector API
 * (available in Chromium-based browsers and the desktop WebView2 runtime), so
 * no extra dependency is bundled. Streams the rear camera, scans each frame,
 * and fires onDetect with the first decoded value.
 */
export function CameraScanModal({
  onDetect,
  onClose,
  title = "مسح بالكاميرا",
}: {
  onDetect: (code: string) => void
  onClose: () => void
  title?: string
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const detectedRef = useRef(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let cancelled = false

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Detector = (window as any).BarcodeDetector
    if (!Detector) {
      setError("هذا المتصفح لا يدعم مسح الباركود بالكاميرا. استخدم قارئ باركود أو متصفح حديث.")
      return
    }
    const detector = new Detector({
      formats: ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "itf"],
    })

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        })
        if (cancelled) return
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()
        scanLoop()
      } catch {
        setError("تعذّر فتح الكاميرا. تأكّد من منح الإذن للكاميرا.")
      }
    }

    async function scanLoop() {
      const video = videoRef.current
      if (!video || cancelled || detectedRef.current) return
      try {
        const codes = await detector.detect(video)
        if (codes && codes.length > 0 && codes[0].rawValue) {
          detectedRef.current = true
          onDetect(String(codes[0].rawValue))
          return
        }
      } catch {
        /* transient decode error — keep scanning */
      }
      raf = requestAnimationFrame(scanLoop)
    }

    void start()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onDetect])

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-4 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-center font-extrabold text-slate-900 dark:text-slate-100">{title}</h3>
        {error ? (
          <p className="py-6 text-center text-sm text-amber-600">{error}</p>
        ) : (
          <div className="relative overflow-hidden rounded-xl bg-black">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-8 rounded-lg border-2 border-emerald-400/80" />
          </div>
        )}
        <p className="mt-2 text-center text-xs text-slate-500">وجّه الكاميرا نحو الباركود أو الـ QR</p>
        <div className="mt-3">
          <Button variant="outline" className="w-full" onClick={onClose}>إغلاق</Button>
        </div>
      </div>
    </div>
  )
}
