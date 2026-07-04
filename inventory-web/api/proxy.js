import https from "https";

// Fail-closed API proxy. The tenant backend host MUST come from an explicit
// environment variable on this deployment — there is deliberately NO hardcoded
// fallback. If no backend is configured we return 503 rather than silently
// routing a request to any other tenant's backend.
//
// Note: the primary multi-tenant routing path is client-side
// (configureTenantApi in src/api/client.ts resolves each subdomain to its own
// absolute backendUrl), so this proxy is only ever used when API_BASE_URL stays
// relative ("/api"). Even then it must never leak to another tenant.
const BACKEND_URL = process.env.BACKEND_PROXY_URL || process.env.VITE_API_URL || "";

function resolveBackendHost() {
  const raw = String(BACKEND_URL).trim();
  if (!raw) return null;
  try {
    return new URL(raw).host || null;
  } catch {
    // Accept a bare host value too (no scheme / no path).
    const host = raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    return host || null;
  }
}

export default function handler(req, res) {
  const backendHost = resolveBackendHost();
  if (!backendHost) {
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: "TENANT_BACKEND_NOT_CONFIGURED",
        message: "No backend is configured for this deployment.",
      })
    );
    return;
  }

  const url = req.url || "/";
  const apiPath = url.replace(/^\/api\//, "").split("?")[0];
  const rawQs = url.includes("?") ? url.split("?")[1] : "";
  const backendPath = `/api/${apiPath}${rawQs ? "?" + rawQs : ""}`;

  const bodyChunks = [];
  req.on("data", (c) => bodyChunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(bodyChunks).toString();

    const opts = {
      hostname: backendHost,
      port: 443,
      path: backendPath,
      method: req.method,
      headers: { "Content-Type": "application/json" },
    };
    if (req.headers.authorization) opts.headers["Authorization"] = req.headers.authorization;
    if (body) opts.headers["Content-Length"] = Buffer.byteLength(body);

    const pr = https.request(opts, (pres) => {
      const chunks = [];
      pres.on("data", (c) => chunks.push(c));
      pres.on("end", () => {
        const buf = Buffer.concat(chunks);
        res.statusCode = pres.statusCode;
        res.setHeader("Content-Type", pres.headers["content-type"] || "application/json");
        res.end(buf);
      });
    });

    pr.on("error", (e) => {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: false, message: "proxy error: " + e.message }));
    });

    if (body) pr.write(body);
    pr.end();
  });
}
