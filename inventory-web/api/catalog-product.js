// Server-rendered product HTML for people AND crawlers. No token-bearing URLs,
// private prices, browser-only metadata, or user-agent-specific cloaking.
const platformHosts = new Set(["mazbwoni.com", "www.mazbwoni.com", "app.mazbwoni.com"]);
export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveCatalogBackend(host, env = process.env, fetcher = fetch) {
  let backend;
  if (platformHosts.has(host) || /^[a-z0-9-]+\.vercel\.app$/.test(host) || (env.NODE_ENV === "development" && host === "localhost")) {
    backend = env.BACKEND_PROXY_URL || env.VITE_API_URL;
  } else if (/^[a-z0-9-]+\.mazbwoni\.com$/.test(host)) {
    const resolver = new URL(env.VITE_TENANT_CONFIG_URL || "https://admin-api.mazbwoni.com/api/tenant-config");
    resolver.searchParams.set("subdomain", host.split(".")[0]);
    const response = await fetcher(resolver, { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!response.ok) throw new Error("Tenant unavailable");
    const tenant = await response.json();
    if (tenant.status !== "ACTIVE") throw new Error("Tenant unavailable");
    backend = tenant.backendUrl;
  } else throw new Error("Unconfigured hostname");
  if (!backend) throw new Error("Backend not configured");
  const url = new URL(backend.includes("://") ? backend : `https://${backend}`);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid backend");
  return `${url.origin}/api`;
}

export function renderProduct(product, origin, indexable = true) {
  const url = `${origin}/catalog/product/${encodeURIComponent(product.id)}`;
  const image = `${url}/image`;
  const title = `${product.name} | كتلوك المحل`;
  const description = String(product.description || product.name).slice(0, 320);
  const json = JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: product.name, description, sku: product.itemNumber, image, url }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="ar" dir="rtl" prefix="og: https://ogp.me/ns#"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="${indexable ? "index,follow,max-image-preview:large" : "noindex,nofollow"}">
<link rel="canonical" href="${escapeHtml(url)}"><meta property="og:type" content="website">
<meta property="og:locale" content="ar_IQ"><meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="${escapeHtml(product.name)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(title)}"><meta name="twitter:description" content="${escapeHtml(description)}"><meta name="twitter:image" content="${escapeHtml(image)}">
<script type="application/ld+json">${json}</script>
<style>body{margin:0;background:#f4f7f8;color:#172b35;font-family:Tahoma,Arial,sans-serif;line-height:1.8}main{max-width:680px;margin:32px auto;padding:24px;background:white;border-radius:24px;box-shadow:0 12px 45px #15333b12}img{display:block;width:100%;height:auto;aspect-ratio:1200/630;object-fit:contain;border-radius:16px}h1{font-size:clamp(24px,5vw,36px);line-height:1.5}p{white-space:pre-line;overflow-wrap:anywhere}.cta{display:block;text-align:center;background:#087f78;color:white;padding:14px 20px;border-radius:14px;text-decoration:none;font-weight:bold}.muted{color:#536871;font-size:14px}nav a{color:#087f78}@media(max-width:720px){main{margin:12px;padding:20px}}</style></head>
<body><main><nav><a href="/catalog">كتلوك المحل</a></nav><img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" width="1200" height="630">
<p class="muted">رقم المادة: ${escapeHtml(product.itemNumber)}</p><h1>${escapeHtml(product.name)}</h1><p>${escapeHtml(product.description || description)}</p>
<a class="cta" href="/catalog?product=${encodeURIComponent(product.id)}">افتح المنتج بالكتلوك واختار طريقة الشراء</a><p class="muted">الأسعار وخيارات الشراء تظهر داخل الكتلوك حسب صلاحية حسابك. قد يُطلب تسجيل الدخول.</p></main></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const host = String(req.headers.host || "").toLowerCase().replace(/:\d+$/, "");
  const origin = `https://${host}`;
  const indexable = /^[a-z0-9.-]+\.?(?:mazbwoni\.com)$/.test(host) || host === "mazbwoni.com";
  try {
    const backend = await resolveCatalogBackend(host);
    const id = String(req.query.id || "");
    const resource = String(req.query.resource || "product");
    const sitemap = resource === "sitemap" || resource === "sitemap-page";
    const page = Number(req.query.page ?? 0);
    if (sitemap && (!Number.isInteger(page) || page < 0 || page > 100000)) return res.status(404).end("Not found");
    if (resource === "robots") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).end(indexable ? `User-agent: *\nAllow: /catalog/product/\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n` : "User-agent: *\nDisallow: /\n");
    }
    if (!sitemap && !uuid.test(id)) return res.status(404).end("Product not found");
    const path = sitemap ? `/public/catalog/seo-index?page=${page}` : `/public/catalog/seo/${id}${resource === "image" ? "/image" : ""}`;
    const response = await fetch(`${backend}${path}`, { signal: AbortSignal.timeout(12000), redirect: "error" });
    if (!response.ok) {
      res.setHeader("X-Robots-Tag", "noindex");
      return res.status(response.status === 404 ? 404 : 503).end("المنتج غير متاح حالياً. افتح الكتلوك للمزيد.");
    }
    if (resource === "image") {
      res.setHeader("Content-Type", "image/jpeg");
      return res.status(200).end(Buffer.from(await response.arrayBuffer()));
    }
    const body = await response.json();
    if (resource === "sitemap") {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      const pages = indexable ? Math.min(50000, Number(body.data?.pages) || 0) : 0;
      return res.status(200).end(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${Array.from({ length: pages }, (_, i) => `<sitemap><loc>${escapeHtml(origin)}/sitemap-products/${i}.xml</loc></sitemap>`).join("")}</sitemapindex>`);
    }
    if (resource === "sitemap-page") {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      const rows = indexable && Array.isArray(body.data?.products) ? body.data.products : [];
      return res.status(200).end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${rows.filter(p => uuid.test(p.id)).map(p => `<url><loc>${escapeHtml(origin)}/catalog/product/${p.id}</loc><lastmod>${escapeHtml(p.updatedAt)}</lastmod></url>`).join("")}</urlset>`);
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    return res.status(200).end(renderProduct(body.data, origin, indexable));
  } catch {
    res.setHeader("X-Robots-Tag", "noindex");
    return res.status(503).end("الكتلوك غير متاح مؤقتاً. يرجى المحاولة لاحقاً.");
  }
}
