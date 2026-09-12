# Catalog experience — 2026-09-12

Status: implemented locally, not deployed. Production database has NOT been changed.
Scope: web storefront and its API only. Desktop, Android, and unrelated WhatsApp/AI changes were preserved.

## Behaviour

- Device cart/favorites are saved under `catalog-personal-v1:<identity>`, isolated by browser origin and customer/verified visitor/guest identity. No prices, product images, access tokens, or invoice details are persisted. Cart notes and coupons are intentionally not restored.
- Reload restores after a fresh authorized catalog request. Current prices, available units, sample rules, carton-only rules, deleted products, and aggregate piece stock are reconciled. A failed catalog request leaves the saved cart intact. Browser storage failure is reported visibly.
- Favorites are device-local, not synchronized across devices. Available in the grid, product details, and studio viewer. Favorites and previous purchases combine with existing catalog filters.
- Previous purchases return up to 5,000 distinct currently existing product IDs from ACTIVE, non-archived SALE invoices. Identity comes only from a valid customer link or a verified visitor's linked customer. Visitors without a linked accounting customer see no history; an unverified phone never authorizes access. Returns are not themselves purchase entries; this is purchase history, not a net-retained-goods report.
- Funnel stages: OPEN / VIEW / ADD / CHECKOUT / successful saved order. One event per stage per anonymous session; session renews after 30 minutes without a tracked interaction. Explicitly selecting a product to add counts as viewing it. SQL stores deduplicated milestones, not names or phones.
- Funnel charts are cumulative: sessions must include earlier stages. Saved-cart/bypassed-path successes are separately displayed, so a legitimate order is not lost or used to inflate the full-path conversion rate. Successful means pending approval saved, NOT paid invoice or delivered goods. Public tracking cannot submit successful-order events.
- New share links use `/catalog/product/:id`. Vercel serves real Arabic HTML with unique title/description, canonical URL, Open Graph/Twitter metadata, Product JSON-LD, and a CTA into `/catalog?product=:id`. Old SPA links continue working but do not acquire server-rendered metadata.
- Public sharing/indexing respects the existing anonymous catalog switch. Private/login-required catalogs return 404; no private prices, stock, or credentials are exposed. Source names/descriptions are HTML/JSON escaped. Images are JPEG 1200×630 from uploaded raster data, never remote URL fetches. Missing/non-raster images use a neutral placeholder.
- `/sitemap.xml` references paginated `/sitemap-products/:page.xml` files (1,000 products/page). Preview hosts are noindex. Tenant hosts resolve through the existing tenant resolver and never fall back to the platform backend.
- Service worker bypasses cache for private history, live catalog grids, and public product/SEO documents.

## Changed files

Web:
- `src/pages/PublicCatalogPage.tsx`: persistent cart, personal filters, favorites, events, new sharing URL.
- `src/utils/catalogPersonalization.ts` and `.test.ts`: allowlisted storage and stock/price-safe restoration.
- `src/api/catalogExperience.ts`: anonymous sessions/events, history, analytics report API.
- `src/api/endpoints.ts`: forward session ID with submitted catalog orders.
- `src/components/catalog/CatalogFunnel.tsx`, `src/pages/CatalogManagementPage.tsx`: analytics funnel and conversion/dropoff display.
- `src/pwa/offline-sw.ts`: freshness/privacy cache exclusions.
- `api/catalog-product.js`, `vercel.json`: server-rendered SEO, tenant routing, image and sitemap endpoints.
- `api/proxy.js`: forward the non-secret catalog session header.
- `tests/catalog-product.test.mjs`: SEO escaping, routing, privacy/status tests (outside the serverless API directory).

Backend:
- `src/services/catalog-experience.service.ts`, `.test.ts`: authenticated history, deduplicated metrics, cumulative reporting.
- `src/controllers/catalog-experience.controller.ts`: validated public events and protected report/history handlers.
- `src/controllers/catalog-seo.controller.ts`, `catalog-seo.test.ts`: public field allowlist, raster image response, paginated sitemap data.
- `src/controllers/catalog.controller.ts`: record success only after saving an order.
- `src/routes/public.routes.ts`, `src/routes/catalog-management.routes.ts`: new route wiring; funnel report requires MANAGE_CUSTOMERS.
- `prisma/schema.prisma`: appended CatalogFunnelEvent model only; pre-existing AI schema edits preserved.
- `prisma/migrations/20260912160000_catalog_funnel/migration.sql`: new anonymous event table/constraints/index.

## Verification

- Web `npm run build`: passed (existing chunk-size/PWA deprecation warnings).
- Backend `npm run build`: passed.
- `npx prisma validate`: passed. No migration applied to production.
- Web helper tests: 10 passed, including the existing salePricing regression cases.
- Web server-rendered SEO tests: 6 passed (`node --test tests/catalog-product.test.mjs`).
- Backend mocked service/controller tests: 12 passed using the existing isolated test guard:
  `node --experimental-test-module-mocks --import tsx --import ./src/test-guard.ts --test src/services/catalog-experience.test.ts src/controllers/catalog-seo.test.ts`
- Targeted web page/helper/component ESLint: passed. Broader check of the service worker reports an existing, unchanged `no-useless-assignment` in push payload initialization; unrelated lint was not changed.
- Playwright with intercepted fixture API: cart/mode/favorites survive reload; favorites filtering; guest history sign-in requirement; verified-history filtering; account isolation; mobile 390×844 and desktop 1440×900 layouts. Local HTML preview inspected for SEO layout. Fixtures did not create production orders.
- `output/playwright/` contains local test helpers/screenshots and is not part of the shipped feature.
- SQL migration/report query has been reviewed but not executed against a live PostgreSQL test database. Actual WhatsApp preview caching and Google indexing require a published URL and crawler refresh; no search ranking guarantee.

## Publishing checklist

1. Prepare a clean feature-only source revision. Do NOT include existing unrelated AI/WhatsApp changes or its `20260912100000_ai_agent_memory_mute_vision` migration accidentally.
2. Apply the new funnel migration via the normal backend migration workflow and deploy backend before frontend.
3. Deploy web with `inventory-web` as Vercel root; retain configured backend/resolver environment values. API functions use Node fetch and require no new dependency.
4. Verify an authorized history request, public-event validation, a real approved test order workflow if separately authorized, public/private product HTML, a JPEG response, sitemap pages, and tenant separation.
5. Use the NEW share button/link to test WhatsApp. Submit the sitemap through the owner's Google Search Console when authorized. Rollback frontend/backend together; retaining the additive analytics table is safe.

Implementation references: [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [Open Graph protocol](https://ogp.me/).
