import { useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Loader2, Trash2, Upload } from "lucide-react"
import {
  addWholesaleInstagramMediaFromProduct,
  cancelWholesaleInstagramSchedule,
  getWholesaleInstagramAccounts,
  getWholesaleInstagramSuggestedTimes,
  getWholesaleProductGallery,
  publishWholesaleInstagramPostNow,
  removeWholesaleInstagramMedia,
  reorderWholesaleInstagramMedia,
  rescheduleWholesaleInstagramPost,
  scheduleWholesaleInstagramPost,
  updateWholesaleInstagramPost,
  uploadWholesaleInstagramMedia,
  type WholesaleInstagramPost,
} from "../../api/endpoints"
import { useAuthStore } from "../../store/authStore"
import { Button } from "../ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog"
import { toast } from "../ui/use-toast"
import { apiErrorMessage } from "../../utils/apiError"

// «إنستغرام الجملة» — prep/schedule modal for ONE post. Independent of
// InstagramPrepareModal (retail) — never imports from it. Images live as
// permanent MediaAsset rows (public-token URLs) from the moment they're
// added, never as Data URLs — see media/from-product and media/upload.

function baghdadDateTimeParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baghdad",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00"
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` }
}

function baghdadIsoFrom(date: string, time: string): string {
  // Baghdad has no DST — fixed UTC+3 — so an explicit offset is exact.
  return new Date(`${date}T${time}:00+03:00`).toISOString()
}

function formatBaghdad(iso?: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short" })
}

export function WholesaleInstagramPrepareModal({
  post,
  onClose,
  onChanged,
}: {
  post: WholesaleInstagramPost
  onClose: () => void
  onChanged: () => void
}) {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const canPublish = hasPermission("PUBLISH_WHOLESALE_INSTAGRAM" as never)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: accounts = [] } = useQuery({ queryKey: ["wig-accounts"], queryFn: getWholesaleInstagramAccounts })
  const { data: suggestedTimes = [] } = useQuery({ queryKey: ["wig-suggested-times"], queryFn: getWholesaleInstagramSuggestedTimes })
  const { data: gallery = [] } = useQuery({
    queryKey: ["wig-product-gallery", post.productId],
    queryFn: () => getWholesaleProductGallery(post.productId!),
    enabled: Boolean(post.productId),
  })

  const [accountId, setAccountId] = useState(post.accountId)
  const [caption, setCaption] = useState(post.caption)
  const [notes, setNotes] = useState(post.notes ?? "")
  const initialSchedule = post.scheduledAt ? baghdadDateTimeParts(post.scheduledAt) : null
  const [date, setDate] = useState(initialSchedule?.date ?? "")
  const [time, setTime] = useState(initialSchedule?.time ?? "")
  const [busy, setBusy] = useState<string | null>(null)
  const [media, setMedia] = useState(post.media)

  const editable = post.status === "DRAFT" || post.status === "SCHEDULED" || post.status === "FAILED" || post.status === "SKIPPED_OUT_OF_STOCK"
  const isScheduled = post.status === "SCHEDULED"

  const connectedAccounts = accounts.filter((a) => a.status === "connected")

  function refreshMedia() {
    onChanged()
  }

  async function saveBasics() {
    setBusy("save")
    try {
      await updateWholesaleInstagramPost(post.id, { accountId, caption, notes: notes || null })
      toast({ title: "✓ انحفظ" })
      onChanged()
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
    finally { setBusy(null) }
  }

  async function addFromGallery(dataUrl: string) {
    setBusy("media")
    try {
      const added = await addWholesaleInstagramMediaFromProduct(post.id, dataUrl)
      setMedia((prev) => [...prev, added])
      refreshMedia()
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
    finally { setBusy(null) }
  }

  async function uploadFile(file: File) {
    setBusy("media")
    try {
      const added = await uploadWholesaleInstagramMedia(post.id, file)
      setMedia((prev) => [...prev, added])
      refreshMedia()
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
    finally { setBusy(null) }
  }

  async function removeImage(mediaId: string) {
    setBusy("media")
    try {
      await removeWholesaleInstagramMedia(post.id, mediaId)
      setMedia((prev) => prev.filter((m) => m.id !== mediaId))
      refreshMedia()
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
    finally { setBusy(null) }
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= media.length) return
    const next = [...media]
    ;[next[i], next[j]] = [next[j], next[i]]
    setMedia(next)
    try {
      await reorderWholesaleInstagramMedia(post.id, next.map((m) => m.id))
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
  }

  async function doSchedule(target: "schedule" | "reschedule") {
    if (!date || !time) { toast({ title: "اختر التاريخ والوقت أولاً", variant: "destructive" }); return }
    if (!caption.trim()) { toast({ title: "اكتب نص المنشور أولاً", variant: "destructive" }); return }
    if (media.length === 0) { toast({ title: "اختر صورة واحدة على الأقل", variant: "destructive" }); return }
    setBusy("schedule")
    try {
      await updateWholesaleInstagramPost(post.id, { accountId, caption, notes: notes || null })
      const iso = baghdadIsoFrom(date, time)
      const result = target === "schedule" ? await scheduleWholesaleInstagramPost(post.id, iso) : await rescheduleWholesaleInstagramPost(post.id, iso)
      toast({ title: "✓ انجدول المنشور", description: result.warning })
      onChanged()
      onClose()
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
    finally { setBusy(null) }
  }

  async function doCancelSchedule() {
    setBusy("cancel")
    try {
      await cancelWholesaleInstagramSchedule(post.id)
      toast({ title: "✓ انلغت الجدولة — رجع مسودة" })
      onChanged()
      onClose()
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
    finally { setBusy(null) }
  }

  async function doPublishNow() {
    if (!caption.trim()) { toast({ title: "اكتب نص المنشور أولاً", variant: "destructive" }); return }
    if (media.length === 0) { toast({ title: "اختر صورة واحدة على الأقل", variant: "destructive" }); return }
    if (!window.confirm("راح ينشر هذا المنتج فوراً على انستغرام الحقيقي. متأكد؟")) return
    setBusy("publish")
    try {
      await updateWholesaleInstagramPost(post.id, { accountId, caption, notes: notes || null })
      await publishWholesaleInstagramPostNow(post.id)
      toast({ title: "🚀 جاري النشر بالخلفية", description: "تابع النتيجة بتبويب المنشورة/الفاشلة" })
      onChanged()
      onClose()
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
    finally { setBusy(null) }
  }

  const orderedMedia = useMemo(() => media.slice(), [media])

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>تجهيز منشور — {post.productTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!editable && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
              هذا المنشور {post.status === "PUBLISHING" ? "قيد النشر الآن" : "منشور فعلاً"} — للاطلاع فقط.
            </div>
          )}

          {/* Account */}
          <div>
            <label className="mb-1 block text-sm font-medium">حساب انستغرام</label>
            <select
              value={accountId}
              disabled={!editable}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              {connectedAccounts.length === 0 && <option value={accountId}>@{post.account.username}</option>}
              {connectedAccounts.map((a) => (
                <option key={a.id} value={a.id}>@{a.username}</option>
              ))}
            </select>
            {connectedAccounts.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">ماكو حساب مربوط — اربط حساب من الإعدادات ← انستغرام</p>
            )}
          </div>

          {/* Selected media */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              صور المنشور ({orderedMedia.length}) — {orderedMedia.length > 1 ? "كاروسيل" : "صورة واحدة"}
            </label>
            <div className="flex flex-wrap gap-2">
              {orderedMedia.map((m, i) => (
                <div key={m.id} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                  <img src={m.url} className="h-full w-full object-cover" />
                  <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
                  {editable && (
                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/50 px-1">
                      <button type="button" onClick={() => void move(i, -1)} className="text-white"><ArrowUp className="h-3 w-3" /></button>
                      <button type="button" onClick={() => void removeImage(m.id)} className="text-red-300"><Trash2 className="h-3 w-3" /></button>
                      <button type="button" onClick={() => void move(i, 1)} className="text-white"><ArrowDown className="h-3 w-3" /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {editable && (
            <>
              {/* Product gallery picker */}
              {gallery.length > 0 && (
                <div>
                  <label className="mb-1 block text-sm font-medium">اختر من صور المنتج بالكتلوگ</label>
                  <div className="flex flex-wrap gap-2">
                    {gallery.map((img, i) => (
                      <button key={i} type="button" disabled={busy === "media"} onClick={() => void addFromGallery(img)}
                        className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 border-transparent opacity-80 hover:border-pink-500 hover:opacity-100">
                        <img src={img} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Upload extra ad-only images */}
              <div>
                <label className="mb-1 block text-sm font-medium">أو ارفع صورة إضافية خاصة بالإعلان</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); e.target.value = "" }}
                />
                <Button type="button" variant="outline" size="sm" disabled={busy === "media"} onClick={() => fileInputRef.current?.click()}>
                  {busy === "media" ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : <Upload className="ml-1 h-4 w-4" />}
                  رفع صورة
                </Button>
              </div>
            </>
          )}

          {/* Caption */}
          <div>
            <label className="mb-1 block text-sm font-medium">نص المنشور (الكابشن) — تكتبه أنت بنفسك</label>
            <textarea
              value={caption}
              disabled={!editable}
              onChange={(e) => setCaption(e.target.value)}
              rows={6}
              placeholder="اكتب وصف المنشور هنا..."
              className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-sm font-medium">ملاحظات داخلية (ما تُنشر بانستغرام)</label>
            <textarea
              value={notes}
              disabled={!editable}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          {/* Schedule */}
          {editable && (
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <label className="mb-1 block text-sm font-medium">موعد النشر (بتوقيت بغداد)</label>
              <div className="flex flex-wrap gap-2">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
              </div>
              {suggestedTimes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  <span className="text-xs text-slate-400">أوقات مقترحة:</span>
                  {suggestedTimes.map((t) => (
                    <button key={t} type="button" onClick={() => setTime(t)}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-pink-100 dark:bg-slate-800 dark:text-slate-300">
                      {t}
                    </button>
                  ))}
                </div>
              )}
              {isScheduled && <p className="mt-2 text-xs text-slate-500">مجدول حالياً: {formatBaghdad(post.scheduledAt)}</p>}
            </div>
          )}

          {post.status === "FAILED" && post.errorMessage && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-900/30 dark:text-red-200">
              ❌ فشل النشر: {post.errorMessage}
            </div>
          )}
          {post.status === "SKIPPED_OUT_OF_STOCK" && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
              ⏭️ تم تخطي النشر: {post.skipReason ?? "نفدت الكمية"} — إذا رجعت الكمية استخدم «إعادة جدولة» أو «نشر الآن» بالأسفل.
            </div>
          )}
          {post.status === "PUBLISHED" && post.permalink && (
            <a href={post.permalink} target="_blank" rel="noreferrer" className="text-sm text-pink-600 underline">
              عرض المنشور على انستغرام ←
            </a>
          )}

          {/* Footer actions */}
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
            <Button variant="outline" onClick={onClose} disabled={Boolean(busy)}>إغلاق</Button>
            {editable && (
              <Button variant="outline" onClick={() => void saveBasics()} disabled={Boolean(busy)}>
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ كمسودة"}
              </Button>
            )}
            {isScheduled && (
              <Button variant="outline" onClick={() => void doCancelSchedule()} disabled={Boolean(busy)} className="text-amber-600">
                {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : "إلغاء الجدولة"}
              </Button>
            )}
            {editable && canPublish && (
              <Button
                onClick={() => void doSchedule(post.status === "SKIPPED_OUT_OF_STOCK" ? "reschedule" : "schedule")}
                disabled={Boolean(busy)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {busy === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : post.status === "SKIPPED_OUT_OF_STOCK" || post.status === "FAILED" ? "إعادة جدولة" : "جدولة"}
              </Button>
            )}
            {editable && canPublish && (
              <Button onClick={() => void doPublishNow()} disabled={Boolean(busy)} className="bg-pink-600 hover:bg-pink-700">
                {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : "نشر الآن"}
              </Button>
            )}
            {editable && !canPublish && (
              <p className="text-left text-xs text-slate-500">صلاحيتك تسمح بحفظ مسودة فقط — الجدولة والنشر يحتاجان صلاحية «نشر إنستغرام الجملة»</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
