(() => {
'use strict';

// Retro 8-bit resolution: 16 tiles wide, 15 tiles high.
const TILE = 16;
const VIEW_W = 256;
const VIEW_H = 240;
const BEST_KEY = 'prygskok_best';

// ---------- Telegram ----------
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast('6.1')) {
      tg.setHeaderColor('#000000');
      tg.setBackgroundColor('#000000');
    }
    if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes();
  } catch (e) { /* not inside Telegram */ }
}

// Server scores and achievements (api.js). The stub keeps the game working without it.
const api = window.GameAPI || { track() {}, levelDone() {}, runDone() { return Promise.resolve(null); }, newRun() {} };

function haptic(kind) {
  try {
    if (!tg || !tg.HapticFeedback) return;
    if (kind === 'success' || kind === 'error') tg.HapticFeedback.notificationOccurred(kind);
    else tg.HapticFeedback.impactOccurred(kind);
  } catch (e) { /* ignore */ }
}

// ---------- Sound (generated, no audio files) ----------
let actx = null;
function audio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}

function tone(f1, f2, dur, type = 'square', vol = 0.08, delay = 0) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const notes = (list, step, dur) => list.forEach((f, i) => tone(f, 0, dur, 'square', 0.07, i * step));
const SFX = {
  jump: () => tone(300, 700, 0.18),
  coin: () => { tone(988, 0, 0.08); tone(1319, 0, 0.3, 'square', 0.08, 0.08); },
  stomp: () => tone(400, 100, 0.12),
  bump: () => tone(160, 80, 0.08, 'triangle', 0.2),
  brick: () => tone(200, 50, 0.2, 'sawtooth', 0.1),
  sprout: () => tone(200, 800, 0.4, 'triangle', 0.15),
  power: () => notes([523, 659, 784, 1047], 0.07, 0.1),
  hurt: () => tone(600, 150, 0.35),
  fire: () => tone(900, 300, 0.08, 'square', 0.06),
  life: () => notes([659, 784, 1319, 1047, 1175, 1568], 0.08, 0.1),
  die: () => notes([660, 550, 440, 330, 220], 0.13, 0.15),
  win: () => notes([523, 659, 784, 1047, 784, 1047], 0.12, 0.15),
};

// ---------- Input ----------
const touch = { up: false, down: false, left: false, right: false, a: false, b: false, turboA: false, turboB: false, bPressed: false };
const WORLD_GRAVITY = 1100;
// [gravity while A is held and rising, gravity otherwise] for slow, medium and fast take-offs.
const JUMP_GRAVITY = [[450, 1575], [422, 1350], [562, 2025]];
const TURBO_MS = 67; // about 7.5 presses per second, like a turbo button

// Both pads track every finger by pointerId and work out the pressed buttons
// from where the fingers are, so a thumb can slide or roll between buttons
// without losing a press, and any number of fingers can be down at once.
function bindControls() {
  // Cross d-pad: the direction comes from where the thumb is relative to the
  // center, so sliding the thumb switches direction and diagonals press two.
  const dpad = document.getElementById('dpad');
  const dirs = ['up', 'down', 'left', 'right'];
  const btn = {};
  for (const dir of dirs) btn[dir] = dpad.querySelector('.' + dir);
  trackPointers(dpad, (points, r) => {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dead = r.width * 0.12;
    const on = { up: false, down: false, left: false, right: false };
    for (const [x, y] of points) {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.hypot(dx, dy) < dead) continue;
      if (Math.abs(dx) > Math.abs(dy) * 0.5) on[dx < 0 ? 'left' : 'right'] = true;
      if (Math.abs(dy) > Math.abs(dx) * 0.5) on[dy < 0 ? 'up' : 'down'] = true;
    }
    for (const dir of dirs) setKey(dir, on[dir], btn[dir]);
  });

  // Two-button retro pad: A jumps, B runs while held and fires on each press.
  // Turbo buttons act as A/B pressed and released many times a second.
  // A finger presses every button within reach (the button plus a margin),
  // so a thumb in the gap between B and A holds both: run and jump high.
  const actions = document.getElementById('actions');
  const pads = [['btnA', 'a'], ['btnB', 'b'], ['btnTA', 'turboA'], ['btnTB', 'turboB']]
    .map(([id, key]) => ({ el: document.getElementById(id), key }));
  trackPointers(actions, (points) => {
    for (const p of pads) {
      const r = p.rect;
      const m = r.width * 0.22;
      const on = points.some(([x, y]) => x > r.left - m && x < r.right + m && y > r.top - m && y < r.bottom + m);
      if (on && !touch[p.key] && p.key === 'b') touch.bPressed = true;
      setKey(p.key, on, p.el);
    }
  }, () => { for (const p of pads) p.rect = p.el.getBoundingClientRect(); });
}

function setKey(key, on, el) {
  if (touch[key] === on) return;
  touch[key] = on;
  el.classList.toggle('on', on);
}

// Calls update(points, rect) whenever a finger on `el` goes down, moves or lifts.
// Layout is measured once per new finger, not on every move.
function trackPointers(el, update, measure) {
  const pointers = new Map();
  let rect = null;
  const run = () => update([...pointers.values()], rect);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    rect = el.getBoundingClientRect();
    if (measure) measure();
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    run();
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    run();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    el.addEventListener(name, (e) => {
      if (!pointers.delete(e.pointerId)) return;
      run();
    });
  }
}

// ---------- HUD and overlay ----------
const $ = (id) => document.getElementById(id);

function hud(s) {
  $('score').textContent = String(s.score).padStart(6, '0');
  $('coins').textContent = '×' + String(s.coins).padStart(2, '0');
  $('lives').textContent = String(s.lives);
  $('time').textContent = String(Math.max(0, s.timeLeft)).padStart(3, '0');
  $('world').textContent = '1-' + (s.level + 1);
}

function loadBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; }
}

function saveBest(score) {
  const best = Math.max(loadBest(), score);
  try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
  return best;
}

let overlayAction = null;
function showOverlay(title, text, button, action) {
  $('ovTitle').textContent = title;
  $('ovText').innerHTML = text;
  $('ovBtn').textContent = button;
  $('ovHint').style.display = 'none';
  $('overlay').classList.remove('hidden');
  overlayAction = action;
}

// ---------- Textures (all pixel art is drawn in code) ----------
const PAL = {
  K: '#222222', W: '#ffffff', C: '#1fa2a8', S: '#f8b878', R: '#d82800',
  J: '#f8d020', P: '#2848a8', B: '#6b3a10',
  E: '#b83010', O: '#f08030', Y: '#f8d878',
  G: '#107010', L: '#58d858', N: '#30b030', F: '#e04020', V: '#c02070', D: '#801050',
  Q: '#f8c030', U: '#c07000',
};

function drawRows(ctx, rows, scale, pal) {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  });
}

// A fresh canvas texture; an old one with the same key is dropped, so looks can be redrawn.
function canvasTex(scene, key, w, h) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  return scene.textures.createCanvas(key, w, h);
}

function pix(scene, key, rows, scale = 1, pal = PAL) {
  const w = Math.max(...rows.map((r) => r.length));
  const c = canvasTex(scene, key, w * scale, rows.length * scale);
  const ctx = c.getContext();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  c.refresh();
}

const HEAD = [
  '................',
  '.....CCCCCC.....',
  '....CCCCCCCCCC..',
  '....KKKKKKKK....',
  '....SSSSSSSS....',
  '....SSKSSKSS....',
  '....SSSSSSSS....',
  '.....SSRRSS.....',
];
const SMALL_BODY = [
  '....JJJJJJJJ....',
  '...JJJJJJJJJJ...',
  '..SSJJJJJJJJSS..',
  '..SS.JJJJJJ.SS..',
];
const SMALL_BODY_JUMP = [
  '.SS.JJJJJJJJ.SS.',
  '..SSJJJJJJJJSS..',
  '....JJJJJJJJ....',
  '.....JJJJJJ.....',
];
const SMALL_LEGS = [
  '.....PPPPPP.....',
  '.....PP..PP.....',
  '....BBB..BBB....',
  '....BBB..BBB....',
];
const SMALL_LEGS_WALK = [
  '.....PPPPPP.....',
  '....PP....PP....',
  '...BBB....BBB...',
  '..BBB......BBB..',
];
const BIG_BODY = [
  '....JJJJJJJJ....',
  '...JJJJJJJJJJ...',
  '..JJJJJJJJJJJJ..',
  '..JJJJJWJJJJJJ..',
  '..JJJJJJJJJJJJ..',
  '..SSJJJJJWJJSS..',
  '..SSJJJJJJJJSS..',
  '..SS.PPPPPP.SS..',
  '.....PPPPPP.....',
  '....PPPPPPPP....',
  '....PPPPPPPP....',
];
const BIG_BODY_JUMP = [
  '.SS.JJJJJJJJ.SS.',
  '..SSJJJJJJJJSS..',
  '..JJJJJJJJJJJJ..',
  '..JJJJJWJJJJJJ..',
  '..JJJJJJJJJJJJ..',
  '...JJJJJJWJJJ...',
  '...JJJJJJJJJJ...',
  '....PPPPPPPP....',
  '.....PPPPPP.....',
  '....PPPPPPPP....',
  '....PPPPPPPP....',
];
const BIG_LEGS = [
  '....PPP..PPP....',
  '....PPP..PPP....',
  '....PP....PP....',
  '...BBBB..BBBB...',
  '...BBBB..BBBB...',
];
const BIG_LEGS_WALK = [
  '...PPP....PPP...',
  '..PPP......PPP..',
  '..PP........PP..',
  '.BBBB......BBBB.',
  '.BBBB......BBBB.',
];

const CROUCH = [
  ...Array(9).fill('................'),
  ...HEAD,
  '..SSJJJJJJJJSS..',
  '..SSJJJJJJJJSS..',
  '...PPPPPPPPPP...',
  '..PPPPPPPPPPPP..',
  '..PPPP....PPPP..',
  '.BBBBB....BBBBB.',
  '.BBBBB....BBBBB.',
];

const BUG_TOP = [
  '................',
  '................',
  '.....EEEEEE.....',
  '...EEEOEEOEEE...',
  '..EEOOOEEOOOEE..',
  '..EEOOOEEOOOEE..',
  '.EEEEEEEEEEEEEE.',
  '.EEEOEEEEEEOEEE.',
  '.EEEEEEEEEEEEEE.',
  '.KKWWKKKKKKWWKK.',
  '.KKWKKKKKKKKWKK.',
  '..KKKKKKKKKKKK..',
  '...YYYYYYYYYY...',
  '...YYYYYYYYYY...',
];

const BUG_LEGS = [
  ['..KK..KK..KK..KK', '.KK..KK..KK..KK.'],
  ['.KK..KK..KK..KK.', '..KK..KK..KK..KK'],
];

const BERRY = [
    '.......G........',
    '......GGG.......',
    '....LLGGGLL.....',
    '.....VVVVVV.....',
    '...VVVVVVVVVV...',
    '..VVWVVVVVVVVV..',
    '..VWWVVVVVVVVV..',
    '.VVVVVVVVVVVVVV.',
    '.VVVVVVVVVVVVVV.',
    '.VVVVVVVVVVVVDV.',
    '.VVVVVVVVVVVDDV.',
    '..VVVVVVVVVDDV..',
    '..VVVVVVVVVVVV..',
    '...VVVVVVVVVV...',
    '.....VVVVVV.....',
    '................',
];

function makeTextures(scene) {
  makeHeroTextures(scene);
  pix(scene, 'fireball', ['..FF..', '.FJJF.', 'FJWWJF', 'FJWWJF', '.FJJF.', '..FF..']);

  const foe = Object.assign({}, PAL, lookOf('enemy').pal);
  pix(scene, 'bug0', [...BUG_TOP, ...BUG_LEGS[0]], 1, foe);
  pix(scene, 'bug1', [...BUG_TOP, ...BUG_LEGS[1]], 1, foe);
  pix(scene, 'bugFlat', [
    ...Array(10).fill('................'),
    '..EEEEEEEEEEEE..',
    '.EEOOOEEEEOOOEE.',
    '.KKWWKKKKKKWWKK.',
    '..YYYYYYYYYYYY..',
    '.KK.KK.KK.KK.KK.',
    '................',
  ], 1, foe);

  pix(scene, 'coin', [
    '................',
    '......QQQQ......',
    '.....QWWQQQ.....',
    '....QWQQQQUQ....',
    '....QWQQQQUQ....',
    '....QWQQQQUQ....',
    '....QWQQQQUQ....',
    '....QWQQQQUQ....',
    '....QWQQQQUQ....',
    '....QWQQQQUQ....',
    '....QWQQQQUQ....',
    '....QWQQQQUQ....',
    '.....QQQQUU.....',
    '......UUUU......',
  ]);

  pix(scene, 'berry', BERRY);

  // Green berry gives an extra life: same shape, other colors.
  pix(scene, 'berry1', BERRY.map((r) => r.replace(/V/g, 'N').replace(/D/g, 'G')));

  pix(scene, 'debris', ['.UUU.', 'UOOOU', 'UOOOU', '.UUU.']);

  pix(scene, 'lavaball', [
    '......OO......',
    '....OOJJOO....',
    '...OJJWWJJO...',
    '..OJJWWWWJJO..',
    '..OJJWWWWJJO..',
    '.ROJJJWWJJJOR.',
    '.ROOJJJJJJOOR.',
    '..ROOJJJJOOR..',
    '..RROOOOOORR..',
    '...RROOOORR...',
    '....RR..RR....',
    '....R....R....',
    '...R......R...',
  ]);
  pix(scene, 'spark', ['..OO..', '.OJJO.', 'OJWWJO', 'OJWWJO', '.OJJO.', '..OO..']);
  // Castle boss: a big horned beetle, drawn at double size.
  const BOSS = [
    '....W......W....',
    '...WW......WW...',
    '...GGGGGGGGGG...',
    '..GGLLGGGGLLGG..',
    '.GGLLLLGGLLLLGG.',
    '.GGGGGGGGGGGGGG.',
    '.GWWKGGGGGGWWKG.',
    '.GWKKGGGGGGWKKG.',
    '.GGGGGGGGGGGGGG.',
    '..GRRRRRRRRRRG..',
    '..GRWRWRWRWRWG..',
    '...GGGGGGGGGG...',
    '..YYYYYYYYYYYY..',
    '.YYYYYYYYYYYYYY.',
  ];
  pix(scene, 'boss0', [...BOSS, '.KKK..KKKK..KKK.', 'KKK....KK....KKK'], 2);
  pix(scene, 'boss1', [...BOSS, '..KKK.KKKK.KKK..', '.KKK...KK...KKK.'], 2);
  pix(scene, 'bossFire', [
    '....OOOOJJ......',
    '..OOJJJJWWJJ....',
    'RROOJJWWWWWWJJ..',
    '..OOJJJJWWJJ....',
    '....OOOOJJ......',
  ]);
  pix(scene, 'lever', [
    '..........RR....',
    '.........RRRR...',
    '.........RRRR...',
    '..........RR....',
    '.........KK.....',
    '........KK......',
    '.......KK.......',
    '......KK........',
    '.....KK.........',
    '....KK..........',
    '...UUUUUUUU.....',
    '..UQQQQQQQQU....',
    '..UUUUUUUUUU....',
  ]);
  pix(scene, 'arrow', ['.WWWWW.', '.WWWWW.', 'WWWWWWW', '.WWWWW.', '..WWW..', '...W...']);

  for (const [key, colors] of Object.entries(TILESETS)) drawTiles(scene, key, colors);
  drawScenery(scene);
}

// Tileset: one row of 16x16 tiles, index = tile id.
const T = {
  GROUND: 0, BRICK: 1, BONUS: 2, USED: 3, HARD: 4, PIPE_TL: 5, PIPE_TR: 6, PIPE_L: 7, PIPE_R: 8, POLE: 9, POLE_TOP: 10,
  LAVA_TOP: 11, LAVA: 12, TREE_L: 13, TREE_M: 14, TREE_R: 15, TRUNK: 16, BRIDGE: 17,
  SIDE_LIP_T: 18, SIDE_LIP_B: 19, SIDE_T: 20, SIDE_B: 21,
};
const SOLID = [0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 17, 18, 19, 20, 21];
const TILE_COUNT = 22;
// Draw order: scenery, items rising out of blocks, tiles, items, enemies, hero.
const DEPTH = { SCENERY: -10, SPROUT: -5, TILES: 0, ITEM: 5, ENEMY: 6, HERO: 10 };

// Ground, brick and hard block colors per theme; the rest of the tiles are shared.
const TILESETS = {
  tiles: {
    g: ['#c0601c', '#f0a060', '#6b2a08'],
    b: ['#b85418', '#e89060', '#301000'],
    h: ['#8a4a20', '#e0a070', '#402008', '#a05a28'],
  },
  tilesCave: {
    g: ['#2060a8', '#80c0f0', '#082850'],
    b: ['#1c58a0', '#70b0e8', '#001030'],
    h: ['#306098', '#90c8f0', '#0c2448', '#4078b0'],
  },
  tilesCastle: {
    g: ['#8c8c8c', '#d8d8d8', '#3c3c3c'],
    b: ['#7c7c7c', '#c8c8c8', '#282828'],
    h: ['#6c6c6c', '#bcbcbc', '#303030', '#848484'],
  },
};

function drawTiles(scene, key, colors) {
  const count = TILE_COUNT;
  const { g, b, h } = colors;
  const p = lookOf('pipe').c;
  const c = canvasTex(scene, key, TILE * count, TILE);
  const ctx = c.getContext();
  const r = (i, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(i * TILE + x, y, w, h); };

  // ground
  r(0, 0, 0, 16, 16, g[0]);
  r(0, 0, 0, 16, 1, g[1]);
  r(0, 0, 7, 16, 1, g[2]);
  r(0, 7, 0, 1, 7, g[2]);
  r(0, 3, 8, 1, 8, g[2]);
  r(0, 11, 8, 1, 8, g[2]);
  r(0, 0, 15, 16, 1, g[2]);
  r(0, 2, 3, 1, 1, g[1]);
  r(0, 12, 11, 1, 1, g[1]);

  // brick
  r(1, 0, 0, 16, 16, b[0]);
  r(1, 0, 0, 16, 1, b[1]);
  for (const y of [3, 7, 11, 15]) r(1, 0, y, 16, 1, b[2]);
  for (const [y, xs] of [[0, [7, 15]], [4, [3, 11]], [8, [7, 15]], [12, [3, 11]]]) {
    for (const x of xs) r(1, x, y, 1, 3, b[2]);
  }

  // bonus block with "!"
  r(2, 0, 0, 16, 16, '#6b3a00');
  r(2, 0, 0, 15, 15, '#f8c838');
  r(2, 1, 1, 13, 13, '#e8a020');
  for (const [x, y] of [[2, 2], [12, 2], [2, 12], [12, 12]]) r(2, x, y, 1, 1, '#6b3a00');
  r(2, 7, 3, 2, 6, '#6b3a00');
  r(2, 7, 11, 2, 2, '#6b3a00');

  // used block
  r(3, 0, 0, 16, 16, '#4a2808');
  r(3, 1, 1, 14, 14, '#9a5a28');
  for (const [x, y] of [[2, 2], [12, 2], [2, 12], [12, 12]]) r(3, x, y, 1, 1, '#4a2808');

  // hard block
  r(4, 0, 0, 16, 16, h[0]);
  r(4, 0, 0, 16, 2, h[1]);
  r(4, 0, 0, 2, 16, h[1]);
  r(4, 14, 0, 2, 16, h[2]);
  r(4, 0, 14, 16, 2, h[2]);
  r(4, 4, 4, 8, 8, h[3]);

  // pipe lip left / right
  r(5, 0, 0, 16, 16, p[0]);
  r(5, 1, 1, 15, 14, p[1]);
  r(5, 4, 1, 3, 14, p[2]);
  r(6, 0, 0, 16, 16, p[0]);
  r(6, 0, 1, 15, 14, p[1]);
  r(6, 9, 1, 3, 14, p[3]);
  // pipe body left / right
  r(7, 2, 0, 14, 16, p[1]);
  r(7, 2, 0, 1, 16, p[0]);
  r(7, 5, 0, 3, 16, p[2]);
  r(8, 0, 0, 13, 16, p[1]);
  r(8, 13, 0, 1, 16, p[0]);
  r(8, 8, 0, 3, 16, p[3]);

  // flag pole and its top ball
  r(9, 7, 0, 2, 16, '#58d858');
  r(10, 7, 10, 2, 6, '#58d858');
  ctx.fillStyle = '#107010';
  ctx.beginPath();
  ctx.arc(10 * TILE + 8, 6, 4, 0, Math.PI * 2);
  ctx.fill();

  // lava surface and lava body (not solid: touching it is deadly)
  r(11, 0, 0, 16, 16, '#d82800');
  r(11, 0, 4, 16, 3, '#f08030');
  for (const x of [0, 8]) { r(11, x + 1, 2, 5, 2, '#f08030'); r(11, x + 2, 1, 3, 1, '#f8d020'); }
  r(12, 0, 0, 16, 16, '#d82800');
  r(12, 3, 5, 2, 1, '#f08030');
  r(12, 11, 11, 2, 1, '#f08030');

  // treetop caps (left, middle, right) and the trunk under them
  for (const i of [13, 14, 15]) {
    r(i, 0, 0, 16, 16, '#0a300a');
    r(i, 0, 1, 16, 15, '#30a030');
    r(i, 0, 1, 16, 2, '#80e060');
    r(i, 3, 7, 2, 2, '#107010');
    r(i, 10, 10, 2, 2, '#107010');
  }
  ctx.clearRect(13 * TILE, 0, 3, 3);
  ctx.clearRect(15 * TILE + 13, 0, 3, 3);
  r(13, 0, 3, 1, 13, '#0a300a');
  r(15, 15, 3, 1, 13, '#0a300a');
  r(16, 2, 0, 12, 16, '#b07830');
  r(16, 2, 0, 1, 16, '#603808');
  r(16, 13, 0, 1, 16, '#603808');
  for (const [x, y] of [[5, 2], [9, 7], [6, 12]]) r(16, x, y, 1, 3, '#603808');

  // castle bridge
  r(17, 0, 0, 16, 5, '#e0a070');
  r(17, 0, 0, 16, 1, '#fff0c0');
  for (const x of [0, 4, 8, 12]) r(17, x, 0, 1, 5, '#6b2a08');
  r(17, 0, 5, 16, 1, '#6b2a08');
  for (const x of [2, 10]) r(17, x, 6, 2, 4, '#8a8a8a');

  // side pipe: mouth (top/bottom) and body (top/bottom), opening to the left
  r(18, 0, 0, 16, 16, p[0]);
  r(18, 1, 1, 14, 15, p[1]);
  r(18, 1, 4, 14, 3, p[2]);
  r(19, 0, 0, 16, 16, p[0]);
  r(19, 1, 0, 14, 15, p[1]);
  r(19, 1, 9, 14, 3, p[3]);
  r(20, 0, 2, 16, 14, p[1]);
  r(20, 0, 2, 16, 1, p[0]);
  r(20, 0, 5, 16, 3, p[2]);
  r(21, 0, 0, 16, 13, p[1]);
  r(21, 0, 13, 16, 1, p[0]);
  r(21, 0, 8, 16, 3, p[3]);

  c.refresh();
  for (let i = 0; i < count; i++) c.add(i, 0, i * TILE, 0, TILE, TILE);
}

function drawScenery(scene) {
  let c = canvasTex(scene, 'cloud', 40, 20);
  let ctx = c.getContext();
  ctx.fillStyle = '#ffffff';
  for (const [x, y, rad] of [[10, 12, 7], [20, 8, 9], [30, 12, 7]]) {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(4, 12, 32, 7);
  c.refresh();

  const back = lookOf('back');
  c = canvasTex(scene, 'hill', back.w, back.h);
  back.paint(c.getContext(), night());
  c.refresh();

  // Night sky: stars and a moon, fixed to the screen.
  c = canvasTex(scene, 'stars', VIEW_W, 150);
  ctx = c.getContext();
  drawStars(ctx, VIEW_W, 150);
  c.refresh();

  c = canvasTex(scene, 'flag', 16, 16);
  ctx = c.getContext();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(16, 2);
  ctx.lineTo(0, 8);
  ctx.lineTo(16, 14);
  ctx.fill();
  ctx.fillStyle = '#1fa2a8';
  ctx.fillRect(9, 6, 4, 4);
  c.refresh();
}

// ---------- Levels ----------
// Chars: # ground, B brick, ? bonus (coin), M bonus (berry), L bonus (extra life), C brick with coins,
// H hard block, [ ] pipe lip, { } pipe body, o coin, e enemy, | pole, T pole top,
// ~ lava surface, = lava, f lava ball jumping from below, r fire bar around this block,
// ( - ) treetop cap, i tree trunk, _ castle bridge, q w side pipe mouth, z x side pipe body,
// h hidden block with an extra life, k hidden block with a coin (invisible until hit from below).
const TILE_OF = {
  '#': T.GROUND, 'B': T.BRICK, 'C': T.BRICK, '?': T.BONUS, 'M': T.BONUS, 'L': T.BONUS, 'H': T.HARD, 'r': T.HARD,
  '[': T.PIPE_TL, ']': T.PIPE_TR, '{': T.PIPE_L, '}': T.PIPE_R, '|': T.POLE, 'T': T.POLE_TOP,
  '~': T.LAVA_TOP, '=': T.LAVA, 'f': T.LAVA_TOP,
  '(': T.TREE_L, '-': T.TREE_M, ')': T.TREE_R, 'i': T.TRUNK, '_': T.BRIDGE,
  'q': T.SIDE_LIP_T, 'w': T.SIDE_LIP_B, 'z': T.SIDE_T, 'x': T.SIDE_B,
};

// A level is one wide grid split into areas (the main course, a bonus room, an exit
// outside). Each area has its own colors and camera limits; pipes move the hero between them.
function grid(W) {
  const H = 15;
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const put = (x, y, ch) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = ch; };
  const row = (x, y, s) => { [...s].forEach((ch, i) => { if (ch !== ' ') put(x + i, y, ch); }); };
  const fill = (x0, x1, y0, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, ch); };
  const L = {
    g, W, H, put, row, fill,
    areas: [],
    pipes: [],
    lifts: [],
    pipe(x, h) {
      const top = 13 - h;
      put(x, top, '['); put(x + 1, top, ']');
      for (let y = top + 1; y < 13; y++) { put(x, y, '{'); put(x + 1, y, '}'); }
    },
    // Pipe lying on its side with the mouth at (x, y..y+1), turning up into the ceiling.
    sidePipe(x, y, top) {
      put(x, y, 'q'); put(x, y + 1, 'w');
      put(x + 1, y, 'z'); put(x + 1, y + 1, 'x');
      for (let yy = top; yy <= y + 1; yy++) { put(x + 2, yy, '{'); put(x + 3, yy, '}'); }
    },
    column(x, h) { for (let y = 13 - h; y < 13; y++) put(x, y, 'H'); },
    stairsUp(x, n) { for (let i = 0; i < n; i++) L.column(x + i, i + 1); },
    stairsDown(x, n) { for (let i = 0; i < n; i++) L.column(x + i, n - i); },
    floor(ch = '#', x0 = 0, x1 = W - 1) { fill(x0, x1, 13, 14, ch); },
    gap(a, b, lava) {
      fill(a, b, 13, 14, '.');
      if (lava) { fill(a, b, 13, 13, '~'); fill(a, b, 14, 14, '='); }
    },
    tree(x, w, top) {
      put(x, top, '(');
      for (let i = 1; i < w - 1; i++) put(x + i, top, '-');
      put(x + w - 1, top, ')');
      const t0 = x + Math.floor((w - 1) / 2);
      const t1 = w >= 6 ? t0 + 1 : t0;
      fill(t0, t1, top + 1, 14, 'i');
    },
    enemies(xs, y = 12) { for (const x of xs) put(x, y, 'e'); },
    flagpole(x) {
      put(x, 3, 'T');
      for (let y = 4; y < 12; y++) put(x, y, '|');
      put(x, 12, 'H');
    },
    area(x0, x1, tiles, sky, scenery = 'none') { L.areas.push({ x0, x1, tiles, sky, scenery }); },
    done(extra) { return Object.assign({ grid: g, W, H, areas: L.areas, pipes: L.pipes, lifts: L.lifts }, extra); },
  };
  return L;
}

// 1-1 follows the classic rhythm: first blocks and a berry, four pipes of growing height
// (the last one leads down to a coin room), a hidden extra life, brick rows high up,
// block clusters, two pairs of staircases (the second over a pit) and a big staircase to the flag.
function levelField() {
  const L = grid(230);
  const { row, fill, pipe, column, stairsUp, stairsDown, put } = L;
  L.area(0, 212, 'tiles', '#6b8cff', 'field');
  L.area(214, 230, 'tilesCave', '#000000');
  L.floor('#', 0, 211);
  L.gap(69, 70);
  L.gap(86, 88);
  L.gap(153, 154);

  row(16, 9, '?');
  row(20, 9, 'BMB?B');
  row(22, 5, '?');
  pipe(28, 2);
  pipe(38, 3);
  pipe(46, 4);
  pipe(57, 4);
  put(64, 8, 'h');
  row(77, 9, 'BMB');
  row(80, 5, 'BBBBBBBB');
  row(91, 5, 'BBB?');
  row(94, 9, 'C');
  row(100, 9, 'BB');
  row(106, 9, '?  ?  ?');
  row(109, 5, 'M');
  row(118, 9, 'B');
  row(121, 5, 'BBB');
  row(128, 5, 'B??B');
  row(129, 9, 'BB');
  stairsUp(134, 4);
  stairsDown(140, 4);
  stairsUp(148, 4);
  column(152, 4);
  stairsDown(155, 4);
  pipe(163, 2);
  row(168, 9, 'BB?B');
  pipe(179, 2);
  stairsUp(181, 8);
  column(189, 8);
  L.flagpole(198);

  L.enemies([22, 40, 51, 53, 97, 99, 107, 114, 116, 124, 126, 128, 130, 174, 176]);
  L.enemies([81, 83], 4);

  // Coin room under the last tall pipe; its side pipe leads back up through the pipe near the end.
  L.floor('#', 214, 229);
  fill(214, 214, 2, 12, 'B');
  fill(214, 229, 1, 1, 'B');
  fill(217, 223, 10, 12, 'B');
  row(217, 9, 'ooooooo');
  row(217, 8, 'ooooooo');
  row(218, 6, 'ooooo');
  L.sidePipe(226, 11, 2);
  L.pipes.push({ type: 'down', x: 57, y: 9, to: { area: 1, x: 216, y: 3 } });
  L.pipes.push({ type: 'side', x: 226, y: 11, to: { area: 0, pipeX: 163, pipeY: 11 } });

  return L.done({ goal: 'pole', goalX: 198 });
}

// Underground: brick ceiling, low passages, lots of coins, lifts over a pit,
// then a side pipe up to the surface where the flag is.
function levelCave() {
  const L = grid(212);
  const { row, fill, pipe, column, stairsUp } = L;
  L.area(0, 178, 'tilesCave', '#000000');
  L.area(180, 212, 'tiles', '#6b8cff', 'field');
  L.floor('#', 0, 177);
  fill(0, 0, 1, 12, 'B');
  fill(6, 175, 1, 1, 'B');
  L.gap(46, 48);
  L.gap(98, 100);
  L.gap(122, 123);

  row(10, 9, 'M?????');
  row(18, 11, 'oo');
  stairsUp(27, 4);
  column(31, 4);
  column(32, 3);
  row(28, 6, 'oooo');
  fill(38, 43, 5, 6, 'B');
  row(38, 8, 'oooooo');
  row(39, 6, 'C');
  row(45, 9, 'BBBBB');
  fill(52, 53, 2, 8, 'B');
  row(52, 9, 'CB');
  row(56, 11, 'oooooo');
  fill(56, 63, 9, 9, 'B');
  row(56, 8, 'oooooooo');
  fill(66, 71, 2, 9, 'B');
  fill(66, 71, 5, 7, '.');
  row(66, 6, 'oooooo');
  row(73, 9, 'B?B');
  pipe(80, 3);
  row(84, 6, 'oooo');
  pipe(88, 4);
  row(92, 9, 'BMB');
  fill(94, 97, 3, 3, 'B');
  row(101, 9, 'BBB');
  row(101, 8, 'ooo');
  pipe(106, 2);
  row(110, 5, 'BBBBBBBBBB');
  row(110, 9, 'B?BCB?B');
  row(110, 8, 'ooooooo');
  column(118, 2);
  row(125, 9, 'oooo');
  fill(126, 129, 10, 10, 'H');
  stairsUp(136, 6);
  fill(142, 145, 7, 12, 'H');
  row(142, 6, 'oooo');

  // Pit with two lifts going up and down.
  L.gap(146, 157);
  L.lifts.push({ x: 148, y: 8, w: 3, axis: 'y', dist: 4, period: 4, phase: 0 });
  L.lifts.push({ x: 153, y: 8, w: 3, axis: 'y', dist: 4, period: 4, phase: 0.5 });
  row(160, 9, 'BB?BB');
  row(160, 8, 'ooooo');
  L.sidePipe(170, 11, 2);
  fill(174, 177, 1, 12, 'H');
  L.pipes.push({ type: 'side', x: 170, y: 11, to: { area: 1, pipeX: 182, pipeY: 11 } });

  // Outside: exit pipe, stairs and the flag.
  L.floor('#', 180, 211);
  pipe(182, 2);
  stairsUp(188, 8);
  column(196, 8);
  L.flagpole(204);

  L.enemies([16, 20, 35, 37, 58, 60, 62, 76, 84, 86, 96, 112, 114, 120, 131, 133, 163, 166]);
  return L.done({ goal: 'pole', goalX: 204 });
}

// Treetops: platforms high above a bottomless drop, with lifts between them.
function levelTrees() {
  const L = grid(180);
  const { row, tree } = L;
  L.area(0, 180, 'tiles', '#6b8cff', 'sky');
  L.floor('#', 0, 15);
  tree(17, 4, 11);
  tree(23, 6, 8);
  row(24, 5, 'oooo');
  tree(31, 3, 10);
  tree(36, 5, 7);
  tree(44, 7, 9);
  row(46, 5, '?M?');
  L.lifts.push({ x: 53, y: 9, w: 3, axis: 'x', dist: 5, period: 4, phase: 0 });
  tree(61, 5, 7);
  row(62, 4, 'ooo');
  tree(69, 4, 10);
  tree(76, 8, 7);
  row(77, 4, 'oooooo');
  L.lifts.push({ x: 87, y: 6, w: 3, axis: 'y', dist: 5, period: 3.5, phase: 0.25 });
  tree(92, 4, 8);
  row(93, 6, 'oo');
  tree(99, 6, 11);
  row(100, 8, '?  ?');
  L.lifts.push({ x: 107, y: 9, w: 3, axis: 'x', dist: 4, period: 3.5, phase: 0 });
  tree(115, 5, 7);
  row(116, 4, 'ooo');
  tree(122, 3, 9);
  tree(128, 6, 7);
  row(129, 4, 'oooo');
  L.lifts.push({ x: 136, y: 5, w: 3, axis: 'y', dist: 5, period: 3.5, phase: 0.75 });
  tree(141, 5, 9);
  L.floor('#', 148, 179);
  L.stairsUp(152, 4);
  L.flagpole(166);

  L.enemies([25], 7);
  L.enemies([38], 6);
  L.enemies([46, 48], 8);
  L.enemies([79, 81], 6);
  L.enemies([101], 10);
  L.enemies([130], 6);
  L.enemies([158, 161]);
  return L.done({ goal: 'pole', goalX: 166 });
}

// Castle: lava pits with jumping lava balls, rotating fire bars, and a bridge
// guarded by a big beetle. Pulling the lever at the far end drops the bridge.
function levelCastle() {
  const L = grid(200);
  const { row, fill, column, put } = L;
  L.area(0, 200, 'tilesCastle', '#000000');
  L.floor();
  fill(0, 145, 0, 2, 'H');
  fill(0, 5, 8, 12, 'H');
  fill(6, 15, 9, 12, 'H');
  L.gap(16, 19, true);
  put(18, 13, 'f');
  fill(20, 26, 9, 12, 'H');
  fill(27, 45, 3, 4, 'H');
  put(34, 8, 'r');
  put(30, 9, 'M');
  L.gap(46, 49, true);
  put(48, 13, 'f');
  fill(50, 54, 11, 12, 'H');
  row(58, 9, '? ? ?');
  L.gap(66, 69, true);
  put(67, 13, 'f');
  fill(70, 73, 10, 12, 'H');
  put(72, 10, 'r');
  fill(74, 90, 3, 5, 'H');
  row(78, 10, 'oooooo');
  put(86, 12, 'r');
  L.gap(92, 99, true);
  fill(95, 96, 10, 14, 'H');
  put(93, 13, 'f');
  put(98, 13, 'f');
  fill(100, 104, 8, 12, 'H');
  put(104, 8, 'r');
  row(108, 9, '?M?');
  column(115, 3);
  put(115, 10, 'r');
  L.gap(120, 132, true);
  fill(123, 125, 11, 14, 'H');
  fill(128, 130, 9, 14, 'H');
  put(121, 13, 'f');
  put(126, 13, 'f');
  put(131, 13, 'f');
  fill(133, 145, 3, 4, 'H');
  fill(133, 135, 10, 12, 'H');
  put(134, 10, 'r');

  // Boss room: a bridge over lava, the lever behind it.
  fill(146, 199, 0, 3, 'H');
  fill(146, 149, 9, 12, 'H');
  L.gap(150, 165, true);
  fill(150, 165, 9, 9, '_');
  fill(166, 172, 9, 14, 'H');
  fill(173, 199, 4, 12, 'H');

  L.enemies([12, 24], 8);
  L.enemies([40, 42, 56, 64, 80, 84, 110, 112, 140, 144]);
  return L.done({
    goal: 'lever', goalX: 167, start: [3, 8],
    bridge: { x0: 150, x1: 165, y: 9 },
    boss: { x: 161, min: 153, max: 164 },
  });
}

const LEVELS = [
  { name: 'ПОЛЕ', build: levelField, time: 400 },
  { name: 'ПОДЗЕМЕЛЬЕ', build: levelCave, time: 400 },
  { name: 'ВЕРХУШКИ ДЕРЕВЬЕВ', build: levelTrees, time: 300 },
  { name: 'ЗАМОК', build: levelCastle, time: 300 },
];

// ---------- Looks («Внешний вид») ----------
// Each item has a stars price for later; everything is free for now.
// Hero skins recolor the hero: C cap, J jacket, P overalls, B boots, S skin, K hair.
const SKINS = [
  { id: 'classic', name: 'Классика', stars: 0, pal: {} },
  { id: 'forest', name: 'Лесник', stars: 0, pal: { C: '#2a7a2a', J: '#a86c30', P: '#4a4a20', B: '#3a2008' } },
  { id: 'space', name: 'Космонавт', stars: 0, pal: { C: '#e8e8f0', J: '#b8bcc8', P: '#3050c8', B: '#606070', K: '#e8e8f0' } },
  { id: 'ninja', name: 'Ниндзя', stars: 0, pal: { C: '#303040', J: '#404050', P: '#202028', B: '#101010', K: '#d82800' } },
  { id: 'pirate', name: 'Пират', stars: 0, pal: { C: '#d82800', J: '#f0f0f0', P: '#202020', B: '#6b3a10', S: '#e0a070' } },
  { id: 'pink', name: 'Зефирка', stars: 0, pal: { C: '#f878b8', J: '#f8b8d8', P: '#8040c0', B: '#c03080', K: '#8a4a20' } },
];

const DAY_SKY = '#6b8cff';
const NIGHT_SKY = '#101838';
const TIMES = [
  { id: 'day', name: 'День', stars: 0 },
  { id: 'night', name: 'Ночь', stars: 0 },
];

// Enemy shells: E shell, O spots.
const ENEMIES = [
  { id: 'red', name: 'Жук', stars: 0, pal: {} },
  { id: 'blue', name: 'Синий', stars: 0, pal: { E: '#2848a8', O: '#58a0f8' } },
  { id: 'green', name: 'Травяной', stars: 0, pal: { E: '#107010', O: '#58d858' } },
  { id: 'gold', name: 'Золотой', stars: 0, pal: { E: '#c07000', O: '#f8d020' } },
  { id: 'shadow', name: 'Тень', stars: 0, pal: { E: '#303040', O: '#9090b0', Y: '#c0c0d0' } },
];

// Pipe colors: outline, body, highlight, shade.
const PIPES = [
  { id: 'green', name: 'Зелёные', stars: 0, c: ['#0a300a', '#30a030', '#a0f080', '#107010'] },
  { id: 'red', name: 'Красные', stars: 0, c: ['#400808', '#c03020', '#f8a080', '#801010'] },
  { id: 'blue', name: 'Синие', stars: 0, c: ['#081840', '#2860c0', '#90c8f8', '#103880'] },
  { id: 'gold', name: 'Золотые', stars: 0, c: ['#402800', '#d8a020', '#f8f0a0', '#906000'] },
  { id: 'steel', name: 'Стальные', stars: 0, c: ['#202020', '#8c8c8c', '#e0e0e0', '#505050'] },
];

function hump(ctx, x, w, h, bottom, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(x + w / 2, bottom, w / 2, h, 0, Math.PI, 0);
  ctx.fill();
}

// Backdrops painted behind outdoor areas, w x h pixels standing on the ground.
const BACKS = [
  { id: 'hills', name: 'Холмы', stars: 0, w: 80, h: 36, paint(ctx, n) {
    hump(ctx, 0, 80, 34, 36, n ? '#0a3a20' : '#107010');
    hump(ctx, 3, 74, 32, 37, n ? '#185a30' : '#30a030');
  } },
  { id: 'mountains', name: 'Горы', stars: 0, w: 160, h: 80, paint(ctx, n) {
    const peak = (x, w, h, col, snow) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, 80);
      ctx.lineTo(x + w / 2, 80 - h);
      ctx.lineTo(x + w, 80);
      ctx.fill();
      ctx.fillStyle = snow;
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - w * 0.12, 80 - h * 0.76);
      ctx.lineTo(x + w / 2, 80 - h);
      ctx.lineTo(x + w / 2 + w * 0.12, 80 - h * 0.76);
      ctx.fill();
    };
    peak(60, 100, 64, n ? '#232a50' : '#5868a8', n ? '#8890b8' : '#ffffff');
    peak(0, 110, 80, n ? '#2c3460' : '#7080c0', n ? '#a0a8c8' : '#ffffff');
  } },
  { id: 'forest', name: 'Лес', stars: 0, w: 128, h: 52, paint(ctx, n) {
    for (const [x, r] of [[14, 14], [40, 18], [70, 15], [100, 19], [120, 10]]) {
      ctx.fillStyle = n ? '#3a2410' : '#6b3a10';
      ctx.fillRect(x - 2, 52 - 14, 4, 14);
      ctx.fillStyle = n ? '#0a2a18' : '#107010';
      ctx.beginPath();
      ctx.arc(x, 52 - 12 - r, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = n ? '#12402a' : '#30a030';
      ctx.beginPath();
      ctx.arc(x - r * 0.3, 52 - 14 - r * 1.2, r * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  } },
  { id: 'city', name: 'Город', stars: 0, w: 144, h: 76, paint(ctx, n) {
    [[0, 22, 46], [24, 26, 70], [52, 20, 38], [74, 30, 58], [106, 18, 44], [126, 18, 64]].forEach(([x, w, h], i) => {
      ctx.fillStyle = n ? '#202840' : '#506080';
      ctx.fillRect(x, 76 - h, w, h);
      for (let y = 76 - h + 4; y < 72; y += 8) {
        for (let wx = x + 3; wx < x + w - 4; wx += 6) {
          const lit = (wx * 7 + y * 3 + i) % 5 < 2;
          ctx.fillStyle = n ? (lit ? '#f8d878' : '#303850') : '#a8c8f0';
          ctx.fillRect(wx, y, 3, 4);
        }
      }
    });
  } },
  { id: 'desert', name: 'Пустыня', stars: 0, w: 128, h: 40, paint(ctx, n) {
    hump(ctx, 0, 128, 22, 40, n ? '#605030' : '#e0b060');
    hump(ctx, 60, 68, 30, 41, n ? '#706038' : '#f0c878');
    ctx.fillStyle = n ? '#185a30' : '#30a030';
    ctx.fillRect(28, 8, 6, 26);
    ctx.fillRect(20, 14, 4, 10);
    ctx.fillRect(20, 20, 8, 4);
    ctx.fillRect(38, 12, 4, 10);
    ctx.fillRect(34, 18, 8, 4);
  } },
];

function drawStars(ctx, w, h) {
  ctx.fillStyle = '#f8f0c0';
  for (let i = 0; i < 40; i++) {
    const x = (i * 97 + 13) % w;
    const y = (i * 53 + i * i * 7) % h;
    ctx.fillRect(x, y, 1, 1 + (i % 7 === 0));
  }
  ctx.beginPath();
  ctx.arc(w - 40, 30, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = NIGHT_SKY;
  ctx.beginPath();
  ctx.arc(w - 35, 26, 9, 0, Math.PI * 2);
  ctx.fill();
}

const LOOKS_KEY = 'prygskok_looks';
const LOOK_GROUPS = [
  { id: 'hero', title: 'Выбери героя', items: SKINS, draw(it, ctx, size) {
    drawRows(ctx, [...HEAD, ...SMALL_BODY, ...SMALL_LEGS], size / 16, skinPal(it));
  } },
  { id: 'time', title: 'Погода: день или ночь', items: TIMES, draw(it, ctx, size) {
    const n = it.id === 'night';
    ctx.fillStyle = n ? NIGHT_SKY : DAY_SKY;
    ctx.fillRect(0, 0, size, size);
    if (n) {
      drawStars(ctx, size + 20, size);
    } else {
      ctx.fillStyle = '#f8d020';
      ctx.beginPath();
      ctx.arc(size - 14, 14, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(4, 26, 18, 6);
      ctx.fillRect(8, 22, 10, 4);
    }
    ctx.fillStyle = n ? '#185a30' : '#30a030';
    ctx.fillRect(0, size - 8, size, 8);
  } },
  { id: 'enemy', title: 'Враги', items: ENEMIES, draw(it, ctx, size) {
    drawRows(ctx, [...BUG_TOP, ...BUG_LEGS[0]], size / 16, Object.assign({}, PAL, it.pal));
  } },
  { id: 'pipe', title: 'Трубы', items: PIPES, draw(it, ctx, size) {
    const [o, m, l, d] = it.c;
    const box = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
    box(8, 4, 32, 12, o);
    box(9, 5, 30, 10, m);
    box(13, 5, 4, 10, l);
    box(31, 5, 4, 10, d);
    box(11, 16, 26, 32, o);
    box(12, 16, 24, 32, m);
    box(15, 16, 4, 32, l);
    box(29, 16, 4, 32, d);
  } },
  { id: 'back', title: 'Фон', items: BACKS, draw(it, ctx, size) {
    ctx.fillStyle = night() ? NIGHT_SKY : DAY_SKY;
    ctx.fillRect(0, 0, size, size);
    const cv = document.createElement('canvas');
    cv.width = it.w;
    cv.height = it.h;
    it.paint(cv.getContext('2d'), night());
    const k = Math.min(size / it.w, (size - 6) / it.h);
    ctx.drawImage(cv, (size - it.w * k) / 2, size - 6 - it.h * k, it.w * k, it.h * k);
    ctx.fillStyle = '#c0601c';
    ctx.fillRect(0, size - 6, size, 6);
  } },
].map((g) => Object.assign(g, { items: g.items.map((it) => Object.assign(it, { draw: (ctx, size) => g.draw(it, ctx, size) })) }));

// The hero skin used to be saved on its own; carry it over once.
try {
  const old = localStorage.getItem('prygskok_skin');
  if (old && !localStorage.getItem(LOOKS_KEY)) localStorage.setItem(LOOKS_KEY, JSON.stringify({ hero: old }));
} catch (e) { /* ignore */ }

let looks = window.Looks ? window.Looks.load(LOOKS_KEY, LOOK_GROUPS) : {};
// Bumped on every change, so the scene redraws its textures on the next start.
let looksVersion = 1;

function lookOf(groupId) {
  const g = LOOK_GROUPS.find((gr) => gr.id === groupId);
  return g.items.find((it) => it.id === looks[groupId]) || g.items[0];
}
const night = () => lookOf('time').id === 'night';

function skinPal(sk) { return Object.assign({}, PAL, sk.pal); }

// Fire form keeps the skin's face but wears a white cap and red jacket.
const fire = (rows) => rows.map((r) => r.replace(/J/g, 'F').replace(/C/g, 'W'));

function makeHeroTextures(scene) {
  const pal = skinPal(lookOf('hero'));
  const hp = (key, rows) => pix(scene, key, rows, 1, pal);
  hp('hs0', [...HEAD, ...SMALL_BODY, ...SMALL_LEGS]);
  hp('hs1', [...HEAD, ...SMALL_BODY, ...SMALL_LEGS_WALK]);
  hp('hs2', [...HEAD, ...SMALL_BODY_JUMP, ...SMALL_LEGS_WALK]);
  hp('hb0', [...HEAD, ...BIG_BODY, ...BIG_LEGS]);
  hp('hb1', [...HEAD, ...BIG_BODY, ...BIG_LEGS_WALK]);
  hp('hb2', [...HEAD, ...BIG_BODY_JUMP, ...BIG_LEGS_WALK]);
  hp('hbc', CROUCH);
  hp('hf0', fire([...HEAD, ...BIG_BODY, ...BIG_LEGS]));
  hp('hf1', fire([...HEAD, ...BIG_BODY, ...BIG_LEGS_WALK]));
  hp('hf2', fire([...HEAD, ...BIG_BODY_JUMP, ...BIG_LEGS_WALK]));
  hp('hfc', fire(CROUCH));
}

// «Внешний вид» opens from the title and game-over screens.
function openLooks() {
  if (!window.Looks) return;
  window.Looks.open({
    key: LOOKS_KEY,
    title: 'ВНЕШНИЙ ВИД',
    groups: LOOK_GROUPS,
    onChange(sel) { looks = Object.assign({}, sel); },
    onClose(sel, changed) {
      if (!changed) return;
      looks = Object.assign({}, sel);
      looksVersion++;
      // Before the first game the level behind the title is redrawn at once;
      // after a game over the restart picks the new look up.
      const scene = window.__scene;
      if (scene && !started) scene.scene.restart();
    },
  });
}

// ---------- Game scene ----------
let started = false;

class Play extends Phaser.Scene {
  constructor() { super('play'); }

  init(data) {
    this.s = Object.assign({ lives: 3, score: 0, coins: 0, level: 0 }, data || {});
    this.def = LEVELS[this.s.level];
    this.s.timeLeft = this.def.time;
    this.big = !!this.s.big;
    delete this.s.big;
    this.fire = this.big && !!this.s.fire;
    delete this.s.fire;
    this.intro = false;
    this.dead = false;
    this.won = false;
    this.invUntil = 0;
    this.bumpUntil = 0;
    this.prevJump = false;
    this.headHits = [];
  }

  create() {
    if (this.game.looksVersion !== looksVersion) {
      makeTextures(this);
      this.game.looksVersion = looksVersion;
    }
    const cam = this.cameras.main;

    const lvl = this.def.build();
    this.lvl = lvl;
    this.W = lvl.W;
    this.contents = new Map();
    this.hidden = new Set();
    const coinSpots = [];
    const enemySpots = [];
    const ballSpots = [];
    const barSpots = [];
    for (let y = 0; y < lvl.H; y++) {
      for (let x = 0; x < lvl.W; x++) {
        const ch = lvl.grid[y][x];
        if (ch === '?') this.contents.set(x + ',' + y, { kind: 'coin', left: 1 });
        if (ch === 'M') this.contents.set(x + ',' + y, { kind: 'berry', left: 1 });
        if (ch === 'L' || ch === 'h') this.contents.set(x + ',' + y, { kind: 'life', left: 1 });
        if (ch === 'k') this.contents.set(x + ',' + y, { kind: 'coin', left: 1 });
        if (ch === 'h' || ch === 'k') this.hidden.add(x + ',' + y);
        if (ch === 'C') this.contents.set(x + ',' + y, { kind: 'coin', left: 8 });
        if (ch === 'o') coinSpots.push([x, y]);
        if (ch === 'e') enemySpots.push([x, y]);
        if (ch === 'f') ballSpots.push([x, y]);
        if (ch === 'r') barSpots.push([x, y]);
      }
    }

    // Scenery behind each area, with parallax; only the current area's is shown.
    this.scenery = lvl.areas.map((ar) => {
      const box = [];
      // With scroll factor f an image at X shows at X - f * scrollX, so cover the area's scroll range.
      const span = (f) => [Math.floor(f * ar.x0 * TILE), f * (ar.x1 * TILE - VIEW_W) + VIEW_W];
      if (ar.scenery !== 'none') {
        if (night()) box.push(this.add.image(0, 0, 'stars').setOrigin(0).setScrollFactor(0).setDepth(DEPTH.SCENERY - 1));
        const [a, b] = span(0.5);
        for (let x = a; x < b; x += 190) {
          const cloud = this.add.image(x + 60, 40 + (x % 3) * 12, 'cloud').setOrigin(0).setScrollFactor(0.5).setDepth(DEPTH.SCENERY);
          if (night()) cloud.setTint(0x5a6488);
          box.push(cloud);
        }
      }
      if (ar.scenery === 'field') {
        const [a, b] = span(0.8);
        for (let x = a; x < b; x += 300) {
          box.push(this.add.image(x + 20, 13 * TILE, 'hill').setOrigin(0, 1).setScrollFactor(0.8).setDepth(DEPTH.SCENERY));
        }
      }
      return box;
    });

    // Lava balls sit behind the tiles so they rise out of the lava.
    this.hazards = [];
    for (const [x] of ballSpots) this.addLavaBall(x);

    // One tile layer per area, so every area can have its own colors.
    this.map = this.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: lvl.W, height: lvl.H });
    this.layers = lvl.areas.map((ar, i) => {
      const ts = this.map.addTilesetImage(ar.tiles + i, ar.tiles, TILE, TILE, 0, 0);
      const layer = this.map.createBlankLayer('area' + i, ts);
      for (let y = 0; y < lvl.H; y++) {
        for (let x = ar.x0; x < Math.min(ar.x1, lvl.W); x++) {
          const ch = lvl.grid[y][x];
          if (ch in TILE_OF) layer.putTileAt(TILE_OF[ch], x, y);
        }
      }
      layer.setCollision(SOLID);
      layer.setData('tiles', ar.tiles);
      return layer;
    });

    this.bars = [];
    barSpots.forEach(([x, y], i) => this.addFireBar(x, y, i % 2 ? -1 : 1));

    this.lifts = this.physics.add.group({ allowGravity: false, immovable: true });
    for (const def of lvl.lifts) this.addLift(def);

    // Goal: flag on a pole, or the lever behind the castle bridge.
    const goalX = lvl.goalX * TILE + 8;
    if (lvl.goal === 'pole') this.flag = this.add.image(goalX - 8, 4 * TILE + 8, 'flag');
    else this.lever = this.add.image(goalX, lvl.bridge.y * TILE, 'lever').setOrigin(0.5, 1);

    // Hero.
    const [sx, sy] = lvl.start || [3, 13];
    this.player = this.physics.add.sprite(sx * TILE + 8, sy * TILE, this.heroTex() + '0').setOrigin(0.5, 1).setDepth(DEPTH.HERO);
    this.player.body.setMaxVelocity(300, 270);
    this.applyBody();
    this.arrow = this.add.image(0, 0, 'arrow').setVisible(false).setDepth(DEPTH.HERO);
    this.pipeWait = 0;
    this.inPipe = false;

    this.coinItems = this.physics.add.staticGroup();
    for (const [x, y] of coinSpots) this.coinItems.create(x * TILE + 8, y * TILE + 8, 'coin');

    this.enemies = this.physics.add.group();
    for (const [x, y] of enemySpots) {
      const e = this.enemies.create(x * TILE + 8, y * TILE + 8, 'bug0').setDepth(DEPTH.ENEMY);
      e.body.setSize(14, 14).setOffset(1, 2);
      e.setData('state', 'idle');
    }

    this.items = this.physics.add.group();
    this.fireballs = this.physics.add.group();

    this.layerCollider = this.physics.add.collider(this.player, this.layers, (p, tile) => {
      if (p.body.blocked.up && tile.pixelY + TILE <= p.body.top + 2) this.headHits.push(tile);
    });
    this.liftCollider = this.physics.add.collider(this.player, this.lifts);
    this.physics.add.collider(this.enemies, this.layers);
    this.physics.add.collider(this.items, this.layers);
    this.physics.add.collider(this.fireballs, this.layers);
    this.physics.add.overlap(this.fireballs, this.enemies, (f, e) => {
      if (e.getData('state') === 'dead') return;
      f.destroy();
      this.flipEnemy(e);
    });
    this.physics.add.overlap(this.player, this.enemies, (p, e) => this.touchEnemy(e));
    this.physics.add.overlap(this.player, this.coinItems, (p, c) => { c.destroy(); this.gainCoin(); });
    this.physics.add.overlap(this.player, this.items, (p, it) => {
      if (!it.body.enable) return;
      const kind = it.getData('kind');
      it.destroy();
      if (kind === 'life') this.extraLife();
      else this.grow();
    });

    if (lvl.goal === 'pole') {
      const pole = this.add.zone(goalX, 3 * TILE, 4, 9 * TILE).setOrigin(0.5, 0);
      this.physics.add.existing(pole, true);
      this.physics.add.overlap(this.player, pole, () => this.win(lvl.goalX));
    } else {
      const zone = this.add.zone(goalX, lvl.bridge.y * TILE, 12, 16).setOrigin(0.5, 1);
      this.physics.add.existing(zone, true);
      this.physics.add.overlap(this.player, zone, () => this.pullLever());
    }
    if (lvl.boss) this.addBoss(lvl.boss);

    const kb = this.input.keyboard;
    this.keys = kb.addKeys('LEFT,RIGHT,UP,DOWN,Z,X,A,S,SPACE,SHIFT');

    this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        if (!started || this.dead || this.won || this.intro) return;
        this.s.timeLeft--;
        hud(this.s);
        if (this.s.timeLeft <= 0) this.die();
      },
    });

    this.setArea(0);
    cam.scrollX = 0;

    // The physics world outlives scene restarts, so its paused flag does too.
    this.physics.pause();
    if (started) this.showIntro();
    hud(this.s);
    window.__scene = this;
  }

  holdingA() {
    const k = this.keys;
    return k.Z.isDown || k.SPACE.isDown || touch.a;
  }

  setArea(i) {
    this.area = i;
    const ar = this.lvl.areas[i];
    this.cameras.main.setBackgroundColor(ar.sky === DAY_SKY && night() ? NIGHT_SKY : ar.sky);
    this.scenery.forEach((box, j) => box.forEach((img) => img.setVisible(i === j)));
  }

  layerAt(tx) {
    const i = this.lvl.areas.findIndex((ar) => tx >= ar.x0 && tx < ar.x1);
    return this.layers[Math.max(0, i)];
  }

  // ---------- Pipes between areas ----------
  updatePipes(time, down, right, onGround) {
    const p = this.player;
    const b = p.body;
    let over = null;
    for (const pipe of this.lvl.pipes) {
      if (pipe.type === 'down') {
        const px = pipe.x * TILE;
        if (onGround && Math.abs(b.bottom - pipe.y * TILE) < 2 && b.left >= px && b.right <= px + 2 * TILE) over = pipe;
      } else if (onGround && right && Math.abs(b.bottom - (pipe.y + 2) * TILE) < 2 &&
        b.right >= pipe.x * TILE - 1 && b.left < pipe.x * TILE) {
        this.enterPipe(pipe);
        return true;
      }
    }
    if (over && down) {
      if (!this.pipeWait) this.pipeWait = time;
      this.arrow.setPosition(over.x * TILE + TILE, over.y * TILE - 34 + Math.sin(time / 120) * 2).setVisible(true);
      if (down || time - this.pipeWait > 700) {
        this.arrow.setVisible(false);
        this.enterPipe(over);
        return true;
      }
    } else {
      this.pipeWait = 0;
      this.arrow.setVisible(over !== null && time % 600 < 400);
      if (over) this.arrow.setPosition(over.x * TILE + TILE, over.y * TILE - 34);
    }
    return false;
  }

  enterPipe(pipe) {
    const p = this.player;
    const b = p.body;
    this.inPipe = true;
    this.pipeWait = 0;
    SFX.hurt();
    b.setVelocity(0, 0);
    b.allowGravity = false;
    b.enable = false;
    p.setDepth(DEPTH.SPROUT);
    const tween = pipe.type === 'down'
      ? { y: p.y + p.height, x: pipe.x * TILE + TILE }
      : { x: p.x + 16 };
    this.tweens.add({
      targets: p,
      ...tween,
      duration: 700,
      onComplete: () => this.time.delayedCall(300, () => this.leavePipe(pipe.to)),
    });
  }

  leavePipe(to) {
    const p = this.player;
    const b = p.body;
    const cam = this.cameras.main;
    const ar = this.lvl.areas[to.area];
    this.setArea(to.area);
    const finish = () => {
      p.setDepth(DEPTH.HERO);
      b.enable = true;
      b.allowGravity = true;
      b.reset(p.x, p.y);
      this.inPipe = false;
    };
    let x;
    if (to.pipeX !== undefined) {
      x = to.pipeX * TILE + TILE;
      p.setPosition(x, to.pipeY * TILE + p.height);
      this.tweens.add({ targets: p, y: to.pipeY * TILE, duration: 700, onComplete: finish });
      SFX.hurt();
    } else {
      x = to.x * TILE + 8;
      p.setPosition(x, to.y * TILE);
      finish();
    }
    cam.scrollX = Phaser.Math.Clamp(x - VIEW_W * 0.42, ar.x0 * TILE, ar.x1 * TILE - VIEW_W);
  }

  // ---------- Lifts ----------
  addLift(def) {
    const key = 'lift' + def.w;
    if (!this.textures.exists(key)) {
      const c = this.textures.createCanvas(key, def.w * TILE, 8);
      const ctx = c.getContext();
      ctx.fillStyle = '#f8b878';
      ctx.fillRect(0, 0, def.w * TILE, 8);
      ctx.fillStyle = '#c05000';
      for (let x = 0; x < def.w * TILE; x += 8) ctx.fillRect(x + 3, 2, 2, 4);
      ctx.fillRect(0, 7, def.w * TILE, 1);
      c.refresh();
    }
    const lift = this.lifts.create(def.x * TILE, def.y * TILE, key).setOrigin(0, 0);
    lift.body.setSize(def.w * TILE, 8);
    lift.body.checkCollision.down = false;
    lift.body.checkCollision.left = false;
    lift.body.checkCollision.right = false;
    lift.body.setFriction(0, 0);
    lift.setData('def', def);
    lift.setData('home', [def.x * TILE, def.y * TILE]);
    this.placeLift(lift, 0);
  }

  liftTarget(lift, t) {
    const def = lift.getData('def');
    const [hx, hy] = lift.getData('home');
    const k = (1 - Math.cos((t / def.period + def.phase) * Math.PI * 2)) / 2;
    const d = k * def.dist * TILE;
    return def.axis === 'x' ? [hx + d, hy] : [hx, hy + d];
  }

  placeLift(lift, t) {
    const [x, y] = this.liftTarget(lift, t);
    lift.body.reset(x, y);
  }

  updateLifts(time, delta) {
    const t = time / 1000;
    const dt = delta / 1000;
    const pb = this.player.body;
    for (const lift of this.lifts.getChildren()) {
      const [x, y] = this.liftTarget(lift, t + dt);
      const lb = lift.body;
      const riding = pb.enable && pb.right > lb.left && pb.left < lb.right && Math.abs(pb.bottom - lb.top) < 3;
      const dx = x - lb.x;
      const dy = y - lb.y;
      if (dt > 0) lb.setVelocity(dx / dt, dy / dt);
      if (riding && !this.dead) {
        this.player.x += dx;
        if (dy > 0) this.player.y += dy;
      }
    }
  }

  // ---------- Castle boss ----------
  addBoss(def) {
    const boss = this.physics.add.sprite(def.x * TILE, 9 * TILE, 'boss0').setOrigin(0.5, 1).setDepth(DEPTH.ENEMY);
    boss.body.setSize(26, 26).setOffset(3, 6);
    boss.setData('hp', 5);
    boss.setData('def', def);
    this.boss = boss;
    this.bossDir = -1;
    this.bossNext = 0;
    this.bossFires = [];
    this.physics.add.collider(boss, this.layers);
    this.physics.add.overlap(this.player, boss, () => {
      if (!this.won && boss.getData('hp') > 0) this.hurt();
    });
    // Five fireballs defeat the beetle, like on the console.
    this.physics.add.overlap(this.fireballs, boss, (a, b) => {
      (a === boss ? b : a).destroy();
      if (boss.getData('hp') <= 0) return;
      boss.setData('hp', boss.getData('hp') - 1);
      SFX.stomp();
      boss.setTintFill(0xffffff);
      this.time.delayedCall(80, () => boss.clearTint());
      if (boss.getData('hp') <= 0) {
        api.track('bossFire');
        this.addScore(5000);
        boss.setFlipY(true);
        boss.body.checkCollision.none = true;
        boss.body.setVelocity(0, -150);
      }
    });
  }

  updateBoss(time, delta) {
    const boss = this.boss;
    if (!boss || !boss.active) return;
    const cam = this.cameras.main;
    if (boss.y > VIEW_H + 48) { boss.destroy(); return; }
    if (this.won || boss.getData('hp') <= 0) return;
    if (boss.x > cam.scrollX + VIEW_W + 16) { boss.body.setVelocityX(0); return; }
    const def = boss.getData('def');
    const b = boss.body;
    if (boss.x < def.min * TILE) this.bossDir = 1;
    if (boss.x > def.max * TILE) this.bossDir = -1;
    b.setVelocityX(this.bossDir * 25);
    boss.setTexture('boss' + (Math.floor(time / 250) % 2));
    if (time > this.bossNext) {
      this.bossNext = time + 1800 + Math.random() * 1200;
      if (Math.random() < 0.5 && b.blocked.down) b.setVelocityY(-260);
      else this.bossFire(boss);
    }
    for (const f of this.bossFires) f.x -= 75 * delta / 1000;
    const gone = this.bossFires.filter((f) => f.x < cam.scrollX - 32);
    for (const f of gone) {
      f.destroy();
      this.hazards.splice(this.hazards.indexOf(f), 1);
    }
    this.bossFires = this.bossFires.filter((f) => f.active);
  }

  bossFire(boss) {
    // Aim at the hero's height, but only in steps of a tile like the console.
    const py = Phaser.Math.Clamp(this.player.body.center.y, 5 * TILE, 8 * TILE + 8);
    const f = this.add.image(boss.x - 14, Math.round(py / 8) * 8, 'bossFire').setDepth(DEPTH.ITEM);
    this.bossFires.push(f);
    this.hazards.push(f);
    tone(120, 60, 0.4, 'sawtooth', 0.12);
  }

  pullLever() {
    if (this.won || this.dead) return;
    this.won = true;
    const b = this.player.body;
    b.setVelocity(0, 0);
    this.lever.setFlipX(true);
    if (this.boss && this.boss.active) this.boss.body.setVelocityX(0);
    SFX.bump();
    haptic('success');
    for (const f of this.bossFires) f.destroy();
    this.bossFires = [];
    const { x0, x1, y } = this.lvl.bridge;
    const layer = this.layerAt(x0);
    for (let x = x1; x >= x0; x--) {
      this.time.delayedCall((x1 - x) * 70, () => { layer.removeTileAt(x, y); SFX.brick(); });
    }
    this.time.delayedCall((x1 - x0 + 1) * 70 + 200, () => {
      if (this.boss && this.boss.active) {
        this.boss.body.checkCollision.none = true;
        this.boss.setFlipY(true);
      }
      SFX.die();
    });
    this.time.delayedCall((x1 - x0 + 1) * 70 + 2200, () => {
      this.addScore(5000);
      SFX.win();
      this.finishLevel();
    });
  }

  // Black title card before each level, like on the console.
  showIntro() {
    this.intro = true;
    this.physics.pause();
    const items = [
      this.add.rectangle(0, 0, VIEW_W, VIEW_H, 0x000000).setOrigin(0),
      this.add.text(VIEW_W / 2, 92, `МИР 1-${this.s.level + 1}`, { fontFamily: 'Courier New, monospace', fontSize: '16px', fontStyle: 'bold', color: '#ffffff', resolution: 4 }).setOrigin(0.5),
      this.add.text(VIEW_W / 2, 116, this.def.name, { fontFamily: 'Courier New, monospace', fontSize: '12px', fontStyle: 'bold', color: '#f8d020', resolution: 4 }).setOrigin(0.5),
      this.add.image(VIEW_W / 2 - 14, 150, this.heroTex() + '0').setOrigin(0.5, 1),
      this.add.text(VIEW_W / 2 + 2, 142, `× ${this.s.lives}`, { fontFamily: 'Courier New, monospace', fontSize: '12px', fontStyle: 'bold', color: '#ffffff', resolution: 4 }).setOrigin(0, 0.5),
    ];
    for (const it of items) it.setScrollFactor(0).setDepth(100);
    this.time.delayedCall(1600, () => {
      for (const it of items) it.destroy();
      this.intro = false;
      this.physics.resume();
    });
  }

  addLavaBall(tx) {
    const low = 15 * TILE + 8;
    const b = this.add.image(tx * TILE + 8, low, 'lavaball').setDepth(DEPTH.SPROUT);
    this.hazards.push(b);
    const jump = () => {
      b.setFlipY(false);
      this.tweens.add({
        targets: b,
        y: 7 * TILE,
        duration: 900,
        ease: 'Sine.easeOut',
        onComplete: () => {
          b.setFlipY(true);
          this.tweens.add({ targets: b, y: low, duration: 900, ease: 'Sine.easeIn', onComplete: () => this.time.delayedCall(1000, jump) });
        },
      });
    };
    this.time.delayedCall((tx * 137) % 1500, jump);
  }

  addFireBar(tx, ty, dir) {
    const cx = tx * TILE + 8;
    const cy = ty * TILE + 8;
    const sparks = [];
    for (let i = 0; i < 6; i++) {
      const sp = this.add.image(cx, cy, 'spark').setDepth(DEPTH.ITEM);
      sp.setData('r', i * 7);
      sparks.push(sp);
      this.hazards.push(sp);
    }
    this.bars.push({ cx, cy, dir, angle: tx, sparks });
  }

  updateHazards(delta) {
    for (const bar of this.bars) {
      bar.angle += bar.dir * 1.7 * delta / 1000;
      for (const sp of bar.sparks) {
        const r = sp.getData('r');
        sp.setPosition(bar.cx + Math.cos(bar.angle) * r, bar.cy + Math.sin(bar.angle) * r);
      }
    }
    if (this.dead || this.won || this.time.now < this.invUntil) return;
    const pb = this.player.body;
    for (const h of this.hazards) {
      // Circle vs. body rectangle, with the hazard slightly smaller than its sprite.
      const rad = h.texture.key === 'spark' ? 2.5 : 5;
      const nx = Phaser.Math.Clamp(h.x, pb.left, pb.right);
      const ny = Phaser.Math.Clamp(h.y, pb.top, pb.bottom);
      if ((h.x - nx) ** 2 + (h.y - ny) ** 2 < rad * rad) { this.hurt(); return; }
    }
  }

  applyBody() {
    const b = this.player.body;
    if (this.big && this.crouch) { b.setSize(12, 14, false); b.setOffset(2, 10); }
    else if (this.big) { b.setSize(12, 22, false); b.setOffset(2, 2); }
    else { b.setSize(10, 14, false); b.setOffset(3, 2); }
  }

  setBig(big) {
    this.big = big;
    this.crouch = false;
    if (!big) this.fire = false;
    this.player.setTexture(this.heroTex() + '0');
    this.applyBody();
  }

  // Texture prefix for the hero's current form.
  heroTex() {
    if (this.fire) return 'hf';
    return this.big ? 'hb' : 'hs';
  }

  addScore(n) {
    this.s.score += n;
    hud(this.s);
  }

  gainCoin() {
    this.s.coins++;
    api.track('coin');
    this.s.score += 200;
    SFX.coin();
    if (this.s.coins >= 100) {
      this.s.coins -= 100;
      this.extraLife();
    }
    hud(this.s);
  }

  update(time, delta) {
    if (!started) return;
    const p = this.player;
    const b = p.body;
    const cam = this.cameras.main;

    if (this.intro) return;
    this.updateLifts(time, delta);
    this.updateEnemies(time, cam);
    this.updateItems();
    this.updateFireballs();
    this.updateBoss(time, delta);
    this.updateHazards(delta);

    if (this.dead || this.inPipe) return;

    if (this.won) {
      if (this.autoWalk) {
        b.setVelocityX(60);
        p.setTexture(this.heroTex() + (Math.floor(time / 110) % 2));
      }
      return;
    }

    if (p.y > VIEW_H + 24) { this.die(true); return; }
    const under = this.layerAt(Math.floor(p.x / TILE)).getTileAtWorldXY(p.x, b.bottom - 4);
    if (under && under.index === T.LAVA_TOP && b.bottom > under.pixelY + 6) { this.die(true); return; }

    const k = this.keys;
    const turboOn = Math.floor(time / TURBO_MS) % 2 === 0;
    const turboA = (touch.turboA || k.A.isDown) && turboOn;
    const turboB = (touch.turboB || k.S.isDown) && turboOn;
    const left = k.LEFT.isDown || touch.left;
    const right = k.RIGHT.isDown || touch.right;
    const jump = this.holdingA() || turboA;
    const run = k.X.isDown || k.SHIFT.isDown || touch.b || touch.turboB || k.S.isDown;
    // Latched presses, so a quick tap between two frames still fires.
    const JD = Phaser.Input.Keyboard.JustDown;
    const firePressed = JD(k.X) || JD(k.SHIFT) || touch.bPressed || (turboB && !this.prevTurboB);
    touch.bPressed = false;
    this.prevTurboB = turboB;
    if (firePressed && this.fire) this.shoot();
    const up = k.UP.isDown || touch.up;
    const down = k.DOWN.isDown || touch.down;
    const onGround = b.blocked.down || b.touching.down;
    if (this.updatePipes(time, down, right && !left, onGround)) return;
    const dt = delta / 1000;

    // Big hero crouches on the ground while down is held and slides to a stop.
    const crouch = this.big && down && (onGround || this.crouch);
    if (crouch !== !!this.crouch) {
      this.crouch = crouch;
      this.applyBody();
    }

    // Horizontal movement with inertia.
    const maxV = run ? 150 : 90;
    let target = 0;
    if (this.crouch) target = 0;
    else if (left && !right) target = -maxV;
    else if (right && !left) target = maxV;
    // Rates follow classic 8-bit platformers (per-frame values x 60 x 60): slow build-up,
    // a long slide on release and a sharper skid when reversing.
    let acc;
    if (target === 0) acc = onGround ? 183 : 0;
    else if (b.velocity.x !== 0 && Math.sign(target) !== Math.sign(b.velocity.x)) acc = 366;
    else acc = run ? 200 : 134;
    const vx = b.velocity.x;
    b.setVelocityX(vx < target ? Math.min(vx + acc * dt, target) : Math.max(vx - acc * dt, target));
    if (target !== 0) p.setFlipX(target < 0);

    // Jump: higher when running, shorter when the button is released early.
    // Jump strength and gravity depend on the speed at take-off, as in classic 8-bit platformers:
    // low gravity while A is held on the way up, heavy gravity otherwise.
    if (jump && !this.prevJump && onGround) {
      const speed = Math.abs(b.velocity.x);
      this.jumpKind = speed < 60 ? 0 : speed < 139 ? 1 : 2;
      b.setVelocityY(this.jumpKind === 2 ? -300 : -240);
      SFX.jump();
    }
    this.prevJump = jump;
    const [holdG, fallG] = JUMP_GRAVITY[this.jumpKind || 0];
    const g = b.velocity.y < 0 && jump ? holdG : fallG;
    b.setGravityY(g - WORLD_GRAVITY);

    this.checkHidden(b);

    // Blocks hit by the head: take the one closest to the hero's center.
    if (this.headHits.length) {
      let best = null;
      let bestD = Infinity;
      for (const t of this.headHits) {
        const d = Math.abs(t.pixelX + 8 - b.center.x);
        if (d < bestD) { bestD = d; best = t; }
      }
      this.headHits.length = 0;
      if (best && time > this.bumpUntil) {
        this.bumpUntil = time + 200;
        this.hitBlock(best);
      }
    }

    // The camera only moves right, like on the console.
    const ar = this.lvl.areas[this.area];
    const want = Phaser.Math.Clamp(p.x - VIEW_W * 0.42, ar.x0 * TILE, ar.x1 * TILE - VIEW_W);
    if (want > cam.scrollX) cam.scrollX = want;
    if (p.x - 6 < cam.scrollX) {
      p.x = cam.scrollX + 6;
      if (b.velocity.x < 0) b.setVelocityX(0);
    }

    // Sprite frame.
    const pre = this.heroTex();
    let frame = pre + '0';
    if (this.crouch) frame = pre + 'c';
    else if (!onGround) frame = pre + '2';
    else if (Math.abs(b.velocity.x) > 5) frame = pre + (Math.floor(time / (run ? 70 : 110)) % 2);
    if (p.texture.key !== frame) p.setTexture(frame);
    p.setAlpha(time < this.invUntil && Math.floor(time / 60) % 2 ? 0.3 : 1);
  }

  updateEnemies(time, cam) {
    for (const e of this.enemies.getChildren().slice()) {
      const st = e.getData('state');
      if (st === 'idle' && e.x < cam.scrollX + VIEW_W + 24 && e.x > cam.scrollX - 24) {
        e.setData('state', 'walk');
        e.body.setVelocityX(-30);
      } else if (st === 'walk') {
        if (e.body.blocked.left) e.body.setVelocityX(30);
        else if (e.body.blocked.right) e.body.setVelocityX(-30);
        e.setTexture('bug' + (Math.floor(time / 200) % 2));
      }
      if (e.y > VIEW_H + 32) e.destroy();
    }
  }

  updateItems() {
    for (const it of this.items.getChildren().slice()) {
      if (!it.body.enable) continue;
      if (it.body.blocked.left) it.body.setVelocityX(50);
      else if (it.body.blocked.right) it.body.setVelocityX(-50);
      if (it.y > VIEW_H + 32) it.destroy();
    }
  }

  // Hidden blocks only appear when the hero jumps into them from below.
  checkHidden(b) {
    if (!this.hidden.size || b.velocity.y >= 0) return;
    const ty = Math.floor((b.top - 1) / TILE);
    for (let tx = Math.floor(b.left / TILE); tx <= Math.floor((b.right - 1) / TILE); tx++) {
      const key = tx + ',' + ty;
      if (!this.hidden.has(key) || b.top < (ty + 1) * TILE - 6) continue;
      this.hidden.delete(key);
      const tile = this.layerAt(tx).putTileAt(T.BONUS, tx, ty);
      this.player.y += (ty + 1) * TILE - b.top;
      b.setVelocityY(0);
      this.headHits.length = 0;
      this.hitBlock(tile);
      return;
    }
  }

  hitBlock(tile) {
    const key = tile.x + ',' + tile.y;
    const content = this.contents.get(key);
    const tx = tile.x;
    const ty = tile.y;

    if (content) {
      content.left--;
      if (content.kind === 'coin') this.popCoin(tx, ty);
      else this.spawnBerry(tx, ty, content.kind);
      let idx = tile.index;
      if (content.left <= 0) {
        this.contents.delete(key);
        idx = T.USED;
        tile.tilemapLayer.putTileAt(idx, tx, ty);
      }
      this.bounceTile(tx, ty, idx);
    } else if (tile.index === T.BRICK) {
      if (this.big) this.breakBrick(tx, ty);
      else { this.bounceTile(tx, ty, T.BRICK); SFX.bump(); }
    } else {
      SFX.bump();
    }
    this.hitEnemiesAbove(tx, ty);
  }

  bounceTile(tx, ty, idx) {
    const layer = this.layerAt(tx);
    const tile = layer.getTileAt(tx, ty);
    if (!tile) return;
    tile.setVisible(false);
    const img = this.add.image(tx * TILE + 8, ty * TILE + 8, layer.getData('tiles'), idx);
    this.tweens.add({
      targets: img,
      y: img.y - 6,
      duration: 80,
      yoyo: true,
      onComplete: () => { img.destroy(); tile.setVisible(true); },
    });
  }

  breakBrick(tx, ty) {
    this.layerAt(tx).removeTileAt(tx, ty);
    SFX.brick();
    haptic('medium');
    this.addScore(50);
    for (const [dx, dy, vx, vy] of [[-4, -4, -60, -260], [4, -4, 60, -260], [-4, 4, -60, -180], [4, 4, 60, -180]]) {
      const d = this.physics.add.image(tx * TILE + 8 + dx, ty * TILE + 8 + dy, 'debris');
      d.body.setVelocity(vx, vy);
      this.time.delayedCall(1200, () => d.destroy());
    }
  }

  popCoin(tx, ty) {
    const c = this.add.image(tx * TILE + 8, ty * TILE - 8, 'coin');
    this.tweens.add({ targets: c, y: c.y - 32, duration: 220, yoyo: true, onComplete: () => c.destroy() });
    this.gainCoin();
  }

  spawnBerry(tx, ty, kind) {
    SFX.sprout();
    const it = this.items.create(tx * TILE + 8, ty * TILE + 8, kind === 'life' ? 'berry1' : 'berry');
    it.setData('kind', kind);
    it.setDepth(DEPTH.SPROUT);
    it.body.enable = false;
    this.tweens.add({
      targets: it,
      y: ty * TILE - 8,
      duration: 500,
      onComplete: () => {
        it.setDepth(DEPTH.ITEM);
        it.body.enable = true;
        it.body.reset(it.x, it.y);
        it.body.setVelocityX(50);
      },
    });
  }

  hitEnemiesAbove(tx, ty) {
    const cx = tx * TILE + 8;
    const top = ty * TILE;
    for (const e of this.enemies.getChildren()) {
      if (e.getData('state') === 'dead') continue;
      if (Math.abs(e.x - cx) < 14 && Math.abs(e.body.bottom - top) < 4) this.flipEnemy(e);
    }
  }

  flipEnemy(e) {
    e.setData('state', 'dead');
    e.setFlipY(true);
    e.body.checkCollision.none = true;
    e.body.setVelocity(20, -200);
    this.addScore(100);
    SFX.stomp();
    this.time.delayedCall(1500, () => e.destroy());
  }

  touchEnemy(e) {
    if (this.dead || this.won || e.getData('state') === 'dead') return;
    const b = this.player.body;
    if (b.velocity.y > 0 && b.bottom <= e.body.top + 8) {
      e.setData('state', 'dead');
      e.setTexture('bugFlat');
      e.body.enable = false;
      this.time.delayedCall(500, () => e.destroy());
      b.setVelocityY(-240);
      this.jumpKind = 0;
      this.addScore(100);
      SFX.stomp();
      haptic('light');
    } else {
      this.hurt();
    }
  }

  extraLife() {
    this.s.lives++;
    hud(this.s);
    SFX.life();
    haptic('success');
  }

  grow() {
    this.addScore(1000);
    SFX.power();
    haptic('medium');
    if (!this.big) this.setBig(true);
    else if (!this.fire) {
      this.fire = true;
      this.player.setTexture(this.heroTex() + '0');
    }
  }

  shoot() {
    const live = this.fireballs.getChildren().filter((f) => f.active).length;
    if (live >= 2) return;
    const p = this.player;
    const dir = p.flipX ? -1 : 1;
    const f = this.fireballs.create(p.x + dir * 8, p.y - 16, 'fireball').setDepth(DEPTH.ITEM);
    f.body.setSize(6, 6);
    f.body.setVelocity(dir * 200, 80);
    f.setData('dir', dir);
    SFX.fire();
  }

  updateFireballs() {
    const cam = this.cameras.main;
    for (const f of this.fireballs.getChildren().slice()) {
      const b = f.body;
      if (b.blocked.left || b.blocked.right || f.x < cam.scrollX - 16 || f.x > cam.scrollX + VIEW_W + 16 || f.y > VIEW_H) {
        f.destroy();
        continue;
      }
      if (b.blocked.down) b.setVelocityY(-160);
      b.setVelocityX(f.getData('dir') * 200);
      f.angle += 20;
    }
  }

  hurt() {
    if (this.time.now < this.invUntil) return;
    if (this.big) {
      this.setBig(false);
      this.invUntil = this.time.now + 1500;
      SFX.hurt();
      haptic('heavy');
    } else {
      this.die();
    }
  }

  die(fell) {
    if (this.dead) return;
    this.dead = true;
    api.track('death');
    SFX.die();
    haptic('error');
    const p = this.player;
    this.layerCollider.active = false;
    p.setAlpha(1);
    p.setTexture(this.heroTex() + '2');
    p.body.setGravityY(0);
    p.body.setVelocity(0, fell ? 0 : -350);
    this.time.delayedCall(2500, () => {
      this.s.lives--;
      if (this.s.lives > 0) {
        this.scene.restart({ lives: this.s.lives, score: this.s.score, coins: this.s.coins, level: this.s.level });
      } else {
        this.gameOver('ИГРА ОКОНЧЕНА');
      }
    });
  }

  gameOver(title, completed) {
    const best = saveBest(this.s.score);
    this.physics.pause();
    const levels = completed ? LEVELS.length : this.s.level;
    showOverlay(title, `Счёт: ${this.s.score}<br>Рекорд: ${best}`, 'Играть снова', () => {
      this.scene.restart({});
    });
    api.runDone(this.s.score, levels, !!completed).then((r) => {
      if (!r) return;
      const place = r.rank ? `<br>Место в таблице: ${r.rank}` : '';
      $('ovText').innerHTML = `Счёт: ${this.s.score}<br>${r.newRecord ? 'Новый рекорд!' : `Рекорд: ${r.best}`}${place}`;
    });
  }

  win(poleTileX) {
    if (this.won || this.dead) return;
    this.won = true;
    const p = this.player;
    const b = p.body;
    // Higher grab on the pole gives more points.
    const height = Math.max(0, 12 - Math.floor(p.y / TILE));
    this.addScore(height * 500);
    SFX.win();
    haptic('success');
    b.setVelocity(0, 0);
    b.setGravityY(0);
    b.allowGravity = false;
    p.x = poleTileX * TILE + 4;
    p.setTexture(this.heroTex() + '2');
    const bottom = 12 * TILE;
    const dur = Math.max(200, (bottom - p.y) * 8);
    this.tweens.add({ targets: this.flag, y: bottom - 8, duration: dur });
    this.tweens.add({
      targets: p,
      y: bottom,
      duration: dur,
      onComplete: () => {
        p.x += 12;
        b.allowGravity = true;
        this.autoWalk = true;
        this.time.delayedCall(1600, () => {
          this.autoWalk = false;
          b.setVelocityX(0);
          p.setVisible(false);
          this.finishLevel();
        });
      },
    });
  }

  finishLevel() {
    api.levelDone(this.s.level, this.s.score, this.s.timeLeft);
    this.addScore(this.s.timeLeft * 50);
    const next = this.s.level + 1;
    if (next < LEVELS.length) {
      this.scene.restart({ lives: this.s.lives, score: this.s.score, coins: this.s.coins, level: next, big: this.big, fire: this.fire });
    } else {
      this.gameOver('МИР 1 ПРОЙДЕН!', true);
    }
  }
}

// ---------- Boot ----------
bindControls();

$('ovLooks').addEventListener('click', openLooks);

$('ovBtn').addEventListener('click', () => {
  audio();
  $('overlay').classList.add('hidden');
  if (!started) {
    started = true;
    game.scene.getScene('play').showIntro();
    return;
  }
  if (overlayAction) {
    const act = overlayAction;
    overlayAction = null;
    act();
  }
});

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  // Touch buttons are plain HTML (bindControls); the engine only needs the keyboard.
  input: { mouse: false, touch: false },
  physics: { default: 'arcade', arcade: { gravity: { y: WORLD_GRAVITY }, tileBias: 20 } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [Play],
});
window.__game = game;
window.__touch = touch;

// Turning the phone changes the layout; refit the picture once the new size settles.
const refit = () => setTimeout(() => game.scale.refresh(), 150);
window.addEventListener('orientationchange', refit);
if (tg) try { tg.onEvent('viewportChanged', refit); } catch (e) { /* old client */ }
})();
