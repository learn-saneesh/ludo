# 🎲 Ludo Online

Multiplayer Ludo in the browser with an authoritative Node.js WebSocket
server. 2–8 players per room, bots, voice & text chat, animations, sounds.

## Run

```
npm install
npm start          # http://localhost:3000
```

Set a different port with the `PORT` env var (used automatically by most hosts).

## Play

1. Open the site, pick an avatar + dice style, enter your name, **Create Room**.
2. Share the 6-letter room code — friends open the same URL and **Join**.
3. The host can add 🤖 bots to fill seats (up to 8 total), then **Start Game**.
4. Optional: hit **🎙 Join voice** for voice chat, or use the text chat panel.

**Boards:** 2–4 players play on the classic 15×15 cross board; 5–8 players
play on a circular ring board (13 track cells per player, same rules).

## Rules (classic)

- Roll a **6** to bring a token out of your base; a 6 grants an extra turn,
  but three consecutive sixes forfeit the turn.
- Landing on an opponent's token sends it back to base and grants an extra
  turn — except on starred **safe squares**.
- A token needs an **exact roll** to reach the center. Getting a token home
  grants an extra turn.
- Game continues until the final rankings are decided.

## Niceties

- **Animations & sound** — dice rattle, tokens walk cell by cell, captures
  fly home; all effects are WebAudio-synthesized (no assets). Mute with 🔊.
- **Voice chat** — WebRTC mesh between players, signaled over the game
  WebSocket. Text chat works in the lobby and in-game.
- **Bots** — heuristic AI fills seats and takes over instantly for anyone
  who disconnects mid-game.
- **Reconnect** — refresh or drop and you're restored to your seat.
- **Shot clock** — 30 s per turn; idle players are auto-played.
- **Customization** — 24 avatars, 3 dice skins (classic / neon / royal).

 
## Layout

```
server/index.js   HTTP static server + WebSocket routing
server/rooms.js   rooms, seats, timers, bots, reconnect, chat, RTC relay
server/game.js    pure Ludo rules engine, 2-8 players (no I/O)
server/bot.js     bot move heuristics
public/           browser client (board.js: cross + ring renderers)
public/debug.html static board-rendering test page
test/             engine + multiplayer unit tests, full-game e2e (npm test)
```
