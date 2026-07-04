import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LudoGame, absCell, SAFE_CELLS, HOME_POS } from '../server/game.js';

test('needs a 6 to leave base; turn passes otherwise', () => {
  const g = new LudoGame([0, 1]);
  const r = g.roll(0, 3);
  assert.deepEqual(r.movable, []);
  assert.equal(g.turn, 1);
  assert.equal(g.phase, 'ROLL');
});

test('a 6 lets a token enter at relative 0 and grants an extra turn', () => {
  const g = new LudoGame([0, 1]);
  const r = g.roll(0, 6);
  assert.deepEqual(r.movable, [0, 1, 2, 3]);
  g.move(0, 0);
  assert.equal(g.tokens[0][0], 0);
  assert.equal(g.turn, 0);
  assert.equal(g.phase, 'ROLL');
});

test('normal movement advances a token and passes the turn', () => {
  const g = new LudoGame([0, 1]);
  g.tokens[0][0] = 5;
  g.roll(0, 4);
  g.move(0, 0);
  assert.equal(g.tokens[0][0], 9);
  assert.equal(g.turn, 1);
});

test('landing on an opponent captures it and grants an extra turn', () => {
  const g = new LudoGame([0, 1]);
  // Seat 1 rel 30 -> abs (13+30)%52 = 43 (not safe). Seat 0 rel 43 -> abs 43.
  assert.ok(!SAFE_CELLS.has(43));
  g.tokens[1][2] = 30;
  g.tokens[0][0] = 40;
  const r = g.roll(0, 3);
  assert.deepEqual(r.movable, [0]);
  const { events } = g.move(0, 0);
  assert.equal(g.tokens[1][2], -1);
  assert.ok(events.some((e) => e.type === 'capture' && e.seat === 1 && e.token === 2));
  assert.equal(g.turn, 0, 'capture grants extra turn');
});

test('no capture on safe cells', () => {
  const g = new LudoGame([0, 1]);
  // Abs cell 21 is safe. Seat 1 rel 8 -> abs 21. Seat 0 rel 21 -> abs 21.
  g.tokens[1][0] = 8;
  g.tokens[0][0] = 18;
  g.roll(0, 3);
  g.move(0, 0);
  assert.equal(g.tokens[1][0], 8, 'opponent stays on safe cell');
  assert.equal(g.turn, 1, 'no extra turn');
});

test('exact roll required to finish; overshoot is not movable', () => {
  const g = new LudoGame([0, 1]);
  g.tokens[0] = [54, HOME_POS, HOME_POS, HOME_POS];
  let r = g.roll(0, 5); // 54+5=59 > 56: no moves, turn passes
  assert.deepEqual(r.movable, []);
  assert.equal(g.turn, 1);
  g.roll(1, 2);
  assert.equal(g.turn, 0);
  r = g.roll(0, 2); // 54+2=56: exact
  assert.deepEqual(r.movable, [0]);
  const { events } = g.move(0, 0);
  assert.ok(events.some((e) => e.type === 'gameover'));
  assert.equal(g.phase, 'ENDED');
  assert.deepEqual(g.rankings, [0, 1]);
});

test('three consecutive sixes forfeit the turn', () => {
  const g = new LudoGame([0, 1]);
  g.tokens[0][0] = 10; // has a token on track so 6s are playable
  g.roll(0, 6);
  g.move(0, 0);
  g.roll(0, 6);
  g.move(0, 0);
  const r = g.roll(0, 6);
  assert.ok(r.events.some((e) => e.type === 'forfeit'));
  assert.equal(g.turn, 1);
});

test('six chain resets when a non-six is rolled', () => {
  const g = new LudoGame([0, 1]);
  g.tokens[0][0] = 10;
  g.tokens[1][0] = 10;
  g.roll(0, 6);
  g.move(0, 0); // extra turn
  g.roll(0, 2);
  g.move(0, 0); // turn passes to 1
  g.roll(1, 6);
  g.move(1, 0);
  g.roll(1, 6);
  g.move(1, 0);
  const r = g.roll(1, 6); // third consecutive six for seat 1
  assert.ok(r.events.some((e) => e.type === 'forfeit'));
});

test('capture is computed on the shared track across different seats', () => {
  // Seat 2 rel 10 -> abs (26+10)%52 = 36. Seat 0 rel 36 -> abs 36. Not safe.
  assert.equal(absCell(2, 10), 36);
  assert.ok(!SAFE_CELLS.has(36));
  const g = new LudoGame([0, 2]);
  g.tokens[2][3] = 10;
  g.tokens[0][1] = 30;
  g.roll(0, 6);
  g.move(0, 1);
  assert.equal(g.tokens[2][3], -1);
});

test('tokens in the home column are out of capture range', () => {
  const g = new LudoGame([0, 1]);
  g.tokens[1][0] = 52; // in seat 1 home column
  g.tokens[0][0] = 10;
  g.roll(0, 3);
  g.move(0, 0);
  assert.equal(g.tokens[1][0], 52);
});

test('finished player is skipped in turn order (3 players, rankings complete)', () => {
  const g = new LudoGame([0, 1, 2]);
  g.tokens[0] = [55, HOME_POS, HOME_POS, HOME_POS];
  g.roll(0, 1);
  g.move(0, 0);
  assert.deepEqual(g.rankings, [0]);
  assert.equal(g.phase, 'ROLL');
  assert.equal(g.turn, 1);
  g.roll(1, 2); // no moves, passes
  assert.equal(g.turn, 2);
  g.roll(2, 3); // no moves, passes — must skip seat 0
  assert.equal(g.turn, 1);
  // Seat 1 finishes; game ends with seat 2 last.
  g.tokens[1] = [55, HOME_POS, HOME_POS, HOME_POS];
  g.roll(1, 1);
  const { events } = g.move(1, 0);
  assert.ok(events.some((e) => e.type === 'gameover'));
  assert.deepEqual(g.rankings, [0, 1, 2]);
});

test('rejects out-of-turn and wrong-phase actions', () => {
  const g = new LudoGame([0, 1]);
  assert.throws(() => g.roll(1, 4), /Not your turn/);
  assert.throws(() => g.move(0, 0), /Expected MOVE/);
  g.tokens[0][0] = 5;
  g.roll(0, 4);
  assert.throws(() => g.roll(0, 4), /Expected ROLL/);
  assert.throws(() => g.move(0, 1), /not movable/);
});
