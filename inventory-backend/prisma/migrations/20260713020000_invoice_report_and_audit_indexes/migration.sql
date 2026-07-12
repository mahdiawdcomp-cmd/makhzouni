-- Composite indexes for the invoice-slowness/backup-OOM performance cleanup
-- (2026-07-13). Both source tables are small (invoices ~400 rows, audit_logs
-- ~3k rows after the AUDIT_LOG_LIMIT reduction), so plain CREATE INDEX is
-- effectively instant and does not need CONCURRENTLY.

-- getDashboardReport / getDailySummaryData / getProfitReport / StoreBrain all
-- filter status+type+date together.
CREATE INDEX IF NOT EXISTS "invoices_status_type_date_idx" ON "invoices"("status", "type", "date");

-- Customer statement lookups filter recordId IN (...) + entity IN (...) together.
CREATE INDEX IF NOT EXISTS "audit_logs_entity_record_id_idx" ON "audit_logs"("entity", "record_id");
