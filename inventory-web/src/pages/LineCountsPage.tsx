// «جرد بالسطور» — its own sidebar page: pick a warehouse, start a count,
// share the worker link, open reviews. Same panel as the warehouse page.
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { getBranches } from "../api/endpoints"
import { LineCountPanel } from "../components/LineCountPanel"
import { useReadOnly } from "../hooks/useTenantConfig"
import { usePageTitle } from "../hooks/usePageTitle"

export function LineCountsPage() {
  usePageTitle("جرد بالسطور")
  const readOnly = useReadOnly()
  const branchesQ = useQuery({ queryKey: ["branches", "all-for-nav"], queryFn: () => getBranches() })
  const warehouses = (branchesQ.data ?? []).filter((b) => b.isActive)
  const [picked, setPicked] = useState("")
  const warehouseId = picked || warehouses[0]?.id || ""

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">جرد بالسطور</h1>
        <label className="flex items-center gap-2 text-sm">
          المخزن
          <select
            value={warehouseId}
            onChange={(e) => setPicked(e.target.value)}
            className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </label>
      </div>
      {branchesQ.isLoading && <p className="text-sm text-slate-500">جاري التحميل…</p>}
      {warehouseId && <LineCountPanel key={warehouseId} warehouseId={warehouseId} readOnly={readOnly} />}
    </div>
  )
}
