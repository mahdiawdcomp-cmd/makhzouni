import { useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { usePageTitle } from "../hooks/usePageTitle"
import {
  createInstagramHashtagGroup,
  createInstagramQueue,
  deleteInstagramHashtagGroup,
  deleteInstagramPost,
  deleteInstagramQueue,
  getInstagramAccounts,
  getInstagramHashtagGroups,
  getInstagramPosts,
  getInstagramQueuePosts,
  getInstagramQueues,
  getRetailItems,
  retryInstagramPost,
  updateInstagramQueue,
  type InstagramPost,
  type InstagramQueue,
} from "../api/endpoints"
import type { RetailItem } from "../types/api"
import { useAuthStore } from "../store/authStore"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"
import { InstagramPrepareModal } from "../components/instagram/InstagramPrepareModal"
import { Clock, ExternalLink, Hash, Link2, Loader2, Pause, Play, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Instagram } from "../components/instagram/InstagramIcon"

// «إدارة إنستغرام» (Phase 12) — standalone management center.
// Sections: جاهزة للنشر / المسودات / الناجحة / الفاشلة / المجدولة / السجل.

const TABS = [
  { id: "ready", label: "المنتجات الجاهزة للنشر" },
  { id: "drafts", label: "المسودات" },
  { id: "published", label: "المنشورات الناجحة" },
  { id: "failed", label: "المنشورات الفاشلة" },
  { id: "queues", label: "المجدولة لاحقاً" },
  { id: "log", label: "سجل النشر" },
  { id: "hashtags", label: "مجموعات الهاشتاغ" },
] as const

type TabId = (typeof TABS)[number]["id"]

const STATUS_LABEL: Record<InstagramPost["status"], { text: string; cls: string }> = {
  DRAFT: { text: "مسودة", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  QUEUED: { text: "بالطابور", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  PREPARING: { text: "جاري التجهيز", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  UPLOADING: { text: "جاري الرفع", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  PUBLISHED: { text: "✅ تم النشر", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  FAILED: { text: "فشل", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
}

export function InstagramPage() {
  usePageTitle("إدارة إنستغرام")
  const [tab, setTab] = useState<TabId>("ready")
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const canPublish = hasPermission("PUBLISH_INSTAGRAM" as never)

  const { data: accounts = [] } = useQuery({ queryKey: ["ig-accounts"], queryFn: getInstagramAccounts })
  const connected = accounts.filter((a) => a.status === "connected")

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Instagram className="h-6 w-6 text-pink-600" /> إدارة إنستغرام
        </h1>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          {connected.length === 0 ? (
            <span className="text-amber-600">ماكو حساب مربوط — اربط من الإعدادات</span>
          ) : (
            connected.map((a) => (
              <span key={a.id} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                {a.profilePictureUrl && <img src={a.profilePictureUrl} className="h-4 w-4 rounded-full" />}
                @{a.username}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Phase 13: bio-link guidance */}
      <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-200">
        <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          روابط الكابشن بانستغرام مو قابلة للضغط — خلي رابط الكتلوك مالتك دائماً <b>بالبايو (Bio)</b> لحسابك،
          والكابشن التلقائي يوجّه الزبون له: «🛍️ الرابط بالبايو».
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("rounded-t-lg px-3 py-2 text-sm", tab === t.id ? "border-b-2 border-pink-600 font-semibold text-pink-600" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "ready" && <ReadyTab canPublish={canPublish} />}
      {tab === "drafts" && <PostsTab status="DRAFT" canPublish={canPublish} />}
      {tab === "published" && <PostsTab status="PUBLISHED" canPublish={canPublish} />}
      {tab === "failed" && <PostsTab status="FAILED" canPublish={canPublish} />}
      {tab === "queues" && <QueuesTab canPublish={canPublish} />}
      {tab === "log" && <PostsTab canPublish={canPublish} />}
      {tab === "hashtags" && <HashtagsTab />}
    </div>
  )
}

// ── المنتجات الجاهزة للنشر ────────────────────────────────────────────────────

function ReadyTab({ canPublish }: { canPublish: boolean }) {
  const { data: items = [], isLoading } = useQuery({ queryKey: ["retail-items"], queryFn: getRetailItems })
  const [prepItem, setPrepItem] = useState<RetailItem | null>(null)
  const qc = useQueryClient()
  const ready = useMemo(() => items.filter((i) => i.isActive), [items])

  if (isLoading) return <Loader2 className="mx-auto h-6 w-6 animate-spin" />
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {ready.map((item) => (
          <Card key={item.id} className="overflow-hidden">
            <div className="relative aspect-square bg-slate-100 dark:bg-slate-800">
              {item.images[0] && <img src={item.images[0]} className="h-full w-full object-cover" />}
              {item.video && <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">🎬 فيديو</span>}
              {item.instagramPublishedAt && (
                <span className="absolute right-1 top-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] text-white">✅ تم النشر</span>
              )}
            </div>
            <CardContent className="space-y-1 p-2">
              <p className="truncate text-sm font-medium">{item.title || item.productName}</p>
              {item.instagramPublishedAt ? (
                <div className="text-[11px] text-slate-500">
                  <p>نُشر: {new Date(item.instagramPublishedAt).toLocaleDateString("ar-IQ")}</p>
                  {item.instagramAccountName && <p>الحساب: @{item.instagramAccountName}</p>}
                  {item.instagramPermalink && (
                    <a href={item.instagramPermalink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-pink-600">
                      <ExternalLink className="h-3 w-3" /> عرض المنشور
                    </a>
                  )}
                </div>
              ) : null}
              <Button size="sm" className="w-full bg-pink-600 hover:bg-pink-700" onClick={() => setPrepItem(item)}>
                <Instagram className="ml-1 h-3.5 w-3.5" /> {item.instagramPublishedAt ? "إعادة نشر" : "نشر"}
              </Button>
            </CardContent>
          </Card>
        ))}
        {ready.length === 0 && <p className="col-span-full py-8 text-center text-slate-500">ماكو منتجات فعالة بالكتلوك</p>}
      </div>
      {prepItem && (
        <InstagramPrepareModal
          item={prepItem}
          mode={{ type: canPublish ? "publish" : "draft" }}
          onClose={() => setPrepItem(null)}
          onDone={() => { setPrepItem(null); void qc.invalidateQueries({ queryKey: ["ig-posts"] }); void qc.invalidateQueries({ queryKey: ["retail-items"] }) }}
        />
      )}
    </>
  )
}

// ── قوائم المنشورات (مسودات/ناجحة/فاشلة/سجل) ─────────────────────────────────

function PostsTab({ status, canPublish }: { status?: InstagramPost["status"]; canPublish: boolean }) {
  const qc = useQueryClient()
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["ig-posts", status ?? "all"],
    queryFn: () => getInstagramPosts(status ? { status } : undefined),
    refetchInterval: status === undefined || status === "FAILED" ? 15000 : undefined,
  })
  const { data: items = [] } = useQuery({ queryKey: ["retail-items"], queryFn: getRetailItems })
  const [deleting, setDeleting] = useState<InstagramPost | null>(null)
  const [editingDraft, setEditingDraft] = useState<InstagramPost | null>(null)

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ["ig-posts"] }); void qc.invalidateQueries({ queryKey: ["retail-items"] }) }

  async function retry(post: InstagramPost) {
    try { await retryInstagramPost(post.id); toast({ title: "🚀 جاري إعادة المحاولة بالخلفية" }); invalidate() }
    catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
  }

  if (isLoading) return <Loader2 className="mx-auto h-6 w-6 animate-spin" />
  const draftItem = editingDraft ? items.find((i) => i.id === editingDraft.retailItemId) ?? null : null
  return (
    <div className="space-y-2">
      {posts.map((post) => (
        <Card key={post.id}>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{post.productTitle}</p>
              <p className="text-xs text-slate-500">
                @{post.account?.username} · {post.postType === "REEL" ? "ريل" : post.postType === "CAROUSEL" ? "كاروسيل" : "صورة"}
                {post.queue?.name ? ` · طابور: ${post.queue.name}` : post.queueId ? " · طابور مجدول" : ""}
                {post.publishedAt ? ` · ${new Date(post.publishedAt).toLocaleString("ar-IQ")}` : ` · ${new Date(post.createdAt).toLocaleString("ar-IQ")}`}
              </p>
              {post.status === "FAILED" && post.errorMessage && (
                <p className="mt-1 text-xs text-red-600">السبب: {post.errorMessage}</p>
              )}
            </div>
            <span className={cn("rounded-full px-2 py-0.5 text-xs", STATUS_LABEL[post.status].cls)}>{STATUS_LABEL[post.status].text}</span>
            {post.permalink && (
              <a href={post.permalink} target="_blank" rel="noreferrer" className="text-pink-600" title="عرض على انستغرام">
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
            {post.status === "FAILED" && canPublish && (
              <Button size="sm" variant="outline" onClick={() => void retry(post)}><RefreshCw className="ml-1 h-3.5 w-3.5" /> إعادة المحاولة</Button>
            )}
            {post.status === "DRAFT" && (
              <Button size="sm" variant="outline" onClick={() => setEditingDraft(post)}>فتح المسودة</Button>
            )}
            {(post.status === "DRAFT" || post.status === "QUEUED" || post.status === "FAILED") && (
              <button onClick={() => setDeleting(post)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            )}
          </CardContent>
        </Card>
      ))}
      {posts.length === 0 && <p className="py-8 text-center text-slate-500">ماكو منشورات هنا</p>}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="حذف المنشور؟"
        description="راح ينحذف من القائمة (المنشور الحي على انستغرام ما يتأثر)"
        onConfirm={async () => {
          if (!deleting) return
          try { await deleteInstagramPost(deleting.id); invalidate() }
          catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
      {editingDraft && draftItem && (
        <InstagramPrepareModal
          item={draftItem}
          mode={{ type: "publish" }}
          draft={editingDraft}
          onClose={() => setEditingDraft(null)}
          onDone={() => { setEditingDraft(null); invalidate() }}
        />
      )}
      {editingDraft && !draftItem && (
        <ConfirmDialog open title="المنتج غير موجود" description="منتج هذه المسودة انحذف من الكتلوك" onConfirm={() => setEditingDraft(null)} onCancel={() => setEditingDraft(null)} />
      )}
    </div>
  )
}

// ── الطوابير المجدولة ─────────────────────────────────────────────────────────

function QueuesTab({ canPublish }: { canPublish: boolean }) {
  const qc = useQueryClient()
  const { data: queues = [], isLoading } = useQuery({ queryKey: ["ig-queues"], queryFn: getInstagramQueues, refetchInterval: 30000 })
  const [builderOpen, setBuilderOpen] = useState(false)
  const [deleting, setDeleting] = useState<InstagramQueue | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["ig-queues"] })

  async function toggle(queue: InstagramQueue) {
    try {
      await updateInstagramQueue(queue.id, { status: queue.status === "ACTIVE" ? "PAUSED" : "ACTIVE" })
      invalidate()
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
  }

  if (isLoading) return <Loader2 className="mx-auto h-6 w-6 animate-spin" />
  return (
    <div className="space-y-3">
      {canPublish && (
        <Button onClick={() => setBuilderOpen(true)} className="bg-pink-600 hover:bg-pink-700">
          <Plus className="ml-1 h-4 w-4" /> طابور نشر جديد
        </Button>
      )}
      {queues.map((queue) => (
        <Card key={queue.id}>
          <CardContent className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{queue.name || "طابور بدون اسم"} — @{queue.account?.username}</p>
                <p className="text-xs text-slate-500">
                  {queue.scheduleType === "FIXED_TIMES"
                    ? `أوقات ثابتة (بغداد): ${queue.times.join("، ")}`
                    : `كل ${queue.intervalMinutes} دقيقة`}
                  {" · "}{queue.postsPerDay} منشور/يوم · متبقي {queue.pendingCount ?? 0}
                </p>
              </div>
              <span className={cn("rounded-full px-2 py-0.5 text-xs",
                queue.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : queue.status === "PAUSED" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
                {queue.status === "ACTIVE" ? "فعال" : queue.status === "PAUSED" ? "موقوف مؤقتاً" : "انتهى — بانتظار دفعة جديدة"}
              </span>
              {canPublish && queue.status !== "DONE" && (
                <Button size="sm" variant="outline" onClick={() => void toggle(queue)}>
                  {queue.status === "ACTIVE" ? <><Pause className="ml-1 h-3.5 w-3.5" /> إيقاف</> : <><Play className="ml-1 h-3.5 w-3.5" /> تشغيل</>}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setExpanded(expanded === queue.id ? null : queue.id)}>
                <Clock className="ml-1 h-3.5 w-3.5" /> العناصر
              </Button>
              {canPublish && (
                <button onClick={() => setDeleting(queue)} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
            {expanded === queue.id && <QueuePostsList queueId={queue.id} />}
          </CardContent>
        </Card>
      ))}
      {queues.length === 0 && <p className="py-8 text-center text-slate-500">ماكو طوابير مجدولة — سوّي طابور جديد وحدد منتجاته وجدولته</p>}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="حذف الطابور؟"
        description="العناصر غير المنشورة ترجع مسودات، والمنشور منها يبقى بالسجل"
        onConfirm={async () => {
          if (!deleting) return
          try { await deleteInstagramQueue(deleting.id); invalidate() }
          catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
          setDeleting(null)
        }}
        onCancel={() => setDeleting(null)}
      />
      {builderOpen && <QueueBuilder onClose={() => setBuilderOpen(false)} onDone={() => { setBuilderOpen(false); invalidate() }} />}
    </div>
  )
}

function QueuePostsList({ queueId }: { queueId: string }) {
  const { data: posts = [], isLoading } = useQuery({ queryKey: ["ig-queue-posts", queueId], queryFn: () => getInstagramQueuePosts(queueId) })
  if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />
  return (
    <div className="space-y-1 border-t border-slate-100 pt-2 dark:border-slate-800">
      {posts.map((p) => (
        <div key={p.id} className="flex items-center gap-2 text-sm">
          <span className="w-6 text-slate-400">{p.position + 1}.</span>
          <span className="min-w-0 flex-1 truncate">{p.productTitle}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px]", STATUS_LABEL[p.status].cls)}>{STATUS_LABEL[p.status].text}</span>
          {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" className="text-pink-600"><ExternalLink className="h-3.5 w-3.5" /></a>}
        </div>
      ))}
      {posts.length === 0 && <p className="text-xs text-slate-500">الطابور فارغ</p>}
    </div>
  )
}

// ── بناء طابور جديد: حساب + جدولة ثم تجهيز منتج-منتج ─────────────────────────

function QueueBuilder({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data: accounts = [] } = useQuery({ queryKey: ["ig-accounts"], queryFn: getInstagramAccounts })
  const { data: items = [] } = useQuery({ queryKey: ["retail-items"], queryFn: getRetailItems })
  const connected = accounts.filter((a) => a.status === "connected")

  const [stage, setStage] = useState<"config" | "pick" | "prepare">("config")
  const [accountId, setAccountId] = useState("")
  const [name, setName] = useState("")
  const [scheduleType, setScheduleType] = useState<"FIXED_TIMES" | "INTERVAL">("FIXED_TIMES")
  const [times, setTimes] = useState<string[]>(["10:00"])
  const [intervalMinutes, setIntervalMinutes] = useState(120)
  const [postsPerDay, setPostsPerDay] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [queueId, setQueueId] = useState<string | null>(null)
  const [prepIndex, setPrepIndex] = useState(0)
  const [busy, setBusy] = useState(false)

  const activeItems = items.filter((i) => i.isActive)
  const selectedItems = selected.map((id) => activeItems.find((i) => i.id === id)).filter(Boolean) as RetailItem[]

  async function createAndPick() {
    if (!accountId) { toast({ title: "اختر حساب انستغرام", variant: "destructive" }); return }
    setStage("pick")
  }

  async function startPrepare() {
    if (selected.length === 0) { toast({ title: "اختر منتج واحد على الأقل", variant: "destructive" }); return }
    setBusy(true)
    try {
      const queue = await createInstagramQueue({
        accountId,
        name: name.trim() || undefined,
        scheduleType,
        times: scheduleType === "FIXED_TIMES" ? times.filter(Boolean) : undefined,
        intervalMinutes: scheduleType === "INTERVAL" ? intervalMinutes : undefined,
        postsPerDay,
      })
      setQueueId(queue.id)
      setPrepIndex(0)
      setStage("prepare")
    } catch (error) {
      toast({ title: apiErrorMessage(error), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  // Prepare stage: run the SAME prep modal once per product, in order (Phase 7)
  if (stage === "prepare" && queueId) {
    const current = selectedItems[prepIndex]
    if (!current) { onDone(); return null }
    return (
      <InstagramPrepareModal
        key={current.id}
        item={current}
        mode={{ type: "queue", queueId, accountId }}
        onClose={() => {
          // Skipping a product mid-build: move on to the next one.
          if (prepIndex + 1 < selectedItems.length) setPrepIndex(prepIndex + 1)
          else onDone()
        }}
        onDone={() => {
          if (prepIndex + 1 < selectedItems.length) setPrepIndex(prepIndex + 1)
          else { toast({ title: `✓ اكتمل الطابور (${selectedItems.length} منتج)` }); onDone() }
        }}
      />
    )
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>{stage === "config" ? "طابور نشر جديد — الجدولة" : `اختيار المنتجات (${selected.length}/50)`}</DialogTitle></DialogHeader>
        {stage === "config" ? (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">حساب انستغرام (حساب واحد لكل طابور)</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                <option value="">— اختر —</option>
                {connected.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">اسم الطابور (اختياري)</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: عروض رمضان" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">نوع الجدولة</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setScheduleType("FIXED_TIMES")}
                  className={cn("flex-1 rounded-lg border p-2 text-sm", scheduleType === "FIXED_TIMES" ? "border-pink-500 bg-pink-50 dark:bg-pink-900/20" : "border-slate-200 dark:border-slate-700")}>
                  أوقات ثابتة (بتوقيت بغداد)
                </button>
                <button type="button" onClick={() => setScheduleType("INTERVAL")}
                  className={cn("flex-1 rounded-lg border p-2 text-sm", scheduleType === "INTERVAL" ? "border-pink-500 bg-pink-50 dark:bg-pink-900/20" : "border-slate-200 dark:border-slate-700")}>
                  فاصل زمني ثابت
                </button>
              </div>
            </div>
            {scheduleType === "FIXED_TIMES" ? (
              <div className="space-y-2">
                {times.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="time" value={t} onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))}
                      className="rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
                    {times.length > 1 && (
                      <button type="button" onClick={() => setTimes(times.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setTimes([...times, "18:00"])}><Plus className="ml-1 h-3.5 w-3.5" /> وقت إضافي</Button>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium">كل كم دقيقة؟ (أقل شي 15)</label>
                <Input type="number" min={15} value={intervalMinutes} onChange={(e) => setIntervalMinutes(Number(e.target.value))} />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">عدد المنشورات باليوم</label>
              <Input type="number" min={1} max={100} value={postsPerDay} onChange={(e) => setPostsPerDay(Number(e.target.value))} />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <Button variant="outline" onClick={onClose}>إلغاء</Button>
              <Button onClick={() => void createAndPick()}>التالي: اختيار المنتجات ←</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid max-h-[50vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
              {activeItems.map((item) => {
                const isSel = selected.includes(item.id)
                return (
                  <button key={item.id} type="button"
                    onClick={() => {
                      if (isSel) setSelected(selected.filter((id) => id !== item.id))
                      else if (selected.length >= 50) toast({ title: "الحد الأقصى 50 منتج بالطابور", variant: "destructive" })
                      else setSelected([...selected, item.id])
                    }}
                    className={cn("relative overflow-hidden rounded-lg border-2 text-right", isSel ? "border-pink-500" : "border-transparent")}>
                    <div className="aspect-square bg-slate-100 dark:bg-slate-800">
                      {item.images[0] && <img src={item.images[0]} className="h-full w-full object-cover" />}
                    </div>
                    <p className="truncate p-1 text-xs">{item.title || item.productName}</p>
                    {isSel && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-pink-600 text-[11px] text-white">
                        {selected.indexOf(item.id) + 1}
                      </span>
                    )}
                    {item.instagramPublishedAt && <span className="absolute left-1 top-1 rounded bg-emerald-600 px-1 text-[9px] text-white">منشور سابقاً</span>}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-slate-500">ترتيب الاختيار = ترتيب النشر. بعد التأكيد راح تمر على تجهيز كل منتج بالترتيب.</p>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
              <Button variant="outline" onClick={() => setStage("config")}>→ رجوع</Button>
              <Button onClick={() => void startPrepare()} disabled={busy} className="bg-pink-600 hover:bg-pink-700">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : `إنشاء الطابور وتجهيز ${selected.length} منتج`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── مجموعات الهاشتاغ ─────────────────────────────────────────────────────────

function HashtagsTab() {
  const qc = useQueryClient()
  const { data: groups = [] } = useQuery({ queryKey: ["ig-hashtag-groups"], queryFn: getInstagramHashtagGroups })
  const [name, setName] = useState("")
  const [category, setCategory] = useState("")
  const [tags, setTags] = useState("")
  const [busy, setBusy] = useState(false)

  async function add() {
    if (!name.trim() || !tags.trim()) { toast({ title: "الاسم والهاشتاغات مطلوبة", variant: "destructive" }); return }
    setBusy(true)
    try {
      await createInstagramHashtagGroup({
        name: name.trim(),
        category: category.trim() || undefined,
        hashtags: tags.split(/[\s,]+/).filter(Boolean),
      })
      setName(""); setCategory(""); setTags("")
      void qc.invalidateQueries({ queryKey: ["ig-hashtag-groups"] })
    } catch (error) { toast({ title: apiErrorMessage(error), variant: "destructive" }) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid gap-2 p-3 sm:grid-cols-4">
          <Input placeholder="اسم المجموعة" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="التصنيف (اختياري)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <Input placeholder="#هاشتاغ1 #هاشتاغ2 ..." value={tags} onChange={(e) => setTags(e.target.value)} />
          <Button onClick={() => void add()} disabled={busy}><Plus className="ml-1 h-4 w-4" /> إضافة</Button>
        </CardContent>
      </Card>
      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.id}>
            <CardContent className="flex items-start gap-2 p-3">
              <Hash className="mt-1 h-4 w-4 shrink-0 text-pink-600" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{g.name} {g.category && <span className="text-xs text-slate-400">({g.category})</span>}</p>
                <p className="break-words text-xs text-slate-500">{g.hashtags.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")}</p>
              </div>
              <button onClick={async () => { await deleteInstagramHashtagGroup(g.id); void qc.invalidateQueries({ queryKey: ["ig-hashtag-groups"] }) }}
                className="text-slate-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
            </CardContent>
          </Card>
        ))}
        {groups.length === 0 && <p className="col-span-full py-6 text-center text-sm text-slate-500">سوّي مجموعات هاشتاغ جاهزة حسب التصنيف وتستعملها بضغطة وحدة داخل نافذة التجهيز</p>}
      </div>
    </div>
  )
}

export default InstagramPage
