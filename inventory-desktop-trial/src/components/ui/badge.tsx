import * as React from "react"
import { cn } from "../../utils/cn"

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "secondary" | "outline" | "info"

const variants: Record<BadgeVariant, string> = {
  default:   "text-white",
  success:   "bg-green-50  text-green-700  border border-green-200  dark:bg-green-900/20  dark:text-green-400",
  warning:   "bg-amber-50  text-amber-700  border border-amber-200  dark:bg-amber-900/20  dark:text-amber-400",
  danger:    "bg-red-50    text-red-700    border border-red-200    dark:bg-red-900/20    dark:text-red-400",
  info:      "bg-blue-50   text-blue-700   border border-blue-200   dark:bg-blue-900/20   dark:text-blue-400",
  secondary: "bg-slate-100 text-slate-600  border border-slate-200  dark:bg-slate-800     dark:text-slate-300",
  outline:   "border text-slate-600        border-slate-300                                dark:text-slate-300",
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

export function Badge({ className, variant = "default", style, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-[11.5px] font-semibold leading-none",
        variants[variant],
        className,
      )}
      style={
        variant === "default"
          ? { backgroundColor: "var(--theme-primaryBtn)", ...style }
          : style
      }
      {...props}
    />
  )
}
