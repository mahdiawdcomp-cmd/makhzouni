import * as React from "react"
import { Input } from "./input"

/**
 * Numeric field rendered as a plain text input (NOT <input type="number">).
 *
 * Why text instead of number:
 *  - The mouse wheel never mutates the value (type="number" scroll-to-change is a
 *    frequent source of silent price/qty corruption on desktop).
 *  - No browser spinner arrows.
 *  - The user can momentarily clear the field while typing without it snapping
 *    back to 0 — we keep a local "editing" string and only surface the parsed
 *    number to the parent, so calculations and the save payload stay numeric.
 *
 * `value` is always the canonical number from parent state; `onValueChange`
 * receives a parsed number (empty / partial input → 0, so totals never break).
 */
export interface NumericInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number
  onValueChange: (value: number) => void
  /** allow a decimal point (default true). false = integers only. */
  decimal?: boolean
}

export const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  function NumericInput({ value, onValueChange, decimal = true, onBlur, onWheel, ...rest }, ref) {
    // While the field is being edited we mirror the raw keystrokes here so the
    // user can type "1.", clear to "", etc. `null` = not editing → show `value`.
    const [draft, setDraft] = React.useState<string | null>(null)

    const display =
      draft !== null ? draft : Number.isFinite(value) ? String(value) : ""

    function sanitize(raw: string): string {
      let s = decimal ? raw.replace(/[^0-9.]/g, "") : raw.replace(/[^0-9]/g, "")
      if (decimal) {
        const parts = s.split(".")
        if (parts.length > 2) s = parts[0] + "." + parts.slice(1).join("")
      }
      return s
    }

    return (
      <Input
        ref={ref}
        type="text"
        inputMode={decimal ? "decimal" : "numeric"}
        value={display}
        // Wheel never changes a text input, but blur on wheel is a belt-and-braces
        // guard in case a parent re-adds type=number or a wrapper intercepts it.
        onWheel={(e) => {
          if (document.activeElement === e.currentTarget) e.currentTarget.blur()
          onWheel?.(e)
        }}
        onChange={(e) => {
          const s = sanitize(e.target.value)
          setDraft(s)
          const n = s === "" || s === "." ? 0 : Number(s)
          onValueChange(Number.isFinite(n) ? n : 0)
        }}
        onBlur={(e) => {
          setDraft(null) // snap display back to the canonical number
          onBlur?.(e)
        }}
        {...rest}
      />
    )
  },
)
NumericInput.displayName = "NumericInput"
