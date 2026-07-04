// Heuristic bot: picks a token for the rolled dice.
// Priority: finish > capture > escape danger > enter from base > land safe > furthest along.

export const BOT_NAMES = ['Robo', 'Chip', 'Dice-o-tron', 'Lucky', 'Turbo', 'Zippy', 'Gizmo', 'Bolt'];

export function pickBotMove(game, seat, movable) {
  const dice = game.dice;
  const trackEnd = game.ringLen - 2;
  let best = movable[0];
  let bestScore = -Infinity;

  for (const idx of movable) {
    const from = game.tokens[seat][idx];
    const to = from === -1 ? 0 : from + dice;
    let score = 0;

    if (to === game.homePos) score += 1000;

    if (to >= 0 && to <= trackEnd) {
      const cell = game.absCell(seat, to);
      if (!game.safe.has(cell)) {
        for (const other of game.seats) {
          if (other === seat) continue;
          for (const pos of game.tokens[other]) {
            if (pos >= 0 && pos <= trackEnd && game.absCell(other, pos) === cell) score += 500; // capture
          }
        }
        // Risk of being captured on the landing cell.
        if (threatened(game, seat, to)) score -= 60;
      } else {
        score += 40; // landing safe is good
      }
    }

    if (from === -1) score += 80; // spread out from base on a 6
    if (from >= 0 && from <= trackEnd && threatened(game, seat, from)) score += 70; // escape danger

    score += to; // prefer advancing the furthest token
    score += Math.random() * 5; // tie-break jitter so bots aren't robotic

    if (score > bestScore) {
      bestScore = score;
      best = idx;
    }
  }
  return best;
}

// Is a token of `seat` standing at relative track pos `rel` reachable by any
// opponent token within a single dice roll (1-6)?
function threatened(game, seat, rel) {
  const trackEnd = game.ringLen - 2;
  const cell = game.absCell(seat, rel);
  for (const other of game.seats) {
    if (other === seat) continue;
    for (const pos of game.tokens[other]) {
      if (pos < 0 || pos > trackEnd) continue;
      const dist = (cell - game.absCell(other, pos) + game.ringLen) % game.ringLen;
      if (dist >= 1 && dist <= 6 && pos + dist <= trackEnd) return true;
    }
  }
  return false;
}
