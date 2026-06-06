# Project Map

## Shape
- `inventory-backend`: Node/TypeScript API with Prisma/Postgres. Main business logic is in `src/services`, routes in `src/routes`, validation in `src/utils/schemas.ts`.
- `inventory-web`: Vite/React dashboard. Routes live in `src/App.tsx`, API wrapper in `src/api/endpoints.ts`, layout in `src/components/layout`.
- `inventory-android`: Kotlin/Jetpack Compose Android app. API client lives under `app/src/main/java/com/inventory/data/remote`, screens under `ui`.

## Important Current Findings
- Web/backend include coupons, quotations, sales returns, public catalog, PWA, and customer portal features.
- Android does not currently contain sales returns, coupons, quotations, or public catalog screens/API wiring.
- Sales returns are represented by `InvoiceType.SALES_RETURN`; they add stock and reduce customer balance like a customer credit.
- Net sales reports must subtract active `SALES_RETURN` invoices from active `SALE` invoices.

## Verification
- Web build: `cd inventory-web && npm run build`
- Backend build: `cd inventory-backend && npm run build`
- Android build: `cd inventory-android && .\gradlew.bat :app:assembleDebug` requires `JAVA_HOME`.

## Recent Fixes
- Cleaned web sidebar/header/invoices UI encoding around invoice navigation.
- Added visible sales-return filter/listing support in invoices page.
- Added sales-return links from customer/account statements.
- Updated dashboard, sales report, daily summary, and branch summary calculations to subtract sales returns.
