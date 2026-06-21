# Project Map

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
