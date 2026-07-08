import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mock } from "node:test";

// Mutable fixtures the mocked modules read from.
let workers: Array<{ id: string; name: string; phone: string; active: boolean; notes?: string }> = [];
const sentTo: string[] = [];
let failPhones: Set<string> = new Set();

mock.module("./settings.service", {
  exports: { getSettings: async () => ({ preparationWorkers: workers }) },
});
mock.module("./invoice.service", {
  exports: {
    getInvoiceById: async () => ({
      invoiceNumber: "INV-1",
      totalAmount: 5000,
      customer: { name: "زبون" },
      items: [{}, {}, {}],
    }),
  },
});
mock.module("./invoice-export.service", {
  exports: { generateInvoicePdf: async () => Buffer.from("pdf") },
});
mock.module("./whatsapp.service", {
  exports: {
    sendWhatsAppPdf: async (phone: string) => {
      if (failPhones.has(phone)) throw new Error("WA down");
      sentTo.push(phone);
      return { to: phone, filename: "INV-1.pdf" };
    },
  },
});

let sendInvoiceToWorkers: typeof import("./worker-notify.service").sendInvoiceToWorkers;

before(async () => {
  ({ sendInvoiceToWorkers } = await import("./worker-notify.service"));
});

beforeEach(() => {
  workers = [
    { id: "1", name: "علي", phone: "07701111111", active: true },
    { id: "2", name: "حسن", phone: "07702222222", active: true },
    { id: "3", name: "كريم", phone: "07703333333", active: false },
  ];
  sentTo.length = 0;
  failPhones = new Set();
});

test("sends only to selected active workers", async () => {
  const r = await sendInvoiceToWorkers("inv1", ["07701111111"]);
  assert.equal(r.sent.length, 1);
  assert.equal(sentTo.length, 1);
  assert.equal(r.sent[0].name, "علي");
});

test("inactive worker is skipped, never sent", async () => {
  const r = await sendInvoiceToWorkers("inv1", ["07703333333"]);
  assert.equal(r.sent.length, 0);
  assert.equal(sentTo.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0].reason, /مفعّل/);
});

test("unknown/arbitrary phone is skipped, never sent", async () => {
  const r = await sendInvoiceToWorkers("inv1", ["07709999999"]);
  assert.equal(r.sent.length, 0);
  assert.equal(r.skipped.length, 1);
});

test("does not auto-send to all workers — only the selected one", async () => {
  const r = await sendInvoiceToWorkers("inv1", ["07702222222"]);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].name, "حسن");
  assert.ok(!sentTo.includes("07701111111"));
});

test("WhatsApp failure is captured per-worker and never throws", async () => {
  failPhones = new Set(["07701111111"]);
  const r = await sendInvoiceToWorkers("inv1", ["07701111111", "07702222222"]);
  assert.equal(r.failed.length, 1);
  assert.equal(r.sent.length, 1);
  assert.equal(r.failed[0].name, "علي");
  assert.equal(r.sent[0].name, "حسن");
});

test("duplicate phones send once", async () => {
  const r = await sendInvoiceToWorkers("inv1", ["07701111111", "07701111111"]);
  assert.equal(r.sent.length, 1);
});

test("empty selection sends nothing", async () => {
  const r = await sendInvoiceToWorkers("inv1", []);
  assert.equal(r.sent.length, 0);
  assert.equal(r.skipped.length, 0);
});
