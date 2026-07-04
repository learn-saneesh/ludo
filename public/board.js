// Board rendering: classic 15x15 cross for 2-4 players, circular ring board
// for 5-8. `createBoard(svg, layout)` draws the static board and returns an
// API whose drawTokens() reconciles token elements so CSS can animate moves.

export const COLORS = ['red', 'green', 'yellow', 'blue', 'purple', 'orange', 'teal', 'pink'];
export const COLOR_HEX = {
  red: '#e5484d',
  green: '#30a46c',
  yellow: '#f0b429',
  blue: '#3e82f7',
  purple: '#9d5cff',
  orange: '#f76b15',
  teal: '#12a594',
  pink: '#e93d82',
};

const NS = 'http://www.w3.org/2000/svg';
function el(name, attrs, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

export function createBoard(svg, layout) {
  svg.innerHTML = '';
  const geom = layout.classic ? classicGeometry(svg) : ringGeometry(svg, layout);
  const layer = el('g', { id: 'tokens' }, svg);
  return makeApi(layer, geom, layout);
}

/* ================= classic 15x15 cross (2-4 players) ================= */

const CELL = 40;

// Absolute track cells 0..51 as [col,row]. Cell 0 is red's start.
const TRACK = [
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
  [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
  [7, 0],
  [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
  [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
  [14, 7],
  [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
  [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
  [7, 14],
  [6, 14], [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
  [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  [0, 7],
  [0, 6],
];

const HOME_COLUMN = [
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],       // red
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],       // green
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],   // yellow
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],   // blue
];

const BASE_ORIGIN = [[0, 0], [9, 0], [9, 9], [0, 9]];
const BASE_SLOTS = BASE_ORIGIN.map(([c, r]) =>
  [[c + 1.5, r + 1.5], [c + 3.5, r + 1.5], [c + 1.5, r + 3.5], [c + 3.5, r + 3.5]]
);
const FINISH_SPOT = [[6.5, 7.5], [7.5, 6.5], [8.5, 7.5], [7.5, 8.5]];
const CLASSIC_SAFE = new Set([0, 13, 26, 39, 8, 21, 34, 47]);

function classicGeometry(svg) {
  const SIZE = CELL * 15;
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  const bg = el('g', {}, svg);
  const rect = (c, r, w, h, fill, extra = {}) =>
    el('rect', { x: c * CELL, y: r * CELL, width: w * CELL, height: h * CELL, fill, ...extra }, bg);

  rect(0, 0, 15, 15, '#faf7f2', { rx: 12 });

  BASE_ORIGIN.forEach(([c, r], seat) => {
    const hex = COLOR_HEX[COLORS[seat]];
    rect(c, r, 6, 6, hex, { rx: 8 });
    rect(c + 0.8, r + 0.8, 4.4, 4.4, '#faf7f2', { rx: 10 });
    for (const [sc, sr] of BASE_SLOTS[seat]) {
      el('circle', { cx: sc * CELL, cy: sr * CELL, r: CELL * 0.62, fill: '#fff', stroke: hex, 'stroke-width': 3 }, bg);
    }
  });

  TRACK.forEach(([c, r], abs) => {
    const startSeat = abs % 13 === 0 ? abs / 13 : -1;
    const fill = startSeat >= 0 ? COLOR_HEX[COLORS[startSeat]] : '#fff';
    rect(c, r, 1, 1, fill, { stroke: '#d8d2c8', 'stroke-width': 1 });
    if (CLASSIC_SAFE.has(abs)) {
      el('text', {
        x: (c + 0.5) * CELL, y: (r + 0.5) * CELL,
        'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': CELL * 0.7, fill: startSeat >= 0 ? 'rgba(255,255,255,.85)' : '#c9c2b6',
      }, bg).textContent = '★';
    }
  });

  HOME_COLUMN.forEach((cells, seat) => {
    const hex = COLOR_HEX[COLORS[seat]];
    for (const [c, r] of cells) rect(c, r, 1, 1, hex, { stroke: '#d8d2c8', 'stroke-width': 1 });
  });

  const cx = 7.5 * CELL, cy = 7.5 * CELL;
  const k = { tl: [6 * CELL, 6 * CELL], tr: [9 * CELL, 6 * CELL], br: [9 * CELL, 9 * CELL], bl: [6 * CELL, 9 * CELL] };
  const tris = [
    ['red', k.tl, k.bl], ['green', k.tl, k.tr], ['yellow', k.tr, k.br], ['blue', k.bl, k.br],
  ];
  for (const [color, a, b] of tris) {
    el('polygon', {
      points: `${a[0]},${a[1]} ${b[0]},${b[1]} ${cx},${cy}`,
      fill: COLOR_HEX[color], stroke: '#faf7f2', 'stroke-width': 2,
    }, bg);
  }

  return {
    cellSize: CELL,
    tokenXY(seat, rel, slot, layout) {
      let c, r;
      if (rel === -1) {
        [c, r] = BASE_SLOTS[seat][slot];
        return [c * CELL, r * CELL];
      }
      if (rel <= 50) {
        [c, r] = TRACK[(layout.starts[seat] + rel) % 52];
      } else if (rel <= 55) {
        [c, r] = HOME_COLUMN[seat][rel - 51];
      } else {
        [c, r] = FINISH_SPOT[seat];
        return [c * CELL, r * CELL];
      }
      return [(c + 0.5) * CELL, (r + 0.5) * CELL];
    },
  };
}

/* ================= circular ring board (5-8 players) ================= */

function ringGeometry(svg, layout) {
  const L = layout.ringLen;
  const seats = Object.keys(layout.starts).map(Number).sort((a, b) => layout.starts[a] - layout.starts[b]);
  const SIZE = 840, C = SIZE / 2;
  const Rt = 295;
  const step = (2 * Math.PI * Rt) / L;
  const cellR = Math.min(step * 0.47, 13.5);
  const colStep = cellR * 2.35;
  const safe = new Set(layout.safe);

  const angle = (abs) => (2 * Math.PI * abs) / L - Math.PI / 2;
  const pt = (R, abs) => [C + R * Math.cos(angle(abs)), C + R * Math.sin(angle(abs))];

  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  const bg = el('g', {}, svg);
  el('rect', { x: 0, y: 0, width: SIZE, height: SIZE, rx: 18, fill: '#faf7f2' }, bg);

  const startSeatOf = {};
  for (const s of seats) startSeatOf[layout.starts[s]] = s;

  // Home columns (under the ring cells visually).
  for (const s of seats) {
    const hex = COLOR_HEX[COLORS[s]];
    const entry = (layout.starts[s] - 2 + L) % L;
    for (let k = 1; k <= 5; k++) {
      const [x, y] = pt(Rt - k * colStep, entry);
      el('circle', { cx: x, cy: y, r: cellR, fill: hex, stroke: '#d8d2c8', 'stroke-width': 1 }, bg);
    }
  }

  // Ring cells.
  for (let abs = 0; abs < L; abs++) {
    const owner = startSeatOf[abs];
    const [x, y] = pt(Rt, abs);
    el('circle', {
      cx: x, cy: y, r: cellR,
      fill: owner != null ? COLOR_HEX[COLORS[owner]] : '#fff',
      stroke: '#d8d2c8', 'stroke-width': 1,
    }, bg);
    if (safe.has(abs)) {
      el('text', {
        x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': cellR * 1.3, fill: owner != null ? 'rgba(255,255,255,.9)' : '#c9c2b6',
      }, bg).textContent = '★';
    }
  }

  // Bases outside the ring.
  const Rb = Rt + cellR * 4.6;
  const baseSlots = {};
  for (const s of seats) {
    const hex = COLOR_HEX[COLORS[s]];
    const [x, y] = pt(Rb, layout.starts[s]);
    el('circle', { cx: x, cy: y, r: cellR * 3.1, fill: hex }, bg);
    el('circle', { cx: x, cy: y, r: cellR * 2.5, fill: '#faf7f2' }, bg);
    baseSlots[s] = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([dx, dy]) => {
      const sx = x + dx * cellR * 1.15, sy = y + dy * cellR * 1.15;
      el('circle', { cx: sx, cy: sy, r: cellR * 0.95, fill: '#fff', stroke: hex, 'stroke-width': 2 }, bg);
      return [sx, sy];
    });
  }

  // Center: finish disc with one landing spot per seat.
  el('circle', { cx: C, cy: C, r: cellR * 2.2 + 46, fill: '#efe9df' }, bg);
  el('text', {
    x: C, y: C, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 34,
  }, bg).textContent = '🏆';
  const Rf = cellR * 1.2 + 34;

  return {
    cellSize: cellR * 2,
    tokenXY(seat, rel, slot, lay) {
      if (rel === -1) return baseSlots[seat][slot];
      if (rel <= L - 2) return pt(Rt, (lay.starts[seat] + rel) % L);
      if (rel < lay.homePos) {
        const entry = (lay.starts[seat] - 2 + L) % L;
        return pt(Rt - (rel - (L - 1) + 1) * colStep, entry);
      }
      return pt(Rf, lay.starts[seat]);
    },
  };
}

/* ================= shared token layer ================= */

function makeApi(layer, geom, layout) {
  const trackEnd = layout.ringLen - 2;

  function cellKey(seat, pos, idx) {
    if (pos === -1) return `base-${seat}-${idx}`;
    if (pos <= trackEnd) return `t${(layout.starts[seat] + pos) % layout.ringLen}`;
    return `h${seat}-${pos}`;
  }

  // Offsets (in cell units) for co-located tokens, so stacks stay inside
  // their cell instead of fanning into neighbours.
  function stackOffsets(n) {
    if (n === 1) return [[0, 0]];
    if (n === 2) return [[-0.2, 0], [0.2, 0]];
    if (n <= 4) return [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]];
    return Array.from({ length: n }, (_, i) => {
      const a = (2 * Math.PI * i) / n;
      return [Math.cos(a) * 0.26, Math.sin(a) * 0.26];
    });
  }

  function drawTokens(tokens, movable, mySeat, onClick) {
    const groups = new Map();
    for (const [seatStr, positions] of Object.entries(tokens)) {
      const seat = Number(seatStr);
      positions.forEach((pos, idx) => {
        const key = cellKey(seat, pos, idx);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ seat, idx, pos });
      });
    }

    const seen = new Set();
    for (const group of groups.values()) {
      const offs = stackOffsets(group.length);
      const scale = group.length === 1 ? 1 : group.length <= 4 ? 0.68 : 0.55;
      group.forEach(({ seat, idx, pos }, i) => {
        const [x, y] = geom.tokenXY(seat, pos, idx, layout);
        const [dx, dy] = offs[i];
        const clickable = seat === mySeat && movable.includes(idx);
        upsertToken(seat, idx, x + dx * geom.cellSize, y + dy * geom.cellSize, scale, clickable, onClick);
        seen.add(`tok-${seat}-${idx}`);
      });
    }
    for (const g of [...layer.children]) if (!seen.has(g.id)) g.remove();
  }

  function upsertToken(seat, idx, x, y, scale, clickable, onClick) {
    const id = `tok-${seat}-${idx}`;
    const hex = COLOR_HEX[COLORS[seat]];
    const R = geom.cellSize * 0.42;
    let g = layer.querySelector(`#${id}`);
    if (!g) {
      g = el('g', { id, class: 'token' }, layer);
      el('circle', { cx: 0, cy: R * 0.16, r: R, fill: 'rgba(0,0,0,.25)' }, g);
      el('circle', { cx: 0, cy: 0, r: R, fill: hex, stroke: '#fff', 'stroke-width': R * 0.18 }, g);
      el('circle', { cx: 0, cy: 0, r: R * 0.4, fill: 'rgba(255,255,255,.65)' }, g);
      el('circle', { class: 'pulse hidden', cx: 0, cy: 0, r: R * 1.25, fill: 'none', stroke: hex, 'stroke-width': 3 }, g);
      g.addEventListener('click', () => { if (g.classList.contains('movable')) g.onPick?.(); });
      // Place instantly on first draw; animate only subsequent moves.
      g.style.transition = 'none';
      requestAnimationFrame(() => { g.style.transition = ''; });
    }
    g.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    g.classList.toggle('movable', clickable);
    g.querySelector('.pulse').classList.toggle('hidden', !clickable);
    g.onPick = clickable ? () => onClick(idx) : null;
  }

  return { drawTokens, cellSize: geom.cellSize };
}
