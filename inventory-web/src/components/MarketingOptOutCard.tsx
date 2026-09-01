import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BellOff, Plus, RotateCcw, Search } from "lucide-react"
import {
  addMarketingOptOut,
  getSettings,
  listMarketingOptOuts,
  resumeMarketingFor,
  updateSettings,
} from "../api/endpoints"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { toast } from "./ui/use-toast"
import { UnsavedNotice } from "./ui/unsaved-notice"

/** Mirrors the backend defaults so the shop sees what is in effect. */
const DEFAULT_STOP_KEYWORDS = ["توقف", "ايقاف", "إيقاف", "الغاء", "إلغاء", "stop", "unsubscribe"]

const fmtDate = (v: string) =>
  new Date(v).toLocaleDateString("ar-IQ", { year: "numeric", month: "short", day: "numeric" })

export function MarketingOptOutCard() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [showWords, setShowWords] = useState(false)
  const [wordsDraft, setWordsDraft] = useState<string | null>(null)

  const listQuery = useQuery({
    queryKey: ["marketing-opt-outs", search],
    queryFn: () => listMarketingOptOuts(search.trim() || undefined),
  })
  const rows = listQuery.data ?? []

  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })
  const savedWords = settingsQuery.data?.marketingStopKeywords ?? []
  const words = wordsDraft ?? (savedWords.length ? savedWords.join("، ") : "")

  const refresh = () => void qc.invalidateQueries({ queryKey: ["marketing-opt-outs"] })

  const addMut = useMutation({
    mutationFn: () => addMarketingOptOut(newPhone.trim(), "أضافه المسؤول يدوياً"),
    onSuccess: () => { toast({ title: "تم إيقاف الإعلانات عن هذا الرقم" }); setNewPhone(""); refresh() },
    onError: () => toast({ title: "تعذر الإضافة", variant: "destructive" }),
  })

  const resumeMut = useMutation({
    mutationFn: (phone: string) => resumeMarketingFor(phone),
    onSuccess: () => { toast({ title: "تم استئناف الإعلانات" }); refresh() },
    onError: () => toast({ title: "تعذر الاستئناف", variant: "destructive" }),
  })

  const wordsMut = useMutation({
    mutationFn: () => updateSettings({
      marketingStopKeywords: words
        .split(/[،,\n]+/)
        .map((w) => w.trim())
        .filter(Boolean),
    }),
    onSuccess: () => {
      toast({ title: "تم حفظ كلمات الإيقاف" })
      setWordsDraft(null)
      void qc.invalidateQueries({ queryKey: ["settings"] })
    },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BellOff className="h-5 w-5 text-rose-600" />
          إيقاف الرسائل الإعلانية ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">
          الزبون يرد بكلمة «توقف» فيتوقف عنه كل شي إعلاني — الحملات والمتابعات.
          <br />
          <strong>فواتيره وكشوف حسابه وسنداته تبقى تصله عادي</strong>، لأنها حقه مو إعلان.
        </p>

        {/* Stop words */}
        <button
          onClick={() => setShowWords((v) => !v)}
          className="w-full rounded-xl bg-slate-100 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
        >
          {showWords ? "إخفاء كلمات الإيقاف" : "تعديل كلمات الإيقاف"}
        </button>

        {showWords && (
          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <p className="text-[11px] text-slate-400">
              افصل بين الكلمات بفاصلة. اتركها فارغة للكلمات الافتراضية:
              <span className="mx-1 font-semibold text-slate-600">{DEFAULT_STOP_KEYWORDS.join("، ")}</span>
            </p>
            <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              المطابقة تكون <strong>للكلمة لوحدها فقط</strong> — حتى لو الزبون اقتبس سطر
              «للتوقف رد بكلمة: توقف» من رسالتك، ما ينوقف عن طريق الخطأ.
            </p>
            <Input
              value={words}
              onChange={(e) => setWordsDraft(e.target.value)}
              placeholder={DEFAULT_STOP_KEYWORDS.join("، ")}
              className="text-sm"
            />
            <UnsavedNotice show={wordsDraft !== null} what="كلمات" />
            <Button
              className="w-full"
              disabled={wordsMut.isPending || wordsDraft === null}
              onClick={() => wordsMut.mutate()}
            >
              {wordsMut.isPending ? "جاري الحفظ..." : "حفظ كلمات الإيقاف"}
            </Button>
          </div>
        )}

        {/* Manual add — for customers who ask by phone or in person */}
        <div className="flex gap-2">
          <Input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="أوقف الإعلانات عن رقم يدوياً"
            dir="ltr"
            className="flex-1 text-sm"
          />
          <Button
            onClick={() => addMut.mutate()}
            disabled={newPhone.trim().length < 5 || addMut.isPending}
            className="shrink-0"
          >
            <Plus className="ml-1 h-4 w-4" /> إيقاف
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pr-9"
            placeholder="ابحث برقم الهاتف"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {listQuery.isLoading && <p className="py-4 text-center text-sm text-slate-400">جاري التحميل...</p>}
        {!listQuery.isLoading && rows.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-400">ما في أرقام موقوفة</p>
        )}

        <div className="max-h-80 space-y-2 overflow-y-auto">
          {rows.map((r) => (
            <div key={r.phone} className="flex items-center gap-3 rounded-xl border bg-slate-50 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800">{r.name ?? "—"}</p>
                <p className="text-xs text-slate-400" dir="ltr">{r.phone}</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {r.source === "ADMIN" ? "أوقفته يدوياً" : "ردّ بكلمة الإيقاف"} · {fmtDate(r.createdAt)}
                </p>
              </div>
              <button
                onClick={() => resumeMut.mutate(r.phone)}
                disabled={resumeMut.isPending}
                className="shrink-0 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
              >
                <RotateCcw className="ml-1 inline h-3.5 w-3.5" />
                استئناف
              </button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
