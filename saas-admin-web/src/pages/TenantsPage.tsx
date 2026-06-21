import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Activity, Building2, CalendarClock, ChevronLeft, CircleOff, Plus, Search, Smartphone } from "lucide-react";
import { DOMAIN_ROOT, tenantsApi, type Tenant, type TenantStatus } from "../api/client";
import CreateTenantModal from "../components/CreateTenantModal";

const statusText: Record<TenantStatus, string> = { ACTIVE: "نشط", SUSPENDED: "موقوف", EXPIRED: "منتهي" };
const planText: Record<string, string> = { TRIAL: "تجريبي", BASIC: "أساسي", PRO: "احترافي", FULL: "كامل" };

function effectiveStatus(tenant: Tenant): TenantStatus {
  const expiry = tenant.subscriptions.find((item) => item.isActive)?.expiresAt;
  return expiry && new Date(expiry) < new Date() ? "EXPIRED" : tenant.status;
}

function TenantCard({ tenant }: { tenant: Tenant }) {
  const navigate = useNavigate();
  const subscription = tenant.subscriptions.find((item) => item.isActive);
  const status = effectiveStatus(tenant);
  const devices = tenant.serialNumbers.filter((item) => item.isActive && item.type === "ANDROID").length;
  return (
    <button className="tenant-card" onClick={() => navigate(`/tenants/${tenant.id}`)}>
      <div className="tenant-title">
        <span className="store-avatar">{tenant.name.slice(0, 1)}</span>
        <div>
          <strong>{tenant.name}</strong>
          <span>{tenant.ownerName || "لم يحدد اسم المالك"}</span>
        </div>
        <span className={`status ${status.toLowerCase()}`}>{statusText[status]}</span>
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
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const tenants = useQuery({ queryKey: ["tenants"], queryFn: () => tenantsApi.list().then((r) => r.data) });
  const summary = useQuery({ queryKey: ["tenant-summary"], queryFn: () => tenantsApi.summary().then((r) => r.data) });

  const filtered = useMemo(() => (tenants.data ?? []).filter((tenant) => {
    const q = search.trim().toLowerCase();
    const matchesSearch = !q || [tenant.name, tenant.ownerName, tenant.phone, tenant.subdomain]
      .some((value) => value?.toLowerCase().includes(q));
    return matchesSearch && (status === "ALL" || effectiveStatus(tenant) === status);
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
      <section className="tenant-grid">{filtered.map((tenant) => <TenantCard key={tenant.id} tenant={tenant} />)}</section>
      {showCreate && <CreateTenantModal onClose={() => setShowCreate(false)} />}
    </>
  );
}
