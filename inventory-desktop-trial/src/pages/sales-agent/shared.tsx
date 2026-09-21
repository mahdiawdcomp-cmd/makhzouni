/**
 * The rep screen's own primitives, shared by its screens.
 *
 * These lived inside `SalesAgentPage.tsx` and moved here unchanged when the new
 * screens (pending orders, follow-up, visits) needed them — one definition, so
 * a dialog on the visits screen behaves exactly like a dialog on the cart.
 *
 * Mobile-first on purpose: the rep is standing in a shop holding a phone. The
 * dialog is a full-height sheet on a phone and a centred, bounded card on a
 * tablet, and every touch target is at least 44px.
 */
import React, { useEffect } from "react"
import { Loader2, Users, X } from "lucide-react"
import { Button } from "../../components/ui/button"
import { Card, CardContent } from "../../components/ui/card"
import { cn } from "../../utils/cn"
// Labels and number formatting live in `format.ts`: this file exports
// components, and mixing the two loses fast refresh.
import { money, shortDate } from "./format"

const dialogStack: object[] = []

export function AgentDialog({
  title,
  onClose,
  children,
  footer,
  padded = true,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  padded?: boolean
}) {
  /**
   * Escape closes the TOP dialog only.
   *
   * «أكو مشكلة» opens on top of the product dialog, and one Escape used to
   * close both — the rep backing out of the note also lost the quantity they
   * had set. Each dialog takes a place in this stack and only the last one
   * listens.
   */
  useEffect(() => {
    const token = {}
    dialogStack.push(token)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (dialogStack[dialogStack.length - 1] !== token) return
      onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      const i = dialogStack.indexOf(token)
      if (i >= 0) dialogStack.splice(i, 1)
    }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="إغلاق"
        onClick={onClose}
        className="absolute inset-0 cursor-pointer bg-slate-900/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[92dvh] w-full min-h-0 flex-col rounded-t-xl border sm:max-h-[85dvh] sm:max-w-lg sm:rounded-xl"
        style={{
          backgroundColor: "var(--theme-cardBg)",
          borderColor: "var(--theme-cardBorder)",
          boxShadow: "var(--z-shadow-lg)",
        }}
      >
        <div
          className="flex shrink-0 items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--theme-cardBorder)" }}
        >
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded text-slate-500 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", padded && "p-5")}>
          {children}
        </div>

        {footer && (
          <div
            className="shrink-0 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            style={{ borderColor: "var(--theme-cardBorder)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function AgentField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-slate-600 dark:text-slate-300">
        {label}
      </span>
      {children}
    </label>
  )
}

export function AgentEmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string
  body: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-lg bg-[var(--theme-accentSoft)] text-[var(--theme-accent)]">
          <Users className="h-6 w-6" />
        </div>
        <h3 className="text-[15px] font-semibold">{title}</h3>
        <p className="max-w-sm text-sm text-slate-500">{body}</p>
        {actionLabel && onAction && (
          <Button className="mt-1" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export function AgentLoading({ label = "جاري التحميل…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}

/** Status pill, using the site's status colours. */
export function AgentStatusPill({
  tone,
  children,
}: {
  tone: "ok" | "wait" | "bad" | "muted"
  children: React.ReactNode
}) {
  const cls = {
    ok: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    wait: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    bad: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    muted: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  }[tone]
  return <span className={cn("rounded px-2 py-0.5 text-[12px] font-medium", cls)}>{children}</span>
}

/**
 * «كان بـ… وصار بـ…» — the price-change note.
 *
 * Information only: no screen may refuse a sale over it, which is why this is a
 * label and never a gate. Absent when the server had nothing comparable to say.
 */
export function PriceChangeNote({
  change,
  className,
}: {
  change?: {
    previousPrice: number
    currentPrice: number
    difference: number
    percent: number
    direction: "UP" | "DOWN"
    lastPurchaseAt: string | Date
  }
  className?: string
}) {
  if (!change) return null
  const up = change.direction === "UP"
  return (
    <p
      className={cn(
        "mt-1 rounded-lg px-2 py-1 text-[12px]",
        up
          ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
        className,
      )}
    >
      {up ? "أغلى من آخر شراء" : "أرخص من آخر شراء"}
      {" · "}
      كان {money(change.previousPrice)} وصار {money(change.currentPrice)}
      {" · "}
      الفرق {money(Math.abs(change.difference))} ({Math.abs(change.percent)}%)
      {" · "}
      آخر شراء {shortDate(change.lastPurchaseAt)}
    </p>
  )
}
