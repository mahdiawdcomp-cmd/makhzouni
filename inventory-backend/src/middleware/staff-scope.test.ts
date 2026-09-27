import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { UserRole } from "@prisma/client";
import { staffScopeDecision } from "./staff-scope";

const staff = (...permissions: string[]) => ({ role: UserRole.STAFF, permissions });
const ok = (u: ReturnType<typeof staff>, m: string, p: string) => staffScopeDecision(u, m, p).allowed;

describe("staff API scope", () => {
  test("admin and sales agents are untouched", () => {
    assert.ok(ok({ role: UserRole.ADMIN, permissions: [] } as never, "GET", "/api/reports/profit"));
    assert.ok(ok(staff("SALES_AGENT"), "GET", "/api/customers"));
  });

  test("cashier (MANAGE_INVOICES) keeps the whole invoice flow", () => {
    const c = staff("MANAGE_INVOICES");
    assert.ok(ok(c, "GET", "/api/invoices"));
    assert.ok(ok(c, "POST", "/api/invoices"));
    assert.ok(ok(c, "GET", "/api/invoices/abc/pdf"));
    assert.ok(ok(c, "GET", "/api/invoices/last-sold-price"));
    assert.ok(ok(c, "GET", "/api/customers"));
    assert.ok(ok(c, "GET", "/api/customers/walk-in"));
    assert.ok(ok(c, "POST", "/api/customers"));
    assert.ok(ok(c, "POST", "/api/vouchers"));
    assert.ok(ok(c, "POST", "/api/vouchers/abc/send-whatsapp"));
    assert.ok(ok(c, "GET", "/api/reports/loyalty-points/abc"));
    assert.ok(ok(c, "GET", "/api/reports/dashboard"));
    assert.ok(ok(c, "POST", "/api/voice/parse"));
    // …but not the other sections
    assert.ok(!ok(c, "GET", "/api/reports/sales"));
    assert.ok(!ok(c, "DELETE", "/api/customers/abc"));
    assert.ok(!ok(c, "PUT", "/api/vouchers/abc"));
    assert.ok(!ok(c, "GET", "/api/whatsapp-chat/conversations"));
    assert.ok(!ok(c, "GET", "/api/campaigns"));
  });

  test("an account with no invoice/customer/voucher/report permission reads none of them", () => {
    const p = staff("MANAGE_PRODUCTS");
    assert.ok(!ok(p, "GET", "/api/invoices"));
    assert.ok(!ok(p, "GET", "/api/invoices/abc"));
    // The bare list only (supplier picker in «الكلفة الواصلة») — no customer detail.
    assert.ok(ok(p, "GET", "/api/customers"));
    assert.ok(!ok(p, "GET", "/api/customers/abc"));
    assert.ok(!ok(p, "GET", "/api/customers/abc/transactions"));
    assert.ok(!ok(p, "GET", "/api/vouchers"));
    assert.ok(!ok(p, "GET", "/api/reports/sales"));
    assert.ok(ok(p, "GET", "/api/reports/products/movement"));
    assert.ok(ok(p, "GET", "/api/reports/purchase-performance"));
    assert.ok(ok(p, "GET", "/api/stock-losses"));
    assert.ok(ok(p, "GET", "/api/products"));
  });

  test("permanent invoice delete needs MANAGE_INVOICES, not just POS", () => {
    assert.ok(!ok(staff("ACCESS_POS"), "DELETE", "/api/invoices/abc/permanent"));
    assert.ok(ok(staff("MANAGE_INVOICES"), "DELETE", "/api/invoices/abc/permanent"));
  });

  test("owner-only tools", () => {
    const all = staff("MANAGE_INVOICES", "MANAGE_CUSTOMERS", "VIEW_REPORTS", "MANAGE_SETTINGS");
    assert.ok(!ok(all, "POST", "/api/agent/chat"));
    assert.ok(!ok(all, "GET", "/api/settings/backup/download"));
    assert.ok(ok(all, "GET", "/api/settings"));
  });

  test("voucher and customer pages keep their cross-reads", () => {
    assert.ok(ok(staff("MANAGE_VOUCHERS"), "GET", "/api/reports/collections-summary"));
    assert.ok(ok(staff("MANAGE_VOUCHERS"), "GET", "/api/customers"));
    assert.ok(ok(staff("MANAGE_CUSTOMERS"), "GET", "/api/reports/customers/ratings"));
    assert.ok(ok(staff("MANAGE_CUSTOMERS"), "GET", "/api/reports/customers/statements-export.html"));
    assert.ok(ok(staff("ACCESS_WHATSAPP_CHAT"), "GET", "/api/whatsapp-chat/unread-count"));
  });
});
