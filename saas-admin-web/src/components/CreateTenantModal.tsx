import { useState } from "react";
import { tenantsApi, Plan } from "../api/client";
import { useQueryClient } from "@tanstack/react-query";

const FEATURES_OPTIONS = [
  { key: "ANDROID", label: "تطبيق أندرويد" },
  { key: "CATALOG", label: "كتلوك المفرد" },
  { key: "AI", label: "مساعد ذكاء اصطناعي" },
  { key: "MULTI_WAREHOUSE", label: "مخازن متعددة" },
  { key: "WHATSAPP", label: "واتساب" },
];

interface Props {
  onClose: () => void;
}

export default function CreateTenantModal({ onClose }: Props) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [backendUrl, setBackendUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [plan, setPlan] = useState<Plan>("BASIC");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxInvoices, setMaxInvoices] = useState("");
  const [maxCustomers, setMaxCustomers] = useState("");
  const [features, setFeatures] = useState<string[]>(["ANDROID"]);

  function toggleFeature(key: string) {
    setFeatures((prev) =>
      prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key]
    );
  }

  // Auto-derive subdomain from name
  function handleNameChange(v: string) {
    setName(v);
    if (!subdomain) {
      setSubdomain(
        v.toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 30)
      );
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await tenantsApi.create({
        name, subdomain, backendUrl, notes: notes || undefined,
        subscription: {
          plan,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          maxInvoices: maxInvoices ? parseInt(maxInvoices) : null,
          maxCustomers: maxCustomers ? parseInt(maxCustomers) : null,
          features,
        },
      });
      await qc.invalidateQueries({ queryKey: ["tenants"] });
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error ?? JSON.stringify(err.response?.data?.errors) ?? "فشل إنشاء الزبون");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>➕ إنشاء زبون جديد</span>
          <button className="btn-ghost" style={{ padding: "4px 10px" }} onClick={onClose}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-row">
                <label>اسم الزبون *</label>
                <input value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="مثال: شركة الصالح" required />
              </div>
              <div className="form-row">
                <label>الـ Subdomain *</label>
                <input value={subdomain} onChange={(e) => setSubdomain(e.target.value.toLowerCase())} placeholder="alsaleh" required />
                <span style={{ fontSize: 11, color: "var(--text2)" }}>
                  {subdomain ? `سيكون الرابط: ${subdomain}.yourdomain.com` : ""}
                </span>
              </div>
            </div>

            <div className="form-row">
              <label>رابط الـ Backend *</label>
              <input
                value={backendUrl}
                onChange={(e) => setBackendUrl(e.target.value)}
                placeholder="https://alsaleh-api.up.railway.app"
                type="url"
                required
              />
            </div>

            <div className="form-row">
              <label>ملاحظات</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري..." />
            </div>

            <hr style={{ borderColor: "var(--border)" }} />
            <p style={{ fontWeight: 700, fontSize: 14, marginBottom: -4 }}>الاشتراك</p>

            <div className="form-grid">
              <div className="form-row">
                <label>الباقة *</label>
                <select value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
                  <option value="TRIAL">تجريبية</option>
                  <option value="BASIC">أساسية</option>
                  <option value="FULL">كاملة</option>
                </select>
              </div>
              <div className="form-row">
                <label>تاريخ الانتهاء</label>
                <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
              </div>
            </div>

            {plan === "TRIAL" && (
              <div className="form-grid">
                <div className="form-row">
                  <label>حد الفواتير</label>
                  <input type="number" value={maxInvoices} onChange={(e) => setMaxInvoices(e.target.value)} placeholder="50" min="1" />
                </div>
                <div className="form-row">
                  <label>حد العملاء</label>
                  <input type="number" value={maxCustomers} onChange={(e) => setMaxCustomers(e.target.value)} placeholder="20" min="1" />
                </div>
              </div>
            )}

            <div className="form-row">
              <label>الميزات المتاحة</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {FEATURES_OPTIONS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => toggleFeature(f.key)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 20,
                      border: "1px solid",
                      fontSize: 12,
                      fontWeight: 600,
                      background: features.includes(f.key) ? "var(--primary)" : "var(--bg3)",
                      borderColor: features.includes(f.key) ? "var(--primary)" : "var(--border)",
                      color: features.includes(f.key) ? "#fff" : "var(--text2)",
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="error-msg">{error}</p>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-ghost" onClick={onClose}>إلغاء</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <span className="spinner" /> : "إنشاء الزبون"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
