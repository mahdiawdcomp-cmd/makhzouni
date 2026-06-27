-- CreateEnum
CREATE TYPE "InboundMessageSource" AS ENUM ('CUSTOMER_UNMATCHED', 'PROSPECT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InboundMessageStatus" AS ENUM ('UNREAD', 'READ', 'REPLIED');

-- CreateTable
CREATE TABLE "inbound_messages" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "source" "InboundMessageSource" NOT NULL,
    "message_text" TEXT NOT NULL,
    "status" "InboundMessageStatus" NOT NULL DEFAULT 'UNREAD',
    "reply_text" TEXT,
    "replied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inbound_messages_status_idx" ON "inbound_messages"("status");
