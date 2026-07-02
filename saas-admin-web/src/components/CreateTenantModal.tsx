import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { DOMAIN_ROOT, getErrorMessage, tenantsApi, type FeatureKey, type LicenseType, type Plan } from "../api/client";
import { LICENSE_TYPES, LICENSE_TYPE_LABELS } from "../entitlements";

const FEATURES: Array<{ key: FeatureKey; label: string }> = [
  { key: "ANDROID", label: "تطبيق أندرويد" }, { key: "CATALOG", label: "كتالوج العملاء" },
  { key: "POS", label: "نقطة البيع" }, { key: "AI", label: "المساعد الذكي" },
  { key: "WHATSAPP", label: "إشعارات واتساب" }, { key: "MULTI_WAREHOUSE", label: "تعدد المخازن" },
  { key: "QUOTATIONS", label: "عروض الأسعار" }, { key: "RETURNS", label: "المرتجعات" },
  { key: "OFFLINE", label: "العمل دون إنترنت" }, { key: "AUDIT_LOG", label: "سجل التدقيق" },
];

export default function CreateTenantModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", ownerName: "", phone: "", email: "", subdomain: "", backendUrl: "",
    plan: "BASIC" as Plan, expiresAt: "", price: "", billingCycle: "MONTHLY",
    maxUsers: "3", maxWarehouses: "1", maxAndroidDevices: "1",
    maxInvoices: "", maxCustomers: "", notes: "",
    features: ["POS", "RETURNS", "QUOTATIONS", "AUDIT_LOG"] as FeatureKey[],
    licenseType: "SAAS" as LicenseType, trialEndsAt: "", internalNotes: "",
  });
  const set = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }));
  const toggleFeature = (key: FeatureKey) => set("features", form.features.includes(key)
    ? form.features.filter((item) => item !== key) : [...form.features, key]);

  async function submit() {
    setLoading(true);
    setError("");
    try {
      await tenantsApi.create({
        name: form.name, ownerName: form.ownerName || undefined, phone: form.phone || undefined,
        email: form.email || undefined, subdomain: form.subdomain, backendUrl: form.backendUrl,
        notes: form.notes || undefined,
        // ── Batch 1: license / entitlements (tenant-level) ──
        licenseType: form.licenseType,
        expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
        trialEndsAt: form.trialEndsAt ? new Date(`${form.trialEndsAt}T23:59:59`).toISOString() : null,
        internalNotes: form.internalNotes || undefined,
        subscription: {
          plan: form.plan,
          expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
          price: form.price ? Number(form.price) : null,
          billingCycle: form.billingCycle,
          maxUsers: form.maxUsers ? Number(form.maxUsers) : null,
          maxWarehouses: form.maxWarehouses ? Number(form.maxWarehouses) : null,
          maxAndroidDevices: form.maxAndroidDevices ? Number(form.maxAndroidDevices) : null,
          maxInvoices: form.maxInvoices ? Number(form.maxInvoices) : null,
          maxCustomers: form.maxCustomers ? Number(form.maxCustomers) : null,
          currency: "IQD",
          features: form.features,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["tenants"] }),
        queryClient.invalidateQueries({ queryKey: ["tenant-summary"] }),
      ]);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
      <section className="modal" dir="rtl">
        <header className="modal-header"><div><h2>إضافة محل جديد</h2><p>الخطوة {step} من 2</p></div><button className="icon-command" onClick={onClose}><X size={19} /></button></header>
        <div className="steps"><span className={step >= 1 ? "done" : ""}>1. بيانات المحل</span><span className={step >= 2 ? "done" : ""}>2. الاشتراك والمزايا</span></div>
        <div className="modal-body">
          {step === 1 ? (
            <>
              <div className="form-grid">
                <label>اسم المحل *<input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="مثال: ألعاب مهدي" /></label>
                <label>اسم المالك<input value={form.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></label>
                <label>رقم الهاتف<input value={form.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" /></label>
                <label>البريد الإلكتروني<input value={form.email} onChange={(e) => set("email", e.target.value)} type="email" /></label>
              </div>
              <label>الرابط الفرعي *<div className="domain-input"><input dir="ltr" value={form.subdomain} onChange={(e) => set("subdomain", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="mahdi" /><span>.{DOMAIN_ROOT}</span></div></label>
              <label>رابط الباكند *<input dir="ltr" value={form.backendUrl} onChange={(e) => set("backendUrl", e.target.value)} placeholder="https://service.up.railway.app" /></label>
            </>
          ) : (
            <>
              <div className="form-grid">
                <label>نوع النسخة<select value={form.licenseType} onChange={(e) => set("licenseType", e.target.value)}>{LICENSE_TYPES.map((t) => <option key={t} value={t}>{LICENSE_TYPE_LABELS[t]}</option>)}</select></label>
                <label>تاريخ الانتهاء<input type="date" value={form.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} /></label>
                <label>انتهاء التجربة<input type="date" value={form.trialEndsAt} onChange={(e) => set("trialEndsAt", e.target.value)} /></label>
                <label>الباقة (قديمة)<select value={form.plan} onChange={(e) => set("plan", e.target.value)}><option value="TRIAL">تجريبية</option><option value="BASIC">أساسية</option><option value="PRO">احترافية</option><option value="FULL">كاملة</option></select></label>
                <label>سعر الاشتراك<input type="number" min="0" value={form.price} onChange={(e) => set("price", e.target.value)} placeholder="د.ع" /></label>
                <label>دورة الدفع<select value={form.billingCycle} onChange={(e) => set("billingCycle", e.target.value)}><option value="MONTHLY">شهري</option><option value="YEARLY">سنوي</option><option value="CUSTOM">مخصص</option></select></label>
                <label>عدد المستخدمين<input type="number" min="1" value={form.maxUsers} onChange={(e) => set("maxUsers", e.target.value)} /></label>
                <label>عدد المخازن<input type="number" min="1" value={form.maxWarehouses} onChange={(e) => set("maxWarehouses", e.target.value)} /></label>
                <label>أجهزة أندرويد<input type="number" min="0" value={form.maxAndroidDevices} onChange={(e) => set("maxAndroidDevices", e.target.value)} /></label>
                <label>حد الفواتير<input type="number" min="1" value={form.maxInvoices} onChange={(e) => set("maxInvoices", e.target.value)} placeholder="فارغ = غير محدود" /></label>
              </div>
              <label>المزايا</label>
              <div className="feature-grid">{FEATURES.map((feature) => <button type="button" key={feature.key} className={form.features.includes(feature.key) ? "feature selected" : "feature"} onClick={() => toggleFeature(feature.key)}><Check size={15} />{feature.label}</button>)}</div>
              <label>ملاحظات<textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} /></label>
              <label>ملاحظات داخلية (للسوبر أدمن فقط)<textarea value={form.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} rows={2} /></label>
            </>
          )}
          {error && <div className="alert error">{error}</div>}
        </div>
        <footer className="modal-footer">
          {step === 2 && <button className="secondary" onClick={() => setStep(1)}>السابق</button>}
          {step === 1
            ? <button className="primary" disabled={!form.name || !form.subdomain || !form.backendUrl} onClick={() => setStep(2)}>التالي</button>
            : <button className="primary" disabled={loading} onClick={submit}>{loading ? "جاري الإنشاء..." : "إنشاء المحل"}</button>}
        </footer>
      </section>
    </div>
  );
}
