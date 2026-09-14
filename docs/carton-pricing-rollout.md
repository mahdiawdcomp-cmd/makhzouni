# Carton pricing — local implementation, 2026-09-12

## Production deployment completed

On 2026-09-12 the user explicitly approved publishing to the actual website. Railway deployment `78d403f8-567c-40b3-837a-37040b31823f` succeeded and applied the carton migration. Read-only post-deploy verification confirmed both checks, Prisma access to both new fields, and HTTP 200 from internal health. Vercel deployment `dpl_G4vRrGjapkJy3UcfMxDZ3CHPK1sz` was built and promoted; the alias listing points the platform/tenant domains to the new deployment. No real customer order or invoice was created for testing.

A full PostgreSQL 18.6 backup is on the Postgres persistent volume at `/var/lib/postgresql/data/deployment-backups/carton-pricing-before-20260912.dump`; TOC and SHA256 verified, not a tested full restoration. SHA256: `8031fabb08db0985054e8a1754a5cc4020e89c41551ba70cd2eceb601b14717a`. The local `.dump.partial` is incomplete and must not be used for restore.

Publishing used a curated local snapshot, not a Git push. Source changes still need inclusion in Git before any later Git-triggered deployment. The pre-deployment notes below describe the earlier state, not the current deployed status.

## Rules

- Wholesale `salePrice`, retail `retailPrice`, and optional `cartonPiecePrice` are prices per piece. Carton total is piece price multiplied by `pcsPerCarton`.
- Null carton price falls back to wholesale; zero is an explicitly free price, not a missing value. Carton price must be nonnegative and no greater than wholesale. Lowering wholesale below an existing carton price is rejected unless the carton price is adjusted/cleared too.
- Ordinary web invoices allow the existing units in every price mode. Switching mode offers repricing all rows or only future additions. Existing manually entered and historical line prices stay intact.
- Wholesale catalog asks cartons versus dozens. Carton mode lists only full-carton stock and allows only whole cartons, except one wholesale-priced sample piece per product. Server recomputes prices and validates stock/units; client totals are not trusted.
- Switching catalog mode confirms before repricing retained cart lines/removing incompatible ones. Mode travels through approval and preparation into the invoice. Reports remain mixed.

## Deployment boundary

No production database or deployment was changed. Prisma client generation is local only.

1. Back up the target database and test restoration. Use an isolated staging database first.
2. Review ALL pending Prisma migrations for the target before running `npm run prisma:deploy` from `inventory-backend`; this command applies all pending migrations, not just this feature.
3. Confirm migration `20260912000000_carton_piece_pricing` applied successfully, including both database checks. Generate Prisma client and build/deploy backend, then build/deploy web.
4. Smoke-test product save (1000/2000/750, 48 pieces), null fallback, rejection of carton price above wholesale, ordinary invoice modes, both catalog entry modes, stock below one carton, sample quantity, cart switching, order approval/preparation and reopening its invoice.
5. Check older clients still work with omitted `priceMode` (wholesale default). Old invoices are labeled wholesale by default, but their saved line prices are unchanged.

## Verification and limits

- Backend targeted test suite: 51 passing, using mock/in-memory storage and the existing isolated test guard; not a real PostgreSQL integration test.
- Web pricing/catalog helper tests: 24 passing.
- Backend and web production builds passed. Existing large-bundle/PWA deprecation warnings remain.
- Browser checks use local mocked API fixtures at 390px and 1440px, not real shop/customer data. External network requests were blocked; expected font-load failures are not application exceptions.
- Edited-page ESLint baseline: 9 errors and 3 warnings, the same counts/rules as HEAD. This feature does not resolve that older backlog.
- Migration execution, real database constraints, full real order-to-invoice UI smoke test and publishing still require staging/rollout verification.
