// Ludo game engine — pure game logic, no I/O. Supports 2-8 players.
//
// Board model:
//   Each token has a position relative to its own start square:
//     -1                    in base (yard)
//     0 .. ringLen-2        on the shared ring track
//     ringLen-1 .. ringLen+3  in the seat's private 5-cell home column
//     ringLen+4 (homePos)   finished (reached center)
//
// 2-4 players (all seats < 4) use the classic 52-cell cross board with
// starts at seat*13. 5+ players (or sparse seats) use a ring of
// 13 cells per player, with starts spaced 13 apart in seat order.

export const COLORS = ['red', 'green', 'yellow', 'blue', 'purple', 'orange', 'teal', 'pink'];
export const MAX_PLAYERS = 8;
const SEG = 13; // ring cells contributed per player

// Classic-board helpers (kept for callers that only deal with 4-player games).
export const TRACK_LEN = 52;
export const HOME_POS = 56;
export const SAFE_CELLS = new Set([0, 13, 26, 39, 8, 21, 34, 47]);
export function absCell(seat, rel) {
  return (SEG * seat + rel) % TRACK_LEN;
}

export class LudoGame {
  /**
   * @param {number[]} seatIndices seats in play, e.g. [0,1,3] (indices into COLORS)
   */
  constructor(seatIndices) {
    if (!Array.isArray(seatIndices) || seatIndices.length < 2 || seatIndices.length > MAX_PLAYERS) {
      throw new Error(`LudoGame needs 2-${MAX_PLAYERS} seats`);
    }
    this.seats = [...seatIndices].sort((a, b) => a - b);
    if (new Set(this.seats).size !== this.seats.length || this.seats.some((s) => s < 0 || s >= MAX_PLAYERS)) {
      throw new Error('Invalid seats');
    }

    const classic = this.seats.length <= 4 && this.seats.every((s) => s < 4);
    this.classic = classic;
    this.ringLen = classic ? TRACK_LEN : SEG * this.seats.length;
    this.homePos = this.ringLen + 4;
    this.starts = {};
    this.seats.forEach((seat, order) => {
      this.starts[seat] = classic ? SEG * seat : SEG * order;
    });
    this.safe = new Set();
    if (classic) {
      for (let a = 0; a < 4; a++) this.safe.add(SEG * a).add(SEG * a + 8);
    } else {
      for (const s of Object.values(this.starts)) this.safe.add(s).add((s + 8) % this.ringLen);
    }

    this.tokens = {}; // seat -> [pos, pos, pos, pos]
    for (const s of this.seats) this.tokens[s] = [-1, -1, -1, -1];
    this.turn = this.seats[0];
    this.phase = 'ROLL'; // ROLL | MOVE | ENDED
    this.dice = null;
    this.sixChain = 0;
    this.rankings = []; // seats in finishing order
  }

  get state() {
    return {
      seats: this.seats,
      tokens: this.tokens,
      turn: this.turn,
      phase: this.phase,
      dice: this.dice,
      rankings: this.rankings,
      layout: {
        classic: this.classic,
        ringLen: this.ringLen,
        homePos: this.homePos,
        starts: this.starts,
        safe: [...this.safe],
      },
    };
  }

  absCell(seat, rel) {
    return (this.starts[seat] + rel) % this.ringLen;
  }

  hasFinished(seat) {
    return this.tokens[seat].every((p) => p === this.homePos);
  }

  movableTokens(seat, dice) {
    const out = [];
    this.tokens[seat].forEach((pos, i) => {
      if (pos === this.homePos) return;
      if (pos === -1) {
        if (dice === 6) out.push(i);
      } else if (pos + dice <= this.homePos) {
        out.push(i);
      }
    });
    return out;
  }

  /** Roll the dice for `seat`. `forced` is for tests/determinism. */
  roll(seat, forced) {
    this.#expect(seat, 'ROLL');
    const dice = forced ?? 1 + Math.floor(Math.random() * 6);
    this.dice = dice;
    this.sixChain = dice === 6 ? this.sixChain + 1 : 0;
    const events = [{ type: 'dice', seat, value: dice }];

    if (dice === 6 && this.sixChain >= 3) {
      // Three consecutive sixes: turn is forfeited, third six is not played.
      events.push({ type: 'forfeit', seat });
      this.#advanceTurn(events);
      return { dice, movable: [], events };
    }

    const movable = this.movableTokens(seat, dice);
    if (movable.length === 0) {
      this.#advanceTurn(events);
      return { dice, movable, events };
    }

    this.phase = 'MOVE';
    return { dice, movable, events };
  }

  /** Move token `tokenIdx` of `seat` by the rolled dice. */
  move(seat, tokenIdx) {
    this.#expect(seat, 'MOVE');
    const dice = this.dice;
    if (!this.movableTokens(seat, dice).includes(tokenIdx)) {
      throw new Error('Token is not movable');
    }

    const from = this.tokens[seat][tokenIdx];
    const to = from === -1 ? 0 : from + dice;
    this.tokens[seat][tokenIdx] = to;
    const events = [{ type: 'move', seat, token: tokenIdx, from, to }];

    let captured = false;
    if (to >= 0 && to <= this.ringLen - 2) {
      const cell = this.absCell(seat, to);
      if (!this.safe.has(cell)) {
        for (const other of this.seats) {
          if (other === seat) continue;
          this.tokens[other].forEach((pos, i) => {
            if (pos >= 0 && pos <= this.ringLen - 2 && this.absCell(other, pos) === cell) {
              this.tokens[other][i] = -1;
              captured = true;
              events.push({ type: 'capture', seat: other, token: i, by: seat });
            }
          });
        }
      }
    }

    let finished = false;
    if (to === this.homePos) {
      finished = true;
      events.push({ type: 'finish', seat, token: tokenIdx });
      if (this.hasFinished(seat)) {
        this.rankings.push(seat);
        events.push({ type: 'rank', seat, place: this.rankings.length });
        const left = this.seats.filter((s) => !this.hasFinished(s));
        if (left.length <= 1) {
          this.rankings.push(...left);
          this.phase = 'ENDED';
          events.push({ type: 'gameover', rankings: this.rankings });
          return { events };
        }
      }
    }

    const extraTurn = (dice === 6 || captured || finished) && !this.hasFinished(seat);
    if (extraTurn) {
      this.phase = 'ROLL';
      this.dice = null;
      events.push({ type: 'turn', seat: this.turn, extra: true });
    } else {
      this.#advanceTurn(events);
    }
    return { events };
  }

  #advanceTurn(events) {
    const order = this.seats;
    let i = order.indexOf(this.turn);
    for (let step = 0; step < order.length; step++) {
      i = (i + 1) % order.length;
      if (!this.hasFinished(order[i])) break;
    }
    this.turn = order[i];
    this.phase = 'ROLL';
    this.dice = null;
    this.sixChain = 0;
    events.push({ type: 'turn', seat: this.turn });
  }

  #expect(seat, phase) {
    if (this.phase === 'ENDED') throw new Error('Game is over');
    if (this.turn !== seat) throw new Error('Not your turn');
    if (this.phase !== phase) throw new Error(`Expected ${phase} phase`);
  }
}
