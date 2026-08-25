import prisma from "../config/database";
import { AppError } from "../utils/app-error";
import { getSettings } from "./settings.service";
import { sendTextWithTemplateFallback, sendWhatsAppTemplate } from "./whatsapp.service";
import { commitAccessCode, prepareCustomerCode, prepareVisitorCode, type IssuedCode } from "./customer-login.service";
import type { WhatsAppSendChannel } from "./whatsapp.service";

/* ══════════════════════════════════════════════════════════════════════
   Sending storefront credentials over WhatsApp.

   The plaintext code exists only inside one send: it is generated, hashed
   into the row, rendered into one message, and dropped. Nothing logs it, and
   the only path that ever returns it to a browser is
   revealStorefrontCredentials — an authenticated admin explicitly asking for
   a code to pass on by hand.
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

export type BulkTarget = { kind: "CUSTOMER" | "VISITOR"; id?: string; phone?: string };

export type CredentialParts = {
  name: string;
  store: string;
  username: string;
  code: string;
  link: string;
};

/**
 * Deliver credentials over WhatsApp, respecting what Meta actually approves.
 *
 * Meta will not approve a Utility template containing a login code — it
 * reclassifies it as Authentication, whose body is fixed to the code alone
 * with no room for the username or the storefront link. So when both template
 * names are configured the credentials go out as a pair: a utility welcome
 * carrying name/store/username/link, then an authentication template carrying
 * only the code.
 *
 * Both names are required for the split. With only the welcome template set,
 * sending it would deliver everything except the code — the customer would
 * land on a login screen holding nothing to type — so anything short of a
 * complete pair falls back to the single free-text message.
 */
export async function sendCredentialsOverWhatsApp(
  phone: string,
  parts: CredentialParts,
  fallbackMessage: string,
  welcomeTemplateName: string | undefined,
  codeTemplateName: string | undefined,
  channel?: WhatsAppSendChannel,
) {
  const welcome = welcomeTemplateName?.trim();
  const codeTpl = codeTemplateName?.trim();

  if (!welcome || !codeTpl) {
    await sendTextWithTemplateFallback(phone, undefined, "ar", fallbackMessage, [], channel);
    return;
  }

  await sendTextWithTemplateFallback(
    phone,
    welcome,
    "ar",
    fallbackMessage,
    [parts.name, parts.store, parts.username, parts.link],
    channel,
  );
  // The code is the half that matters — a failure here must surface, not be
  // swallowed behind a welcome message that already went out.
  await sendWhatsAppTemplate(phone, codeTpl, "ar", {
    bodyParams: [parts.code],
    copyCode: parts.code,
  });
}

/**
 * Send the code, then store it — never the other way round. Persisting first
 * meant a failed send still rotated the code, leaving the customer locked out
 * holding a code that was never delivered.
 */
export async function sendStorefrontCredentials(issued: IssuedCode, channel?: string) {
  const settings = await getSettings();
  const message = await buildCredentialsMessage(issued);
  // Business-initiated: the shop pushes credentials to a list, nobody messaged
  // first, so past Meta's 24h window free text is dropped without an error.
  await sendCredentialsOverWhatsApp(
    issued.phone,
    {
      name: issued.name || "زبوننا العزيز",
      store: settings.storeName || "متجرنا",
      username: issued.phone,
      code: issued.code,
      link: storefrontLink(settings.catalogPublicUrl),
    },
    message,
    settings.storefrontCredentialsTemplateName,
    settings.storefrontLoginCodeTemplateName,
    channel as WhatsAppSendChannel | undefined,
  );
  await commitAccessCode(issued);
  return { phone: issued.phone, sent: true };
}

/**
 * Issue a code and hand it back in plaintext instead of sending it.
 *
 * The stored code is a bcrypt hash — nothing, including this server, can read
 * an existing one back. So «أظهر الرمز» necessarily mints a NEW code, which
 * retires whatever the customer was holding. That is the honest trade and the
 * screen says so before the admin presses it.
 *
 * The plaintext is returned to an authenticated admin who asked for it, and to
 * nobody else: it is never logged, never stored, and not sent anywhere. The
 * admin passes it on themselves — from their own WhatsApp, which is the whole
 * point of this route existing next to the automatic send.
 */
export async function revealStorefrontCredentials(target: BulkTarget) {
  const settings = await getSettings();
  const issued = target.kind === "CUSTOMER"
    ? await prepareCustomerCode(String(target.id))
    : await prepareVisitorCode(String(target.phone));

  const message = await buildCredentialsMessage(issued);
  await commitAccessCode(issued);

  // wa.me opens whichever WhatsApp the admin is signed into — their personal
  // one — with the message already written and the customer already selected.
  let waPhone = issued.phone.replace(/\D/g, "");
  if (waPhone.startsWith("00")) waPhone = waPhone.slice(2);
  if (waPhone.startsWith("0")) waPhone = `964${waPhone.slice(1)}`;
  else if (waPhone.startsWith("7")) waPhone = `964${waPhone}`;

  return {
    phone: issued.phone,
    name: issued.name,
    username: issued.phone,
    code: issued.code,
    message,
    waLink: `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`,
    link: storefrontLink(settings.catalogPublicUrl),
  };
}

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

export type TargetGroup = "customers" | "visitors" | "all";

/**
 * Everyone the shop can send credentials to, resolved HERE rather than from
 * whatever the admin screen happens to have loaded.
 *
 * The accounts list is paged, so building "send to all" from the rows on
 * screen silently skipped every recipient past the page — the run reported
 * success while part of the customer base never received anything.
 */
export async function listCredentialTargets(group: TargetGroup = "all"): Promise<BulkTarget[]> {
  const wantCustomers = group === "customers" || group === "all";
  const wantVisitors = group === "visitors" || group === "all";

  const customers = wantCustomers
    ? await prisma.customer.findMany({
        where: { deletedAt: null, phone: { not: "" } },
        select: { id: true, phone: true },
        orderBy: { name: "asc" },
      })
    : [];

  // A phone that became a customer must not also be messaged as a visitor.
  const customerPhones = new Set(
    (await prisma.customer.findMany({ where: { deletedAt: null }, select: { phone: true } }))
      .map((c) => c.phone),
  );
  const visitors = wantVisitors
    ? (await prisma.catalogVisitor.findMany({ select: { phone: true }, orderBy: { lastSeenAt: "desc" } }))
        .filter((v) => !customerPhones.has(v.phone))
    : [];

  return [
    ...customers.map((c) => ({ kind: "CUSTOMER" as const, id: c.id, phone: c.phone })),
    ...visitors.map((v) => ({ kind: "VISITOR" as const, phone: v.phone })),
  ];
}

/** How many recipients a "send to all" would actually reach. */
export async function countCredentialTargets() {
  const [customers, visitors] = await Promise.all([
    listCredentialTargets("customers"),
    listCredentialTargets("visitors"),
  ]);
  return { customers: customers.length, visitors: visitors.length };
}

export async function sendCredentialsToGroup(group: TargetGroup, channel?: string) {
  const targets = await listCredentialTargets(group);
  if (targets.length === 0) throw new AppError("لا يوجد مستلمون", 400, "NO_TARGETS");
  return sendStorefrontCredentialsBulk(targets, channel);
}
