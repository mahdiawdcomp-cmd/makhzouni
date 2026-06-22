import { create } from "zustand"

interface UiStore {
  /** When true, the sidebar collapses so invoice/form pages get full width. */
  focusMode: boolean
  setFocusMode: (v: boolean) => void
}

export const useUiStore = create<UiStore>((set) => ({
  focusMode: false,
  setFocusMode: (v) => set({ focusMode: v }),
}))
