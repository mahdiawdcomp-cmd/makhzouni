import https from "https";

const BACKEND_HOST = "inventory-backend-production-7e85.up.railway.app";

export default function handler(req, res) {
  const url = req.url || "/";
  const apiPath = url.replace(/^\/api\//, "").split("?")[0];
  const rawQs = url.includes("?") ? url.split("?")[1] : "";
  const backendPath = `/api/${apiPath}${rawQs ? "?" + rawQs : ""}`;

  const bodyChunks = [];
  req.on("data", (c) => bodyChunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(bodyChunks).toString();

    const opts = {
      hostname: BACKEND_HOST,
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
