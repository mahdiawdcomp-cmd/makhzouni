import { UserRole } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { isWorkerOnlyUser } from "./worker-scope";

// Server-side permission wall for ordinary STAFF accounts.
//
// The web/desktop hide pages by permission, but many API reads (invoice list,
// invoice PDFs, vouchers, customers, reports, WhatsApp chat…) answered ANY
// signed-in account. This central table closes that: each API area lists the
// permissions that may use it. It mirrors the UI's page gating (Sidebar
// permissionForItem) PLUS the cross-page uses a screen really needs — e.g. the
// invoice screen reads customers and creates the payment receipt voucher.
//
// Route-level requirePermission() checks still apply on top of this; this
// table only ever narrows access. ADMIN passes everything. Sales agents keep
// their own scoping (requireSalesAgent / scopeCustomerParamToSalesAgent) and
// are not routed through here. Worker-only accounts have worker-scope.ts.

type Rule = {
  prefix: string;
  /** Methods this rule covers; omitted = all. */
  methods?: string[];
  /** Match the path exactly (no sub-paths). */
  exact?: boolean;
  /** Any one of these permissions passes. Empty = admins only. "*" = any staff. */
  any: string[];
};

const INVOICE_DESK = ["MANAGE_INVOICES", "ACCESS_POS"];
const READ_INVOICES = [...INVOICE_DESK, "MANAGE_CUSTOMERS", "MANAGE_VOUCHERS", "VIEW_REPORTS"];
const READ_CUSTOMERS = [...INVOICE_DESK, "MANAGE_CUSTOMERS", "MANAGE_VOUCHERS", "MANAGE_CUSTOMER_OFFERS", "VIEW_REPORTS"];

// First match wins — keep the specific rules above the general ones.
const RULES: Rule[] = [
  // ── Invoices ──
  { prefix: "/invoices/:id/permanent", methods: ["DELETE"], any: ["MANAGE_INVOICES"] },
  { prefix: "/invoices", methods: ["GET"], any: READ_INVOICES },
  { prefix: "/invoices", any: INVOICE_DESK },

  // ── Vouchers ── the invoice screen creates/sends the payment receipt
  { prefix: "/vouchers", methods: ["GET"], any: ["MANAGE_VOUCHERS", "MANAGE_CUSTOMERS", ...INVOICE_DESK] },
  { prefix: "/vouchers/:id/send-whatsapp", methods: ["POST"], any: ["MANAGE_VOUCHERS", ...INVOICE_DESK] },
  { prefix: "/vouchers", methods: ["POST"], exact: true, any: ["MANAGE_VOUCHERS", ...INVOICE_DESK] },
  { prefix: "/vouchers", any: ["MANAGE_VOUCHERS"] },

  // ── Customers ── picked on every invoice; edits/deletes need the real permission
  { prefix: "/customers", methods: ["GET"], any: READ_CUSTOMERS },
  { prefix: "/customers/:id/statement-pdf-whatsapp", methods: ["POST"], any: ["MANAGE_CUSTOMERS", "MANAGE_VOUCHERS", ...INVOICE_DESK] },
  { prefix: "/customers", methods: ["POST"], exact: true, any: ["MANAGE_CUSTOMERS", ...INVOICE_DESK] },
  { prefix: "/customers", any: ["MANAGE_CUSTOMERS"] },

  // ── Reports ── the dashboard is the home page of every account (unchanged)
  { prefix: "/reports/dashboard", methods: ["GET"], any: ["*"] },
  { prefix: "/reports/products/movement", methods: ["GET"], any: ["VIEW_REPORTS", "MANAGE_PRODUCTS"] },
  // Report endpoints that other screens read (customer page, vouchers page, invoice).
  { prefix: "/reports/loyalty-points/:id", methods: ["GET"], any: ["VIEW_REPORTS", "MANAGE_CUSTOMERS", ...INVOICE_DESK] },
  { prefix: "/reports/loyalty-points/:id/exclude", any: ["VIEW_REPORTS", "MANAGE_CUSTOMERS"] },
  { prefix: "/reports/customers/statements-export", any: ["VIEW_REPORTS", "MANAGE_CUSTOMERS", "MANAGE_VOUCHERS"] },
  { prefix: "/reports/customers/statements-export.html", any: ["VIEW_REPORTS", "MANAGE_CUSTOMERS", "MANAGE_VOUCHERS"] },
  { prefix: "/reports/customers/ratings", methods: ["GET"], any: ["VIEW_REPORTS", "MANAGE_CUSTOMERS"] },
  { prefix: "/reports/collections-summary", methods: ["GET"], any: ["VIEW_REPORTS", "MANAGE_VOUCHERS"] },
  { prefix: "/reports/purchase-performance", methods: ["GET"], any: ["VIEW_REPORTS", "MANAGE_PRODUCTS"] },
  { prefix: "/reports/debt-reminder", any: ["VIEW_REPORTS", "MANAGE_CUSTOMERS"] },
  { prefix: "/reports/inactive-reminder", any: ["VIEW_REPORTS", "MANAGE_CUSTOMERS"] },
  { prefix: "/reports", any: ["VIEW_REPORTS"] },

  // ── Customer-facing marketing & messages ──
  { prefix: "/campaigns", any: ["MANAGE_CUSTOMERS"] },
  { prefix: "/catalog-management", any: ["MANAGE_CUSTOMERS"] },
  { prefix: "/requested-products", any: ["MANAGE_CUSTOMERS"] },
  { prefix: "/inbound-messages", any: ["MANAGE_CUSTOMERS"] },
  { prefix: "/prospects", any: ["MANAGE_CUSTOMERS"] },
  { prefix: "/whatsapp-chat", any: ["ACCESS_WHATSAPP_CHAT"] },

  // ── Stock ──
  { prefix: "/stock-losses", any: ["MANAGE_PRODUCTS", "INVENTORY_MANAGE"] },
  { prefix: "/product-reviews", any: ["MANAGE_PRODUCTS"] },

  // ── Tools ──
  { prefix: "/voice", any: INVOICE_DESK },
  { prefix: "/agent", any: [] },            // AI assistant reads the whole shop — owner only
  { prefix: "/settings/backup", any: [] },  // full database export — owner only
];

function toRegex(prefix: string, exact: boolean) {
  const body = prefix.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
  return new RegExp(`^${body}${exact ? "/?$" : "(/|$)"}`);
}

const COMPILED = RULES.map((r) => ({ ...r, re: toRegex(r.prefix, Boolean(r.exact)) }));

export function staffScopeDecision(
  user: { role: UserRole | string; permissions: string[] },
  method: string,
  fullPath: string,
): { allowed: true } | { allowed: false; rule: string } {
  if (user.role === UserRole.ADMIN) return { allowed: true };
  const perms = user.permissions ?? [];
  if (perms.includes("SALES_AGENT") || isWorkerOnlyUser(user)) return { allowed: true };
  const path = fullPath.replace(/^\/api(?=\/)/, "").split("?")[0];
  const m = method.toUpperCase();
  if (m === "OPTIONS" || m === "HEAD") return { allowed: true };
  const rule = COMPILED.find((r) => (!r.methods || r.methods.includes(m)) && r.re.test(path));
  if (!rule) return { allowed: true };
  if (rule.any.includes("*") || rule.any.some((p) => perms.includes(p))) return { allowed: true };
  return { allowed: false, rule: rule.prefix };
}

export function assertStaffScope(user: { role: UserRole | string; permissions: string[] }, method: string, fullPath: string) {
  const d = staffScopeDecision(user, method, fullPath);
  if (!d.allowed) throw new AppError("You do not have permission for this section", 403, "PERMISSION_REQUIRED");
}
