/**
 * Sync Engine — pulls data from the remote server into the local SQLite backend.
 *
 * Flow:
 *   1. On login, if running in Tauri with local backend (localhost:5050):
 *      - Ask user for remote server credentials
 *      - Pull customers, products, invoices, vouchers from remote
 *      - POST them to local backend
 *   2. On push: send any locally-created records to remote (future)
 *
 * For now we implement "pull on first run" — the local DB starts empty
 * and gets populated from remote once.
 */

import axios from "axios"

export interface SyncCredentials {
  remoteUrl: string   // e.g. https://api.mazbwoni.com/api
  token: string       // JWT from remote login
}

export interface SyncProgress {
  step: string
  done: number
  total: number
}

type ProgressCallback = (p: SyncProgress) => void

const LOCAL_URL = "http://localhost:5050/api"

async function fetchAll<T>(url: string, token: string): Promise<T[]> {
  const res = await axios.get<{ data: T[] }>(url, {
    headers: { Authorization: `Bearer ${token}` },
    params: { page: 1, limit: 10000 },
    timeout: 30000,
  })
  return res.data?.data ?? (res.data as unknown as T[]) ?? []
}

export async function syncFromRemote(
  creds: SyncCredentials,
  localToken: string,
  onProgress?: ProgressCallback
): Promise<{ success: boolean; error?: string; counts: Record<string, number> }> {
  const remote = creds.remoteUrl.replace(/\/+$/, "")
  const local = LOCAL_URL
  const counts: Record<string, number> = {}

  const step = (s: string, done = 0, total = 0) => onProgress?.({ step: s, done, total })

  try {
    // ── 1. Customers ──────────────────────────────────────────────────────────
    step("جاري جلب الزبائن…", 0, 100)
    const customers = await fetchAll<Record<string, unknown>>(
      `${remote}/customers`, creds.token
    )
    counts.customers = customers.length
    step("جاري حفظ الزبائن…", 10, 100)

    for (const c of customers) {
      await axios.post(`${local}/customers`, c, {
        headers: { Authorization: `Bearer ${localToken}` },
      }).catch(() => {}) // skip duplicates
    }

    // ── 2. Products ───────────────────────────────────────────────────────────
    step("جاري جلب المنتجات…", 25, 100)
    const products = await fetchAll<Record<string, unknown>>(
      `${remote}/products`, creds.token
    )
    counts.products = products.length
    step("جاري حفظ المنتجات…", 35, 100)

    for (const p of products) {
      await axios.post(`${local}/products`, p, {
        headers: { Authorization: `Bearer ${localToken}` },
      }).catch(() => {})
    }

    // ── 3. Invoices ───────────────────────────────────────────────────────────
    step("جاري جلب الفواتير…", 50, 100)
    const invoices = await fetchAll<Record<string, unknown>>(
      `${remote}/invoices`, creds.token
    )
    counts.invoices = invoices.length
    step("جاري حفظ الفواتير…", 60, 100)

    for (const inv of invoices) {
      await axios.post(`${local}/invoices/import`, inv, {
        headers: { Authorization: `Bearer ${localToken}` },
      }).catch(() => {})
    }

    // ── 4. Vouchers ───────────────────────────────────────────────────────────
    step("جاري جلب السندات…", 75, 100)
    const vouchers = await fetchAll<Record<string, unknown>>(
      `${remote}/vouchers`, creds.token
    )
    counts.vouchers = vouchers.length
    step("جاري حفظ السندات…", 85, 100)

    for (const v of vouchers) {
      await axios.post(`${local}/vouchers/import`, v, {
        headers: { Authorization: `Bearer ${localToken}` },
      }).catch(() => {})
    }

    step("اكتملت المزامنة", 100, 100)
    return { success: true, counts }
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "خطأ غير معروف"
    return { success: false, error: msg, counts }
  }
}

/** Check if we're running with local backend */
export function isLocalMode(): boolean {
  const isTauri = Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)
  if (!isTauri) return false
  const base = (localStorage.getItem("makhzouni_server_url") ?? "")
  return base.includes("localhost:5050") || base.includes("127.0.0.1:5050")
}
