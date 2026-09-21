/**
 * «المناطق» — the owner's screen for the neighbourhoods their shop sells in.
 *
 * Why the owner and not the rep: a list typed by whoever is standing outside a
 * shop at the time becomes «حي الحسين», «الحسين» and «حي الحسين (ع)» inside a
 * month, and no filter finds all three. One person curates; the reps pick.
 *
 * The map is how a centre gets set, because a centre typed as two decimal
 * numbers is a centre nobody sets. The centre is what lets the rep's «موقعي
 * الحالي» name a neighbourhood instead of asking them to scroll a list of 50.
 */
import { Suspense, lazy, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, MapPin, Plus, Search, Trash2 } from "lucide-react"
import { api } from "../api/client"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/table"
import { toast } from "../components/ui/use-toast"
import { QueryErrorBox } from "../components/ui/query-error"
import { apiErrorMessage } from "../utils/apiError"
import { cn } from "../utils/cn"
import karbalaAreas from "../data/karbala-areas.json"

const VisitMap = lazy(() => import("./sales-agent/VisitMap"))

type Area = {
  id: string
  name: string
  city: string | null
  centerLat: number | null
  centerLng: number | null
  sortOrder: number
  isActive: boolean
  customerCount?: number
}

export function AreasPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState("")
  const [name, setName] = useState("")
  const [editing, setEditing] = useState<Area | null>(null)
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null)

  const areas = useQuery({
    queryKey: ["areas", "all"],
    queryFn: async () => {
      const res = await api.get<{ data: Area[] }>("/areas", { params: { withCounts: 1 } })
      return res.data.data ?? []
    },
    retry: 3,
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["areas"] })
    // The rep's own picker reads a different key; both must move together or a
    // rep keeps offering a neighbourhood the owner just retired.
    void qc.invalidateQueries({ queryKey: ["sales-agent", "area-rows"] })
    void qc.invalidateQueries({ queryKey: ["sales-agent", "areas"] })
  }

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: Area }>("/areas", {
        name,
        centerLat: point?.lat,
        centerLng: point?.lng,
      })
      return res.data.data
    },
    onSuccess: () => {
      toast({ title: "انضافت المنطقة ✓" })
      setName("")
      setPoint(null)
      refresh()
    },
    onError: (err) =>
      toast({ title: "ما انضافت", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const save = useMutation({
    mutationFn: async (payload: { id: string; body: Partial<Area> }) => {
      const res = await api.patch<{ data: Area }>(`/areas/${payload.id}`, payload.body)
      return res.data.data
    },
    onSuccess: () => {
      toast({ title: "انحفظت ✓" })
      setEditing(null)
      setPoint(null)
      refresh()
    },
    onError: (err) =>
      toast({ title: "ما انحفظت", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete<{ message?: string }>(`/areas/${id}`)
      return res.data
    },
    onSuccess: (data) => {
      toast({ title: data?.message ?? "انحذفت" })
      refresh()
    },
    onError: (err) =>
      toast({ title: "ما انحذفت", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const importKarbala = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { added: number; skipped: number } }>("/areas/import", {
        areas: karbalaAreas,
      })
      return res.data.data
    },
    onSuccess: (data) => {
      toast({
        title: `انضافت ${data.added} منطقة`,
        description: data.skipped > 0 ? `${data.skipped} كانت موجودة مسبقاً` : undefined,
      })
      refresh()
    },
    onError: (err) =>
      toast({ title: "ما انستورد", description: apiErrorMessage(err), variant: "destructive" }),
  })

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = areas.data ?? []
    if (!term) return list
    return list.filter((a) => a.name.toLowerCase().includes(term))
  }, [areas.data, search])

  const placed = (areas.data ?? []).filter((a) => a.centerLat != null).length
  const total = (areas.data ?? []).length

  if (areas.error) {
    return <QueryErrorBox title="ما وصلت المناطق" onRetry={() => void areas.refetch()} />
  }

  // Opening the map on an area that already has a centre, rather than on an
  // empty world view, is what makes correcting one a two-second job.
  const mapCenter: [number, number] | null =
    point
      ? [point.lat, point.lng]
      : (areas.data ?? []).find((a) => a.centerLat != null)
        ? [
            (areas.data ?? []).find((a) => a.centerLat != null)!.centerLat as number,
            (areas.data ?? []).find((a) => a.centerLat != null)!.centerLng as number,
          ]
        : null

  return (
    <div dir="rtl" className="space-y-4 p-3 sm:p-5">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>المناطق</CardTitle>
            <p className="mt-0.5 text-[12px] text-slate-500 tabular-nums">
              {total} منطقة · {placed} عليها موقع على الخريطة
            </p>
          </div>
          {/* Offered only while the table is empty. A shop that has curated its
              own list must not be one tap away from 53 rows it did not ask for. */}
          {total === 0 && (
            <Button
              variant="outline"
              className="h-11"
              disabled={importKarbala.isPending}
              onClick={() => importKarbala.mutate()}
            >
              {importKarbala.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              استورد أحياء كربلاء ({karbalaAreas.length})
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {total === 0 && (
            <p className="rounded-lg bg-amber-50 p-3 text-[13px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              ما اكو مناطق. المندوب ما راح يقدر يحدد منطقة أي زبون جديد قبل ما تضيفها.
              استورد أحياء كربلاء وبعدين صحّح وشطّب الي ما يخصك، أو أضف مناطقك وحدة وحدة.
            </p>
          )}

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="اسم منطقة جديدة"
              aria-label="اسم منطقة جديدة"
              className="h-11"
            />
            <Button
              className="h-11"
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              أضف
            </Button>
          </div>
          {point && (
            <p className="rounded bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
              {editing ? `الموقع الجديد لـ «${editing.name}»` : "الموقع المختار راح ينحفظ مع المنطقة الجديدة"}
              {editing && (
                <Button
                  variant="outline"
                  className="ms-2 h-9"
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate({ id: editing.id, body: { centerLat: point.lat, centerLng: point.lng } })
                  }
                >
                  احفظ الموقع
                </Button>
              )}
              <Button variant="ghost" className="ms-2 h-9" onClick={() => { setPoint(null); setEditing(null) }}>
                إلغاء
              </Button>
            </p>
          )}

          <Suspense fallback={<div className="grid h-40 place-items-center text-sm text-slate-500">جاري فتح الخريطة…</div>}>
            <VisitMap
              pins={[]}
              onPick={() => {}}
              picking
              picked={point}
              center={mapCenter}
              onPickPoint={setPoint}
            />
          </Suspense>
          <p className="text-[12px] text-slate-500">
            اضغط على الخريطة لتحديد مركز المنطقة. المركز هو الي يخلي «موقعي الحالي» عند المندوب
            يعرف اسم الحي لحاله.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>القائمة</CardTitle>
          <label className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute inset-y-0 right-3 my-auto size-4 text-slate-400" aria-hidden="true" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="دور على منطقة"
              aria-label="بحث عن منطقة"
              className="h-11 pe-10"
            />
          </label>
        </CardHeader>
        <CardContent>
          {areas.isPending ? (
            <p className="py-10 text-center text-sm text-slate-500">جاري التحميل…</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              {search ? "ماكو نتائج" : "ما اكو مناطق بعد"}
            </p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>المنطقة</TH>
                  <TH>الزبائن</TH>
                  <TH>الموقع</TH>
                  <TH>الحالة</TH>
                  <TH>الإجراء</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((area) => (
                  <TR key={area.id} className={area.isActive ? "" : "opacity-60"}>
                    <TD className="font-medium">{area.name}</TD>
                    <TD className="tabular-nums">{area.customerCount ?? 0}</TD>
                    <TD>
                      {area.centerLat != null ? (
                        <span className="text-[12px] text-emerald-700 dark:text-emerald-300">محدد</span>
                      ) : (
                        <span className="text-[12px] text-amber-700 dark:text-amber-300">ما محدد</span>
                      )}
                    </TD>
                    <TD>
                      <span className={cn("text-[12px]", area.isActive ? "text-slate-500" : "text-red-600")}>
                        {area.isActive ? "فعّالة" : "معطّلة"}
                      </span>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          size="sm"
                          variant={editing?.id === area.id ? "default" : "outline"}
                          className="h-11"
                          onClick={() => {
                            setEditing(area)
                            setPoint(
                              area.centerLat != null
                                ? { lat: area.centerLat, lng: area.centerLng as number }
                                : null,
                            )
                          }}
                        >
                          <MapPin className="size-3.5" /> الموقع
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-11"
                          disabled={save.isPending}
                          onClick={() => save.mutate({ id: area.id, body: { isActive: !area.isActive } })}
                        >
                          {area.isActive ? "عطّل" : "فعّل"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-11"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(area.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default AreasPage
