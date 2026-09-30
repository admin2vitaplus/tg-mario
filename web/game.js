(() => {
'use strict';

// NES-like resolution: 16 tiles wide, 15 tiles high.
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
const touch = { left: false, right: false, a: false, b: false, turboA: false, turboB: false, bPressed: false };
const TURBO_MS = 67; // about 7.5 presses per second, like a turbo button

function bindControls() {
  const dpad = document.getElementById('dpad');
  const [btnL, btnR] = dpad.children;
  const pointers = new Map();
  const refresh = () => {
    const r = dpad.getBoundingClientRect();
    touch.left = false;
    touch.right = false;
    for (const x of pointers.values()) {
      if (x < r.left + r.width / 2) touch.left = true;
      else touch.right = true;
    }
    btnL.classList.toggle('on', touch.left);
    btnR.classList.toggle('on', touch.right);
  };
  dpad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio();
    dpad.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, e.clientX);
    refresh();
  });
  dpad.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e.clientX);
    refresh();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    dpad.addEventListener(name, (e) => { pointers.delete(e.pointerId); refresh(); });
  }

  // Dendy pad: A jumps, B runs while held and fires on each press.
  // Turbo buttons act as A/B pressed and released many times a second.
  const hold = (id, key, onPress) => {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio();
      touch[key] = true;
      if (onPress) onPress();
      el.classList.add('on');
    });
    for (const name of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(name, () => { touch[key] = false; el.classList.remove('on'); });
    }
  };
  hold('btnA', 'a');
  hold('btnB', 'b', () => { touch.bPressed = true; });
  hold('btnTA', 'turboA');
  hold('btnTB', 'turboB');
}

// ---------- HUD and overlay ----------
const $ = (id) => document.getElementById(id);

function hud(s) {
  $('score').textContent = String(s.score).padStart(6, '0');
  $('coins').textContent = '×' + String(s.coins).padStart(2, '0');
  $('lives').textContent = String(s.lives);
  $('time').textContent = String(Math.max(0, s.timeLeft)).padStart(3, '0');
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

function pix(scene, key, rows) {
  const w = Math.max(...rows.map((r) => r.length));
  const c = scene.textures.createCanvas(key, w, rows.length);
  const ctx = c.getContext();
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = PAL[row[x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
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
  pix(scene, 'hs0', [...HEAD, ...SMALL_BODY, ...SMALL_LEGS]);
  pix(scene, 'hs1', [...HEAD, ...SMALL_BODY, ...SMALL_LEGS_WALK]);
  pix(scene, 'hs2', [...HEAD, ...SMALL_BODY_JUMP, ...SMALL_LEGS_WALK]);
  pix(scene, 'hb0', [...HEAD, ...BIG_BODY, ...BIG_LEGS]);
  pix(scene, 'hb1', [...HEAD, ...BIG_BODY, ...BIG_LEGS_WALK]);
  pix(scene, 'hb2', [...HEAD, ...BIG_BODY_JUMP, ...BIG_LEGS_WALK]);

  // Fire outfit: white cap, red jacket.
  const fire = (rows) => rows.map((r) => r.replace(/J/g, 'F').replace(/C/g, 'W'));
  pix(scene, 'hf0', fire([...HEAD, ...BIG_BODY, ...BIG_LEGS]));
  pix(scene, 'hf1', fire([...HEAD, ...BIG_BODY, ...BIG_LEGS_WALK]));
  pix(scene, 'hf2', fire([...HEAD, ...BIG_BODY_JUMP, ...BIG_LEGS_WALK]));
  pix(scene, 'fireball', ['..FF..', '.FJJF.', 'FJWWJF', 'FJWWJF', '.FJJF.', '..FF..']);

  pix(scene, 'bug0', [...BUG_TOP, '..KK..KK..KK..KK', '.KK..KK..KK..KK.']);
  pix(scene, 'bug1', [...BUG_TOP, '.KK..KK..KK..KK.', '..KK..KK..KK..KK']);
  pix(scene, 'bugFlat', [
    ...Array(10).fill('................'),
    '..EEEEEEEEEEEE..',
    '.EEOOOEEEEOOOEE.',
    '.KKWWKKKKKKWWKK.',
    '..YYYYYYYYYYYY..',
    '.KK.KK.KK.KK.KK.',
    '................',
  ]);

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

  drawTiles(scene);
  drawScenery(scene);
}

// Tileset: one row of 16x16 tiles, index = tile id.
const T = { GROUND: 0, BRICK: 1, BONUS: 2, USED: 3, HARD: 4, PIPE_TL: 5, PIPE_TR: 6, PIPE_L: 7, PIPE_R: 8, POLE: 9, POLE_TOP: 10 };
const SOLID_MAX = 8;
// Draw order: scenery, items rising out of blocks, tiles, items, enemies, hero.
const DEPTH = { SCENERY: -10, SPROUT: -5, TILES: 0, ITEM: 5, ENEMY: 6, HERO: 10 };

function drawTiles(scene) {
  const count = 11;
  const c = scene.textures.createCanvas('tiles', TILE * count, TILE);
  const ctx = c.getContext();
  const r = (i, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(i * TILE + x, y, w, h); };

  // ground
  r(0, 0, 0, 16, 16, '#c0601c');
  r(0, 0, 0, 16, 1, '#f0a060');
  r(0, 0, 7, 16, 1, '#6b2a08');
  r(0, 7, 0, 1, 7, '#6b2a08');
  r(0, 3, 8, 1, 8, '#6b2a08');
  r(0, 11, 8, 1, 8, '#6b2a08');
  r(0, 0, 15, 16, 1, '#6b2a08');
  r(0, 2, 3, 1, 1, '#f0a060');
  r(0, 12, 11, 1, 1, '#f0a060');

  // brick
  r(1, 0, 0, 16, 16, '#b85418');
  r(1, 0, 0, 16, 1, '#e89060');
  for (const y of [3, 7, 11, 15]) r(1, 0, y, 16, 1, '#301000');
  for (const [y, xs] of [[0, [7, 15]], [4, [3, 11]], [8, [7, 15]], [12, [3, 11]]]) {
    for (const x of xs) r(1, x, y, 1, 3, '#301000');
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
  r(4, 0, 0, 16, 16, '#8a4a20');
  r(4, 0, 0, 16, 2, '#e0a070');
  r(4, 0, 0, 2, 16, '#e0a070');
  r(4, 14, 0, 2, 16, '#402008');
  r(4, 0, 14, 16, 2, '#402008');
  r(4, 4, 4, 8, 8, '#a05a28');

  // pipe lip left / right
  r(5, 0, 0, 16, 16, '#0a300a');
  r(5, 1, 1, 15, 14, '#30a030');
  r(5, 4, 1, 3, 14, '#a0f080');
  r(6, 0, 0, 16, 16, '#0a300a');
  r(6, 0, 1, 15, 14, '#30a030');
  r(6, 9, 1, 3, 14, '#107010');
  // pipe body left / right
  r(7, 2, 0, 14, 16, '#30a030');
  r(7, 2, 0, 1, 16, '#0a300a');
  r(7, 5, 0, 3, 16, '#a0f080');
  r(8, 0, 0, 13, 16, '#30a030');
  r(8, 13, 0, 1, 16, '#0a300a');
  r(8, 8, 0, 3, 16, '#107010');

  // flag pole and its top ball
  r(9, 7, 0, 2, 16, '#58d858');
  r(10, 7, 10, 2, 6, '#58d858');
  ctx.fillStyle = '#107010';
  ctx.beginPath();
  ctx.arc(10 * TILE + 8, 6, 4, 0, Math.PI * 2);
  ctx.fill();

  c.refresh();
  for (let i = 0; i < count; i++) c.add(i, 0, i * TILE, 0, TILE, TILE);
}

function drawScenery(scene) {
  let c = scene.textures.createCanvas('cloud', 40, 20);
  let ctx = c.getContext();
  ctx.fillStyle = '#ffffff';
  for (const [x, y, rad] of [[10, 12, 7], [20, 8, 9], [30, 12, 7]]) {
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(4, 12, 32, 7);
  c.refresh();

  c = scene.textures.createCanvas('hill', 80, 36);
  ctx = c.getContext();
  ctx.fillStyle = '#107010';
  ctx.beginPath();
  ctx.ellipse(40, 36, 40, 34, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#30a030';
  ctx.beginPath();
  ctx.ellipse(40, 37, 37, 32, 0, Math.PI, 0);
  ctx.fill();
  c.refresh();

  c = scene.textures.createCanvas('flag', 16, 16);
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

// ---------- Level ----------
// Chars: # ground, B brick, ? bonus (coin), M bonus (berry), L bonus (extra life), C brick with coins,
// H hard block, [ ] pipe lip, { } pipe body, o coin, e enemy, | pole, T pole top.
const TILE_OF = {
  '#': T.GROUND, 'B': T.BRICK, 'C': T.BRICK, '?': T.BONUS, 'M': T.BONUS, 'L': T.BONUS, 'H': T.HARD,
  '[': T.PIPE_TL, ']': T.PIPE_TR, '{': T.PIPE_L, '}': T.PIPE_R, '|': T.POLE, 'T': T.POLE_TOP,
};

function buildLevel() {
  const W = 212;
  const H = 15;
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const put = (x, y, ch) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = ch; };
  const row = (x, y, s) => { [...s].forEach((ch, i) => { if (ch !== ' ') put(x + i, y, ch); }); };
  const pipe = (x, h) => {
    const top = 13 - h;
    put(x, top, '['); put(x + 1, top, ']');
    for (let y = top + 1; y < 13; y++) { put(x, y, '{'); put(x + 1, y, '}'); }
  };
  const column = (x, h) => { for (let y = 13 - h; y < 13; y++) put(x, y, 'H'); };
  const stairsUp = (x, n) => { for (let i = 0; i < n; i++) column(x + i, i + 1); };
  const stairsDown = (x, n) => { for (let i = 0; i < n; i++) column(x + i, n - i); };

  for (let x = 0; x < W; x++) { put(x, 13, '#'); put(x, 14, '#'); }
  for (const [a, b] of [[62, 63], [90, 92], [158, 159]]) {
    for (let x = a; x <= b; x++) { put(x, 13, '.'); put(x, 14, '.'); }
  }

  row(12, 9, '?');
  row(17, 9, 'BMB?B');
  row(19, 5, '?');
  row(26, 7, 'ooo');
  pipe(31, 2);
  pipe(41, 3);
  row(52, 9, 'B??B');
  row(52, 6, ' oo ');
  pipe(56, 4);
  row(60, 8, 'oooooo');
  row(66, 9, 'B?B');
  row(68, 5, 'BBB?BBBB');
  row(80, 9, 'M');
  row(84, 9, 'C');
  stairsUp(86, 4);
  row(89, 4, 'oooo');
  stairsDown(93, 4);
  row(106, 9, '?B?B?');
  row(108, 5, 'M');
  pipe(116, 2);
  pipe(126, 3);
  row(127, 6, 'L');
  row(132, 9, 'BBBBBBBB');
  row(132, 8, 'oooooooo');
  stairsUp(152, 5);
  column(157, 5);
  stairsDown(160, 5);
  row(166, 9, 'B?B');
  pipe(176, 2);
  stairsUp(182, 8);
  column(190, 8);
  row(199, 3, 'T');
  for (let y = 4; y < 12; y++) put(199, y, '|');
  put(199, 12, 'H');

  for (const x of [24, 36, 47, 49, 70, 72, 100, 102, 104, 120, 122, 136, 138, 142, 144, 170, 172]) put(x, 12, 'e');

  return { grid: g, W, H, poleX: 199 };
}

// ---------- Game scene ----------
let started = false;

class Play extends Phaser.Scene {
  constructor() { super('play'); }

  init(data) {
    this.s = Object.assign({ lives: 3, score: 0, coins: 0 }, data || {});
    this.s.timeLeft = 300;
    this.big = false;
    this.fire = false;
    this.dead = false;
    this.won = false;
    this.invUntil = 0;
    this.bumpUntil = 0;
    this.prevJump = false;
    this.headHits = [];
  }

  create() {
    if (!this.textures.exists('tiles')) makeTextures(this);
    const cam = this.cameras.main;
    cam.setBackgroundColor('#6b8cff');

    const lvl = buildLevel();
    this.W = lvl.W;
    this.contents = new Map();
    const data = [];
    const coinSpots = [];
    const enemySpots = [];
    for (let y = 0; y < lvl.H; y++) {
      const line = [];
      for (let x = 0; x < lvl.W; x++) {
        const ch = lvl.grid[y][x];
        if (ch === '?') this.contents.set(x + ',' + y, { kind: 'coin', left: 1 });
        if (ch === 'M') this.contents.set(x + ',' + y, { kind: 'berry', left: 1 });
        if (ch === 'L') this.contents.set(x + ',' + y, { kind: 'life', left: 1 });
        if (ch === 'C') this.contents.set(x + ',' + y, { kind: 'coin', left: 8 });
        if (ch === 'o') coinSpots.push([x, y]);
        if (ch === 'e') enemySpots.push([x, y]);
        line.push(ch in TILE_OF ? TILE_OF[ch] : -1);
      }
      data.push(line);
    }

    // Scenery behind the level, with parallax.
    for (let x = 0; x < lvl.W * TILE; x += 190) {
      this.add.image(x + 60, 40 + (x % 3) * 12, 'cloud').setOrigin(0).setScrollFactor(0.5).setDepth(DEPTH.SCENERY);
    }
    for (let x = 0; x < lvl.W * TILE; x += 300) {
      this.add.image(x + 20, 13 * TILE, 'hill').setOrigin(0, 1).setScrollFactor(0.8).setDepth(DEPTH.SCENERY);
    }

    this.map = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    const tiles = this.map.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0);
    this.layer = this.map.createLayer(0, tiles, 0, 0).setDepth(DEPTH.TILES);
    this.layer.setCollisionBetween(0, SOLID_MAX);

    // Flag on the pole.
    const poleX = lvl.poleX * TILE + 8;
    this.flag = this.add.image(poleX - 8, 4 * TILE + 8, 'flag');

    // Hero.
    this.player = this.physics.add.sprite(3 * TILE + 8, 13 * TILE, 'hs0').setOrigin(0.5, 1).setDepth(DEPTH.HERO);
    this.player.body.setMaxVelocity(300, 420);
    this.applyBody();

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

    this.layerCollider = this.physics.add.collider(this.player, this.layer, (p, tile) => {
      if (p.body.blocked.up && tile.pixelY + TILE <= p.body.top + 2) this.headHits.push(tile);
    });
    this.physics.add.collider(this.enemies, this.layer);
    this.physics.add.collider(this.items, this.layer);
    this.physics.add.collider(this.fireballs, this.layer);
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

    const pole = this.add.zone(poleX, 3 * TILE, 4, 9 * TILE).setOrigin(0.5, 0);
    this.physics.add.existing(pole, true);
    this.physics.add.overlap(this.player, pole, () => this.win(lvl.poleX));

    const kb = this.input.keyboard;
    this.keys = kb.addKeys('LEFT,RIGHT,UP,DOWN,Z,X,A,S,SPACE,SHIFT');

    this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => {
        if (!started || this.dead || this.won) return;
        this.s.timeLeft--;
        hud(this.s);
        if (this.s.timeLeft <= 0) this.die();
      },
    });

    // The physics world outlives scene restarts, so its paused flag does too.
    if (started) this.physics.resume();
    else this.physics.pause();
    hud(this.s);
    window.__scene = this;
  }

  holdingA() {
    const k = this.keys;
    return k.UP.isDown || k.Z.isDown || k.SPACE.isDown || touch.a;
  }

  applyBody() {
    const b = this.player.body;
    if (this.big) { b.setSize(12, 22, false); b.setOffset(2, 2); }
    else { b.setSize(10, 14, false); b.setOffset(3, 2); }
  }

  setBig(big) {
    this.big = big;
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

    this.updateEnemies(time, cam);
    this.updateItems();
    this.updateFireballs();

    if (this.dead) return;

    if (this.won) {
      if (this.autoWalk) {
        b.setVelocityX(60);
        p.setTexture(this.heroTex() + (Math.floor(time / 110) % 2));
      }
      return;
    }

    if (p.y > VIEW_H + 24) { this.die(true); return; }

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
    const onGround = b.blocked.down;
    const dt = delta / 1000;

    // Horizontal movement with inertia.
    const maxV = run ? 150 : 90;
    let target = 0;
    if (left && !right) target = -maxV;
    else if (right && !left) target = maxV;
    let acc;
    if (!onGround) acc = 260;
    else if (target === 0) acc = 500;
    else if (b.velocity.x !== 0 && Math.sign(target) !== Math.sign(b.velocity.x)) acc = 800;
    else acc = 350;
    const vx = b.velocity.x;
    b.setVelocityX(vx < target ? Math.min(vx + acc * dt, target) : Math.max(vx - acc * dt, target));
    if (target !== 0) p.setFlipX(target < 0);

    // Jump: higher when running, shorter when the button is released early.
    if (jump && !this.prevJump && onGround) {
      b.setVelocityY(Math.abs(b.velocity.x) > 120 ? -330 : -300);
      SFX.jump();
    }
    this.prevJump = jump;
    if (b.velocity.y < 0) b.setGravityY(jump ? -500 : 300);
    else b.setGravityY(0);

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
    const want = Phaser.Math.Clamp(p.x - VIEW_W * 0.42, 0, this.W * TILE - VIEW_W);
    if (want > cam.scrollX) cam.scrollX = want;
    if (p.x - 6 < cam.scrollX) {
      p.x = cam.scrollX + 6;
      if (b.velocity.x < 0) b.setVelocityX(0);
    }

    // Sprite frame.
    const pre = this.heroTex();
    let frame = pre + '0';
    if (!onGround) frame = pre + '2';
    else if (Math.abs(b.velocity.x) > 5) frame = pre + (Math.floor(time / (run ? 70 : 110)) % 2);
    if (p.texture.key !== frame) p.setTexture(frame);
    p.setAlpha(time < this.invUntil && Math.floor(time / 60) % 2 ? 0.3 : 1);
  }

  updateEnemies(time, cam) {
    for (const e of this.enemies.getChildren().slice()) {
      const st = e.getData('state');
      if (st === 'idle' && e.x < cam.scrollX + VIEW_W + 24) {
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
        this.map.putTileAt(idx, tx, ty);
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
    const tile = this.map.getTileAt(tx, ty);
    if (!tile) return;
    tile.setVisible(false);
    const img = this.add.image(tx * TILE + 8, ty * TILE + 8, 'tiles', idx);
    this.tweens.add({
      targets: img,
      y: img.y - 6,
      duration: 80,
      yoyo: true,
      onComplete: () => { img.destroy(); tile.setVisible(true); },
    });
  }

  breakBrick(tx, ty) {
    this.map.removeTileAt(tx, ty);
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
      const jumpHeld = this.holdingA() || touch.turboA || this.keys.A.isDown;
      b.setVelocityY(jumpHeld ? -320 : -220);
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
        this.scene.restart({ lives: this.s.lives, score: this.s.score, coins: this.s.coins });
      } else {
        this.gameOver('ИГРА ОКОНЧЕНА');
      }
    });
  }

  gameOver(title) {
    const best = saveBest(this.s.score);
    this.physics.pause();
    showOverlay(title, `Счёт: ${this.s.score}<br>Рекорд: ${best}`, 'Играть снова', () => {
      this.scene.restart({});
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
          this.addScore(this.s.timeLeft * 50);
          this.gameOver('УРОВЕНЬ ПРОЙДЕН!');
        });
      },
    });
  }
}

// ---------- Boot ----------
bindControls();

$('ovBtn').addEventListener('click', () => {
  audio();
  $('overlay').classList.add('hidden');
  if (!started) {
    started = true;
    const scene = game.scene.getScene('play');
    scene.physics.resume();
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
  physics: { default: 'arcade', arcade: { gravity: { y: 1100 }, tileBias: 20 } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [Play],
});
window.__game = game;
})();
