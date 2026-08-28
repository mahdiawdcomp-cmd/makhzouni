import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { DOMAIN_ROOT, getErrorMessage, tenantsApi, type LicenseType, type Plan } from "../api/client";
import { FEATURE_GROUPS, isFeatureEnforced, LICENSE_TYPES, LICENSE_TYPE_LABELS } from "../entitlements";

// The features picked here are the TENANT-LEVEL entitlement keys — the same
// vocabulary the License tab edits and the only one the tenant backend
// actually gates on (`hasFeature` reads tenant.features). The old grid here
// used the legacy uppercase Subscription feature keys (ANDROID/POS/...), which
// no code gates on, so nothing an admin ticked at creation ever took effect
// and every new shop was created with an empty tenant.features — which the
// backend reads as "no entitlements configured ⇒ everything unlocked".
const DEFAULT_FEATURES = ["pos", "salesReturns", "quotations", "auditLog"];

export default function CreateTenantModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", ownerName: "", phone: "", email: "", subdomain: "", backendUrl: "",
    plan: "BASIC" as Plan, expiresAt: "", price: "", billingCycle: "MONTHLY",
    maxUsers: "3", maxWarehouses: "1", maxAndroidDevices: "1",
    maxCustomers: "", notes: "",
    features: DEFAULT_FEATURES,
    licenseType: "SAAS" as LicenseType, trialEndsAt: "", internalNotes: "",
  });
  const set = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }));
  const toggleFeature = (key: string) => set("features", form.features.includes(key)
    ? form.features.filter((item) => item !== key) : [...form.features, key]);
  const setGroup = (groupKey: string, on: boolean) => {
    const group = FEATURE_GROUPS.find((g) => g.key === groupKey);
    if (!group) return;
    const keys = group.items.filter((i) => !i.hidden).map((i) => i.key);
    set("features", on
      ? Array.from(new Set([...form.features, ...keys]))
      : form.features.filter((f) => !keys.includes(f)));
  };

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
        // Tenant-level entitlements — this is what the tenant backend reads.
        features: form.features,
        subscription: {
          plan: form.plan,
          expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
          price: form.price ? Number(form.price) : null,
          billingCycle: form.billingCycle,
          maxUsers: form.maxUsers ? Number(form.maxUsers) : null,
          maxWarehouses: form.maxWarehouses ? Number(form.maxWarehouses) : null,
          maxAndroidDevices: form.maxAndroidDevices ? Number(form.maxAndroidDevices) : null,
          maxCustomers: form.maxCustomers ? Number(form.maxCustomers) : null,
          currency: "IQD",
          // Legacy Subscription.features deliberately left empty: nothing in
          // the platform gates on it, and mirroring the tenant features into a
          // different key vocabulary is what caused the drift in the first place.
          features: [],
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
              </div>
              <label>المزايا المفعّلة ({form.features.length})</label>
              {FEATURE_GROUPS.map((group) => {
                const items = group.items.filter((item) => !item.hidden);
                if (items.length === 0) return null;
                const selected = items.filter((item) => form.features.includes(item.key)).length;
                return (
                  <div className="feature-group open" key={group.key}>
                    <div className="feature-group-head">
                      <div className="feature-group-head-left">
                        <span className="feature-group-title">{group.title}</span>
                        <span className="feature-group-count">{selected}/{items.length}</span>
                      </div>
                      <div className="feature-group-actions">
                        <button type="button" onClick={() => setGroup(group.key, true)}>تحديد الكل</button>
                        <button type="button" onClick={() => setGroup(group.key, false)}>إلغاء الكل</button>
                      </div>
                    </div>
                    <div className="feature-group-body">
                      {items.map((item) => {
                        const on = form.features.includes(item.key);
                        return (
                          <div className={`feature-row ${on ? "on" : ""}`} key={item.key} onClick={() => toggleFeature(item.key)}>
                            <input type="checkbox" checked={on} onChange={() => toggleFeature(item.key)} onClick={(e) => e.stopPropagation()} />
                            <div className="feature-row-text">
                              <span className="feature-row-label">
                                {item.label}
                                {!isFeatureEnforced(item.key) && <span className="feature-inert" title="لا يوجد لها منع في خادم المحل — تُحفظ ولا تغيّر شيئاً">بلا أثر</span>}
                              </span>
                              {item.description && <span className="feature-row-desc">{item.description}</span>}
                            </div>
                            <span className={`feature-row-badge ${on ? "on" : "off"}`}>{on ? "مفعّلة" : "متوقفة"}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {form.features.length === 0 && <div className="alert error">لا توجد أي ميزة محددة — الخادم يعتبر القائمة الفارغة «كل الميزات مفتوحة». حدّد الميزات المطلوبة صراحةً.</div>}
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
