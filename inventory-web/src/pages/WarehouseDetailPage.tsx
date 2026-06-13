import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Building2, MapPin, Phone } from "lucide-react"
import { useNavigate, useParams } from "react-router-dom"
import { getBranch, getBranches, getBranchSummaries } from "../api/endpoints"
import { RecordNavigator } from "../components/RecordNavigator"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { usePageTitle } from "../hooks/usePageTitle"

export function WarehouseDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const branchQuery = useQuery({ queryKey: ["branches", id], queryFn: () => getBranch(id!), enabled: Boolean(id) })
  const branchesQuery = useQuery({ queryKey: ["branches", "all-for-nav"], queryFn: () => getBranches() })
  const summariesQuery = useQuery({ queryKey: ["branches", "summaries"], queryFn: getBranchSummaries })
  const branch = branchQuery.data
  const summary = summariesQuery.data?.find((row) => row.branch.id === id)
  const orderedIds = useMemo(
    () => [...(branchesQuery.data ?? [])]
      .sort((a, b) => {
        const difference = new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()
        return difference || a.id.localeCompare(b.id)
      })
      .map((row) => row.id),
    [branchesQuery.data],
  )

  usePageTitle(branch ? `مخزن ${branch.name}` : "تفاصيل المخزن")

  if (branchQuery.isLoading) return <div className="text-sm text-slate-500">جاري تحميل المخزن...</div>
  if (!branch) return <div className="text-sm text-slate-500">المخزن غير موجود.</div>

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" className="px-0" onClick={() => navigate("/branches")}>
          <ArrowRight className="h-4 w-4" /> رجوع للمخازن
        </Button>
        <RecordNavigator currentId={id} orderedIds={orderedIds} onNavigate={(target) => navigate(`/branches/${target}`)} noun="مخزن" />
      </div>

      <Card className="border-t-4 border-t-sky-500">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                <Building2 className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold">{branch.name}</h1>
                <p className="mt-1 font-mono text-sm text-slate-500">{branch.code}</p>
              </div>
            </div>
            <Badge variant={branch.isActive ? "success" : "secondary"}>{branch.isActive ? "فعال" : "معطل"}</Badge>
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-600 dark:text-slate-300">
            {branch.phone ? <span className="inline-flex items-center gap-1"><Phone className="h-4 w-4" /> {branch.phone}</span> : null}
            {branch.address ? <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" /> {branch.address}</span> : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric title="المواد" value={summary?.products ?? 0} />
        <Metric title="إجمالي القطع" value={summary?.stock.totalPieces ?? 0} />
        <Metric title="مخزون منخفض" value={summary?.stock.lowStock ?? 0} warning />
        <Metric title="التحويلات" value={(summary?.transfers.in ?? 0) + (summary?.transfers.out ?? 0)} />
      </div>

      <Card>
        <CardHeader><CardTitle>ملخص حركة المخزن</CardTitle></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Metric title="المبيعات" value={summary?.sales.total ?? 0} money />
          <Metric title="المقبوض" value={summary?.sales.paid ?? 0} money />
          <Metric title="المتبقي" value={summary?.sales.remaining ?? 0} money warning />
          <Metric title="المشتريات" value={summary?.purchases.total ?? 0} money />
          <Metric title="سندات القبض" value={summary?.vouchers.receipts ?? 0} money />
          <Metric title="المصاريف" value={summary?.vouchers.expenses ?? 0} money />
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ title, value, money = false, warning = false }: { title: string; value: number; money?: boolean; warning?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-xs text-slate-500">{title}</div>
      <div className={`mt-1 text-xl font-bold ${warning && value > 0 ? "text-amber-600" : "text-slate-900 dark:text-white"}`}>
        {value.toLocaleString("en-US")}{money ? " د.ع" : ""}
      </div>
    </div>
  )
}
