// Single source of truth for the two absolute URLs this backend hands out to
// the outside world (media links embedded in Instagram/Telegram posts, and the
// catalog link sent to customers over WhatsApp/Telegram).
//
// These used to be scattered across seven files, each falling back to a
// hardcoded `mazbwoni.com` host. In a multi-tenant deployment that is a
// cross-tenant defect, not a convenience: a new tenant that never sets
// BACKEND_PUBLIC_URL would keep-alive-ping another tenant's backend every three
// minutes and mint media URLs pointing at that tenant's host, and one that
// never sets catalogPublicUrl would send its own customers to another shop's
// storefront.
//
// The tenant-neutral fallback is the platform's own injected domain, so a
// correctly-deployed tenant needs no configuration at all and can never
// silently borrow someone else's.

let warnedBackendUrl = false;

/**
 * Absolute origin of THIS backend, with no trailing slash.
 *
 * Resolution order: explicit config → the hosting platform's own domain for
 * this deployment → empty string. Never another tenant's host.
 */
export function backendPublicUrl(): string {
  const configured = process.env.BACKEND_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  // Railway injects this per deployment; it is always the current tenant's own
  // host, so it is a safe tenant-neutral default.
  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain) return `https://${railwayDomain.replace(/\/$/, "")}`;

  if (!warnedBackendUrl) {
    warnedBackendUrl = true;
    console.error(
      "[config] BACKEND_PUBLIC_URL is not set and no platform domain was found. " +
        "Absolute media links (Instagram, Telegram, catalog images) will be omitted. " +
        "Set BACKEND_PUBLIC_URL to this tenant's own API origin."
    );
  }
  return "";
}

/**
 * The public catalog URL customers are sent to, with no trailing slash.
 *
 * `configured` is the tenant's own `catalogPublicUrl` setting. When it is
 * blank there is deliberately NO fallback: callers must skip the link rather
 * than point customers at some other tenant's shop.
 */
export function catalogPublicUrl(configured?: string | null): string {
  const value = configured?.trim();
  if (value) return value.replace(/\/$/, "");
  return "";
}
