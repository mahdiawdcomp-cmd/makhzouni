export default function SubscriptionExpiredPage({ suspended = false }: { suspended?: boolean }) {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 16,
      background: "#0d1117",
      color: "#e6edf3",
      textAlign: "center",
      padding: 24,
      fontFamily: "'Cairo', system-ui, sans-serif",
      direction: "rtl",
    }}>
      <div style={{ fontSize: 64 }}>{suspended ? "⏸️" : "⏰"}</div>
      <h1 style={{ fontSize: 26, fontWeight: 800 }}>
        {suspended ? "الحساب موقوف مؤقتاً" : "انتهت صلاحية الاشتراك"}
      </h1>
      <p style={{ color: "#8b949e", fontSize: 15, maxWidth: 400 }}>
        {suspended
          ? "تم إيقاف حسابك مؤقتاً. يرجى التواصل مع الدعم لإعادة التفعيل."
          : "انتهت صلاحية اشتراكك. يرجى التجديد للاستمرار في استخدام النظام."}
      </p>
      <a
        href="mailto:support@yourdomain.com"
        style={{
          background: "#238636",
          color: "#fff",
          padding: "10px 24px",
          borderRadius: 8,
          fontWeight: 700,
          fontSize: 14,
          textDecoration: "none",
          marginTop: 8,
        }}
      >
        تواصل مع الدعم
      </a>
    </div>
  );
}
