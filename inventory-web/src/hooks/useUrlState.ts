import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"

/**
 * A piece of page state that lives in the URL query string instead of in React
 * state, so it survives a browser refresh, a back/forward, and a link shared to
 * a colleague.
 *
 * Written with `replace: true`: typing in a search box must not push a history
 * entry per keystroke, or the back button would walk letter by letter.
 *
 * Empty values are REMOVED from the URL rather than written as `?q=`, keeping a
 * clean address for the default state.
 */
export function useUrlState(key: string, defaultValue = "") {
  const [searchParams, setSearchParams] = useSearchParams()
  const value = searchParams.get(key) ?? defaultValue

  const setValue = useCallback(
    (next: string) => {
      setSearchParams(
        (current) => {
          // Build from the LIVE params (the updater form), never from a captured
          // copy — two states writing in the same tick would otherwise clobber
          // each other's key.
          const params = new URLSearchParams(current)
          if (!next || next === defaultValue) params.delete(key)
          else params.set(key, next)
          return params
        },
        { replace: true },
      )
    },
    [key, defaultValue, setSearchParams],
  )

  return [value, setValue] as const
}
