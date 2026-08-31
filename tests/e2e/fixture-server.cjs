"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { WebSocket, WebSocketServer } = require("ws");

const HOST = "127.0.0.1";
const PORT = Number(process.env.E2E_PORT || 4173);
const SITE_ROOT = path.resolve(__dirname, "..", "..", "site");
const ROOM_ID = "testroom_1234";
const HOST_TOKEN = "host-token-abcdefghijklmnopqrstuvwxyz";
const GUEST_TOKEN = "guest-token-abcdefghijklmnopqrstuvwxyz";
const room = {
  created: false,
  ended: false,
  sockets: { host: null, guest: null },
};

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function bearerToken(request) {
  const value = request.headers.authorization || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function validRoomToken(token) {
  return token === HOST_TOKEN || token === GUEST_TOKEN;
}

function roomPath(url) {
  return url.pathname === `/v1/rooms/${ROOM_ID}`;
}

function serveSite(request, response, url) {
  if (url.pathname === "/__test/ready") {
    sendJson(response, 200, { ready: true });
    return;
  }

  if (url.pathname === "/__test/state") {
    sendJson(response, 200, {
      created: room.created,
      ended: room.ended,
      hostConnected: room.sockets.host?.readyState === WebSocket.OPEN,
      guestConnected: room.sockets.guest?.readyState === WebSocket.OPEN,
    });
    return;
  }

  if (url.pathname === "/netplay-config.js") {
    const body = [
      "window.ROM_NOSTALG_NETPLAY_CONFIG = Object.freeze({",
      `  apiUrl: ${JSON.stringify(`http://${HOST}:${PORT}`)},`,
      '  turnstileSiteKey: "e2e-turnstile-site-key",',
      "});",
      "window.turnstile ||= {",
      "  render(_selector, options) {",
      '    window.setTimeout(() => options.callback("e2e-turnstile-token"), 0);',
      '    return "e2e-widget";',
      "  },",
      "  reset() {},",
      "};",
      "",
    ].join("\n");
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    });
    response.end(body);
    return;
  }

  if (url.pathname === "/__test-host") {
    const index = fs.readFileSync(path.join(SITE_ROOT, "index.html"), "utf8");
    const setup = fs.readFileSync(path.join(__dirname, "synthetic-host.js"), "utf8");
    const body = index.replace("</body>", `<script>${setup}</script></body>`);
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    });
    response.end(body);
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  } catch {
    response.writeHead(400).end();
    return;
  }

  const filePath = path.resolve(SITE_ROOT, `.${pathname}`);
  if (filePath !== SITE_ROOT && !filePath.startsWith(`${SITE_ROOT}${path.sep}`)) {
    response.writeHead(403).end();
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": stats.size,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "600",
    });
    response.end();
    return;
  }

  if (request.method === "POST" && url.pathname === "/v1/rooms") {
    try {
      const body = await readJson(request);
      if (body.turnstileToken !== "e2e-turnstile-token") {
        sendJson(response, 403, { error: { code: "turnstile_failed", message: "Turnstile inválido" } });
        return;
      }
      room.created = true;
      room.ended = false;
      sendJson(response, 201, {
        roomId: ROOM_ID,
        hostToken: HOST_TOKEN,
        guestToken: GUEST_TOKEN,
        expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      });
    } catch {
      sendJson(response, 400, { error: { code: "invalid_json", message: "JSON inválido" } });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === `/v1/rooms/${ROOM_ID}/ice`) {
    if (!room.created || room.ended) {
      sendJson(response, 404, { error: { code: "room_not_found", message: "Sala não encontrada" } });
      return;
    }
    if (!validRoomToken(bearerToken(request))) {
      sendJson(response, 401, { error: { code: "unauthorized", message: "Token inválido" } });
      return;
    }
    sendJson(response, 200, {
      // Loopback STUN is intentionally unreachable. Host candidates are enough
      // for two real Chromium pages while keeping the E2E test offline.
      iceServers: [{ urls: "stun:127.0.0.1:9" }],
    });
    return;
  }

  if (request.method === "DELETE" && roomPath(url)) {
    if (bearerToken(request) !== HOST_TOKEN) {
      sendJson(response, 401, { error: { code: "unauthorized", message: "Token inválido" } });
      return;
    }
    room.ended = true;
    for (const socket of Object.values(room.sockets)) {
      if (socket?.readyState === WebSocket.OPEN) socket.close(4000, "host_ended");
    }
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    response.end();
    return;
  }

  serveSite(request, response, url);
});

const websocketServer = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (url.pathname !== `/v1/rooms/${ROOM_ID}/ws` || !room.created || room.ended) {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    websocketServer.emit("connection", websocket, request);
  });
});

websocketServer.on("connection", (socket) => {
  let role = null;
  const authTimer = setTimeout(() => socket.close(4001, "authentication_failed"), 5_000);

  socket.on("message", (raw, isBinary) => {
    if (isBinary || raw.length > 128_000) return;
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }

    if (!role) {
      const expectedToken = message.role === "host" ? HOST_TOKEN : message.role === "guest" ? GUEST_TOKEN : "";
      if (message.type !== "auth" || message.token !== expectedToken || room.sockets[message.role]) {
        socket.send(JSON.stringify({
          type: "error",
          code: "authentication_failed",
          message: "Credenciais inválidas",
        }));
        socket.close(4001, "authentication_failed");
        return;
      }

      role = message.role;
      room.sockets[role] = socket;
      clearTimeout(authTimer);
      const peerRole = role === "host" ? "guest" : "host";
      const peer = room.sockets[peerRole];
      const peerConnected = peer?.readyState === WebSocket.OPEN;
      socket.send(JSON.stringify({ type: "authenticated", role, peerConnected }));
      if (peerConnected) {
        peer.send(JSON.stringify({ type: "peer-joined", role }));
      }
      return;
    }

    if (message.type === "signal" && ["offer", "answer", "ice"].includes(message.kind)) {
      const peerRole = role === "host" ? "guest" : "host";
      const peer = room.sockets[peerRole];
      if (peer?.readyState === WebSocket.OPEN) {
        peer.send(JSON.stringify({
          type: "signal",
          kind: message.kind,
          payload: message.payload,
        }));
      } else {
        socket.send(JSON.stringify({
          type: "error",
          code: "peer_unavailable",
          message: "O outro jogador não está conectado",
        }));
      }
    }
  });

  socket.on("close", () => {
    clearTimeout(authTimer);
    if (!role || room.sockets[role] !== socket) return;
    room.sockets[role] = null;
    const peerRole = role === "host" ? "guest" : "host";
    const peer = room.sockets[peerRole];
    if (peer?.readyState === WebSocket.OPEN) {
      peer.send(JSON.stringify({ type: "peer-left", role }));
    }
  });
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`ROM Nostalg E2E fixture listening on http://${HOST}:${PORT}\n`);
});

function shutdown() {
  for (const socket of websocketServer.clients) socket.terminate();
  websocketServer.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
