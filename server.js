import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const PORT = process.env.PORT || 3000;
const app = express();

// Salud / keep-alive
app.get("/", (req, res) => res.status(200).send("OK"));

// HTTP server + WS server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Map de salas -> Set de sockets
const rooms = new Map();

// (OPCIONAL) Restringe orígenes para WS (sustituye con tu dominio de producción)
const ALLOWED_ORIGINS = new Set([
  "https://hombresgradio.com",      // ← cámbialo por el tuyo
  "https://www.hombresgradio.com"
]);

function joinRoom(ws, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  ws._room = room;
}

function leaveRoom(ws) {
  const room = ws._room;
  if (!room) return;
  const set = rooms.get(room);
  if (set) {
    set.delete(ws);
    if (set.size === 0) rooms.delete(room);
  }
  ws._room = null;
}

function broadcastToRoom(room, data, except = null) {
  const set = rooms.get(room);
  if (!set) return;
  for (const client of set) {
    if (client !== except && client.readyState === 1) {
      client.send(data);
    }
  }
}

// Rate limit muy simple por socket (anti-spam)
const MAX_MSGS_PER_5S = 30;

wss.on("connection", (ws, req) => {
  // (OPCIONAL) Validar Origin para endurecer
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.size && origin && !ALLOWED_ORIGINS.has(origin)) {
    try { ws.close(); } catch {}
    return;
  }

  ws._room = null;
  ws._count = 0;
  ws._window = Date.now();
  ws.isAlive = true;

  ws.on("message", (buf) => {
    // rate limit sencillo
    const now = Date.now();
    if (now - ws._window > 5000) { ws._window = now; ws._count = 0; }
    ws._count++;
    if (ws._count > MAX_MSGS_PER_5S) return;

    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.t === "join" && typeof msg.room === "string") {
      leaveRoom(ws);
      joinRoom(ws, msg.room);
      return;
    }

    if (msg.t === "heart" && ws._room) {
      const payload = JSON.stringify({
        t: "heart",
        room: ws._room,
        x: Number(msg.x),
        y: Number(msg.y),
        h: Number(msg.h)
      });
      broadcastToRoom(ws._room, payload, null);
    }
  });

  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("close", () => leaveRoom(ws));
});

// Heartbeat para mantener vivos los sockets
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);

server.listen(PORT, () => {
  console.log("WS listening on", PORT);
});

