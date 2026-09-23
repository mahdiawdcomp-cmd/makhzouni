import { useState } from "react"
import { API_BASE_URL } from "../api/client"

/**
 * «السيرفر ما يرد» — the rescue page.
 *
 * Shown when the server has been silent for more than an hour, which is long
 * past a passing glitch: at that point something is actually wrong and the
 * person in front of the screen is a shopkeeper with customers waiting, not
 * an engineer. So this page answers, in his own language and in order: what
 * happened, whether his data is safe, what he can check himself in one
 * minute, and what to do to keep selling meanwhile.
 *
 * It is deliberately NOT a locked door — «أكمل بدون سيرفر» closes it for this
 * session, because a wrong diagnosis must never be the thing that stops him
 * from using his own program.
 */

/** The shop's backend as it reaches the server today. */
const currentUrl = API_BASE_URL

/**
 * The backup address of the same server, which keeps working when the domain
 * is the thing that broke: it belongs to the host, not to the domain name.
 */
const FALLBACK_API = "https://inventory-backend-production-7e85.up.railway.app/api"
const FALLBACK_SITE = "https://mahdi.mazbwoni.com"

function hours(ms: number) {
  const total = Math.floor(ms / 60000)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h <= 0) return `${m} دقيقة`
  if (m === 0) return `${h} ساعة`
  return `${h} ساعة و${m} دقيقة`
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3">
      <span className="text-sm font-bold text-slate-700">{label}</span>
      <code dir="ltr" className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-white px-3 py-2 text-xs text-slate-800 ring-1 ring-slate-200">
        {value}
      </code>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 2000)
          } catch { /* the address is on screen either way */ }
        }}
        className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-bold text-slate-700"
      >
        {copied ? "انتسخ" : "انسخ"}
      </button>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-sm font-bold text-white">
        {n}
      </span>
      <div className="flex-1 space-y-2 pt-0.5">
        <p className="font-bold text-slate-800">{title}</p>
        <div className="space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
      </div>
    </div>
  )
}

export function ServerOutageScreen({
  downForMs,
  offline,
  checking,
  onRetry,
  onDismiss,
}: {
  downForMs: number
  offline: boolean
  checking: boolean
  onRetry: () => void
  onDismiss: () => void
}) {
  return (
    <div dir="rtl" className="h-screen overflow-y-auto bg-slate-100 p-4 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-4 pb-10">
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold text-rose-700">السيرفر ما يرد من {hours(downForMs)}</h1>
          <p className="mt-3 text-lg leading-relaxed text-slate-700">
            البرنامج يحاول يتصل بسيرفر محلك وما يوصله جواب. هذي الصفحة تكلك شنو تسوي بالترتيب.
          </p>
          <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-base font-bold text-emerald-800">
            بياناتك محفوظة. لا تحذف البرنامج، ولا تنصّبه من جديد، ولا تمسح شي — التنصيب من جديد ما
            يرجّع السيرفر، ويضيّع إعداداتك.
          </p>
        </div>

        {offline && (
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
            <p className="text-lg font-bold text-amber-900">جهازك يكول ماكو إنترنت</p>
            <p className="mt-2 text-sm leading-relaxed text-amber-800">
              يمكن المشكلة عندك مو بالسيرفر. تأكد من الواي فاي أو الكيبل أول شي، وبعدين اضغط
              «حاول مرة ثانية».
            </p>
          </div>
        )}

        <div className="space-y-5 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">افحص بالترتيب</h2>

          <Step n={1} title="افتح الموقع من موبايلك">
            <p>
              افتح <span className="font-bold">{FALLBACK_SITE}</span> من الموبايل وعلى بيانات
              الموبايل مو على واي فاي المحل.
            </p>
            <p>
              إذا الموقع فتح من الموبايل وما فتح بالكمبيوتر، المشكلة بإنترنت المحل أو بجهازك —
              مو بالسيرفر.
            </p>
          </Step>

          <Step n={2} title="جرّب الرابط البديل للسيرفر">
            <p>
              إذا الدومين هو الي وقف، السيرفر نفسه يبقى شغال على عنوانه الخاص. من البرنامج:
              الإعدادات ← تبويب «ربط السيرفر» ← حط الرابط البديل ← احفظ ← سكّر البرنامج وافتحه.
            </p>
            <CopyRow label="الرابط البديل" value={FALLBACK_API} />
            <CopyRow label="الرابط الحالي" value={currentUrl} />
          </Step>

          <Step n={3} title="افحص الاشتراك والدفع">
            <p>
              أكثر سبب يوقف السيرفر فجأة هو فشل الدفع الشهري. ادخل حساب الاستضافة وشوف إذا أكو
              فاتورة ما انتدفعت أو تنبيه إيقاف.
            </p>
            <p>إذا الكارت مرفوض، جرّب كارت ثاني أو اشحن رصيد — الخدمة ترجع خلال دقائق من الدفع.</p>
          </Step>

          <Step n={4} title="إذا ما رجع، كمّل بيعك على ورق">
            <p>
              اكتب كل فاتورة وكل قبض على ورقة بالتسلسل: اسم الزبون، المواد، الكميات، الأسعار،
              والمبلغ المقبوض. وقت ما يرجع السيرفر ندخّلها كلها.
            </p>
            <p className="font-bold text-rose-700">
              لا تعتمد على ذاكرتك، ولا تسوي فواتير من بعد ما يرجع بدون ورق — هذا وين تضيع الفلوس.
            </p>
          </Step>

          <Step n={5} title="نسخك الاحتياطية">
            <p>
              النسخة اليومية تنحفظ على هذا الجهاز بمجلد البرنامج، ونسخة ثانية بالمكان الي حددته.
              حتى لو انمسحت بيانات المزوّد، المحل يرجع من النسخة.
            </p>
          </Step>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold">شنو ممكن يكون صاير</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-600">
            <li>• الدفع الشهري ما تم — الاستضافة وقّفت الخدمة.</li>
            <li>• الدومين منتهي أو معطّل — السيرفر شغال بس الاسم ما يدل عليه، والحل الخطوة ٢.</li>
            <li>• المزوّد عنده عطل عام — ينتظر، عادة يرجع بساعات.</li>
            <li>• إنترنت المحل مقطوع — الخطوة ١ تكشفها.</li>
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onRetry}
            disabled={checking}
            className="rounded-2xl bg-indigo-600 px-8 py-4 text-lg font-bold text-white disabled:opacity-60"
          >
            {checking ? "يفحص…" : "حاول مرة ثانية"}
          </button>
          <button onClick={onDismiss} className="rounded-2xl bg-white px-6 py-4 text-base font-bold text-slate-600 shadow-sm">
            أكمل بدون سيرفر
          </button>
        </div>
      </div>
    </div>
  )
}
