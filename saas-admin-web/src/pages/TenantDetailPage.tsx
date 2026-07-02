import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Check, CheckCircle2, ChevronDown, Circle, Clipboard,
  Copy, ExternalLink, Fingerprint, HeartPulse, Power, RotateCcw, Save, Send,
  Smartphone, Wand2, XCircle,
} from "lucide-react";
import {
  DOMAIN_ROOT, getErrorMessage, publicApi, tenantsApi,
  type FeatureKey, type InstallerArtifacts, type LicenseType, type Plan, type SerialType,
} from "../api/client";
import { BASE_VERSION_ITEMS, FEATURE_GROUPS, LICENSE_TYPES, LICENSE_TYPE_LABELS, PLATFORM_TOGGLES } from "../entitlements";

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
const LICENSE_BADGE_CLASS: Record<LicenseType, string> = { SAAS: "saas", TRIAL: "trial", DESKTOP_OFFLINE_LIFETIME: "offline" };

type LicState = {
  licenseType: LicenseType; activatedAt: string; expiresAt: string; trialEndsAt: string; internalNotes: string;
  features: string[];
  maxAndroidDevices: string; whatsappLimitEnabled: boolean; whatsappMonthlyLimit: string;
  webEnabled: boolean; androidEnabled: boolean; desktopEnabled: boolean; desktopWhiteLabelEnabled: boolean; offlineLifetimeEnabled: boolean;
};

function expiryState(iso: string | null): "ok" | "soon" | "over" | "none" {
  if (!iso) return "none";
  const days = (new Date(iso).getTime() - Date.now()) / 86400000;
  if (days < 0) return "over";
  if (days <= 14) return "soon";
  return "ok";
}
const EXPIRY_LABEL: Record<ReturnType<typeof expiryState>, string> = {
  ok: "ساري", soon: "قريب الانتهاء", over: "منتهي", none: "بدون تاريخ انتهاء",
};

function installerStatus(status: string | null | undefined): "none" | "pending" | "ready" | "failed" {
  const s = (status ?? "").toUpperCase();
  if (s.includes("FAIL") || s.includes("ERROR")) return "failed";
  if (s.includes("READY") || s.includes("DONE") || s.includes("SUCCESS")) return "ready";
  if (s.includes("PEND") || s.includes("BUILD") || s.includes("QUEUE")) return "pending";
  return "none";
}
const INSTALLER_STATUS_LABEL: Record<ReturnType<typeof installerStatus>, string> = {
  none: "غير مهيأ", pending: "بانتظار البناء", ready: "جاهز", failed: "فشل",
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
  // ── license / entitlements local state ──
  const emptyLic: LicState = {
    licenseType: "SAAS", activatedAt: "", expiresAt: "", trialEndsAt: "", internalNotes: "",
    features: [],
    maxAndroidDevices: "", whatsappLimitEnabled: false, whatsappMonthlyLimit: "",
    webEnabled: true, androidEnabled: false, desktopEnabled: false, desktopWhiteLabelEnabled: false, offlineLifetimeEnabled: false,
  };
  const [lic, setLic] = useState<LicState>(emptyLic);
  const [lastSavedLic, setLastSavedLic] = useState<LicState>(emptyLic);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [configCheck, setConfigCheck] = useState<{ state: "idle" | "loading" | "ok" | "error"; note?: string }>({ state: "idle" });

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
    const next: LicState = {
      licenseType: tenant.licenseType ?? "SAAS",
      activatedAt: tenant.activatedAt?.slice(0, 10) ?? "", expiresAt: tenant.expiresAt?.slice(0, 10) ?? "", trialEndsAt: tenant.trialEndsAt?.slice(0, 10) ?? "",
      internalNotes: tenant.internalNotes ?? "", features: tenant.features ?? [],
      maxAndroidDevices: lm.maxAndroidDevices?.toString() ?? "", whatsappLimitEnabled: !!lm.whatsappLimitEnabled, whatsappMonthlyLimit: lm.whatsappMonthlyLimit?.toString() ?? "",
      webEnabled: pf.webEnabled ?? true, androidEnabled: !!pf.androidEnabled, desktopEnabled: !!pf.desktopEnabled, desktopWhiteLabelEnabled: !!pf.desktopWhiteLabelEnabled, offlineLifetimeEnabled: !!pf.offlineLifetimeEnabled,
    };
    setLic(next);
    setLastSavedLic(next);
  }, [tenant?.id, subscription?.id]);

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["tenant", id] }), qc.invalidateQueries({ queryKey: ["tenants"] }), qc.invalidateQueries({ queryKey: ["tenant-summary"] })]);
  };
  const run = async (task: () => Promise<unknown>, success: string) => {
    setMessage("");
    try { await task(); await refresh(); setMessage(success); } catch (error) { setMessage(getErrorMessage(error)); }
  };
  const check = useMutation({ mutationFn: () => tenantsApi.checkBackend(id), onSuccess: (r) => { setMessage(`الاتصال سليم، الاستجابة ${r.data.latencyMs}ms`); refresh(); }, onError: (e) => setMessage(getErrorMessage(e)) });
  const copy = (value: string, label: string) => { navigator.clipboard.writeText(value); setMessage(`تم نسخ ${label}`); };

  const number = (value: string) => value ? Number(value) : null;
  const toIso = (value: string, end = false) => value ? new Date(`${value}T${end ? "23:59:59" : "00:00:00"}`).toISOString() : null;
  const toggleLicFeature = (key: string) => setLic((c) => ({ ...c, features: c.features.includes(key) ? c.features.filter((f) => f !== key) : [...c.features, key] }));
  const toggleGroup = (key: string) => setCollapsedGroups((c) => ({ ...c, [key]: !c[key] }));
  const selectAllInGroup = (groupKey: string) => {
    const group = FEATURE_GROUPS.find((g) => g.key === groupKey);
    if (!group) return;
    setLic((c) => ({ ...c, features: Array.from(new Set([...c.features, ...group.items.map((i) => i.key)])) }));
  };
  const clearAllInGroup = (groupKey: string) => {
    const group = FEATURE_GROUPS.find((g) => g.key === groupKey);
    if (!group) return;
    const keys = new Set(group.items.map((i) => i.key));
    setLic((c) => ({ ...c, features: c.features.filter((f) => !keys.has(f)) }));
  };
  const saveLicense = () => run(() => tenantsApi.update(id, {
    licenseType: lic.licenseType,
    activatedAt: toIso(lic.activatedAt),
    expiresAt: toIso(lic.expiresAt, true),
    trialEndsAt: toIso(lic.trialEndsAt, true),
    internalNotes: lic.internalNotes || null,
    features: lic.features,
    limits: { maxAndroidDevices: number(lic.maxAndroidDevices), whatsappLimitEnabled: lic.whatsappLimitEnabled, whatsappMonthlyLimit: lic.whatsappLimitEnabled ? number(lic.whatsappMonthlyLimit) : null },
    platforms: { webEnabled: lic.webEnabled, androidEnabled: lic.androidEnabled, desktopEnabled: lic.desktopEnabled, desktopWhiteLabelEnabled: lic.desktopWhiteLabelEnabled, offlineLifetimeEnabled: lic.offlineLifetimeEnabled },
  }), "تم حفظ إعدادات النسخة والميزات").then(() => setLastSavedLic(lic));

  const saveCurrentTab = () => {
    if (tab === "overview") run(() => tenantsApi.update(id, details), "تم حفظ بيانات المحل");
    else if (tab === "license") saveLicense();
    else if (tab === "subscription") run(() => tenantsApi.updateSubscription(id, { ...sub, expiresAt: sub.expiresAt ? new Date(`${sub.expiresAt}T23:59:59`).toISOString() : null, price: number(sub.price), maxUsers: number(sub.maxUsers), maxWarehouses: number(sub.maxWarehouses), maxAndroidDevices: number(sub.maxAndroidDevices), maxInvoices: number(sub.maxInvoices), maxCustomers: number(sub.maxCustomers), currency: "IQD", isActive: true }), "تم حفظ الاشتراك والمزايا");
  };
  const canSaveTab = tab === "overview" || tab === "license" || tab === "subscription";

  const runConfigCheck = async () => {
    if (!tenant) return;
    setConfigCheck({ state: "loading" });
    try {
      const r = await publicApi.checkTenantConfig(tenant.subdomain);
      setConfigCheck({ state: "ok", note: `status: ${r.data.status} · licenseType: ${r.data.licenseType}` });
    } catch (error) {
      setConfigCheck({ state: "error", note: getErrorMessage(error) });
    }
  };

  const warnings = useMemo(() => {
    if (!tenant) return [] as string[];
    const list: string[] = [];
    if (tenant.status === "ACTIVE" && !details.backendUrl.trim()) list.push("الزبون ACTIVE لكن رابط الباكند فارغ.");
    if (lic.features.includes("androidApp") && !lic.androidEnabled) list.push("ميزة أندرويد مفعّلة ضمن الميزات لكن منصّة أندرويد (androidEnabled) مطفأة.");
    if (lic.features.includes("desktopWhiteLabel") && !lic.desktopEnabled) list.push("ديسكتوب باسم المحل مفعّل لكن منصّة الديسكتوب (desktopEnabled) مطفأة.");
    if (lic.offlineLifetimeEnabled && lic.licenseType !== "DESKTOP_OFFLINE_LIFETIME") list.push("تفعيل أوفلاين مدى الحياة مطلوب لكن نوع النسخة ليس DESKTOP_OFFLINE_LIFETIME.");
    if (lic.whatsappLimitEnabled && !lic.whatsappMonthlyLimit) list.push("حد واتساب الشهري مفعّل لكن لم يُحدَّد رقم الحد.");
    if (lic.licenseType === "SAAS" && !lic.expiresAt) list.push("نسخة SAAS بدون تاريخ انتهاء محدد.");
    return list;
  }, [tenant, details.backendUrl, lic]);

  const checklist = useMemo(() => {
    if (!tenant) return [] as Array<{ key: string; label: string; hint?: string; state: "ready" | "warn" | "error" }>;
    const items: Array<{ key: string; label: string; hint?: string; state: "ready" | "warn" | "error" }> = [];
    items.push({ key: "subdomain", label: "subdomain موجود", state: tenant.subdomain ? "ready" : "error" });
    items.push({ key: "backendUrl", label: "backendUrl موجود", state: tenant.backendUrl ? "ready" : "error" });
    items.push({ key: "status", label: "الحالة ACTIVE", state: tenant.status === "ACTIVE" ? "ready" : "warn" });
    if (tenant.licenseType === "SAAS") items.push({ key: "expiresAt", label: "expiresAt محدد (SaaS)", state: tenant.expiresAt ? "ready" : "warn" });
    items.push({ key: "features", label: "features محددة", hint: `${tenant.features?.length ?? 0} ميزة`, state: (tenant.features?.length ?? 0) > 0 ? "ready" : "warn" });
    items.push({ key: "webEnabled", label: "webEnabled", state: tenant.platforms?.webEnabled ? "ready" : "warn" });
    if (tenant.features?.includes("androidApp")) items.push({ key: "androidEnabled", label: "androidEnabled (مطلوبة لـ androidApp)", state: tenant.platforms?.androidEnabled ? "ready" : "error" });
    if (tenant.features?.includes("desktopApp")) items.push({ key: "desktopEnabled", label: "desktopEnabled (مطلوبة لـ desktopApp)", state: tenant.platforms?.desktopEnabled ? "ready" : "error" });
    if (tenant.features?.includes("desktopWhiteLabel")) {
      const has = !!tenant.installerArtifacts?.desktopInstallerUrl;
      items.push({ key: "installerArtifacts", label: "installerArtifacts موجودة (desktopWhiteLabel)", hint: has ? undefined : "لا يوجد رابط installer بعد", state: has ? "ready" : "warn" });
    }
    items.push({ key: "serial", label: "يوجد سيريال واحد على الأقل", hint: `${tenant.serialNumbers.length} سيريال`, state: tenant.serialNumbers.length > 0 ? "ready" : "warn" });
    items.push({ key: "config", label: "tenant-config يرجع بيانات صحيحة", hint: configCheck.state === "idle" ? "اضغط فحص" : configCheck.note, state: configCheck.state === "ok" ? "ready" : configCheck.state === "error" ? "error" : "warn" });
    return items;
  }, [tenant, configCheck]);
  const checklistReadyCount = checklist.filter((i) => i.state === "ready").length;

  if (query.isLoading) return <div className="empty-state">جاري تحميل بيانات المحل...</div>;
  if (!tenant) return <div className="alert error">المحل غير موجود</div>;
  const url = tenant.frontendUrl || `https://${tenant.subdomain}.${DOMAIN_ROOT}`;
  const artifacts: InstallerArtifacts = tenant.installerArtifacts ?? {};
  const androidStatus = installerStatus(artifacts.buildStatus);
  const desktopStatus = installerStatus(artifacts.buildStatus);
  const expiry = expiryState(tenant.expiresAt);

  return (
    <>
      <div className="detail-header">
        <button className="icon-command" onClick={() => navigate("/tenants")}><ArrowRight size={20} /></button>
        <span className="store-avatar large">{tenant.name.slice(0, 1)}</span>
        <div className="header-meta">
          <h1>{tenant.name}</h1>
          <a href={url} target="_blank" rel="noreferrer">{tenant.subdomain}.{DOMAIN_ROOT} <ExternalLink size={13} /></a>
          <div className="badge-row">
            <span className={`status ${tenant.status.toLowerCase()}`} style={{ position: "static" }}>{tenant.status === "ACTIVE" ? "ACTIVE" : tenant.status === "SUSPENDED" ? "SUSPENDED" : "EXPIRED"}</span>
            <span className={`license-badge ${LICENSE_BADGE_CLASS[tenant.licenseType]}`}>{LICENSE_TYPE_LABELS[tenant.licenseType]}</span>
            <span className={`expiry-pill ${expiry}`}>{EXPIRY_LABEL[expiry]}</span>
          </div>
          <div className="detail-subrow">
            <span>تفعيل: {tenant.activatedAt ? new Date(tenant.activatedAt).toLocaleDateString("ar-IQ") : "—"}</span>
            <span>انتهاء: {tenant.expiresAt ? new Date(tenant.expiresAt).toLocaleDateString("ar-IQ") : "—"}</span>
            <button type="button" className="copy-chip" onClick={() => copy(tenant.backendUrl, "رابط الباكند")}><Copy size={12} /> backendUrl</button>
            <button type="button" className="copy-chip" onClick={() => copy(tenant.id, "معرّف المحل")}><Fingerprint size={12} /> tenant id</button>
          </div>
        </div>
        <div className="header-actions">
          <button className="secondary" onClick={() => check.mutate()} disabled={check.isPending}><HeartPulse size={17} /> فحص الاتصال</button>
          <a className="secondary" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 7 }}><ExternalLink size={17} /> فتح الموقع</a>
          <button className={tenant.status === "ACTIVE" ? "danger" : "primary"} onClick={() => run(() => tenantsApi.update(id, { status: tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE" }), tenant.status === "ACTIVE" ? "تم إيقاف المحل" : "تم تفعيل المحل")}><Power size={17} />{tenant.status === "ACTIVE" ? "إيقاف" : "تفعيل"}</button>
          <button className="primary" disabled={!canSaveTab} onClick={saveCurrentTab}><Save size={17} /> حفظ</button>
        </div>
      </div>

      <div className="checklist-card">
        <div className="section-heading">
          <div><h2>جاهزية الزبون</h2><p>عرض فقط — لا يغيّر أي بيانات.</p></div>
          <div className="checklist-summary"><CheckCircle2 size={15} color="#0a7455" /> {checklistReadyCount}/{checklist.length} جاهز</div>
        </div>
        <div className="checklist-grid">
          {checklist.map((item) => (
            <div key={item.key} className={`checklist-item ${item.state}`}>
              {item.state === "ready" ? <CheckCircle2 size={16} /> : item.state === "warn" ? <AlertTriangle size={16} /> : <XCircle size={16} />}
              <span className="checklist-label">{item.label}</span>
              {item.hint && <span className="checklist-hint">{item.hint}</span>}
            </div>
          ))}
        </div>
        <div className="panel-actions" style={{ marginTop: 12, paddingTop: 12 }}>
          <button className="secondary small" onClick={runConfigCheck} disabled={configCheck.state === "loading"}>
            {configCheck.state === "loading" ? "جارِ الفحص..." : "فحص tenant-config"}
          </button>
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
        <div className="section-heading"><div><h2>النسخة والميزات</h2><p>النسخة الأساسية مفتوحة دائماً. الميزات أدناه إضافية فوقها. لا يوجد حد للفواتير ولا أسعار هنا.</p></div></div>

        <div className="form-grid">
          <label>نوع النسخة<select value={lic.licenseType} onChange={(e) => setLic({ ...lic, licenseType: e.target.value as LicenseType })}>{LICENSE_TYPES.map((t) => <option key={t} value={t}>{LICENSE_TYPE_LABELS[t]}</option>)}</select></label>
          <label>تاريخ التفعيل<input type="date" value={lic.activatedAt} onChange={(e) => setLic({ ...lic, activatedAt: e.target.value })} /></label>
          <label>تاريخ الانتهاء<input type="date" value={lic.expiresAt} onChange={(e) => setLic({ ...lic, expiresAt: e.target.value })} /></label>
          <label>انتهاء التجربة<input type="date" value={lic.trialEndsAt} onChange={(e) => setLic({ ...lic, trialEndsAt: e.target.value })} /></label>
        </div>
        <label>ملاحظات داخلية (للسوبر أدمن فقط، لا تظهر للزبون)<textarea rows={3} value={lic.internalNotes} onChange={(e) => setLic({ ...lic, internalNotes: e.target.value })} /></label>

        <div className="base-version-card" style={{ marginTop: 18 }}>
          <div className="section-heading"><div><h2>النسخة الأساسية (مفتوحة دائماً)</h2><p>هذه ليست checkboxes ولا تُحذف — متاحة لكل الزبائن دائماً.</p></div></div>
          <div className="base-version-list">{BASE_VERSION_ITEMS.map((item) => <span className="base-chip" key={item}><Check size={12} /> {item}</span>)}</div>
        </div>

        <div className="section-heading" style={{ marginTop: 4 }}><div><h2>الحدود</h2></div></div>
        <div className="form-grid">
          <label>أقصى عدد أجهزة أندرويد<input type="number" min="0" value={lic.maxAndroidDevices} onChange={(e) => setLic({ ...lic, maxAndroidDevices: e.target.value })} placeholder="غير محدود" /></label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" checked={lic.whatsappLimitEnabled} onChange={(e) => setLic({ ...lic, whatsappLimitEnabled: e.target.checked })} /> تفعيل حد واتساب الشهري</label>
          <label>حد واتساب الشهري<input type="number" min="0" value={lic.whatsappMonthlyLimit} disabled={!lic.whatsappLimitEnabled} onChange={(e) => setLic({ ...lic, whatsappMonthlyLimit: e.target.value })} placeholder="عدد الرسائل" /></label>
        </div>

        <div className="section-heading" style={{ marginTop: 18 }}><div><h2>المنصّات</h2></div></div>
        {PLATFORM_TOGGLES.map((p) => {
          const on = lic[p.key as keyof LicState] as boolean;
          return (
            <div className="platform-row" key={p.key}>
              <div className="platform-row-text">
                <span className="platform-row-title">{p.label}</span>
                {p.description && <span className="platform-row-desc">{p.description}</span>}
                {p.note && <span className="platform-row-note"><AlertTriangle size={11} /> {p.note}</span>}
              </div>
              <label className="switch"><input type="checkbox" checked={on} onChange={() => setLic({ ...lic, [p.key]: !on })} /><span className="switch-track" /></label>
            </div>
          );
        })}

        {warnings.length > 0 && <div className="warn-banner">
          <div className="warn-banner-title"><AlertTriangle size={15} /> تنبيهات (لا تمنع الحفظ)</div>
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>}

        {FEATURE_GROUPS.map((group) => {
          const collapsed = !!collapsedGroups[group.key];
          const selectedCount = group.items.filter((i) => lic.features.includes(i.key)).length;
          return (
            <div className={`feature-group ${collapsed ? "" : "open"}`} key={group.key}>
              <div className="feature-group-head">
                <div className="feature-group-head-left" style={{ cursor: "pointer" }} onClick={() => toggleGroup(group.key)}>
                  <span className="feature-group-chevron"><ChevronDown size={16} /></span>
                  <span className="feature-group-title">{group.title}</span>
                  <span className="feature-group-count">{selectedCount}/{group.items.length}</span>
                </div>
                <div className="feature-group-actions">
                  <button type="button" onClick={() => selectAllInGroup(group.key)}>تحديد الكل</button>
                  <button type="button" onClick={() => clearAllInGroup(group.key)}>إلغاء الكل</button>
                </div>
              </div>
              {!collapsed && <div className="feature-group-body">
                {group.items.map((item) => {
                  const on = lic.features.includes(item.key);
                  return (
                    <div className={`feature-row ${on ? "on" : ""}`} key={item.key} onClick={() => toggleLicFeature(item.key)}>
                      <input type="checkbox" checked={on} onChange={() => toggleLicFeature(item.key)} onClick={(e) => e.stopPropagation()} />
                      <div className="feature-row-text">
                        <span className="feature-row-label">{item.label}</span>
                        {item.description && <span className="feature-row-desc">{item.description}</span>}
                        <span className="feature-row-key">{item.key}</span>
                      </div>
                      <span className={`feature-row-badge ${on ? "on" : "off"}`}>{on ? "مفعّلة" : "متوقفة"}</span>
                    </div>
                  );
                })}
              </div>}
            </div>
          );
        })}

        <div className="panel-actions" style={{ justifyContent: "space-between" }}>
          <button className="secondary" onClick={() => setLic(lastSavedLic)}><RotateCcw size={16} /> استرجاع آخر حفظ</button>
          <button className="primary" onClick={saveLicense}><Save size={17} /> حفظ إعدادات النسخة</button>
        </div>
      </section>}

      {tab === "installer" && <section className="panel">
        <div className="section-heading"><div><h2>ملفات التنصيب</h2><p>توليد ملفات التنصيب سيتم في دفعة لاحقة. هنا تُعرض الروابط والحالة فقط.</p></div></div>
        <div className="installer-grid">
          <div className="installer-card">
            <div className="installer-card-head">
              <span className="installer-card-title"><Smartphone size={17} /> Android APK</span>
              <span className={`installer-status ${androidStatus}`}>{INSTALLER_STATUS_LABEL[androidStatus]}</span>
            </div>
            <div className="installer-link">{artifacts.androidApkUrl || "— لا يوجد رابط بعد —"}</div>
            <div className="installer-meta">{artifacts.androidVersion ? `الإصدار: ${artifacts.androidVersion}` : "بدون رقم إصدار"} {artifacts.lastBuildAt ? `· آخر بناء: ${new Date(artifacts.lastBuildAt).toLocaleString("ar-IQ")}` : ""}</div>
            <div className="installer-actions">
              <button className="secondary small" disabled title="سيتم تفعيله لاحقاً"><Wand2 size={14} /> توليد APK</button>
              <button className="secondary small" disabled={!artifacts.androidApkUrl} onClick={() => copy(artifacts.androidApkUrl ?? "", "رابط APK")}><Clipboard size={14} /> نسخ الرابط</button>
              <button className="secondary small" disabled title="سيتم تفعيله لاحقاً"><Send size={14} /> إرسال للزبون</button>
            </div>
          </div>
          <div className="installer-card">
            <div className="installer-card-head">
              <span className="installer-card-title"><Circle size={17} /> Desktop Installer</span>
              <span className={`installer-status ${desktopStatus}`}>{INSTALLER_STATUS_LABEL[desktopStatus]}</span>
            </div>
            <div className="installer-link">{artifacts.desktopInstallerUrl || "— لا يوجد رابط بعد —"}</div>
            <div className="installer-meta">{artifacts.desktopVersion ? `الإصدار: ${artifacts.desktopVersion}` : "بدون رقم إصدار"} {artifacts.lastBuildAt ? `· آخر بناء: ${new Date(artifacts.lastBuildAt).toLocaleString("ar-IQ")}` : ""}</div>
            <div className="installer-actions">
              <button className="secondary small" disabled title="سيتم تفعيله لاحقاً"><Wand2 size={14} /> توليد Installer</button>
              <button className="secondary small" disabled={!artifacts.desktopInstallerUrl} onClick={() => copy(artifacts.desktopInstallerUrl ?? "", "رابط Installer")}><Clipboard size={14} /> نسخ الرابط</button>
              <button className="secondary small" disabled title="سيتم تفعيله لاحقاً"><Send size={14} /> إرسال للزبون</button>
            </div>
          </div>
        </div>
        <div className="installer-note">توليد ملفات التنصيب سيتم في دفعة لاحقة. الأزرار أعلاه معطّلة عمداً حتى تفعيل build automation.</div>
      </section>}

      {tab === "subscription" && <section className="panel">
        <div className="section-heading"><div><h2>الباقة والحدود (قديم)</h2><p>أي ميزة تطفئها تتوقف لهذا المحل بعد تحديث حالة الاشتراك.</p></div></div>
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
