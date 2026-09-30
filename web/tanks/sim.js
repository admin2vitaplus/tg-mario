// Танкодром: game rules without any drawing or input.
// step(state, inputs) is deterministic (seeded random), so the same code can
// later run on both phones or on the server for the online mode.
(function (root) {
'use strict';

const CELL = 8;            // bricks break in 8x8 pieces
const N = 26;              // 26x26 cells = 13x13 tiles of 16px
const FIELD = N * CELL;    // 208px
const EMPTY = 0, BRICK = 1, STEEL = 2, WATER = 3, FOREST = 4, ICE = 5, BASE = 6;
const UP = 0, RIGHT = 1, DOWN = 2, LEFT = 3;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

// Speeds are binary fractions so positions stay exact.
const ENEMY = [
  { speed: 0.5, bullet: 2, hp: 1, score: 100 },     // обычный
  { speed: 1.25, bullet: 2.5, hp: 1, score: 200 },  // быстрый
  { speed: 0.625, bullet: 4, hp: 1, score: 300 },   // скорострельный
  { speed: 0.5, bullet: 2.5, hp: 4, score: 400 },   // броневик
];
const PLAYER_SPEED = 1;
const BONUSES = ['helmet', 'clock', 'shovel', 'star', 'grenade', 'tank'];
// Enemies per stage: [обычные, быстрые, скорострельные, броневики].
const WAVES = [[18, 2, 0, 0], [14, 4, 0, 2], [10, 4, 4, 2], [6, 6, 4, 4], [4, 6, 4, 6], [2, 6, 6, 6]];
const FLASH_AT = [3, 10, 17]; // these enemies carry a bonus
const PLAYER_SPAWN = [[64, 192], [128, 192]];
const ENEMY_SPAWN_X = [96, 192, 0];
const BASE_WALL = [[11, 23], [11, 24], [11, 25], [12, 23], [13, 23], [14, 23], [14, 24], [14, 25]];

// Maps are 13x13 tiles: # кирпич, @ сталь, ~ вода, % лес, - лёд.
// Spawn points and the base corner are cleared automatically.
const MAPS = [
  { name: 'Перекрёсток', rows: [
    '.............',
    '.#.#.#.#.#.#.',
    '.#.#.#.#.#.#.',
    '.#.#.#@#.#.#.',
    '.#.#.....#.#.',
    '.....#.#.....',
    '@.##.....##.@',
    '.....#.#.....',
    '.#.#.###.#.#.',
    '.#.#.#.#.#.#.',
    '.#.#.....#.#.',
    '.#.........#.',
    '.............',
  ] },
  { name: 'Река', rows: [
    '.............',
    '..##.....##..',
    '..##.@.@.##..',
    '.....~.~.....',
    '%%...~.~...%%',
    '%%##.....##%%',
    '~~~~.#.#.~~~~',
    '....%...%....',
    '.##.%.@.%.##.',
    '.##.......##.',
    '...#.###.#...',
    '.#.#.....#.#.',
    '.#.........#.',
  ] },
  { name: 'Лёд и сталь', rows: [
    '.............',
    '.@@..#.#..@@.',
    '.....#.#.....',
    '.##.-----.##.',
    '.##.-###-.##.',
    '....-#@#-....',
    '@@..-###-..@@',
    '....-----....',
    '.%%%.....%%%.',
    '.%#%.#.#.%#%.',
    '.%%%.#.#.%%%.',
    '.#.........#.',
    '.............',
  ] },
  { name: 'Лабиринт', rows: [
    '.............',
    '.####.#.####.',
    '.#....#....#.',
    '.#.##...##.#.',
    '.#.#..@..#.#.',
    '...#.###.#...',
    '@#.........#@',
    '...#.###.#...',
    '.#.#..%..#.#.',
    '.#.##.%.##.#.',
    '.#....%....#.',
    '.###.....###.',
    '.............',
  ] },
  { name: 'Крепость', rows: [
    '.............',
    '..@.......@..',
    '.###.###.###.',
    '.#~#.#.#.#~#.',
    '.###.#.#.###.',
    '......%......',
    '%%@@.%%%.@@%%',
    '......%......',
    '~~.###.###.~~',
    '...#.....#...',
    '.#.#.@.@.#.#.',
    '.#.........#.',
    '.............',
  ] },
];

// ---------- Helpers ----------
function rnd(s) {
  s.seed = (s.seed + 0x6D2B79F5) | 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function parseMap(rows) {
  const cells = new Uint8Array(N * N);
  const code = { '#': BRICK, '@': STEEL, '~': WATER, '%': FOREST, '-': ICE };
  const fill = (tx, ty, v) => {
    for (let k = 0; k < 4; k++) cells[(ty * 2 + (k >> 1)) * N + tx * 2 + (k & 1)] = v;
  };
  for (let ty = 0; ty < 13; ty++) {
    for (let tx = 0; tx < 13; tx++) fill(tx, ty, code[(rows[ty] || '')[tx]] || EMPTY);
  }
  for (const [tx, ty] of [[0, 0], [6, 0], [12, 0], [4, 12], [8, 12]]) fill(tx, ty, EMPTY);
  for (let tx = 5; tx <= 7; tx++) for (let ty = 11; ty <= 12; ty++) fill(tx, ty, EMPTY);
  for (const [x, y] of BASE_WALL) cells[y * N + x] = BRICK;
  for (const x of [12, 13]) for (const y of [24, 25]) cells[y * N + x] = BASE;
  return cells;
}

const overlap = (ax, ay, bx, by) => ax < bx + 16 && ax + 16 > bx && ay < by + 16 && ay + 16 > by;
const solidForTank = (c) => c === BRICK || c === STEEL || c === WATER || c === BASE;

function tanks(s) {
  const list = [];
  for (const p of s.players) if (p.tank) list.push(p.tank);
  for (const e of s.enemies) if (!e.dead) list.push(e);
  return list;
}

function boxCells(x, y, w, h, fn) {
  const x0 = Math.max(0, Math.floor(x / CELL)), x1 = Math.min(N - 1, Math.floor((x + w - 0.001) / CELL));
  const y0 = Math.max(0, Math.floor(y / CELL)), y1 = Math.min(N - 1, Math.floor((y + h - 0.001) / CELL));
  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) if (fn(cx, cy)) return true;
  }
  return false;
}

function blockedAt(s, t, x, y) {
  if (x < 0 || y < 0 || x > FIELD - 16 || y > FIELD - 16) return true;
  if (boxCells(x, y, 16, 16, (cx, cy) => solidForTank(s.cells[cy * N + cx]))) return true;
  for (const o of tanks(s)) {
    if (o !== t && overlap(x, y, o.x, o.y) && !overlap(t.x, t.y, o.x, o.y)) return true;
  }
  return false;
}

function occupied(s, x, y) {
  return tanks(s).some((o) => overlap(x, y, o.x, o.y));
}

function onIce(s, t) {
  return boxCells(t.x + 4, t.y + 4, 8, 8, (cx, cy) => s.cells[cy * N + cx] === ICE);
}

// ---------- Game setup ----------
function newGame(players, seed) {
  const s = { seed: seed | 0, frame: 0, twoP: players === 2, players: [], events: [] };
  for (let i = 0; i < players; i++) {
    s.players.push({ pi: i, lives: 3, level: 0, score: 0, tank: null, respawn: 0, kills: [0, 0, 0, 0] });
  }
  startStage(s, 0);
  return s;
}

function startStage(s, n) {
  const map = MAPS[n % MAPS.length];
  s.stage = n;
  s.mapName = map.name;
  s.cells = parseMap(map.rows);
  s.baseAlive = true;
  s.enemies = [];
  s.bullets = [];
  s.booms = [];
  s.spawns = [];
  s.bonus = null;
  s.freeze = 0;
  s.shovel = 0;
  s.nextId = 1;
  const queue = [];
  WAVES[Math.min(n, WAVES.length - 1)].forEach((count, type) => {
    for (let i = 0; i < count; i++) queue.push(type);
  });
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(rnd(s) * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  s.queue = queue;
  s.total = queue.length;
  s.spawned = 0;
  s.spawnStarts = 0;
  s.spawnTimer = 0;
  s.spawnPoint = 0;
  s.phase = 'intro';
  s.phaseT = 0;
  for (const p of s.players) {
    p.kills = [0, 0, 0, 0];
    p.tank = null;
    p.respawn = p.lives > 0 ? 1 : 0;
  }
}

function makeTank(s, x, y, dir, side, type, pi) {
  return {
    id: s.nextId++, x, y, dir, side, type, pi,
    hp: side === 'e' ? ENEMY[type].hp : 1,
    speed: side === 'e' ? ENEMY[type].speed : PLAYER_SPEED,
    anim: 0, shield: 0, stun: 0, slide: 0, flash: false, aiT: 0, want: DOWN, dead: false,
  };
}

// ---------- Movement ----------
function move(s, t, dir) {
  if (dir !== t.dir) {
    // Turning onto the other axis lines the tank up with the 8px grid.
    if ((dir & 1) !== (t.dir & 1)) {
      const key = dir & 1 ? 'y' : 'x';
      const v = t[key];
      const r = Math.round(v / CELL) * CELL;
      if (r !== v) {
        for (const c of [r, r > v ? r - CELL : r + CELL]) {
          if (!blockedAt(s, t, key === 'x' ? c : t.x, key === 'y' ? c : t.y)) { t[key] = c; break; }
        }
      }
    }
    t.dir = dir;
  }
  const nx = t.x + DX[dir] * t.speed;
  const ny = t.y + DY[dir] * t.speed;
  if (!blockedAt(s, t, nx, ny)) { t.x = nx; t.y = ny; return true; }
  // Creep up to the wall so the tank ends up grid-aligned.
  const key = dir & 1 ? 'x' : 'y';
  const sign = dir === RIGHT || dir === DOWN ? 1 : -1;
  const a = sign > 0 ? Math.ceil(t[key] / CELL) * CELL : Math.floor(t[key] / CELL) * CELL;
  if (a !== t[key] && !blockedAt(s, t, key === 'x' ? a : t.x, key === 'y' ? a : t.y)) {
    t[key] = a;
    return true;
  }
  return false;
}

// ---------- Shooting ----------
function fire(s, t) {
  let max = 1, speed, power = false;
  if (t.side === 'p') {
    const lv = s.players[t.pi].level;
    speed = lv >= 1 ? 4 : 2.5;
    if (lv >= 2) max = 2;
    power = lv >= 3;
  } else {
    speed = ENEMY[t.type].bullet;
  }
  if (s.bullets.filter((b) => b.owner === t.id && !b.dead).length >= max) return;
  s.bullets.push({
    owner: t.id, side: t.side, pi: t.pi, dir: t.dir, speed, power, dead: false,
    x: t.x + 8 + DX[t.dir] * 6, y: t.y + 8 + DY[t.dir] * 6,
  });
  if (t.side === 'p') s.events.push('fire');
}

function boom(s, x, y, big) {
  s.booms.push({ x, y, big, t: 0 });
}

function destroyBase(s) {
  if (!s.baseAlive) return;
  s.baseAlive = false;
  boom(s, 104, 200, true);
  s.events.push('base');
}

function setWalls(s, v) {
  const all = tanks(s);
  for (const [x, y] of BASE_WALL) {
    const busy = all.some((t) => x * CELL < t.x + 16 && x * CELL + CELL > t.x && y * CELL < t.y + 16 && y * CELL + CELL > t.y);
    if (!busy) s.cells[y * N + x] = v;
  }
}

function killPlayer(s, t) {
  const p = s.players[t.pi];
  t.dead = true;
  p.tank = null;
  p.lives--;
  p.level = 0;
  if (p.lives > 0) p.respawn = 90;
  boom(s, t.x + 8, t.y + 8, true);
  s.events.push('pdie');
}

function hitEnemy(s, e, pi) {
  if (e.flash) { e.flash = false; spawnBonus(s); }
  if (--e.hp > 0) { s.events.push('armor'); return; }
  e.dead = true;
  const p = s.players[pi];
  if (p) { p.score += ENEMY[e.type].score; p.kills[e.type]++; }
  boom(s, e.x + 8, e.y + 8, true);
  s.events.push('kill');
}

function bulletStep(s, b, all) {
  if (b.x < 2 || b.y < 2 || b.x > FIELD - 2 || b.y > FIELD - 2) {
    b.dead = true;
    boom(s, b.x, b.y, false);
    if (b.side === 'p') s.events.push('steel');
    return;
  }
  const hits = [];
  boxCells(b.x - 2, b.y - 2, 4, 4, (cx, cy) => {
    const c = s.cells[cy * N + cx];
    if (c === BRICK || c === STEEL || c === BASE) hits.push([cx, cy, c]);
    return false;
  });
  if (hits.length) {
    b.dead = true;
    boom(s, b.x, b.y, false);
    if (hits.some((h) => h[2] === BASE)) { destroyBase(s); return; }
    // The wall face nearest to the shooter takes the hit, across the whole shell width.
    const vertical = !(b.dir & 1);
    const pick = (b.dir === UP || b.dir === LEFT) ? Math.max : Math.min;
    const line = pick(...hits.map((h) => (vertical ? h[1] : h[0])));
    const centre = vertical ? b.x : b.y;
    const from = Math.floor((centre - 6) / CELL), to = Math.floor((centre + 5.999) / CELL);
    let broke = false, clank = false;
    for (let i = Math.max(0, from); i <= Math.min(N - 1, to); i++) {
      const idx = vertical ? line * N + i : i * N + line;
      const c = s.cells[idx];
      if (c === BRICK) { s.cells[idx] = EMPTY; broke = true; }
      else if (c === STEEL) {
        if (b.power) { s.cells[idx] = EMPTY; broke = true; } else clank = true;
      } else if (c === BASE) destroyBase(s);
    }
    if (b.side === 'p') {
      if (broke) s.events.push('brick');
      else if (clank) s.events.push('steel');
    }
    return;
  }
  for (const t of all) {
    if (t.id === b.owner || t.dead) continue;
    if (b.x + 2 <= t.x || b.x - 2 >= t.x + 16 || b.y + 2 <= t.y || b.y - 2 >= t.y + 16) continue;
    if (b.side === 'e' && t.side === 'e') continue; // enemy shells pass through enemies
    b.dead = true;
    boom(s, b.x, b.y, false);
    if (b.side === 'e') {
      if (!t.shield) killPlayer(s, t);
    } else if (t.side === 'e') {
      hitEnemy(s, t, b.pi);
    } else if (!t.shield) {
      t.stun = 150; // friendly fire freezes the partner for a moment
      s.events.push('stun');
    }
    return;
  }
}

function updateBullets(s) {
  const all = tanks(s);
  for (const b of s.bullets) {
    const n = Math.ceil(b.speed / 2);
    for (let i = 0; i < n && !b.dead; i++) {
      b.x += (DX[b.dir] * b.speed) / n;
      b.y += (DY[b.dir] * b.speed) / n;
      bulletStep(s, b, all);
    }
  }
  // Shells of the two sides cancel each other out.
  for (let i = 0; i < s.bullets.length; i++) {
    const a = s.bullets[i];
    if (a.dead) continue;
    for (let j = i + 1; j < s.bullets.length; j++) {
      const b = s.bullets[j];
      if (b.dead || a.side === b.side) continue;
      if (Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4) { a.dead = b.dead = true; break; }
    }
  }
  s.bullets = s.bullets.filter((b) => !b.dead);
}

// ---------- Bonuses ----------
function spawnBonus(s) {
  let x = 0, y = 0;
  for (let i = 0; i < 30; i++) {
    x = Math.floor(rnd(s) * 25) * CELL;
    y = Math.floor(rnd(s) * 23) * CELL;
    if (!(y >= 168 && x > 72 && x < 120)) break;
  }
  s.bonus = { x, y, type: BONUSES[Math.floor(rnd(s) * BONUSES.length)], t: 0 };
  s.events.push('bonus');
}

function takeBonus(s, p, t) {
  const b = s.bonus;
  s.bonus = null;
  p.score += 500;
  s.events.push('pick');
  switch (b.type) {
    case 'helmet': t.shield = 600; break;
    case 'clock': s.freeze = 600; break;
    case 'shovel': setWalls(s, STEEL); s.shovel = 1200; break;
    case 'star': p.level = Math.min(3, p.level + 1); break;
    case 'grenade':
      for (const e of s.enemies) {
        if (!e.dead) { e.dead = true; boom(s, e.x + 8, e.y + 8, true); }
      }
      s.events.push('kill');
      break;
    case 'tank': p.lives++; s.events.push('life'); break;
  }
}

// ---------- Players ----------
const NO_INPUT = { dir: -1, fire: false };

function updatePlayer(s, p, inp) {
  if (!p.tank) {
    if (p.respawn > 0 && --p.respawn === 0) {
      const [x, y] = PLAYER_SPAWN[p.pi];
      if (occupied(s, x, y)) { p.respawn = 1; return; }
      p.tank = makeTank(s, x, y, UP, 'p', 0, p.pi);
      p.tank.shield = 180;
    }
    return;
  }
  const t = p.tank;
  if (t.shield > 0) t.shield--;
  if (t.stun > 0) { t.stun--; return; }
  let dir = inp.dir;
  if (dir < 0 && t.slide > 0) { t.slide--; dir = t.dir; }
  if (dir >= 0) {
    if (move(s, t, dir)) t.anim++;
    if (inp.dir >= 0) t.slide = onIce(s, t) ? 24 : 0;
  }
  if (inp.fire) fire(s, t);
  const b = s.bonus;
  if (b && t.x < b.x + 12 && t.x + 12 > b.x && t.y < b.y + 12 && t.y + 12 > b.y) takeBonus(s, p, t);
}

// ---------- Enemies ----------
function pickDir(s, e) {
  const r = rnd(s);
  if (r < 0.25) return DOWN;
  if (r < 0.5) {
    let tx = 96, ty = 192;
    const hunted = s.players.filter((p) => p.tank);
    if (hunted.length && rnd(s) < 0.5) {
      const t = hunted[Math.floor(rnd(s) * hunted.length)].tank;
      tx = t.x; ty = t.y;
    }
    const dx = tx - e.x, dy = ty - e.y;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? RIGHT : LEFT;
    return dy > 0 ? DOWN : UP;
  }
  return Math.floor(rnd(s) * 4);
}

function updateEnemies(s, spawning) {
  const cap = s.twoP ? 6 : 4;
  if (spawning && s.queue.length > s.spawns.length && s.enemies.length + s.spawns.length < cap) {
    if (--s.spawnTimer <= 0) {
      const x = ENEMY_SPAWN_X[s.spawnPoint];
      if (!occupied(s, x, 0)) {
        s.spawns.push({ x, y: 0, t: 0 });
        s.spawnPoint = (s.spawnPoint + 1) % ENEMY_SPAWN_X.length;
        s.spawnStarts++;
        s.spawnTimer = s.spawnStarts < 3 ? 30 : Math.max(50, 170 - s.stage * 12);
      }
    }
  }
  for (const sp of s.spawns) {
    if (++sp.t < 60 || occupied(s, sp.x, sp.y)) continue;
    sp.done = true;
    const e = makeTank(s, sp.x, sp.y, DOWN, 'e', s.queue.shift(), -1);
    e.flash = FLASH_AT.includes(s.spawned++);
    s.enemies.push(e);
  }
  s.spawns = s.spawns.filter((sp) => !sp.done);
  if (s.freeze > 0) return;
  for (const e of s.enemies) {
    if (e.dead) continue;
    if (--e.aiT <= 0) {
      e.aiT = 32 + Math.floor(rnd(s) * 96);
      e.want = pickDir(s, e);
    }
    const moved = move(s, e, e.want);
    if (moved) e.anim++;
    else if (rnd(s) < 1 / 12) e.want = pickDir(s, e);
    if (rnd(s) < (moved ? 1 / 56 : 1 / 14)) fire(s, e);
  }
}

// ---------- One frame (60 per second) ----------
function step(s, inputs) {
  s.frame++;
  if (s.phase === 'intro') {
    if (++s.phaseT >= 100) { s.phase = 'play'; s.phaseT = 0; s.events.push('start'); }
    return;
  }
  if (s.phase === 'overDone' || s.phase === 'clearDone') return;
  for (const p of s.players) {
    updatePlayer(s, p, s.phase === 'over' ? NO_INPUT : (inputs && inputs[p.pi]) || NO_INPUT);
  }
  updateEnemies(s, s.phase === 'play');
  updateBullets(s);
  s.enemies = s.enemies.filter((e) => !e.dead);
  for (const b of s.booms) b.t++;
  s.booms = s.booms.filter((b) => b.t < (b.big ? 28 : 12));
  if (s.bonus && ++s.bonus.t > 1200) s.bonus = null;
  if (s.freeze > 0) s.freeze--;
  if (s.shovel > 0 && --s.shovel === 0) setWalls(s, BRICK);
  if (s.phase === 'play') {
    if (!s.baseAlive || s.players.every((p) => p.lives <= 0 && !p.tank)) {
      s.phase = 'over';
      s.phaseT = 0;
      s.events.push('over');
    } else if (!s.queue.length && !s.enemies.length && !s.spawns.length) {
      s.phase = 'clear';
      s.phaseT = 0;
    }
  } else if (s.phase === 'over') {
    if (++s.phaseT >= 200) s.phase = 'overDone';
  } else if (s.phase === 'clear') {
    if (++s.phaseT >= 150) s.phase = 'clearDone';
  }
}

root.TankSim = {
  CELL, N, FIELD, EMPTY, BRICK, STEEL, WATER, FOREST, ICE, BASE, UP, RIGHT, DOWN, LEFT,
  ENEMY, MAPS, newGame, startStage, step,
};
})(typeof window !== 'undefined' ? window : globalThis);
