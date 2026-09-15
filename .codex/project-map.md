# Project Map

## Sales-agent third pass: eight gaps — 2026-09-14 (released in `b43c69f`, pushed 2026-09-16)
- Web + backend only; no desktop/Android edits. Shipped as commit `b43c69f` and pushed to `master` on 2026-09-16 (63 files; four unrelated old `docs/*.md` rode along, documentation only). DEPLOY IS NOT VERIFIED: run `docs/sales-agent-preflight-20260914.sql` against production and confirm `btree_gist` plus the three new tables and the `sales_agent_offers_no_overlap` constraint. The concurrent «الموظف الذكي» commit `a8f30bc` and its edits to `schemas.ts` / `types/api.ts` are preserved untouched.
- OWNER's visit-plan screen built: `inventory-web/src/pages/sales-agent/AdminVisitPlanPanel.tsx`, rendered inside `/sales-agents` (AdminRoute + `adminOnly` on the server). Pick rep → date → search/area → add many → reorder with «فوق»/«جوه» (no drag-and-drop) → edit note → cancel/restore. Cancelling the INTENTION never deletes a real visit, and each row shows «أنتجت طلباً» or «نتيجة يدوية بدون طلب».
- ONE new admin endpoint: `GET /sales-agent-admin/agent-customers?salesAgentId=`. `GET /customers` deliberately refuses a query-string `salesAgentId` (a rep could widen their own scope by editing a URL) so that rule was NOT loosened.
- BUG found while testing the new screen: reorder fired two parallel mutations, each with its own refetch, so the list could redraw from a half-applied swap. Now ONE mutation writes both rows in sequence and refreshes once.
- Playwright hygiene: every browser test starts its own fixture on an OS-assigned port (`FIXTURE_PORT=0`) and registers `t.after(stop)` the moment it is ready — BEFORE `chromium.launch()`. That missing line was what left a fixture holding port 4188 on machines without Chromium. stderr is surfaced if the fixture dies early; a missing browser fails with one instruction line. Verified: zero leftover fixture processes, including after a deliberately failed launch.
- WhatsApp retry leak fixed at the boundary in `src/utils/external-sends.ts`: `NODE_ENV=test` blocks sends AND PDF rendering (opt out with `ALLOW_TEST_EXTERNAL_SENDS=true`), and a CONFIGURATION failure (`WHATSAPP_DISABLED` / `MANUAL_ONLY` / `CLOUD_NOT_CONFIGURED`) is never retried — in production either. Retry timers are now tracked so a teardown can cancel them (`cancelPendingWhatsAppRetries`). Integration teardown: cancel → drain `setImmediate` → assert zero timers → disconnect → drop DB. Run is clean, `exit 0`, no "database does not exist".
- `isShopDateKey` validates a REAL calendar day (UTC-parts round trip, never `new Date("YYYY-MM-DD")`): rejects 2026-99-99, 2026-02-30, 2026-02-29; accepts 2028-02-29. `planDateOf` used to fall back to TODAY on a bad date — it now throws `VISIT_PLAN_DATE_INVALID` / «تاريخ خطة الزيارة غير صحيح» on both the admin and rep paths and on reading a day's plan.
- `scripts/check-offer-overlap-constraint.mjs` proves the EXCLUDE constraint on a throwaway DB: 10/10 (overlap refused, adjacent allowed, after-end allowed, paused overlap allowed, resume refused, one of two concurrent writes wins). Read-only production probe: `docs/sales-agent-preflight-20260914.sql` (no CREATE EXTENSION, no DDL, no credentials printed) If the extension can never be installed, HOLD the offers migration — the partial-unique-index fallback is REJECTED, not an option: it keys on the columns alone and ignores the window, so a finished offer that is still `is_active = true` (the normal state — an offer ends by its `ends_at` date and nothing flips the flag) would permanently block every new offer for that customer/product/unit, and a scheduled future offer would be impossible. Adopting it needs a separate design and its own review.
- Startup-DDL drift report: `docs/startup-migrations-drift-20260914.md`. The move out of `server.ts` is verbatim (21 ADD COLUMN + 5 CREATE TABLE), called once, now memoised so the server and the integration test can never run it in parallel. NOTE it is still `void`-called before `app.listen`, so requests can arrive before the DDL finishes — pre-existing, documented, not changed.
- Known and NOT fixed (out of scope): three pre-existing 36px buttons on the reps page («سجّل الاستلام», «ثبّت الشهر», «اعرض»); the touch-target assertion is scoped to the new panel.
- Totals: backend 1053/1053 unit + 19/19 integration + 10/10 constraint, web 61/61 unit + 3/3 browser (390x844 and 1024x768), both builds, prisma valid, ESLint clean on changed files, `git diff --check` clean.

## Sales-agent gap fixes — 2026-09-14 second pass (released in `b43c69f`, pushed 2026-09-16)
- Twelve reviewed gaps closed on web + backend. Shipped in `b43c69f`; no desktop/Android edits; no production or `inventory_dev` writes.
- «يحتاجون متابعة» is now a SERVER filter before pagination (`needsFollowUp=true`), so `total`/`hasMore`/paging describe the filtered set. It needed `pending_approvals.customer_id` (migration `20260914140000_approval_customer_id`, nullable + index + FK + backfill limited to CATALOG_ORDER rows whose JSON id points at a real customer) because a JSON path cannot be used in a Prisma relation filter. Reads still fall back to the JSON for un-backfilled rows.
- Offer overlap is now a partial Postgres EXCLUDE constraint (`btree_gist`, `tsrange(starts_at, ends_at, '[)')`, `WHERE (is_active)`) inside the still-unpublished `20260914120000` migration — the old unique index is GONE, so a customer keeps an offer timeline and can have a scheduled future offer. Paused rows do not reserve the window; resuming an overlapping one fails with SQLSTATE 23P01 and is translated to Arabic. Verified against two genuinely concurrent creates.
- BUG found and fixed while doing this: the offer map was keyed `product:unit`, so a customer holding both a wholesale and a distribution offer for the same product+unit silently lost one. It filters by price mode in SQL now.
- «الكمية المعتادة» is gone: the suggestion is the average of the last 3 NET purchases, round-half-up, floored at 1, capped by shop stock (`suggestedQuantity`/`averageSampleSize`/`stockCapped`). Mode-specific history first, all baskets as a stated fallback.
- Returns are netted PER ITEM (invoice, product, unit) instead of excluding the whole invoice. A return in a DIFFERENT unit than the sale line is deliberately dropped, not converted — `InvoiceItem` has no `pcsPerCarton` snapshot.
- Offer windows: a picked end DAY is included in full and stored exclusive at the next day's start, in the shop timezone via `utils/shop-day.ts`. Never `new Date("YYYY-MM-DD")`. Server sends `startsOnDate`/`endsOnDate`; default form window is start+7 days.
- REAL integration test: `npm run test:integration` (16/16) provisions `<db>_integration_test`, applies every migration, drives offer→review→order→approval→invoice→stock→balance, then drops it. It refuses non-local or hosted-looking URLs. It also revealed that migrations alone do NOT reproduce production's shape, so the boot-time `ADD COLUMN IF NOT EXISTS` block moved out of `server.ts` into `src/config/startup-migrations.ts` (21 ADD COLUMN + 5 CREATE TABLE, unchanged) and both callers share it.
- Visit plans: new `SalesAgentVisitPlan` (+ migration `20260914160000_visit_plans_and_order_link`), `planDate` as shop-local `YYYY-MM-DD`, unique per rep+customer+day. A plan is the intention; the visit stays the fact and links to it. `sales_agent_visits.order_approval_id` links the order a visit produced — «أخذ طلب» with nothing behind it reports `manualOutcome` and is never shown as a documented sale.
- Shop pins are correctable («تصحيح موقع المحل» + confirm + open-current-location) and every change is audited with the previous and new point. The rep's own position is still never stored.
- Reconnect shows a banner and sends NOTHING automatically. Proven in a real browser with `context.setOffline()`: `npm run test:browser` (2/2) — offline → failed send → reload keeps the same key → reconnect banner with 0 keys seen by the server → one re-check → exactly 1 order.
- New deps: `playwright@1.63.0` (devDependency, this pass) and `leaflet@1.9.4` (first pass).
- Totals: backend 1042/1042 unit + 16/16 integration, web 61/61 + 2/2 browser, both builds, ESLint clean on changed files. Details and remaining risks: `docs/sales-agent-features-20260914.md`.

## Sales-agent seven features — 2026-09-14 (released in `b43c69f`, pushed 2026-09-16)
- Web + backend only. No desktop/Android edits, no commit, no push, no deploy, no production data touched.
- ONE pricing decision point: `inventory-backend/src/utils/sales-agent-pricing.ts`. Priority: approved `SalesAgentPriceRequest` (wholesale only — the approval screen never asked which price basis) > live `SalesAgentCustomerOffer` (matched on product+unit+priceMode) > catalog (`cartonPiecePrice` in CARTON mode, `salePrice` in WHOLESALE). `endsAt` is exclusive; an unusable offer falls back instead of blocking a sale.
- Additive migration `20260914120000_sales_agent_offers_visits`: `customers.latitude/longitude`, `sales_agent_customer_offers` (UNIQUE customer+product+unit+price_mode IS the no-overlap rule), `sales_agent_visits`. Verified by applying every migration to a throwaway `sa_scratch_*` database, then dropping it.
- `MANAGE_CUSTOMER_OFFERS` is an ALLOW permission, not an `AGENT_DENY` marker: a rep must not price customers by default. Must be listed in `utils/schemas.ts` or it cannot be granted at all.
- «يشتريها عادةً» and the price-change note read ACTIVE, non-archived, non-returned SALE invoices only (returns detected through `original_invoice_id`), one raw SQL round trip each. A historical price is never sold at; a price-mode mismatch says "no comparable price" instead of inventing a difference.
- `reviewToken` deliberately excludes the price-change note, so a new invoice for the customer cannot invalidate a review whose prices and stock held.
- Pending attempts stay in the existing `localStorage` workspace (NOT IndexedDB — documented decision) with a new display-only `pendingMeta`; one key per attempt for its whole life, editing locked until the server answers definitively.
- Visits: OSM via lazy-loaded Leaflet, no API key. The rep's own position is never stored — asked on a tap, used for one response. Only `Customer.latitude/longitude` is ever written. «Today» uses the existing Baghdad-aware helpers.
- Verification: backend 1021/1021 (32 new), web 61/61 (11 new), both builds, ESLint clean on new/changed files, live browser check at 390x844 and 1024x768 against a local fixture server (no-duplicate retry proven: server saw 1 distinct key). Details and open decisions: `docs/sales-agent-features-20260914.md`.

## Sales-agent wholesale/image hotfix — 2026-09-14 (published)
- User authorized production publication. Scoped five-file commit `bc7b192dd013fe17bf5ee81e3001a74cf2798bf6` pushed to origin/master. Verified Railway `30f781bc-e177-4ca6-abaf-01a90ea57bf5` SUCCESS and Vercel `dpl_DYxoqJmTMYzRA4SFMAA2RhzPstcz` READY production with matching SHA and existing tenant aliases. Unrelated docs/artifacts left uncommitted. No production test orders created.
- Fixed wholesale incorrectly using invoice `hiddenUnits`: web now offers PIECE/DOZEN/BOX/CARTON, default DOZEN at stock >=12 otherwise PIECE; new WHOLESALE server orders accept those units just like public wholesale catalog. Distribution eligibility and carton-only restrictions remain unchanged.
- `inventory-web/src/utils/salesAgentCatalog.ts` defines stable thumbnail batches (24 full-catalog IDs); visibility enables batches without changing their keys. Per-product thumbnail cache and cached full-image placeholder prevent scrolling/refetch image disappearance. Unit picker stays visible in product-dialog footer on mobile/tablet.
- Verification: 18 frontend + 38 backend targeted tests passed, both builds passed. Mocked 75-product browser check with 800ms image delays: first image remained mounted during scrolling (0 missing across 6 observed mutations). Checked 390x844 and 1024x768 screenshots in `output/playwright/rep-fix-*-final.png`. Final frontend typecheck/lint passed after unit-picker positioning; production builds succeeded during deployment.

## Sales-agent catalog refresh — 2026-09-14 (published by concurrent Git workflow)
- Concurrent task committed/pushed all feature code along with negative-stock work in `87833448e5b8c67580b7b464321c37b3ed65e047`. This task did not push/deploy. Verified automatic Railway `7d3e5c87-0a44-40c0-b59b-6d7debe8b221` SUCCESS and Vercel `dpl_HofBDP8rKQTczig6adGftAtW3V3V` READY with matching Git SHA and production aliases; no authenticated production order created for testing.
- Web-only UI: `SalesAgentPage.tsx` now opens a photo catalog without a customer; guest cart transfers at customer selection with explicit merge choices. Existing money/issues/orders/customer/price-request screens remain. No desktop/Android edits.
- WHOLESALE + CARTON only, separate drafts per mode/customer. Carton distribution requires positive cartonPiecePrice, whole visible CARTON unit and >= one carton shop stock; wholesale keeps legacy units and shortage approval policy. Existing global catalogFullCartonOnly display switch remains respected.
- Draft helper `inventory-web/src/utils/salesAgentDrafts.ts`: origin/user scoped v2 workspace; persists notes, guest/customer carts, submitted payload + idempotency key for uncertain retries. Legacy storage untouched; imported only for a selected owned customer's wholesale cart. No automatic background sending.
- `POST /sales-agent/orders/preview` uses a dedicated read-only handler and the same server pricing as submission. New-mode orders require a matching SHA-256 review snapshot; price/stock changes return 409. priceMode is copied into approval.body so preparation/invoice keep distribution pricing. No migration.
- Follow-up filters (`quiet`, `balance`, `never`) applied in owned customer DB query before pagination. Balance means positive debt, not proven overdue.
- Tests/docs: `docs/sales-agent-catalog-20260914.md`. Existing audit findings outside this feature (handover/commissions/general API access) NOT fixed. Preserve concurrent unrelated product/AI edits.

## Latest publication and sales-agent audit — 2026-09-13
- Catalog release `cad128aa8a7e3ee75d03091a9babd488397edd2d` published to production, preserving concurrent WhatsApp commits. Railway `05a22a34-ef11-4393-99ad-66fd92b96d17` succeeded; Vercel `dpl_AQrfYqiwM2JxGC53ohvA39LG1ZUM` Ready, aliased to mazbwoni.com and existing tenant domains.
- Migration `20260912160000_catalog_funnel` applied; read-only production funnel query succeeded. Pre-release 901 MB pg_dump on Postgres volume; archive list verified, not restoration-tested. Details: `docs/catalog-release-20260913.md`.
- Read-only sales-rep audit: `docs/sales-agents-audit-20260913.md`. Five isolated diagnostic scenarios reproduce zero/concurrent handover problems, concurrent customer claiming, UTC boundary issue and confirm gross SALE-only commission policy. Generic voucher reads lack rep ownership scoping (source-confirmed). No sales-agent business code changed.

## Catalog implementation — 2026-09-12 (published 2026-09-13)
- Device-only cart/favorites: `inventory-web/src/utils/catalogPersonalization.ts`; reconstruct cart from fresh authorized products, never stored prices. Personal history uses verified identity only.
- Funnel: `catalog-experience.service.ts` + `CatalogFunnel.tsx`; cumulative unique-session milestones; saved-cart/bypassed-path order successes shown separately. Migration `20260912160000_catalog_funnel` applied in production.
- Product sharing: Vercel `api/catalog-product.js`, backend `catalog-seo.controller.ts`, `/catalog/product/:id`, paginated sitemap. Public metadata only when anonymous catalog is enabled; no prices or auth tokens; per-tenant resolver.
- Full files/decisions/tests/publishing precautions: `docs/catalog-experience-20260912.md`. 28 targeted tests and both builds passed; mobile/desktop fixture browser checks passed. Preserve unrelated WhatsApp/AI dirty work and migration when publishing.

## Shape
- `inventory-backend`: Node/TypeScript API with Prisma/Postgres. Main business logic is in `src/services`, routes in `src/routes`, validation in `src/utils/schemas.ts`.
- `inventory-web`: Vite/React dashboard. Routes live in `src/App.tsx`, API wrapper in `src/api/endpoints.ts`, layout in `src/components/layout`.
- `inventory-android`: Kotlin/Jetpack Compose Android app. API client lives under `app/src/main/java/com/inventory/data/remote`, screens under `ui`.
- `toy-website`: separate Next.js toy storefront/prototype; it is not part of the main inventory runtime.
- `saas-admin-api`: independent Express/Prisma service for tenant subscriptions, feature limits, device serials, provisioning health, and admin audit history. It uses the isolated PostgreSQL schema `saas_admin`.
- `saas-admin-web`: separate Vite/React Super Admin dashboard deployed at `admin.mazbwoni.com`.

## Runtime Flow
- Web and Android both call the same Express API under `/api`; the API writes canonical PostgreSQL data through Prisma.
- Web stores its JWT in `localStorage` and attaches it with Axios. Android stores JWT/settings in DataStore and attaches them through OkHttp interceptors.
- Web server-state is TanStack Query. Successful mutations are broadcast over authenticated SSE (`/api/realtime/events`), and `RealtimeSyncBridge` invalidates affected query keys.
- Android keeps a Room cache, queues offline mutations, flushes them with WorkManager, and refreshes products/customers/vouchers/invoices. SSE schedules an immediate refresh.
- `Branch` is retained as the API/model name but represents a warehouse. Per-warehouse stock is stored in `ProductWarehouseStock`.
- Tenant storefronts use `<subdomain>.mazbwoni.com`. On startup, `inventory-web` resolves the subdomain through `admin-api.mazbwoni.com/api/tenant-config` and switches Axios to that tenant's `backendUrl`.
- Tenant subdomains always use the Super Admin resolver, even when the Vercel project has a global `VITE_API_URL`; this prevents new shops from falling back to Mahdi's backend.
- The platform root hosts remain `mazbwoni.com` and `app.mazbwoni.com`. The original production tenant is registered as `mahdi.mazbwoni.com` and uses `api.mazbwoni.com`.

## Core Accounting Rules
- Positive customer balance means the customer owes the shop; negative means the shop owes the customer/supplier.
- SALE remaining amounts increase balance. PURCHASE and SALES_RETURN remaining amounts decrease it. RECEIPT vouchers decrease balance; PAYMENT vouchers increase it.
- Invoice and voucher mutations use Prisma transactions and recalculate customer balances.
- SALE removes stock; PURCHASE and SALES_RETURN add stock. Invoice items snapshot product name, unit price, cost price, and warehouse.
- Invoices and vouchers use accounting-safe deletion (`archivedAt`) instead of physical deletion.

## Important Current Findings
- Web/backend include coupons, quotations, sales returns, public catalog, PWA, and customer portal features.
- Android includes POS, sales returns, coupons, quotations, transfers, branches, and audit screens/API wiring.
- Sales returns are represented by `InvoiceType.SALES_RETURN`; they add stock and reduce customer balance like a customer credit.
- Net sales reports must subtract active `SALES_RETURN` invoices from active `SALE` invoices.
- Canonical financial helpers live in backend `src/utils/financial.ts`, web `src/utils/financial.ts`, and Android `domain/finance/FinancialCalculator.kt`.
- Invoice overpayment is not stored as negative remaining debt: POS treats it as change, while the normal web invoice may record the extra as a separate receipt voucher.

## Verification
- Web build: `cd inventory-web && npm run build`
- Backend tests/build: `cd inventory-backend && npm test && npm run build`
- Android tests/build: `cd inventory-android && .\gradlew.bat :app:testDebugUnitTest :app:assembleDebug` requires `JAVA_HOME`.
- Web lint currently has a pre-existing backlog across layout, reports, themes, and older screens; production build passes.
- Super Admin API build: `cd saas-admin-api && npm run build`
- Super Admin web build: `cd saas-admin-web && npm run build`
- Verified 2026-06-20: backend 201 tests passed and TypeScript build passed; web production/PWA build passed; Android unit tests and debug APK build passed with Android Studio JBR.

## Operational Risks
- `PROJECT_FULL_BRIEF.md` contains database credentials, deployment secrets, and default login credentials in tracked plaintext. Rotate exposed credentials and replace them with redacted examples.
- SSE clients/events are held in backend process memory, so realtime events are not shared across multiple replicas or server restarts.
- SSE authentication uses a JWT query parameter because browser `EventSource` cannot set headers; infrastructure may log that URL.
- Web build reports large chunks, especially the PDF bundle; this is an optimization issue, not a build failure.

## Recent Fixes
- 2026-09-12 carton pricing source protection COMPLETE: feature-only commit `7209b4a` (`feat: add protected carton pricing modes`) pushed to `origin/master`; unrelated local WhatsApp/security work was not included. Git-triggered Vercel and Railway production deployments succeeded. Follow-up migration `20260912120000_carton_price_positive` replaces the product check so a non-null carton piece price must be `> 0` and `<= sale_price`; UI, Zod schema, service guard, and tests enforce the same rule. Targeted backend suite remains 51/51 passing and both production builds pass.
- 2026-09-12 production rollout COMPLETE by explicit user approval: Railway `inventory-backend` deployment `78d403f8-567c-40b3-837a-37040b31823f` SUCCESS; migration `20260912000000_carton_piece_pricing` applied, both constraints verified, new Prisma fields readable and internal `/health` returned 200. Vercel deployment `dpl_G4vRrGjapkJy3UcfMxDZ3CHPK1sz` READY and promoted; alias listing confirmed `mazbwoni.com`, `app.mazbwoni.com`, `mahdi.mazbwoni.com`, `abomahdi.mazbwoni.com` point to `inventory-ah25ef4zb-inventory-db-s-projects.vercel.app`. This supersedes the local-only status below. Deployed a curated local snapshot; feature source remains uncommitted, so include these files before a future Git auto-deploy or the feature may be reverted.
- Pre-rollout full PostgreSQL 18.6 dump retained on production Postgres persistent volume `/var/lib/postgresql/data/deployment-backups/carton-pricing-before-20260912.dump`, mode 600; archive TOC readable and SHA256 `8031fabb08db0985054e8a1754a5cc4020e89c41551ba70cd2eceb601b14717a`. Full restore not performed. Slow local download was stopped and renamed `.dump.partial` under `C:/Users/IRAQ CELL/Documents/Codex/backups/carton-pricing-20260912`; do not treat that local file as a usable backup. Backend container pg_dump is v15 and cannot dump the v18 database; use the Postgres service client. Railway root directory is `inventory-backend`, so upload its parent (not a flattened backend folder). Vercel root is `inventory-web`; use Node 24 for its CLI.
- 2026-09-12, local-only carton pricing: Product adds nullable `cartonPiecePrice`; Invoice adds `priceMode` (WHOLESALE/RETAIL/CARTON). Missing carton price falls back to wholesale. Product editor shows carton total/discount and has a missing-carton-price filter. Ordinary web invoices retain every permitted unit in all price modes; catalog CARTON mode hides sub-carton stock and restricts purchases to whole cartons, with one wholesale-priced sample exception per product. Mode flows through approval/preparation to invoice; line prices remain snapshots. Android/desktop clients unchanged.
- Carton migration `20260912000000_carton_piece_pricing` is prepared, NOT applied to any database. Apply migrations to an isolated staging database and verify before production rollout; deploy backend before web. Shared price helpers: backend `src/utils/sale-pricing.ts`, web `src/utils/salePricing.ts`. Targeted verification: 51 backend tests + 24 web tests passed, builds passed, mobile/desktop catalog checked with mocked local API. No real Postgres end-to-end test or deployment performed. Existing lint baseline in the three edited pages remains 9 errors/3 warnings; new helper/catalog files lint clean.
- Phase 0 hardening: backend startup configuration is validated centrally without logging values; tests preload a guard that forces `NODE_ENV=test`, blocks non-`_test` database URLs, pins Prisma to an unreachable local test URL, and clears external-provider credentials so `.env` cannot reconnect tests to live services.
- Removed tenant-specific and legacy Vercel origins from the backend's built-in CORS fallback; production deployments should declare extra origins explicitly while `*.mazbwoni.com` remains supported by the platform allowlist.
- Added global administration localization for Arabic, English, and Persian. The selected admin language is persisted per browser and available beside the light/dark theme controls on desktop, mobile, and login.
- Customer-facing catalogs, customer links, documents, and printed invoices/vouchers remain Arabic with RTL direction regardless of the selected administration language.
- Admin translations are generated from the Arabic source strings by `scripts/generate-admin-translations.mjs`; runtime English/Persian dictionaries are lazy-loaded from `inventory-web/src/i18n/generatedTranslations.ts`.
- Added the production Super Admin platform: tenant dashboard, search/status filtering, subscriptions, billing cycle and price, limits for users/warehouses/invoices/customers/Android devices, per-feature toggles, device serial management, backend health checks, and audit history.
- Deployed Super Admin web to `admin.mazbwoni.com` and API to `admin-api.mazbwoni.com`; Railway SSL and backend health were verified.
- Isolated Super Admin tables in the PostgreSQL `saas_admin` schema so tenant administration cannot collide with Mahdi inventory/accounting tables.
- Registered the original shop as tenant `mahdi`, linked `mahdi.mazbwoni.com` to the existing Vercel app, and verified dynamic API resolution to `https://api.mazbwoni.com/api`.
- Completed a live accounting QA cycle using isolated `QA-20260620-*` records: opening stock distribution, purchase, approved warehouse transfer, sale, voucher create/edit/cancel/restore/archive, invoice edit/cancel/reactivate/archive, and purchase cancel/reactivate/archive. Final balances returned to zero and stock returned to its opening 50/50 warehouse split.
- Canceled and archived vouchers are excluded consistently from customer recalculation, statements, and last-transaction summaries.
- Audit logging now serializes Prisma Decimal, Date, bigint, and other JSON-shaped values safely instead of failing business mutations.
- Invoice updates use a longer Prisma transaction timeout suitable for remote Neon latency.
- Product movement history now includes invoices, completed warehouse transfers, and stock-loss records. Web and Android label the movement type and reference correctly.
- Web realtime SSE connects directly to the Railway backend when the normal API base is relative, avoiding Vercel proxy streaming timeouts.
- Railway production startup now starts the compiled server directly. Database migrations must be run explicitly before deployments that contain schema changes.
- Android POS no longer crashes when selecting a product whose payment field is outside the composed lazy-list viewport.
- Android voucher lists reload on resume after create/edit, and voucher deletion immediately refreshes cached customer balances.
- Android sale/POS customer suggestions exclude suppliers; purchase invoice suggestions include suppliers only.
- Android voice invoicing is now conversational: it sends recent dialogue history to the backend, supports spoken or typed follow-ups/corrections, shows the current conversation, renders multi-item plans, and offers tappable customer/product suggestions.
- Voice parsing now handles more Iraqi letter variants and token-level fuzzy matching, asks explicitly for payment mode/partial paid amount, understands corrections and cancellation, and keeps execution behind a confirmation step.
- Android now has three persisted app themes under Settings > Themes: Professional Blue, Warm Emerald, and Luxury Midnight. Theme selection is stored in DataStore and applied at the activity root.
- Replaced key hard-coded light card backgrounds with Material color-scheme containers so dark-theme text no longer appears nearly white on white.
- Current uncommitted work adds cross-client realtime synchronization: backend mutation broadcasts, web query invalidation, Android SSE-triggered WorkManager refresh, and voucher cache refresh.
- Cleaned web sidebar/header/invoices UI encoding around invoice navigation.
- Added visible sales-return filter/listing support in invoices page.
- Added sales-return links from customer/account statements.
- Updated dashboard, sales report, daily summary, and branch summary calculations to subtract sales returns.
- Phase 1 accounting hardening added consistent rounding, tested balance signs, Android discount persistence, negative opening balances, historical cost snapshots, and return-aware end-of-day/profit/product reports.
- Inventory follows a single-shop/multi-warehouse model. Legacy `Branch` API records represent warehouses, while `ProductWarehouseStock` stores quantity and shelf/location per product and warehouse.
- Invoice items persist `warehouseId`; web and Android invoice creation select the warehouse, and transfers move real warehouse balances atomically without changing the product total.
- Stocktake quantities are normalized to pieces: piece barcode adds 1 and carton barcode adds `pcsPerCarton`.
- Current uncommitted customer/account lookup change: backend supports `includeDeleted=true` on `GET /customers` and `GET /customers/:id/any`; web account lookup uses these to show archived customers with a "مؤرشف" badge while normal customer screens still use active customers.
