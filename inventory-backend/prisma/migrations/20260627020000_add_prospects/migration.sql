-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('NEW', 'CONVERTED');

-- CreateTable
CREATE TABLE "prospects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "source" TEXT,
    "status" "ProspectStatus" NOT NULL DEFAULT 'NEW',
    "converted_customer_id" UUID,
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prospects_phone_key" ON "prospects"("phone");

-- CreateIndex
CREATE INDEX "prospects_status_idx" ON "prospects"("status");
