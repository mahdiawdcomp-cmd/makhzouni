-- Guest catalog phone gate: store each visitor phone once with a visit counter.
CREATE TABLE "catalog_visitors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone" TEXT NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_visitors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_visitors_phone_key" ON "catalog_visitors"("phone");
