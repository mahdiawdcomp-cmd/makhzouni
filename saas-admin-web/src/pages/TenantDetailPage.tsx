import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Check, Clipboard, ExternalLink, HeartPulse, Power, Save, Smartphone } from "lucide-react";
import { DOMAIN_ROOT, getErrorMessage, tenantsApi, type FeatureKey, type LicenseType, type Plan, type SerialType } from "../api/client";
import { FEATURE_GROUPS, LICENSE_TYPES, LICENSE_TYPE_LABELS, PLATFORM_TOGGLES } from "../entitlements";

const FEATURES: Array<{ key: FeatureKey; label: string }> = [
  { key: "ANDROID", label: "أندرويد" }, { key: "CATALOG", label: "الكتالوج" }, { key: "POS", label: "نقطة البيع" },
  { key: "AI", label: "المساعد الذكي" }, { key: "WHATSAPP", label: "واتساب" }, { key: "MULTI_WAREHOUSE", label: "تعدد المخازن" },
  { key: "QUOTATIONS", label: "عروض الأسعار" }, { key: "RETURNS", label: "المرتجعات" }, { key: "OFFLINE", label: "دون إنترنت" },
  { key: "AUDIT_LOG", label: "سجل التدقيق" },
];
const ACTIONS: Record<string, string> = {
  TENANT_CREATED: "إنشاء المحل", TENANT_UPDATED: "تعديل بيانات المحل", SUBSCRIPTION_UPDATED: "تعديل الاشتراك",
  SERIAL_CREATED: "إنشاء سيريال", SERIAL_ENABLED: "تفعيل سيريال", SERIAL_DISABLED: "تعطيل سيريال",
  BACKEND_CHECKED: "فحص اتصال الباكند", BACKEND_CHECK_FAILED: "فشل فحص الباكند",
};

export default function TenantDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"overview" | "license" | "installer" | "subscription" | "devices" | "audit">("overview");
  const [message, setMessage] = useState("");
  const [serial, setSerial] = useState({ type: "ANDROID" as SerialType, label: "" });
  const query = useQuery({ queryKey: ["tenant", id], queryFn: () => tenantsApi.get(id).then((r) => r.data), enabled: !!id });
  const tenant = query.data;
  const subscription = tenant?.subscriptions.find((item) => item.isActive);
  const [details, setDetails] = useState({ name: "", ownerName: "", phone: "", email: "", subdomain: "", backendUrl: "", notes: "" });
  const [sub, setSub] = useState({ plan: "BASIC" as Plan, expiresAt: "", price: "", billingCycle: "MONTHLY", maxUsers: "", maxWarehouses: "", maxAndroidDevices: "", maxInvoices: "", maxCustomers: "", features: [] as FeatureKey[] });
  // ── Batch 1: license / entitlements local state ──
  const [lic, setLic] = useState({
    licenseType: "SAAS" as LicenseType, activatedAt: "", expiresAt: "", trialEndsAt: "", internalNotes: "",
    features: [] as string[],
    maxAndroidDevices: "", whatsappLimitEnabled: false, whatsappMonthlyLimit: "",
    webEnabled: true, androidEnabled: false, desktopEnabled: false, desktopWhiteLabelEnabled: false, offlineLifetimeEnabled: false,
  });

  useEffect(() => {
    if (!tenant) return;
    setDetails({ name: tenant.name, ownerName: tenant.ownerName ?? "", phone: tenant.phone ?? "", email: tenant.email ?? "", subdomain: tenant.subdomain, backendUrl: tenant.backendUrl, notes: tenant.notes ?? "" });
    setSub({
      plan: subscription?.plan ?? "BASIC", expiresAt: subscription?.expiresAt?.slice(0, 10) ?? "",
      price: subscription?.price?.toString() ?? "", billingCycle: subscription?.billingCycle ?? "MONTHLY",
      maxUsers: subscription?.maxUsers?.toString() ?? "", maxWarehouses: subscription?.maxWarehouses?.toString() ?? "",
      maxAndroidDevices: subscription?.maxAndroidDevices?.toString() ?? "", maxInvoices: subscription?.maxInvoices?.toString() ?? "",
      maxCustomers: subscription?.maxCustomers?.toString() ?? "", features: subscription?.features ?? [],
    });
    const lm = tenant.limits ?? {}; const pf = tenant.platforms ?? {};
    setLic({
      licenseType: tenant.licenseType ?? "SAAS",
      activatedAt: tenant.activatedAt?.slice(0, 10) ?? "", expiresAt: tenant.expiresAt?.slice(0, 10) ?? "", trialEndsAt: tenant.trialEndsAt?.slice(0, 10) ?? "",
      internalNotes: tenant.internalNotes ?? "", features: tenant.features ?? [],
      maxAndroidDevices: lm.maxAndroidDevices?.toString() ?? "", whatsappLimitEnabled: !!lm.whatsappLimitEnabled, whatsappMonthlyLimit: lm.whatsappMonthlyLimit?.toString() ?? "",
      webEnabled: pf.webEnabled ?? true, androidEnabled: !!pf.androidEnabled, desktopEnabled: !!pf.desktopEnabled, desktopWhiteLabelEnabled: !!pf.desktopWhiteLabelEnabled, offlineLifetimeEnabled: !!pf.offlineLifetimeEnabled,
    });
  }, [tenant?.id, subscription?.id]);

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["tenant", id] }), qc.invalidateQueries({ queryKey: ["tenants"] }), qc.invalidateQueries({ queryKey: ["tenant-summary"] })]);
  };
  const run = async (task: () => Promise<unknown>, success: string) => {
    setMessage("");
    try { await task(); await refresh(); setMessage(success); } catch (error) { setMessage(getErrorMessage(error)); }
  };
  const check = useMutation({ mutationFn: () => tenantsApi.checkBackend(id), onSuccess: (r) => { setMessage(`الاتصال سليم، الاستجابة ${r.data.latencyMs}ms`); refresh(); }, onError: (e) => setMessage(getErrorMessage(e)) });

  if (query.isLoading) return <div className="empty-state">جاري تحميل بيانات المحل...</div>;
  if (!tenant) return <div className="alert error">المحل غير موجود</div>;
  const url = tenant.frontendUrl || `https://${tenant.subdomain}.${DOMAIN_ROOT}`;
  const number = (value: string) => value ? Number(value) : null;
  const toIso = (value: string, end = false) => value ? new Date(`${value}T${end ? "23:59:59" : "00:00:00"}`).toISOString() : null;
  const artifacts = tenant.installerArtifacts ?? {};
  const toggleLicFeature = (key: string) => setLic((c) => ({ ...c, features: c.features.includes(key) ? c.features.filter((f) => f !== key) : [...c.features, key] }));
  const saveLicense = () => run(() => tenantsApi.update(id, {
    licenseType: lic.licenseType,
    activatedAt: toIso(lic.activatedAt),
    expiresAt: toIso(lic.expiresAt, true),
    trialEndsAt: toIso(lic.trialEndsAt, true),
    internalNotes: lic.internalNotes || null,
    features: lic.features,
    limits: { maxAndroidDevices: number(lic.maxAndroidDevices), whatsappLimitEnabled: lic.whatsappLimitEnabled, whatsappMonthlyLimit: lic.whatsappLimitEnabled ? number(lic.whatsappMonthlyLimit) : null },
    platforms: { webEnabled: lic.webEnabled, androidEnabled: lic.androidEnabled, desktopEnabled: lic.desktopEnabled, desktopWhiteLabelEnabled: lic.desktopWhiteLabelEnabled, offlineLifetimeEnabled: lic.offlineLifetimeEnabled },
  }), "تم حفظ إعدادات النسخة والميزات");

  return (
    <>
      <div className="detail-header">
        <button className="icon-command" onClick={() => navigate("/tenants")}><ArrowRight size={20} /></button>
        <span className="store-avatar large">{tenant.name.slice(0, 1)}</span>
        <div><h1>{tenant.name}</h1><a href={url} target="_blank" rel="noreferrer">{tenant.subdomain}.{DOMAIN_ROOT} <ExternalLink size={13} /></a></div>
        <div className="header-actions">
          <button className="secondary" onClick={() => check.mutate()} disabled={check.isPending}><HeartPulse size={17} /> فحص الاتصال</button>
          <button className={tenant.status === "ACTIVE" ? "danger" : "primary"} onClick={() => run(() => tenantsApi.update(id, { status: tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }), tenant.status === "ACTIVE" ? "تم إيقاف المحل" : "تم تفعيل المحل")}><Power size={17} />{tenant.status === "ACTIVE" ? "إيقاف" : "تفعيل"}</button>
        </div>
      </div>
      {message && <div className="alert info">{message}</div>}
      <div className="tabs">
        {[["overview", "بيانات المحل"], ["license", "النسخة والميزات"], ["installer", "ملفات التنصيب"], ["subscription", "الاشتراك والمزايا"], ["devices", "الأجهزة والسيريالات"], ["audit", "سجل التغييرات"]].map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key as typeof tab)}>{label}</button>)}
      </div>

      {tab === "overview" && <section className="panel">
        <div className="section-heading"><div><h2>البيانات والربط</h2><p>المعلومات الأساسية وروابط تشغيل هذا المحل.</p></div></div>
        <div className="form-grid">
          {([["name", "اسم المحل"], ["ownerName", "اسم المالك"], ["phone", "رقم الهاتف"], ["email", "البريد الإلكتروني"], ["subdomain", "الرابط الفرعي"], ["backendUrl", "رابط الباكند"]] as const).map(([key, label]) => <label key={key}>{label}<input dir={key === "backendUrl" || key === "subdomain" ? "ltr" : "rtl"} value={details[key]} onChange={(e) => setDetails({ ...details, [key]: e.target.value })} /></label>)}
        </div>
        <label>ملاحظات<textarea rows={4} value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} /></label>
        <div className="panel-actions"><button className="primary" onClick={() => run(() => tenantsApi.update(id, details), "تم حفظ بيانات المحل")}><Save size={17} /> حفظ التعديلات</button></div>
      </section>}

      {tab === "license" && <section className="panel">
        <div className="section-heading"><div><h2>النسخة والميزات</h2><p>النسخة الأساسية مفتوحة دائماً. الميزات أدناه إضافية فوقها. (لا يوجد حد للفواتير ولا أسعار هنا.)</p></div></div>
        <div className="form-grid">
          <label>نوع النسخة<select value={lic.licenseType} onChange={(e) => setLic({ ...lic, licenseType: e.target.value as LicenseType })}>{LICENSE_TYPES.map((t) => <option key={t} value={t}>{LICENSE_TYPE_LABELS[t]}</option>)}</select></label>
          <label>تاريخ التفعيل<input type="date" value={lic.activatedAt} onChange={(e) => setLic({ ...lic, activatedAt: e.target.value })} /></label>
          <label>تاريخ الانتهاء<input type="date" value={lic.expiresAt} onChange={(e) => setLic({ ...lic, expiresAt: e.target.value })} /></label>
          <label>انتهاء التجربة<input type="date" value={lic.trialEndsAt} onChange={(e) => setLic({ ...lic, trialEndsAt: e.target.value })} /></label>
        </div>
        <label>ملاحظات داخلية (للسوبر أدمن فقط، لا تظهر للزبون)<textarea rows={3} value={lic.internalNotes} onChange={(e) => setLic({ ...lic, internalNotes: e.target.value })} /></label>

        <div className="section-heading" style={{ marginTop: 18 }}><div><h2>الحدود</h2></div></div>
        <div className="form-grid">
          <label>أقصى عدد أجهزة أندرويد<input type="number" min="0" value={lic.maxAndroidDevices} onChange={(e) => setLic({ ...lic, maxAndroidDevices: e.target.value })} placeholder="غير محدود" /></label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" checked={lic.whatsappLimitEnabled} onChange={(e) => setLic({ ...lic, whatsappLimitEnabled: e.target.checked })} /> تفعيل حد واتساب الشهري</label>
          <label>حد واتساب الشهري<input type="number" min="0" value={lic.whatsappMonthlyLimit} disabled={!lic.whatsappLimitEnabled} onChange={(e) => setLic({ ...lic, whatsappMonthlyLimit: e.target.value })} placeholder="عدد الرسائل" /></label>
        </div>

        <div className="section-heading" style={{ marginTop: 18 }}><div><h2>المنصّات</h2></div></div>
        <div className="feature-grid">{PLATFORM_TOGGLES.map((p) => { const on = lic[p.key as keyof typeof lic] as boolean; return <button type="button" key={p.key} className={on ? "feature selected" : "feature"} onClick={() => setLic({ ...lic, [p.key]: !on })}><Check size={15} />{p.label}</button>; })}</div>

        {FEATURE_GROUPS.map((group) => <div key={group.key}>
          <div className="section-heading" style={{ marginTop: 18 }}><div><h2>{group.title}</h2></div></div>
          <div className="feature-grid">{group.items.map((item) => <button type="button" key={item.key} className={lic.features.includes(item.key) ? "feature selected" : "feature"} onClick={() => toggleLicFeature(item.key)}><Check size={15} />{item.label}</button>)}</div>
        </div>)}

        <div className="panel-actions"><button className="primary" onClick={saveLicense}><Save size={17} /> حفظ إعدادات النسخة</button></div>
      </section>}

      {tab === "installer" && <section className="panel">
        <div className="section-heading"><div><h2>ملفات التنصيب</h2><p>توليد ملفات التنصيب سيتم في دفعة لاحقة. هنا تُعرض الروابط والحالة فقط.</p></div></div>
        <div className="serial-list">
          <div className="serial-row"><div><b>Android APK</b><span dir="ltr">{artifacts.androidApkUrl || "— لا يوجد بعد —"}{artifacts.androidVersion ? ` · v${artifacts.androidVersion}` : ""}</span></div>{artifacts.androidApkUrl && <a className="secondary small" href={artifacts.androidApkUrl} target="_blank" rel="noreferrer">فتح</a>}</div>
          <div className="serial-row"><div><b>Desktop Installer</b><span dir="ltr">{artifacts.desktopInstallerUrl || "— لا يوجد بعد —"}{artifacts.desktopVersion ? ` · v${artifacts.desktopVersion}` : ""}</span></div>{artifacts.desktopInstallerUrl && <a className="secondary small" href={artifacts.desktopInstallerUrl} target="_blank" rel="noreferrer">فتح</a>}</div>
          <div className="serial-row"><div><b>حالة البناء</b><span>{artifacts.buildStatus || "—"}{artifacts.lastBuildAt ? ` · آخر بناء: ${new Date(artifacts.lastBuildAt).toLocaleString("ar-IQ")}` : ""}</span></div></div>
        </div>
      </section>}

      {tab === "subscription" && <section className="panel">
        <div className="section-heading"><div><h2>الباقة والحدود</h2><p>أي ميزة تطفئها تتوقف لهذا المحل بعد تحديث حالة الاشتراك.</p></div></div>
        <div className="form-grid">
          <label>الباقة<select value={sub.plan} onChange={(e) => setSub({ ...sub, plan: e.target.value as Plan })}><option value="TRIAL">تجريبية</option><option value="BASIC">أساسية</option><option value="PRO">احترافية</option><option value="FULL">كاملة</option></select></label>
          <label>تاريخ الانتهاء<input type="date" value={sub.expiresAt} onChange={(e) => setSub({ ...sub, expiresAt: e.target.value })} /></label>
          <label>السعر<input type="number" value={sub.price} onChange={(e) => setSub({ ...sub, price: e.target.value })} /></label>
          <label>الدفع<select value={sub.billingCycle} onChange={(e) => setSub({ ...sub, billingCycle: e.target.value })}><option value="MONTHLY">شهري</option><option value="YEARLY">سنوي</option><option value="CUSTOM">مخصص</option></select></label>
          {[["maxUsers", "عدد المستخدمين"], ["maxWarehouses", "عدد المخازن"], ["maxAndroidDevices", "أجهزة أندرويد"], ["maxInvoices", "حد الفواتير"], ["maxCustomers", "حد الزبائن"]] .map(([key, label]) => <label key={key}>{label}<input type="number" min="1" value={sub[key as keyof typeof sub] as string} onChange={(e) => setSub({ ...sub, [key]: e.target.value })} placeholder="غير محدود" /></label>)}
        </div>
        <div className="feature-grid">{FEATURES.map((feature) => <button className={sub.features.includes(feature.key) ? "feature selected" : "feature"} key={feature.key} onClick={() => setSub({ ...sub, features: sub.features.includes(feature.key) ? sub.features.filter((item) => item !== feature.key) : [...sub.features, feature.key] })}><Check size={15} />{feature.label}</button>)}</div>
        <div className="panel-actions"><button className="primary" onClick={() => run(() => tenantsApi.updateSubscription(id, { ...sub, expiresAt: sub.expiresAt ? new Date(`${sub.expiresAt}T23:59:59`).toISOString() : null, price: number(sub.price), maxUsers: number(sub.maxUsers), maxWarehouses: number(sub.maxWarehouses), maxAndroidDevices: number(sub.maxAndroidDevices), maxInvoices: number(sub.maxInvoices), maxCustomers: number(sub.maxCustomers), currency: "IQD", isActive: true }), "تم حفظ الاشتراك والمزايا")}><Save size={17} /> حفظ الاشتراك</button></div>
      </section>}

      {tab === "devices" && <section className="panel">
        <div className="section-heading"><div><h2>الأجهزة والسيريالات</h2><p>ولّد رمزاً مستقلاً لكل جهاز حتى يمكن تعطيله دون التأثير على البقية.</p></div></div>
        <div className="serial-create"><select value={serial.type} onChange={(e) => setSerial({ ...serial, type: e.target.value as SerialType })}><option value="ANDROID">أندرويد</option><option value="WEB">ويب</option></select><input value={serial.label} onChange={(e) => setSerial({ ...serial, label: e.target.value })} placeholder="مثال: جهاز الكاشير" /><button className="primary" onClick={() => run(() => tenantsApi.generateSerial(id, serial), "تم إنشاء السيريال")}><Smartphone size={17} /> إنشاء</button></div>
        <div className="serial-list">{tenant.serialNumbers.map((item) => <div className="serial-row" key={item.id}><div><b dir="ltr">{item.code}</b><span>{item.label || "بدون وصف"} · {item.activatedAt ? "مفعّل على جهاز" : "لم يستخدم بعد"}</span></div><button className="icon-command" title="نسخ" onClick={() => navigator.clipboard.writeText(item.code)}><Clipboard size={17} /></button><button className={item.isActive ? "danger small" : "primary small"} onClick={() => run(() => tenantsApi.toggleSerial(id, item.id, !item.isActive), item.isActive ? "تم تعطيل السيريال" : "تم تفعيل السيريال")}>{item.isActive ? "تعطيل" : "تفعيل"}</button></div>)}</div>
      </section>}

      {tab === "audit" && <section className="panel">
        <div className="section-heading"><div><h2>سجل التغييرات</h2><p>آخر الإجراءات الإدارية على المحل.</p></div></div>
        <div className="timeline">{(tenant.auditLogs ?? []).map((log) => <div key={log.id}><span className="timeline-dot" /><div><b>{ACTIONS[log.action] ?? log.action}</b><span>{new Date(log.createdAt).toLocaleString("ar-IQ")}</span></div></div>)}</div>
      </section>}
    </>
  );
}
