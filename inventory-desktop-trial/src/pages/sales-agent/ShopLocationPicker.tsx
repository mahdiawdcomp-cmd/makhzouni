/**
 * «موقع المحل» — pin the shop while standing in its doorway.
 *
 * Two ways in, because neither works everywhere:
 *   - «موقعي الحالي» reads the phone's GPS. This is the normal path: the rep is
 *     at the shop, and it takes one tap.
 *   - Tapping the map. This is for the wifi-only tablet with no fix, the shop
 *     inside a covered market where GPS never settles, and the customer added
 *     later from the office.
 *
 * Whichever is used, the area is SUGGESTED from the point rather than asked
 * for: picking a neighbourhood out of a list of fifty is the step reps skip,
 * and a customer with no area is invisible to every area filter afterwards.
 * The suggestion is always shown and always overridable — it is the nearest
 * centre, not a boundary, so it can be wrong at the edge of two neighbourhoods.
 */
import { Suspense, lazy, useState } from "react"
import { Crosshair, Loader2, MapPin } from "lucide-react"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { apiErrorMessage } from "../../utils/apiError"
import { api } from "../../api/client"
import { toast } from "../../components/ui/use-toast"
import { cn } from "../../utils/cn"
import {
  formatDistance,
  hasFix,
  readAgentLocation,
  type AgentLocation,
} from "../../utils/agentLocation"

const VisitMap = lazy(() => import("./VisitMap"))

export type AreaOption = {
  id: string
  name: string
  centerLat: number | null
  centerLng: number | null
}

export type ShopPoint = { lat: number; lng: number }

/**
 * Ask the server which area a point falls in.
 *
 * Deliberately server-side: the client would need every area's centre to answer
 * it, and «أقرب مركز» has to mean the same thing here and in the reports.
 */
async function suggestArea(point: ShopPoint): Promise<{ id: string; name: string } | null> {
  try {
    const res = await api.get<{ data: { area: { id: string; name: string } | null } }>(
      "/areas/suggest",
      { params: { lat: point.lat, lng: point.lng } },
    )
    return res.data.data.area
  } catch {
    // A failed suggestion must not cost the rep the point they just dropped.
    return null
  }
}

export function ShopLocationPicker({
  point,
  onPoint,
  areas,
  areaId,
  onAreaId,
  /** The last GPS reading, kept by the parent so it can travel with the save. */
  onLocationRead,
  city,
}: {
  point: ShopPoint | null
  onPoint: (point: ShopPoint | null) => void
  areas: AreaOption[]
  areaId: string
  onAreaId: (id: string) => void
  onLocationRead?: (location: AgentLocation) => void
  /** Where the map opens before anything is picked — the shop's own city. */
  city?: ShopPoint | null
}) {
  const [reading, setReading] = useState(false)
  const [accuracyM, setAccuracyM] = useState<number | null>(null)
  const [suggested, setSuggested] = useState<string | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  // «هذا الحي مو بالقائمة». The rep types a name; it goes to the owner as an
  // approval and nothing is added to the list until they say yes.
  const [proposeOpen, setProposeOpen] = useState(false)
  const [proposed, setProposed] = useState("")
  const [sending, setSending] = useState(false)

  /**
   * Apply a point: remember it, then fill the area IF the rep has not already
   * chosen one. Overwriting a deliberate choice with a guess is how a rep ends
   * up fighting the form.
   */
  const applyPoint = async (next: ShopPoint) => {
    onPoint(next)
    const area = await suggestArea(next)
    if (!area) {
      setSuggested(null)
      return
    }
    setSuggested(area.name)
    if (!areaId) onAreaId(area.id)
  }

  const useMyLocation = async () => {
    setReading(true)
    try {
      const location = await readAgentLocation()
      onLocationRead?.(location)
      if (!hasFix(location)) {
        toast({
          title:
            location.status === "DENIED"
              ? "الموقع مرفوض — فعّله من إعدادات المتصفح أو اختر من الخريطة"
              : "ما وصل الموقع — اختر النقطة من الخريطة",
          variant: "destructive",
        })
        setMapOpen(true)
        return
      }
      setAccuracyM(location.accuracyM ?? null)
      await applyPoint({ lat: location.latitude as number, lng: location.longitude as number })
    } finally {
      setReading(false)
    }
  }

  const sendProposal = async () => {
    const name = proposed.trim()
    if (!name) return
    setSending(true)
    try {
      await api.post("/sales-agent/areas/propose", {
        name,
        // The pin the rep already dropped becomes the proposed centre, so the
        // owner is not asked to place a neighbourhood they have never stood in.
        centerLat: point?.lat,
        centerLng: point?.lng,
      })
      toast({ title: "انرسل الاقتراح لصاحب المحل", description: "كمّل الزبون هسه — المنطقة تنربط بعد الموافقة" })
      setProposed("")
      setProposeOpen(false)
    } catch (err) {
      toast({ title: "ما انرسل", description: apiErrorMessage(err), variant: "destructive" })
    } finally {
      setSending(false)
    }
  }

  const areaName = areas.find((a) => a.id === areaId)?.name ?? null
  // A fix this vague cannot tell one shop from its neighbour, so the rep is
  // told rather than left to trust a pin that could be a street away.
  const vague = accuracyM != null && accuracyM > 150

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="h-11" disabled={reading} onClick={() => void useMyLocation()}>
          {reading ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
          موقعي الحالي
        </Button>
        <Button type="button" variant={mapOpen ? "default" : "outline"} className="h-11" onClick={() => setMapOpen((v) => !v)}>
          <MapPin className="size-4" /> {mapOpen ? "سكّر الخريطة" : "اختر من الخريطة"}
        </Button>
        {point && (
          <Button type="button" variant="ghost" className="h-11" onClick={() => { onPoint(null); setAccuracyM(null); setSuggested(null) }}>
            امسح الموقع
          </Button>
        )}
      </div>

      {point ? (
        <p className={cn("rounded-lg px-3 py-2 text-[13px]", vague ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800")}>
          {vague ? "الموقع تقريبي — الإشارة ضعيفة" : "انحدد موقع المحل ✓"}
          {accuracyM != null && <span className="tabular-nums"> · دقة {formatDistance(accuracyM)}</span>}
          {suggested && <span> · المنطقة المقترحة: {suggested}</span>}
        </p>
      ) : (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          بدون موقع، المحل ما راح يبين بخريطة الزيارات. اضغط «موقعي الحالي» وأنت واقف بالمحل.
        </p>
      )}

      {mapOpen && (
        <Suspense fallback={<div className="grid h-40 place-items-center text-sm text-slate-500">جاري فتح الخريطة…</div>}>
          <VisitMap
            pins={[]}
            onPick={() => {}}
            picking
            picked={point}
            center={city ? [city.lat, city.lng] : null}
            onPickPoint={(next) => void applyPoint(next)}
          />
        </Suspense>
      )}

      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-slate-600 dark:text-slate-300">المنطقة</span>
        {areas.length === 0 ? (
          <p className="rounded border border-slate-300 bg-slate-50 p-2.5 text-[13px] text-slate-500 dark:border-slate-700 dark:bg-slate-900">
            ما اكو مناطق مضافة. صاحب المحل يضيفها من الإعدادات.
          </p>
        ) : (
          <select
            value={areaId}
            onChange={(e) => onAreaId(e.target.value)}
            aria-label="المنطقة"
            className="h-11 w-full cursor-pointer rounded border border-slate-300 bg-white px-3 text-[13.5px] focus:border-[var(--theme-accent)] focus:outline-none dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="">— اختر المنطقة —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
        {/* The rep is standing in a neighbourhood nobody added yet. Without
            this they either pick a wrong nearby area or leave it blank, and
            the customer becomes invisible to every area filter. */}
        {proposeOpen ? (
          <div className="mt-2 space-y-2 rounded-lg border border-[var(--theme-cardBorder)] p-3">
            <Input
              value={proposed}
              onChange={(e) => setProposed(e.target.value)}
              placeholder="اسم الحي مثل ما يسمّونه هنا"
              aria-label="اسم الحي المقترح"
              className="h-11"
            />
            <p className="text-[12px] text-slate-500">
              راح ينرسل لصاحب المحل. كمّل الزبون هسه — الموقع محفوظ، والمنطقة تنربط بعد الموافقة.
            </p>
            <div className="flex gap-2">
              <Button type="button" className="h-11" disabled={!proposed.trim() || sending} onClick={() => void sendProposal()}>
                {sending ? <Loader2 className="size-4 animate-spin" /> : null}
                أرسل الاقتراح
              </Button>
              <Button type="button" variant="ghost" className="h-11" onClick={() => setProposeOpen(false)}>
                إلغاء
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" className="mt-1 h-11" onClick={() => setProposeOpen(true)}>
            هذا الحي مو بالقائمة
          </Button>
        )}

        {/* Named when it differs, so the rep sees that their own choice is the
            one being saved and not silently replaced by the suggestion. */}
        {suggested && areaName && suggested !== areaName && (
          <span className="mt-1 block text-[12px] text-slate-500">
            المقترح من الموقع: {suggested} — إنت اخترت {areaName}
          </span>
        )}
      </label>
    </div>
  )
}
