// Zero-dependency HTTP server (Node's built-in `http` only — no express).
// Keeping this dependency-free means the whole backend runs with just
// `node --env-file=.env dist/index.js`, no npm install required to try it.

import http from "http";
import fs from "fs";
import path from "path";
import { runAgent } from "./agent";

const PORT = Number(process.env.PORT) || 4000;

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type",
};

// The single repo the agent is currently scoped to, set via POST /api/init.
let repoRoot: string | null = null;

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...CORS_HEADERS });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  try {
    if (req.method === "POST" && req.url === "/api/init") {
      const { repoPath } = await readBody(req);
      if (!repoPath) return sendJson(res, 400, { error: "repoPath is required" });

      const resolved = path.resolve(repoPath);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return sendJson(res, 400, { error: `"${resolved}" is not a directory on this machine.` });
      }
      repoRoot = resolved;
      return sendJson(res, 200, { ok: true, repoRoot });
    }

    if (req.method === "GET" && req.url === "/api/status") {
      return sendJson(res, 200, { repoRoot });
    }

    if (req.method === "POST" && req.url === "/api/chat") {
      if (!repoRoot) {
        return sendJson(res, 400, { error: "No repository loaded yet. Call /api/init first." });
      }
      if (!process.env.ANTHROPIC_API_KEY) {
        return sendJson(res, 500, { error: "ANTHROPIC_API_KEY is not set on the server." });
      }

      const { message, history } = await readBody(req);
      if (!message) return sendJson(res, 400, { error: "message is required" });

      const result = await runAgent(message, history ?? [], repoRoot);
      return sendJson(res, 200, result);
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err: any) {
    console.error(err);
    sendJson(res, 500, { error: err.message ?? "Internal error" });
  }
});

server.listen(PORT, () => {
  console.log(`CodeScout backend listening on http://localhost:${PORT}`);
});
