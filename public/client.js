import { createBoard, COLORS, COLOR_HEX } from './board.js';
import { sound } from './sounds.js';
import { setupVoice, setVoiceSeat, voiceState, joinVoice, leaveVoice, toggleMic, handleRtc } from './voice.js';

const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'ludo-session';

const AVATARS = [
  '🙂', '😎', '🤠', '🧐', '🥳', '😈', '👻', '🐱',
  '🐶', '🦊', '🐼', '🐸', '🦁', '🐵', '🦄', '🐙',
  '👽', '🤡', '🧙', '🥷', '🧛', '🦸', '👑', '💎',
];
const DICE_STYLES = ['classic', 'neon', 'royal'];

let ws = null;
let wsReady = false;
let reconnectDelay = 500;

let lobby = null;     // last lobby message
let game = null;      // last *settled* game state (post-animation)
let disp = null;      // token positions currently shown (animates toward `game`)
let mySeat = null;
let secret = null;
let roomCode = null;
let board = null;     // board renderer, built per game from state.layout
let timerRAF = null;
let lastDice = null;  // {seat, value}
let lastDeadline = null;
let prevTurn = null;
let chatLog = [];

let myAvatar = localStorage.getItem('ludo-avatar') || AVATARS[0];
let diceStyle = localStorage.getItem('ludo-dice') || 'classic';

// ---------- WebSocket ----------

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    wsReady = true;
    reconnectDelay = 500;
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (saved) send({ t: 'rejoin', code: saved.code, secret: saved.secret });
  };
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose = () => {
    wsReady = false;
    setStatus('Reconnecting…');
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  };
}

function send(msg) {
  if (wsReady) ws.send(JSON.stringify(msg));
}

function handleMessage(msg) {
  switch (msg.t) {
    case 'joined':
      mySeat = msg.seat;
      secret = msg.secret;
      roomCode = msg.code;
      setVoiceSeat(mySeat);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ code: msg.code, secret: msg.secret }));
      setStatus('');
      break;
    case 'lobby':
      lobby = msg;
      mySeat = msg.you;
      setVoiceSeat(mySeat);
      renderLobbyOrGame();
      break;
    case 'game':
      enqueueGame(msg);
      break;
    case 'chat':
      chatLog.push(msg);
      renderChat();
      if (msg.seat !== mySeat) sound.chat();
      break;
    case 'chat-history':
      chatLog = msg.items;
      renderChat();
      break;
    case 'rtc':
      handleRtc(msg.from, msg.data);
      break;
    case 'error':
      if (/Room not found|No seat to rejoin/.test(msg.msg)) {
        localStorage.removeItem(SESSION_KEY);
        showScreen('home');
      }
      toast(msg.msg);
      break;
  }
}

// ---------- animation pipeline ----------
// Game messages queue up and play one at a time: dice rattle, then tokens
// walk cell by cell, then captures fly home. A backlog fast-forwards.

const gameQueue = [];
let playing = false;

function enqueueGame(msg) {
  gameQueue.push(msg);
  if (!playing) playQueue();
}

async function playQueue() {
  playing = true;
  while (gameQueue.length) {
    const fast = gameQueue.length > 2;
    const msg = gameQueue.shift();
    if (!board) board = createBoard($('board'), msg.state.layout);
    if (!disp) disp = structuredClone(msg.state.tokens);
    showScreen('game');
    try {
      await playEvents(msg, fast);
    } catch (err) {
      console.error(err);
    }
    game = msg.state;
    disp = structuredClone(game.tokens);
    lastDeadline = msg.deadline;
    renderGame(msg.deadline);
    if (game.phase !== 'ENDED' && game.turn === mySeat && prevTurn !== mySeat) sound.turn();
    prevTurn = game.phase === 'ENDED' ? null : game.turn;
  }
  playing = false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function playEvents(msg, fast) {
  for (const ev of msg.events || []) {
    announce(ev);
    if (fast) continue;
    switch (ev.type) {
      case 'dice':
        await animateDice(ev);
        break;
      case 'move':
        await animateMove(ev);
        break;
      case 'capture':
        await animateCapture(ev);
        break;
      case 'finish':
        sound.finish();
        popToken(ev.seat, ev.token);
        await sleep(350);
        break;
      default:
        break;
    }
  }
}

function drawDisp() {
  board.drawTokens(disp, [], mySeat, () => {});
}

async function animateDice(ev) {
  lastDice = { seat: ev.seat, value: ev.value };
  const die = $('die');
  die.classList.add('rolling');
  die.style.setProperty('--die-c', COLOR_HEX[COLORS[ev.seat]]);
  sound.dice();
  const spin = setInterval(() => diceFace(die, 1 + Math.floor(Math.random() * 6)), 75);
  await sleep(520);
  clearInterval(spin);
  die.classList.remove('rolling');
  diceFace(die, ev.value);
  await sleep(220);
}

async function animateMove(ev) {
  const { seat, token, from, to } = ev;
  if (from === -1) {
    disp[seat][token] = 0;
    drawDisp();
    sound.enter();
    await sleep(340);
    return;
  }
  for (let p = from + 1; p <= to; p++) {
    disp[seat][token] = p;
    drawDisp();
    sound.step();
    await sleep(135);
  }
  await sleep(120);
}

async function animateCapture(ev) {
  const el = document.getElementById(`tok-${ev.seat}-${ev.token}`);
  el?.classList.add('fly');
  disp[ev.seat][ev.token] = -1;
  drawDisp();
  sound.capture();
  await sleep(560);
  el?.classList.remove('fly');
}

function popToken(seat, token) {
  const el = document.getElementById(`tok-${seat}-${token}`);
  if (!el) return;
  el.classList.add('pop');
  setTimeout(() => el.classList.remove('pop'), 500);
}

function announce(ev) {
  const name = (seat) => {
    const p = lobby?.players.find((p) => p.seat === seat);
    return p ? p.name : COLORS[seat];
  };
  switch (ev.type) {
    case 'capture':
      toast(`${name(ev.by)} captured ${name(ev.seat)}'s token!`);
      break;
    case 'forfeit':
      toast(`${name(ev.seat)} rolled three sixes — turn forfeited`);
      break;
    case 'rank':
      toast(`${name(ev.seat)} finished #${ev.place}! 🎉`);
      break;
  }
}

// ---------- screens ----------

function showScreen(id) {
  const target = $(`screen-${id}`);
  if (!target.classList.contains('hidden')) return;
  for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
  target.classList.remove('hidden');
}

function setStatus(text) {
  $('conn-status').textContent = text;
  $('conn-status').classList.toggle('hidden', !text);
}

function toast(text) {
  const box = $('toasts');
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = text;
  box.appendChild(div);
  setTimeout(() => div.classList.add('gone'), 3200);
  setTimeout(() => div.remove(), 3800);
}

function renderLobbyOrGame() {
  if (!lobby) return;
  if (lobby.status === 'LOBBY') {
    game = null;
    disp = null;
    prevTurn = null;
    gameQueue.length = 0;
    board = null;
    renderLobby();
    showScreen('lobby');
  } else {
    renderPlayers();
    renderVoice();
    if (game) renderGame(lastDeadline);
    showScreen('game');
  }
}

// ---------- lobby ----------

function playerRow(p, extras = '') {
  return `
    <span class="avatar">${p.avatar || '🙂'}</span>
    <span class="dot" style="background:${COLOR_HEX[p.color || COLORS[p.seat]]}"></span>
    <span class="pname">${escapeHtml(p.name)}${p.seat === mySeat ? ' <i>(you)</i>' : ''}</span>
    <span class="ptags">${p.isHost ? '👑' : ''}${p.isBot ? '🤖' : ''}${!p.connected && !p.isBot ? ' ⚠️' : ''}</span>
    ${extras}`;
}

function renderLobby() {
  $('lobby-code').textContent = lobby.code;
  const list = $('lobby-players');
  list.innerHTML = '';
  for (const p of lobby.players) {
    const li = document.createElement('li');
    li.innerHTML = playerRow(p, lobby.isHost && p.isBot ? `<button class="mini" data-remove="${p.seat}">✕</button>` : '');
    list.appendChild(li);
  }
  list.querySelectorAll('[data-remove]').forEach((b) =>
    b.addEventListener('click', () => send({ t: 'removeBot', seat: Number(b.dataset.remove) })));

  $('btn-add-bot').classList.toggle('hidden', !lobby.isHost || lobby.players.length >= 8);
  $('btn-start').classList.toggle('hidden', !lobby.isHost);
  $('btn-start').disabled = lobby.players.length < 2;
  $('lobby-hint').textContent = lobby.isHost
    ? (lobby.players.length < 2 ? 'Add a bot or share the code so friends can join.' : 'Ready when you are!')
    : 'Waiting for the host to start…';
  renderVoice();
  renderChat();
}

// ---------- game ----------

function movableTokens() {
  if (!game || game.phase !== 'MOVE' || game.turn !== mySeat) return [];
  const homePos = game.layout.homePos;
  const out = [];
  game.tokens[mySeat].forEach((pos, i) => {
    if (pos === homePos) return;
    if (pos === -1) {
      if (game.dice === 6) out.push(i);
    } else if (pos + game.dice <= homePos) {
      out.push(i);
    }
  });
  return out;
}

function renderGame(deadline) {
  if (!game) return;
  if (!board) board = createBoard($('board'), game.layout);
  $('game-code').textContent = roomCode || lobby?.code || '';
  board.drawTokens(game.tokens, movableTokens(), mySeat, (idx) => {
    sound.click();
    send({ t: 'move', token: idx });
  });
  renderPlayers();
  renderDice();
  renderTimer(deadline);
  renderOverlay();
}

function renderPlayers() {
  if (!lobby) return;
  const list = $('game-players');
  list.innerHTML = '';
  for (const p of lobby.players) {
    const homeCount = game?.tokens[p.seat]
      ? game.tokens[p.seat].filter((t) => t === game.layout.homePos).length
      : 0;
    const isTurn = game && game.phase !== 'ENDED' && game.turn === p.seat;
    const li = document.createElement('li');
    li.className = isTurn ? 'turn' : '';
    li.style.setProperty('--pc', COLOR_HEX[p.color]);
    li.innerHTML = playerRow(p, `<span class="home-count">${'●'.repeat(homeCount)}${'○'.repeat(4 - homeCount)}</span>`);
    list.appendChild(li);
  }
}

const PIP_LAYOUT = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function diceFace(el, value) {
  el.innerHTML = '';
  const pips = PIP_LAYOUT[value] || [];
  for (let i = 0; i < 9; i++) {
    const s = document.createElement('span');
    s.className = pips.includes(i) ? 'pip' : 'pip empty';
    el.appendChild(s);
  }
}

function renderDice() {
  const die = $('die');
  const btn = $('btn-roll');
  const myTurn = game.phase === 'ROLL' && game.turn === mySeat;
  const value = game.dice ?? lastDice?.value ?? 6;

  die.className = `die style-${diceStyle}${myTurn ? ' rollable' : ''}`;
  die.style.setProperty('--die-c', lastDice ? COLOR_HEX[COLORS[lastDice.seat]] : '#8884');
  diceFace(die, value);
  btn.classList.toggle('hidden', !myTurn);

  const hint = $('turn-hint');
  if (game.phase === 'ENDED') {
    hint.textContent = 'Game over';
  } else if (myTurn) {
    hint.textContent = 'Your turn — roll the dice!';
  } else if (game.turn === mySeat) {
    hint.textContent = 'Pick a glowing token to move';
  } else {
    const p = lobby?.players.find((p) => p.seat === game.turn);
    hint.textContent = `${p ? p.name : COLORS[game.turn]}'s turn…`;
  }
}

function renderTimer(deadline) {
  cancelAnimationFrame(timerRAF);
  const bar = $('timer-bar');
  if (!deadline || game.phase === 'ENDED') {
    bar.style.width = '0%';
    return;
  }
  const total = 30_000;
  const tick = () => {
    const left = Math.max(0, deadline - Date.now());
    bar.style.width = `${(left / total) * 100}%`;
    if (left > 0) timerRAF = requestAnimationFrame(tick);
  };
  tick();
}

function renderOverlay() {
  const over = game.phase === 'ENDED';
  const wasHidden = $('overlay').classList.contains('hidden');
  $('overlay').classList.toggle('hidden', !over);
  if (!over) return;
  if (wasHidden) (game.rankings[0] === mySeat ? sound.win : sound.lose)();
  const list = $('rankings');
  list.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  game.rankings.forEach((seat, i) => {
    const medal = medals[i] || `${i + 1}th`;
    const p = lobby?.players.find((p) => p.seat === seat);
    const li = document.createElement('li');
    li.innerHTML = `<span class="medal">${medal}</span>
      <span class="avatar">${p?.avatar || '🙂'}</span>
      <span class="dot" style="background:${COLOR_HEX[COLORS[seat]]}"></span>
      <span class="pname">${escapeHtml(p ? p.name : COLORS[seat])}${seat === mySeat ? ' <i>(you)</i>' : ''}</span>`;
    list.appendChild(li);
  });
  $('btn-again').classList.toggle('hidden', !lobby?.isHost);
}

// ---------- chat ----------

function renderChat() {
  for (const box of document.querySelectorAll('[data-chat]')) {
    box.innerHTML = chatLog.map((m) => `
      <div class="chat-msg${m.seat === mySeat ? ' mine' : ''}">
        <span class="avatar">${m.avatar || '🙂'}</span>
        <div>
          <b style="color:${COLOR_HEX[COLORS[m.seat]]}">${escapeHtml(m.name)}</b>
          <span>${escapeHtml(m.text)}</span>
        </div>
      </div>`).join('');
    box.scrollTop = box.scrollHeight;
  }
}

function wireChat() {
  for (const form of document.querySelectorAll('.chat-form')) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const text = input.value.trim();
      if (text) send({ t: 'chat', text });
      input.value = '';
    });
  }
}

// ---------- voice ----------

function renderVoice() {
  const v = voiceState();
  for (const bar of document.querySelectorAll('[data-voice]')) {
    if (!v.supported) {
      bar.innerHTML = '';
      continue;
    }
    if (!v.joined) {
      bar.innerHTML = `<button class="v-join">🎙 Join voice</button>`;
    } else {
      const who = v.peers.length
        ? v.peers.map((s) => lobby?.players.find((p) => p.seat === s)?.name || COLORS[s]).join(', ')
        : 'waiting for others';
      bar.innerHTML = `
        <button class="v-mic ${v.micOn ? '' : 'off'}" title="Toggle microphone">${v.micOn ? '🎙' : '🔇'}</button>
        <span class="v-who">🔊 ${escapeHtml(who)}</span>
        <button class="v-leave" title="Leave voice">✕</button>`;
    }
  }
  document.querySelectorAll('.v-join').forEach((b) => b.addEventListener('click', async () => {
    try {
      await joinVoice();
      toast('Voice chat joined');
    } catch {
      toast('Microphone unavailable or permission denied');
    }
  }));
  document.querySelectorAll('.v-mic').forEach((b) => b.addEventListener('click', () => toggleMic()));
  document.querySelectorAll('.v-leave').forEach((b) => b.addEventListener('click', () => leaveVoice()));
}

// ---------- customization ----------

function renderAvatarPicker() {
  const grid = $('avatar-pick');
  grid.innerHTML = '';
  for (const a of AVATARS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `avatar-btn${a === myAvatar ? ' sel' : ''}`;
    b.textContent = a;
    b.addEventListener('click', () => {
      myAvatar = a;
      localStorage.setItem('ludo-avatar', a);
      sound.click();
      renderAvatarPicker();
    });
    grid.appendChild(b);
  }
}

function renderDicePicker() {
  const row = $('dice-style');
  row.innerHTML = '';
  for (const s of DICE_STYLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip die-chip style-${s}${s === diceStyle ? ' sel' : ''}`;
    b.innerHTML = `<span class="die mini-die style-${s}" data-face></span> ${s}`;
    diceFace(b.querySelector('[data-face]'), 5);
    b.addEventListener('click', () => {
      diceStyle = s;
      localStorage.setItem('ludo-dice', s);
      sound.click();
      renderDicePicker();
      if (game) renderDice();
    });
    row.appendChild(b);
  }
}

// ---------- wiring ----------

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function playerName() {
  const name = $('name').value.trim();
  if (!name) {
    toast('Enter your name first');
    $('name').focus();
    return null;
  }
  localStorage.setItem('ludo-name', name);
  return name;
}

$('name').value = localStorage.getItem('ludo-name') || '';

$('btn-create').addEventListener('click', () => {
  const name = playerName();
  if (name) send({ t: 'create', name, avatar: myAvatar });
});

$('btn-join').addEventListener('click', () => {
  const name = playerName();
  const code = $('join-code').value.trim().toUpperCase();
  if (!code) return toast('Enter a room code');
  if (name) send({ t: 'join', code, name, avatar: myAvatar });
});

$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('btn-add-bot').addEventListener('click', () => send({ t: 'addBot' }));
$('btn-start').addEventListener('click', () => send({ t: 'start' }));
$('btn-roll').addEventListener('click', () => send({ t: 'roll' }));
$('die').addEventListener('click', () => {
  if (game && game.phase === 'ROLL' && game.turn === mySeat && !playing) send({ t: 'roll' });
});
$('btn-again').addEventListener('click', () => send({ t: 'again' }));
$('btn-copy').addEventListener('click', () => {
  navigator.clipboard?.writeText(roomCode || lobby?.code || '');
  toast('Code copied');
});
for (const id of ['btn-leave', 'btn-exit']) {
  $(id).addEventListener('click', () => {
    leaveVoice();
    localStorage.removeItem(SESSION_KEY);
    location.reload();
  });
}

const soundBtn = $('btn-sound');
function paintSoundBtn() { soundBtn.textContent = sound.muted ? '🔇' : '🔊'; }
soundBtn.addEventListener('click', () => { sound.toggleMute(); paintSoundBtn(); });
paintSoundBtn();

setupVoice(send, renderVoice);
wireChat();
renderAvatarPicker();
renderDicePicker();
connect();
