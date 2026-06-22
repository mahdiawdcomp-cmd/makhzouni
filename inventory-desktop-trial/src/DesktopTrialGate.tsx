import { useState, type ReactNode } from "react"
import { ArrowLeft, BadgeCheck, Building2, Check, KeyRound, PackageCheck, Phone, ShieldCheck, Sparkles } from "lucide-react"
import { login } from "./api/endpoints"
import { useAuthStore } from "./store/authStore"

type Activation =
  | { mode: "trial"; shopName: string; ownerName: string; phone: string; expiresAt: string }
  | { mode: "serial"; serial: string }

const STORAGE_KEY = "makhzouni-desktop-trial-activation-v2"

function readActivation(): Activation | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    if (!value) return null

    const activation = JSON.parse(value) as Activation
    if (activation.mode === "trial" && new Date(activation.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem("desktop_trial_shop_name")
      return null
    }

    return activation
  } catch {
    return null
  }
}

export function DesktopTrialGate({ children }: { children: ReactNode }) {
  const [activation, setActivation] = useState<Activation | null>(() => readActivation())
  const [screen, setScreen] = useState<"welcome" | "trial" | "serial">("welcome")
  const [trial, setTrial] = useState({ shopName: "", ownerName: "", phone: "" })
  const [serial, setSerial] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const setSession = useAuthStore((state) => state.setSession)

  function save(value: Activation) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    localStorage.setItem("desktop_trial_shop_name", value.mode === "trial" ? value.shopName : "نسخة مفعّلة")
    setActivation(value)
  }

  async function enterFullApp() {
    const response = await login({ username: "admin", password: "Password123!" })
    if (!response.token || !response.user) throw new Error("تعذر فتح الحساب التجريبي")
    setSession(response.token, response.user, true)
  }

  async function startTrial() {
    if (!trial.shopName.trim() || !trial.ownerName.trim() || trial.phone.trim().length < 7) {
      setError("اكتب اسم المحل واسم صاحب المحل ورقم الهاتف.")
      return
    }
    setLoading(true)
    setError("")
    try {
      await enterFullApp()
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 30)
      save({ mode: "trial", ...trial, expiresAt: expiresAt.toISOString() })
    } catch {
      setError("تعذر تشغيل بيئة التجربة. تأكد أن خدمة التجربة تعمل.")
    } finally {
      setLoading(false)
    }
  }

  async function activateSerial() {
    if (serial.trim().length < 8) {
      setError("السيريال غير مكتمل.")
      return
    }
    setLoading(true)
    setError("")
    try {
      await enterFullApp()
      save({ mode: "serial", serial: serial.trim().toUpperCase() })
    } catch {
      setError("تعذر تشغيل بيئة التفعيل التجريبية.")
    } finally {
      setLoading(false)
    }
  }

  if (activation) return children

  return (
    <main className="activation-page">
      <section className="hero-panel">
        <div className="hero-logo"><PackageCheck size={34} /></div>
        <span className="eyebrow light">برنامج الحسابات والمخزون</span>
        <h1>كل البرنامج الأصلي،<br />داخل نسخة الكمبيوتر.</h1>
        <p>بعد بدء التجربة تدخل إلى لوحة مخزوني الكاملة: الفواتير والمواد والزبائن والسندات والتقارير والإعدادات.</p>
        <ul>
          <li><Check /> تجربة كاملة لمدة 30 يوماً</li>
          <li><Check /> لا يحتاج الزبون فتح موقع أو متصفح</li>
          <li><Check /> بيئة التجارب ستكون منفصلة عن نظامك الحالي</li>
        </ul>
        <div className="hero-foot"><ShieldCheck /> مشروع مستقل — لا يغيّر ملفات أو بيانات الإنتاج</div>
      </section>

      <section className="form-panel">
        <div className="form-wrap">
          {screen !== "welcome" && (
            <button className="back" onClick={() => { setScreen("welcome"); setError("") }}>
              <ArrowLeft size={17} /> رجوع
            </button>
          )}

          {screen === "welcome" && (
            <>
              <span className="eyebrow">أهلاً بك في مخزوني</span>
              <h2>ابدأ بالطريقة المناسبة</h2>
              <p className="lead">جرّب البرنامج كاملاً، أو فعّل نسختك بالسيريال.</p>
              <button className="choice primary-choice" onClick={() => setScreen("trial")}>
                <div className="choice-icon"><Sparkles /></div>
                <div><strong>تجربة مجانية 30 يوم</strong><span>الدخول إلى البرنامج الكامل</span></div>
                <ArrowLeft />
              </button>
              <button className="choice" onClick={() => setScreen("serial")}>
                <div className="choice-icon key"><KeyRound /></div>
                <div><strong>عندي سيريال تفعيل</strong><span>تفعيل النسخة الخاصة بالمحل</span></div>
                <ArrowLeft />
              </button>
              <p className="privacy"><ShieldCheck /> هذه النسخة لا تتصل ببيانات الإنتاج.</p>
            </>
          )}

          {screen === "trial" && (
            <>
              <span className="eyebrow">التجربة المجانية</span>
              <h2>بيانات المحل</h2>
              <p className="lead">بعدها يفتح البرنامج الأصلي كاملاً.</p>
              <Field icon={<Building2 />} label="اسم المحل" value={trial.shopName} onChange={(shopName) => setTrial({ ...trial, shopName })} placeholder="مثال: أسواق الرافدين" />
              <Field icon={<BadgeCheck />} label="اسم صاحب المحل" value={trial.ownerName} onChange={(ownerName) => setTrial({ ...trial, ownerName })} placeholder="الاسم الكامل" />
              <Field icon={<Phone />} label="رقم الهاتف" value={trial.phone} onChange={(phone) => setTrial({ ...trial, phone })} placeholder="07xxxxxxxxx" dir="ltr" />
              {error && <p className="error">{error}</p>}
              <button className="submit" onClick={() => void startTrial()} disabled={loading}><Sparkles size={19} /> {loading ? "جاري تجهيز البرنامج..." : "ابدأ واستخدم البرنامج"}</button>
            </>
          )}

          {screen === "serial" && (
            <>
              <span className="eyebrow">تفعيل البرنامج</span>
              <h2>أدخل السيريال</h2>
              <p className="lead">التحقق الحقيقي من السيريال سيُربط بخدمة التجارب المنفصلة.</p>
              <Field icon={<KeyRound />} label="السيريال" value={serial} onChange={(value) => setSerial(value.toUpperCase())} placeholder="MKZ-XXXX-XXXX-XXXX" dir="ltr" />
              {error && <p className="error">{error}</p>}
              <button className="submit dark" onClick={() => void activateSerial()} disabled={loading}><KeyRound size={19} /> {loading ? "جاري التفعيل..." : "تفعيل البرنامج"}</button>
            </>
          )}
        </div>
      </section>
    </main>
  )
}

function Field({ icon, label, value, onChange, placeholder, dir = "rtl" }: {
  icon: ReactNode
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  dir?: "rtl" | "ltr"
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div>{icon}<input dir={dir} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>
    </label>
  )
}
