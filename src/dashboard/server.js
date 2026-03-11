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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
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

  if (request.method !== "POST") {
    return sendJson(response, 405, { error: "Method not allowed" });
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
    return sendJson(response, 200, await manager.runResearch(body.symbols || []));
  }
  if (url.pathname === "/api/mode") {
    return sendJson(response, 200, await manager.setMode(body.mode));
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
      sendJson(response, 500, {
        error: error.message || "Unexpected server error"
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
