import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, CheckCircle2, Film, Hash, Loader2, Video } from "lucide-react"
import {
  getInstagramAccounts,
  getInstagramHashtagGroups,
  publishInstagramPost,
  saveInstagramDraft,
  addPostToInstagramQueue,
  validateInstagramMedia,
  type InstagramMediaPlan,
  type InstagramPost,
} from "../../api/endpoints"
import type { RetailItem } from "../../types/api"
import { useAuthStore } from "../../store/authStore"
import { Button } from "../ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog"
import { toast } from "../ui/use-toast"
import { apiErrorMessage } from "../../utils/apiError"
import { cn } from "../../utils/cn"

// The ONE prep/review modal (Phase 3) — used for single publish, drafts and
// queue building. Publishing NEVER fires on the first click: the footer is a
// two-step «مراجعة» → «تأكيد النشر» flow, and an already-published product
// additionally gets an explicit re-publish confirmation (Phase 9).

type MediaEntry = { kind: "image"; imageIndex: number } | { kind: "video" }

export type PrepareMode =
  | { type: "publish" }
  | { type: "queue"; queueId: string; accountId: string }
  | { type: "draft" }

export function InstagramPrepareModal({
  item,
  mode,
  draft,
  onClose,
  onDone,
}: {
  item: RetailItem
  mode: PrepareMode
  draft?: InstagramPost | null
  onClose: () => void
  onDone: () => void
}) {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const canPublish = hasPermission("PUBLISH_INSTAGRAM" as never)

  const { data: accounts = [] } = useQuery({ queryKey: ["ig-accounts"], queryFn: getInstagramAccounts })
  const { data: hashtagGroups = [] } = useQuery({ queryKey: ["ig-hashtag-groups"], queryFn: getInstagramHashtagGroups })
  const connectedAccounts = accounts.filter((a) => a.status === "connected")

  const [accountId, setAccountId] = useState<string>(mode.type === "queue" ? mode.accountId : draft?.accountId ?? "")
  const [media, setMedia] = useState<MediaEntry[]>(() => {
    if (draft?.mediaPlan?.media?.length) return draft.mediaPlan.media as MediaEntry[]
    const initial: MediaEntry[] = item.images.slice(0, 10).map((_, i) => ({ kind: "image", imageIndex: i }))
    return initial
  })
  const [coverImageIndex, setCoverImageIndex] = useState<number | undefined>(draft?.mediaPlan?.coverImageIndex)
  const [caption, setCaption] = useState<string>(() => draft?.caption ?? buildDefaultCaption(item, true))
  const [showPrice, setShowPrice] = useState(true)
  const [step, setStep] = useState<"edit" | "confirm">("edit")
  const [republishOk, setRepublishOk] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!accountId && connectedAccounts.length === 1) setAccountId(connectedAccounts[0].id)
  }, [connectedAccounts, accountId])

  // Price toggle rewrites the auto price line only (keeps manual edits intact)
  useEffect(() => {
    setCaption((prev) => {
      const priceLine = `💰 السعر: ${item.price.toLocaleString()} د.ع`
      const without = prev.split("\n").filter((l) => !l.startsWith("💰 السعر:")).join("\n")
      if (!showPrice) return without
      const lines = without.split("\n")
      lines.splice(1, 0, priceLine)
      return lines.join("\n")
    })
  }, [showPrice]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasVideo = Boolean(item.video)
  const videoSelected = media.some((m) => m.kind === "video")
  const postType = useMemo(() => {
    if (media.length === 1) return media[0].kind === "video" ? "REEL" : "IMAGE"
    return "CAROUSEL"
  }, [media])

  function toggleImage(index: number) {
    setMedia((prev) => {
      const exists = prev.find((m) => m.kind === "image" && m.imageIndex === index)
      if (exists) return prev.filter((m) => !(m.kind === "image" && m.imageIndex === index))
      if (prev.length >= 10) {
        toast({ title: "الحد الأقصى 10 وسائط بالمنشور", variant: "destructive" })
        return prev
      }
      return [...prev, { kind: "image", imageIndex: index }]
    })
  }

  function toggleVideo() {
    setMedia((prev) => {
      if (prev.some((m) => m.kind === "video")) return prev.filter((m) => m.kind !== "video")
      if (prev.length >= 10) {
        toast({ title: "الحد الأقصى 10 وسائط بالمنشور", variant: "destructive" })
        return prev
      }
      return [...prev, { kind: "video" }]
    })
  }

  function move(i: number, dir: -1 | 1) {
    setMedia((prev) => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function appendHashtags(tags: string[]) {
    const text = tags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")
    setCaption((prev) => `${prev.trimEnd()}\n\n${text}`)
  }

  async function goReview() {
    if (!accountId) { toast({ title: "اختر حساب انستغرام أولاً", variant: "destructive" }); return }
    if (media.length === 0) { toast({ title: "اختر وسائط واحدة على الأقل", variant: "destructive" }); return }
    if (item.instagramPublishedAt && mode.type !== "draft" && !republishOk) {
      // Phase 9: never silently double-post
      const ok = window.confirm("هذا المنتج منشور سابقاً على انستغرام، هل تريد إعادة نشره؟")
      if (!ok) return
      setRepublishOk(true)
    }
    setBusy(true)
    try {
      const plan: InstagramMediaPlan = { media, coverImageIndex: videoSelected ? coverImageIndex : undefined }
      const result = await validateInstagramMedia(item.id, plan)
      setWarnings(result.warnings ?? [])
      setStep("confirm")
    } catch (error) {
      toast({ title: apiErrorMessage(error), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  async function confirmAction(asDraft: boolean) {
    setBusy(true)
    const plan: InstagramMediaPlan = { media, coverImageIndex: videoSelected ? coverImageIndex : undefined }
    try {
      if (asDraft) {
        await saveInstagramDraft({ retailItemId: item.id, accountId, caption, mediaPlan: plan })
        toast({ title: "✓ انحفظت كمسودة" })
      } else if (mode.type === "queue") {
        await addPostToInstagramQueue(mode.queueId, { retailItemId: item.id, accountId, caption, mediaPlan: plan })
        toast({ title: "✓ انضاف للطابور المجدول" })
      } else {
        await publishInstagramPost({ retailItemId: item.id, accountId, caption, mediaPlan: plan, draftId: draft?.id })
        toast({ title: "🚀 جاري النشر بالخلفية", description: "تكدر تكمل شغلك — راح تشوف النتيجة بصفحة إدارة إنستغرام" })
      }
      onDone()
    } catch (error) {
      toast({ title: apiErrorMessage(error), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const orderedPreview = media.map((m, i) => (
    <div key={i} className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      {m.kind === "image" ? (
        <img src={item.images[m.imageIndex]} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-slate-900 text-white"><Film className="h-8 w-8" /></div>
      )}
      <span className="absolute right-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{i + 1}</span>
      <div className="absolute bottom-0 left-0 right-0 flex justify-between bg-black/50 px-1">
        <button type="button" onClick={() => move(i, -1)} className="text-white"><ArrowUp className="h-3 w-3" /></button>
        <button type="button" onClick={() => move(i, 1)} className="text-white"><ArrowDown className="h-3 w-3" /></button>
      </div>
    </div>
  ))

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode.type === "queue" ? "تجهيز منشور للطابور المجدول" : "تجهيز منشور انستغرام"} — {item.title || item.productName}
          </DialogTitle>
        </DialogHeader>

        {step === "edit" ? (
          <div className="space-y-4">
            {/* Account */}
            {mode.type !== "queue" && (
              <div>
                <label className="mb-1 block text-sm font-medium">حساب انستغرام</label>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                  <option value="">— اختر حساب —</option>
                  {connectedAccounts.map((a) => (
                    <option key={a.id} value={a.id}>@{a.username}</option>
                  ))}
                </select>
                {connectedAccounts.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">ماكو حساب مربوط — اربط حساب من الإعدادات ← انستغرام</p>
                )}
              </div>
            )}

            {/* Media picker */}
            <div>
              <label className="mb-1 block text-sm font-medium">الوسائط (اضغط للاختيار)</label>
              <div className="flex flex-wrap gap-2">
                {item.images.map((img, i) => {
                  const selected = media.some((m) => m.kind === "image" && m.imageIndex === i)
                  return (
                    <button key={i} type="button" onClick={() => toggleImage(i)}
                      className={cn("relative h-20 w-20 overflow-hidden rounded-lg border-2", selected ? "border-pink-500" : "border-transparent opacity-60")}>
                      <img src={img} className="h-full w-full object-cover" />
                      {selected && <CheckCircle2 className="absolute right-1 top-1 h-4 w-4 text-pink-500" />}
                    </button>
                  )
                })}
                {hasVideo && (
                  <button type="button" onClick={toggleVideo}
                    className={cn("relative flex h-20 w-20 items-center justify-center rounded-lg border-2 bg-slate-900 text-white", videoSelected ? "border-pink-500" : "border-transparent opacity-60")}>
                    <Video className="h-8 w-8" />
                    {videoSelected && <CheckCircle2 className="absolute right-1 top-1 h-4 w-4 text-pink-500" />}
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                نوع المنشور: {postType === "REEL" ? "ريل (فيديو)" : postType === "CAROUSEL" ? `كاروسيل (${media.length} وسائط)` : "صورة واحدة"}
              </p>
            </div>

            {/* Order preview */}
            {media.length > 1 && (
              <div>
                <label className="mb-1 block text-sm font-medium">الترتيب (الأولى تظهر أولاً)</label>
                <div className="flex gap-2 overflow-x-auto pb-1">{orderedPreview}</div>
              </div>
            )}

            {/* Reel cover */}
            {videoSelected && item.images.length > 0 && (
              <div>
                <label className="mb-1 block text-sm font-medium">صورة الغلاف للفيديو (اختياري)</label>
                <div className="flex gap-2 overflow-x-auto">
                  {item.images.map((img, i) => (
                    <button key={i} type="button" onClick={() => setCoverImageIndex(coverImageIndex === i ? undefined : i)}
                      className={cn("h-14 w-14 shrink-0 overflow-hidden rounded border-2", coverImageIndex === i ? "border-pink-500" : "border-transparent opacity-60")}>
                      <img src={img} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Caption */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-sm font-medium">الكابشن</label>
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
                  إظهار السعر
                </label>
              </div>
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={6}
                className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
              {hashtagGroups.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {hashtagGroups.map((g) => (
                    <button key={g.id} type="button" onClick={() => appendHashtags(g.hashtags)}
                      className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-pink-100 dark:bg-slate-800 dark:text-slate-300">
                      <Hash className="h-3 w-3" />{g.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <Button variant="outline" onClick={onClose} disabled={busy}>إلغاء</Button>
              <Button onClick={() => void goReview()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "مراجعة نهائية ←"}
              </Button>
            </div>
          </div>
        ) : (
          /* ── Confirm step: Instagram-style live preview ── */
          <div className="space-y-4">
            <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" dir="ltr">
              <div className="flex items-center gap-2 p-3">
                <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-yellow-400 via-pink-500 to-purple-600 p-[2px]">
                  <div className="h-full w-full rounded-full bg-white dark:bg-slate-900" style={{
                    backgroundImage: accounts.find((a) => a.id === accountId)?.profilePictureUrl ? `url(${accounts.find((a) => a.id === accountId)?.profilePictureUrl})` : undefined,
                    backgroundSize: "cover",
                  }} />
                </div>
                <span className="text-sm font-semibold">@{accounts.find((a) => a.id === accountId)?.username ?? "account"}</span>
                {postType === "REEL" && <span className="ml-auto text-xs text-slate-400">Reel</span>}
              </div>
              <div className="aspect-square w-full bg-slate-100 dark:bg-slate-800">
                {media[0]?.kind === "image" ? (
                  <img src={item.images[(media[0] as { imageIndex: number }).imageIndex]} className="h-full w-full object-cover" />
                ) : coverImageIndex !== undefined && item.images[coverImageIndex] ? (
                  <img src={item.images[coverImageIndex]} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-400"><Film className="h-16 w-16" /></div>
                )}
              </div>
              {media.length > 1 && (
                <div className="flex justify-center gap-1 py-1">
                  {media.map((_, i) => <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i === 0 ? "bg-blue-500" : "bg-slate-300")} />)}
                </div>
              )}
              <p className="whitespace-pre-wrap p-3 text-sm" dir="rtl">{caption}</p>
            </div>

            {warnings.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                {warnings.map((w, i) => <p key={i}>⚠️ {w}</p>)}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <Button variant="outline" onClick={() => setStep("edit")} disabled={busy}>→ رجوع للتعديل</Button>
              <Button variant="outline" onClick={() => void confirmAction(true)} disabled={busy}>حفظ كمسودة</Button>
              {mode.type === "queue" ? (
                <Button onClick={() => void confirmAction(false)} disabled={busy || !canPublish} className="bg-pink-600 hover:bg-pink-700">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "✔ تأكيد الإضافة للطابور"}
                </Button>
              ) : (
                <Button onClick={() => void confirmAction(false)} disabled={busy || !canPublish} className="bg-pink-600 hover:bg-pink-700">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "✔ تأكيد النشر"}
                </Button>
              )}
            </div>
            {!canPublish && (
              <p className="text-left text-xs text-slate-500">صلاحيتك تسمح بحفظ مسودة فقط — النشر يحتاج صلاحية «نشر انستغرام»</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function buildDefaultCaption(item: RetailItem, withPrice: boolean): string {
  const lines = [item.title || item.productName]
  if (withPrice) lines.push(`💰 السعر: ${item.price.toLocaleString()} د.ع`)
  if (item.description) lines.push("", item.description)
  // Phase 13: instructional CTA only — links are not clickable on IG posts.
  lines.push("", "🛍️ الرابط بالبايو")
  return lines.join("\n")
}
