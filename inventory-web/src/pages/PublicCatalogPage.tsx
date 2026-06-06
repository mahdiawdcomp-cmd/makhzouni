import { useEffect, useMemo, useState, type KeyboardEvent } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { CheckCircle2, ImageIcon, LockKeyhole, Minus, Package, Plus, Search, ShoppingCart, Trash2 } from "lucide-react"
import {
  getCatalogAccessStatus,
  getCatalogSession,
  getPublicCatalogProducts,
  requestCatalogAccess,
  submitPublicCatalogOrder,
} from "../api/endpoints"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Input } from "../components/ui/input"
import type { PublicCatalogProduct } from "../types/api"
import { cn } from "../utils/cn"

type CatalogUnit = "PIECE" | "DOZEN" | "CARTON"
type CartLine = {
  id: string
  product: PublicCatalogProduct
  unit: CatalogUnit
  quantity: number
}

const storageKey = "inventory_catalog_access"

const unitLabels: Record<CatalogUnit, string> = {
  PIECE: "قطعة",
  DOZEN: "درزن",
  CARTON: "كارتون",
}

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("en-US").format(Math.round(Number(value ?? 0)))
}

function unitPieces(product: PublicCatalogProduct, unit: CatalogUnit) {
  if (unit === "CARTON") return Math.max(1, product.pcsPerCarton || 1)
  if (unit === "DOZEN") return 12
  return 1
}

function unitPrice(product: PublicCatalogProduct, unit: CatalogUnit) {
  return Number(product.salePrice ?? 0) * unitPieces(product, unit)
}

function maxQuantity(product: PublicCatalogProduct, unit: CatalogUnit) {
  return Math.floor(product.currentStock / unitPieces(product, unit))
}

function lineKey(productId: string, unit: CatalogUnit) {
  return `${productId}:${unit}`
}

export function PublicCatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [accessToken, setAccessToken] = useState(() => searchParams.get("access") ?? localStorage.getItem(storageKey) ?? "")

  useEffect(() => {
    const fromUrl = searchParams.get("access")
    if (fromUrl && fromUrl !== accessToken) setAccessToken(fromUrl)
  }, [accessToken, searchParams])

  useEffect(() => {
    if (!accessToken) return
    localStorage.setItem(storageKey, accessToken)
    if (searchParams.get("access") !== accessToken) setSearchParams({ access: accessToken }, { replace: true })
  }, [accessToken, searchParams, setSearchParams])

  const sessionQuery = useQuery({
    queryKey: ["catalog-session", accessToken],
    queryFn: () => getCatalogSession(accessToken),
    enabled: Boolean(accessToken),
    retry: false,
  })
  const session = sessionQuery.data

  if (!accessToken || sessionQuery.isError) {
    return <CatalogGate onAccess={(token) => setAccessToken(token)} />
  }

  if (sessionQuery.isLoading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-500" dir="rtl">
        جاري فتح الكتالوج...
      </div>
    )
  }

  return <CatalogShop accessToken={accessToken} allowPrices={session.allowPrices} showStock={session.showStock ?? true} customerName={session.customer.name} />
}

function CatalogGate({ onAccess }: { onAccess: (token: string) => void }) {
  const [customerName, setCustomerName] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [notes, setNotes] = useState("")
  const [message, setMessage] = useState("")

  const requestMutation = useMutation({
    mutationFn: () =>
      requestCatalogAccess({
        customerName: customerName.trim(),
        phone: phone.trim(),
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => setMessage("تم إرسال طلب الدخول. بعد الموافقة اضغط فحص الموافقة بنفس رقم الهاتف."),
  })

  const statusMutation = useMutation({
    mutationFn: () => getCatalogAccessStatus(phone.trim()),
    onSuccess: (status) => {
      if (status?.approved && status.token) {
        onAccess(status.token)
      } else {
        setMessage("طلبك بعده ينتظر موافقة الإدارة.")
      }
    },
  })

  const canRequest = customerName.trim().length >= 2 && phone.trim().length >= 5
  const canCheck = phone.trim().length >= 5

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900" dir="rtl">
      <div className="mx-auto max-w-xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LockKeyhole className="h-5 w-5 text-emerald-600" />
              دخول كتالوج المنتجات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
              اكتب معلوماتك حتى نراجع الطلب. بعد الموافقة تفتح صفحة المنتجات، والأسعار تظهر فقط إذا الإدارة سمحت بذلك.
            </div>
            <Input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="اسم الزبون" />
            <Input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="رقم الهاتف" />
            <Input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="العنوان" />
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات اختيارية" />
            <div className="grid gap-2 sm:grid-cols-2">
              <Button disabled={!canRequest || requestMutation.isPending} onClick={() => requestMutation.mutate()}>
                {requestMutation.isPending ? "جاري الإرسال..." : "طلب دخول"}
              </Button>
              <Button variant="outline" disabled={!canCheck || statusMutation.isPending} onClick={() => statusMutation.mutate()}>
                {statusMutation.isPending ? "جاري الفحص..." : "فحص الموافقة"}
              </Button>
            </div>
            {message ? <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">{message}</div> : null}
            {(requestMutation.isError || statusMutation.isError) ? (
              <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">تعذر تنفيذ الطلب. تأكد من الرقم وحاول مرة ثانية.</div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function CatalogShop({
  accessToken,
  allowPrices,
  showStock,
  customerName,
}: {
  accessToken: string
  allowPrices: boolean
  showStock: boolean
  customerName: string
}) {
  const productsQuery = useQuery({
    queryKey: ["public-catalog-products", accessToken],
    queryFn: () => getPublicCatalogProducts(accessToken),
  })
  const [search, setSearch] = useState("")
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const [cart, setCart] = useState<CartLine[]>([])
  const [notes, setNotes] = useState("")
  const [submittedId, setSubmittedId] = useState<string | null>(null)

  const products = productsQuery.data ?? []
  const categories = useMemo(
    () => Array.from(new Set(products.map((product) => product.category).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    [products],
  )
  const [category, setCategory] = useState("all")

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter((product) => {
      const matchesCategory = category === "all" || product.category === category
      const matchesSearch =
        !q ||
        [product.name, product.itemNumber, product.category ?? ""].some((value) => value.toLowerCase().includes(q))
      return matchesCategory && matchesSearch && product.currentStock > 0
    })
  }, [products, search, category])

  const suggestions = visibleProducts.slice(0, 8)
  const subtotal = cart.reduce((sum, line) => sum + line.quantity * unitPrice(line.product, line.unit), 0)
  const totalItems = cart.reduce((sum, line) => sum + line.quantity, 0)
  const canSubmit = cart.length > 0

  const orderMutation = useMutation({
    mutationFn: () =>
      submitPublicCatalogOrder(
        {
          customerName,
          phone: "approved",
          notes: notes.trim() || undefined,
          items: cart.map((line) => ({
            productId: line.product.id,
            unit: line.unit,
            quantity: line.quantity,
          })),
        },
        accessToken,
      ),
    onSuccess: (response) => {
      setSubmittedId(response.data?.approvalId ?? "ok")
      setCart([])
      setNotes("")
    },
  })

  function addProduct(product: PublicCatalogProduct, unit: CatalogUnit = "PIECE") {
    const max = maxQuantity(product, unit)
    if (max < 1) return
    setSubmittedId(null)
    setCart((prev) => {
      const id = lineKey(product.id, unit)
      const current = prev.find((line) => line.id === id)
      if (current) return prev.map((line) => (line.id === id ? { ...line, quantity: Math.min(line.quantity + 1, max) } : line))
      return [...prev, { id, product, unit, quantity: 1 }]
    })
  }

  function changeQuantity(lineId: string, delta: number) {
    setCart((prev) =>
      prev.map((line) =>
        line.id === lineId
          ? { ...line, quantity: Math.max(1, Math.min(maxQuantity(line.product, line.unit), line.quantity + delta)) }
          : line,
      ),
    )
  }

  function setLineUnit(lineId: string, unit: CatalogUnit) {
    setCart((prev) => {
      const target = prev.find((line) => line.id === lineId)
      if (!target) return prev
      const max = maxQuantity(target.product, unit)
      if (max < 1) return prev.filter((line) => line.id !== lineId)
      const newId = lineKey(target.product.id, unit)
      const withoutTarget = prev.filter((line) => line.id !== lineId)
      const existing = withoutTarget.find((line) => line.id === newId)
      if (existing) {
        return withoutTarget.map((line) =>
          line.id === newId ? { ...line, quantity: Math.min(line.quantity + target.quantity, max) } : line,
        )
      }
      return [...withoutTarget, { ...target, id: newId, unit, quantity: Math.min(target.quantity, max) }]
    })
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length === 0) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActiveSuggestion((value) => Math.min(value + 1, suggestions.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActiveSuggestion((value) => Math.max(value - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      addProduct(suggestions[activeSuggestion] ?? suggestions[0])
    } else if (event.key === "Escape") {
      setSearch("")
      setActiveSuggestion(0)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900" dir="rtl">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold">كتالوج المنتجات</h1>
            <p className="text-sm text-slate-500">أهلاً {customerName}. اختار المواد وارسل الطلب للمراجعة.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{allowPrices ? "الأسعار ظاهرة" : "الأسعار مخفية"}</Badge>
            {!showStock && <Badge variant="outline">الكميات مخفية</Badge>}
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
              <ShoppingCart className="h-4 w-4" />
              {totalItems} مادة في السلة
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-5 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_390px]">
        <section className="space-y-4">
          <div className="rounded-lg border bg-white p-3 shadow-sm">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="h-11 pr-9"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setActiveSuggestion(0)
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="ابحث باسم المادة أو الرمز أو الصنف"
              />
              {search.trim() && suggestions.length > 0 ? (
                <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border bg-white shadow-lg">
                  {suggestions.map((product, index) => (
                    <button
                      key={product.id}
                      type="button"
                      className={cn("flex w-full items-center gap-3 px-3 py-2 text-right text-sm", index === activeSuggestion ? "bg-emerald-50" : "hover:bg-slate-50")}
                      onMouseEnter={() => setActiveSuggestion(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => addProduct(product)}
                    >
                      <ProductThumb product={product} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{product.name}</span>
                        <span className="text-xs text-slate-500">{product.itemNumber}{showStock ? ` - المتوفر ${money(product.currentStock)}` : ""}</span>
                      </span>
                      {allowPrices ? <Badge>{money(product.salePrice)} د.ع</Badge> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <FilterButton active={category === "all"} onClick={() => setCategory("all")}>الكل</FilterButton>
              {categories.map((item) => (
                <FilterButton key={item} active={category === item} onClick={() => setCategory(item)}>{item}</FilterButton>
              ))}
            </div>
          </div>

          {productsQuery.isLoading ? <EmptyState>جاري تحميل المنتجات...</EmptyState> : null}
          {!productsQuery.isLoading && visibleProducts.length === 0 ? <EmptyState>لا توجد مواد متوفرة مطابقة للبحث.</EmptyState> : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleProducts.map((product) => (
              <Card key={product.id} className="overflow-hidden">
                <div className="aspect-[4/3] bg-slate-100">
                  {product.imageUrl ? (
                    <img className="h-full w-full object-cover" src={product.imageUrl} alt={product.name} loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">
                      <ImageIcon className="ml-2 h-5 w-5" /> بدون صورة
                    </div>
                  )}
                </div>
                <CardContent className="space-y-3 p-4">
                  <div className="min-h-16">
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-bold leading-6">{product.name}</h2>
                      <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-xs text-slate-500">{product.itemNumber}</span>
                    </div>
                    {product.category ? <p className="mt-1 text-xs text-slate-500">{product.category}</p> : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">سعر القطعة</p>
                      <p className="font-extrabold text-emerald-700">{allowPrices ? `${money(product.salePrice)} د.ع` : "مخفي"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">المتوفر</p>
                      <p className="font-bold">{showStock ? `${money(product.currentStock)} قطعة` : "متوفر"}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(["PIECE", "DOZEN", "CARTON"] as const).map((unit) => (
                      <Button key={unit} variant={unit === "PIECE" ? "default" : "outline"} className="h-9 px-2 text-xs" disabled={maxQuantity(product, unit) < 1} onClick={() => addProduct(product, unit)}>
                        {unitLabels[unit]}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-emerald-600" /> السلة
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cart.length === 0 ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">السلة فارغة.</p> : null}
              {cart.map((line) => (
                <div key={line.id} className="rounded-lg border p-3">
                  <div className="flex items-start gap-3">
                    <ProductThumb product={line.product} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{line.product.name}</p>
                      <p className="text-xs text-slate-500">
                        {allowPrices ? `${money(unitPrice(line.product, line.unit))} د.ع / ` : ""}{unitLabels[line.unit]}
                      </p>
                    </div>
                    <button className="text-rose-500" onClick={() => setCart((prev) => prev.filter((row) => row.id !== line.id))} aria-label="حذف من السلة">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1">
                    {(["PIECE", "DOZEN", "CARTON"] as const).map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        disabled={maxQuantity(line.product, unit) < 1}
                        onClick={() => setLineUnit(line.id, unit)}
                        className={cn("rounded-md border px-2 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40", line.unit === unit ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "bg-white text-slate-600")}
                      >
                        {unitLabels[unit]}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="flex items-center rounded-md border">
                      <button className="p-2" onClick={() => changeQuantity(line.id, -1)} aria-label="تقليل"><Minus className="h-4 w-4" /></button>
                      <span className="min-w-10 text-center font-bold">{line.quantity}</span>
                      <button className="p-2" onClick={() => changeQuantity(line.id, 1)} aria-label="زيادة"><Plus className="h-4 w-4" /></button>
                    </div>
                    {allowPrices ? <p className="font-bold">{money(line.quantity * unitPrice(line.product, line.unit))} د.ع</p> : null}
                  </div>
                </div>
              ))}
              {allowPrices ? (
                <div className="flex justify-between border-t pt-3 text-lg font-extrabold">
                  <span>المجموع</span>
                  <span>{money(subtotal)} د.ع</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-sky-600" /> إرسال الطلب
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظات اختيارية" />
              <Button className="w-full" disabled={!canSubmit || orderMutation.isPending} onClick={() => orderMutation.mutate()}>
                {orderMutation.isPending ? "جاري الإرسال..." : "إرسال الطلب"}
              </Button>
              {submittedId ? (
                <div className="flex items-center gap-2 rounded-md bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" />
                  تم إرسال الطلب وينتظر موافقة الإدارة.
                </div>
              ) : null}
              {orderMutation.isError ? <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">تعذر إرسال الطلب.</div> : null}
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  )
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700")}
    >
      {children}
    </button>
  )
}

function EmptyState({ children }: { children: string }) {
  return <div className="rounded-lg border border-dashed bg-white p-8 text-center text-sm text-slate-500">{children}</div>
}

function ProductThumb({ product }: { product: PublicCatalogProduct }) {
  return product.imageUrl ? (
    <img src={product.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" loading="lazy" />
  ) : (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400">
      <ImageIcon className="h-4 w-4" />
    </div>
  )
}
