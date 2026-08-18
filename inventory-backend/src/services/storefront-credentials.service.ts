import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { getSettings } from "./settings.service";
import { sendWhatsAppText } from "./whatsapp.service";
import { commitAccessCode, prepareCustomerCode, prepareVisitorCode, type IssuedCode } from "./customer-login.service";
import type { WhatsAppSendChannel } from "./whatsapp.service";

/* ══════════════════════════════════════════════════════════════════════
   Sending storefront credentials over WhatsApp.

   The plaintext code exists only inside this send: it is generated, hashed
   into the row, rendered into one message, and dropped. Nothing returns it
   to the browser and nothing logs it.
══════════════════════════════════════════════════════════════════════ */

export const DEFAULT_CREDENTIALS_TEMPLATE =
  "مرحباً {{customerName}} 👋\n" +
  "هذا حسابك للدخول إلى متجر {{storeName}}:\n\n" +
  "👤 اسم المستخدم: {{username}}\n" +
  "🔑 الرمز: {{code}}\n\n" +
  "🔗 رابط المتجر:\n{{link}}\n\n" +
  "احتفظ بهذه الرسالة، ولا تشاركها مع أحد.";

function render(template: string, vars: Record<string, string>) {
  return Object.entries(vars).reduce(
    (out, [key, value]) => out.replaceAll(`{{${key}}}`, value),
    template,
  );
}

/** The catalog URL the shop tells customers to open. */
function storefrontLink(catalogPublicUrl: string | undefined) {
  const configured = (catalogPublicUrl ?? "").trim();
  if (configured) return configured;
  const fallback = (process.env.FRONTEND_PUBLIC_URL ?? "").trim();
  return fallback ? `${fallback.replace(/\/+$/, "")}/catalog` : "";
}

export async function buildCredentialsMessage(issued: IssuedCode) {
  const settings = await getSettings();
  const link = storefrontLink(settings.catalogPublicUrl);
  if (!link) {
    throw new AppError(
      "حدد «رابط الكتلوك العام» من الإعدادات قبل إرسال بيانات الدخول",
      400,
      "CATALOG_URL_MISSING",
    );
  }
  const template = settings.storefrontCredentialsTemplate?.trim() || DEFAULT_CREDENTIALS_TEMPLATE;
  return render(template, {
    customerName: issued.name || "زبوننا العزيز",
    storeName: settings.storeName || "متجرنا",
    // The username IS the phone number they sign in with.
    username: issued.phone,
    code: issued.code,
    link,
  });
}

/**
 * Send the code, then store it — never the other way round. Persisting first
 * meant a failed send still rotated the code, leaving the customer locked out
 * holding a code that was never delivered.
 */
export async function sendStorefrontCredentials(issued: IssuedCode, channel?: string) {
  const message = await buildCredentialsMessage(issued);
  await sendWhatsAppText(issued.phone, message, {
    channel: channel as WhatsAppSendChannel | undefined,
  });
  await commitAccessCode(issued);
  return { phone: issued.phone, sent: true };
}

export type BulkTarget = { kind: "CUSTOMER" | "VISITOR"; id?: string; phone?: string };

/**
 * Issue and send to many recipients. One failure never aborts the run — a
 * blocked number or a WhatsApp hiccup must not leave the rest of the list
 * without credentials, so every recipient is reported individually.
 */
export async function sendStorefrontCredentialsBulk(targets: BulkTarget[], channel?: string) {
  const results: Array<{ phone: string; ok: boolean; error?: string }> = [];

  for (const target of targets) {
    let phone = target.phone ?? "";
    try {
      const issued = target.kind === "CUSTOMER"
        ? await prepareCustomerCode(String(target.id))
        : await prepareVisitorCode(String(target.phone));
      phone = issued.phone;
      await sendStorefrontCredentials(issued, channel);
      results.push({ phone, ok: true });
    } catch (error) {
      results.push({
        phone,
        ok: false,
        error: error instanceof Error ? error.message : "فشل الإرسال",
      });
    }
  }

  return {
    total: results.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/** Everyone the shop can send credentials to, for the "send to all" button. */
export async function listCredentialTargets() {
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null, phone: { not: "" } },
    select: { id: true, phone: true },
  });
  const customerPhones = new Set(customers.map((c) => c.phone));
  const visitors = await prisma.catalogVisitor.findMany({ select: { phone: true } });

  return [
    ...customers.map((c) => ({ kind: "CUSTOMER" as const, id: c.id, phone: c.phone })),
    ...visitors
      .filter((v) => !customerPhones.has(v.phone))
      .map((v) => ({ kind: "VISITOR" as const, phone: v.phone })),
  ];
}
