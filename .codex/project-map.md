# Project Map

## Shape
- `inventory-backend`: Node/TypeScript API with Prisma/Postgres. Main business logic is in `src/services`, routes in `src/routes`, validation in `src/utils/schemas.ts`.
- `inventory-web`: Vite/React dashboard. Routes live in `src/App.tsx`, API wrapper in `src/api/endpoints.ts`, layout in `src/components/layout`.
- `inventory-android`: Kotlin/Jetpack Compose Android app. API client lives under `app/src/main/java/com/inventory/data/remote`, screens under `ui`.

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

## Recent Fixes
- Cleaned web sidebar/header/invoices UI encoding around invoice navigation.
- Added visible sales-return filter/listing support in invoices page.
- Added sales-return links from customer/account statements.
- Updated dashboard, sales report, daily summary, and branch summary calculations to subtract sales returns.
- Phase 1 accounting hardening added consistent rounding, tested balance signs, Android discount persistence, negative opening balances, historical cost snapshots, and return-aware end-of-day/profit/product reports.
- Inventory follows a single-shop/multi-warehouse model. Legacy `Branch` API records represent warehouses, while `ProductWarehouseStock` stores quantity and shelf/location per product and warehouse.
- Invoice items persist `warehouseId`; web and Android invoice creation select the warehouse, and transfers move real warehouse balances atomically without changing the product total.
- Stocktake quantities are normalized to pieces: piece barcode adds 1 and carton barcode adds `pcsPerCarton`.
- Current uncommitted customer/account lookup change: backend supports `includeDeleted=true` on `GET /customers` and `GET /customers/:id/any`; web account lookup uses these to show archived customers with a "مؤرشف" badge while normal customer screens still use active customers.
