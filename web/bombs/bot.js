// Бомбодром: a computer rival for the duel, when no friend came (mode 'bot').
// It only presses buttons: think() looks at the game and gives { dir, a, b } like a pad,
// so the game is recorded and checked by the server like any duel.
(function (root) {
'use strict';

const S = root.BombSim;
const { COLS, ROWS, TS, EMPTY, SOFT, HARD, DX, DY } = S;
const idx = (cx, cy) => cy * COLS + cx;
const FRAMES_PER_CELL = 20;   // about how long a hero takes to cross a cell
const REMOTE_FUSE = 30;       // a remote bomb may go off any moment: count it as nearly lit

function newMemory() {
  return { wait: 0 };
}

const bombAt = (s, cx, cy) => s.bombs.find((b) => b.x === cx && b.y === cy) || null;

// Frames until fire reaches each cell (Infinity: never), from the bombs on the field.
// A bomb set off by another one goes off with it.
function dangerMap(s, extra) {
  const bombs = extra ? s.bombs.concat([extra]) : s.bombs;
  const when = bombs.map((b) => (b.remote ? REMOTE_FUSE : b.t));
  const rays = bombs.map((b) => {
    const cells = [idx(b.x, b.y)];
    for (let d = 0; d < 4; d++) {
      for (let r = 1; r <= b.range; r++) {
        const cx = b.x + DX[d] * r, cy = b.y + DY[d] * r;
        const c = s.cells[idx(cx, cy)];
        if (c === HARD) break;
        cells.push(idx(cx, cy));
        if (c !== EMPTY) break;
        if (bombs.some((o) => o.x === cx && o.y === cy)) break;
      }
    }
    return cells;
  });
  // Chains: a bomb in another's blast goes off no later than it.
  for (let pass = 0; pass < 3; pass++) {
    bombs.forEach((b, i) => {
      rays.forEach((cells, j) => {
        if (i !== j && cells.includes(idx(b.x, b.y))) when[i] = Math.min(when[i], when[j]);
      });
    });
  }
  const out = new Float64Array(COLS * ROWS).fill(Infinity);
  rays.forEach((cells, i) => { for (const k of cells) out[k] = Math.min(out[k], when[i]); });
  for (let k = 0; k < out.length; k++) if (s.fire[k]) out[k] = 0;
  return out;
}

// Paths over open floor from the hero's cell: steps and the first step's direction for every cell.
function paths(s, p, from, danger) {
  const steps = new Int32Array(COLS * ROWS).fill(-1);
  const first = new Int8Array(COLS * ROWS).fill(-1);
  const queue = [from];
  steps[idx(from[0], from[1])] = 0;
  while (queue.length) {
    const [cx, cy] = queue.shift();
    const k0 = idx(cx, cy);
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const k = idx(nx, ny);
      if (steps[k] >= 0) continue;
      const c = s.cells[k];
      if (c === HARD || (c !== EMPTY && !(p.wallpass && c === SOFT))) continue;
      if (bombAt(s, nx, ny) && !p.bombpass) continue;
      const at = (steps[k0] + 1) * FRAMES_PER_CELL;
      // Do not walk into fire, nor into a cell that will burn as we pass.
      if (danger[k] <= at + 8 && danger[k] + S.FLAME >= at - 8) continue;
      if (s.enemies.some((e) => !e.dead && S.cellOf(e.x, e.y)[0] === nx && S.cellOf(e.x, e.y)[1] === ny)) continue;
      steps[k] = steps[k0] + 1;
      first[k] = steps[k0] === 0 ? d : first[k0];
      queue.push([nx, ny]);
    }
  }
  return { steps, first };
}

// The nearest cell among those `good` says yes to; → { k, dir, steps } or null.
function nearest(pt, good) {
  let best = null;
  for (let k = 0; k < pt.steps.length; k++) {
    if (pt.steps[k] < 0 || !good(k)) continue;
    if (!best || pt.steps[k] < best.steps) best = { k, dir: pt.first[k], steps: pt.steps[k] };
  }
  return best;
}

// Would fire from a bomb here (with this range) reach the cell?
function inBlast(s, cx, cy, range, tx, ty) {
  if (cx !== tx && cy !== ty) return false;
  const d = cx === tx ? (ty > cy ? 2 : 0) : (tx > cx ? 1 : 3);
  const n = Math.abs(tx - cx) + Math.abs(ty - cy);
  if (n > range) return false;
  for (let r = 1; r < n; r++) if (s.cells[idx(cx + DX[d] * r, cy + DY[d] * r)] !== EMPTY) return false;
  return true;
}

function think(s, pi, mem) {
  const idle = { dir: -1, a: false, b: false };
  const p = s.players[pi];
  if (!p || !p.alive || s.phase !== 'play') return idle;
  const rival = s.players.find((o) => o !== p && o.alive);
  const here = S.cellOf(p.x, p.y);
  const hk = idx(here[0], here[1]);
  const danger = dangerMap(s, null);
  const pt = paths(s, p, here, danger);
  const safe = (k) => danger[k] === Infinity;
  // Not quite on the cell yet: finish the step first, so turns happen on the grid.
  const off = Math.abs(p.x - here[0] * TS) + Math.abs(p.y - here[1] * TS);

  // 1. In the way of fire: run to the nearest safe cell.
  if (!safe(hk) && !(p.flamepass && !s.fire[hk])) {
    const out = nearest(pt, safe);
    return out ? { dir: out.dir, a: false, b: false } : idle;
  }

  // 2. The remote: set off our bomb when the rival stands in its fire and we do not.
  if (p.remote && rival) {
    const rc = S.cellOf(rival.x, rival.y);
    const mine = s.bombs.find((b) => b.owner === pi);
    if (mine && inBlast(s, mine.x, mine.y, mine.range, rc[0], rc[1]) && !inBlast(s, mine.x, mine.y, mine.range, here[0], here[1])) return { dir: -1, a: false, b: true };
  }

  // 3. A bomb here, if it hits something worth it and there is a way out.
  const own = s.bombs.filter((b) => b.owner === pi).length;
  if (own < p.bombs && !bombAt(s, here[0], here[1]) && off < TS / 4 && --mem.wait <= 0) {
    let worth = false;
    for (let d = 0; d < 4 && !worth; d++) {
      for (let r = 1; r <= p.range; r++) {
        const cx = here[0] + DX[d] * r, cy = here[1] + DY[d] * r;
        const c = s.cells[idx(cx, cy)];
        if (c === SOFT) { worth = true; break; }
        if (c !== EMPTY) break;
      }
    }
    for (const o of s.players) {
      if (o === p || !o.alive) continue;
      const oc = S.cellOf(o.x, o.y);
      if (inBlast(s, here[0], here[1], p.range, oc[0], oc[1])) worth = true;
    }
    for (const e of s.enemies) {
      if (e.dead) continue;
      const ec = S.cellOf(e.x, e.y);
      if (inBlast(s, here[0], here[1], p.range, ec[0], ec[1])) worth = true;
    }
    if (worth) {
      const bomb = { x: here[0], y: here[1], t: S.FUSE, range: p.range, remote: false };
      const after = dangerMap(s, bomb);
      const way = nearest(paths(s, p, here, after), (k) => after[k] === Infinity);
      if (way && way.steps * FRAMES_PER_CELL < S.FUSE - 30) {
        mem.wait = 20;
        return { dir: way.dir, a: true, b: false };
      }
    }
  }

  // 4. Where to go: the open door, the item, the rival, or the nearest soft block to blow up.
  const goal = (test) => nearest(pt, (k) => safe(k) && test(k));
  const doorOpen = s.door && s.cells[idx(s.door[0], s.door[1])] === EMPTY;
  const item = s.item && !s.item.taken && s.cells[idx(s.item.x, s.item.y)] === EMPTY ? s.item : null;
  let go = null;
  if (doorOpen) go = goal((k) => k === idx(s.door[0], s.door[1]));
  if (!go && item) go = goal((k) => k === idx(item.x, item.y));
  if (!go && rival) {
    const rc = S.cellOf(rival.x, rival.y);
    go = goal((k) => {
      const cx = k % COLS, cy = Math.floor(k / COLS);
      return k !== hk && inBlast(s, cx, cy, p.range, rc[0], rc[1]);
    });
  }
  if (!go) {
    go = goal((k) => {
      const cx = k % COLS, cy = Math.floor(k / COLS);
      for (let d = 0; d < 4; d++) if (s.cells[idx(cx + DX[d], cy + DY[d])] === SOFT) return true;
      return false;
    });
  }
  if (go && go.steps > 0) return { dir: go.dir, a: false, b: false };
  // On the goal already: line up on the cell.
  if (off) {
    if (p.x !== here[0] * TS) return { dir: p.x < here[0] * TS ? 1 : 3, a: false, b: false };
    return { dir: p.y < here[1] * TS ? 2 : 0, a: false, b: false };
  }
  return idle;
}

root.BombBot = { think, newMemory, dangerMap };
})(typeof window !== 'undefined' ? window : globalThis);
