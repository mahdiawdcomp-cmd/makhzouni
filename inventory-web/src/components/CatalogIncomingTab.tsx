import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Image as ImageIcon, PackageCheck, Ship, Trash2, Users } from "lucide-react"
import {
  listIncomingItems,
  saveIncomingItem,
  deleteIncomingItem,
  listIncomingReservations,
  setIncomingReservationStatus,
  markIncomingArrived,
  listAllReservations,
  type ReservationRow,
  type IncomingItem,
} from "../api/endpoints"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { ConfirmDialog } from "./ui/confirm-dialog"
import { Input } from "./ui/input"
import { toast } from "./ui/use-toast"
import { cn } from "../utils/cn"

/* ══════════════════════════════════════════════════════════════════════
   «البضاعة القادمة الجديدة»

   Goods the shop has bought but not received, curated by hand. Nothing here
   touches stock or products — an item on this list does not exist in the
   warehouse yet, and a reservation against it is a promise to sell rather
   than an order.
══════════════════════════════════════════════════════════════════════ */

const empty = { name: "", description: "", imageUrl: "", expectedAt: "", price: "", active: true }

export function CatalogIncomingTab() {
  const qc = useQueryClient()
  const [form, setForm] = useState<typeof empty & { id?: string }>({ ...empty })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [openReservations, setOpenReservations] = useState<string | null>(null)
  const [confirmArrived, setConfirmArrived] = useState<IncomingItem | null>(null)

  const itemsQuery = useQuery({ queryKey: ["incoming-items"], queryFn: listIncomingItems })
  const items = itemsQuery.data ?? []

  const refresh = () => void qc.invalidateQueries({ queryKey: ["incoming-items"] })

  const saveMut = useMutation({
    mutationFn: () => saveIncomingItem({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      imageUrl: form.imageUrl || undefined,
      expectedAt: form.expectedAt || null,
      price: form.price.trim() ? Number(form.price) : null,
      active: form.active,
    }, form.id),
    onSuccess: () => { toast({ title: form.id ? "تم التعديل" : "تمت الإضافة" }); setForm({ ...empty }); refresh() },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "تعذر الحفظ", variant: "destructive" }),
  })

  const arrivedMut = useMutation({
    mutationFn: (id: string) => markIncomingArrived(id),
    onSuccess: (r) => {
      toast({
        title: r.alreadyArrived ? "مؤشرة كواصلة من قبل" : "تم — البضاعة وصلت",
        description: r.notified > 0 ? `جاري إبلاغ ${r.notified} زبون حجزوا عليها` : undefined,
      })
      refresh()
    },
    onError: () => toast({ title: "تعذر التحديث", variant: "destructive" }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteIncomingItem(id),
    onSuccess: () => { toast({ title: "تم الحذف" }); refresh() },
    onError: () => toast({ title: "تعذر الحذف", variant: "destructive" }),
  })

  /** Base64 like products use, so no file hosting is involved. */
  function readImage(file: File) {
    if (file.size > 1_500_000) {
      toast({ title: "الصورة كبيرة — اختر وحدة أصغر من ١.٥ ميغا", variant: "destructive" })
      return
    }
    const reader = new FileReader()
    reader.onload = () => setForm((f) => ({ ...f, imageUrl: String(reader.result ?? "") }))
    reader.readAsDataURL(file)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ship className="h-5 w-5 text-sky-600" />
            {form.id ? "تعديل مادة قادمة" : "أضف مادة قادمة"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-xl bg-sky-50 px-3 py-2 text-xs text-sky-800">
            هذي مواد اشتريتها وما وصلت بعد. الزبون يشوفها بالكتلوك ويحجز عليها قبل ما تنزل المخزن.
            الحجز ما يسوي طلب ولا فاتورة ولا يمس المخزون — بس يثبّت لك منو يريد وشكد.
          </p>

          <Input placeholder="اسم المادة" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="وصف قصير (اختياري)" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600">تاريخ الوصول المتوقع</label>
              <Input type="date" value={form.expectedAt} dir="ltr"
                onChange={(e) => setForm({ ...form, expectedAt: e.target.value })} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600">السعر (اختياري)</label>
              <Input type="number" value={form.price} dir="ltr"
                onChange={(e) => setForm({ ...form, price: e.target.value })} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {form.imageUrl ? (
              <img src={form.imageUrl} alt="" className="h-16 w-16 rounded-xl border object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100">
                <ImageIcon className="h-6 w-6 text-slate-300" />
              </div>
            )}
            <input type="file" accept="image/*"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) readImage(f) }}
              className="text-xs" />
            {form.imageUrl && (
              <button onClick={() => setForm({ ...form, imageUrl: "" })}
                className="text-xs font-bold text-red-600">شيل الصورة</button>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="h-4 w-4 accent-sky-600" />
            ظاهرة بالكتلوك
          </label>

          <div className="flex gap-2">
            <Button size="sm" className="flex-1"
              disabled={form.name.trim().length < 2 || saveMut.isPending}
              onClick={() => saveMut.mutate()}>
              {saveMut.isPending ? "جاري الحفظ..." : form.id ? "احفظ التعديل" : "أضف"}
            </Button>
            {form.id && (
              <Button size="sm" variant="outline" onClick={() => setForm({ ...empty })}>إلغاء</Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AllReservationsCard />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">المواد القادمة ({items.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {itemsQuery.isLoading && <p className="py-4 text-center text-sm text-slate-400">جاري التحميل...</p>}
          {!itemsQuery.isLoading && items.length === 0 && (
            <p className="py-4 text-center text-sm text-slate-400">ما اكو مواد قادمة</p>
          )}

          {items.map((it: IncomingItem) => (
            <div key={it.id} className={cn(
              "flex items-center gap-3 rounded-xl border p-3",
              it.active ? "bg-white" : "bg-slate-50 opacity-60",
            )}>
              {it.imageUrl ? (
                <img src={it.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                  <ImageIcon className="h-5 w-5 text-slate-300" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-800">{it.name}</p>
                <p className="text-[11px] text-slate-400">
                  {it.expectedAt ? `يوصل ${new Date(it.expectedAt).toLocaleDateString("ar-IQ")}` : "بلا تاريخ"}
                  {it.price != null ? ` · ${it.price.toLocaleString("en-US")} د.ع` : ""}
                  {it.arrivedAt ? " · وصلت" : !it.active ? " · مخفية" : ""}
                </p>
              </div>

              {!it.arrivedAt && (it.reservationCount ?? 0) >= 0 && (
                <button onClick={() => setConfirmArrived(it)}
                  className="shrink-0 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
                  title="وصلت البضاعة">
                  <PackageCheck className="ml-1 inline h-3.5 w-3.5" />
                  وصلت
                </button>
              )}
              <button onClick={() => setOpenReservations(openReservations === it.id ? null : it.id)}
                className="shrink-0 rounded-lg bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700 transition hover:bg-sky-100">
                <Users className="ml-1 inline h-3.5 w-3.5" />
                {it.reservationCount ?? 0}
              </button>
              <button
                onClick={() => setForm({
                  id: it.id,
                  name: it.name,
                  description: it.description ?? "",
                  imageUrl: it.imageUrl ?? "",
                  expectedAt: it.expectedAt ? it.expectedAt.slice(0, 10) : "",
                  price: it.price == null ? "" : String(it.price),
                  active: it.active !== false,
                })}
                className="shrink-0 rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-200">
                تعديل
              </button>
              <button onClick={() => setConfirmDelete(it.id)}
                className="shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}

          {openReservations && <ReservationsList itemId={openReservations} />}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmArrived !== null}
        title="وصلت البضاعة"
        description={
          `راح تنشال «${confirmArrived?.name ?? ""}» من الكتلوك، ويوصل إشعار واتساب لكل زبون حاجز عليها ` +
          "إن بضاعته وصلت. ما تنسوي طلبات ولا فواتير — الزبون يطلب بنفسه."
        }
        confirmLabel="أكّد الوصول"
        loading={arrivedMut.isPending}
        onConfirm={() => { const it = confirmArrived; setConfirmArrived(null); if (it) arrivedMut.mutate(it.id) }}
        onCancel={() => setConfirmArrived(null)}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        title="حذف المادة القادمة"
        description="راح تنحذف المادة وكل الحجوزات عليها. ما ينحذف ولا شي من مخزنك."
        confirmLabel="احذف"
        loading={deleteMut.isPending}
        onConfirm={() => { const id = confirmDelete; setConfirmDelete(null); if (id) deleteMut.mutate(id) }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

function ReservationsList({ itemId }: { itemId: string }) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ["incoming-reservations", itemId],
    queryFn: () => listIncomingReservations(itemId),
  })

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: "PENDING" | "CONFIRMED" | "CANCELLED" }) =>
      setIncomingReservationStatus(v.id, v.status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["incoming-reservations", itemId] })
      void qc.invalidateQueries({ queryKey: ["incoming-items"] })
    },
    onError: () => toast({ title: "تعذر التحديث", variant: "destructive" }),
  })

  const rows = query.data ?? []

  return (
    <div className="space-y-1.5 rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-bold text-slate-600">الحجوزات</p>
      {rows.length === 0 && <p className="text-xs text-slate-400">ما اكو حجوزات بعد</p>}
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-slate-700">{r.name || "بلا اسم"}</p>
            <p className="text-[11px] text-slate-400" dir="ltr">{r.phone}</p>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
            {r.quantity}
          </span>
          <span className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
            r.status === "CONFIRMED" ? "bg-emerald-50 text-emerald-700"
              : r.status === "CANCELLED" ? "bg-red-50 text-red-600"
                : "bg-amber-50 text-amber-700",
          )}>
            {r.status === "CONFIRMED" ? "مؤكد" : r.status === "CANCELLED" ? "ملغى" : "معلّق"}
          </span>
          {r.status !== "CONFIRMED" && (
            <button onClick={() => statusMut.mutate({ id: r.id, status: "CONFIRMED" })}
              className="shrink-0 text-xs font-bold text-emerald-700">أكّد</button>
          )}
          {r.status !== "CANCELLED" && (
            <button onClick={() => statusMut.mutate({ id: r.id, status: "CANCELLED" })}
              className="shrink-0 text-xs font-bold text-red-600">ألغِ</button>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * Every reservation in one list, pending first.
 *
 * The per-item list answers "who wants this"; this answers "who is waiting on
 * me" — the question the merchant actually arrives with, and one that used to
 * need opening each item in turn.
 */
function AllReservationsCard() {
  const qc = useQueryClient()
  const [onlyPending, setOnlyPending] = useState(true)

  const query = useQuery({
    queryKey: ["all-reservations", onlyPending],
    queryFn: () => listAllReservations(onlyPending ? "PENDING" : undefined),
  })
  const rows = query.data ?? []

  const statusMut = useMutation({
    mutationFn: (v: { id: string; status: "CONFIRMED" | "CANCELLED" }) =>
      setIncomingReservationStatus(v.id, v.status),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["all-reservations"] })
      void qc.invalidateQueries({ queryKey: ["incoming-items"] })
      void qc.invalidateQueries({ queryKey: ["catalog-dashboard"] })
    },
    onError: () => toast({ title: "تعذر التحديث", variant: "destructive" }),
  })

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Users className="h-5 w-5 text-amber-600" />
            الحجوزات ({rows.length})
          </span>
          <button onClick={() => setOnlyPending((v) => !v)}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:bg-slate-200">
            {onlyPending ? "أظهر الكل" : "المعلّقة فقط"}
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {query.isLoading && <p className="py-3 text-center text-sm text-slate-400">جاري التحميل...</p>}
        {!query.isLoading && rows.length === 0 && (
          <p className="py-3 text-center text-sm text-slate-400">
            {onlyPending ? "ما اكو حجوزات معلّقة" : "ما اكو حجوزات"}
          </p>
        )}

        {rows.map((r: ReservationRow) => (
          <div key={r.id} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-800">{r.itemName}</p>
              <p className="truncate text-[11px] text-slate-400">
                {r.name || "بلا اسم"} · <span dir="ltr">{r.phone}</span>
                {r.itemArrived ? " · وصلت" : ""}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
              {r.quantity}
            </span>
            <span className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold",
              r.status === "CONFIRMED" ? "bg-emerald-50 text-emerald-700"
                : r.status === "CANCELLED" ? "bg-red-50 text-red-600"
                  : "bg-amber-50 text-amber-700",
            )}>
              {r.status === "CONFIRMED" ? "مؤكد" : r.status === "CANCELLED" ? "ملغى" : "معلّق"}
            </span>
            {r.status !== "CONFIRMED" && (
              <button onClick={() => statusMut.mutate({ id: r.id, status: "CONFIRMED" })}
                className="shrink-0 text-xs font-bold text-emerald-700">أكّد</button>
            )}
            {r.status !== "CANCELLED" && (
              <button onClick={() => statusMut.mutate({ id: r.id, status: "CANCELLED" })}
                className="shrink-0 text-xs font-bold text-red-600">ألغِ</button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
