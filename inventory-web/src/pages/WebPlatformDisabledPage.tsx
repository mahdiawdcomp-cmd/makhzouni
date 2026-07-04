export default function WebPlatformDisabledPage() {
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
      <div style={{ fontSize: 64 }}>🚫</div>
      <h1 style={{ fontSize: 26, fontWeight: 800 }}>
        نسخة الويب غير مفعّلة لهذا المتجر
      </h1>
      <p style={{ color: "#8b949e", fontSize: 15, maxWidth: 400 }}>
        يرجى التواصل مع إدارة النظام لتفعيل الوصول عبر الويب.
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
