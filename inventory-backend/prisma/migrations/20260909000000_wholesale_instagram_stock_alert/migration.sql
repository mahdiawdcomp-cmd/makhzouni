-- «إنستغرام الجملة» — persistent stock-out alert on an already-PUBLISHED post.
-- Meta's Instagram-Login API cannot delete a live post; these columns track a
-- human-dismissed review flag instead. stock_alert_at is set once and never
-- cleared (so a dismissed alert can never silently reappear); the separate
-- dismissed flag is what the admin actually toggles. Additive only.

ALTER TABLE "wholesale_instagram_posts" ADD COLUMN "stock_alert_at" TIMESTAMP(3);
ALTER TABLE "wholesale_instagram_posts" ADD COLUMN "stock_alert_dismissed" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "wholesale_instagram_posts_stock_alert_at_idx" ON "wholesale_instagram_posts"("stock_alert_at");
