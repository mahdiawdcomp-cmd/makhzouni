import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ImageOff, Link2, Lock, Package, RotateCcw, Shuffle, ShieldOff, Sliders, Sparkles, Truck, Gift } from "lucide-react"
import { getSettings, updateSettings, applyPricesDefaultToAll } from "../api/endpoints"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { toast } from "./ui/use-toast"
import { StorefrontInviteCard } from "./StorefrontInviteCard"
import { MarketingOptOutCard } from "./MarketingOptOutCard"
import { cn } from "../utils/cn"
import { IRAQI_GOVERNORATES, DEFAULT_NORTH_GOVERNORATES } from "../utils/governorates"

/* ══════════════════════════════════════════════════════════════════════
   One place for the catalog switches that used to be scattered: two on
   the general settings page, three loose above these tabs.

   Nothing was removed from the general settings page — the same setting
   keys are edited from both, so an existing habit keeps working.
══════════════════════════════════════════════════════════════════════ */

function Row({
  icon, title, description, children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          {icon}
          {title}
        </p>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function CatalogSettingsTab() {
  const qc = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: getSettings })

  // Shop-wide defaults the per-person overrides fall back to. Named the same
  // as on the people screen they came from, so the two read alike.
  const requireLogin = settingsQuery.data?.catalogRequireLogin === true
  const pricesVisible = settingsQuery.data?.catalogPricesVisibleByDefault !== false
  const guestPrices = settingsQuery.data?.catalogGuestPricesVisible === true
  const settingsMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateSettings(patch),
    onSuccess: () => { toast({ title: "تم الحفظ" }); void qc.invalidateQueries({ queryKey: ["settings"] }) },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })
  const applyDefaultMut = useMutation({
    mutationFn: applyPricesDefaultToAll,
    onSuccess: (r) => toast({ title: r.visible ? "الأسعار ظاهرة الآن لكل الزبائن" : "الأسعار مخفية الآن عن الجميع" }),
    onError: () => toast({ title: "تعذر التطبيق", variant: "destructive" }),
  })
  const s = settingsQuery.data

  // Text fields are drafts so a background refetch never overwrites typing.
  // Each field gets its OWN effect keyed only on its own settings value —
  // a shared effect keyed on all four would clear every draft whenever ANY
  // one of them saves (e.g. clicking "حفظ" next to the free-shipping input
  // would silently wipe an in-progress, unsaved north-governorate selection,
  // since saving invalidates ["settings"] for the whole tab).
  const [publicUrl, setPublicUrl] = useState<string | null>(null)
  const [adminPhone, setAdminPhone] = useState<string | null>(null)
  const [freeShipping, setFreeShipping] = useState<string | null>(null)
  const [arrivalDays, setArrivalDays] = useState<string | null>(null)
  const [northDraft, setNorthDraft] = useState<string[] | null>(null)
  const [couponPercent, setCouponPercent] = useState<string | null>(null)
  const [couponDays, setCouponDays] = useState<string | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the draft once its own save lands
    setCouponPercent(null)
  }, [s?.firstOrderCouponPercent])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the draft once its own save lands
    setCouponDays(null)
  }, [s?.firstOrderCouponDurationDays])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the draft once its own save lands
    setPublicUrl(null)
  }, [s?.catalogPublicUrl])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the draft once its own save lands
    setAdminPhone(null)
  }, [s?.catalogAdminWhatsappNumber])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the draft once its own save lands
    setFreeShipping(null)
  }, [s?.catalogFreeShippingThreshold])
  // catalogNorthGovernorates is an array — React Query hands back a NEW
  // reference on every refetch even when the content is unchanged, so this
  // compares by value instead of depending on the array reference directly.
  const northSignature = JSON.stringify(s?.catalogNorthGovernorates ?? null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the draft once its own save lands
    setNorthDraft(null)
  }, [northSignature])

  const urlValue = publicUrl ?? s?.catalogPublicUrl ?? ""
  const phoneValue = adminPhone ?? s?.catalogAdminWhatsappNumber ?? ""
  const freeShippingValue = freeShipping ?? String(s?.catalogFreeShippingThreshold ?? 1_500_000)
  const arrivalDaysValue = arrivalDays ?? String(s?.catalogNewArrivalDays ?? 10)
  const northValue = northDraft ?? (s?.catalogNorthGovernorates as string[] | undefined) ?? DEFAULT_NORTH_GOVERNORATES
  const couponPercentValue = couponPercent ?? String(s?.firstOrderCouponPercent ?? 5)
  const couponDaysValue = couponDays ?? String(s?.firstOrderCouponDurationDays ?? 7)

  const saveMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateSettings(patch),
    onSuccess: () => {
      toast({ title: "تم حفظ الإعداد" })
      void qc.invalidateQueries({ queryKey: ["settings"] })
    },
    onError: () => toast({ title: "تعذر الحفظ", variant: "destructive" }),
  })

  const shuffleMode = (s?.catalogShuffleMode as "hourly" | "daily" | "off" | undefined) ?? "hourly"
  const shuffleOpts: Array<{ key: "hourly" | "daily" | "off"; label: string }> = [
    { key: "hourly", label: "كل ساعة" },
    { key: "daily", label: "كل يوم" },
    { key: "off", label: "ثابت" },
  ]

  if (settingsQuery.isLoading) {
    return <p className="py-10 text-center text-sm text-slate-400">جاري التحميل...</p>
  }

  return (
    <div className="space-y-4">
      {/* Links the whole feature depends on */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-5 w-5 text-blue-600" />
            الروابط والأرقام
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
            رابط الكتلوك مطلوب لإرسال بيانات الدخول ورسائل الموافقة — بدونه الإرسال يُرفض.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-600">رابط الكتلوك العام</span>
            <div className="flex gap-2">
              <Input
                value={urlValue}
                onChange={(e) => setPublicUrl(e.target.value)}
                placeholder="https://your-shop.com/catalog"
                dir="ltr"
                className="flex-1 text-sm"
              />
              <Button
                onClick={() => saveMut.mutate({ catalogPublicUrl: urlValue.trim() })}
                disabled={saveMut.isPending || publicUrl === null}
                className="shrink-0"
              >
                حفظ
              </Button>
            </div>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-600">
              رقمك الخاص لاستقبال طلبات الكتلوك
            </span>
            <div className="flex gap-2">
              <Input
                value={phoneValue}
                onChange={(e) => setAdminPhone(e.target.value)}
                placeholder="9647xxxxxxxx"
                dir="ltr"
                className="flex-1 text-sm"
              />
              <Button
                onClick={() => saveMut.mutate({ catalogAdminWhatsappNumber: phoneValue.trim() })}
                disabled={saveMut.isPending || adminPhone === null}
                className="shrink-0"
              >
                حفظ
              </Button>
            </div>
          </label>

          <p className="text-[11px] text-slate-400">
            نفس الحقلين موجودان بصفحة الإعدادات العامة — التعديل من أي مكان يوصل لنفس المكان.
          </p>
        </CardContent>
      </Card>

      {/* Browsing rules */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sliders className="h-5 w-5 text-violet-600" />
            قواعد التصفح والعرض
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Row
            icon={<ShieldOff className="h-4 w-4 text-slate-500" />}
            title="التحقق برمز واتساب عند الدخول"
            description="عند إيقافه يصير الرابط مفتوح للجميع بدون رقم أو رمز — الزائر يتصفح بدون أسعار وله زر لطلب تفعيلها. لا أثر له إذا «إلزام تسجيل الدخول» مشغّل من تبويب حسابات الدخول."
          >
            <input
              type="checkbox"
              checked={s?.catalogRequireOtp !== false}
              disabled={saveMut.isPending}
              onChange={(e) => saveMut.mutate({ catalogRequireOtp: e.target.checked })}
              className="h-4 w-4 accent-blue-600"
            />
          </Row>

          <Row
            icon={<Package className="h-4 w-4 text-slate-500" />}
            title="اعرض الكرتون الكامل فقط"
            description="عند تشغيله، المنتج اللي ما عنده كارتون كامل بالمخزون ما يظهر بالكتلوك إطلاقاً — حتى لو بقى منه قطع."
          >
            <input
              type="checkbox"
              checked={s?.catalogFullCartonOnly === true}
              disabled={saveMut.isPending}
              onChange={(e) => saveMut.mutate({ catalogFullCartonOnly: e.target.checked })}
              className="h-4 w-4 accent-emerald-600"
            />
          </Row>

          <Row
            icon={<ImageOff className="h-4 w-4 text-slate-500" />}
            title="خفِّ المواد الي بلا صورة"
            description="واجهة أنظف: المادة بلا صورة ما تظهر بالعرض. مو حذف — الزبون يقدر يظهرها لنفسه من «تخصيص المظهر» داخل المتجر."
          >
            <input
              type="checkbox"
              checked={s?.catalogHideNoImage === true}
              disabled={saveMut.isPending}
              onChange={(e) => saveMut.mutate({ catalogHideNoImage: e.target.checked })}
              className="h-4 w-4 accent-emerald-600"
            />
          </Row>

          <Row
            icon={<Sparkles className="h-4 w-4 text-slate-500" />}
            title="مدة «وصلت هسه» بالأيام"
            description="زر بالمتجر يعرض بس البضاعة المضافة بهذي المدة. صفر يطفي الزر. الزر ما يظهر أصلاً إذا ما اكو بضاعة جديدة."
          >
            <div className="flex shrink-0 gap-2">
              <Input
                type="number"
                min={0}
                max={365}
                value={arrivalDaysValue}
                onChange={(e) => setArrivalDays(e.target.value)}
                dir="ltr"
                className="w-20 text-sm"
              />
              <Button
                onClick={() => saveMut.mutate({ catalogNewArrivalDays: Math.max(0, Math.min(365, Number(arrivalDaysValue) || 0)) })}
                disabled={saveMut.isPending || arrivalDays === null}
                className="shrink-0"
              >
                حفظ
              </Button>
            </div>
          </Row>

          <Row
            icon={<Shuffle className="h-4 w-4 text-slate-500" />}
            title="تبديل ترتيب عرض البضاعة"
            description="يعيد ترتيب المنتجات لكل الزبائن على نفس الفترة، حتى تاخذ كل البضاعة فرصة بالواجهة. «ثابت» يبقيها بالترتيب الأبجدي."
          >
            <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm">
              {shuffleOpts.map((o) => (
                <button
                  key={o.key}
                  disabled={saveMut.isPending}
                  onClick={() => saveMut.mutate({ catalogShuffleMode: o.key })}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                    shuffleMode === o.key ? "bg-blue-600 text-white" : "text-slate-500 hover:text-slate-700",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </Row>
        </CardContent>
      </Card>

      {/* بند ٤ — التوصيل: جملة واحدة حسب محافظة الزبون، بدون تفاصيل تدوّخه */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="h-5 w-5 text-emerald-600" />
            التوصيل
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            الزبون المسجّل يشوف جملة واحدة حسب محافظته: مجاني فوق الحد أدناه لمحافظات وسط/جنوب/غرب، أو
            «حسب البضاعة» لمحافظات الشمال. تحدَّد المحافظة من ملف الزبون.
          </p>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-slate-600">حد الشحن المجاني (دينار) — وسط/جنوب/غرب</span>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                value={freeShippingValue}
                onChange={(e) => setFreeShipping(e.target.value)}
                dir="ltr"
                className="flex-1 text-sm"
              />
              <Button
                onClick={() => saveMut.mutate({ catalogFreeShippingThreshold: Number(freeShippingValue) || 0 })}
                disabled={saveMut.isPending || freeShipping === null}
                className="shrink-0"
              >
                حفظ
              </Button>
            </div>
          </label>

          <div className="space-y-1.5">
            <span className="text-xs font-semibold text-slate-600">
              محافظات الشمال (توصيل حسب البضاعة) — الباقي وسط/جنوب/غرب تلقائياً
            </span>
            <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-3">
              {IRAQI_GOVERNORATES.map((g) => {
                const checked = northValue.includes(g)
                return (
                  <label
                    key={g}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                      checked ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 text-slate-600 hover:border-slate-300",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...northValue, g]
                          : northValue.filter((x) => x !== g)
                        setNorthDraft(next)
                      }}
                      className="h-3.5 w-3.5 accent-amber-600"
                    />
                    {g}
                  </label>
                )
              })}
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => saveMut.mutate({ catalogNorthGovernorates: northValue })}
                disabled={saveMut.isPending || northDraft === null}
                className="shrink-0"
              >
                حفظ خارطة المناطق
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* بند ٧ — كوبون أول طلب: يصدر تلقائياً عند الموافقة على زبون جديد */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gift className="h-5 w-5 text-rose-600" />
            كوبون أول طلب
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800">
            يُصدر تلقائياً لكل زبون جديد عند الموافقة عليه، ويُرسل ضمن رسالة رمز الدخول نفسها. استخدام واحد فقط لكل كوبون.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-600">نسبة الخصم (%)</span>
              <div className="flex gap-2">
                <Input
                  type="number" min={0} max={100}
                  value={couponPercentValue}
                  onChange={(e) => setCouponPercent(e.target.value)}
                  dir="ltr" className="flex-1 text-sm"
                />
                <Button
                  onClick={() => saveMut.mutate({ firstOrderCouponPercent: Number(couponPercentValue) || 0 })}
                  disabled={saveMut.isPending || couponPercent === null}
                  className="shrink-0"
                >
                  حفظ
                </Button>
              </div>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-600">مدة الصلاحية (أيام)</span>
              <div className="flex gap-2">
                <Input
                  type="number" min={1}
                  value={couponDaysValue}
                  onChange={(e) => setCouponDays(e.target.value)}
                  dir="ltr" className="flex-1 text-sm"
                />
                <Button
                  onClick={() => saveMut.mutate({ firstOrderCouponDurationDays: Number(couponDaysValue) || 1 })}
                  disabled={saveMut.isPending || couponDays === null}
                  className="shrink-0"
                >
                  حفظ
                </Button>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4">
          <p className="text-xs text-slate-500">
            بقية إعدادات الكتلوك موزعة على تبويباتها حسب موضوعها:
            <br />
            <strong>التصميم</strong> — الألوان والشعار والبانر والفوتر وشارات الثقة.
            <br />
            <strong>محتوى المنتجات</strong> — الوصف والمواصفات والصور وتقييمات الزبائن.
            <br />
            <strong>حسابات الدخول</strong> — إلزام الدخول، إظهار الأسعار، قوالب الرسائل، وإيقاف الإعلانات.
          </p>
        </CardContent>
      </Card>
    
      {/* Shop-wide login and price rules. Per-person overrides live on the
          people screen; this is the default they fall back to. */}
  {/* Login + pricing rules for the whole shop */}
  <Card>
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-base">
        <Lock className="h-5 w-5 text-slate-600" />
        قواعد الدخول والأسعار
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      {/* One switch for one decision. Free browsing used to be split across
          catalogRequireLogin and catalogRequireOtp, which could disagree — so
          the merchant flipped one and nothing appeared to happen. */}
      <label className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
        <input type="checkbox"
          checked={!requireLogin && settingsQuery.data?.catalogRequireOtp === false}
          onChange={(e) => settingsMut.mutate(
            e.target.checked
              ? { catalogRequireLogin: false, catalogRequireOtp: false }
              : { catalogRequireLogin: true },
          )}
          className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
        <span>
          <span className="block text-sm font-bold text-slate-800">التصفح الحر</span>
          <span className="block text-xs text-slate-500">
            أي واحد يتصفح بلا رمز، ويعطي بياناته وقت الطلب. الأسعار تبقى محمية بقواعدها تحت.
          </span>
        </span>
      </label>

      <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-3">
        <input type="checkbox"
          checked={settingsQuery.data?.catalogGuestPhoneGate !== false}
          onChange={(e) => settingsMut.mutate({ catalogGuestPhoneGate: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0 accent-slate-700" />
        <span>
          <span className="block text-sm font-bold text-slate-800">اطلب بياناته قبل التصفح</span>
          <span className="block text-xs text-slate-500">
            نافذة تسأل الاسم والرقم والمحافظة قبل ما يشوف البضاعة — تجمعلك زبائن بأسماء مو أرقام،
            بس توقّف الي ما عنده صبر عند الباب. إطفاؤه يخليهم يتصفحون فوراً ويعطون بياناتهم وقت الطلب.
          </span>
        </span>
      </label>

      <div className="rounded-xl border border-slate-200 p-3">
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={pricesVisible}
            onChange={(e) => settingsMut.mutate({ catalogPricesVisibleByDefault: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
          <span>
            <span className="block text-sm font-bold text-slate-800">إظهار الأسعار لأصحاب الحسابات</span>
            <span className="block text-xs text-slate-500">
              الافتراضي لكل زبون أو زائر داخل بحسابه. مفتاح «إخفاء السعر» بجنب أي زبون يتجاوز هذا الإعداد له وحده.
              الزائر بلا حساب ما يشمله هذا المفتاح — إله مفتاحه تحت.
            </span>
          </span>
        </label>
        <Button
          variant="outline"
          className="mt-2 w-full"
          disabled={applyDefaultMut.isPending}
          onClick={() => applyDefaultMut.mutate()}
        >
          <RotateCcw className="ml-1 h-4 w-4" />
          {applyDefaultMut.isPending ? "جاري التطبيق..." : "طبّق على الزبائن الحاليين الآن"}
        </Button>
        <p className="mt-1 text-[11px] text-slate-400">
          بدون هذا الزر، التغيير يوصل الزبون عند تسجيل دخوله الجاي فقط.
        </p>

        <label className="mt-3 flex items-start gap-3 border-t border-slate-200 pt-3">
          <input type="checkbox" checked={guestPrices}
            onChange={(e) => settingsMut.mutate({ catalogGuestPricesVisible: e.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600" />
          <span>
            <span className="block text-sm font-bold text-slate-800">إظهار الأسعار للزائر بلا حساب</span>
            <span className="block text-xs text-slate-500">
              يشتغل بس إذا «التصفح الحر» مشغّل. أي واحد يفتح الرابط يشوف أسعارك — زبون، ومنافس، وأي شخص
              ينوصله الرابط. شغّله إذا أسعارك معلنة أصلاً، وخلّه مطفي إذا أسعار الجملة مالتك خاصة.
            </span>
          </span>
        </label>
      </div>
    </CardContent>
  </Card>

      <StorefrontInviteCard />

      <MarketingOptOutCard />
    </div>
  )
}
