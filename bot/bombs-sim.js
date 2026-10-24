// Бомбодром: game rules without any drawing or input.
// step(state, inputs) is deterministic (seeded random, whole numbers only),
// so the server can replay a recorded game (bot/bombs-replay.js) and the
// online host can run the match for both phones.
(function (root) {
'use strict';

const COLS = 31, ROWS = 13;     // the field: steel border and a pillar on every second cell
const TILE = 16;                // pixels per cell
const SUB = 8;                  // positions are kept in 1/8 pixel
const TS = TILE * SUB;          // one cell in position units
const EMPTY = 0, HARD = 1, SOFT = 2, BURN = 3;
const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

const FUSE = 150;           // frames before a bomb goes off (2.5 s)
const FLAME = 32;           // frames a flame burns
const DIE = 90;             // frames of the falling-down picture
const INTRO = 120;          // «ЭТАП N» screen
const STAGE_TIME = 200 * 60; // 200 s per stage, then the fast ones come
const SHIELD = 180;         // spawn protection in a duel after losing a life
const MYSTERY = 600;        // «?» item: 10 s of protection
const MAX_ENEMIES = 16;
const SPEED = [6, 8];       // player, without and with the speed item
// Starts: the left edge and the right edge (alone and in a duel), then the other two corners
// for the third and the fourth bomber («Бой на четверых»).
const STARTS = [[1, 1], [COLS - 2, ROWS - 2], [COLS - 2, 1], [1, ROWS - 2]];
const MAX_PLAYERS = STARTS.length;

// Enemies. speed — units per frame (a cell is 128), wall — goes through soft blocks,
// smart — chance to turn towards the nearest player at a crossing, turn — chance to turn anyway.
const ENEMY = [
  { speed: 2, wall: false, smart: 0, turn: 0.15, score: 100 },     // Капля
  { speed: 3, wall: false, smart: 0.1, turn: 0.25, score: 200 },   // Луковка
  { speed: 2, wall: true, smart: 0, turn: 0.2, score: 400 },       // Бочонок
  { speed: 4, wall: false, smart: 0.3, turn: 0.3, score: 800 },    // Юла
  { speed: 2, wall: true, smart: 0.5, turn: 0.2, score: 1000 },    // Призрак
  { speed: 4, wall: false, smart: 0.6, turn: 0.2, score: 2000 },   // Медуза
  { speed: 6, wall: false, smart: 0.4, turn: 0.3, score: 4000 },   // Шарик
  { speed: 6, wall: true, smart: 0.7, turn: 0.2, score: 8000 },    // Искра
];
const ITEMS = ['bomb', 'fire', 'speed', 'remote', 'wallpass', 'bombpass', 'flamepass', 'mystery', 'kick', 'glove'];

// Rules version: 2 adds the kick and the glove and, in a duel, the field that closes in.
// A game is replayed with the rules it was played under; old games come without one and are 1.
const RULES = 2;
// Rules 2: these stages (from 0) hide the kick or the glove instead of their usual item;
// in a duel the stages go kick, glove, the stage's own item, and again.
const NEW_ITEMS = { 5: 'kick', 13: 'glove', 24: 'kick', 31: 'glove' };
const DUEL_ITEMS = ['kick', 'glove', ''];
const SLIDE = 4;            // frames a kicked bomb takes per cell
const THROW = 3;            // cells a bomb flies from the glove (further if it cannot land there)
// Duel, rules 2: after SHRINK_AT of play steel blocks fall along the edges, one every
// SHRINK_EVERY frames, ring by ring, SHRINK_RINGS rings deep. The door's cell is spared.
const SHRINK_AT = 120 * 60;
const SHRINK_EVERY = 12;
const SHRINK_RINGS = 3;

// Stages: how many enemies of each type (by index in ENEMY) and the item hidden under a block.
const STAGES = [
  { foes: [6], item: 'fire' },
  { foes: [3, 3], item: 'bomb' },
  { foes: [2, 2, 2], item: 'remote' },
  { foes: [1, 1, 2, 2], item: 'speed' },
  { foes: [0, 4, 3], item: 'bomb' },
  { foes: [0, 2, 3, 2], item: 'bomb' },
  { foes: [0, 2, 3, 0, 2], item: 'fire' },
  { foes: [0, 1, 2, 4], item: 'speed' },
  { foes: [0, 0, 1, 4, 1], item: 'wallpass' },
  { foes: [0, 1, 1, 1, 1, 2], item: 'bomb' },
  { foes: [0, 0, 2, 2, 2, 1], item: 'remote' },
  { foes: [0, 1, 1, 1, 4, 1], item: 'fire' },
  { foes: [0, 0, 0, 3, 2, 2, 1], item: 'bombpass' },
  { foes: [0, 0, 2, 2, 0, 2, 2], item: 'bomb' },
  { foes: [0, 0, 0, 2, 2, 2, 2], item: 'flamepass' },
  { foes: [0, 0, 0, 1, 3, 2, 2], item: 'fire' },
  { foes: [0, 0, 1, 1, 1, 3, 2, 1], item: 'mystery' },
  { foes: [0, 0, 0, 2, 2, 2, 2, 1], item: 'bomb' },
  { foes: [0, 0, 0, 0, 3, 2, 3, 1], item: 'speed' },
  { foes: [0, 0, 0, 0, 2, 3, 2, 3], item: 'mystery' },
  // 21–50: more enemies and more of the fast and the smart ones.
  { foes: [0, 0, 4, 0, 4, 0, 2], item: 'bombpass' },
  { foes: [0, 0, 0, 4, 0, 4, 0, 2], item: 'fire' },
  { foes: [0, 0, 3, 0, 3, 3, 1, 1], item: 'remote' },
  { foes: [0, 0, 0, 0, 0, 4, 4, 2], item: 'speed' },
  { foes: [0, 3, 3, 0, 0, 0, 2, 2], item: 'bomb' },
  { foes: [0, 0, 0, 3, 3, 2, 2, 1], item: 'flamepass' },
  { foes: [0, 0, 2, 2, 2, 2, 2, 1], item: 'bomb' },
  { foes: [0, 0, 0, 0, 4, 3, 2, 2], item: 'wallpass' },
  { foes: [0, 0, 0, 2, 2, 3, 3, 1], item: 'fire' },
  { foes: [0, 0, 0, 0, 3, 3, 3, 2], item: 'mystery' },
  { foes: [0, 0, 4, 0, 4, 0, 3, 1], item: 'remote' },
  { foes: [0, 0, 0, 4, 2, 2, 2, 2], item: 'bomb' },
  { foes: [0, 0, 2, 2, 2, 2, 2, 2], item: 'speed' },
  { foes: [0, 0, 0, 0, 4, 4, 2, 2], item: 'bombpass' },
  { foes: [0, 0, 0, 3, 3, 2, 3, 1], item: 'fire' },
  { foes: [0, 0, 3, 0, 3, 3, 1, 2], item: 'flamepass' },
  { foes: [0, 0, 0, 2, 3, 3, 2, 2], item: 'bomb' },
  { foes: [0, 0, 0, 0, 3, 3, 3, 3], item: 'wallpass' },
  { foes: [0, 0, 2, 2, 2, 2, 3, 2], item: 'remote' },
  { foes: [0, 0, 0, 0, 4, 3, 3, 3], item: 'mystery' },
  { foes: [0, 0, 0, 4, 0, 4, 3, 2], item: 'fire' },
  { foes: [0, 0, 3, 0, 3, 3, 2, 2], item: 'bomb' },
  { foes: [0, 0, 0, 2, 3, 3, 3, 2], item: 'speed' },
  { foes: [0, 0, 0, 0, 3, 4, 3, 3], item: 'bombpass' },
  { foes: [0, 0, 2, 2, 2, 2, 2, 4], item: 'flamepass' },
  { foes: [0, 0, 0, 3, 3, 3, 2, 3], item: 'fire' },
  { foes: [0, 0, 0, 0, 4, 3, 4, 3], item: 'remote' },
  { foes: [0, 0, 0, 2, 2, 3, 3, 4], item: 'mystery' },
  { foes: [0, 0, 0, 0, 3, 3, 4, 4], item: 'bomb' },
  { foes: [0, 0, 0, 0, 2, 4, 4, 4], item: 'mystery' },
];
// Clearing one of these stages alone gives a life (stage numbers from 1).
const LIFE_STAGES = [20, 30, 40];
const MAX_LIVES = 9;

const NO_INPUT = { dir: -1, a: false, b: false };

// Inner cells ring by ring from the edge, clockwise: where the closing field puts its blocks.
const SPIRAL = (() => {
  const out = [];
  for (let r = 0; r < SHRINK_RINGS; r++) {
    const x0 = 1 + r, y0 = 1 + r, x1 = COLS - 2 - r, y1 = ROWS - 2 - r;
    for (let x = x0; x <= x1; x++) out.push([x, y0]);
    for (let y = y0 + 1; y <= y1; y++) out.push([x1, y]);
    for (let x = x1 - 1; x >= x0; x--) out.push([x, y1]);
    for (let y = y1 - 1; y > y0; y--) out.push([x0, y]);
  }
  return out;
})();

// ---------- Helpers ----------
function rnd(s) {
  s.seed = (s.seed + 0x6D2B79F5) | 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (s, n) => Math.floor(rnd(s) * n);

const idx = (cx, cy) => cy * COLS + cx;
const inside = (cx, cy) => cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS;
// The cell under the middle of a 16x16 box.
const cellOf = (x, y) => [Math.floor((x + TS / 2) / TS), Math.floor((y + TS / 2) / TS)];
const bombAt = (s, cx, cy) => s.bombs.find((b) => b.x === cx && b.y === cy) || null;
const covers = (x, y, cx, cy) => x < (cx + 1) * TS && x + TS > cx * TS && y < (cy + 1) * TS && y + TS > cy * TS;
const doorOpen = (s) => s.door && s.cells[idx(s.door[0], s.door[1])] === EMPTY;
const itemOpen = (s) => s.item && !s.item.taken && s.cells[idx(s.item.x, s.item.y)] === EMPTY;

// ---------- Game setup ----------
// opts: { rules } — see RULES.
// Two to four players play against each other (s.duel): the last one with lives left wins.
function newGame(players, seed, opts = {}) {
  players = Math.max(1, Math.min(MAX_PLAYERS, players | 0));
  const s = { rules: opts.rules || 1, seed: seed | 0, frame: 0, duel: players >= 2, players: [], events: [], won: false, winner: -1 };
  for (let i = 0; i < players; i++) {
    s.players.push({
      pi: i, lives: 3, score: 0, wins: 0, out: false,
      bombs: 1, range: 1, speed: 0, remote: false, wallpass: false, bombpass: false, flamepass: false, kick: false, glove: false,
      x: 0, y: 0, dir: DOWN, anim: 0, alive: true, dieT: 0, shield: 0, mystery: 0, kills: 0,
    });
  }
  startStage(s, 0);
  return s;
}

// Soft blocks never lie on the start cell and the two cells next to it.
function safeZone(s, cx, cy) {
  const starts = STARTS.slice(0, s.players.length);
  return starts.some(([sx, sy]) => Math.abs(cx - sx) + Math.abs(cy - sy) <= 2 && (cx === sx || cy === sy));
}

function startStage(s, n) {
  const st = STAGES[Math.min(n, STAGES.length - 1)];
  s.stage = n;
  s.cells = new Uint8Array(COLS * ROWS);
  s.burn = new Uint8Array(COLS * ROWS);
  s.fire = new Uint8Array(COLS * ROWS);     // flame time left in a cell
  s.fireBy = new Int8Array(COLS * ROWS);    // whose bomb made it
  s.fireKind = new Uint8Array(COLS * ROWS); // 0 centre, 1 across, 2 up-down, 3..6 ends up/right/down/left
  s.bombs = [];
  s.enemies = [];
  s.nextId = 1;
  s.time = STAGE_TIME;
  s.hurry = false;
  s.doorSpawns = 0;
  s.winner = -1;
  const soft = [];
  const density = 0.24 + Math.min(n, 19) * 0.006 + Math.max(0, Math.min(n, 39) - 19) * 0.002;
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const border = cx === 0 || cy === 0 || cx === COLS - 1 || cy === ROWS - 1;
      if (border || (cx % 2 === 0 && cy % 2 === 0)) { s.cells[idx(cx, cy)] = HARD; continue; }
      if (!safeZone(s, cx, cy) && rnd(s) < density) { s.cells[idx(cx, cy)] = SOFT; soft.push([cx, cy]); }
    }
  }
  const d = pick(s, soft.length);
  s.door = soft[d];
  soft.splice(d, 1);
  const it = soft[pick(s, soft.length)];
  s.item = { x: it[0], y: it[1], type: itemFor(s, n, st.item), taken: false, by: -1 };
  s.shrink = 0;
  // Enemies start on free cells away from the players.
  const free = [];
  for (let cy = 1; cy < ROWS - 1; cy++) {
    for (let cx = 1; cx < COLS - 1; cx++) {
      if (s.cells[idx(cx, cy)] !== EMPTY) continue;
      const far = STARTS.slice(0, s.players.length).every(([sx, sy]) => Math.abs(cx - sx) + Math.abs(cy - sy) >= 7);
      if (far) free.push([cx, cy]);
    }
  }
  st.foes.forEach((count, type) => {
    for (let i = 0; i < count && free.length; i++) {
      const k = pick(s, free.length);
      addEnemy(s, type, free[k][0], free[k][1]);
      free.splice(k, 1);
    }
  });
  s.phase = 'intro';
  s.phaseT = 0;
  for (const p of s.players) placePlayer(s, p);
}

function itemFor(s, n, usual) {
  if (s.rules < 2) return usual;
  if (s.duel) return DUEL_ITEMS[n % DUEL_ITEMS.length] || usual;
  return NEW_ITEMS[n] || usual;
}

function placePlayer(s, p) {
  let [sx, sy] = STARTS[p.pi];
  // The closing field may have covered the start: then the nearest open floor.
  if (s.cells[idx(sx, sy)] !== EMPTY) {
    let best = null;
    for (let cy = 1; cy < ROWS - 1; cy++) {
      for (let cx = 1; cx < COLS - 1; cx++) {
        if (s.cells[idx(cx, cy)] !== EMPTY || bombAt(s, cx, cy)) continue;
        const d = Math.abs(cx - sx) + Math.abs(cy - sy);
        if (!best || d < best[2]) best = [cx, cy, d];
      }
    }
    if (best) [sx, sy] = best;
  }
  p.x = sx * TS;
  p.y = sy * TS;
  p.dir = DOWN;
  p.anim = 0;
  p.alive = !p.out;
  p.dieT = 0;
}

function addEnemy(s, type, cx, cy) {
  const e = { id: s.nextId++, type, x: cx * TS, y: cy * TS, dir: pick(s, 4), dead: 0, tx: cx, ty: cy };
  s.enemies.push(e);
  return e;
}

// Lost on death: the rare items. Bombs, fire and speed stay.
function loseRare(p) {
  p.remote = false;
  p.wallpass = false;
  p.bombpass = false;
  p.flamepass = false;
  p.kick = false;
  p.glove = false;
  p.mystery = 0;
}

// ---------- Players ----------
function blockedFor(s, p, cx, cy) {
  if (!inside(cx, cy)) return true;
  const c = s.cells[idx(cx, cy)];
  if (c === HARD) return true;
  if ((c === SOFT || c === BURN) && !p.wallpass) return true;
  const b = bombAt(s, cx, cy);
  return !!(b && !p.bombpass && !(b.passers & (1 << p.pi)));
}

function movePlayer(s, p, dir) {
  const v = SPEED[p.speed];
  p.dir = dir;
  p.anim++;
  const horiz = dir === LEFT || dir === RIGHT;
  // Along: the axis we move on; across: the other one, which must sit on a row/column.
  let along = horiz ? p.x : p.y;
  let across = horiz ? p.y : p.x;
  const d = horiz ? DX[dir] : DY[dir];
  const line = Math.floor((across + TS / 2) / TS);
  const off = across - line * TS;
  const free = (a, l) => !(horiz ? blockedFor(s, p, a, l) : blockedFor(s, p, l, a));
  if (off !== 0) {
    // Round a corner: slide onto the nearest row when the way ahead from it is open.
    const here = Math.floor((along + TS / 2) / TS);
    const aligned = along % TS === 0;
    if (!aligned || free(here + d, line)) {
      const k = Math.min(v, Math.abs(off));
      across -= Math.sign(off) * k;
    }
  } else {
    let next = along + d * v;
    if (d > 0) {
      const c = Math.floor((next + TS - 1) / TS);
      if (c !== Math.floor((along + TS - 1) / TS) && !free(c, line)) next = (c - 1) * TS;
    } else {
      const c = Math.floor(next / TS);
      if (c !== Math.floor(along / TS) && !free(c, line)) next = (c + 1) * TS;
    }
    along = next;
  }
  if (horiz) { p.x = along; p.y = across; } else { p.y = along; p.x = across; }
}

function dropBomb(s, p) {
  const [cx, cy] = cellOf(p.x, p.y);
  if (s.cells[idx(cx, cy)] !== EMPTY || bombAt(s, cx, cy)) return;
  if (s.bombs.filter((b) => b.owner === p.pi).length >= p.bombs) return;
  let passers = 0;
  for (const o of s.players) if (o.alive && covers(o.x, o.y, cx, cy)) passers |= 1 << o.pi;
  s.bombs.push({ x: cx, y: cy, t: FUSE, owner: p.pi, range: p.range, remote: p.remote, passers });
  s.events.push('drop');
}

function takeItem(s, p, type) {
  if (type === 'bomb') p.bombs = Math.min(8, p.bombs + 1);
  else if (type === 'fire') p.range = Math.min(8, p.range + 1);
  else if (type === 'speed') p.speed = 1;
  else if (type === 'mystery') p.mystery = MYSTERY;
  else p[type] = true;
  p.score += 1000;
  s.events.push('item');
}

function updatePlayer(s, p, inp) {
  if (p.out) return;
  if (!p.alive) {
    if (++p.dieT >= DIE) afterDeath(s, p);
    return;
  }
  if (p.shield) p.shield--;
  if (p.mystery) p.mystery--;
  if (s.phase !== 'play') return;
  if (inp.dir >= 0 && inp.dir <= 3) {
    movePlayer(s, p, inp.dir);
    if (p.kick) kickBomb(s, p, inp.dir);
  }
  if (inp.a) dropBomb(s, p);
  // B: the glove throws the bomb underfoot; otherwise it sets off the remote bombs.
  const [ux, uy] = cellOf(p.x, p.y);
  const under = p.glove && bombAt(s, ux, uy);
  if (inp.b && under) throwBomb(s, p, under);
  else if (inp.b && p.remote) {
    const b = s.bombs.find((x) => x.owner === p.pi);
    if (b) explode(s, b);
  }
  const [cx, cy] = cellOf(p.x, p.y);
  if (itemOpen(s) && s.item.x === cx && s.item.y === cy) {
    s.item.taken = true;
    s.item.by = p.pi;
    takeItem(s, p, s.item.type);
  }
  if (doorOpen(s) && s.door[0] === cx && s.door[1] === cy && (s.duel || !s.enemies.some((e) => !e.dead))) {
    const [dx, dy] = [Math.abs(p.x - cx * TS), Math.abs(p.y - cy * TS)];
    if (dx <= TS / 4 && dy <= TS / 4) exitStage(s, p);
  }
}

const safe = (p) => p.shield > 0 || p.mystery > 0;

function killPlayer(s, p) {
  if (!p.alive || safe(p) || s.phase !== 'play') return;
  p.alive = false;
  p.dieT = 0;
  s.events.push('die');
}

function afterDeath(s, p) {
  p.lives--;
  loseRare(p);
  if (!s.duel) {
    if (p.lives > 0) {
      startStage(s, s.stage);
    } else {
      p.out = true;
      s.phase = 'over';
      s.phaseT = 0;
      s.events.push('over');
    }
    return;
  }
  if (p.lives <= 0) {
    // Out of the game; it ends when only one has lives left, and that one wins.
    p.out = true;
    const left = s.players.filter((o) => !o.out);
    if (left.length > 1) return;
    s.winner = left.length ? left[0].pi : -1;
    s.phase = 'over';
    s.phaseT = 0;
    s.events.push('over');
    return;
  }
  placePlayer(s, p);
  p.shield = SHIELD;
}

function exitStage(s, p) {
  s.winner = p.pi;
  p.wins++;
  p.score += s.duel ? 2000 : Math.floor(s.time / 60) * 10;
  s.phaseT = 0;
  s.events.push('clear');
  if (!s.duel && LIFE_STAGES.includes(s.stage + 1) && p.lives < MAX_LIVES) {
    p.lives++;
    s.events.push('life');
  }
  if (s.stage + 1 >= STAGES.length) {
    s.won = true;
    s.phase = 'over';
  } else s.phase = 'clear';
}

// The kick: walking into a bomb sends it sliding until something stops it.
function kickBomb(s, p, dir) {
  const [cx, cy] = cellOf(p.x, p.y);
  const b = bombAt(s, cx + DX[dir], cy + DY[dir]);
  if (!b || b.slide >= 0) return;
  if (b.passers & (1 << p.pi)) return;
  // Only when the hero stands right against it.
  if (!covers(p.x + DX[dir], p.y + DY[dir], b.x, b.y) || covers(p.x, p.y, b.x, b.y)) return;
  if (!slideFree(s, b.x + DX[dir], b.y + DY[dir])) return;
  b.slide = dir;
  b.slideT = SLIDE;
  s.events.push('kick');
}

// A cell a bomb can move onto: open floor with nobody on it.
function slideFree(s, cx, cy) {
  if (!inside(cx, cy) || s.cells[idx(cx, cy)] !== EMPTY || bombAt(s, cx, cy)) return false;
  if (s.players.some((o) => o.alive && covers(o.x, o.y, cx, cy))) return false;
  return !s.enemies.some((e) => !e.dead && covers(e.x, e.y, cx, cy));
}

// The glove: the bomb underfoot flies THROW cells ahead, over anything, to the first open floor.
function throwBomb(s, p, b) {
  for (let r = THROW; r <= THROW + 3; r++) {
    const cx = b.x + DX[p.dir] * r, cy = b.y + DY[p.dir] * r;
    if (!inside(cx, cy)) return;
    if (s.cells[idx(cx, cy)] !== EMPTY || bombAt(s, cx, cy)) continue;
    b.x = cx;
    b.y = cy;
    b.slide = -1;
    b.passers = 0;
    for (const o of s.players) if (o.alive && covers(o.x, o.y, cx, cy)) b.passers |= 1 << o.pi;
    s.events.push('throw');
    return;
  }
}

// Duel, rules 2: steel blocks close in from the edges.
function shrinkField(s) {
  if (s.shrink >= SPIRAL.length) return;
  if (STAGE_TIME - s.time < SHRINK_AT || (STAGE_TIME - s.time - SHRINK_AT) % SHRINK_EVERY) return;
  const [cx, cy] = SPIRAL[s.shrink++];
  if (s.door && s.door[0] === cx && s.door[1] === cy) return;
  const k = idx(cx, cy);
  if (s.cells[k] === HARD) return;
  s.cells[k] = HARD;
  s.burn[k] = 0;
  s.fire[k] = 0;
  s.bombs = s.bombs.filter((b) => b.x !== cx || b.y !== cy);
  if (s.item && !s.item.taken && s.item.x === cx && s.item.y === cy) { s.item.taken = true; s.item.by = -1; }
  for (const e of s.enemies) if (!e.dead && covers(e.x, e.y, cx, cy)) e.dead = 1;
  // Nothing saves a hero from a falling block.
  for (const p of s.players) {
    if (p.alive && covers(p.x, p.y, cx, cy)) { p.alive = false; p.dieT = 0; s.events.push('die'); }
  }
  s.events.push('shrink');
}

// ---------- Bombs and flames ----------
function explode(s, first) {
  const queue = [first];
  let doorHit = false;
  while (queue.length) {
    const b = queue.shift();
    const i = s.bombs.indexOf(b);
    if (i < 0) continue;
    s.bombs.splice(i, 1);
    const burn = (cx, cy, kind) => {
      const k = idx(cx, cy);
      s.fire[k] = FLAME;
      s.fireBy[k] = b.owner;
      s.fireKind[k] = kind;
    };
    burn(b.x, b.y, 0);
    for (let dir = 0; dir < 4; dir++) {
      for (let r = 1; r <= b.range; r++) {
        const cx = b.x + DX[dir] * r, cy = b.y + DY[dir] * r;
        const c = s.cells[idx(cx, cy)];
        if (c === HARD) break;
        if (c === SOFT) { s.cells[idx(cx, cy)] = BURN; s.burn[idx(cx, cy)] = FLAME; break; }
        if (c === BURN) break;
        const other = bombAt(s, cx, cy);
        if (other) { queue.push(other); break; }
        if (doorOpen(s) && s.door[0] === cx && s.door[1] === cy) doorHit = true;
        burn(cx, cy, r === b.range ? 3 + dir : dir % 2 ? 1 : 2);
      }
    }
  }
  s.events.push('boom');
  // Fire on an open door lets out a few strong ones.
  if (doorHit && s.doorSpawns < 3 && s.phase === 'play') {
    s.doorSpawns++;
    const type = Math.min(7, 3 + Math.floor(s.stage / 4));
    const alive = s.enemies.filter((e) => !e.dead).length;
    for (let k = 0; k < 4 && alive + k < MAX_ENEMIES; k++) addEnemy(s, type, s.door[0], s.door[1]).wait = FLAME + 4;
    s.events.push('spawn');
  }
}

function updateBombs(s) {
  for (const b of s.bombs) {
    for (const p of s.players) if ((b.passers & (1 << p.pi)) && !(p.alive && covers(p.x, p.y, b.x, b.y))) b.passers &= ~(1 << p.pi);
  }
  for (const b of s.bombs) {
    if (b.slide === undefined || b.slide < 0 || --b.slideT > 0) continue;
    const nx = b.x + DX[b.slide], ny = b.y + DY[b.slide];
    if (!slideFree(s, nx, ny)) { b.slide = -1; continue; }
    b.x = nx;
    b.y = ny;
    b.slideT = SLIDE;
  }
  for (const b of s.bombs.slice()) {
    if (b.remote || s.bombs.indexOf(b) < 0) continue;
    if (--b.t <= 0) explode(s, b);
  }
  for (let k = 0; k < s.fire.length; k++) {
    if (s.fire[k]) s.fire[k]--;
    if (s.burn[k] && --s.burn[k] === 0) s.cells[k] = EMPTY;
  }
}

// ---------- Enemies ----------
function enemyCan(s, e, cx, cy) {
  if (!inside(cx, cy)) return false;
  const c = s.cells[idx(cx, cy)];
  if (c === HARD) return false;
  if ((c === SOFT || c === BURN) && !ENEMY[e.type].wall) return false;
  return !bombAt(s, cx, cy);
}

function chooseDir(s, e) {
  const kind = ENEMY[e.type];
  const open = [0, 1, 2, 3].filter((d) => enemyCan(s, e, e.tx + DX[d], e.ty + DY[d]));
  if (!open.length) return -1;
  if (kind.smart && rnd(s) < kind.smart) {
    let target = null, best = 1e9;
    for (const p of s.players) {
      if (!p.alive) continue;
      const [px, py] = cellOf(p.x, p.y);
      const dist = Math.abs(px - e.tx) + Math.abs(py - e.ty);
      if (dist < best) { best = dist; target = [px, py]; }
    }
    if (target && best <= 10) {
      const toward = open.filter((d) => Math.abs(target[0] - e.tx - DX[d]) + Math.abs(target[1] - e.ty - DY[d]) < best);
      if (toward.length) return toward[pick(s, toward.length)];
    }
  }
  if (open.includes(e.dir) && rnd(s) >= kind.turn) return e.dir;
  const fresh = open.filter((d) => d !== (e.dir + 2) % 4);
  const list = fresh.length ? fresh : open;
  return list[pick(s, list.length)];
}

function updateEnemies(s) {
  for (const e of s.enemies) {
    if (e.dead) { e.dead++; continue; }
    if (e.wait) { e.wait--; continue; }
    const kind = ENEMY[e.type];
    const atX = e.tx * TS, atY = e.ty * TS;
    if (e.x === atX && e.y === atY) {
      const d = chooseDir(s, e);
      if (d < 0) continue;
      e.dir = d;
      e.tx += DX[d];
      e.ty += DY[d];
    } else if (!enemyCan(s, e, e.tx, e.ty)) {
      // A bomb landed on the way: turn back to the cell we came from.
      e.dir = (e.dir + 2) % 4;
      e.tx += DX[e.dir];
      e.ty += DY[e.dir];
    }
    const gx = e.tx * TS, gy = e.ty * TS;
    e.x += Math.max(-kind.speed, Math.min(kind.speed, gx - e.x));
    e.y += Math.max(-kind.speed, Math.min(kind.speed, gy - e.y));
  }
  s.enemies = s.enemies.filter((e) => e.dead < 60);
}

// ---------- Hits ----------
function hits(s) {
  for (const e of s.enemies) {
    if (e.dead || e.wait) continue;
    const [cx, cy] = cellOf(e.x, e.y);
    const k = idx(cx, cy);
    if (s.fire[k]) {
      e.dead = 1;
      const by = s.players[s.fireBy[k]];
      if (by) { by.score += ENEMY[e.type].score; by.kills++; }
      s.events.push('kill');
    }
  }
  for (const p of s.players) {
    if (!p.alive) continue;
    const [cx, cy] = cellOf(p.x, p.y);
    if (s.fire[idx(cx, cy)] && !p.flamepass) killPlayer(s, p);
    for (const e of s.enemies) {
      if (!e.dead && !e.wait && Math.abs(e.x - p.x) < TS * 3 / 4 && Math.abs(e.y - p.y) < TS * 3 / 4) killPlayer(s, p);
    }
  }
}

// Time is up: the fastest enemies come out where nobody stands.
function hurryUp(s) {
  s.hurry = true;
  s.events.push('hurry');
  const free = [];
  for (let cy = 1; cy < ROWS - 1; cy++) {
    for (let cx = 1; cx < COLS - 1; cx++) {
      if (s.cells[idx(cx, cy)] !== EMPTY || bombAt(s, cx, cy)) continue;
      if (s.players.every((p) => { const [px, py] = cellOf(p.x, p.y); return Math.abs(px - cx) + Math.abs(py - cy) >= 6; })) free.push([cx, cy]);
    }
  }
  const alive = s.enemies.filter((e) => !e.dead).length;
  for (let k = 0; k < 6 && free.length && alive + k < MAX_ENEMIES; k++) {
    const i = pick(s, free.length);
    addEnemy(s, 7, free[i][0], free[i][1]);
    free.splice(i, 1);
  }
}

// ---------- Main step ----------
function step(s, inputs) {
  s.frame++;
  if (s.phase === 'intro') {
    if (++s.phaseT >= INTRO) { s.phase = 'play'; s.phaseT = 0; s.events.push('start'); }
    return;
  }
  if (s.phase === 'clearDone' || s.phase === 'overDone') return;
  if (s.phase === 'clear') { if (++s.phaseT >= 120) s.phase = 'clearDone'; return; }
  if (s.phase === 'over') { if (++s.phaseT >= 150) s.phase = 'overDone'; return; }
  const stage = s.stage;
  for (const p of s.players) {
    updatePlayer(s, p, (inputs && inputs[p.pi]) || NO_INPUT);
    // A death that restarted the stage (alone) or ended the game: nothing else this frame.
    if (s.phase !== 'play' || s.stage !== stage) return;
  }
  updateBombs(s);
  updateEnemies(s);
  if (s.duel && s.rules >= 2) shrinkField(s);
  hits(s);
  if (s.time > 0 && --s.time === 0 && !s.hurry) hurryUp(s);
}

root.BombSim = {
  COLS, ROWS, TILE, SUB, TS, EMPTY, HARD, SOFT, BURN, UP, RIGHT, DOWN, LEFT, DX, DY,
  FUSE, FLAME, DIE, INTRO, STAGE_TIME, ENEMY, ITEMS, STAGES, STARTS, MAX_PLAYERS, LIFE_STAGES,
  RULES, NEW_ITEMS, DUEL_ITEMS, SHRINK_AT, SHRINK_EVERY, SPIRAL, SLIDE, THROW,
  newGame, startStage, step, cellOf, explode,
};
})(typeof window !== 'undefined' ? window : globalThis);
