import assert from "node:assert/strict";
import test from "node:test";
import { reportStartupEnvIssues, validateStartupEnv } from "./validate-env";

test("production refuses a missing database and a weak JWT secret", () => {
  const issues = validateStartupEnv({
    NODE_ENV: "production",
    JWT_SECRET: "change-this-secret-before-production",
  });

  assert.deepEqual(
    issues.filter((item) => item.level === "fatal").map((item) => item.variable),
    ["DATABASE_URL", "JWT_SECRET"],
  );
});

test("standalone mode does not require SaaS-only variables", () => {
  const issues = validateStartupEnv({
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://localhost/inventory",
    JWT_SECRET: "a-development-secret-that-is-not-a-known-default",
  });

  assert.equal(issues.some((item) => item.variable === "SUPER_ADMIN_API_URL"), false);
  assert.equal(issues.some((item) => item.variable === "CREDENTIALS_ENCRYPTION_KEY"), false);
});

test("SaaS mode reports missing enforcement and encryption configuration", () => {
  const issues = validateStartupEnv({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://localhost/inventory",
    JWT_SECRET: "a-production-secret-that-is-not-a-known-default",
    TENANT_ID: "shop-one",
    ALLOWED_ORIGINS: "https://shop-one.example",
  });

  assert.deepEqual(
    issues.map((item) => item.variable),
    ["SUPER_ADMIN_API_URL", "SUPER_ADMIN_API_KEY", "CREDENTIALS_ENCRYPTION_KEY"],
  );
  assert.equal(issues.every((item) => item.level === "warning"), true);
});

test("the reporter prints variable names and messages, never environment values", () => {
  const lines: string[] = [];
  reportStartupEnvIssues(
    [{ level: "warning", variable: "API_TOKEN", message: "is missing" }],
    { error: (line) => lines.push(String(line)), warn: (line) => lines.push(String(line)) },
  );

  assert.deepEqual(lines, ["[WARN] API_TOKEN is missing."]);
});

