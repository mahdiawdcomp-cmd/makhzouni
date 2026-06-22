import * as React from "react"
import { cn } from "../../utils/cn"

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-9 w-full rounded border px-3 py-2 text-[13.5px]",
          "bg-white text-[var(--theme-textPrimary)] placeholder:text-slate-400",
          "border-slate-300 dark:border-slate-700 dark:bg-slate-900",
          "transition-all duration-150",
          "focus:outline-none focus:border-[var(--theme-accent)]",
          "focus:ring-2 focus:ring-[var(--theme-accent)] focus:ring-opacity-20",
          "disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-slate-50",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium",
          className,
        )}
        {...props}
      />
    )
  },
)
Input.displayName = "Input"
