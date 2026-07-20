-- The previous migration (20260721020000_telegram_broadcast) hand-wrote its
-- SQL and missed the DB-level id default that every sibling table has
-- (e.g. telegram_bot_chats, telegram_channel_posts) — harmless in practice
-- since Prisma Client always supplies the id itself, but real schema drift
-- against what `prisma migrate dev` would generate, and any future raw-SQL
-- insert without an explicit id would fail. Additive/corrective only.
ALTER TABLE "telegram_broadcasts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "telegram_broadcast_recipients" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
