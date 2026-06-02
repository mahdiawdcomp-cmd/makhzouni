CREATE OR REPLACE FUNCTION recalculate_customer_balance(target_customer_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE "customers"
  SET
    "current_balance" =
      "opening_balance"
      + COALESCE((
        SELECT SUM("remaining_amount")
        FROM "invoices"
        WHERE "customer_id" = target_customer_id
          AND "status" = 'ACTIVE'
      ), 0)
      - COALESCE((
        SELECT SUM("amount")
        FROM "payment_vouchers"
        WHERE "customer_id" = target_customer_id
          AND "type" = 'RECEIPT'
      ), 0)
      + COALESCE((
        SELECT SUM("amount")
        FROM "payment_vouchers"
        WHERE "customer_id" = target_customer_id
          AND "type" = 'PAYMENT'
      ), 0),
    "last_transaction_at" = (
      SELECT MAX("transaction_date")
      FROM (
        SELECT MAX("date") AS "transaction_date"
        FROM "invoices"
        WHERE "customer_id" = target_customer_id
          AND "status" = 'ACTIVE'
        UNION ALL
        SELECT MAX("date") AS "transaction_date"
        FROM "payment_vouchers"
        WHERE "customer_id" = target_customer_id
      ) AS "transactions"
    ),
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = target_customer_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_recalculate_customer_balance()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM recalculate_customer_balance(NEW."customer_id");
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD."customer_id" IS DISTINCT FROM NEW."customer_id" THEN
      PERFORM recalculate_customer_balance(OLD."customer_id");
    END IF;
    PERFORM recalculate_customer_balance(NEW."customer_id");
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM recalculate_customer_balance(OLD."customer_id");
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trigger_recalculate_customer_opening_balance()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM recalculate_customer_balance(NEW."id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoices_recalculate_customer_balance"
AFTER INSERT OR UPDATE OR DELETE ON "invoices"
FOR EACH ROW
EXECUTE FUNCTION trigger_recalculate_customer_balance();

CREATE TRIGGER "payment_vouchers_recalculate_customer_balance"
AFTER INSERT OR UPDATE OR DELETE ON "payment_vouchers"
FOR EACH ROW
EXECUTE FUNCTION trigger_recalculate_customer_balance();

CREATE TRIGGER "customers_opening_balance_recalculate"
AFTER UPDATE OF "opening_balance" ON "customers"
FOR EACH ROW
EXECUTE FUNCTION trigger_recalculate_customer_opening_balance();
