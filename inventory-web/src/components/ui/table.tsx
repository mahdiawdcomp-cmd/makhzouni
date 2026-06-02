import * as React from "react"
import { cn } from "../../utils/cn"

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn("w-full caption-bottom text-sm border-collapse", className)}
        {...props}
      />
    </div>
  )
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("", className)}
      style={{ backgroundColor: "var(--z-tbl-header, #F8F9FB)" }}
      {...props}
    />
  )
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "transition-colors duration-100 cursor-default",
        "hover:bg-[var(--z-tbl-hover,#F0F5FF)]",
        "dark:hover:bg-[#1C2332]",
        className,
      )}
      style={{ borderBottom: "1px solid var(--theme-cardBorder, #E8EAF0)" }}
      {...props}
    />
  )
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-right align-middle text-[11px] font-semibold uppercase tracking-wider",
        className,
      )}
      style={{ color: "#6B7280" }}
      {...props}
    />
  )
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-4 py-3 align-middle text-[13.5px]", className)}
      style={{ color: "var(--theme-textPrimary)" }}
      {...props}
    />
  )
}
