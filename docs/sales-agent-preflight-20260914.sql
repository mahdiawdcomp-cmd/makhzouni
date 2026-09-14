-- ═══════════════════════════════════════════════════════════════════════
--  PRE-DEPLOY PROBE — READ ONLY. Safe to run on production.
--
--  Answers one question before the offers migration is applied:
--  can this database create the `btree_gist` extension the offers
--  EXCLUDE constraint needs?
--
--  Every statement below is a SELECT. There is NO CREATE EXTENSION here,
--  no DDL, no writes, and nothing that locks a table. Run it, read the
--  answers, and decide.
--
--  It prints no credentials: the connection string, username and password
--  never appear in the output.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Is btree_gist ALREADY installed? If this returns a row, the migration
--    has nothing to do and `CREATE EXTENSION IF NOT EXISTS` is a no-op.
SELECT 'btree_gist installed' AS check,
       extname,
       extversion
FROM pg_extension
WHERE extname = 'btree_gist';

-- 2. Is it AVAILABLE to install on this server? An empty result means the
--    contrib package is missing from the host and the migration cannot
--    succeed no matter what permissions we have.
SELECT 'btree_gist available' AS check,
       name,
       default_version,
       installed_version
FROM pg_available_extensions
WHERE name = 'btree_gist';

-- 3. What can the current role do? `CREATE EXTENSION` needs superuser, OR
--    the role must be able to create objects in the target schema for a
--    trusted extension (btree_gist is trusted from PostgreSQL 13 on).
SELECT 'role powers' AS check,
       current_user                                        AS role_name,
       rolsuper                                            AS is_superuser,
       rolcreatedb                                         AS can_create_db,
       pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_in_public
FROM pg_roles
WHERE rolname = current_user;

-- 4. Is btree_gist marked TRUSTED on this server? When it is, and the role
--    has CREATE on the schema, a non-superuser may install it.
SELECT 'btree_gist trusted' AS check,
       name,
       trusted,
       relocatable,
       schema
FROM pg_available_extension_versions
WHERE name = 'btree_gist';

-- 5. Server version, because the half-open `tsrange` behaviour and the
--    trusted-extension rule both depend on it.
SELECT 'server version' AS check, version();

-- 6. Do the objects this release adds already exist? All three should be
--    empty BEFORE the deploy; re-run afterwards and all three should be
--    present.
SELECT 'existing objects' AS check, 'table' AS kind, table_name AS name
FROM information_schema.tables
WHERE table_name IN ('sales_agent_customer_offers', 'sales_agent_visits', 'sales_agent_visit_plans')
UNION ALL
SELECT 'existing objects', 'column', column_name
FROM information_schema.columns
WHERE (table_name = 'customers' AND column_name IN ('latitude', 'longitude'))
   OR (table_name = 'pending_approvals' AND column_name = 'customer_id')
   OR (table_name = 'sales_agent_visits' AND column_name IN ('plan_id', 'order_approval_id'))
UNION ALL
SELECT 'existing objects', 'constraint', conname
FROM pg_constraint
WHERE conname = 'sales_agent_offers_no_overlap';

-- 7. How many approval rows the backfill would touch, and how many carry an
--    id that does NOT point at a real customer (those are skipped, which is
--    why the foreign key is safe to add).
SELECT 'backfill scope' AS check,
       COUNT(*) FILTER (
         WHERE (request_data ->> 'customerId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       ) AS rows_with_customer_id,
       COUNT(*) FILTER (
         WHERE (request_data ->> 'customerId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           AND NOT EXISTS (
             SELECT 1 FROM customers c WHERE c.id = ((request_data ->> 'customerId'))::uuid
           )
       ) AS rows_pointing_at_a_missing_customer,
       COUNT(*) AS catalog_order_rows_total
FROM pending_approvals
WHERE request_type = 'CATALOG_ORDER';

-- ═══════════════════════════════════════════════════════════════════════
--  HOW TO READ THE RESULT
--
--  • Query 1 returns a row            → nothing to install. Proceed.
--  • Query 1 empty, 2 returns a row, and (3 says is_superuser = true
--    OR (4 says trusted = true AND 3 says can_create_in_public = true))
--                                     → the migration will install it. Proceed.
--  • Query 2 empty                    → STOP. The host has no btree_gist;
--    ask the provider to add postgresql-contrib. There is no fallback (below).
--  • Query 1 and 4 empty and not superuser
--                                     → STOP. Ask the provider to run
--    `CREATE EXTENSION btree_gist;` once, as a one-line request, THEN deploy.
--
--  IF THE EXTENSION CAN NEVER BE INSTALLED
--
--  There is NO approved fallback. Do not deploy the offers migration until
--  btree_gist is available.
--
--  A partial UNIQUE index on (customer_id, product_id, unit, price_mode)
--  WHERE (is_active) was considered and is REJECTED: it keys on the columns
--  alone and ignores the window, so a FINISHED offer that is still
--  `is_active = true` — which is the normal state, since an offer ends by its
--  `ends_at` date and nothing flips the flag — would permanently block every
--  new offer for that customer/product/unit/basis. It would also make a
--  scheduled future offer impossible while the current one is live. Adopting
--  it would need a separate design (an explicit "close the offer" step, or a
--  deactivation job) and its own review. Not in scope here.
--
--  So the options are: get btree_gist installed, or hold this release's offers
--  migration. The two other migrations (approval customer_id, visit plans) do
--  not need any extension and are unaffected.
-- ═══════════════════════════════════════════════════════════════════════
