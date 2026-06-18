import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { tenantsApi, Tenant, TenantStatus } from "../api/client";
import CreateTenantModal from "../components/CreateTenantModal";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";

function statusBadge(status: TenantStatus) {
  const map: Record<TenantStatus, { label: string; cls: string }> = {
    ACTIVE: { label: "نشط", cls: "badge-green" },
    SUSPENDED: { label: "موقوف", cls: "badge-red" },
    EXPIRED: { label: "منتهي", cls: "badge-yellow" },
  };
  const m = map[status];
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function planBadge(plan: string) {
  const map: Record<string, { label: string; cls: string }> = {
    TRIAL: { label: "تجريبية", cls: "badge-yellow" },
    BASIC: { label: "أساسية", cls: "badge-blue" },
    FULL: { label: "كاملة", cls: "badge-purple" },
  };
  const m = map[plan] ?? { label: plan, cls: "badge-blue" };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}

function TenantRow({ tenant, onClick }: { tenant: Tenant; onClick: () => void }) {
  const activeSub = tenant.subscriptions.find((s) => s.isActive);
  const activeSerials = tenant.serialNumbers.filter((s) => s.isActive).length;
  const usedSerials = tenant.serialNumbers.filter((s) => s.activatedAt).length;

  const isExpired = activeSub?.expiresAt && new Date(activeSub.expiresAt) < new Date();

  return (
    <div
      className="card"
      onClick={onClick}
      style={{ cursor: "pointer", transition: "border-color 0.15s" }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--blue)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{tenant.name}</span>
            {statusBadge(isExpired ? "EXPIRED" : tenant.status)}
            {activeSub && planBadge(activeSub.plan)}
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--text2)" }}>
              🌐 {tenant.subdomain}.yourdomain.com
            </span>
            {activeSub?.expiresAt && (
              <span style={{ fontSize: 12, color: isExpired ? "var(--danger)" : "var(--text2)" }}>
                📅 {isExpired ? "انتهى " : "ينتهي "}
                {formatDistanceToNow(new Date(activeSub.expiresAt), { addSuffix: true, locale: ar })}
              </span>
            )}
          </div>
          {activeSub && activeSub.features.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {activeSub.features.map((f) => (
                <span key={f} style={{
                  fontSize: 11, background: "var(--bg3)", border: "1px solid var(--border)",
                  borderRadius: 12, padding: "2px 8px", color: "var(--text2)"
                }}>{f}</span>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          <span style={{ fontSize: 13, color: "var(--text2)" }}>
            🔑 {usedSerials}/{activeSerials} سيريل
          </span>
          <span style={{ fontSize: 11, color: "var(--text2)" }}>
            {formatDistanceToNow(new Date(tenant.createdAt), { addSuffix: true, locale: ar })}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function TenantsPage() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");

  const { data: tenants, isLoading, error } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => tenantsApi.list().then((r) => r.data),
  });

  const filtered = (tenants ?? []).filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.subdomain.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>الزبائن</h1>
          <p style={{ color: "var(--text2)", fontSize: 13, marginTop: 2 }}>
            {tenants?.length ?? 0} زبون مسجل
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + إنشاء زبون
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          placeholder="بحث بالاسم أو الـ subdomain..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 340 }}
        />
      </div>

      {isLoading && (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text2)" }}>
          <span className="spinner" />
        </div>
      )}
      {error && (
        <div style={{ color: "var(--danger)", textAlign: "center", padding: 40 }}>
          خطأ في تحميل البيانات
        </div>
      )}
      {!isLoading && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text2)" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🏢</div>
          <p>لا يوجد زبائن حتى الآن. أنشئ أول زبون!</p>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filtered.map((t) => (
          <TenantRow key={t.id} tenant={t} onClick={() => navigate(`/tenants/${t.id}`)} />
        ))}
      </div>

      {showCreate && <CreateTenantModal onClose={() => setShowCreate(false)} />}
    </>
  );
}
