import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useParams } from "react-router-dom"
import { Check, Search, ShoppingCart, Trash2, X } from "lucide-react"
import {
  getKioskConfig,
  getKioskProducts,
  getKioskThumbnails,
  submitKioskOrder,
  type KioskProduct,
} from "../api/endpoints"
import { apiErrorMessage } from "../utils/apiError"
import { fmt } from "../utils/fmt"
import { matchProduct, scoreProduct } from "../utils/search"

/**
 * «الكشك» — the screen standing in the shop.
 *
 * A customer walks up, picks what they want, writes their name and number,
 * and the order lands in the shop's approvals like any catalog order. Three
 * things make this different from the catalog and drive every choice here:
 *
 *  - Nobody is signed in and nobody ever will be. The link is the credential.
 *  - The NEXT customer walks up straight after. So the screen wipes itself:
 *    after a finished order, and after a few quiet minutes. A cart or a phone
 *    number left on a public screen is somebody else's business.
 *  - It is touched, not clicked. Everything is finger-sized, and one tap adds
 *    one — no quantity typing unless they ask for it.
 */

/** Nothing touched for this long → back to a clean screen. */
const IDLE_MS = 3 * 60 * 1000
/** How long the "thank you" stays before the next customer's screen. */
const THANKS_MS = 8000
/** Cards drawn before «المزيد». Keeps the first paint fast on a cheap tablet. */
const PAGE = 60

const phoneOk = (value: string) => /^(?:\+?964|0)?7\d{9}$/.test(value.replace(/[\s-]/g, ""))

type Line = { productId: string; quantity: number }

function unitLabel(mode: "WHOLESALE" | "CARTON") {
  return mode === "CARTON" ? "كارتون" : "قطعة"
}

/** The price of ONE of whatever the kiosk is selling in. */
function priceOf(product: KioskProduct, mode: "WHOLESALE" | "CARTON") {
  if (mode === "CARTON") return Number(product.cartonPiecePrice ?? 0) * product.pcsPerCarton
  return Number(product.salePrice ?? 0)
}

/** How many of them the shop has. */
function availableOf(product: KioskProduct, mode: "WHOLESALE" | "CARTON") {
  if (mode === "CARTON") {
    return product.pcsPerCarton > 0 ? Math.floor(product.currentStock / product.pcsPerCarton) : 0
  }
  return product.currentStock
}

export function KioskPage() {
  const { token = "" } = useParams()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [screen, setScreen] = useState<"grid" | "cart" | "done">("grid")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [notes, setNotes] = useState("")
  const [shown, setShown] = useState(PAGE)
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({})

  const config = useQuery({
    queryKey: ["kiosk-config", token],
    queryFn: () => getKioskConfig(token),
    retry: 1,
  })

  const products = useQuery({
    queryKey: ["kiosk-products", token],
    queryFn: () => getKioskProducts(token),
    enabled: config.isSuccess,
    // The shop keeps selling while the screen stands there; a card that
    // promises goods sold an hour ago is the one complaint this must not
    // create. The order is re-checked against real stock anyway.
    refetchInterval: 5 * 60 * 1000,
    retry: 3,
  })

  const mode = config.data?.priceMode ?? "WHOLESALE"
  const productById = useMemo(
    () => new Map((products.data ?? []).map((p) => [p.id, p])),
    [products.data],
  )

  /** Everything back to how the next customer should find it. */
  function reset() {
    setLines([])
    setName("")
    setPhone("")
    setNotes("")
    setQuery("")
    setCategory(null)
    setShown(PAGE)
    setScreen("grid")
  }

  // ── idle wipe ──────────────────────────────────────────────────────
  // A cart, a name and a phone number left on a screen in a public room
  // belong to whoever walks up next. Any touch anywhere restarts the clock.
  const idleRef = useRef<number | null>(null)
  const dirty = lines.length > 0 || name !== "" || phone !== "" || query !== ""
  useEffect(() => {
    if (screen === "done" || !dirty) return
    const restart = () => {
      if (idleRef.current) window.clearTimeout(idleRef.current)
      idleRef.current = window.setTimeout(reset, IDLE_MS)
    }
    restart()
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "wheel", "touchstart"]
    for (const event of events) window.addEventListener(event, restart, { passive: true })
    return () => {
      for (const event of events) window.removeEventListener(event, restart)
      if (idleRef.current) window.clearTimeout(idleRef.current)
    }
  }, [screen, dirty])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const product of products.data ?? []) if (product.category) set.add(product.category)
    return [...set].sort((a, b) => a.localeCompare(b, "ar"))
  }, [products.data])

  const visible = useMemo(() => {
    let list = (products.data ?? []).filter((product) => availableOf(product, mode) > 0)
    if (category) list = list.filter((product) => product.category === category)
    if (query.trim()) {
      list = list
        .filter((product) => matchProduct({ ...product, qrCode: null, cartonQrCode: null } as never, query))
        .sort((a, b) => scoreProduct(b as never, query) - scoreProduct(a as never, query))
    }
    return list
  }, [products.data, category, query, mode])

  const page = useMemo(() => visible.slice(0, shown), [visible, shown])

  // Pictures for the cards actually on screen, in one request. The grid
  // deliberately arrives without them — a few hundred thumbnails is megabytes
  // on open, and this tablet is on the shop's Wi-Fi.
  useEffect(() => {
    const missing = page.filter((p) => p.hasImage && !(p.id in thumbs)).map((p) => p.id)
    if (missing.length === 0) return
    let cancelled = false
    getKioskThumbnails(token, missing.slice(0, 120))
      .then((data) => {
        if (!cancelled) setThumbs((prev) => ({ ...prev, ...data }))
      })
      .catch(() => {
        // A picture that doesn't arrive is a card without a picture, not a
        // broken screen. Marked as tried so it isn't asked for in a loop.
        if (!cancelled) {
          setThumbs((prev) => {
            const next = { ...prev }
            for (const id of missing) next[id] = null
            return next
          })
        }
      })
    return () => { cancelled = true }
  }, [page, thumbs, token])

  useEffect(() => { setShown(PAGE) }, [query, category])

  const cart = lines
    .map((line) => ({ line, product: productById.get(line.productId) }))
    .filter((row): row is { line: Line; product: KioskProduct } => Boolean(row.product))
  const total = cart.reduce((sum, row) => sum + priceOf(row.product, mode) * row.line.quantity, 0)
  const count = cart.reduce((sum, row) => sum + row.line.quantity, 0)

  function add(product: KioskProduct, by = 1) {
    const max = availableOf(product, mode)
    setLines((prev) => {
      const existing = prev.find((line) => line.productId === product.id)
      if (!existing) return by > 0 ? [...prev, { productId: product.id, quantity: 1 }] : prev
      const quantity = Math.min(Math.max(existing.quantity + by, 0), Math.max(max, 1))
      return quantity === 0
        ? prev.filter((line) => line.productId !== product.id)
        : prev.map((line) => (line.productId === product.id ? { ...line, quantity } : line))
    })
  }

  const qtyOf = (id: string) => lines.find((line) => line.productId === id)?.quantity ?? 0

  const send = useMutation({
    mutationFn: () =>
      submitKioskOrder(token, {
        customerName: name.trim(),
        phone: phone.trim(),
        notes: notes.trim() || undefined,
        items: cart.map((row) => ({
          productId: row.product.id,
          unit: mode === "CARTON" ? "CARTON" : "PIECE",
          quantity: row.line.quantity,
        })),
      }),
    onSuccess: () => setScreen("done"),
  })

  // The thank-you screen clears itself, so a customer can walk away mid-read.
  useEffect(() => {
    if (screen !== "done") return
    const timer = window.setTimeout(reset, THANKS_MS)
    return () => window.clearTimeout(timer)
  }, [screen])

  if (config.isPending) {
    return <Center><div className="h-14 w-14 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" /></Center>
  }

  if (config.isError) {
    return (
      <Center>
        <div className="text-center">
          <p className="text-3xl font-bold text-slate-800">الشاشة غير مفعّلة</p>
          <p className="mt-3 text-xl text-slate-500">راجع صاحب المحل.</p>
        </div>
      </Center>
    )
  }

  if (screen === "done") {
    return (
      <Center>
        <div className="text-center">
          <div className="mx-auto flex h-28 w-28 items-center justify-center rounded-full bg-emerald-100">
            <Check className="h-16 w-16 text-emerald-600" />
          </div>
          <p className="mt-6 text-4xl font-bold text-slate-800">وصل طلبك</p>
          <p className="mt-4 text-2xl text-slate-600">راح يراجعه صاحب المحل ويتصل بيك.</p>
          <button
            onClick={reset}
            className="mt-10 rounded-2xl bg-indigo-600 px-10 py-5 text-2xl font-bold text-white"
          >
            طلب جديد
          </button>
        </div>
      </Center>
    )
  }

  return (
    <div dir="rtl" className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <header className="flex items-center justify-between gap-4 bg-white px-6 py-4 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold">{config.data?.title || config.data?.storeName}</h1>
          <p className="text-base text-slate-500">
            الأسعار بـ{unitLabel(mode)}
          </p>
        </div>
        {screen === "grid" && (
          <div className="relative w-1/2 max-w-xl">
            <Search className="absolute right-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="دور على البضاعة…"
              className="w-full rounded-2xl border-2 border-slate-200 py-4 pr-14 pl-4 text-xl outline-none focus:border-indigo-500"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-slate-400"
                aria-label="مسح البحث"
              >
                <X className="h-6 w-6" />
              </button>
            )}
          </div>
        )}
      </header>

      {screen === "grid" ? (
        <>
          {categories.length > 0 && (
            <div className="flex gap-2 overflow-x-auto bg-white px-6 pb-3">
              <Chip active={category === null} onClick={() => setCategory(null)}>الكل</Chip>
              {categories.map((name) => (
                <Chip key={name} active={category === name} onClick={() => setCategory(name)}>{name}</Chip>
              ))}
            </div>
          )}

          <main className="flex-1 overflow-y-auto p-4">
            {products.isPending ? (
              <p className="p-10 text-center text-xl text-slate-500">جاري التحميل…</p>
            ) : products.isError ? (
              <div className="p-10 text-center">
                <p className="text-xl text-slate-700">ما وصلت البضاعة — الاتصال بالسيرفر منقطع.</p>
                <button
                  onClick={() => products.refetch()}
                  className="mt-5 rounded-2xl bg-indigo-600 px-8 py-4 text-xl font-bold text-white"
                >
                  حاول مرة ثانية
                </button>
              </div>
            ) : visible.length === 0 ? (
              <p className="p-10 text-center text-xl text-slate-500">ماكو نتائج.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {page.map((product) => (
                    <Card
                      key={product.id}
                      product={product}
                      mode={mode}
                      thumb={thumbs[product.id] ?? null}
                      quantity={qtyOf(product.id)}
                      onAdd={() => add(product, 1)}
                      onSub={() => add(product, -1)}
                    />
                  ))}
                </div>
                {visible.length > page.length && (
                  <div className="py-6 text-center">
                    <button
                      onClick={() => setShown((n) => n + PAGE)}
                      className="rounded-2xl bg-white px-10 py-4 text-xl font-bold text-slate-700 shadow"
                    >
                      المزيد
                    </button>
                  </div>
                )}
              </>
            )}
          </main>
        </>
      ) : (
        <main className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl space-y-3">
            {cart.length === 0 ? (
              <p className="p-10 text-center text-xl text-slate-500">السلة فارغة.</p>
            ) : (
              cart.map((row) => (
                <div key={row.product.id} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
                  <div className="flex-1">
                    <p className="text-xl font-bold">{row.product.name}</p>
                    <p className="text-lg text-slate-500">
                      {fmt(priceOf(row.product, mode))} × {row.line.quantity} {unitLabel(mode)}
                    </p>
                  </div>
                  <p className="text-xl font-bold text-indigo-700">
                    {fmt(priceOf(row.product, mode) * row.line.quantity)}
                  </p>
                  <Stepper
                    quantity={row.line.quantity}
                    onAdd={() => add(row.product, 1)}
                    onSub={() => add(row.product, -1)}
                  />
                  <button
                    onClick={() => setLines((prev) => prev.filter((line) => line.productId !== row.product.id))}
                    className="rounded-xl p-3 text-rose-600"
                    aria-label="احذف"
                  >
                    <Trash2 className="h-6 w-6" />
                  </button>
                </div>
              ))
            )}

            {cart.length > 0 && (
              <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">
                <Field label="اسمك">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-2xl border-2 border-slate-200 p-4 text-xl outline-none focus:border-indigo-500"
                  />
                </Field>
                <Field label="رقم الموبايل">
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="numeric"
                    placeholder="07XXXXXXXXX"
                    className="w-full rounded-2xl border-2 border-slate-200 p-4 text-xl outline-none focus:border-indigo-500"
                    dir="ltr"
                  />
                </Field>
                <Field label="ملاحظة (اختياري)">
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full rounded-2xl border-2 border-slate-200 p-4 text-xl outline-none focus:border-indigo-500"
                  />
                </Field>
                {send.isError && (
                  <p className="rounded-2xl bg-rose-50 p-4 text-lg text-rose-700">{apiErrorMessage(send.error)}</p>
                )}
                <button
                  disabled={send.isPending || name.trim().length < 2 || !phoneOk(phone)}
                  onClick={() => send.mutate()}
                  className="w-full rounded-2xl bg-emerald-600 py-5 text-2xl font-bold text-white disabled:bg-slate-300"
                >
                  {send.isPending ? "جاري الإرسال…" : "أرسل الطلب"}
                </button>
                {!phoneOk(phone) && phone.trim() !== "" && (
                  <p className="text-center text-lg text-amber-600">الرقم لازم يبدي بـ07 ويكون ١١ رقم.</p>
                )}
              </div>
            )}
          </div>
        </main>
      )}

      <footer className="flex items-center gap-4 bg-white px-6 py-4 shadow-[0_-2px_10px_rgba(0,0,0,0.06)]">
        {screen === "cart" ? (
          <button
            onClick={() => setScreen("grid")}
            className="rounded-2xl bg-slate-200 px-8 py-4 text-xl font-bold text-slate-700"
          >
            رجوع للبضاعة
          </button>
        ) : (
          <button
            onClick={reset}
            disabled={!dirty}
            className="rounded-2xl bg-slate-100 px-6 py-4 text-lg font-bold text-slate-500 disabled:opacity-40"
          >
            ابدأ من جديد
          </button>
        )}
        <div className="flex-1 text-center text-xl font-bold">
          {count > 0 ? `${count} ${unitLabel(mode)} — ${fmt(total)}` : "السلة فارغة"}
        </div>
        {screen === "grid" && (
          <button
            disabled={count === 0}
            onClick={() => setScreen("cart")}
            className="flex items-center gap-3 rounded-2xl bg-indigo-600 px-8 py-4 text-xl font-bold text-white disabled:bg-slate-300"
          >
            <ShoppingCart className="h-6 w-6" />
            إتمام الطلب
          </button>
        )}
      </footer>
    </div>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div dir="rtl" className="flex h-screen items-center justify-center bg-slate-100">{children}</div>
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-lg font-bold text-slate-600">{label}</span>
      {children}
    </label>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-5 py-3 text-lg font-bold ${active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}
    >
      {children}
    </button>
  )
}

function Stepper({ quantity, onAdd, onSub }: { quantity: number; onAdd: () => void; onSub: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onSub} className="h-12 w-12 rounded-xl bg-slate-100 text-2xl font-bold" aria-label="أنقص">−</button>
      <span className="w-10 text-center text-2xl font-bold">{quantity}</span>
      <button onClick={onAdd} className="h-12 w-12 rounded-xl bg-indigo-600 text-2xl font-bold text-white" aria-label="زد">+</button>
    </div>
  )
}

function Card({
  product,
  mode,
  thumb,
  quantity,
  onAdd,
  onSub,
}: {
  product: KioskProduct
  mode: "WHOLESALE" | "CARTON"
  thumb: string | null
  quantity: number
  onAdd: () => void
  onSub: () => void
}) {
  const price = priceOf(product, mode)
  const available = availableOf(product, mode)
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-white shadow-sm">
      <button onClick={onAdd} className="block aspect-square w-full bg-slate-50">
        {thumb ? (
          <img src={thumb} alt={product.name} className="h-full w-full object-contain" />
        ) : (
          <span className="flex h-full items-center justify-center text-5xl text-slate-200">◻</span>
        )}
      </button>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-base font-bold leading-tight">{product.name}</p>
        <p className="text-xl font-bold text-indigo-700">{price > 0 ? fmt(price) : "—"}</p>
        <p className="text-sm text-slate-400">متوفر {available} {unitLabel(mode)}</p>
        <div className="mt-auto pt-2">
          {quantity > 0 ? (
            <Stepper quantity={quantity} onAdd={onAdd} onSub={onSub} />
          ) : (
            <button onClick={onAdd} className="w-full rounded-xl bg-indigo-50 py-3 text-lg font-bold text-indigo-700">
              أضف
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
