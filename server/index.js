import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createRoom, joinRoom, rejoinRoom } from './rooms.js';

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      handle(ws, msg);
    } catch (err) {
      ws.send(JSON.stringify({ t: 'error', msg: err.message }));
    }
  });

  ws.on('close', () => {
    if (ws.player && ws.player.ws === ws) ws.room.disconnect(ws.player);
  });
});

function handle(ws, msg) {
  switch (msg.t) {
    case 'create': {
      const room = createRoom(ws, msg.name, msg.avatar);
      ws.send(JSON.stringify({ t: 'joined', code: room.code, seat: ws.player.seat, secret: ws.player.secret }));
      room.broadcastLobby();
      break;
    }
    case 'join': {
      const room = joinRoom(ws, msg.code, msg.name, msg.avatar);
      ws.send(JSON.stringify({ t: 'joined', code: room.code, seat: ws.player.seat, secret: ws.player.secret }));
      room.broadcastLobby();
      break;
    }
    case 'rejoin': {
      const room = rejoinRoom(ws, msg.code, msg.secret);
      ws.send(JSON.stringify({ t: 'joined', code: room.code, seat: ws.player.seat, secret: ws.player.secret }));
      break;
    }
    case 'addBot':
      requireRoom(ws).addBot();
      break;
    case 'removeBot':
      requireRoom(ws).removeBot(Number(msg.seat));
      break;
    case 'start':
      requireRoom(ws).start(ws.player);
      break;
    case 'roll':
      requireRoom(ws).roll(ws.player);
      break;
    case 'move':
      requireRoom(ws).move(ws.player, msg.token);
      break;
    case 'again':
      requireRoom(ws).playAgain(ws.player);
      break;
    case 'chat':
      requireRoom(ws).sendChat(ws.player, msg.text);
      break;
    case 'rtc':
      requireRoom(ws).relayRtc(ws.player, msg.to, msg.data);
      break;
    default:
      throw new Error(`Unknown message type: ${msg.t}`);
  }
}

function requireRoom(ws) {
  if (!ws.room || !ws.player) throw new Error('Not in a room');
  return ws.room;
}

// Drop dead connections so seats free up for bots/timeouts.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15_000);

server.listen(PORT, () => {
  console.log(`Ludo server running at http://localhost:${PORT}`);
});
