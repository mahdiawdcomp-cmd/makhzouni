import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronLeft, ChevronRight, Loader2, Receipt, UserPlus } from "lucide-react"
import { api } from "../../api/client"
import { Button } from "../../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card"
import { Input } from "../../components/ui/input"
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/table"
import { toast } from "../../components/ui/use-toast"
import { QueryErrorBox } from "../../components/ui/query-error"
import { apiErrorMessage } from "../../utils/apiError"
import { openExternalUrl } from "../../utils/download"
import { cn } from "../../utils/cn"
import { money } from "./format"
import { ShopLocationPicker, type AreaOption, type ShopPoint } from "./ShopLocationPicker"
import type { AgentLocation } from "../../utils/agentLocation"
import type { FollowUpReason } from "./types"
import type { PhoneLookup } from "./model"
import { Field, StatusPill, Waiting } from "./ui"
import { useMyCustomers } from "./hooks"

/**
 * The reasons this customer needs following up, as the server stated them.
 *
 * Wording comes from the server so «عليه رصيد» cannot quietly become «متأخر
 * بالدفع» on one screen: no due date is recorded anywhere in this system, so
 * nothing may claim a payment is late.
 */
function FollowUpReasons({ reasons }: { reasons?: FollowUpReason[] }) {
  if (!reasons || reasons.length === 0) return null
  const tone = (code: FollowUpReason["code"]) =>
    code === "ORDER_REJECTED" ? "bad" : code === "OFFER_ENDING" ? "ok" : "wait"
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {reasons.map((reason) => (
        <StatusPill key={reason.code} tone={tone(reason.code)}>
          {reason.label}
          {reason.detail ? ` · ${reason.detail}` : ""}
        </StatusPill>
      ))}
    </div>
  )
}

/**
 * Call, WhatsApp and open-on-the-map.
 *
 * Links only: nothing here sends a message by itself. The rep taps, their phone
 * opens, and they decide what to say.
 */
function CustomerQuickActions({
  phone,
  name,
  address,
  inline = false,
}: {
  phone: string
  name: string
  address?: string | null
  inline?: boolean
}) {
  const digits = phone.replace(/\D/g, "")
  const wa = digits.replace(/^0/, "964")
  const mapQuery = encodeURIComponent([name, address].filter(Boolean).join(" "))
  return (
    <div className={cn("flex flex-wrap gap-1.5", !inline && "mt-2")}>
      {/* In the desktop shell a link out of the app opens nothing on its own —
          every one of these has to go through the OS. */}
      <Button size="sm" variant="outline" className="h-11" onClick={() => void openExternalUrl(`tel:${phone}`)}>اتصال</Button>
      <Button size="sm" variant="outline" className="h-11" onClick={() => void openExternalUrl(`https://wa.me/${wa}`)}>واتساب</Button>
      {(address || name) && (
        <Button
          size="sm"
          variant="outline"
          className="h-11"
          onClick={() => void openExternalUrl(`https://www.google.com/maps/search/?api=1&query=${mapQuery}`)}
        >
          موقعه
        </Button>
      )}
    </div>
  )
}

export function CustomersScreen({
  canCreate,
  currentId,
  areas,
  onPick,
  onNew,
  onOpenStatement,
}: {
  canCreate: boolean
  currentId: string | null
  areas: string[]
  onPick: (id: string) => void
  onNew: () => void
  onOpenStatement: (id: string) => void
}) {
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [followUp, setFollowUp] = useState("")
  const [area, setArea] = useState("")
  // «يحتاجون متابعة فقط» is a SERVER filter (`needsFollowUp`) applied before
  // pagination: never bought, quiet past the shop's setting, positive balance,
  // one of this rep's own pending/refused orders, or an offer about to end.
  // It used to narrow the already-fetched page, which hid customers on later
  // pages and left `total` describing a list the screen did not show.
  const [onlyNeedy, setOnlyNeedy] = useState(false)
  const customers = useMyCustomers(search, page, followUp, area, onlyNeedy)
  const rows = customers.data?.customers ?? []
  const quietDays = customers.data?.quietDays ?? 30
  const pages = Math.max(1, Math.ceil((customers.data?.total ?? 0) / (customers.data?.limit || 200)))

  if (customers.error) {
    return <QueryErrorBox title="ما وصلت قائمة الزبائن" onRetry={() => void customers.refetch()} />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>زبائني</CardTitle>
        <Button disabled={!canCreate} className="h-11" onClick={onNew}>
          <UserPlus className="h-4 w-4" /> زبون جديد
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2" aria-label="زبائن يحتاجون متابعة">
          {([["", "كل زبائني"], ["quiet", `ما اشترى من ${quietDays} يوم`], ["balance", "عليهم رصيد"], ["never", "ما اشتروا بعد"]] as const).map(([value, label]) => <Button key={value} className="h-11" variant={followUp === value ? "default" : "outline"} onClick={() => { setFollowUp(value); setPage(1) }}>{label}</Button>)}
          <Button className="h-11" variant={onlyNeedy ? "default" : "outline"} onClick={() => { setOnlyNeedy(v => !v); setPage(1) }}>يحتاجون متابعة فقط</Button>
        </div>
        {areas.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="فلترة حسب المنطقة">
            {[["", "كل المناطق"], ...areas.map(a => [a, a] as const)].map(([value, label]) => (
              <Button key={String(value)} className="h-11" variant={area === value ? "default" : "outline"} onClick={() => { setArea(String(value)); setPage(1) }}>{label}</Button>
            ))}
          </div>
        )}
        {/* «مدة عدم الشراء» is the shop's own `inactiveCustomerDays` setting, not
            a number typed into this screen. */}
        {followUp === "quiet" && <p className="text-xs text-slate-500">المدة من إعدادات المحل ({quietDays} يوم)، مو رقم ثابت بالشاشة.</p>}
        {followUp === "balance" && <p className="text-xs text-slate-500">أرصدة موجبة على الزبائن؛ ليست بالضرورة ديوناً متأخرة عن موعد استحقاق.</p>}
        {onlyNeedy && <p className="text-xs text-slate-500">الفلترة من السيرفر قبل تقسيم الصفحات — العدد والترقيم يعكسان النتائج المفلترة، والأسباب معروضة بجانب كل زبون.</p>}
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="بحث بالاسم أو الهاتف"
          aria-label="بحث عن زبون"
          className="h-11"
        />

        {customers.isPending ? (
          <Waiting q={customers} />
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            {followUp || search ? "ماكو زبائن مطابقين لهذا الفلتر." : "ما عندك زبائن بعد. أضف زبون جديد من الزر فوق."}
          </p>
        ) : (
          <>
            {/* Phone: the same fields as the table, stacked.
                A five-column table on a 375px screen scrolls sideways, and the
                two buttons — the whole point of the row — end up off the edge
                where the rep never finds them. Same components and colours as
                the table below it, just not forced into a horizontal scroll. */}
            <ul className="space-y-2 sm:hidden">
              {rows.map((c) => {
                const quiet = c.daysSinceLastSale != null && c.daysSinceLastSale >= quietDays
                return (
                  <li
                    key={c.id}
                    className={cn(
                      "rounded-lg border p-3",
                      c.id === currentId && "bg-[var(--theme-accentSoft)]",
                    )}
                    style={{ borderColor: "var(--theme-cardBorder)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 font-medium">
                          {c.name}
                          {c.id === currentId && (
                            <Check className="h-3.5 w-3.5 shrink-0 text-[var(--theme-accent)]" />
                          )}
                        </p>
                        <p className="text-[12px] text-slate-500 tabular-nums" dir="ltr">
                          {c.phone}
                        </p>
                      </div>
                      <span className="shrink-0 font-medium tabular-nums">
                        {money(c.currentBalance)}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {c.area && <StatusPill tone="muted">{c.area}</StatusPill>}
                      {c.daysSinceLastSale === null ? (
                        <StatusPill tone="muted">ما اشترى</StatusPill>
                      ) : quiet ? (
                        <StatusPill tone="wait">من {c.daysSinceLastSale} يوم</StatusPill>
                      ) : null}
                    </div>

                    {/* WHY this customer needs a call, next to their name — a
                        bare list of names tells the rep nothing. */}
                    <FollowUpReasons reasons={c.followUpReasons} />

                    <div className="mt-3 flex gap-2">
                      <Button className="h-11 flex-1" onClick={() => onPick(c.id)}>
                        بيع
                      </Button>
                      <Button
                        variant="outline"
                        className="h-11 flex-1"
                        onClick={() => onOpenStatement(c.id)}
                      >
                        <Receipt className="h-4 w-4" /> كشف الحساب
                      </Button>
                    </div>
                    <CustomerQuickActions phone={c.phone} name={c.name} address={c.address} />
                  </li>
                )
              })}
            </ul>

            <div className="hidden sm:block">
          <Table>
            <THead>
              <TR>
                <TH>الزبون</TH>
                <TH>الهاتف</TH>
                <TH>الرصيد</TH>
                <TH>آخر شراء</TH>
                <TH>الإجراء</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((c) => {
                const quiet = c.daysSinceLastSale != null && c.daysSinceLastSale >= quietDays
                return (
                  <TR key={c.id} className={c.id === currentId ? "bg-[var(--theme-accentSoft)]" : ""}>
                    <TD>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                        {c.id === currentId && (
                          <Check className="h-3.5 w-3.5 text-[var(--theme-accent)]" />
                        )}
                      </div>
                      {c.area && <span className="text-[12px] text-slate-500">{c.area}</span>}
                      <FollowUpReasons reasons={c.followUpReasons} />
                    </TD>
                    <TD>
                      <span className="tabular-nums" dir="ltr">{c.phone}</span>
                    </TD>
                    <TD className="font-medium tabular-nums">{money(c.currentBalance)}</TD>
                    <TD>
                      {/* Quiet customers are the ones worth a visit, so they say
                          so on the row rather than hiding in a report. */}
                      {c.daysSinceLastSale === null ? (
                        <StatusPill tone="muted">ما اشترى</StatusPill>
                      ) : quiet ? (
                        <StatusPill tone="wait">من {c.daysSinceLastSale} يوم</StatusPill>
                      ) : (
                        <span className="text-[12px] text-slate-500 tabular-nums">
                          قبل {c.daysSinceLastSale} يوم
                        </span>
                      )}
                    </TD>
                    <TD>
                      {/* The table starts at 640px, so an iPad gets it too —
                          and these two, the buttons the rep taps all day, were
                          28px there. Full touch height until a real desktop. */}
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" className="h-11" onClick={() => onPick(c.id)}>
                          بيع
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-11"
                          onClick={() => onOpenStatement(c.id)}
                        >
                          <Receipt className="h-3.5 w-3.5" /> كشف
                        </Button>
                        <CustomerQuickActions phone={c.phone} name={c.name} address={c.address} inline />
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
            </div>
          </>
        )}

        {(page > 1 || customers.data?.hasMore) && (
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronRight className="h-4 w-4" /> السابق
            </Button>
            <span className="text-[13px] text-slate-500 tabular-nums">
              {page} / {pages}
            </span>
            <Button variant="outline" disabled={!customers.data?.hasMore} onClick={() => setPage((p) => p + 1)}>
              التالي <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * New customer, with the duplicate check that has to happen BEFORE the save.
 *
 * The rep types a phone; the moment they leave the field the server is asked
 * whether that number is already known. Four answers, four different next steps.
 */
export function NewCustomerScreen({
  onDone,
  onCancel,
}: {
  onDone: (customerId: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [lookup, setLookup] = useState<PhoneLookup | null>(null)
  const qc = useQueryClient()

  // Full rows, not names: the picker needs ids to save the link and centres to
  // suggest an area from the pin.
  const areas = useQuery({
    queryKey: ["sales-agent", "area-rows"],
    queryFn: async () => {
      const res = await api.get<{ data: AreaOption[] }>("/areas", { params: { activeOnly: 1 } })
      return res.data.data ?? []
    },
    staleTime: 30 * 60 * 1000,
  })

  const [point, setPoint] = useState<ShopPoint | null>(null)
  const [areaId, setAreaId] = useState("")
  // The GPS reading that produced the pin, kept so the save carries WHEN it was
  // taken and how precise it was — not re-read at submit time, when the rep may
  // already be back in the car.
  const [located, setLocated] = useState<AgentLocation | null>(null)

  const checkPhone = useMutation({
    mutationFn: async (value: string) => {
      const res = await api.post<{ data: PhoneLookup }>("/sales-agent/customers/lookup", { phone: value })
      return res.data.data
    },
    onSuccess: setLookup,
    onError: () => setLookup(null),
  })

  /**
   * Look the number up while it is being typed, not only on blur.
   *
   * Waiting for blur meant the rep filled the whole form before learning the
   * customer already exists — and if they went straight from the phone field to
   * «احفظ», the check was still in flight while the button read as enabled.
   */
  const checkRef = useRef(checkPhone)
  useEffect(() => { checkRef.current = checkPhone }, [checkPhone])
  useEffect(() => {
    const value = phone.trim()
    if (value.length < 10) return
    const t = setTimeout(() => checkRef.current.mutate(value), 400)
    return () => clearTimeout(t)
  }, [phone])

  const claim = useMutation({
    mutationFn: async (customerId: string) => {
      const res = await api.post("/sales-agent/customers/claim", { customerId })
      return res.data
    },
    onSuccess: (_data, customerId) => {
      toast({ title: "انضاف لزبائنك ✓" })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "customers"] })
      onDone(customerId)
    },
    onError: (err) =>
      toast({ title: "ما انضاف", description: apiErrorMessage(err, "حاول مرة أخرى"), variant: "destructive" }),
  })

  const create = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ data: { id: string } }>("/sales-agent/customers", {
        name,
        phone,
        address: address.trim() || undefined,
        areaId: areaId || undefined,
        // The reading taken when the pin was dropped, with its own timestamp.
        // The server fills the shop position from it and files one stamp.
        location: located ?? undefined,
        latitude: point?.lat,
        longitude: point?.lng,
      })
      return res.data.data
    },
    onSuccess: (data) => {
      toast({ title: "انضاف الزبون ✓", description: "تكدر تبيع له هسه" })
      void qc.invalidateQueries({ queryKey: ["sales-agent", "today"] })
      onDone(data.id)
    },
    onError: (err) =>
      toast({ title: "ما انحفظ", description: apiErrorMessage(err, "تحقق من البيانات"), variant: "destructive" }),
  })

  const blocked = Boolean(lookup?.found && !lookup.claimable && !lookup.mine)
  const canSave =
    name.trim().length > 0 && phone.trim().length > 0 && !lookup?.found && !checkPhone.isPending

  return (
    <Card>
      <CardHeader>
        <CardTitle>زبون جديد</CardTitle>
        <Button variant="outline" onClick={onCancel}>رجوع</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم الزبون">
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-11" />
          </Field>
          <Field label="رقم الهاتف">
            <Input
              value={phone}
              dir="ltr"
              inputMode="tel"
              className="h-11"
              onChange={(e) => {
                setPhone(e.target.value)
                setLookup(null)
              }}
              onBlur={() => {
                if (phone.trim()) checkPhone.mutate(phone.trim())
              }}
              aria-describedby="phone-lookup"
            />
          </Field>
        </div>

        {checkPhone.isPending && (
          <p id="phone-lookup" className="flex items-center gap-2 text-[13px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> جاري التحقق من الرقم…
          </p>
        )}

        {lookup?.found && (
          <div
            className={cn(
              "rounded-lg border p-3",
              blocked
                ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
                : "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
            )}
          >
            <p
              className={cn(
                "text-[13px] font-medium leading-relaxed",
                blocked ? "text-amber-800 dark:text-amber-300" : "text-emerald-800 dark:text-emerald-300",
              )}
            >
              {lookup.message}
            </p>
            {lookup.mine && lookup.id && (
              <Button className="mt-2.5 h-11" onClick={() => onDone(lookup.id as string)}>
                استعمل هذا الزبون
              </Button>
            )}
            {lookup.claimable && lookup.id && (
              <Button
                className="mt-2.5 h-11"
                disabled={claim.isPending}
                onClick={() => claim.mutate(lookup.id as string)}
              >
                {claim.isPending ? "جاري الإضافة…" : "أضفه لزبائني وابدأ البيع"}
              </Button>
            )}
          </div>
        )}

        <Field label="العنوان">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} className="h-11" />
        </Field>

        {/* Position and area together, because the rep is standing in the shop
            exactly once — when they add it. Coming back later to place a pin is
            a trip nobody makes. */}
        <ShopLocationPicker
          point={point}
          onPoint={setPoint}
          areas={areas.data ?? []}
          areaId={areaId}
          onAreaId={setAreaId}
          onLocationRead={setLocated}
        />

        <Button className="h-11" disabled={!canSave || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {create.isPending ? "جاري الحفظ…" : "احفظ وابدأ البيع"}
        </Button>
      </CardContent>
    </Card>
  )
}

/* ── orders ──────────────────────────────────────────────────────────── */
