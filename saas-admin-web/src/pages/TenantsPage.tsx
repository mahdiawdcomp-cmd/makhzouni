import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Activity, Building2, CalendarClock, ChevronLeft, CircleOff, Plus, Search, Smartphone } from "lucide-react";
import { DOMAIN_ROOT, tenantsApi, TENANT_STATUS_LABELS, effectiveTenantStatus, type Tenant, type TenantConnectivity } from "../api/client";
import CreateTenantModal from "../components/CreateTenantModal";

const planText: Record<string, string> = { TRIAL: "تجريبي", BASIC: "أساسي", PRO: "احترافي", FULL: "كامل" };

const CONNECTIVITY_LABEL: Record<TenantConnectivity["state"], string> = {
  connected: "موصول",
  disconnected: "غير موصول",
  unknown: "تعذر الفحص",
};

function TenantCard({ tenant, link, linkFailed }: { tenant: Tenant; link?: TenantConnectivity; linkFailed?: boolean }) {
  const navigate = useNavigate();
  const subscription = tenant.subscriptions.find((item) => item.isActive);
  const status = effectiveTenantStatus(tenant);
  const devices = tenant.serialNumbers.filter((item) => item.isActive && item.type === "ANDROID").length;
  return (
    <button className="tenant-card" onClick={() => navigate(`/tenants/${tenant.id}`)}>
      <div className="tenant-title">
        <span className="store-avatar">{tenant.name.slice(0, 1)}</span>
        <div>
          <strong>{tenant.name}</strong>
          <span>{tenant.ownerName || "لم يحدد اسم المالك"}</span>
        </div>
        <span className={`status ${status.toLowerCase()}`}>{TENANT_STATUS_LABELS[status]}</span>
      </div>
      {/* Whether this shop obeys the panel at all. A "نشط" badge above says
          nothing about that: a disconnected shop keeps selling no matter what
          the status here says. */}
      <div className={`wire wire-${link?.state ?? (linkFailed ? "unknown" : "loading")}`}>
        {link
          ? <>{CONNECTIVITY_LABEL[link.state]}{link.state === "disconnected" ? " — لا يصلها أي إعداد من هنا" : ""}{link.reason ? ` (${link.reason})` : ""}</>
          : linkFailed
            ? "تعذر فحص الارتباط"
            : "جارِ فحص الارتباط…"}
      </div>
      <div className="tenant-domain">{tenant.subdomain}.{DOMAIN_ROOT}</div>
      <div className="tenant-meta">
        <span>{planText[subscription?.plan ?? ""] ?? "بدون باقة"}</span>
        <span><Smartphone size={14} /> {devices} جهاز</span>
        <span className={`health ${tenant.provisioningStatus.toLowerCase()}`}>
          <Activity size={14} /> {tenant.provisioningStatus === "READY" ? "متصل" : tenant.provisioningStatus === "ERROR" ? "خلل بالربط" : "قيد التجهيز"}
        </span>
      </div>
      <ChevronLeft className="card-arrow" size={20} />
    </button>
  );
}

export default function TenantsPage() {
  const location = useLocation();
  // Carried over from the tenant page after a delete: the licence row is gone,
  // but the shop's database and backend service are not — say so where the
  // admin lands, not only in the confirm dialog they just clicked through.
  const [deletedNotice, setDeletedNotice] = useState<string>(
    (location.state as { deletedNotice?: string } | null)?.deletedNotice ?? "",
  );
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: () => tenantsApi.list().then((r) => r.data) });
  // Probes every shop's own backend, so it is slower and allowed to fail
  // independently — the list must still render when a shop is unreachable.
  const connectivity = useQuery({
    queryKey: ["tenant-connectivity"],
    queryFn: () => tenantsApi.connectivity().then((r) => r.data),
    staleTime: 60_000,
    retry: false,
  });
  const linkByTenant = useMemo(
    () => new Map((connectivity.data ?? []).map((row) => [row.tenantId, row])),
    [connectivity.data],
  );
  const summary = useQuery({ queryKey: ["tenant-summary"], queryFn: () => tenantsApi.summary().then((r) => r.data) });

  const filtered = useMemo(() => (tenants.data ?? []).filter((tenant) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || [tenant.name, tenant.ownerName, tenant.phone, tenant.subdomain]
      .some((value) => value?.toLowerCase().includes(q));
    return matchesSearch && (status === "ALL" || effectiveTenantStatus(tenant) === status);
  }), [tenants.data, search, status]);

  const cards = [
    { label: "إجمالي المحلات", value: summary.data?.total ?? 0, icon: Building2, tone: "blue" },
    { label: "الاشتراكات النشطة", value: summary.data?.active ?? 0, icon: Activity, tone: "green" },
    { label: "تنتهي قريباً", value: summary.data?.expiringSoon ?? 0, icon: CalendarClock, tone: "amber" },
    { label: "الأجهزة الفعالة", value: summary.data?.activeDevices ?? 0, icon: Smartphone, tone: "violet" },
  ];

  return (
    <>
      <div className="page-heading">
        <div><h1>المحلات والاشتراكات</h1><p>تحكم بكل محل، رابط، باقة وجهاز من لوحة واحدة.</p></div>
        <button className="primary" onClick={() => setShowCreate(true)}><Plus size={18} /> إضافة محل</button>
      </div>

      {deletedNotice && (
        <div className="alert error" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <span>{deletedNotice}</span>
          <button className="secondary" onClick={() => setDeletedNotice("")}>إخفاء</button>
        </div>
      )}

      <section className="stats-grid">
        {cards.map(({ label, value, icon: Icon, tone }) => (
          <div className="stat-card" key={label}><span className={`stat-icon ${tone}`}><Icon size={20} /></span><div><b>{value}</b><span>{label}</span></div></div>
        ))}
      </section>

      <section className="toolbar">
        <div className="search-box"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم المحل، المالك، الهاتف أو الرابط" /></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ALL">كل الحالات</option><option value="ACTIVE">نشط</option><option value="SUSPENDED">موقوف</option><option value="EXPIRED">منتهي</option>
        </select>
      </section>

      {tenants.isLoading && <div className="empty-state">جاري تحميل المحلات...</div>}
      {tenants.isError && <div className="alert error">تعذر تحميل المحلات. افحص اتصال خدمة الإدارة.</div>}
      {!tenants.isLoading && filtered.length === 0 && (
        <div className="empty-state"><CircleOff size={36} /><b>لا توجد نتائج</b><span>غيّر البحث أو أضف أول محل.</span></div>
      )}
      <section className="tenant-grid">{filtered.map((tenant) => <TenantCard key={tenant.id} tenant={tenant} link={linkByTenant.get(tenant.id)} linkFailed={connectivity.isError} />)}</section>
      {showCreate && <CreateTenantModal onClose={() => setShowCreate(false)} />}
    </>
  );
}
