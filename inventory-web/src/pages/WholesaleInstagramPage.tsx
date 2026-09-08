import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { usePageTitle } from "../hooks/usePageTitle"
import {
  createWholesaleInstagramPost,
  deleteWholesaleInstagramPost,
  getProducts,
  getWholesaleInstagramAccounts,
  getWholesaleInstagramPosts,
  type WholesaleInstagramPost,
} from "../api/endpoints"
import type { Product } from "../types/api"
import { useAuthStore } from "../store/authStore"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"
import { WholesaleInstagramPrepareModal } from "../components/wholesale-instagram/WholesaleInstagramPrepareModal"
import { CheckCircle2, ExternalLink, Loader2, Trash2 } from "lucide-react"
import { Instagram } from "../components/instagram/InstagramIcon"

// «إنستغرام الجملة» — standalone management page for wholesale Product
// auto-publish. Independent of /instagram (retail «كتلوك المفرد») — this page
// never imports anything from the retail Instagram components/services.

const TABS = [
  { id: "products", label: "المنتجات الجاهزة للاختيار" },
  { id: "drafts", label: "المسودات" },
  { id: "scheduled", label: "المجدولة" },
  { id: "published", label: "المنشورة" },
  { id: "failed", label: "الفاشلة والمتخطاة" },
] as const

type TabId = (typeof TABS)[number]["id"]

const STATUS_LABEL: Record<WholesaleInstagramPost["status"], { text: string; cls: string }> = {
  DRAFT: { text: "مسودة", cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  SCHEDULED: { text: "مجدول", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  PUBLISHING: { text: "قيد النشر", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  PUBLISHED: { text: "✅ منشور", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  FAILED: { text: "فشل", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  SKIPPED_OUT_OF_STOCK: { text: "تم التخطي — نفدت الكمية", cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
}

function formatBaghdad(iso?: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("ar-IQ", { timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short" })
}

export function WholesaleInstagramPage() {
  usePageTitle("إنستغرام الجملة")
  const [tab, setTab] = useState<TabId>("products")
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const canPublish = hasPermission("PUBLISH_WHOLESALE_INSTAGRAM" as never)

  const { data: accounts = [] } = useQuery({ queryKey: ["wig-accounts"], queryFn: getWholesaleInstagramAccounts })
  const connected = accounts.filter((a) => a.status === "connected")

  return (
    <div className="space-y-4 p-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Instagram className="h-6 w-6 text-pink-600" /> إنستغرام الجملة
        </h1>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          {!canPublish && <span className="text-xs text-slate-400">صلاحيتك: مسودات فقط</span>}
          {connected.length === 0 ? (
            <span className="text-amber-600">ماكو حساب مربوط — اربط حساب الجملة من الإعدادات ← انستغرام</span>
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

      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("rounded-t-lg px-3 py-2 text-sm", tab === t.id ? "border-b-2 border-pink-600 font-semibold text-pink-600" : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300")}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "products" && <ProductsTab connected={connected} />}
      {tab === "drafts" && <PostsTab status="DRAFT" emptyText="ماكو مسودات — جهّز منتجات من التبويب الأول" />}
      {tab === "scheduled" && <PostsTab status="SCHEDULED" emptyText="ماكو منشورات مجدولة" />}
      {tab === "published" && <PostsTab status="PUBLISHED" emptyText="ماكو منشورات ناجحة بعد" />}
      {tab === "failed" && <FailedTab />}
    </div>
  )
}

// ── المنتجات الجاهزة للاختيار ─────────────────────────────────────────────────

function ProductsTab({ connected }: { connected: { id: string; username: string }[] }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [accountId, setAccountId] = useState(connected[0]?.id ?? "")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!accountId && connected.length === 1) setAccountId(connected[0].id)
  }, [connected, accountId])

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["wig-products", search],
    queryFn: () => getProducts({ search: search || undefined, limit: 60 }),
  })

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function createDrafts() {
    if (!accountId) { toast({ title: "اختر حساب انستغرام أولاً", variant: "destructive" }); return }
    if (selected.size === 0) return
    setBusy(true)
    let ok = 0
    let fail = 0
    for (const productId of selected) {
      try {
        await createWholesaleInstagramPost({ productId, accountId })
        ok++
      } catch {
        fail++
      }
    }
    setBusy(false)
    setSelected(new Set())
    void qc.invalidateQueries({ queryKey: ["wig-posts"] })
    toast({
      title: fail === 0 ? `✓ انسوّت ${ok} مسودة` : `انسوّت ${ok} مسودة، فشل ${fail}`,
      description: "أكمل التجهيز (الصور + الكابشن + الجدولة) من تبويب «المسودات»",
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="ابحث باسم المنتج أو الرقم..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
          className="rounded-md border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900">
          <option value="">— اختر حساب انستغرام —</option>
          {connected.map((a) => <option key={a.id} value={a.id}>@{a.username}</option>)}
        </select>
        <Button size="sm" disabled={selected.size === 0 || busy} onClick={() => void createDrafts()} className="bg-pink-600 hover:bg-pink-700">
          {busy ? <Loader2 className="ml-1 h-4 w-4 animate-spin" /> : null}
          إنشاء مسودات للمحدد ({selected.size})
        </Button>
      </div>

      {isLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin" /> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {products.map((p: Product) => {
            const isSelected = selected.has(p.id)
            return (
              <button key={p.id} type="button" onClick={() => toggle(p.id)}
                className={cn("overflow-hidden rounded-lg border-2 text-right", isSelected ? "border-pink-500" : "border-slate-200 dark:border-slate-700")}>
                <div className="relative aspect-square bg-slate-100 dark:bg-slate-800">
                  {p.thumbnailUrl && <img src={p.thumbnailUrl} className="h-full w-full object-cover" />}
                  {isSelected && <CheckCircle2 className="absolute right-1 top-1 h-5 w-5 text-pink-500" />}
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-medium">{p.name}</p>
                  <p className="truncate text-[10px] text-slate-400">{p.itemNumber}</p>
                </div>
              </button>
            )
          })}
          {products.length === 0 && <p className="col-span-full py-8 text-center text-slate-500">ماكو نتائج</p>}
        </div>
      )}
    </div>
  )
}

// ── قوائم المنشورات (مسودات/مجدولة/منشورة) ────────────────────────────────────

function PostsTab({ status, emptyText }: { status: WholesaleInstagramPost["status"]; emptyText: string }) {
  const qc = useQueryClient()
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ["wig-posts", status],
    queryFn: () => getWholesaleInstagramPosts({ status }),
    refetchInterval: status === "SCHEDULED" ? 20000 : undefined,
  })
  const [openPost, setOpenPost] = useState<WholesaleInstagramPost | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ["wig-posts"] })
  }

  async function remove(id: string) {
    if (!window.confirm("حذف هذا المنشور من الجدول؟")) return
    setDeleting(id)
    try {
      await deleteWholesaleInstagramPost(id)
      invalidate()
    } catch (error) {
      toast({ title: apiErrorMessage(error), variant: "destructive" })
    } finally {
      setDeleting(null)
    }
  }

  if (isLoading) return <Loader2 className="mx-auto h-6 w-6 animate-spin" />

  return (
    <div className="space-y-2">
      {posts.map((post) => (
        <PostRow key={post.id} post={post} onOpen={() => setOpenPost(post)} onDelete={() => void remove(post.id)} deleting={deleting === post.id} />
      ))}
      {posts.length === 0 && <p className="py-8 text-center text-slate-500">{emptyText}</p>}

      {openPost && (
        <WholesaleInstagramPrepareModal
          post={openPost}
          onClose={() => setOpenPost(null)}
          onChanged={invalidate}
        />
      )}
    </div>
  )
}

function FailedTab() {
  const { data: failed = [], isLoading: l1 } = useQuery({ queryKey: ["wig-posts", "FAILED"], queryFn: () => getWholesaleInstagramPosts({ status: "FAILED" }), refetchInterval: 20000 })
  const { data: skipped = [], isLoading: l2 } = useQuery({ queryKey: ["wig-posts", "SKIPPED_OUT_OF_STOCK"], queryFn: () => getWholesaleInstagramPosts({ status: "SKIPPED_OUT_OF_STOCK" }) })
  const qc = useQueryClient()
  const [openPost, setOpenPost] = useState<WholesaleInstagramPost | null>(null)
  const posts = useMemo(() => [...failed, ...skipped].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [failed, skipped])

  if (l1 || l2) return <Loader2 className="mx-auto h-6 w-6 animate-spin" />

  return (
    <div className="space-y-2">
      {posts.map((post) => (
        <PostRow key={post.id} post={post} onOpen={() => setOpenPost(post)} />
      ))}
      {posts.length === 0 && <p className="py-8 text-center text-slate-500">ماكو منشورات فاشلة أو متخطاة</p>}

      {openPost && (
        <WholesaleInstagramPrepareModal
          post={openPost}
          onClose={() => setOpenPost(null)}
          onChanged={() => void qc.invalidateQueries({ queryKey: ["wig-posts"] })}
        />
      )}
    </div>
  )
}

function PostRow({
  post, onOpen, onDelete, deleting,
}: {
  post: WholesaleInstagramPost
  onOpen: () => void
  onDelete?: () => void
  deleting?: boolean
}) {
  const label = STATUS_LABEL[post.status]
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
          {post.media[0] && <img src={post.media[0].url} className="h-full w-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1 cursor-pointer" onClick={onOpen}>
          <p className="truncate font-medium">{post.productTitle}</p>
          <p className="text-xs text-slate-500">
            @{post.account.username}
            {post.scheduledAt && <> · موعد النشر: {formatBaghdad(post.scheduledAt)}</>}
            {post.publishedAt && <> · نُشر: {formatBaghdad(post.publishedAt)}</>}
          </p>
          {post.status === "FAILED" && post.errorMessage && <p className="truncate text-xs text-red-600">❌ {post.errorMessage}</p>}
          {post.status === "SKIPPED_OUT_OF_STOCK" && <p className="truncate text-xs text-orange-600">⏭️ {post.skipReason}</p>}
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-xs", label.cls)}>{label.text}</span>
        {post.permalink && (
          <a href={post.permalink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-pink-600">
            <ExternalLink className="h-3 w-3" /> عرض
          </a>
        )}
        <Button size="sm" variant="outline" onClick={onOpen}>فتح</Button>
        {onDelete && (
          <Button size="sm" variant="outline" className="text-red-600" onClick={onDelete} disabled={deleting}>
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
