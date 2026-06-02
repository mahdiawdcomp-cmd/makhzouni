import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "../../utils/cn"

export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive" | "link"
export type ButtonSize    = "default" | "sm" | "lg" | "icon"

const variants: Record<ButtonVariant, string> = {
  default:
    "bg-[var(--theme-primaryBtn)] text-white shadow-sm " +
    "hover:bg-[var(--theme-primaryBtnHover)] active:scale-[0.98]",
  secondary:
    "bg-slate-100 text-slate-700 hover:bg-slate-200 " +
    "dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
  outline:
    "border bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-400 " +
    "dark:border-slate-700 dark:bg-transparent dark:text-slate-200 dark:hover:bg-slate-800",
  ghost:
    "text-slate-600 hover:bg-slate-100 hover:text-slate-800 " +
    "dark:text-slate-300 dark:hover:bg-slate-800",
  destructive:
    "bg-red-500 text-white shadow-sm hover:bg-red-600 active:scale-[0.98]",
  link:
    "text-[var(--theme-primaryBtn)] underline-offset-4 hover:underline p-0 h-auto",
}

const sizes: Record<ButtonSize, string> = {
  default: "h-9 px-4 py-2 text-[13.5px]",
  sm:      "h-7 rounded px-3 text-[12px]",
  lg:      "h-10 rounded-lg px-6 text-[14px]",
  icon:    "h-9 w-9",
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium",
          "transition-all duration-150 ease-in-out",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-1",
          "disabled:pointer-events-none disabled:opacity-50",
          variants[variant],
          sizes[size],
          className,
        )}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"
