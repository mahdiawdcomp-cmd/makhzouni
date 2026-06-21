import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, Check, Clipboard, ExternalLink, HeartPulse, Power, Save, Smartphone } from "lucide-react";
import { DOMAIN_ROOT, getErrorMessage, tenantsApi, type FeatureKey, type Plan, type SerialType } from "../api/client";

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
  const [tab, setTab] = useState<"overview" | "subscription" | "devices" | "audit">("overview");
  const [message, setMessage] = useState("");
  const [serial, setSerial] = useState({ type: "ANDROID" as SerialType, label: "" });
  const query = useQuery({ queryKey: ["tenant", id], queryFn: () => tenantsApi.get(id).then((r) => r.data), enabled: !!id });
  const tenant = query.data;
  const subscription = tenant?.subscriptions.find((item) => item.isActive);
  const [details, setDetails] = useState({ name: "", ownerName: "", phone: "", email: "", subdomain: "", backendUrl: "", notes: "" });
  const [sub, setSub] = useState({ plan: "BASIC" as Plan, expiresAt: "", price: "", billingCycle: "MONTHLY", maxUsers: "", maxWarehouses: "", maxAndroidDevices: "", maxInvoices: "", maxCustomers: "", features: [] as FeatureKey[] });

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
        {[["overview", "بيانات المحل"], ["subscription", "الاشتراك والمزايا"], ["devices", "الأجهزة والسيريالات"], ["audit", "سجل التغييرات"]].map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key as typeof tab)}>{label}</button>)}
      </div>

      {tab === "overview" && <section className="panel">
        <div className="section-heading"><div><h2>البيانات والربط</h2><p>المعلومات الأساسية وروابط تشغيل هذا المحل.</p></div></div>
        <div className="form-grid">
          {([["name", "اسم المحل"], ["ownerName", "اسم المالك"], ["phone", "رقم الهاتف"], ["email", "البريد الإلكتروني"], ["subdomain", "الرابط الفرعي"], ["backendUrl", "رابط الباكند"]] as const).map(([key, label]) => <label key={key}>{label}<input dir={key === "backendUrl" || key === "subdomain" ? "ltr" : "rtl"} value={details[key]} onChange={(e) => setDetails({ ...details, [key]: e.target.value })} /></label>)}
        </div>
        <label>ملاحظات<textarea rows={4} value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} /></label>
        <div className="panel-actions"><button className="primary" onClick={() => run(() => tenantsApi.update(id, details), "تم حفظ بيانات المحل")}><Save size={17} /> حفظ التعديلات</button></div>
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
