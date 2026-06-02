import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    console.log("Creating enum TransferStatus...");
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    console.log("Creating inventory_transfers table...");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "inventory_transfers" (
        "id" UUID NOT NULL,
        "transfer_number" TEXT NOT NULL,
        "from_branch_id" UUID NOT NULL,
        "to_branch_id" UUID NOT NULL,
        "status" "TransferStatus" NOT NULL DEFAULT 'COMPLETED',
        "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "notes" TEXT,
        "created_by" UUID NOT NULL,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
      );
    `);

    console.log("Adding unique constraint on transfer_number...");
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_transfer_number_key" UNIQUE ("transfer_number");
      EXCEPTION
        WHEN duplicate_table THEN null;
        WHEN duplicate_object THEN null;
      END $$;
    `);

    console.log("Adding foreign keys for inventory_transfers 1...");
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_from_branch_id_fkey" FOREIGN KEY ("from_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    
    console.log("Adding foreign keys for inventory_transfers 2...");
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_to_branch_id_fkey" FOREIGN KEY ("to_branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    console.log("Adding foreign keys for inventory_transfers 3...");
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    console.log("Creating transfer_items table...");
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "transfer_items" (
        "id" UUID NOT NULL,
        "transfer_id" UUID NOT NULL,
        "product_id" UUID NOT NULL,
        "quantity" INTEGER NOT NULL,
        "unit" "Unit" NOT NULL,
        CONSTRAINT "transfer_items_pkey" PRIMARY KEY ("id")
      );
    `);

    console.log("Adding foreign keys for transfer_items 1...");
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "inventory_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    console.log("Adding foreign keys for transfer_items 2...");
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    console.log("Migration successful!");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
