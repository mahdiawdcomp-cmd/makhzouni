import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { deleteCatalogCategory, getCatalogCategories, upsertCatalogCategory } from "../api/endpoints"
import { Button } from "./ui/button"
import { Card, CardContent } from "./ui/card"

// Catalog categories + their types. Used both in Settings and in the inventory
// (products) page so a category/type can be created right where products live.
export function CatalogCategoriesManager() {
  const qc = useQueryClient()
  const { data: cats = [], isLoading } = useQuery({
    queryKey: ["catalog-categories"],
    queryFn: getCatalogCategories,
  })

  const [newName, setNewName] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState<Record<string, string>>({})
  const [newTypeInputs, setNewTypeInputs] = useState<Record<string, string>>({})

  const upsertMut = useMutation({
    mutationFn: ({ name, types }: { name: string; types: string[] }) => upsertCatalogCategory({ name, types }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["catalog-categories"] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCatalogCategory(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["catalog-categories"] }),
  })

  function addCategory() {
    const name = newName.trim()
    if (!name) return
    upsertMut.mutate({ name, types: [] })
    setNewName("")
  }

  function addType(cat: { id: string; name: string; types: string[] }) {
    const raw = (newTypeInputs[cat.id] ?? "").trim()
    if (!raw) return
    const toAdd = raw.split(/[،,]+/).map((t) => t.trim()).filter(Boolean)
    const updated = [...new Set([...cat.types, ...toAdd])]
    upsertMut.mutate({ name: cat.name, types: updated })
    setNewTypeInputs((p) => ({ ...p, [cat.id]: "" }))
  }

  function removeType(cat: { id: string; name: string; types: string[] }, typeToRemove: string) {
    upsertMut.mutate({ name: cat.name, types: cat.types.filter((t) => t !== typeToRemove) })
  }

  function saveCategoryName(cat: { id: string; name: string; types: string[] }) {
    const name = (editingName[cat.id] ?? cat.name).trim()
    if (!name || name === cat.name) { setEditingName((p) => { const n = { ...p }; delete n[cat.id]; return n }); return }
    upsertMut.mutate({ name, types: cat.types })
    setEditingName((p) => { const n = { ...p }; delete n[cat.id]; return n })
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">فئات الكتالوج وأنواعها</h3>
          <p className="text-sm text-slate-500">
            أضف فئة رئيسية ثم اضغط عليها لإضافة أنواعها — تظهر في نموذج المنتج وفي فلتر الكتالوج.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            className="h-9 flex-1 rounded-lg border border-slate-200 px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
            placeholder="اسم الفئة الجديدة (مثال: الأولاد)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCategory()}
          />
          <Button size="sm" disabled={!newName.trim() || upsertMut.isPending} onClick={addCategory}>
            <Plus className="h-4 w-4" /> إضافة فئة
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-slate-400">جاري التحميل...</p>
        ) : (
          <div className="space-y-2">
            {cats.map((cat) => {
              const isExpanded = expandedId === cat.id
              const pendingName = editingName[cat.id] ?? cat.name
              return (
                <div
                  key={cat.id}
                  className={`rounded-xl border transition-all ${isExpanded ? "border-indigo-300 bg-indigo-50/50 dark:border-indigo-700 dark:bg-indigo-950/20" : "border-slate-200 dark:border-slate-700"}`}
                >
                  <div
                    className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2.5"
                    onClick={() => setExpandedId(isExpanded ? null : cat.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-bold text-slate-800 dark:text-slate-200">{cat.name}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 dark:bg-slate-800">
                        {cat.types.length} نوع
                      </span>
                      {!isExpanded && cat.types.slice(0, 4).map((t) => (
                        <span key={t} className="hidden sm:inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[10px] text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">
                          {t}
                        </span>
                      ))}
                      {!isExpanded && cat.types.length > 4 && (
                        <span className="hidden sm:inline-block text-[10px] text-slate-400">+{cat.types.length - 4}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 px-2 text-xs"
                        onClick={() => { if (confirm(`حذف فئة "${cat.name}" مع كل أنواعها؟`)) deleteMut.mutate(cat.id) }}
                      >
                        حذف
                      </Button>
                      <span className="text-slate-400 text-xs px-1">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-indigo-200 px-3 pb-3 pt-2 space-y-2 dark:border-indigo-800">
                      <div className="flex gap-2">
                        <input
                          className="h-8 flex-1 rounded-lg border border-slate-200 px-3 text-sm font-semibold dark:border-slate-700 dark:bg-slate-950"
                          value={pendingName}
                          onChange={(e) => setEditingName((p) => ({ ...p, [cat.id]: e.target.value }))}
                          onBlur={() => saveCategoryName(cat)}
                          onKeyDown={(e) => e.key === "Enter" && saveCategoryName(cat)}
                          placeholder="اسم الفئة"
                        />
                        <span className="text-[11px] text-slate-400 self-center">← عدّل الاسم هنا</span>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {cat.types.map((t) => (
                          <span
                            key={t}
                            className="flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-300"
                          >
                            {t}
                            <button
                              type="button"
                              className="rounded-full hover:bg-violet-200 p-0.5 dark:hover:bg-violet-800"
                              title={`حذف نوع "${t}"`}
                              onClick={() => removeType(cat, t)}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {cat.types.length === 0 && (
                          <span className="text-xs text-slate-400">لا أنواع بعد — أضف أولاً</span>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <input
                          className="h-8 flex-1 rounded-lg border border-indigo-200 px-3 text-sm dark:border-indigo-700 dark:bg-slate-950"
                          placeholder="نوع جديد (أو عدة أنواع مفصولة بفاصلة)"
                          value={newTypeInputs[cat.id] ?? ""}
                          onChange={(e) => setNewTypeInputs((p) => ({ ...p, [cat.id]: e.target.value }))}
                          onKeyDown={(e) => e.key === "Enter" && addType(cat)}
                        />
                        <Button
                          size="sm"
                          className="h-8"
                          disabled={!(newTypeInputs[cat.id] ?? "").trim() || upsertMut.isPending}
                          onClick={() => addType(cat)}
                        >
                          <Plus className="h-3.5 w-3.5" /> إضافة نوع
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {cats.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-4">لا توجد فئات بعد — أضف فئة جديدة أعلاه.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
