import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LudoGame } from '../server/game.js';

test('6-player game uses a 78-cell ring with starts 13 apart', () => {
  const g = new LudoGame([0, 1, 2, 3, 4, 5]);
  assert.equal(g.ringLen, 78);
  assert.equal(g.homePos, 82);
  assert.deepEqual(g.starts, { 0: 0, 1: 13, 2: 26, 3: 39, 4: 52, 5: 65 });
  assert.ok(g.safe.has(65) && g.safe.has(73), 'each arm has start + star safe cells');
  assert.equal(g.state.layout.classic, false);
});

test('captures work across distant arms on the big ring', () => {
  const g = new LudoGame([0, 1, 2, 3, 4, 5]);
  // Seat 5 rel 10 -> abs (65+10)%78 = 75; seat 0 rel 75 -> abs 75. Not safe.
  assert.ok(!g.safe.has(75));
  g.tokens[5][2] = 10;
  g.tokens[0][0] = 70;
  g.roll(0, 5);
  const { events } = g.move(0, 0);
  assert.equal(g.tokens[5][2], -1);
  assert.ok(events.some((e) => e.type === 'capture' && e.seat === 5));
  assert.equal(g.turn, 0, 'capture grants extra turn');
});

test('exact roll finishes at ringLen+4 on the big ring', () => {
  const g = new LudoGame([0, 1, 2, 3, 4, 5]);
  g.tokens[0] = [80, 82, 82, 82];
  let r = g.roll(0, 5); // 85 > 82: no moves
  assert.deepEqual(r.movable, []);
  assert.equal(g.turn, 1);
  g.roll(1, 3); // passes (no moves without a 6)
  g.roll(2, 3);
  g.roll(3, 3);
  g.roll(4, 3);
  g.roll(5, 3);
  r = g.roll(0, 2);
  assert.deepEqual(r.movable, [0]);
  g.move(0, 0);
  assert.deepEqual(g.rankings.slice(0, 1), [0]);
});

test('sparse seats above 3 fall back to an ordered ring', () => {
  const g = new LudoGame([0, 1, 4, 7]);
  assert.equal(g.state.layout.classic, false);
  assert.equal(g.ringLen, 52);
  assert.deepEqual(g.starts, { 0: 0, 1: 13, 4: 26, 7: 39 });
});

test('8-player game: turn order cycles through all seats', () => {
  const g = new LudoGame([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(g.ringLen, 104);
  for (let s = 0; s < 8; s++) {
    assert.equal(g.turn, s);
    g.roll(s, 3); // nobody can move without a 6: turn passes
  }
  assert.equal(g.turn, 0);
});
