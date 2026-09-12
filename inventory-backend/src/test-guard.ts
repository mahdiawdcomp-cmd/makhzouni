/**
 * Loaded before every test file. Tests must never inherit a production-like
 * database URL from a developer shell or CI secret store.
 */
import { assertSafeTestDatabaseUrl } from "./config/test-database-safety";

process.env.NODE_ENV = "test";
assertSafeTestDatabaseUrl(process.env.DATABASE_URL);

// Pin all tests to a deliberately unreachable local test database. dotenv does
// not overwrite existing values by default, so a later `dotenv/config` import
// cannot silently restore the developer or production DATABASE_URL.
process.env.DATABASE_URL = "postgresql://test_guard:test_guard@127.0.0.1:1/inventory_test?connect_timeout=1";

// Tests must opt into fake adapters. Empty values keep dotenv from restoring
// live provider credentials inherited from a developer's .env file.
for (const key of [
  "SUPER_ADMIN_API_URL",
  "SUPER_ADMIN_API_KEY",
  "WHATSAPP_CLOUD_TOKEN",
  "WHATSAPP_CLOUD_PHONE_NUMBER_ID",
  "WHATSAPP_CLOUD_APP_SECRET",
  "WHATSAPP_CLOUD_VERIFY_TOKEN",
  "GREENAPI_BASE_URL",
  "GREENAPI_INSTANCE_ID",
  "GREENAPI_TOKEN",
  "GREENAPI_WEBHOOK_SECRET",
  "INSTAGRAM_APP_ID",
  "INSTAGRAM_APP_SECRET",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "GROQ_API_KEY",
  "ANTHROPIC_API_KEY",
] as const) {
  process.env[key] = "";
}
