import { useState } from "react"
import { Check, Plus, Tag as TagIcon } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { createCustomerTag, getCustomerTags } from "../../api/endpoints"
import { Input } from "./input"

/**
 * Reusable customer-tag picker: shows every existing tag as a checkbox-style
 * toggle and lets the user add a brand-new tag inline. Selection is controlled
 * via `value` (array of tag names) + `onChange`. New tags are registered in the
 * canonical tag list immediately so they show up everywhere.
 */
export function TagPicker({
  value,
  onChange,
}: {
  value: string[]
  onChange: (tags: string[]) => void
}) {
  const tagsQuery = useQuery({ queryKey: ["customer-tags"], queryFn: getCustomerTags })
  const existing = tagsQuery.data ?? []
  const [newTag, setNewTag] = useState("")
  const [adding, setAdding] = useState(false)

  // Show every known tag plus any selected tag not yet in the canonical list.
  const allTags = Array.from(new Set([...existing, ...value])).sort((a, b) => a.localeCompare(b))

  function toggle(tag: string) {
    onChange(value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag])
  }

  async function addNew() {
    const clean = newTag.trim()
    if (!clean) return
    setAdding(true)
    try {
      await createCustomerTag(clean)
      await tagsQuery.refetch()
      if (!value.includes(clean)) onChange([...value, clean])
      setNewTag("")
    } catch {
      // If the API is unreachable, still select it locally so the save carries it.
      if (!value.includes(clean)) onChange([...value, clean])
      setNewTag("")
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {allTags.length === 0 && (
          <span className="text-xs text-slate-400">لا يوجد تاكات بعد — أضف واحداً بالأسفل.</span>
        )}
        {allTags.map((tag) => {
          const selected = value.includes(tag)
          return (
            <button
              key={tag}
              type="button"
              onClick={() => toggle(tag)}
              className={
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition " +
                (selected
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300")
              }
            >
              {selected ? <Check className="h-3 w-3" /> : <TagIcon className="h-3 w-3" />}
              {tag}
            </button>
          )
        })}
      </div>
      <div className="flex gap-2">
        <Input
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void addNew()
            }
          }}
          placeholder="تاك جديد..."
          className="h-8 text-sm"
        />
        <button
          type="button"
          onClick={() => void addNew()}
          disabled={adding || !newTag.trim()}
          className="flex shrink-0 items-center gap-1 rounded-md bg-slate-900 px-3 text-xs font-medium text-white disabled:opacity-50 dark:bg-slate-700"
        >
          <Plus className="h-3.5 w-3.5" /> إضافة
        </button>
      </div>
    </div>
  )
}
