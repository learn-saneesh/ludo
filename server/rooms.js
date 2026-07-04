import crypto from 'node:crypto';
import { LudoGame, COLORS, MAX_PLAYERS } from './game.js';
import { pickBotMove, BOT_NAMES } from './bot.js';

const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS) || 30_000;
const BOT_ROLL_DELAY_MS = Number(process.env.BOT_DELAY_MS) || 1200;
const BOT_MOVE_DELAY_MS = Number(process.env.BOT_DELAY_MS) || 900;
const EMPTY_ROOM_TTL_MS = 5 * 60_000;

const rooms = new Map(); // code -> Room

function makeCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  let code;
  do {
    code = Array.from({ length: 6 }, () => abc[crypto.randomInt(abc.length)]).join('');
  } while (rooms.has(code));
  return code;
}

export const AVATARS = [
  '🙂', '😎', '🤠', '🧐', '🥳', '😈', '👻', '🐱',
  '🐶', '🦊', '🐼', '🐸', '🦁', '🐵', '🦄', '🐙',
  '👽', '🤡', '🧙', '🥷', '🧛', '🦸', '👑', '💎',
];

function cleanAvatar(avatar) {
  return AVATARS.includes(avatar) ? avatar : '🙂';
}

export function createRoom(ws, name, avatar) {
  const room = new Room(makeCode());
  rooms.set(room.code, room);
  room.addHuman(ws, name, true, avatar);
  return room;
}

export function joinRoom(ws, code, name, avatar) {
  const room = rooms.get(String(code || '').toUpperCase().trim());
  if (!room) throw new Error('Room not found');
  if (room.status !== 'LOBBY') throw new Error('Game already started');
  if (room.players.filter((p) => !p.isBot).length >= MAX_PLAYERS) throw new Error('Room is full');
  room.addHuman(ws, name, false, avatar);
  return room;
}

export function rejoinRoom(ws, code, secret) {
  const room = rooms.get(String(code || '').toUpperCase().trim());
  if (!room) throw new Error('Room not found');
  const player = room.players.find((p) => p.secret === secret && !p.isBot);
  if (!player) throw new Error('No seat to rejoin');
  room.reattach(player, ws);
  return room;
}

class Room {
  constructor(code) {
    this.code = code;
    this.status = 'LOBBY'; // LOBBY | PLAYING | ENDED
    this.players = []; // {name, seat, isBot, isHost, secret, ws, connected}
    this.game = null;
    this.turnTimer = null;
    this.turnDeadline = null;
    this.emptyTimer = null;
    this.chat = []; // last N {seat, name, text, ts}
  }

  // ---- lobby ----

  freeSeat() {
    for (let s = 0; s < MAX_PLAYERS; s++) if (!this.players.some((p) => p.seat === s)) return s;
    throw new Error('Room is full');
  }

  addHuman(ws, name, isHost, avatar) {
    // If the room is bot-padded to the max, evict a bot to make space for a human.
    if (this.players.length >= MAX_PLAYERS) {
      const bot = this.players.find((p) => p.isBot);
      if (!bot) throw new Error('Room is full');
      this.players.splice(this.players.indexOf(bot), 1);
    }
    const player = {
      name: String(name || 'Player').slice(0, 16) || 'Player',
      avatar: cleanAvatar(avatar),
      seat: this.freeSeat(),
      isBot: false,
      isHost,
      secret: crypto.randomBytes(16).toString('hex'),
      ws,
      connected: true,
    };
    this.players.push(player);
    ws.player = player;
    ws.room = this;
    clearTimeout(this.emptyTimer);
    this.broadcastLobby();
    this.sendChatHistory(player);
    return player;
  }

  addBot() {
    if (this.status !== 'LOBBY') throw new Error('Game already started');
    if (this.players.length >= MAX_PLAYERS) throw new Error('Room is full');
    const used = this.players.map((p) => p.name);
    const name = BOT_NAMES.find((n) => !used.includes(n)) || 'Bot';
    this.players.push({ name, avatar: '🤖', seat: this.freeSeat(), isBot: true, isHost: false, secret: null, ws: null, connected: true });
    this.broadcastLobby();
  }

  removeBot(seat) {
    if (this.status !== 'LOBBY') throw new Error('Game already started');
    const i = this.players.findIndex((p) => p.isBot && p.seat === seat);
    if (i >= 0) {
      this.players.splice(i, 1);
      this.broadcastLobby();
    }
  }

  reattach(player, ws) {
    if (player.ws && player.ws !== ws && player.ws.readyState <= 1) {
      try { player.ws.close(4000, 'Replaced by reconnect'); } catch {}
    }
    player.ws = ws;
    player.connected = true;
    ws.player = player;
    ws.room = this;
    clearTimeout(this.emptyTimer);
    this.broadcastLobby();
    this.sendChatHistory(player);
    if (this.game) this.sendGame(player);
  }

  disconnect(player) {
    player.connected = false;
    player.ws = null;
    this.broadcastLobby();
    if (this.status === 'LOBBY') {
      // Drop from the lobby entirely; keep seat only in running games.
      this.players.splice(this.players.indexOf(player), 1);
      if (player.isHost && this.players.some((p) => !p.isBot)) {
        this.players.find((p) => !p.isBot).isHost = true;
      }
      this.broadcastLobby();
    } else if (this.game && this.game.turn === player.seat && this.game.phase !== 'ENDED') {
      // Don't make everyone wait 30s for a player who just left.
      this.scheduleAutoplay(BOT_ROLL_DELAY_MS);
    }
    if (!this.players.some((p) => !p.isBot && p.connected)) {
      clearTimeout(this.emptyTimer);
      this.emptyTimer = setTimeout(() => this.destroy(), EMPTY_ROOM_TTL_MS);
    }
  }

  destroy() {
    clearTimeout(this.turnTimer);
    clearTimeout(this.emptyTimer);
    rooms.delete(this.code);
  }

  // ---- game flow ----

  start(byPlayer) {
    if (!byPlayer.isHost) throw new Error('Only the host can start');
    if (this.status !== 'LOBBY') throw new Error('Already started');
    if (this.players.length < 2) throw new Error('Need at least 2 players');
    this.status = 'PLAYING';
    this.game = new LudoGame(this.players.map((p) => p.seat));
    this.broadcastLobby();
    this.broadcastGame([{ type: 'turn', seat: this.game.turn }]);
    this.armTurn();
  }

  playAgain(byPlayer) {
    if (!byPlayer.isHost) throw new Error('Only the host can restart');
    if (this.status !== 'ENDED') throw new Error('Game is not over');
    this.status = 'LOBBY';
    this.game = null;
    // Drop players who never came back.
    this.players = this.players.filter((p) => p.isBot || p.connected);
    this.broadcastLobby();
  }

  roll(player, forced) {
    if (!this.game) throw new Error('Game not started');
    const res = this.game.roll(player.seat, forced);
    this.afterAction(res.events);
    return res;
  }

  move(player, tokenIdx) {
    if (!this.game) throw new Error('Game not started');
    const res = this.game.move(player.seat, Number(tokenIdx));
    this.afterAction(res.events);
    return res;
  }

  afterAction(events) {
    if (this.game.phase === 'ENDED') {
      this.status = 'ENDED';
      clearTimeout(this.turnTimer);
      this.turnDeadline = null;
      this.broadcastGame(events);
      this.broadcastLobby();
      return;
    }
    this.armTurn();
    this.broadcastGame(events);
  }

  /** (Re)arm the clock for the current turn: bots/disconnected act on a short
      delay, humans get a 30s shot clock, both funnel into autoplay(). */
  armTurn() {
    clearTimeout(this.turnTimer);
    const current = this.players.find((p) => p.seat === this.game.turn);
    const auto = !current || current.isBot || !current.connected;
    const delay = auto
      ? (this.game.phase === 'ROLL' ? BOT_ROLL_DELAY_MS : BOT_MOVE_DELAY_MS)
      : TURN_TIMEOUT_MS;
    this.turnDeadline = auto ? null : Date.now() + delay;
    this.turnTimer = setTimeout(() => this.autoplay(), delay);
  }

  scheduleAutoplay(delay) {
    clearTimeout(this.turnTimer);
    this.turnDeadline = null;
    this.turnTimer = setTimeout(() => this.autoplay(), delay);
  }

  autoplay() {
    if (!this.game || this.game.phase === 'ENDED') return;
    const seat = this.game.turn;
    try {
      if (this.game.phase === 'ROLL') {
        const res = this.game.roll(seat);
        this.afterAction(res.events);
      } else {
        const movable = this.game.movableTokens(seat, this.game.dice);
        const res = this.game.move(seat, pickBotMove(this.game, seat, movable));
        this.afterAction(res.events);
      }
    } catch (err) {
      console.error(`[room ${this.code}] autoplay error:`, err);
    }
  }

  // ---- chat & voice ----

  sendChat(player, text) {
    text = String(text || '').trim().slice(0, 200);
    if (!text) return;
    const item = { seat: player.seat, name: player.name, avatar: player.avatar, text, ts: Date.now() };
    this.chat.push(item);
    if (this.chat.length > 50) this.chat.shift();
    const payload = JSON.stringify({ t: 'chat', ...item });
    for (const p of this.players) {
      if (p.ws && p.ws.readyState === 1) p.ws.send(payload);
    }
  }

  sendChatHistory(player) {
    if (this.chat.length && player.ws && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify({ t: 'chat-history', items: this.chat }));
    }
  }

  /** Relay a WebRTC signaling blob to one seat (or all other humans). */
  relayRtc(from, to, data) {
    const payload = JSON.stringify({ t: 'rtc', from: from.seat, data });
    for (const p of this.players) {
      if (p === from || p.isBot || !p.connected || !p.ws || p.ws.readyState !== 1) continue;
      if (to == null || p.seat === Number(to)) p.ws.send(payload);
    }
  }

  // ---- messaging ----

  lobbyFor(player) {
    return {
      t: 'lobby',
      code: this.code,
      status: this.status,
      you: player.seat,
      isHost: player.isHost,
      players: this.players
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((p) => ({
          name: p.name,
          avatar: p.avatar,
          seat: p.seat,
          color: COLORS[p.seat],
          isBot: p.isBot,
          isHost: p.isHost,
          connected: p.connected,
        })),
    };
  }

  broadcastLobby() {
    for (const p of this.players) {
      if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(this.lobbyFor(p)));
    }
  }

  gameMsg(events) {
    return {
      t: 'game',
      state: this.game.state,
      events: events || [],
      deadline: this.turnDeadline,
    };
  }

  sendGame(player, events) {
    if (player.ws && player.ws.readyState === 1) {
      player.ws.send(JSON.stringify(this.gameMsg(events)));
    }
  }

  broadcastGame(events) {
    for (const p of this.players) this.sendGame(p, events);
  }
}
