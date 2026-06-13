import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"
import { Button } from "./ui/button"

interface Props {
  currentId?: string
  orderedIds: string[]
  onNavigate: (id: string) => void
  noun: string
  tone?: "light" | "dark"
}

export function RecordNavigator({ currentId, orderedIds, onNavigate, noun, tone = "light" }: Props) {
  const index = currentId ? orderedIds.indexOf(currentId) : -1
  const firstId = orderedIds[0]
  const previousId = index > 0 ? orderedIds[index - 1] : undefined
  const nextId = index >= 0 && index < orderedIds.length - 1 ? orderedIds[index + 1] : undefined
  const lastId = orderedIds[orderedIds.length - 1]
  const buttonClass = tone === "dark"
    ? "h-9 w-9 p-0 text-white hover:bg-white/20 disabled:text-white/35"
    : "h-9 w-9 p-0"

  function go(id?: string) {
    if (id && id !== currentId) onNavigate(id)
  }

  return (
    <div
      className={tone === "dark"
        ? "flex items-center gap-1 rounded-lg bg-white/15 p-1 backdrop-blur"
        : "flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900"}
      aria-label={`التنقل بين ${noun}`}
      dir="rtl"
    >
      <Button variant="ghost" className={buttonClass} onClick={() => go(firstId)} disabled={!firstId || index <= 0} title={`أول ${noun}`} aria-label={`أول ${noun}`}>
        <ChevronsRight className="h-4 w-4" />
      </Button>
      <Button variant="ghost" className={buttonClass} onClick={() => go(previousId)} disabled={!previousId} title={`${noun} السابق`} aria-label={`${noun} السابق`}>
        <ChevronRight className="h-4 w-4" />
      </Button>
      <span className={tone === "dark" ? "min-w-16 px-1 text-center text-xs text-white" : "min-w-16 px-1 text-center text-xs text-slate-500"}>
        {index >= 0 ? `${index + 1} من ${orderedIds.length}` : `- من ${orderedIds.length}`}
      </span>
      <Button variant="ghost" className={buttonClass} onClick={() => go(nextId)} disabled={!nextId} title={`${noun} التالي`} aria-label={`${noun} التالي`}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="ghost" className={buttonClass} onClick={() => go(lastId)} disabled={!lastId || index === orderedIds.length - 1} title={`آخر ${noun}`} aria-label={`آخر ${noun}`}>
        <ChevronsLeft className="h-4 w-4" />
      </Button>
    </div>
  )
}
