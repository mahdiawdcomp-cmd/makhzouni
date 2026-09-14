/**
 * What the rep sees right after picking a customer: «يشتريها عادةً» and the
 * customer's own standing offers.
 *
 * Both are server reads. The historical price is never a price to sell at — it
 * appears only inside the change note — and today's price, including any offer
 * or approved special price, is whatever the server says it is.
 */
import { useQuery } from "@tanstack/react-query"
import { Button } from "../../components/ui/button"
import { Card, CardContent } from "../../components/ui/card"
import { api } from "../../api/client"
import { QueryErrorBox } from "../../components/ui/query-error"
import { apiErrorMessage } from "../../utils/apiError"
import { AgentLoading, AgentStatusPill, PriceChangeNote } from "./shared"
import { UNIT_LABEL, money, shortDate } from "./format"
import type { AgentMode, AgentUnit } from "../../utils/salesAgentDrafts"
import type { CustomerOffer, UsualProduct } from "./types"

function useUsualProducts(customerId: string | null, mode: AgentMode) {
  return useQuery({
    queryKey: ["sales-agent", "usual-products", customerId, mode],
    enabled: Boolean(customerId),
    queryFn: async () => {
      const res = await api.get<{ data: { products: UsualProduct[] } }>(
        `/sales-agent/customers/${customerId}/frequent-products`,
        { params: { priceMode: mode } },
      )
      return res.data.data?.products ?? []
    },
    // A dropped connection must not read as «ما عنده مواد معتادة».
    retry: 3,
  })
}

function useCustomerOffers(customerId: string | null) {
  return useQuery({
    queryKey: ["sales-agent", "customer-offers", customerId],
    enabled: Boolean(customerId),
    queryFn: async () => {
      const res = await api.get<{ data: { offers: CustomerOffer[] } }>(
        `/sales-agent/customers/${customerId}/offers`,
        { params: { liveOnly: true } },
      )
      return res.data.data?.offers ?? []
    },
    retry: 3,
  })
}

export function CustomerInsights({
  customerId,
  mode,
  disabled,
  onAdd,
}: {
  customerId: string | null
  mode: AgentMode
  /** True while an unconfirmed attempt is open: nothing may be added to it. */
  disabled: boolean
  onAdd: (productId: string, unit: AgentUnit, quantity: number) => void
}) {
  const usual = useUsualProducts(customerId, mode)
  const offers = useCustomerOffers(customerId)

  if (!customerId) return null

  return (
    <div className="space-y-4">
      <section aria-labelledby="usual-heading">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id="usual-heading" className="text-[15px] font-semibold">
            يشتريها عادةً
          </h3>
          {usual.data && usual.data.length > 0 && (
            <span className="text-[12px] text-slate-500">من فواتيره الفعلية</span>
          )}
        </div>

        {usual.isLoading ? (
          <AgentLoading label="جاري قراءة مشترياته…" />
        ) : usual.isError ? (
          <QueryErrorBox
            title={apiErrorMessage(usual.error, "ما كدرنا نقرأ مشتريات الزبون")}
            onRetry={() => void usual.refetch()}
          />
        ) : (usual.data ?? []).length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-sm text-slate-500">
              ماكو مواد سابقة تنطبق على هذا الوضع — إما ما اشترى بعد، أو مواده غير متوفرة الآن.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {(usual.data ?? []).map((row) => (
              <li key={`${row.productId}:${row.unit}`}>
                <Card>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{row.productName}</p>
                        <p className="mt-0.5 text-[12px] text-slate-500">
                          اشتراها {row.times} مرة · متوسط آخر {row.averageSampleSize} مشتريات{" "}
                          {row.suggestedQuantity} {UNIT_LABEL[row.unit]} · آخر شراء {shortDate(row.lastPurchaseAt)}
                        </p>
                        {row.stockCapped && (
                          <p className="text-[12px] text-amber-700 dark:text-amber-300">
                            قلّلنا المقترح حسب المتوفر بالمحل
                          </p>
                        )}
                        {!row.averageMatchesPriceMode && (
                          <p className="text-[12px] text-slate-500">
                            المتوسط من مشترياته بأنواع سعر ثانية — ما عنده مشتريات بهذا الوضع
                          </p>
                        )}
                      </div>
                      {row.priceSource === "OFFER" && <AgentStatusPill tone="ok">عرض خاص</AgentStatusPill>}
                      {row.priceSource === "APPROVED_REQUEST" && (
                        <AgentStatusPill tone="ok">سعر موافَق عليه</AgentStatusPill>
                      )}
                    </div>

                    <p className="mt-2 text-sm font-semibold">
                      {money(row.currentPrice)} / {UNIT_LABEL[row.unit]}
                      {row.currentPrice !== row.catalogPrice && (
                        <span className="ms-2 text-[12px] font-normal text-slate-500 line-through">
                          {money(row.catalogPrice)}
                        </span>
                      )}
                    </p>
                    <PriceChangeNote change={row.priceChange} />

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[12px] text-slate-500">المتوفر: {row.availableStock}</span>
                      <Button
                        className="h-11"
                        disabled={disabled}
                        onClick={() => onAdd(row.productId, row.unit, row.suggestedQuantity)}
                      >
                        أضف {row.suggestedQuantity} {UNIT_LABEL[row.unit]}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(offers.data ?? []).length > 0 && (
        <section aria-labelledby="offers-heading">
          <h3 id="offers-heading" className="mb-2 text-[15px] font-semibold">
            عروض خاصة لهذا الزبون
          </h3>
          <ul className="space-y-2">
            {(offers.data ?? []).map((offer) => (
              <li key={offer.id}>
                <Card>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate font-semibold">{offer.productName}</p>
                      <AgentStatusPill tone="ok">
                        {offer.priceMode === "CARTON" ? "توزيع كراتين" : "جملة"}
                      </AgentStatusPill>
                    </div>
                    <p className="mt-1 text-sm">
                      {UNIT_LABEL[offer.unit]} ·{" "}
                      {offer.offerPrice === null ? (
                        <span className="text-amber-700">العرض غير قابل للتطبيق — راجع الإدارة</span>
                      ) : (
                        <>
                          <span className="font-semibold">{money(offer.offerPrice)}</span>
                          <span className="ms-2 text-[12px] text-slate-500 line-through">
                            {money(offer.catalogPrice)}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="mt-1 text-[12px] text-slate-500">
                      فعال لغاية نهاية يوم {offer.endsOnDate}
                      {offer.note ? ` · ${offer.note}` : ""}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-slate-500">
            بعد انتهاء العرض يرجع السعر الطبيعي تلقائياً. السعر النهائي يحدده السيرفر وقت المراجعة.
          </p>
        </section>
      )}
    </div>
  )
}
