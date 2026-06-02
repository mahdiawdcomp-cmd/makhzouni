import * as React from "react"
import { cn } from "../../utils/cn"

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-white text-slate-900 dark:text-slate-50",
        className,
      )}
      style={{
        backgroundColor: "var(--theme-cardBg)",
        borderColor: "var(--theme-cardBorder)",
        boxShadow: "0 1px 3px rgba(17,17,26,0.07), 0 1px 2px rgba(17,17,26,0.04)",
        color: "var(--theme-textPrimary)",
      }}
      {...props}
    />
  )
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center justify-between px-5 py-4 border-b", className)}
      style={{ borderColor: "var(--theme-cardBorder)" }}
      {...props}
    />
  )
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-[15px] font-semibold tracking-tight", className)}
      style={{ color: "var(--theme-textPrimary)" }}
      {...props}
    />
  )
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />
}

/** Zoho-style stat/metric card with accent top border */
export function StatCard({
  title,
  value,
  sub,
  icon,
  color = "var(--theme-accent)",
  className,
}: {
  title: string
  value: string | number
  sub?: string
  icon?: React.ReactNode
  color?: string
  className?: string
}) {
  return (
    <div
      className={cn("relative overflow-hidden rounded-lg border bg-white p-5", className)}
      style={{
        backgroundColor: "var(--theme-cardBg)",
        borderColor: "var(--theme-cardBorder)",
        boxShadow: "0 1px 3px rgba(17,17,26,0.07)",
        borderTop: `3px solid ${color}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-wide text-slate-500">
            {title}
          </p>
          <p className="mt-1.5 text-2xl font-bold" style={{ color: "var(--theme-textPrimary)" }}>
            {value}
          </p>
          {sub ? <p className="mt-0.5 text-[12px] text-slate-500">{sub}</p> : null}
        </div>
        {icon ? (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0"
            style={{ backgroundColor: `${color}18` }}
          >
            <span style={{ color }}>{icon}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
