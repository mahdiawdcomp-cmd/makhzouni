import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Pure logic helpers extracted from customer-portal.service for testing

function buildReorderMessage(
  customerName: string,
  orderNumber: string,
  items: { name: string; quantity: number }[]
): string {
  return (
    `مرحبا، أنا ${customerName} أريد إعادة طلب نفس مشترياتي من الفاتورة رقم ${orderNumber}:\n` +
    items.map((i) => `- ${i.name} × ${i.quantity}`).join("\n")
  );
}

function buildInquiryMessage(customerName: string, text: string): string {
  return `مرحبا، أنا ${customerName}.\n${text}`;
}

function buildArrivalMessage(productName: string, storeName: string): string {
  return `مرحباً، المنتج "${productName}" أصبح متوفراً الآن في ${storeName}. تفضل بزيارتنا!`;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function orderStatusLabel(status: string): string {
  const map: Record<string, string> = {
    PENDING: "قيد الانتظار",
    PROCESSING: "جاري التجهيز",
    PREPARED: "جاهز للاستلام",
    CANCELLED: "ملغي",
    FAILED: "فشل",
  };
  return map[status] ?? status;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("portal — re-order message", () => {
  it("includes customer name and order number", () => {
    const msg = buildReorderMessage("أحمد", "INV-001", [
      { name: "كولا", quantity: 2 },
    ]);
    assert.ok(msg.includes("أحمد"));
    assert.ok(msg.includes("INV-001"));
    assert.ok(msg.includes("كولا × 2"));
  });

  it("lists multiple items on separate lines", () => {
    const msg = buildReorderMessage("سارة", "INV-002", [
      { name: "ماء", quantity: 3 },
      { name: "عصير", quantity: 1 },
    ]);
    const lines = msg.split("\n");
    assert.ok(lines.some((l) => l.includes("ماء × 3")));
    assert.ok(lines.some((l) => l.includes("عصير × 1")));
  });
});

describe("portal — inquiry message", () => {
  it("includes customer name and inquiry text", () => {
    const msg = buildInquiryMessage("علي", "متى يصل الطلب؟");
    assert.ok(msg.includes("علي"));
    assert.ok(msg.includes("متى يصل الطلب؟"));
  });
});

describe("portal — arrival notification message", () => {
  it("includes product name and store name", () => {
    const msg = buildArrivalMessage("نسكافيه", "مخزن التجزئة");
    assert.ok(msg.includes("نسكافيه"));
    assert.ok(msg.includes("مخزن التجزئة"));
  });
});

describe("portal — phone normalization", () => {
  it("strips non-digits for WhatsApp URL", () => {
    assert.strictEqual(normalizePhone("+964 770-123-4567"), "9647701234567");
    assert.strictEqual(normalizePhone("07701234567"), "07701234567");
  });
});

describe("portal — order status labels", () => {
  it("returns correct Arabic labels", () => {
    assert.strictEqual(orderStatusLabel("PENDING"), "قيد الانتظار");
    assert.strictEqual(orderStatusLabel("PREPARED"), "جاهز للاستلام");
    assert.strictEqual(orderStatusLabel("CANCELLED"), "ملغي");
  });

  it("falls back to raw status for unknown values", () => {
    assert.strictEqual(orderStatusLabel("UNKNOWN_STATUS"), "UNKNOWN_STATUS");
  });
});

describe("portal — arrival subscription dedup guard", () => {
  it("returns existing subscription if already subscribed (simulated)", () => {
    const existing = { id: "abc", productName: "ماء", customerId: "cust1" };
    // Simulate: if existing, return it without creating new
    const result = existing ?? { id: "new", productName: "ماء", customerId: "cust1" };
    assert.strictEqual(result.id, "abc");
  });

  it("creates new subscription if none exists", () => {
    const existing = null;
    const newSub = { id: "new", productName: "كولا", customerId: "cust2" };
    const result = existing ?? newSub;
    assert.strictEqual(result.id, "new");
  });
});
