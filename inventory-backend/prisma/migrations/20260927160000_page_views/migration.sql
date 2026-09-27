-- «سجل الصفحات»: which page each account opened. Additive only.
CREATE TABLE IF NOT EXISTS "page_views" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "user_name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "page_views_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "page_views_created_at_idx" ON "page_views"("created_at");
CREATE INDEX IF NOT EXISTS "page_views_user_id_created_at_idx" ON "page_views"("user_id", "created_at");
