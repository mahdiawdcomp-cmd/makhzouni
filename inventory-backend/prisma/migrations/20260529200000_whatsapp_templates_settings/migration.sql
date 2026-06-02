CREATE TABLE "message_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "message_templates_name_key" ON "message_templates"("name");
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

INSERT INTO "message_templates" ("name", "body", "type")
VALUES
  (
    'فاتورة جديدة',
    'مرحباً {customerName}، تم إصدار فاتورة رقم {invoiceNumber} بتاريخ {date}. المبلغ المتبقي: {amount}. شكراً لتعاملكم مع {storeName}.',
    'NEW_INVOICE'
  ),
  (
    'تذكير بالدين',
    'مرحباً {customerName}، نود تذكيركم بأن الرصيد المستحق هو {amount} منذ {daysLate} يوم. {storeName}',
    'DEBT_REMINDER'
  ),
  (
    'ترحيب بعد غياب',
    'مرحباً {customerName}، اشتقنا لتعاملكم معنا. مر {daysLate} يوم منذ آخر تعامل. يسعدنا خدمتكم مجدداً في {storeName}.',
    'INACTIVE_CUSTOMER'
  );

INSERT INTO "settings" ("key", "value")
VALUES
  ('debtReminderDays', '14'::jsonb),
  ('inactiveCustomerDays', '30'::jsonb),
  ('autoSendDebtReminder', 'false'::jsonb),
  ('autoSendInactiveMessage', 'false'::jsonb),
  ('storeName', '"Inventory Store"'::jsonb);
