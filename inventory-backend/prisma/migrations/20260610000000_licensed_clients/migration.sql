-- CreateTable
CREATE TABLE "licensed_clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "license_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "months" INTEGER NOT NULL,
    "notes" TEXT,
    "is_revoked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "licensed_clients_pkey" PRIMARY KEY ("id")
);
