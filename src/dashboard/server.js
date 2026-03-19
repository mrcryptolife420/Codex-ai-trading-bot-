import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { BotManager } from "../runtime/botManager.js";

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};
const MAX_REQUEST_BODY_BYTES = 1_000_000;

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

export function normalizeSymbolList(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item != null)
      .map((item) => `${item}`.trim())
      .filter(Boolean);
  }
  const single = `${value || ""}`.trim();
  return single ? [single] : [];
}

export async function readRequestBody(request) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_REQUEST_BODY_BYTES) {
      const error = new Error("Request body too large");
      error.statusCode = 413;
      error.publicMessage = "Request body too large";
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    error.statusCode = 400;
    error.publicMessage = "Invalid JSON body";
    throw error;
  }
}

function isTrustedMutationRequest(request) {
  const marker = `${request.headers["x-dashboard-request"] || ""}`.trim();
  if (marker !== "1") {
    return false;
  }
  const contentType = `${request.headers["content-type"] || ""}`.toLowerCase();
  if (contentType && !contentType.includes("application/json")) {
    return false;
  }
  const origin = `${request.headers.origin || ""}`.trim();
  if (!origin) {
    return true;
  }
  try {
    const url = new URL(origin);
    return ["127.0.0.1", "localhost"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function serveStatic(publicDir, requestPath, response) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const safePath = path.normalize(normalized).replace(/^([.][.][/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=60"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    throw error;
  }
}

async function handleApi(request, response, manager) {
  const url = new URL(request.url, "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/api/snapshot") {
    return sendJson(response, 200, await manager.getSnapshot());
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    const readiness = await manager.getOperationalReadiness();
    return sendJson(response, 200, {
      ok: true,
      status: readiness.status,
      reasons: readiness.reasons,
      checkedAt: readiness.checkedAt
    });
  }
  if (request.method === "GET" && url.pathname === "/api/readiness") {
    const readiness = await manager.getOperationalReadiness();
    return sendJson(response, readiness.ok ? 200 : 503, readiness);
  }
  if (request.method === "GET" && url.pathname === "/api/status") {
    return sendJson(response, 200, await manager.getStatus());
  }
  if (request.method === "GET" && url.pathname === "/api/doctor") {
    return sendJson(response, 200, await manager.getDoctor());
  }
  if (request.method === "GET" && url.pathname === "/api/report") {
    return sendJson(response, 200, await manager.getReport());
  }

  if (request.method !== "POST") {
    return sendJson(response, 405, { error: "Method not allowed" });
  }

  if (!isTrustedMutationRequest(request)) {
    return sendJson(response, 403, { error: "Forbidden" });
  }

  const body = await readRequestBody(request);

  if (url.pathname === "/api/start") {
    return sendJson(response, 200, await manager.start());
  }
  if (url.pathname === "/api/stop") {
    return sendJson(response, 200, await manager.stop("dashboard_stop"));
  }
  if (url.pathname === "/api/refresh") {
    return sendJson(response, 200, await manager.refreshAnalysis());
  }
  if (url.pathname === "/api/cycle") {
    return sendJson(response, 200, await manager.runCycleOnce());
  }
  if (url.pathname === "/api/research") {
    return sendJson(response, 200, await manager.runResearch(normalizeSymbolList(body.symbols)));
  }
  if (url.pathname === "/api/mode") {
    return sendJson(response, 200, await manager.setMode(body.mode));
  }
  if (url.pathname === "/api/alerts/ack") {
    return sendJson(response, 200, await manager.acknowledgeAlert(body.id, body.acknowledged !== false, body.note || null));
  }
  if (url.pathname === "/api/alerts/silence") {
    return sendJson(response, 200, await manager.silenceAlert(body.id, body.minutes));
  }
  if (url.pathname === "/api/alerts/resolve") {
    return sendJson(response, 200, await manager.resolveAlert(body.id, body.resolved !== false, body.note || null));
  }
  if (url.pathname === "/api/ops/force-reconcile") {
    return sendJson(response, 200, await manager.forceReconcile(body.note || null));
  }
  if (url.pathname === "/api/positions/review") {
    return sendJson(response, 200, await manager.markPositionReviewed(body.id, body.note || null));
  }
  if (url.pathname === "/api/ops/probe-only") {
    return sendJson(response, 200, await manager.setProbeOnly(body.enabled !== false, body.minutes, body.note || null));
  }
  if (url.pathname === "/api/diagnostics/action") {
    return sendJson(response, 200, await manager.runDiagnosticsAction(body.action, body.target || null, body.note || null));
  }
  if (url.pathname === "/api/policies/approve") {
    return sendJson(response, 200, await manager.approvePolicyTransition(body.id, body.action, body.note || null));
  }
  if (url.pathname === "/api/policies/reject") {
    return sendJson(response, 200, await manager.rejectPolicyTransition(body.id, body.action, body.note || null));
  }
  if (url.pathname === "/api/policies/revert") {
    return sendJson(response, 200, await manager.revertPolicyTransition(body.id, body.note || null));
  }
  if (url.pathname === "/api/promotion/approve") {
    return sendJson(response, 200, await manager.approvePromotionCandidate(body.symbol, body.note || null));
  }
  if (url.pathname === "/api/promotion/rollback") {
    return sendJson(response, 200, await manager.rollbackPromotionCandidate(body.symbol, body.note || null));
  }
  if (url.pathname === "/api/promotion/scope/approve") {
    return sendJson(response, 200, await manager.approvePromotionScope(body.scope, body.note || null));
  }
  if (url.pathname === "/api/promotion/scope/rollback") {
    return sendJson(response, 200, await manager.rollbackPromotionScope(body.scope, body.note || null));
  }
  if (url.pathname === "/api/promotion/probation/decide") {
    return sendJson(response, 200, await manager.decidePromotionProbation(body.key, body.decision, body.note || null));
  }

  return sendJson(response, 404, { error: "Unknown API route" });
}

export async function startDashboardServer({
  projectRoot = process.cwd(),
  logger,
  port
} = {}) {
  const manager = new BotManager({ projectRoot, logger });
  const initial = await manager.init();
  const publicDir = path.join(projectRoot, "src", "dashboard", "public");
  const listenPort = port || initial.manager.dashboardPort || 3011;

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, manager);
        return;
      }
      await serveStatic(publicDir, url.pathname, response);
    } catch (error) {
      logger?.error?.("Dashboard request failed", {
        error: error.message,
        url: request.url
      });
      sendJson(response, error.statusCode || 500, {
        error: error.publicMessage || error.message || "Unexpected server error"
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, "127.0.0.1", resolve);
  });

  const dashboardUrl = `http://127.0.0.1:${listenPort}`;
  logger?.info?.("Dashboard server started", {
    url: dashboardUrl
  });

  const shutdown = async () => {
    try {
      await manager.stop("dashboard_shutdown");
    } catch {
      // ignore shutdown failures
    }
    await new Promise((resolve) => server.close(resolve));
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return {
    server,
    manager,
    port: listenPort,
    url: dashboardUrl
  };
}
