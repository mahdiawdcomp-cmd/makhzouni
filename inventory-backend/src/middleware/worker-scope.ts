import { UserRole } from "@prisma/client";
import { AppError } from "../utils/app-error";

// «عامل المخزن» — a STAFF account whose permissions are only the warehouse
// worker set. The web hides everything else in the UI, but the API used to
// answer any signed-in account, so a worker (or the desktop/Android apps,
// which have no worker mode) could still read invoices, customers, reports…
// This is the server-side wall: a worker-only account reaches ONLY the
// endpoints the worker screens use. Everything else is 403.

const WORKER_PERMS = new Set(["VIEW_WITHOUT_PRICES", "REQUEST_TRANSFER", "PREP_NOTIFY"]);

/** Same rule as the web's authStore.isWorkerOnly(). PREP_NOTIFY alone does not make a worker. */
export function isWorkerOnlyUser(user: { role: UserRole | string; permissions: string[] }) {
  if (user.role === UserRole.ADMIN) return false;
  const perms = user.permissions ?? [];
  return perms.some((p) => p !== "PREP_NOTIFY") && perms.every((p) => WORKER_PERMS.has(p));
}

type Rule = { prefix: string; methods: "*" | string[] };

const ALLOW: Rule[] = [
  { prefix: "/auth", methods: "*" },                         // me, logout, change password
  { prefix: "/products", methods: ["GET"] },                 // money fields already stripped for VIEW_WITHOUT_PRICES
  { prefix: "/branches", methods: ["GET"] },
  { prefix: "/transfers", methods: ["GET", "POST"] },        // «طلب تحويل»
  { prefix: "/stock-losses", methods: "*" },                 // «التالف»
  { prefix: "/approvals/my-requests", methods: ["GET"] },    // the worker's own requests
  { prefix: "/prep-screen", methods: "*" },                  // «شاشة التجهيز»
  { prefix: "/notifications", methods: "*" },                // the bell
  { prefix: "/settings", methods: ["GET"] },                 // shop name / theme for the layout
  { prefix: "/license", methods: ["GET"] },
  { prefix: "/health", methods: ["GET"] },
  { prefix: "/tenant-info", methods: ["GET"] },
];

function matches(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

export function assertWorkerScope(
  user: { role: UserRole | string; permissions: string[] },
  method: string,
  fullPath: string,
) {
  if (!isWorkerOnlyUser(user)) return;
  const path = fullPath.replace(/^\/api(?=\/)/, "").split("?")[0];
  const m = method.toUpperCase();
  const ok = ALLOW.some((r) => matches(path, r.prefix) && (r.methods === "*" || r.methods.includes(m) || m === "HEAD" || m === "OPTIONS"));
  if (!ok) throw new AppError("This account is limited to the warehouse worker screens", 403, "WORKER_SCOPE");
}
