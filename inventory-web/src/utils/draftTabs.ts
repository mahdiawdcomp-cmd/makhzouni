/**
 * Draft-tab manager for invoice creation.
 * Each tab is a separate in-progress invoice draft stored in localStorage.
 *
 * Storage keys:
 *   invoice_tabs_{userId}           → DraftTabMeta[]   (list of open tabs)
 *   invoice_tab_data_{tabId}        → PersistedDraft   (full draft data)
 */

export interface DraftTabMeta {
  id: string           // UUID
  type: "SALE" | "PURCHASE"
  label: string        // customer name or "جديد"
  subtotal: number     // for display
  updatedAt: number    // timestamp
}

function tabsKey(userId: string) {
  return `invoice_tabs_${userId}`
}

export function tabDataKey(tabId: string) {
  return `invoice_tab_data_${tabId}`
}

export function listTabs(userId: string): DraftTabMeta[] {
  try {
    const raw = localStorage.getItem(tabsKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as DraftTabMeta[]
    // Keep only recent tabs (< 7 days)
    const cutoff = Date.now() - 7 * 86_400_000
    return parsed.filter((t) => t.updatedAt > cutoff)
  } catch {
    return []
  }
}

export function saveTabs(userId: string, tabs: DraftTabMeta[]) {
  try {
    localStorage.setItem(tabsKey(userId), JSON.stringify(tabs))
  } catch {}
}

export function upsertTab(userId: string, meta: DraftTabMeta) {
  const tabs = listTabs(userId)
  const existing = tabs.findIndex((t) => t.id === meta.id)
  if (existing >= 0) {
    tabs[existing] = meta
  } else {
    tabs.push(meta)
  }
  saveTabs(userId, tabs)
}

export function removeTab(userId: string, tabId: string) {
  const tabs = listTabs(userId).filter((t) => t.id !== tabId)
  saveTabs(userId, tabs)
  try { localStorage.removeItem(tabDataKey(tabId)) } catch {}
}

/** Generate a short random ID (not a UUID, just 8 hex chars). */
export function newTabId(): string {
  return Math.random().toString(16).slice(2, 10)
}
