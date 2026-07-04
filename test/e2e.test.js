// End-to-end test: spawns the real server, connects two WebSocket clients,
// adds two bots, and plays a full game to completion. Also exercises
// reconnect-by-secret mid-game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = 3105;
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'index.js');

function startServer() {
  const proc = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT, BOT_DELAY_MS: '5', TURN_TIMEOUT_MS: '200' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolve, reject) => {
    proc.stdout.on('data', (d) => {
      if (String(d).includes('running')) resolve(proc);
    });
    proc.on('exit', (code) => reject(new Error(`server exited early (${code})`)));
  });
}

// A minimal auto-playing client: rolls and moves whenever it's its turn.
class AutoClient {
  constructor(name) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.seat = null;
    this.secret = null;
    this.code = null;
    this.lastGame = null;
    this.autoplay = true;
  }

  connect() {
    this.ws = new WebSocket(`ws://localhost:${PORT}`);
    this.ws.addEventListener('message', (e) => this.onMessage(JSON.parse(e.data)));
    return new Promise((res, rej) => {
      this.ws.addEventListener('open', res);
      this.ws.addEventListener('error', rej);
    });
  }

  onMessage(msg) {
    this.msgs.push(msg);
    if (msg.t === 'joined') {
      this.seat = msg.seat;
      this.secret = msg.secret;
      this.code = msg.code;
    }
    if (msg.t === 'game') {
      this.lastGame = msg;
      const s = msg.state;
      if (this.autoplay && s.phase !== 'ENDED' && s.turn === this.seat) {
        if (s.phase === 'ROLL') {
          this.send({ t: 'roll' });
        } else {
          const home = s.layout.homePos;
          const movable = s.tokens[this.seat]
            .map((pos, i) => ({ pos, i }))
            .filter(({ pos }) => pos !== home && (pos === -1 ? s.dice === 6 : pos + s.dice <= home))
            .map(({ i }) => i);
          this.send({ t: 'move', token: movable[0] });
        }
      }
    }
    for (const w of [...this.waiters]) {
      if (w.pred(msg)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  waitFor(pred, timeout = 60_000, label = 'message') {
    const hit = this.msgs.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.name}: timed out waiting for ${label}`)), timeout);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }
}

test('full game over WebSocket: 2 humans + 2 bots, plus mid-game reconnect', async () => {
  const server = await startServer();
  try {
    const alice = new AutoClient('alice');
    const bob = new AutoClient('bob');
    await alice.connect();
    await bob.connect();

    alice.send({ t: 'create', name: 'Alice' });
    const joined = await alice.waitFor((m) => m.t === 'joined', 5000, 'joined');
    assert.match(joined.code, /^[A-Z2-9]{6}$/);

    bob.send({ t: 'join', code: joined.code, name: 'Bob' });
    await bob.waitFor((m) => m.t === 'joined', 5000, 'joined');

    alice.send({ t: 'addBot' });
    alice.send({ t: 'addBot' });
    const lobby = await alice.waitFor(
      (m) => m.t === 'lobby' && m.players.length === 4, 5000, '4-player lobby');
    assert.equal(lobby.players.filter((p) => p.isBot).length, 2);

    // Non-host cannot start.
    bob.send({ t: 'start' });
    await bob.waitFor((m) => m.t === 'error' && /host/.test(m.msg), 5000, 'host-only error');

    alice.send({ t: 'start' });
    await alice.waitFor((m) => m.t === 'game', 5000, 'first game state');

    // Let the game run a bit, then drop Bob and reconnect him by secret.
    await sleep(400);
    bob.autoplay = false;
    bob.ws.close();
    await sleep(300);
    const bob2 = new AutoClient('bob2');
    bob2.secret = bob.secret;
    await bob2.connect();
    bob2.send({ t: 'rejoin', code: joined.code, secret: bob.secret });
    const rejoined = await bob2.waitFor((m) => m.t === 'joined', 5000, 'rejoin ack');
    assert.equal(rejoined.seat, bob.seat, 'reconnect restores the same seat');
    bob2.seat = bob.seat;
    await bob2.waitFor((m) => m.t === 'game', 5000, 'state after rejoin');

    // Play to the end. Alice and Bob2 autoplay; bots are server-side.
    const over = await alice.waitFor(
      (m) => m.t === 'game' && m.state.phase === 'ENDED', 120_000, 'gameover');
    assert.equal(over.state.rankings.length, 4);
    assert.deepEqual(
      [...over.state.rankings].sort(),
      [0, 1, 2, 3],
      'every seat appears exactly once in rankings');

    // All finished players really have all tokens home except possibly the last.
    for (const seat of over.state.rankings.slice(0, -1)) {
      assert.ok(over.state.tokens[seat].every((p) => p === over.state.layout.homePos), `seat ${seat} all home`);
    }
  } finally {
    server.kill();
  }
});

test('6-player game on the ring board plays to completion', async () => {
  const server = await startServer();
  try {
    const host = new AutoClient('host');
    await host.connect();
    host.send({ t: 'create', name: 'Host' });
    await host.waitFor((m) => m.t === 'joined', 5000, 'joined');
    for (let i = 0; i < 5; i++) host.send({ t: 'addBot' });
    await host.waitFor((m) => m.t === 'lobby' && m.players.length === 6, 5000, '6-player lobby');
    host.send({ t: 'start' });
    const first = await host.waitFor((m) => m.t === 'game', 5000, 'first state');
    assert.equal(first.state.layout.ringLen, 78);
    assert.equal(first.state.layout.classic, false);

    const over = await host.waitFor(
      (m) => m.t === 'game' && m.state.phase === 'ENDED', 240_000, 'gameover');
    assert.equal(over.state.rankings.length, 6);
    assert.deepEqual([...over.state.rankings].sort(), [0, 1, 2, 3, 4, 5]);
  } finally {
    server.kill();
  }
});
