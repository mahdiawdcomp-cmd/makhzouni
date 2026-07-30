import { NextFunction, Request, Response } from "express";

// Query strings can carry credentials (the backup secret, provider tokens on
// webhook callbacks). Anything logged here lands in the platform's log stream
// and every proxy in front of it, so secret-looking values are masked before
// the line is written.
const SENSITIVE_QUERY_KEYS = /^(secret|token|key|password|apikey|api_key|access_token|signature)$/i;

export function redactUrl(originalUrl: string): string {
  const queryStart = originalUrl.indexOf("?");
  if (queryStart === -1) return originalUrl;

  const path = originalUrl.slice(0, queryStart);
  const params = new URLSearchParams(originalUrl.slice(queryStart + 1));
  let touched = false;
  for (const key of Array.from(params.keys())) {
    if (SENSITIVE_QUERY_KEYS.test(key)) {
      params.set(key, "***");
      touched = true;
    }
  }
  if (!touched) return originalUrl;
  return `${path}?${params.toString()}`;
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startedAt;
    const user = req.user ? ` user=${req.user.username}` : "";
    console.log(
      `${req.method} ${redactUrl(req.originalUrl)} ${res.statusCode} ${duration}ms${user}`
    );
  });

  next();
}
