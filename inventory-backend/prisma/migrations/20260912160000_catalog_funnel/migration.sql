-- Anonymous, deduplicated milestones. No phone numbers, tokens, or prices.
CREATE TABLE "catalog_funnel_events" (
  "session_id" uuid NOT NULL,
  "stage" smallint NOT NULL CHECK ("stage" BETWEEN 0 AND 4),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("session_id", "stage")
);
CREATE INDEX "catalog_funnel_events_created_at_idx" ON "catalog_funnel_events" ("created_at");
