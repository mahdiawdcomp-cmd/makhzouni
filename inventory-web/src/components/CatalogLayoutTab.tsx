import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Eye, EyeOff, LayoutList, Sparkles, Tags, Type } from "lucide-react"
import { getSettings, updateSettings, getProducts } from "../api/endpoints"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { toast } from "./ui/use-toast"
import { cn } from "../utils/cn"
import { CATALOG_TEXT_DEFAULTS } from "../utils/catalogLayout"

/* ══════════════════════════════════════════════════════════════════════
   «ترتيب الواجهة» — the merchant arranging their own storefront.

   Mirrors CATALOG_SECTION_KEYS on the backend. The labels live here and the
   keys live there on purpose: renaming a section for humans must never
   reshuffle a shop's saved order.
══════════════════════════════════════════════════════════════════════ */

const SECTION_LABELS: Record<string, { label: string; hint: string }> = {
  announcement: { label: "شريط الإعلان", hint: "السطر الي تكتبه بنفسك — عرض أو كود خصم" },
  priceBar: { label: "شريط الأسعار", hint: "يطلع للزائر الي أسعاره مخفية مع زر طلب العرض" },
  badges: { label: "شارات الثقة", hint: "الثلاث شارات الي تفعّلها من تصميم الكتلوك" },
  banner: { label: "البنر المتحرك", hint: "شريط الصور المتحرك بأعلى الصفحة" },
  featured: { label: "مختاراتنا", hint: "صف المنتجات الي تختارها بنفسك" },
}

const DEFAULT_ORDER = ["announcement", "priceBar", "badges", "banner", "featured"]

/** Wording the shop is most likely to want to change, in the order it appears. */
const PRIMARY_TEXT_KEYS = [
  "storeTitle", "loginSubtitle", "loginHeading", "loginHint", "loginButton",
  "noCodeLabel", "requestCodeButton", "requestCodeHint",
]

const TEXT_LABELS: Record<string, string> = {
  storeTitle: "عنوان المتجر",
  loginSubtitle: "سطر تحت العنوان",
  loginHeading: "عنوان صندوق الدخول",
  loginHint: "شرح تحت العنوان",
  loginButton: "زر الدخول",
  noCodeLabel: "سطر «ما عندك رمز؟»",
  requestCodeButton: "زر طلب الرمز",
  requestCodeHint: "شرح تحت زر الطلب",
  detailsTitle: "عنوان صفحة البيانات",
  detailsSubtitle: "سطر تحت عنوان البيانات",
  detailsButton: "زر دخول المتجر",
  pricesLockedBar: "شريط الأسعار المخفية",
  pricesPendingBar: "شريط الطلب المعلّق",
  requestPriceButton: "زر طلب عرض السعر",
  featuredTitle: "عنوان صف مختاراتنا",
  emptyResults: "رسالة «ما اكو نتائج»",
}

export function CatalogLayoutTab() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const saved = settingsQuery.data

  const [orderDraft, setOrderDraft] = useState<Array<{ key: string; enabled: boolean }> | null>(null)
  const [textDraft, setTextDraft] = useState<Record<string, string> | null>(null)
  const [showAdvancedTexts, setShowAdvancedTexts] = useState(false)

  // Saved list merged with the built-in one, exactly as the backend does it —
  // so a section added in a later release shows up here too, without the shop
  // having to reset anything.
  const sections = useMemo(() => {
    if (orderDraft) return orderDraft
    const savedList = saved?.catalogSections ?? []
    const seen = new Set<string>()
    const out: Array<{ key: string; enabled: boolean }> = []
    for (const entry of savedList) {
      if (!DEFAULT_ORDER.includes(entry.key) || seen.has(entry.key)) continue
      seen.add(entry.key)
      out.push({ key: entry.key, enabled: entry.enabled !== false })
    }
    for (const key of DEFAULT_ORDER) if (!seen.has(key)) out.push({ key, enabled: true })
    return out
  }, [orderDraft, saved?.catalogSections])

  const texts = textDraft ?? (saved?.catalogTexts ?? {})

  const saveMut = useMutation({
    mutationFn: (patch: Parameters<typeof updateSettings>[0]) => updateSettings(patch),
    onSuccess: () => {
      toast({ title: "تم الحفظ" })
      setOrderDraft(null)
      setTextDraft(null)
      void qc.invalidateQueries({ queryKey: ["settings"] })
    },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })

  function move(index: number, delta: number) {
    const next = [...sections]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setOrderDraft(next)
  }

  function toggle(index: number) {
    const next = [...sections]
    next[index] = { ...next[index], enabled: !next[index].enabled }
    setOrderDraft(next)
  }

  const advancedKeys = Object.keys(CATALOG_TEXT_DEFAULTS).filter((k) => !PRIMARY_TEXT_KEYS.includes(k))

  function textField(key: string) {
    return (
      <div key={key} className="space-y-1">
        <label className="text-xs font-semibold text-slate-600">{TEXT_LABELS[key] ?? key}</label>
        <Input
          value={texts[key] ?? ""}
          placeholder={CATALOG_TEXT_DEFAULTS[key]}
          onChange={(e) => setTextDraft({ ...texts, [key]: e.target.value })}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* ── Section order ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutList className="h-5 w-5 text-indigo-600" />
            ترتيب أقسام الكتلوك
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-xl bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
            هذي الأقسام الي بين رأس الصفحة وقائمة المنتجات — رتبها بالأسهم وأطفي الي ما تريده.
            البحث وقائمة المنتجات والفوتر مكانهم ثابت، وإلهم مفاتيح تشغيل بمكان ثاني.
          </p>

          <div className="space-y-2">
            {sections.map((s, i) => (
              <div key={s.key}
                className={cn(
                  "flex items-center gap-2 rounded-xl border p-3",
                  s.enabled ? "bg-white" : "bg-slate-50 opacity-60",
                )}>
                <span className="w-6 shrink-0 text-center text-xs font-bold text-slate-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800">{SECTION_LABELS[s.key]?.label ?? s.key}</p>
                  <p className="text-[11px] text-slate-400">{SECTION_LABELS[s.key]?.hint ?? ""}</p>
                </div>
                <button onClick={() => toggle(i)}
                  className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100"
                  title={s.enabled ? "إخفاء" : "إظهار"}>
                  {s.enabled ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30"
                  title="فوق">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === sections.length - 1}
                  className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30"
                  title="تحت">
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <Button size="sm" className="w-full"
            disabled={orderDraft === null || saveMut.isPending}
            onClick={() => saveMut.mutate({ catalogSections: sections })}>
            {saveMut.isPending ? "جاري الحفظ..." : "حفظ الترتيب"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Feature switches + grid defaults ── */}
      <CatalogBehaviourCard />

      {/* ── Featured products ── */}
      <FeaturedProductsCard />

      {/* ── Categories ── */}
      <CatalogCategoriesCard />

      {/* ── Wording ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Type className="h-5 w-5 text-slate-600" />
            نصوص الكتلوك
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            اترك أي حقل فارغ ويبقى النص الافتراضي — الي تشوفه بالرمادي داخل الحقل.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {PRIMARY_TEXT_KEYS.map(textField)}
          </div>

          <button onClick={() => setShowAdvancedTexts((v) => !v)}
            className="w-full rounded-xl bg-slate-100 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-200">
            {showAdvancedTexts ? "إخفاء النصوص المتقدمة" : `نصوص متقدمة (${advancedKeys.length})`}
          </button>

          {showAdvancedTexts && (
            <div className="grid gap-3 sm:grid-cols-2">
              {advancedKeys.map(textField)}
            </div>
          )}

          <Button size="sm" className="w-full"
            disabled={textDraft === null || saveMut.isPending}
            onClick={() => saveMut.mutate({
              // Blank fields are dropped rather than stored as "", so clearing
              // a field genuinely restores the built-in wording.
              catalogTexts: Object.fromEntries(
                Object.entries(texts).filter(([, v]) => String(v).trim()),
              ),
            })}>
            {saveMut.isPending ? "جاري الحفظ..." : "حفظ النصوص"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

/* ── Feature switches + how the grid starts ────────────────────────── */

function CatalogBehaviourCard() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const s = settingsQuery.data

  const saveMut = useMutation({
    mutationFn: (patch: Parameters<typeof updateSettings>[0]) => updateSettings(patch),
    onSuccess: () => { toast({ title: "تم الحفظ" }); void qc.invalidateQueries({ queryKey: ["settings"] }) },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })

  const switches: Array<{ key: "catalogReviewsEnabled" | "catalogSuggestionsEnabled" | "catalogTutorialEnabled"; label: string; hint: string }> = [
    { key: "catalogReviewsEnabled", label: "تقييمات المنتجات", hint: "آراء الزبائن داخل صفحة المنتج" },
    { key: "catalogSuggestionsEnabled", label: "منتجات مقترحة", hint: "«شوف أيضاً» أسفل صفحة المنتج" },
    { key: "catalogTutorialEnabled", label: "شرح أول زيارة", hint: "الشاشة الي تشرح للزبون شلون يشتري" },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-5 w-5 text-emerald-600" />
          مفاتيح وشكل العرض
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {switches.map(({ key, label, hint }) => (
          <label key={key} className="flex items-start gap-2.5 rounded-xl border bg-white p-3">
            <input
              type="checkbox"
              checked={s?.[key] !== false}
              onChange={(e) => saveMut.mutate({ [key]: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-emerald-600"
            />
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-800">{label}</span>
              <span className="block text-[11px] text-slate-400">{hint}</span>
            </span>
          </label>
        ))}

        <div className="rounded-xl border bg-white p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-600">شكل القائمة أول ما يفتح الزبون</p>
          <p className="text-[11px] text-slate-400">
            هذي البداية فقط — الزبون يبقى يكدر يغيّرها لنفسه.
          </p>
          <div className="flex gap-1.5">
            {(["grid", "list"] as const).map((v) => (
              <button key={v} onClick={() => saveMut.mutate({ catalogDefaultView: v })}
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-xs font-bold transition",
                  (s?.catalogDefaultView ?? "grid") === v
                    ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}>
                {v === "grid" ? "شبكة" : "قائمة"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">منتجات بالصف</span>
            {[1, 2, 3].map((n) => (
              <button key={n} onClick={() => saveMut.mutate({ catalogDefaultPerRow: n })}
                className={cn(
                  "h-8 w-8 rounded-lg text-xs font-bold transition",
                  (s?.catalogDefaultPerRow ?? 2) === n
                    ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                )}>
                {n}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── «مختاراتنا» ───────────────────────────────────────────────────── */

function FeaturedProductsCard() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  // Memoised so the array identity is stable — a fresh [] every render would
  // re-run the lookup below on every keystroke.
  const chosen = useMemo(
    () => settingsQuery.data?.catalogFeaturedProductIds ?? [],
    [settingsQuery.data?.catalogFeaturedProductIds],
  )

  const productsQuery = useQuery({
    queryKey: ["products-for-featured", search],
    queryFn: () => getProducts({ search: search.trim() || undefined, limit: 20 }),
    enabled: search.trim().length > 1,
  })

  // Chosen ids resolve to names through a separate lookup, so a featured
  // product stays readable here even when it is not in the search results.
  const chosenQuery = useQuery({
    queryKey: ["featured-product-names", chosen.join(",")],
    queryFn: () => getProducts({ limit: 200 }),
    enabled: chosen.length > 0,
  })
  const chosenNames = useMemo(() => {
    const byId = new Map((chosenQuery.data ?? []).map((p) => [p.id, p.name]))
    return chosen.map((id) => ({ id, name: byId.get(id) ?? "مادة محذوفة أو غير معروفة" }))
  }, [chosen, chosenQuery.data])

  const saveMut = useMutation({
    mutationFn: (ids: string[]) => updateSettings({ catalogFeaturedProductIds: ids }),
    onSuccess: () => { toast({ title: "تم الحفظ" }); void qc.invalidateQueries({ queryKey: ["settings"] }) },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-5 w-5 text-amber-600" />
          مختاراتنا
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          المواد الي تختارها تطلع بصف خاص بأعلى الكتلوك. تبقى بمكانها الطبيعي بالقائمة بعد،
          وإذا خلصت من المخزن تختفي من الصف لوحدها.
        </p>

        {chosenNames.length > 0 && (
          <div className="space-y-1.5">
            {chosenNames.map(({ id, name }) => (
              <div key={id} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{name}</span>
                <button onClick={() => saveMut.mutate(chosen.filter((c) => c !== id))}
                  className="shrink-0 text-xs font-bold text-red-600">شيل</button>
              </div>
            ))}
          </div>
        )}

        <Input placeholder="ابحث عن مادة لتضيفها" value={search} onChange={(e) => setSearch(e.target.value)} />

        {productsQuery.data?.length ? (
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {productsQuery.data
              .filter((p) => !chosen.includes(p.id))
              .map((p) => (
                <button key={p.id}
                  onClick={() => { saveMut.mutate([...chosen, p.id]); setSearch("") }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-right text-sm text-slate-700 transition hover:bg-slate-50">
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 text-xs font-bold text-emerald-600">أضف</span>
                </button>
              ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/* ── Categories on the storefront ──────────────────────────────────── */

function CatalogCategoriesCard() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const hidden = settingsQuery.data?.catalogHiddenCategories ?? []
  const order = useMemo(
    () => settingsQuery.data?.catalogCategoryOrder ?? [],
    [settingsQuery.data?.catalogCategoryOrder],
  )

  const catsQuery = useQuery({
    queryKey: ["catalog-categories-admin"],
    queryFn: () => getProducts({ limit: 500 }),
  })

  // Built from the products themselves rather than a category table, so a
  // category that exists only on products still shows up here.
  const all = useMemo(() => {
    const set = new Set<string>()
    for (const p of catsQuery.data ?? []) {
      if (p.categoryTags?.length) p.categoryTags.forEach((t: string) => set.add(t))
      else if (p.category) set.add(p.category)
    }
    const list = [...set]
    if (order.length === 0) return list.sort((a, b) => a.localeCompare(b))
    return list.sort((a, b) => {
      const ai = order.indexOf(a); const bi = order.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.localeCompare(b)
    })
  }, [catsQuery.data, order])

  const saveMut = useMutation({
    mutationFn: (patch: Parameters<typeof updateSettings>[0]) => updateSettings(patch),
    onSuccess: () => { toast({ title: "تم الحفظ" }); void qc.invalidateQueries({ queryKey: ["settings"] }) },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })

  function move(index: number, delta: number) {
    const next = [...all]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    saveMut.mutate({ catalogCategoryOrder: next })
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Tags className="h-5 w-5 text-blue-600" />
          تصنيفات الكتلوك
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
          إخفاء تصنيف يشيله من الكتلوك فقط — المواد تبقى بمكانها ومخزنها ما يتأثر أبداً.
        </p>

        {all.length === 0 && <p className="py-4 text-center text-sm text-slate-400">ما في تصنيفات</p>}

        <div className="space-y-1.5">
          {all.map((c, i) => {
            const isHidden = hidden.includes(c)
            return (
              <div key={c} className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2",
                isHidden ? "bg-slate-50 opacity-60" : "bg-white",
              )}>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{c}</span>
                <button
                  onClick={() => saveMut.mutate({
                    catalogHiddenCategories: isHidden ? hidden.filter((h) => h !== c) : [...hidden, c],
                  })}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100"
                  title={isHidden ? "إظهار" : "إخفاء"}>
                  {isHidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button onClick={() => move(i, -1)} disabled={i === 0}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === all.length - 1}
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30">
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
