import { useEffect, useState } from "react";
import { Copy, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { authApi, getErrorMessage, totpApi, type AdminLoginLogEntry } from "../api/client";

export default function SecurityPage() {
  const [status, setStatus] = useState<{ totpEnabled: boolean; recoveryCodesRemaining: number } | null>(null);
  const [message, setMessage] = useState("");
  const [enrollment, setEnrollment] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState("");
  const [logs, setLogs] = useState<AdminLoginLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const [s, l] = await Promise.all([totpApi.status(), authApi.loginLog()]);
      setStatus(s.data);
      setLogs(l.data);
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  };

  useEffect(() => { load(); }, []);

  const startEnroll = async () => {
    setMessage("");
    setLoading(true);
    try {
      const r = await totpApi.enroll();
      setEnrollment(r.data);
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const confirmEnroll = async () => {
    setMessage("");
    setLoading(true);
    try {
      const r = await totpApi.verifyEnroll(verifyCode);
      setRecoveryCodes(r.data.recoveryCodes);
      setEnrollment(null);
      setVerifyCode("");
      await load();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setMessage("");
    setLoading(true);
    try {
      await totpApi.disable(disablePassword);
      setDisablePassword("");
      setRecoveryCodes(null);
      await load();
      setMessage("تم تعطيل التحقق بخطوتين");
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const copy = (value: string) => { navigator.clipboard.writeText(value); setMessage("تم النسخ"); };

  return (
    <>
      <div className="page-heading">
        <div><h1>الأمان</h1><p>التحقق بخطوتين وسجل محاولات الدخول لحساب السوبر أدمن.</p></div>
      </div>

      {message && <div className="alert info">{message}</div>}

      <section className="panel">
        <div className="section-heading">
          <div><h2>التحقق بخطوتين (2FA)</h2><p>يحمي حسابك حتى لو تسربت كلمة المرور. معطّل افتراضياً — التفعيل قرارك.</p></div>
        </div>

        {recoveryCodes ? (
          <>
            <div className="alert error">هذه أكواد الاسترجاع — احفظها الآن في مكان آمن، لن تظهر مرة أخرى. كل كود يُستخدم مرة واحدة فقط.</div>
            <div className="base-version-list">
              {recoveryCodes.map((code) => <span className="base-chip" key={code}>{code}</span>)}
            </div>
            <div className="panel-actions">
              <button className="secondary" onClick={() => copy(recoveryCodes.join("\n"))}><Copy size={16} /> نسخ الكل</button>
              <button className="primary" onClick={() => setRecoveryCodes(null)}>تم الحفظ، إغلاق</button>
            </div>
          </>
        ) : status?.totpEnabled ? (
          <>
            <div className="checklist-item ready" style={{ marginBottom: 12 }}>
              <ShieldCheck size={16} />
              <span className="checklist-label">مفعّل — {status.recoveryCodesRemaining} كود استرجاع متبقي</span>
            </div>
            <label>كلمة المرور الحالية (مطلوبة للتعطيل)<input type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} /></label>
            <div className="panel-actions">
              <button className="danger" disabled={loading || !disablePassword} onClick={disable}><ShieldOff size={16} /> تعطيل</button>
            </div>
          </>
        ) : enrollment ? (
          <>
            <label>أضف هذا الرمز يدوياً في تطبيق المصادقة (Google Authenticator أو غيره)<input dir="ltr" readOnly value={enrollment.secret} onClick={(e) => (e.target as HTMLInputElement).select()} /></label>
            <div className="panel-actions" style={{ justifyContent: "flex-start" }}>
              <button className="secondary small" onClick={() => copy(enrollment.secret)}><Copy size={14} /> نسخ الرمز</button>
              <button className="secondary small" onClick={() => copy(enrollment.otpauthUri)}><Copy size={14} /> نسخ رابط otpauth</button>
            </div>
            <label>أدخل الرمز المكوّن من 6 أرقام من التطبيق للتأكيد<input dir="ltr" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} placeholder="123456" /></label>
            <div className="panel-actions">
              <button className="secondary" onClick={() => setEnrollment(null)}>إلغاء</button>
              <button className="primary" disabled={loading || verifyCode.length !== 6} onClick={confirmEnroll}><KeyRound size={16} /> تأكيد التفعيل</button>
            </div>
          </>
        ) : (
          <>
            <div className="checklist-item warn" style={{ marginBottom: 12 }}>
              <ShieldOff size={16} />
              <span className="checklist-label">غير مفعّل</span>
            </div>
            <div className="panel-actions">
              <button className="primary" disabled={loading} onClick={startEnroll}><ShieldCheck size={16} /> تفعيل التحقق بخطوتين</button>
            </div>
          </>
        )}
      </section>

      <section className="panel" style={{ marginTop: 18 }}>
        <div className="section-heading"><div><h2>سجل محاولات الدخول</h2><p>آخر 100 محاولة دخول لهذا الحساب.</p></div></div>
        <div className="timeline">
          {logs.map((log) => (
            <div key={log.id}>
              <span className="timeline-dot" />
              <div>
                <b>{log.success ? "دخول ناجح" : `فشل${log.reason ? ` — ${log.reason}` : ""}`}</b>
                <span>{log.ip ?? "—"} · {new Date(log.createdAt).toLocaleString("ar-IQ")}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
