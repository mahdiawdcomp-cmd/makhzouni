import winston from "winston";

const { combine, timestamp, colorize, printf, json } = winston.format;

const devFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const extras = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${ts} [${level}] ${message}${extras}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  transports: [
    new winston.transports.Console({
      format:
        process.env.NODE_ENV === "production"
          ? combine(timestamp(), json())
          : combine(colorize(), timestamp({ format: "HH:mm:ss" }), devFormat),
    }),
  ],
});

// ── ErrorLog sink ───────────────────────────────────────────────────────────
// Every logger.error(...) is also forwarded to the sink (set by server.ts to
// error-log.service.recordError) so it shows up on /error-logs. Set via an
// injection hook instead of a direct import to avoid a circular dependency
// (error-log.service itself imports this logger). The `sinking` guard stops
// recursion if the sink ever logs an error of its own.
type ErrorSink = (message: string) => void;
let errorSink: ErrorSink | null = null;
let sinking = false;

export function setLoggerErrorSink(sink: ErrorSink): void {
  errorSink = sink;
}

const originalError = logger.error.bind(logger);
logger.error = ((...args: unknown[]) => {
  const result = (originalError as (...a: unknown[]) => winston.Logger)(...args);
  if (errorSink && !sinking) {
    sinking = true;
    try {
      const message = args
        .map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a)))
        .join(" ")
        .slice(0, 1000);
      errorSink(message);
    } catch {
      // never let the sink break logging
    } finally {
      sinking = false;
    }
  }
  return result;
}) as typeof logger.error;
