import { useQuery } from "@tanstack/react-query"
import { ClipboardList, PackageCheck, Ship, Tag, UserPlus, Users } from "lucide-react"
import { getCatalogDashboard } from "../api/endpoints"
import { Card, CardContent } from "./ui/card"
import { cn } from "../utils/cn"

/* ══════════════════════════════════════════════════════════════════════
   The catalog home screen.

   Every tile is someone waiting on the merchant, not a vanity number.
   Opening this should answer "what do I have to do today" — which nine tabs
   of settings could not, and which is why the screen felt unusable.
══════════════════════════════════════════════════════════════════════ */

type TabKey =
  | "accounts" | "incoming" | "visitors" | "settings"

export function CatalogHomeTab({ onGo }: { onGo: (group: string, tab: TabKey) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["catalog-dashboard"],
    queryFn: getCatalogDashboard,
    refetchInterval: 60_000,
  })

  const tiles: Array<{
    key: string
    label: string
    hint: string
    value: number
    icon: React.ReactNode
    tone: "amber" | "sky" | "slate" | "emerald"
    go: () => void
  }> = [
    {
      key: "priceRequests",
      label: "يطلبون فتح الأسعار",
      hint: "زائر ضغط «اطلب عرض سعر» وينتظر جوابك",
      value: data?.priceRequests ?? 0,
      icon: <Tag className="h-5 w-5" />,
      tone: "amber",
      go: () => onGo("people", "accounts"),
    },
    {
      key: "reservations",
      label: "حجوزات معلّقة",
      hint: "حجز على بضاعة قادمة ما أكّدته بعد",
      value: data?.reservations ?? 0,
      icon: <Ship className="h-5 w-5" />,
      tone: "sky",
      go: () => onGo("content", "incoming"),
    },
    {
      key: "pendingOrders",
      label: "طلبات تنتظر موافقتك",
      hint: "طلبات وصلت من الكتلوك",
      value: data?.pendingOrders ?? 0,
      icon: <ClipboardList className="h-5 w-5" />,
      tone: "emerald",
      go: () => onGo("people", "accounts"),
    },
    {
      key: "customersNoCode",
      label: "زبائن بلا رمز دخول",
      hint: "ما يقدرون يدخلون المتجر لحد ما ترسلهم",
      value: data?.customersNoCode ?? 0,
      icon: <UserPlus className="h-5 w-5" />,
      tone: "slate",
      go: () => onGo("people", "accounts"),
    },
    {
      key: "visitorsToday",
      label: "زوار آخر ٢٤ ساعة",
      hint: "أرقام تصفحت الكتلوك اليوم",
      value: data?.visitorsToday ?? 0,
      icon: <Users className="h-5 w-5" />,
      tone: "slate",
      go: () => onGo("people", "accounts"),
    },
    {
      key: "incomingItems",
      label: "بضاعة قادمة معروضة",
      hint: "مواد يحجزون عليها الآن",
      value: data?.incomingItems ?? 0,
      icon: <PackageCheck className="h-5 w-5" />,
      tone: "sky",
      go: () => onGo("content", "incoming"),
    },
  ]

  const tones = {
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    sky: "bg-sky-50 text-sky-700 ring-sky-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    slate: "bg-slate-50 text-slate-600 ring-slate-200",
  }

  // Anything with someone waiting on it comes first, so the screen reorders
  // itself around whatever actually needs the merchant today.
  const sorted = [...tiles].sort((a, b) => Number(b.value > 0) - Number(a.value > 0))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {sorted.map((t) => (
          <button key={t.key} onClick={t.go}
            className={cn(
              "rounded-2xl p-4 text-right ring-1 transition hover:shadow-sm active:scale-[0.99]",
              tones[t.tone],
              t.value > 0 ? "" : "opacity-60",
            )}>
            <div className="flex items-start justify-between gap-2">
              {t.icon}
              <span className="text-2xl font-extrabold">
                {isLoading ? "…" : t.value}
              </span>
            </div>
            <p className="mt-2 text-sm font-bold">{t.label}</p>
            <p className="mt-0.5 text-[11px] opacity-80">{t.hint}</p>
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="py-3 text-xs leading-relaxed text-slate-500">
          الأرقام تتحدث كل دقيقة. اضغط أي بطاقة توديك للمكان الي تتصرف منه.
          البطاقات الي ما بيها أحد ينتظرك تنزل للآخر لحالها.
        </CardContent>
      </Card>
    </div>
  )
}
