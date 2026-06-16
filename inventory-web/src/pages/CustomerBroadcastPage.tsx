import { useMemo, useState } from "react"
import { usePageTitle } from "../hooks/usePageTitle"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Megaphone, Package, Search, Send, Tag, X } from "lucide-react"
import { broadcastToCustomers, getCustomerTags, getCustomersPaged, getProducts } from "../api/endpoints"
import { Button } from "../components/ui/button"
import { Card, CardContent } from "../components/ui/card"
import { ConfirmDialog } from "../components/ui/confirm-dialog"
import { Input } from "../components/ui/input"
import { toast } from "../components/ui/use-toast"
import type { Product } from "../types/api"

const MAX_PRODUCTS = 10

export function CustomerBroadcastPage() {
  usePageTitle("إرسال - زبائن الجملة")

  const tagsQuery = useQuery({ queryKey: ["customer-tags"], queryFn: getCustomerTags })
  const tags = tagsQuery.data ?? []
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const recipientsQuery = useQuery({
    queryKey: ["customers-by-tags-count", selectedTags],
    queryFn: () => getCustomersPaged({ tags: selectedTags, limit: 1 }),
    enabled: selectedTags.length > 0,
  })
  const recipientCount = recipientsQuery.data?.pagination?.total ?? 0

  const [productSearch, setProductSearch] = useState("")
  const productsQuery = useQuery({
    queryKey: ["products-search", productSearch],
    queryFn: () => getProducts({ search: productSearch || undefined, limit: 20 }),
  })
  const [selectedProducts, setSelectedProducts] = useState<Product[]>([])

  const [message, setMessage] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)

  const sendMutation = useMutation({
    mutationFn: () => broadcastToCustomers({ tags: selectedTags, productIds: selectedProducts.map((p) => p.id), message: message.trim() }),
    onSuccess: (res) => {
      toast({ title: res.message ?? `جارٍ الإرسال إلى ${recipientCount} زبون` })
      setConfirmOpen(false)
      setMessage("")
      setSelectedProducts([])
      setSelectedTags([])
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : "تعذر الإرسال", variant: "destructive" }),
  })

  function toggleTag(tag: string) {
    setSelectedTags((cur) => (cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag]))
  }

  function toggleProduct(product: Product) {
    setSelectedProducts((cur) => {
      if (cur.some((p) => p.id === product.id)) return cur.filter((p) => p.id !== product.id)
      if (cur.length >= MAX_PRODUCTS) {
        toast({ title: `حد أقصى ${MAX_PRODUCTS} منتجات بالرسالة الواحدة`, variant: "destructive" })
        return cur
      }
      return [...cur, product]
    })
  }

  const productsWithoutImage = useMemo(() => selectedProducts.filter((p) => !p.imageUrl).length, [selectedProducts])

  const canSend = selectedTags.length > 0 && selectedProducts.length > 0 && message.trim().length > 0 && recipientCount > 0

  return (
    <div className="space-y-4" dir="rtl">
      <div>
        <h1 className="text-xl font-bold text-[var(--theme-textPrimary)] flex items-center gap-2">
          <Megaphone className="h-5 w-5" /> إرسال - زبائن الجملة
        </h1>
        <p className="text-sm text-slate-500">اختر التاكات المستهدفة، اختر منتجات من المخزون، واكتب رسالتك — رابط الكاتلوك يضاف تلقائياً.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Tag className="h-4 w-4" /> التاكات المستهدفة
            </div>
            {tagsQuery.isLoading && <p className="text-sm text-slate-400">جاري التحميل...</p>}
            {!tagsQuery.isLoading && tags.length === 0 && (
              <p className="text-sm text-slate-500">لا يوجد تاكات بعد. أضف تاكات للزبائن من صفحة الزبائن أو صفحة الاستيراد أولاً.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={
                    "rounded-full px-3 py-1.5 text-sm font-medium transition " +
                    (selectedTags.includes(tag)
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300")
                  }
                >
                  {tag}
                </button>
              ))}
            </div>
            {selectedTags.length > 0 && (
              <div className="rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-200">
                {recipientsQuery.isLoading ? "جاري الحساب..." : <>سيتم الإرسال إلى <b>{recipientCount}</b> زبون مطابق.</>}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              <Package className="h-4 w-4" /> المنتجات ({selectedProducts.length}/{MAX_PRODUCTS})
            </div>
            {selectedProducts.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedProducts.map((p) => (
                  <span key={p.id} className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" className="h-4 w-4 rounded-full object-cover" /> : null}
                    {p.name}
                    <button type="button" onClick={() => toggleProduct(p)}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <Search className="absolute right-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pr-8" placeholder="بحث عن منتج..." value={productSearch} onChange={(e) => setProductSearch(e.target.value)} />
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-100 dark:border-slate-800">
              {productsQuery.isLoading && <p className="p-3 text-sm text-slate-400">جاري التحميل...</p>}
              {!productsQuery.isLoading && (productsQuery.data ?? []).length === 0 && <p className="p-3 text-sm text-slate-500">لا يوجد منتجات مطابقة.</p>}
              {(productsQuery.data ?? []).map((p) => {
                const checked = selectedProducts.some((sp) => sp.id === p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggleProduct(p)}
                    className={"w-full flex items-center gap-2 px-3 py-2 text-right text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 " + (checked ? "bg-indigo-50 dark:bg-indigo-950/20" : "")}
                  >
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt="" className="h-8 w-8 rounded object-cover ring-1 ring-slate-200" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded bg-slate-100 text-slate-400 dark:bg-slate-800"><Package className="h-4 w-4" /></span>
                    )}
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-xs text-slate-400">{p.retailPrice} د.ع</span>
                    {checked && <span className="text-indigo-600 text-xs font-bold">✓</span>}
                  </button>
                )
              })}
            </div>
            {productsWithoutImage > 0 && (
              <p className="text-xs text-amber-600">{productsWithoutImage} من المنتجات المختارة بلا صورة — لن تُرسل صورتها (تأكد من إضافة صورة للمنتج أولاً إذا تريد).</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">نص الرسالة (تقدر تكتب عرض، بروموكود، أو أي ملاحظات)</label>
          <textarea
            className="w-full rounded-md border border-slate-200 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="مثال: وصلت بضاعة جديدة بالجملة! استخدم كود JUMLA10 لخصم 10% 🎁"
          />
          <Button className="w-full" disabled={!canSend || sendMutation.isPending} onClick={() => setConfirmOpen(true)}>
            <Send className="h-4 w-4" /> إرسال الآن
          </Button>
          <p className="text-center text-[11px] text-slate-400">ملاحظة: على WhatsApp Cloud API قد لا تصل الرسائل الدعائية للزبائن خارج نافذة ٢٤ ساعة من آخر تواصل.</p>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={`إرسال إلى ${recipientCount} زبون؟`}
        description={`سيتم إرسال ${selectedProducts.length} منتج مع رسالتك بالتتابع، مع تمهّل بسيط بين كل رسالة.`}
        confirmLabel="إرسال"
        onConfirm={() => sendMutation.mutate()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
