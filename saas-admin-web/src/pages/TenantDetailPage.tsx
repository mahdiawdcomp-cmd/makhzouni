import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { tenantsApi, Tenant, TenantStatus, Plan, SerialType, SerialNumber } from "../api/client";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

const FEATURES_OPTIONS = [
  { key: "ANDROID", label: "أندرويد" },
  { key: "CATALOG", label: "كتلوك" },
  { key: "AI", label: "ذكاء اصطناعي" },
  { key: "MULTI_WAREHOUSE", label: "مخازن متعددة" },
  { key: "WHATSAPP", label: "واتساب" },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn-ghost"
      style={{ fontSize: 11, padding: "3px 10px" }}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "✓ نُسخ" : "نسخ"}
    </button>
  );
}

function SerialRow({ serial, tenantId, onToggle }: {
  serial: SerialNumber;
  tenantId: string;
  onToggle: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();

  async function toggle() {
    setLoading(true);
    try {
      await tenantsApi.toggleSerial(tenantId, serial.id, !serial.isActive);
      await qc.invalidateQueries({ queryKey: ["tenant", tenantId] });
      onToggle();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 14px",
      background: "var(--bg3)",
      borderRadius: 8,
      border: "1px solid var(--border)",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, letterSpacing: 2 }}>
            {serial.code}
          </span>
          <CopyButton text={serial.code} />
          <span className={`badge ${serial.type === "ANDROID" ? "badge-green" : "badge-blue"}`} style={{ fontSize: 10 }}>
            {serial.type}
          </span>
          {!serial.isActive && <span className="badge badge-red" style={{ fontSize: 10 }}>معطّل</span>}
        </div>
        <div style={{ fontSize: 11, color: "var(--text2)", display: "flex", gap: 12 }}>
          {serial.label && <span>🏷️ {serial.label}</span>}
          {serial.activatedAt ? (
            <span style={{ color: "var(--success)" }}>
              ✓ مفعّل {format(new Date(serial.activatedAt), "yyyy/MM/dd", { locale: ar })}
            </span>
          ) : (
            <span>لم يُفعَّل بعد</span>
          )}
        </div>
      </div>
      <button
        className={serial.isActive ? "btn-danger" : "btn-primary"}
        style={{ fontSize: 12, padding: "5px 12px" }}
        onClick={toggle}
        disabled={loading}
      >
        {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : serial.isActive ? "إيقاف" : "تفعيل"}
      </button>
    </div>
  );
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingSub, setSavingSub] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [serialLabel, setSerialLabel] = useState("");
  const [serialType, setSerialType] = useState<SerialType>("ANDROID");

  const { data: tenant, isLoading } = useQuery<Tenant>({
    queryKey: ["tenant", id],
    queryFn: () => tenantsApi.get(id!).then((r) => r.data),
    enabled: !!id,
  });

  // Editable subscription state
  const activeSub = tenant?.subscriptions.find((s) => s.isActive);
  const [subPlan, setSubPlan] = useState<Plan>("BASIC");
  const [subExpiry, setSubExpiry] = useState("");
  const [subMaxInvoices, setSubMaxInvoices] = useState("");
  const [subMaxCustomers, setSubMaxCustomers] = useState("");
  const [subFeatures, setSubFeatures] = useState<string[]>([]);
  const [subInit, setSubInit] = useState(false);

  if (tenant && !subInit) {
    setSubPlan((activeSub?.plan as Plan) ?? "BASIC");
    setSubExpiry(activeSub?.expiresAt ? activeSub.expiresAt.slice(0, 10) : "");
    setSubMaxInvoices(activeSub?.maxInvoices?.toString() ?? "");
    setSubMaxCustomers(activeSub?.maxCustomers?.toString() ?? "");
    setSubFeatures(activeSub?.features ?? []);
    setSubInit(true);
  }

  function toggleFeature(key: string) {
    setSubFeatures((prev) => prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]);
  }

  async function toggleStatus() {
    if (!tenant) return;
    setSavingStatus(true);
    try {
      const newStatus: TenantStatus = tenant.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
      await tenantsApi.update(tenant.id, { status: newStatus });
      await qc.invalidateQueries({ queryKey: ["tenant", id] });
      await qc.invalidateQueries({ queryKey: ["tenants"] });
    } finally {
      setSavingStatus(false);
    }
  }

  async function saveSub() {
    if (!tenant) return;
    setSavingSub(true);
    try {
      await tenantsApi.updateSubscription(tenant.id, {
        plan: subPlan,
        expiresAt: subExpiry ? new Date(subExpiry).toISOString() : null,
        maxInvoices: subMaxInvoices ? parseInt(subMaxInvoices) : null,
        maxCustomers: subMaxCustomers ? parseInt(subMaxCustomers) : null,
        features: subFeatures,
        isActive: true,
      });
      await qc.invalidateQueries({ queryKey: ["tenant", id] });
      await qc.invalidateQueries({ queryKey: ["tenants"] });
    } finally {
      setSavingSub(false);
    }
  }

  async function generateSerial() {
    if (!tenant) return;
    setGenLoading(true);
    try {
      await tenantsApi.generateSerial(tenant.id, { type: serialType, label: serialLabel || undefined });
      setSerialLabel("");
      await qc.invalidateQueries({ queryKey: ["tenant", id] });
    } finally {
      setGenLoading(false);
    }
  }

  if (isLoading) {
    return <div style={{ textAlign: "center", padding: 60 }}><span className="spinner" /></div>;
  }
  if (!tenant) {
    return <div style={{ color: "var(--danger)", textAlign: "center", padding: 40 }}>الزبون غير موجود</div>;
  }

  const isExpired = activeSub?.expiresAt && new Date(activeSub.expiresAt) < new Date();

  return (
    <>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button className="btn-ghost" style={{ fontSize: 13, padding: "6px 12px" }} onClick={() => navigate("/tenants")}>
          ← رجوع
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ fontSize: 22, fontWeight: 800 }}>{tenant.name}</h1>
            <span className={`badge ${tenant.status === "ACTIVE" && !isExpired ? "badge-green" : "badge-red"}`}>
              {isExpired ? "منتهي" : tenant.status === "ACTIVE" ? "نشط" : "موقوف"}
            </span>
          </div>
          <p style={{ fontSize: 12, color: "var(--text2)", marginTop: 2 }}>
            🌐 {tenant.subdomain}.yourdomain.com &nbsp;·&nbsp;
            🔗 {tenant.backendUrl}
          </p>
        </div>
        <button
          className={tenant.status === "ACTIVE" ? "btn-danger" : "btn-primary"}
          onClick={toggleStatus}
          disabled={savingStatus}
          style={{ flexShrink: 0 }}
        >
          {savingStatus ? <span className="spinner" /> : tenant.status === "ACTIVE" ? "⏸ إيقاف" : "▶ تفعيل"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* ── Subscription card ── */}
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>⚙️ الاشتراك</h2>
          <div className="form-grid">
            <div className="form-row">
              <label>الباقة</label>
              <select value={subPlan} onChange={(e) => setSubPlan(e.target.value as Plan)}>
                <option value="TRIAL">تجريبية</option>
                <option value="BASIC">أساسية</option>
                <option value="FULL">كاملة</option>
              </select>
            </div>
            <div className="form-row">
              <label>تاريخ الانتهاء</label>
              <input type="date" value={subExpiry} onChange={(e) => setSubExpiry(e.target.value)} />
            </div>
            <div className="form-row">
              <label>حد الفواتير (فارغ = غير محدود)</label>
              <input type="number" value={subMaxInvoices} onChange={(e) => setSubMaxInvoices(e.target.value)} placeholder="غير محدود" min="1" />
            </div>
            <div className="form-row">
              <label>حد العملاء (فارغ = غير محدود)</label>
              <input type="number" value={subMaxCustomers} onChange={(e) => setSubMaxCustomers(e.target.value)} placeholder="غير محدود" min="1" />
            </div>
          </div>
          <div className="form-row" style={{ marginTop: 16 }}>
            <label>الميزات المتاحة</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
              {FEATURES_OPTIONS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggleFeature(f.key)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 20,
                    border: "1px solid",
                    fontSize: 12,
                    fontWeight: 600,
                    background: subFeatures.includes(f.key) ? "var(--primary)" : "var(--bg3)",
                    borderColor: subFeatures.includes(f.key) ? "var(--primary)" : "var(--border)",
                    color: subFeatures.includes(f.key) ? "#fff" : "var(--text2)",
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button className="btn-primary" onClick={saveSub} disabled={savingSub}>
              {savingSub ? <span className="spinner" /> : "💾 حفظ الاشتراك"}
            </button>
          </div>
        </div>

        {/* ── Serial Numbers card ── */}
        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>🔑 أرقام السيريل</h2>

          {/* Generate new */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <select
              value={serialType}
              onChange={(e) => setSerialType(e.target.value as SerialType)}
              style={{ width: "auto", minWidth: 120 }}
            >
              <option value="ANDROID">أندرويد</option>
              <option value="WEB">ويب</option>
            </select>
            <input
              value={serialLabel}
              onChange={(e) => setSerialLabel(e.target.value)}
              placeholder="وصف (اختياري): مثال: جهاز المخزن"
              style={{ flex: 1, minWidth: 180 }}
            />
            <button className="btn-blue" onClick={generateSerial} disabled={genLoading} style={{ flexShrink: 0 }}>
              {genLoading ? <span className="spinner" /> : "➕ توليد سيريل"}
            </button>
          </div>

          {/* List */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {tenant.serialNumbers.length === 0 ? (
              <p style={{ color: "var(--text2)", fontSize: 13, textAlign: "center", padding: 20 }}>
                لا توجد أرقام سيريل بعد
              </p>
            ) : (
              tenant.serialNumbers.map((sn) => (
                <SerialRow
                  key={sn.id}
                  serial={sn}
                  tenantId={tenant.id}
                  onToggle={() => {}}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
