-- Server-side «last seen» for the bell's legacy feed, so every device of one
-- user shows the same unread count. Additive and nullable: a user with no
-- value starts counting from their next visit, not from the beginning.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notifications_seen_at" TIMESTAMP(3);
