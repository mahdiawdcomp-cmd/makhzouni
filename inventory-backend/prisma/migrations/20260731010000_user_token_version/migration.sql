-- Additive only: lets a password change or an explicit logout invalidate every
-- token already issued for that user. Without it a stolen 30-day token stayed
-- valid through every remediation short of deactivating the account.
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;
