// Тир: drawing, the sight, sound and the flow of the game. The rules are in sim.js,
// the motion sensors in aim.js.
(() => {
'use strict';

const S = window.RangeSim;
const { W, H, GROUND, SUB, BOX, PER_ROUND, SHOTS } = S;
const STEP = 1000 / 60;
const BEST_KEY = 'range_best';
const AIM_KEY = 'range_aim';
const GAME = 'range';
const STRIP = 192; // the bottom strip: shots and the ten marks

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

const LANG = window.RangeStrings.pickLang(
  (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code) || navigator.language);
const T = window.RangeStrings.make(LANG);
if (LANG === 'en') {
  document.documentElement.lang = 'en';
  document.title = 'Shooting Range';
}
document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = T(el.dataset.t); });

const track = (type, ref) => {
  // A game on: closing the mini app asks first (../lib/back.js).
  if (window.Back && /^(game_start|game_finish|match_finished)$/.test(type)) window.Back.guard(type === 'game_start');
  try { if (window.GameEvents) window.GameEvents.send(type, GAME, ref); } catch (e) { /* ignore */ }
};

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

function tone(f1, f2, dur, type = 'square', vol = 0.07, delay = 0) {
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

let noiseBuf = null;
function noise(dur, vol, cutoff) {
  if (!actx) return;
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = actx.currentTime;
  const src = actx.createBufferSource();
  src.buffer = noiseBuf;
  const f = actx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f).connect(g).connect(actx.destination);
  src.start(t);
  src.stop(t + dur);
}

const notes = (list, step, dur) => list.forEach((f, i) => tone(f, 0, dur, 'square', 0.06, i * step));
const SFX = {
  shot: () => { noise(0.18, 0.45, 2400); haptic('light'); },
  hit: () => { tone(1320, 660, 0.12, 'square', 0.05); haptic('medium'); },
  double: () => { notes([1320, 1568, 1760], 0.05, 0.08); haptic('heavy'); },
  miss: () => {},
  away: () => tone(660, 990, 0.25, 'triangle', 0.05),
  fall: () => tone(900, 200, 0.35, 'square', 0.03),
  wave: () => tone(300, 500, 0.12, 'triangle', 0.05),
  pass: () => { notes([523, 659, 784, 1047], 0.09, 0.12); haptic('success'); },
  perfect: () => { notes([523, 659, 784, 1047, 1319, 1568], 0.08, 0.12); haptic('success'); },
  short: () => { notes([392, 330, 262], 0.15, 0.2); haptic('error'); },
  over: () => notes([523, 440, 349, 262], 0.2, 0.25),
  win: () => notes([523, 659, 784, 1047, 784, 1047, 1319], 0.1, 0.14),
  start: () => notes([392, 523, 659, 784], 0.1, 0.12),
  bomb: () => { noise(0.5, 0.6, 700); haptic('heavy'); },
  clock: () => { notes([1568, 1175, 784], 0.07, 0.1); haptic('medium'); },
  ammo: () => { notes([784, 1047], 0.06, 0.08); haptic('medium'); },
};

// ---------- Pictures (drawn by code, ASSETS.md) ----------
const $ = (id) => document.getElementById(id);
const canvas = $('screen');
let ctx = canvas.getContext('2d'); // swapped for a small canvas while a look preview draws
ctx.imageSmoothingEnabled = false;

function sprite(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const R = (x, y, rw, rh, col) => { g.fillStyle = col; g.fillRect(x, y, rw, rh); };
  draw(R, g);
  return c;
}

function fromRows(rows, pal) {
  return sprite(rows[0].length, rows.length, (R) => {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (pal[row[x]]) R(x, y, 1, 1, pal[row[x]]);
    });
  });
}
const flipX = (img) => sprite(img.width, img.height, (R, g) => { g.translate(img.width, 0); g.scale(-1, 1); g.drawImage(img, 0, 0); });
const flipY = (img) => sprite(img.width, img.height, (R, g) => { g.translate(0, img.height); g.scale(1, -1); g.drawImage(img, 0, 0); });

// A bird looking right, 16x16: wings up, wings down, hit.
const BIRD_ROWS = [
  ['................', '..WW............', '..WWW...........', '...WWW......HH..', '....WWW....HKHH.', '.....WWBBBBHHHOO',
    '....BBBBBBBBHH..', '...BBBBBBBBBB...', '..BB.BBBBBBB....', '.......DD.D.....', '................', '................',
    '................', '................', '................', '................'],
  ['................', '................', '................', '............HH..', '...........HKHH.', '......BBBBBBHHOO',
    '....BBBBBBBBHH..', '...BBWWWWBBBB...', '..BB..WWWWBB....', '.......WWW......', '.......DD.D.....', '................',
    '................', '................', '................', '................'],
  ['................', 'W..............W', 'WW....HHHH....WW', '.WW..HXHHXH..WW.', '..WWBHHHHHHBWW..', '...BBBHOOHBBB...',
    '....BBBBBBBB....', '....BBBBBBBB....', '.....BBBBBB.....', '......D..D......', '................', '................',
    '................', '................', '................', '................'],
  // Wings level, between up and down: the flap goes up, level, down, level.
  ['................', '................', '................', '............HH..', '...........HKHH.', '.WWWWWBBBBBHHHOO',
    '..WWWBBBBBBBHH..', '...BBBBBBBBBB...', '..BB.BBBBBBB....', '.......DD.D.....', '................', '................',
    '................', '................', '................', '................'],
];
const FLAP = [0, 3, 1, 3];
const BIRD_LOOKS = [
  { id: 'tin', pal: { B: '#a8b0c8', W: '#e0e4ee', H: '#8890a8', K: '#202028', X: '#ffffff', O: '#f8a020', D: '#505868' } },
  { id: 'wood', shop: 'range-birds-wood', tokens: 600, legacy: true, pal: { B: '#a8682c', W: '#d8a060', H: '#7a4818', K: '#201008', X: '#ffffff', O: '#f8d040', D: '#4a2810' } },
  { id: 'paper', shop: 'range-birds-paper', tokens: 1000, legacy: true, pal: { B: '#f0f0f0', W: '#e83838', H: '#d0d0d8', K: '#202028', X: '#e83838', O: '#f8a020', D: '#8888a0' } },
  // Sold for жетоны or stars in the shop (../lib/wallet.js); `tokens` is only the price shown offline.
  { id: 'robot', shop: 'range-birds-robot', tokens: 3500, pal: { B: '#38c868', W: '#a0f8b8', H: '#208048', K: '#f82020', X: '#f8f820', O: '#c0c0c8', D: '#103820' } },
  { id: 'candy', shop: 'range-birds-candy', tokens: 1500, pal: { B: '#f070b0', W: '#fff0f8', H: '#c04080', K: '#401020', X: '#ffffff', O: '#f8d040', D: '#802050' } },
  { id: 'neon', shop: 'range-birds-neon', tokens: 8000, pal: { B: '#202030', W: '#30f0f0', H: '#f030d0', K: '#f8f820', X: '#ffffff', O: '#30f070', D: '#080810' } },
];
const GOLD = { B: '#f8c020', W: '#fff090', H: '#d89000', K: '#402000', X: '#ffffff', O: '#f84020', D: '#906000' };
const DISC = fromRows(['...oooooo...', '.oyyyyyyyyo.', 'oyyyyyyyyyyo', '.oddddddddo.', '...oooooo...'], { o: '#a83810', y: '#f89840', d: '#c85820' });
// Extra targets (rules 2, sim.js): a bomb to leave alone, a clock that slows the others, a cartridge for one more shot.
const EXTRA_IMG = {
  bomb: fromRows(['..........yr....', '.........y..r...', '........kk......', '.......kkkk.....', '.....kkkkkkkk...', '....kkhkkkkkkk..',
    '...kkhhkkkkkkkk.', '...khhkkkkkkkkk.', '...kkkkkkkkkkkk.', '...kkkkkkkkkkkk.', '...kkkkkkkkkkkk.', '....kkkkkkkkkk..',
    '.....kkkkkkkk...', '.......kkkk.....', '................', '................'], { k: '#202028', h: '#686878', y: '#f8d020', r: '#f84020' }),
  clock: fromRows(['......rrrr......', '....rrwwwwrr....', '...rwwwwkwwwr...', '..rwwwwwkwwwwr..', '.rwwwwwwkwwwwwr.', '.rwwwwwwkwwwwwr.',
    'rwwwwwwwkwwwwwwr', 'rwkwwwwwkkkkwkwr', 'rwwwwwwwwwwwwwwr', '.rwwwwwwwwwwwwr.', '.rwwwwwwwwwwwwr.', '..rwwwwwkwwwwr..',
    '...rwwwwwwwwr...', '....rrwwwwrr....', '......rrrr......', '................'], { r: '#e83018', w: '#ffffff', k: '#202028' }),
  ammo: fromRows(['......yy........', '.....yyyy.......', '.....yyyy.......', '....rrrrrr......', '....rrrrrr......', '....rrrrrr......',
    '....rrrrrr......', '....rrrrrr......', '....rrrrrr......', '....rrrrrr......', '....rrrrrr......', '....dddddd......',
    '....dddddd......', '................', '................', '................'], { y: '#f8d878', r: '#38a838', d: '#c8a020' }),
};
const SHARDS = fromRows(['o..y....d..o', '.y...o.y..y.', '..d..y...o..'], { o: '#a83810', y: '#f89840', d: '#c85820' });

const birdCache = new Map();
function birdImg(lookId, kind, frame, left, falling) {
  const key = lookId + kind + frame + (left ? 'l' : 'r') + (falling ? 'f' : '');
  let img = birdCache.get(key);
  if (!img) {
    const pal = kind === 'gold' ? GOLD : (BIRD_LOOKS.find((b) => b.id === lookId) || BIRD_LOOKS[0]).pal;
    img = fromRows(BIRD_ROWS[frame], pal);
    if (left) img = flipX(img);
    if (falling) img = flipY(img);
    birdCache.set(key, img);
  }
  return img;
}

// Sights, drawn around (x, y).
const SIGHTS = [
  { id: 'cross', draw: (g, x, y, col) => {
    g.fillStyle = col;
    g.fillRect(x - 9, y, 6, 1); g.fillRect(x + 4, y, 6, 1); g.fillRect(x, y - 9, 1, 6); g.fillRect(x, y + 4, 1, 6);
    g.fillRect(x, y, 1, 1);
  } },
  { id: 'ring', shop: 'range-sight-ring', tokens: 600, legacy: true, draw: (g, x, y, col) => {
    g.fillStyle = col;
    for (let a = 0; a < 32; a++) {
      const k = (a / 32) * Math.PI * 2;
      g.fillRect(Math.round(x + Math.cos(k) * 7), Math.round(y + Math.sin(k) * 7), 1, 1);
    }
    g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3);
  } },
  { id: 'frame', shop: 'range-sight-frame', tokens: 1000, legacy: true, draw: (g, x, y, col) => {
    g.fillStyle = col;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.fillRect(sx < 0 ? x - 8 : x + 5, y + sy * 8, 4, 1);
      g.fillRect(x + sx * 8, sy < 0 ? y - 8 : y + 5, 1, 4);
    }
    g.fillRect(x, y, 1, 1);
  } },
  { id: 'laser', shop: 'range-sight-laser', tokens: 2500, draw: (g, x, y) => {
    g.fillStyle = 'rgba(255, 40, 40, 0.35)';
    g.fillRect(x - 3, y - 2, 7, 5); g.fillRect(x - 2, y - 3, 5, 7);
    g.fillStyle = '#ff3030';
    g.fillRect(x - 1, y - 1, 3, 3);
    g.fillStyle = '#ffffff';
    g.fillRect(x, y, 1, 1);
  } },
  { id: 'diamond', shop: 'range-sight-diamond', tokens: 1500, draw: (g, x, y, col) => {
    g.fillStyle = col;
    for (let i = 0; i < 7; i++) {
      g.fillRect(x - 7 + i, y - i, 1, 1); g.fillRect(x + 7 - i, y - i, 1, 1);
      g.fillRect(x - 7 + i, y + i, 1, 1); g.fillRect(x + 7 - i, y + i, 1, 1);
    }
    g.fillRect(x, y, 1, 1);
  } },
];

const SCENES = [
  { id: 'day', sky: ['#5c94fc', '#78a8fc'], cloud: '#ffffff', crown: '#1e8a2a', crownLight: '#48b848', trunk: '#7a4818', bush: '#2a9a2a', bushLight: '#58c848', ground: '#c88838', groundDark: '#a06820' },
  { id: 'sunset', shop: 'range-scene-sunset', tokens: 1000, legacy: true, sky: ['#382878', '#e86848'], cloud: '#f8b888', crown: '#1a4a2a', crownLight: '#2a6a38', trunk: '#3a2010', bush: '#1a5a2a', bushLight: '#2a7a38', ground: '#7a4828', groundDark: '#5a3018' },
  { id: 'night', shop: 'range-scene-night', tokens: 1500, legacy: true, sky: ['#080820', '#182048'], cloud: '#384068', crown: '#0e3018', crownLight: '#1a4a28', trunk: '#2a1808', bush: '#0e3a18', bushLight: '#1a5a28', ground: '#3a2a18', groundDark: '#281c10', stars: true },
  { id: 'winter', shop: 'range-scene-winter', tokens: 1500, legacy: true, sky: ['#a8c8e8', '#d8e8f8'], cloud: '#ffffff', crown: '#2a6a48', crownLight: '#f0f8ff', trunk: '#5a3818', bush: '#e8f0f8', bushLight: '#ffffff', ground: '#d8e4f0', groundDark: '#a8b8d0' },
  { id: 'autumn', shop: 'range-scene-autumn', tokens: 1500, sky: ['#7898c8', '#c8d8e8'], cloud: '#f0f0f0', crown: '#c86818', crownLight: '#f8b030', trunk: '#5a3010', bush: '#a04818', bushLight: '#e88828', ground: '#8a5a28', groundDark: '#6a4018' },
  { id: 'desert', shop: 'range-scene-desert', tokens: 2500, sky: ['#f0a848', '#f8e0a0'], cloud: '#fff4e0', crown: '#3a8a3a', crownLight: '#68b858', trunk: '#8a6030', bush: '#b89048', bushLight: '#e0c070', ground: '#e8c070', groundDark: '#c09848' },
];

// The backdrop is the same every frame: drawn once per scene.
const sceneCache = new Map();
function sceneImage(id) {
  let img = sceneCache.get(id);
  if (img) return img;
  const sc = SCENES.find((x) => x.id === id) || SCENES[0];
  img = sprite(W, STRIP, (R) => {
    const bands = 8;
    for (let i = 0; i < bands; i++) {
      const k = i / (bands - 1);
      const mix = (a, b) => Math.round(parseInt(a, 16) * (1 - k) + parseInt(b, 16) * k).toString(16).padStart(2, '0');
      const [a, b] = sc.sky;
      R(0, Math.floor((GROUND * i) / bands), W, Math.ceil(GROUND / bands) + 1,
        '#' + mix(a.slice(1, 3), b.slice(1, 3)) + mix(a.slice(3, 5), b.slice(3, 5)) + mix(a.slice(5, 7), b.slice(5, 7)));
    }
    if (sc.stars) {
      let seed = 99;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let i = 0; i < 40; i++) R(Math.floor(rnd() * W), Math.floor(rnd() * (GROUND - 40)), 1, 1, i % 5 ? '#c8c8f0' : '#ffffff');
      R(200, 18, 12, 12, '#f8f0c8'); R(198, 20, 16, 8, '#f8f0c8'); R(206, 18, 6, 6, sc.sky[0]);
    }
    const cloud = (x, y) => { R(x, y + 4, 28, 6, sc.cloud); R(x + 4, y, 12, 6, sc.cloud); R(x + 14, y + 2, 10, 4, sc.cloud); };
    cloud(30, 26); cloud(150, 44); cloud(212, 16);
    // Two ridges on the horizon, hazy with distance: colors lean to the sky the further they are.
    const blend = (a, b, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - k) + parseInt(b.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
    const base = GROUND + 8;
    const ridge = (k, h, f, p, col, top) => {
      for (let x = 0; x < W; x += 2) {
        const y = base - Math.round(h + 6 * Math.sin(x * f + p) + 3 * Math.sin(x * f * 2.7 + p * 2));
        R(x, y, 2, base - y, col);
        if (top) R(x, y, 2, 1, top);
      }
    };
    ridge(0, 30, 0.031, 1.2, blend(sc.sky[1], sc.crown, 0.3), blend(sc.sky[1], '#ffffff', 0.25));
    ridge(0, 16, 0.047, 4.1, blend(sc.sky[1], sc.crown, 0.6), null);
    // Far treetops along the near ridge.
    for (let x = 6; x < W; x += 13 + (x % 5)) {
      const y = base - Math.round(16 + 6 * Math.sin(x * 0.047 + 4.1) + 3 * Math.sin(x * 0.047 * 2.7 + 8.2));
      R(x - 2, y - 4, 5, 4, blend(sc.sky[1], sc.crown, 0.75)); R(x - 1, y - 6, 3, 2, blend(sc.sky[1], sc.crown, 0.75));
    }
    // A tree on the left, behind the bushes.
    R(28, 70, 10, GROUND - 70, sc.trunk);
    R(10, 30, 46, 46, sc.crown); R(16, 22, 34, 10, sc.crown); R(4, 44, 58, 24, sc.crown);
    for (let i = 0; i < 14; i++) R(10 + ((i * 17) % 44), 26 + ((i * 11) % 44), 4, 3, sc.crownLight);
    // Ground under the bushes.
    R(0, GROUND + 8, W, STRIP - GROUND - 8, sc.ground);
    for (let x = 0; x < W; x += 6) R(x + ((x / 6) % 2) * 3, GROUND + 14 + ((x / 6) % 3) * 5, 2, 1, sc.groundDark);
  });
  sceneCache.set(id, img);
  return img;
}

// The bushes in front: targets rise from behind them.
const bushCache = new Map();
function bushImage(id) {
  let img = bushCache.get(id);
  if (img) return img;
  const sc = SCENES.find((x) => x.id === id) || SCENES[0];
  img = sprite(W, 20, (R) => {
    for (let x = -6; x < W; x += 22) {
      R(x, 6, 26, 14, sc.bush); R(x + 4, 2, 18, 6, sc.bush); R(x + 8, 0, 10, 4, sc.bush);
      R(x + 6, 4, 4, 2, sc.bushLight); R(x + 14, 8, 3, 2, sc.bushLight);
    }
  });
  bushCache.set(id, img);
  return img;
}

// ---------- Appearance («Внешний вид») ----------
const LOOK_KEY = 'range_look';
const LOOK_CATS = [
  { key: 'sight', items: SIGHTS },
  { key: 'birds', items: BIRD_LOOKS },
  { key: 'scene', items: SCENES },
];
const LOOK_GROUPS = LOOK_CATS.map((c) => ({
  id: c.key,
  title: T('cat_' + c.key),
  items: c.items.map((it) => ({ id: it.id, name: T(c.key + '_' + it.id), stars: 0, shop: it.shop, tokens: it.tokens, legacy: it.legacy, draw: (g, size) => drawThumb(g, size, c.key, it.id) })),
}));
const look = {};
if (window.Looks) Object.assign(look, window.Looks.load(LOOK_KEY, LOOK_GROUPS));
for (const c of LOOK_CATS) if (!c.items.some((it) => it.id === look[c.key])) look[c.key] = c.items[0].id;
// A shop item the phone no longer owns (a refund) falls back to the first one.
const usable = (key) => {
  const c = LOOK_CATS.find((x) => x.key === key);
  const it = c.items.find((x) => x.id === look[key]) || c.items[0];
  return it.shop && !(window.Wallet && window.Wallet.owns(it.shop)) ? c.items[0] : it;
};

function drawThumb(g, size, key, id) {
  const tmp = document.createElement('canvas');
  tmp.width = 32;
  tmp.height = 32;
  const c = tmp.getContext('2d');
  c.imageSmoothingEnabled = false;
  const scene = key === 'scene' ? id : 'day';
  c.drawImage(sceneImage(scene), 100, GROUND - 26, 32, 32, 0, 0, 32, 32);
  if (key === 'scene') c.drawImage(bushImage(scene), 0, 0, 32, 20, 0, 22, 32, 20);
  if (key === 'birds') c.drawImage(birdImg(id, 'bird', 0, false, false), 8, 6);
  if (key === 'sight') (SIGHTS.find((x) => x.id === id) || SIGHTS[0]).draw(c, 16, 16, '#e02020');
  g.imageSmoothingEnabled = false;
  g.drawImage(tmp, 0, 0, size, size);
}

function openLook() {
  if (!window.Looks) return;
  window.Looks.open({
    key: LOOK_KEY,
    title: T('look_title'),
    doneText: T('look_done'),
    groups: LOOK_GROUPS,
    onChange: (sel) => { Object.assign(look, sel); },
    onClose: () => showMenu(),
  });
}

// ---------- The sight ----------
// mode: 'gyro' — the phone's tilt (aim.js), 'touch' — a finger or the mouse.
const aimCfg = { mode: 'gyro', speed: 100, ix: false, iy: false };
try { Object.assign(aimCfg, JSON.parse(localStorage.getItem(AIM_KEY)) || {}); } catch (e) { /* defaults */ }
const fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
// A computer has no sensors: it starts with the mouse.
if (fine && !localStorage.getItem(AIM_KEY)) aimCfg.mode = 'touch';
function saveAim() { try { localStorage.setItem(AIM_KEY, JSON.stringify(aimCfg)); } catch (e) { /* private mode */ } }

const aim = window.RangeAim.create({ width: W, height: STRIP, onStatus: () => aimPanelStatus() });
const applyAim = () => {
  aim.speed = aimCfg.speed / 100;
  aim.invertX = !!aimCfg.ix;
  aim.invertY = !!aimCfg.iy;
  document.body.classList.toggle('touchAim', aimCfg.mode !== 'gyro');
};
applyAim();
const pointer = { x: W / 2, y: STRIP / 2, seen: false }; // the finger / mouse sight
const sight = () => (aimCfg.mode === 'gyro' && aim.status === 'on' ? { x: aim.x, y: aim.y } : pointer);
let pendingShot = null;
let flash = null; // { x, y, t } — a ring where the last shot went

function fireAt(x, y) {
  if (!running || !state || state.phase !== 'fly') return;
  pendingShot = { x: Math.max(0, Math.min(W - 1, Math.round(x))), y: Math.max(0, Math.min(H - 1, Math.round(y))) };
}

// Screen point → field pixels (the canvas is scaled to fit).
function toField(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom };
}

$('game').addEventListener('pointerdown', (e) => {
  audio();
  if (aimCfg.mode === 'gyro' && aim.status === 'on') { const s = sight(); fireAt(s.x, s.y); return; }
  const p = toField(e);
  if (!p.inside) return;
  pointer.x = p.x;
  pointer.y = p.y;
  pointer.seen = true;
  fireAt(p.x, p.y);
});
$('game').addEventListener('pointermove', (e) => {
  if (aimCfg.mode === 'gyro' && aim.status === 'on') return;
  if (e.pointerType !== 'mouse') return;
  const p = toField(e);
  pointer.x = Math.max(0, Math.min(W - 1, p.x));
  pointer.y = Math.max(0, Math.min(H - 1, p.y));
  pointer.seen = true;
});
function padButton(el, onDown) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); audio(); el.classList.add('on'); onDown(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => el.classList.remove('on'));
}
padButton($('btnFire'), () => { const s = sight(); fireAt(s.x, s.y); });
padButton($('btnCenter'), () => { aim.recenter(); haptic('light'); });
$('btnCenter').setAttribute('aria-label', T('center_label'));
window.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    if (!$('overlay').classList.contains('hidden')) return;
    e.preventDefault();
    const s = sight();
    fireAt(s.x, s.y);
  }
});

// Sensors start on a tap (iOS asks for permission only then). Without them: the finger.
function startSensors() {
  if (aimCfg.mode !== 'gyro') return Promise.resolve('touch');
  if (aim.status === 'on') return Promise.resolve('on');
  return aim.start().then((s) => {
    if (s !== 'on') {
      aimCfg.mode = 'touch';
      saveAim();
      applyAim();
      toast(T('aim_fallback'));
    }
    return s;
  });
}

// The settings panel of the sight.
function aimPanelStatus() {
  const el = $('aimStatus');
  if (!el) return;
  const st = aimCfg.mode !== 'gyro' ? 'touch' : aim.status;
  el.textContent = T({ on: 'aim_status_on', wait: 'aim_status_wait', off: 'aim_status_off', denied: 'aim_status_denied', touch: 'aim_status_touch' }[st] || 'aim_status_off');
}
function renderAimPanel() {
  $('modeGyro').classList.toggle('on', aimCfg.mode === 'gyro');
  $('modeTouch').classList.toggle('on', aimCfg.mode !== 'gyro');
  for (const id of ['speedRow', 'invXRow', 'invYRow']) $(id).classList.toggle('hidden', aimCfg.mode !== 'gyro');
  $('speed').value = String(aimCfg.speed);
  $('speedText').textContent = T('aim_speed', { n: aimCfg.speed });
  $('invX').checked = !!aimCfg.ix;
  $('invY').checked = !!aimCfg.iy;
  aimPanelStatus();
}
function showAimPanel() {
  showOverlay(T('aim_title'), '', null, null, 'aim');
  renderAimPanel();
}
$('btnAim').addEventListener('click', () => { audio(); showAimPanel(); });
$('modeGyro').addEventListener('click', () => {
  aimCfg.mode = 'gyro';
  saveAim();
  applyAim();
  renderAimPanel();
  aim.start().then((s) => {
    if (s !== 'on') { aimCfg.mode = 'touch'; saveAim(); applyAim(); }
    renderAimPanel();
    if (s !== 'on') $('aimStatus').textContent = T(s === 'denied' ? 'aim_status_denied' : 'aim_status_off');
  });
});
$('modeTouch').addEventListener('click', () => { aimCfg.mode = 'touch'; saveAim(); applyAim(); aim.stop(); renderAimPanel(); });
$('speed').addEventListener('input', () => { aimCfg.speed = Number($('speed').value) || 100; saveAim(); applyAim(); renderAimPanel(); });
$('invX').addEventListener('change', () => { aimCfg.ix = $('invX').checked; saveAim(); applyAim(); });
$('invY').addEventListener('change', () => { aimCfg.iy = $('invY').checked; saveAim(); applyAim(); });
$('aimDone').addEventListener('click', () => showMenu());

// ---------- Drawing ----------
// Picture-only effects (lib/fx.js): feathers or shards and the points over each hit target.
const fxHit = new WeakSet();
let fxScore = 0;
function spotEffects(s) {
  if (!window.Fx) return;
  const fresh = s.targets.filter((t) => t.state === 'hit' && !fxHit.has(t));
  const gain = s.score - fxScore;
  fxScore = s.score;
  fresh.forEach((t, i) => {
    fxHit.add(t);
    const x = Math.floor(t.x / SUB) + BOX / 2, y = Math.floor(t.y / SUB) + BOX / 2;
    if (t.kind === 'disc') {
      Fx.burst(x, y, { n: 10, speed: 70, life: 500, grav: 220, size: 2, colors: ['#f89838', '#c85818', '#fff0c0'] });
    } else {
      const gold = t.kind === 'gold';
      const colors = t.kind === 'bomb' ? ['#f84020', '#f8d020', '#404048'] : t.kind === 'clock' ? ['#ffffff', '#e83018']
        : t.kind === 'ammo' ? ['#38a838', '#f8d878'] : gold ? ['#f8d020', '#fff8c0', '#c89000'] : ['#ffffff', '#c8c8c8', '#a87848'];
      Fx.burst(x, y, { n: t.kind === 'bomb' ? 16 : 9, speed: t.kind === 'bomb' ? 80 : 45, life: 650, grav: 60, size: 2, colors });
      if (t.kind === 'bomb') {
        Fx.shake(3, 250);
        Fx.popup(x, y - 10, '-' + S.BOMB_COST * S.mult(s.round), '#f84020');
        return;
      }
    }
    // Several targets in one shot share the points.
    const real = fresh.filter((v) => v.slot >= 0).length;
    if (gain > 0 && t.slot >= 0) Fx.popup(x, y - 10, Math.round(gain / real), real > 1 ? '#60f0ff' : '#f8d020');
  });
}

function render(s) {
  spotEffects(s);
  const scene = usable('scene').id;
  const birds = usable('birds').id;
  ctx.drawImage(sceneImage(scene), 0, 0);
  for (const t of s.targets) {
    if (t.state === 'gone') continue;
    const x = Math.floor(t.x / SUB), y = Math.floor(t.y / SUB);
    if (t.kind === 'disc') {
      if (t.state === 'fly' || t.state === 'away') ctx.drawImage(DISC, x + 2, y + 5);
      else if (t.state === 'hit') ctx.drawImage(SHARDS, x + 2, y + 6 + Math.floor((24 - t.hang) / 4));
      continue;
    }
    if (EXTRA_IMG[t.kind]) {
      if (t.state === 'hit' && t.kind === 'bomb') continue; // blown up: only the sparks are left
      ctx.drawImage(EXTRA_IMG[t.kind], x, y + (t.state === 'fall' ? 0 : ((t.age >> 3) & 1)));
      continue;
    }
    const left = t.vx < 0;
    if (t.state === 'hit') ctx.drawImage(birdImg(birds, t.kind, 2, false, false), x, y);
    else if (t.state === 'fall') ctx.drawImage(birdImg(birds, t.kind, 1, left, true), x, y);
    else ctx.drawImage(birdImg(birds, t.kind, FLAP[(t.age >> 2) & 3], left, false), x, y);
  }
  ctx.drawImage(bushImage(scene), 0, GROUND - 4);
  if (window.Fx) Fx.draw(ctx);
  // Hits in a row: the points multiplier in the corner.
  const combo = s.rules >= 2 ? S.comboOf(s.stats.streak) : 1;
  if (combo > 1 && window.Fx) Fx.digits(ctx, 'x' + combo, 12, 8, combo >= 4 ? '#f84020' : '#f8d020');
  // Where the last shot went: a quick ring.
  if (flash && s.frame - flash.t < 8) {
    ctx.strokeStyle = 'rgba(255, 255, 255, ' + (1 - (s.frame - flash.t) / 8) + ')';
    ctx.beginPath();
    ctx.arc(flash.x + 0.5, flash.y + 0.5, 3 + (s.frame - flash.t), 0, Math.PI * 2);
    ctx.stroke();
  }
  strip(s);
  if (running && (aimCfg.mode === 'gyro' || pointer.seen)) {
    const p = sight();
    const sg = usable('sight');
    const x = Math.round(p.x), y = Math.round(p.y);
    sg.draw(ctx, x + 1, y + 1, 'rgba(0, 0, 0, 0.6)');
    sg.draw(ctx, x, y, '#ff2020');
  }
}

// Bottom strip: shots left, the ten targets of the round (hit, missed, to come) and the line to reach.
const BULLET = fromRows(['.yy.', 'yyyy', 'yyyy', 'rrrr', 'rrrr', 'rrrr', 'rrrr', 'dddd'], { y: '#f8d878', r: '#c83018', d: '#801808' });
const MARK = { 0: '#ffffff', 1: '#e83018', 2: '#505058' };
function strip(s) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, STRIP, W, H - STRIP);
  ctx.fillStyle = '#202028';
  ctx.fillRect(6, STRIP + 6, 34, 20);
  const shots = s.phase === 'intro' ? SHOTS : s.shots;
  const gap = shots > SHOTS ? 7 : 10; // a cartridge can give a fourth shot
  for (let i = 0; i < Math.max(SHOTS, shots); i++) if (i < shots) ctx.drawImage(BULLET, 9 + i * gap, STRIP + 12);
  ctx.fillStyle = '#202028';
  ctx.fillRect(48, STRIP + 6, 202, 20);
  const blink = (s.frame >> 4) & 1;
  for (let i = 0; i < PER_ROUND; i++) {
    const m = s.marks[i];
    const now = s.phase === 'fly' && s.targets.some((t) => t.slot === i && t.state === 'fly');
    ctx.fillStyle = now && blink ? '#202028' : MARK[m];
    const x = 54 + i * 19;
    ctx.fillRect(x, STRIP + 10, 12, 8);
    ctx.fillRect(x + 8, STRIP + 8, 4, 3);
  }
  const need = S.needOf(s.round);
  ctx.fillStyle = '#f8d020';
  ctx.fillRect(52, STRIP + 21, need * 19 - 3, 2);
}

function fitCanvas() {
  const box = $('game').getBoundingClientRect();
  const full = Math.min(box.width / W, box.height / H);
  // Whole screen pixels per field pixel keep every pixel the same size. That is
  // used when it costs at most a tenth of the size; otherwise the field fills the space.
  const dpr = window.devicePixelRatio || 1;
  const n = Math.floor(full * dpr);
  const k = n >= 1 && n / dpr >= full * 0.9 ? n / dpr : full;
  canvas.style.width = Math.floor(W * k * dpr) / dpr + 'px';
  canvas.style.height = Math.floor(H * k * dpr) / dpr + 'px';
}
window.addEventListener('resize', fitCanvas);
if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe($('game'));

// ---------- HUD and screens ----------
let lastHud = '';
function hud(s) {
  const line = [s.score, s.round, loadBest()].join('|');
  if (line === lastHud) return;
  lastHud = line;
  $('score').textContent = String(s.score).padStart(6, '0');
  $('round').textContent = String(s.round + 1);
  $('need').textContent = String(S.needOf(s.round));
  $('best').textContent = String(Math.max(loadBest(), s.score));
}

let bannerText = '', toastUntil = 0, toastText = '', doubleUntil = 0;
function toast(text) { toastText = text; toastUntil = Date.now() + 1800; }
function banner(s) {
  let text = '', cls = '';
  if (s.phase === 'intro') text = T('banner_round', { n: s.round + 1 }) + '\n' + T('banner_need', { n: S.needOf(s.round) });
  else if (s.phase === 'tally') {
    text = s.roundHits === PER_ROUND ? T('banner_perfect', { n: S.perfectBonus(s.round) }) : s.lost ? T('banner_short') : T('banner_pass');
    if (s.lost) cls = 'over';
  } else if (s.phase === 'over' || s.phase === 'overDone') { text = s.won ? T('you_won') : T('game_over'); cls = s.won ? '' : 'over'; }
  else if (Date.now() < doubleUntil) text = T('banner_double');
  else if (Date.now() < toastUntil) { text = toastText; cls = 'toast'; }
  if (text + cls === bannerText) return;
  bannerText = text + cls;
  const el = $('banner');
  el.textContent = text;
  el.className = text ? cls : 'hidden';
}

function loadBest() {
  try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch (e) { return 0; }
}
function saveBest(score) {
  const best = Math.max(loadBest(), score);
  try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) { /* ignore */ }
  return best;
}

// The overlay shows the main menu, the sight settings or up to two buttons.
let overlayAction = null, altAction = null;
function showOverlay(title, html, button, action, panel, alt) {
  panel = panel || (button ? 'button' : 'menu');
  $('ovTitle').textContent = title;
  $('ovText').innerHTML = html;
  $('ovText').classList.toggle('hidden', !html);
  $('menu').classList.toggle('hidden', panel !== 'menu');
  $('aimPanel').classList.toggle('hidden', panel !== 'aim');
  $('ovHint').classList.toggle('hidden', panel !== 'menu');
  $('back').classList.toggle('hidden', panel !== 'menu');
  const btn = $('ovBtn');
  btn.classList.toggle('hidden', !button);
  btn.textContent = button || '';
  overlayAction = action;
  $('ovAlt').classList.toggle('hidden', !alt);
  $('ovAlt').textContent = alt ? alt.text : '';
  altAction = alt ? alt.action : null;
  $('ovShare').classList.add('hidden');
  $('ovPick').classList.add('hidden');
  $('ovMenu').classList.add('hidden');
  $('overlay').classList.remove('hidden');
}

function showMenu() {
  running = false;
  showOverlay(T('title'), T('intro') + '<br>' + T('best', { n: loadBest() }), null, null);
  $('ovHint').textContent = T(aimCfg.mode === 'gyro' ? 'hint_gyro' : 'hint_touch');
  showPick($('btnPick'));
  fetchTicket();
}

// The mode of the next game: '' the usual one, 'sudden' — «Без промаха» (sim.js).
let mode = '';

// «▦ Выбрать раунд» (../lib/progress.js): a cleared round stays open for good; a game can start
// from it or from the one after it. The server replays the game from that round too.
const canPick = () => !!window.Progress && window.Progress.open('range', S.ROUNDS).length > 1;
function showPick(btn) { btn.classList.toggle('hidden', !canPick()); }
function openPick() {
  audio();
  window.Progress.pick({ game: 'range', count: S.ROUNDS, cols: 5, onPick: (i) => { mode = ''; play(i); } });
}
$('btnPick').addEventListener('click', openPick);
$('ovPick').addEventListener('click', openPick);
if (window.Progress) window.Progress.load().then(() => { if (!$('menu').classList.contains('hidden')) showPick($('btnPick')); });

$('btnLook').addEventListener('click', () => { audio(); openLook(); });
$('ovBtn').addEventListener('click', () => {
  audio();
  const act = overlayAction;
  overlayAction = null;
  if (act) act();
});
$('ovAlt').addEventListener('click', () => {
  audio();
  const act = altAction;
  altAction = null;
  if (act) act();
});
$('btnPlay').addEventListener('click', () => { audio(); mode = ''; play(); });
$('btnSudden').addEventListener('click', () => { audio(); mode = 'sudden'; play(); });

function result(s) {
  return T('round_line', { n: s.round + 1 }) + '<br>' + T('hits_line', { hits: s.stats.hits, shots: s.stats.shots }) + '<br>' + T('score_line', { n: s.score });
}

// «Поделиться итогом»: the result goes to any Telegram chat with a link to the bot.
let shareText = '';
$('ovShare').addEventListener('click', () => {
  audio();
  track('share_clicked');
  const user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  const link = appLink(user && user.id ? 'ref_' + user.id + '-' + GAME : 'src_' + GAME);
  try {
    if (tg && tg.openTelegramLink) {
      tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(shareText));
      return;
    }
  } catch (e) { /* fall through */ }
  if (navigator.share) navigator.share({ text: shareText, url: link }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(shareText + '\n' + link).then(() => { $('ovShare').textContent = T('link_copied'); });
});

const BOT_NAME = (() => {
  let name = new URLSearchParams(location.search).get('bot');
  try {
    if (name) localStorage.setItem('prygskok_bot', name);
    else name = localStorage.getItem('prygskok_bot');
  } catch (e) { /* ignore */ }
  name = (name || '').replace(/[^A-Za-z0-9_]/g, '');
  return name || (window.CARTRIDGE && window.CARTRIDGE.bot) || 'yellow_cartridge_bot';
})();

// A link that opens the collection straight away, with the server's tunnel name after «__» (see ../menu.js).
function appLink(label) {
  let host = '';
  try { host = new URL((window.Server && window.Server.base) || '').hostname; } catch (e) { /* no server */ }
  const m = /^([a-z0-9-]{1,63})\.trycloudflare\.com$/.exec(host);
  return 'https://t.me/' + BOT_NAME + '?startapp=' + label + (m ? '__' + m[1] : '');
}

// ---------- Checked results: жетоны ----------
// The server deals the game's seed (a ticket) and replays the recorded shots itself
// (bot/range-replay.js), so only a game that really happened counts.
// Log: shots joined by «,», each «frames.x.y» in base36 — frames since the previous shot
// (from 1) and where, in field pixels; the last part «e<frames>» is the time after the last shot.
const MAX_REC_FRAMES = 60 * 60 * 60;
const QUIT_FRAMES = 20 * 60; // a game left in the middle counts after 20 s (bot/range-replay.js)
const ticket = { next: null, asking: false, waiters: [] };
const rec = { seed: 0, start: 0, mode: '', out: [], since: 0, frames: 0 };
const canCheck = () => !!(window.Server && window.Server.hasServer && tg && tg.initData);
// The unused ticket is kept on the phone: opening the game again does not ask for a new one.
const TICKET_KEY = 'range_ticket_' + ((tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) || 0);
try {
  const t = JSON.parse(localStorage.getItem(TICKET_KEY));
  if (t && Number.isSafeInteger(t.seed) && t.seed > 0 && Date.now() - t.at < 5 * 3600000) ticket.next = t;
} catch (e) { /* nothing kept */ }
function keepTicket() {
  try {
    if (ticket.next) localStorage.setItem(TICKET_KEY, JSON.stringify(ticket.next));
    else localStorage.removeItem(TICKET_KEY);
  } catch (e) { /* private mode */ }
}

function fetchTicket() {
  if (ticket.next && Date.now() - ticket.next.at > 5 * 3600000) ticket.next = null;
  if (!canCheck() || ticket.next || ticket.asking) return;
  ticket.asking = true;
  window.Server.request('POST', '/api/range/ticket')
    .then((r) => { if (r && Number.isSafeInteger(r.seed) && r.seed > 0) { ticket.next = { seed: r.seed, at: Date.now() }; keepTicket(); } })
    .catch(() => {})
    .then(() => {
      ticket.asking = false;
      ticket.waiters.splice(0).forEach((f) => f());
    });
}

// A game started before the ticket came would give no жетоны: wait for it a little.
function withTicket(ms) {
  if (!canCheck() || ticket.next) return Promise.resolve();
  fetchTicket();
  if (!ticket.asking) return Promise.resolve();
  return new Promise((done) => {
    ticket.waiters.push(done);
    setTimeout(done, ms);
  });
}

// One frame of the game, with the shot passed to the rules (or null).
function recStep(shot) {
  if (!rec.seed) return;
  if (++rec.frames > MAX_REC_FRAMES) { rec.seed = 0; return; }
  rec.since++;
  if (shot) {
    rec.out.push(rec.since.toString(36) + '.' + shot.x.toString(36) + '.' + shot.y.toString(36));
    rec.since = 0;
  }
}

// quit — the player leaves in the middle: the game so far is sent if it lasted QUIT_FRAMES.
function sendRun(quit) {
  if (!rec.seed || (quit && rec.frames < QUIT_FRAMES)) return Promise.resolve();
  if (rec.since > 0) rec.out.push('e' + rec.since.toString(36));
  const body = { seed: rec.seed, players: 1, log: rec.out.join(','), rules: S.RULES };
  if (rec.start) body.start = rec.start;
  if (rec.mode) body.mode = rec.mode;
  rec.seed = 0;
  rec.out = [];
  return window.Server.request('POST', '/api/range/run', body, { keepalive: quit })
    .then((r) => {
      if (!window.Wallet || !r) return;
      window.Wallet.grants(r.wallet);
      if (window.Wallet.achieved) window.Wallet.achieved(r.newAchievements);
    })
    .catch(() => {});
}
// The game in progress, when the page is left or closed.
const sendQuit = () => (state && state.phase !== 'overDone' ? sendRun(true) : Promise.resolve());
window.addEventListener('pagehide', () => { sendQuit(); });

// ---------- Game flow ----------
let state = null;
let running = false;
let starting = false;

// «Играть»: sensors on (from this tap), the ticket, then the sight is centred and the game starts.
// start — the round chosen on «▦ Выбрать раунд», 0 — from the first one.
function play(start) {
  if (starting) return;
  starting = true;
  const slow = setTimeout(() => document.body.classList.add('ui-starting'), 150);
  Promise.all([startSensors(), withTicket(3000)]).then(() => {
    clearTimeout(slow);
    document.body.classList.remove('ui-starting');
    starting = false;
    if (aimCfg.mode === 'gyro' && aim.status === 'on') {
      showOverlay(T('calib_title'), T('calib_text'), T('calib_btn'), () => { aim.recenter(); begin(start); }, null, {
        text: T('calib_touch'),
        action: () => { aimCfg.mode = 'touch'; saveAim(); applyAim(); aim.stop(); begin(start); },
      });
    } else begin(start);
  });
}

function begin(start) {
  start = start > 0 ? start : 0;
  // A game left unfinished is sent before the new one starts.
  if (state && running) sendQuit();
  const t = ticket.next;
  ticket.next = null;
  keepTicket();
  Object.assign(rec, { seed: t ? t.seed : 0, start, mode, out: [], since: 0, frames: 0 });
  state = S.newGame(t ? t.seed : (Date.now() & 0x7fffffff) || 1, { rules: S.RULES, mode });
  if (start) S.startRound(state, start); // the same as bot/range-replay.js
  fetchTicket();
  track('game_start');
  lastHud = '';
  pendingShot = null;
  flash = null;
  pointer.seen = false;
  $('overlay').classList.add('hidden');
  running = true;
  SFX.start();
}

function finished(s) {
  running = false;
  const best = saveBest(s.score);
  sendRun(false);
  track('game_finish');
  shareText = T('share_text', { n: S.cleared(s), score: s.score });
  showOverlay(s.won ? T('you_won') : T('game_over'), (s.mode === 'sudden' ? T('sudden_line') + '<br>' : '') + result(s) + '<br>' + T('best_line', { n: best }), T('btn_again'), () => play());
  $('ovShare').classList.remove('hidden');
  $('ovShare').textContent = T('btn_share');
  $('ovMenu').classList.remove('hidden');
  showPick($('ovPick'));
}

let last = 0, acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = last ? now - last : 0;
  last = now;
  if (state && running && !document.hidden) {
    acc += Math.min(dt, 100);
    while (acc >= STEP && running) {
      acc -= STEP;
      // Only a shot the rules can take is passed (and recorded).
      const shot = pendingShot && state.phase === 'fly' ? pendingShot : null;
      pendingShot = null;
      recStep(shot);
      S.step(state, shot);
      for (const ev of state.events) {
        if (SFX[ev]) SFX[ev]();
        if (ev === 'shot' && shot) flash = { x: shot.x, y: shot.y, t: state.frame };
        if (ev === 'double') doubleUntil = Date.now() + 900;
        if (ev === 'bomb' || ev === 'clock' || ev === 'ammo') toast(T('toast_' + ev));
      }
      state.events.length = 0;
      // A round with its tally passed is cleared: it stays open on «▦ Выбрать раунд».
      if (window.Progress && S.cleared(state) > state.round) window.Progress.mark('range', state.round);
      if (state.phase === 'overDone') finished(state);
    }
  } else acc = 0;
  if (state) {
    render(state);
    hud(state);
    banner(state);
  }
}

// The collection's settings can switch the game off; then only the way back is shown.
if (window.CARTRIDGE && !window.CARTRIDGE.isEnabled(GAME)) {
  showOverlay(T('title'), T('disabled'), null, null);
  $('menu').classList.add('hidden');
  $('ovHint').classList.add('hidden');
  $('back').classList.remove('hidden');
  return;
}

// «Назад» (../lib/back.js): in a game it pauses; anywhere else it goes to the list of games.
function leave() {
  // The game so far goes to the server first (up to 1.5 s), so it still counts.
  const go = () => {
    aim.stop();
    if (window.Back) window.Back.toMenu(); else location.href = '../';
  };
  Promise.race([sendQuit(), new Promise((r) => setTimeout(r, 1500))]).then(go);
}
function pause() {
  running = false;
  showOverlay(T('pause_title'), T('pause_text'), T('btn_continue'), () => {
    $('overlay').classList.add('hidden');
    running = true;
  }, null, aimCfg.mode === 'gyro' && aim.status === 'on' ? { text: T('center_label'), action: () => { aim.recenter(); $('overlay').classList.add('hidden'); running = true; } } : null);
  $('ovMenu').classList.remove('hidden');
}
function back() {
  const looks = document.querySelector('.looks .looksDone');
  if (looks) { looks.click(); return; }
  const inGame = state && running && $('overlay').classList.contains('hidden');
  if (inGame) pause();
  else if (!$('aimPanel').classList.contains('hidden')) showMenu();
  else leave();
}
if (window.Back) window.Back.attach(back, { menu: '../', label: T('back_label') });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') back(); });
$('ovMenu').addEventListener('click', () => { audio(); leave(); });
// Leaving the app for a moment pauses the game.
document.addEventListener('visibilitychange', () => { if (document.hidden && state && running) pause(); });

track('game_open');
fitCanvas();
// The range behind the menu, so the screen is not empty.
state = S.newGame(7);
render(state);
state = null;
showMenu();
requestAnimationFrame(frame);
})();
