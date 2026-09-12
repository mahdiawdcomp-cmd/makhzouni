type Env = Record<string, string | undefined>;

export type EnvIssue = {
  level: "fatal" | "warning";
  variable: string;
  message: string;
};

const WEAK_JWT_SECRETS = new Set([
  "change-this-secret-before-production",
  "secret",
  "changeme",
]);

function missing(env: Env, key: string): boolean {
  return !env[key]?.trim();
}

function issue(level: EnvIssue["level"], variable: string, message: string): EnvIssue {
  return { level, variable, message };
}

/**
 * Validate startup configuration without ever returning or logging secret values.
 * Optional integrations remain warnings so a standalone shop is not bricked by
 * credentials for providers it does not use.
 */
export function validateStartupEnv(env: Env = process.env): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const production = env.NODE_ENV === "production";
  const saas = !missing(env, "TENANT_ID");

  if (missing(env, "DATABASE_URL")) {
    issues.push(issue("fatal", "DATABASE_URL", "is required to start the server"));
  }

  const jwt = env.JWT_SECRET?.trim();
  if (!jwt || WEAK_JWT_SECRETS.has(jwt.toLowerCase())) {
    issues.push(issue(
      production ? "fatal" : "warning",
      "JWT_SECRET",
      production ? "must be a strong non-default value" : "is missing or uses a known development default",
    ));
  }

  if (saas) {
    for (const key of ["SUPER_ADMIN_API_URL", "SUPER_ADMIN_API_KEY"] as const) {
      if (missing(env, key)) issues.push(issue("warning", key, "is required for complete SaaS tenant enforcement"));
    }
    if (missing(env, "CREDENTIALS_ENCRYPTION_KEY")) {
      issues.push(issue(
        "warning",
        "CREDENTIALS_ENCRYPTION_KEY",
        "is not set; provider credentials may depend on the JWT_SECRET fallback and make secret rotation unsafe",
      ));
    }
  }

  if (production && missing(env, "ALLOWED_ORIGINS") && missing(env, "ALLOWED_ORIGIN")) {
    issues.push(issue("warning", "ALLOWED_ORIGINS", "is not set; only platform subdomains will be accepted by CORS"));
  }

  if (env.WHATSAPP_PROVIDER === "cloud") {
    for (const key of ["WHATSAPP_CLOUD_TOKEN", "WHATSAPP_CLOUD_PHONE_NUMBER_ID", "WHATSAPP_CLOUD_APP_SECRET"] as const) {
      if (missing(env, key)) issues.push(issue("warning", key, "is required by the selected WhatsApp Cloud provider"));
    }
  }

  if (env.KEEP_ALIVE_ENABLED === "true" && missing(env, "BACKEND_PUBLIC_URL") && missing(env, "RAILWAY_PUBLIC_DOMAIN")) {
    issues.push(issue("warning", "BACKEND_PUBLIC_URL", "is required when keep-alive is enabled outside Railway"));
  }

  return issues;
}

export function reportStartupEnvIssues(
  issues: EnvIssue[],
  output: Pick<Console, "error" | "warn"> = console,
): void {
  for (const item of issues) {
    const line = `[${item.level === "fatal" ? "FATAL" : "WARN"}] ${item.variable} ${item.message}.`;
    if (item.level === "fatal") output.error(line);
    else output.warn(line);
  }
}

