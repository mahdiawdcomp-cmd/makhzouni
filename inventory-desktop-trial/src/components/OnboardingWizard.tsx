import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, ChevronLeft, Package, Receipt, UserPlus, X } from "lucide-react"
import { getProducts, getCustomers, getInvoices } from "../api/endpoints"
import { useAuthStore } from "../store/authStore"

const STORAGE_KEY = "onboarding_dismissed_v1"

interface Step {
  id: string
  icon: typeof Package
  title: string
  description: string
  action: string
  path: string
  checkFn: (data: OnboardingData) => boolean
}

interface OnboardingData {
  hasProducts: boolean
  hasCustomers: boolean
  hasInvoices: boolean
}

const STEPS: Step[] = [
  {
    id: "product",
    icon: Package,
    title: "أضف أول منتج",
    description: "ابدأ بإضافة المواد أو البضاعة التي تبيعها في محلك.",
    action: "إضافة منتج",
    path: "/inventory",
    checkFn: (d) => d.hasProducts,
  },
  {
    id: "customer",
    icon: UserPlus,
    title: "أضف أول زبون",
    description: "أضف بيانات زبائنك لتتمكن من إنشاء الفواتير وتتبع الديون.",
    action: "إضافة زبون",
    path: "/customers",
    checkFn: (d) => d.hasCustomers,
  },
  {
    id: "invoice",
    icon: Receipt,
    title: "أنشئ أول فاتورة",
    description: "فاتورة البيع تحدّث المخزون ورصيد الزبون تلقائياً.",
    action: "إنشاء فاتورة",
    path: "/invoices/new",
    checkFn: (d) => d.hasInvoices,
  },
]

export function OnboardingWizard() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1" } catch { return false }
  })

  // Only show for ADMIN on first use
  if (!user || user.role !== "ADMIN" || dismissed) return null

  return <WizardContent onDismiss={() => { setDismissed(true); try { localStorage.setItem(STORAGE_KEY, "1") } catch {} }} navigate={navigate} />
}

function WizardContent({ onDismiss, navigate }: { onDismiss: () => void; navigate: ReturnType<typeof useNavigate> }) {
  const productsQ  = useQuery({ queryKey: ["products"],  queryFn: () => getProducts(),  staleTime: 30_000 })
  const customersQ = useQuery({ queryKey: ["customers"], queryFn: () => getCustomers(), staleTime: 30_000 })
  const invoicesQ  = useQuery({ queryKey: ["invoices"],  queryFn: () => getInvoices(),  staleTime: 30_000 })

  const data: OnboardingData = {
    hasProducts:  (productsQ.data?.length  ?? 0) > 0,
    hasCustomers: (customersQ.data?.length ?? 0) > 0,
    hasInvoices:  (invoicesQ.data?.length  ?? 0) > 0,
  }

  const completedCount = STEPS.filter((s) => s.checkFn(data)).length
  const allDone = completedCount === STEPS.length

  // Auto-dismiss once all steps completed
  useEffect(() => {
    if (allDone) {
      const timer = setTimeout(onDismiss, 3000)
      return () => clearTimeout(timer)
    }
  }, [allDone, onDismiss])

  const progress = Math.round((completedCount / STEPS.length) * 100)

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[340px] rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-700">
        <div>
          <div className="text-sm font-bold">
            {allDone ? "🎉 أحسنت! كل الخطوات اكتملت" : "مرحباً في مخزوني"}
          </div>
          <div className="text-xs text-slate-500">
            {allDone ? "سيُغلق الدليل خلال ثوانٍ..." : `${completedCount} من ${STEPS.length} خطوات مكتملة`}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-slate-100 dark:bg-slate-800">
        <div
          className="h-1 rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Steps */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {STEPS.map((step) => {
          const done = step.checkFn(data)
          const Icon = step.icon
          return (
            <div key={step.id} className={`flex items-start gap-3 p-3 ${done ? "opacity-60" : ""}`}>
              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className={`text-sm font-medium ${done ? "line-through" : ""}`}>{step.title}</span>
                  {!done ? (
                    <button
                      type="button"
                      onClick={() => navigate(step.path)}
                      className="flex shrink-0 items-center gap-1 rounded bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-amber-600"
                    >
                      {step.action}
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">{step.description}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
