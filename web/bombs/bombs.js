// Бомбодром: drawing, sound, controls and screens. Rules live in sim.js.
(() => {
'use strict';

const S = window.BombSim;
const { COLS, ROWS, TILE, TS, EMPTY, HARD, SOFT, BURN, UP, RIGHT, DOWN, LEFT } = S;
const VIEW_COLS = 15;
const W = VIEW_COLS * TILE, H = ROWS * TILE; // 240 x 208: the screen follows the player
const STEP = 1000 / 60;
const BEST_KEY = 'bombodrom_best';
const GAME = 'bombs';

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

// ---------- Language ----------
const LANG = window.BombStrings.pickLang(
  (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code) || navigator.language);
const T = window.BombStrings.make(LANG);
document.documentElement.lang = LANG;
for (const el of document.querySelectorAll('[data-t]')) el.textContent = T(el.dataset.t);
for (const el of document.querySelectorAll('[data-th]')) el.innerHTML = T(el.dataset.th);
for (const el of document.querySelectorAll('[data-tp]')) el.placeholder = T(el.dataset.tp);
document.title = T('title');

// Usage statistics for the bot (../lib/events.js); silently off without a server.
const track = (type, ref) => { try { if (window.GameEvents) window.GameEvents.send(type, GAME, ref); } catch (e) { /* ignore */ } };

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
let lastBoom = 0;
const SFX = {
  drop: () => tone(220, 160, 0.07, 'triangle', 0.12),
  boom: () => {
    // Several bombs in one frame make one blast, not a wall of noise.
    const t = Date.now();
    if (t - lastBoom < 60) return;
    lastBoom = t;
    noise(0.5, 0.5, 600);
    haptic('medium');
  },
  kill: () => tone(880, 220, 0.18, 'square', 0.05),
  die: () => { notes([523, 494, 440, 392, 349, 330], 0.08, 0.1); haptic('error'); },
  item: () => { notes([659, 784, 988, 1319], 0.06, 0.08); haptic('light'); },
  clear: () => { notes([523, 659, 784, 1047, 784, 1047], 0.09, 0.12); haptic('success'); },
  start: () => notes([392, 392, 523, 659, 784], 0.1, 0.12),
  over: () => notes([523, 440, 349, 262], 0.2, 0.25),
  hurry: () => { notes([988, 784, 988, 784], 0.08, 0.08); toast(T('hurry')); },
  spawn: () => tone(200, 600, 0.3, 'sawtooth', 0.05),
};

// ---------- Input ----------
// A pad per player; the direction is the most recently pressed one still held.
const makePad = () => ({ held: [false, false, false, false], stack: [], a: false, b: false });
const pads = [makePad()];

function setDir(pad, d, on) {
  if (on && !pad.held[d]) { pad.held[d] = true; pad.stack.push(d); }
  if (!on && pad.held[d]) { pad.held[d] = false; pad.stack = pad.stack.filter((x) => x !== d); }
}

function readPad(pad) {
  const out = { dir: pad.stack.length ? pad.stack[pad.stack.length - 1] : -1, a: pad.a, b: pad.b };
  pad.a = false;
  pad.b = false;
  return out;
}

function clearPads() {
  for (const p of pads) {
    p.held.fill(false);
    p.stack = [];
    p.a = false;
    p.b = false;
  }
}

const KEYS = {
  dir: { ArrowUp: UP, ArrowRight: RIGHT, ArrowDown: DOWN, ArrowLeft: LEFT, KeyW: UP, KeyD: RIGHT, KeyS: DOWN, KeyA: LEFT },
  a: ['Space', 'KeyZ', 'KeyJ', 'Enter'],
  b: ['KeyX', 'KeyK', 'ShiftLeft', 'ShiftRight'],
};

function onKey(e, down) {
  const pad = pads[0];
  if (e.code in KEYS.dir) { setDir(pad, KEYS.dir[e.code], down); e.preventDefault(); }
  if (KEYS.a.includes(e.code)) { if (down && !e.repeat) pad.a = true; e.preventDefault(); }
  if (KEYS.b.includes(e.code)) { if (down && !e.repeat) pad.b = true; e.preventDefault(); }
  if (down && (e.code === 'Enter' || e.code === 'Space') && !$('overlay').classList.contains('hidden')) {
    const btn = $('ovBtn');
    if (!btn.classList.contains('hidden')) btn.click();
  }
}
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  audio();
  onKey(e, true);
});
window.addEventListener('keyup', (e) => { if (e.target.tagName !== 'INPUT') onKey(e, false); });
window.addEventListener('blur', clearPads);

// Every finger is tracked by pointerId, so a thumb can slide between buttons
// without losing a press, and any number of fingers can be down at once.
function bindTouch() {
  const pad = pads[0];
  const dpad = document.getElementById('dpad');
  const btn = {};
  const names = ['up', 'right', 'down', 'left'];
  names.forEach((n) => { btn[n] = dpad.querySelector('.' + n); });
  const dirOn = [false, false, false, false];
  trackPointers(dpad, (points, r) => {
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const on = [false, false, false, false];
    for (const [x, y] of points) {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.hypot(dx, dy) < r.width * 0.12) continue;
      if (Math.abs(dx) > Math.abs(dy)) on[dx < 0 ? LEFT : RIGHT] = true;
      else on[dy < 0 ? UP : DOWN] = true;
    }
    on.forEach((v, d) => {
      if (dirOn[d] === v) return;
      dirOn[d] = v;
      setDir(pad, d, v);
      btn[names[d]].classList.toggle('on', v);
    });
  });

  // A puts a bomb, B sets off the remote bombs. A finger presses every button within reach.
  const actions = document.getElementById('actions');
  const keys = [['btnA', 'a'], ['btnB', 'b']].map(([id, key]) => ({ el: document.getElementById(id), key, on: false }));
  trackPointers(actions, (points) => {
    for (const k of keys) {
      const r = k.rect;
      const m = r.width * 0.22;
      const on = points.some(([x, y]) => x > r.left - m && x < r.right + m && y > r.top - m && y < r.bottom + m);
      if (on === k.on) continue;
      k.on = on;
      k.el.classList.toggle('on', on);
      if (on) pad[k.key] = true;
    }
  }, () => { for (const k of keys) k.rect = k.el.getBoundingClientRect(); });
}

// Calls update(points, rect) whenever a finger on `el` goes down, moves or lifts.
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

// ---------- Pixel art (all drawn in code, see ASSETS.md) ----------
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
  // A filled pixel circle.
  R.disc = (cx, cy, r, col) => {
    g.fillStyle = col;
    for (let dy = -r; dy <= r; dy++) {
      const w2 = Math.floor(Math.sqrt(r * r - dy * dy) + 0.3);
      g.fillRect(cx - w2, cy + dy, w2 * 2, 1);
    }
  };
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

const flip = (img) => sprite(img.width, img.height, (R, g) => { g.translate(img.width, 0); g.scale(-1, 1); g.drawImage(img, 0, 0); });

// Steel pillar: the same in every look.
const HARD_TILE = sprite(16, 16, (R) => {
  R(0, 0, 16, 16, '#8a8a96');
  R(0, 0, 16, 2, '#d8d8e4');
  R(0, 0, 2, 16, '#d8d8e4');
  R(0, 14, 16, 2, '#4a4a56');
  R(14, 0, 2, 16, '#4a4a56');
  R(5, 5, 6, 6, '#a8a8b4');
  R(5, 5, 6, 1, '#4a4a56');
  R(5, 5, 1, 6, '#4a4a56');
});

const DOOR = sprite(16, 16, (R) => {
  R(1, 1, 14, 15, '#3a2410');
  R(2, 2, 12, 14, '#c07830');
  R(3, 3, 4, 5, '#e09848');
  R(9, 3, 4, 5, '#e09848');
  R(3, 9, 4, 6, '#e09848');
  R(9, 9, 4, 6, '#e09848');
  R(7, 2, 2, 14, '#7a4818');
  R(10, 9, 2, 2, '#f8e070');
});

// Items: a dark tile with a picture.
function itemSprite(type) {
  return sprite(16, 16, (R) => {
    R(0, 0, 16, 16, '#f8f8f8');
    R(1, 1, 14, 14, '#2a2050');
    switch (type) {
      case 'bomb':
        R.disc(8, 9, 4, '#101010'); R(9, 3, 2, 3, '#a0a0a0'); R(11, 2, 2, 2, '#f8a020'); R(6, 7, 2, 2, '#707080');
        break;
      case 'fire':
        R(6, 3, 4, 10, '#e83800'); R(4, 6, 8, 7, '#e83800'); R(6, 7, 4, 6, '#f8a800'); R(7, 9, 2, 4, '#fff8c0');
        break;
      case 'speed':
        R(4, 3, 4, 8, '#38a8f8'); R(4, 10, 9, 3, '#38a8f8'); R(2, 4, 2, 1, '#fff'); R(1, 7, 3, 1, '#fff'); R(5, 11, 7, 1, '#fff');
        break;
      case 'remote':
        R(5, 3, 6, 10, '#c8c8d0'); R(6, 4, 4, 2, '#30d030'); R(7, 8, 2, 2, '#e82020'); R(7, 1, 1, 2, '#c8c8d0');
        break;
      case 'wallpass':
        R(2, 3, 12, 10, '#a84818'); R(2, 7, 12, 1, '#3c1c0a'); R(7, 3, 1, 4, '#3c1c0a'); R.disc(8, 8, 3, 'rgba(255,255,255,0.75)');
        break;
      case 'bombpass':
        R.disc(8, 9, 4, '#101010'); R(3, 3, 1, 10, '#fff'); R(12, 3, 1, 10, '#fff'); R(4, 8, 8, 1, '#f8e070');
        break;
      case 'flamepass':
        R(6, 3, 4, 10, '#e83800'); R(4, 6, 8, 7, '#e83800'); R(3, 4, 10, 1, '#60d0ff'); R(3, 4, 1, 9, '#60d0ff'); R(12, 4, 1, 9, '#60d0ff'); R(3, 12, 10, 1, '#60d0ff');
        break;
      default: // mystery
        R(5, 3, 6, 2, '#f8d020'); R(10, 4, 2, 4, '#f8d020'); R(7, 7, 4, 2, '#f8d020'); R(7, 8, 2, 2, '#f8d020'); R(7, 11, 2, 2, '#f8d020');
    }
  });
}
const ITEM = {};
for (const t of S.ITEMS) ITEM[t] = itemSprite(t);

// The hero, drawn for each look: helmet with a lamp, suit, boots. Frames by direction and step.
function heroFrame(col, dir, step) {
  return sprite(16, 16, (R) => {
    const side = dir === RIGHT || dir === LEFT;
    const leg = step & 1;
    R(4, 1, 8, 2, col.helm); R(3, 3, 10, 3, col.helm); R(6, 0, 4, 1, col.helm);
    R(4, 1, 3, 1, col.helmLight);
    if (side) {
      R(8, 6, 4, 3, col.face); R(10, 7, 1, 1, '#202020');
      R(4, 6, 4, 3, col.helm);
      R(5, 9, 6, 4, col.body); R(5, 11, 6, 1, col.shade);
      R(7, 10, 3, 3, col.shade); R(9, 12, 2, 1, col.face);
      if (leg) { R(5, 13, 2, 2, col.shade); R(9, 13, 2, 1, col.shade); R(4, 15, 3, 1, col.boot); R(9, 14, 3, 1, col.boot); }
      else { R(6, 13, 2, 2, col.shade); R(8, 13, 2, 2, col.shade); R(6, 15, 4, 1, col.boot); }
      R(12, 3, 1, 2, '#f8e070');
    } else {
      if (dir === DOWN) {
        R(4, 6, 8, 3, col.face); R(6, 7, 1, 1, '#202020'); R(9, 7, 1, 1, '#202020');
        R(7, 1, 2, 2, '#f8e070');
      } else R(4, 6, 8, 3, col.helm);
      R(4, 9, 8, 4, col.body); R(4, 11, 8, 1, col.shade);
      R(2, 9 + leg, 2, 3, col.body); R(12, 10 - leg, 2, 3, col.body);
      R(2, 12 + leg, 2, 1, col.face); R(12, 13 - leg, 2, 1, col.face);
      R(5, 13, 2, 2 - leg, col.shade); R(9, 13, 2, 1 + leg, col.shade);
      R(4, 15 - leg, 3, 1, col.boot); R(9, 14 + leg, 3, 1, col.boot);
    }
    if (col.band) R(3, 4, 10, 1, col.band);
  });
}

// Enemies, two frames each.
function enemyFrame(type, f) {
  return sprite(16, 16, (R) => {
    const bob = f ? 1 : 0;
    const eyes = (y, col = '#202020') => { R(5, y, 2, 2, '#fff'); R(9, y, 2, 2, '#fff'); R(6, y + 1, 1, 1, col); R(10, y + 1, 1, 1, col); };
    switch (type) {
      case 0: // Капля
        R.disc(8, 10, 5, '#f070a0'); R(7, 2 + bob, 2, 3, '#f070a0'); R(6, 4 + bob, 4, 2, '#f070a0'); R(5, 8, 2, 1, '#ffc0d8'); eyes(9);
        break;
      case 1: // Луковка
        R.disc(8, 10, 5, '#b060d0'); R(7, 2, 2, 4, '#60c040'); R(6 - bob, 3, 1, 2, '#60c040'); R(9 + bob, 3, 1, 2, '#60c040'); eyes(9); R(6, 13, 4, 1, '#602080');
        break;
      case 2: // Бочонок
        R(3, 3, 10, 12, '#a86828'); R(2, 5, 12, 8, '#a86828'); R(2, 5, 12, 1, '#584020'); R(2, 12, 12, 1, '#584020'); eyes(7 + bob); R(6, 11, 4, 1, '#3a2010');
        break;
      case 3: // Юла
        R(7, 2, 2, 12, '#f89020'); R(5, 4, 6, 8, '#f89020'); R(3, 6, 10, 4, '#f89020'); R(f ? 5 : 9, 4, 2, 8, '#f8d040'); R(7, 14, 2, 2, '#704010'); eyes(6);
        break;
      case 4: // Призрак
        R.disc(8, 7, 5, '#c8e8ff'); R(3, 7, 10, 7, '#c8e8ff');
        for (let x = 3; x < 13; x += 2) R(x, 14 + ((x >> 1) + f) % 2, 1, 1, '#c8e8ff');
        eyes(6, '#2040a0');
        break;
      case 5: // Медуза
        R.disc(8, 7, 6, '#30c070'); R(2, 7, 12, 2, '#30c070');
        for (let x = 3; x < 14; x += 3) R(x + (f && x % 2 ? 1 : 0), 9, 1, 5 + bob, '#208050');
        eyes(5);
        break;
      case 6: // Шарик
        R.disc(8, 8, 6, '#e83030'); R(5, 4, 3, 2, '#ff9090'); eyes(7); R(6, 11, 4, 1 + bob, '#601010');
        break;
      default: { // Искра
        const c = f ? '#f8f040' : '#ffffff';
        R(7, 1, 2, 14, c); R(1, 7, 14, 2, c); R(4, 4, 8, 8, '#f8a800'); R(3 + bob, 3 + bob, 2, 2, c); R(11 - bob, 11 - bob, 2, 2, c); eyes(6, '#a02000');
      }
    }
  });
}
const ENEMY_IMG = [];
for (let t = 0; t < 8; t++) ENEMY_IMG.push([enemyFrame(t, 0), enemyFrame(t, 1)]);
const ENEMY_DEAD = sprite(16, 16, (R) => { R.disc(8, 8, 5, '#f8f8f8'); R.disc(8, 8, 3, '#f8a020'); });

const BOMB = [5, 6].map((r) => sprite(16, 16, (R) => {
  R.disc(8, 9, r, '#101018');
  R(5, 6, 2, 2, '#707088');
  R(9, 1, 2, 3, '#b0a080');
}));

// ---------- Appearance («Внешний вид») ----------
const LOOK_KEY = 'bombodrom_look';
const HEROES = [
  { id: 'white', stars: 0, col: { helm: '#e8e8f0', helmLight: '#ffffff', body: '#f0f0f8', shade: '#9898b0', face: '#f8c890', boot: '#a03020' } },
  { id: 'red', stars: 0, col: { helm: '#d82828', helmLight: '#ff8080', body: '#f0f0f8', shade: '#a01818', face: '#f8c890', boot: '#401010' } },
  { id: 'blue', stars: 0, col: { helm: '#2860d8', helmLight: '#80b0ff', body: '#e0e8ff', shade: '#183888', face: '#f8c890', boot: '#101840' } },
  { id: 'green', stars: 0, col: { helm: '#28a048', helmLight: '#90e8a0', body: '#e8f8e8', shade: '#186030', face: '#f8c890', boot: '#103018' } },
  // Sold for жетоны or stars in the shop (../lib/wallet.js); `tokens` is only the price shown offline.
  { id: 'ninja', stars: 0, shop: 'bombs-hero-ninja', tokens: 300, col: { helm: '#202028', helmLight: '#505060', body: '#303040', shade: '#101018', face: '#f8c890', boot: '#101010', band: '#e02020' } },
];
const BLOCKS = [
  { id: 'brick', stars: 0, rows: ['hrrmhrrr', 'rrrmrrrr', 'rrrmrrrr', 'mmmmmmmm', 'rhrrrmhr', 'rrrrrmrr', 'rrrrrmrr', 'mmmmmmmm'], pal: { r: '#b05020', h: '#e88848', m: '#4a2410' } },
  { id: 'crates', stars: 0, rows: ['kkkkkkkk', 'kwhwwwwk', 'kwkwwkwk', 'kwwkkwwk', 'kwwkkwwk', 'kwkwwkwk', 'kwwwwwhk', 'kkkkkkkk'], pal: { w: '#b07830', h: '#e8b068', k: '#5a3410' } },
  { id: 'hedge', stars: 0, rows: ['.gGg.gG.', 'gGGggGGg', 'gGgGgGgG', 'ggggGggg', 'gGg.gGGg', 'GGggGgGg', 'gGgGggGg', 'gggggggg'], pal: { g: '#207020', G: '#60c038', '.': '#185818' } },
  { id: 'ice', stars: 0, rows: ['wiiiiiid', 'iwiiiiid', 'iiwiiiid', 'iiiiiiid', 'iiiiwiid', 'iiiiiwid', 'iiiiiiid', 'dddddddd'], pal: { i: '#90c8f0', w: '#ffffff', d: '#4878a8' } },
  { id: 'candy', stars: 0, shop: 'bombs-blocks-candy', tokens: 150, rows: ['pwwpwwpk', 'wwpwwpwk', 'wpwwpwwk', 'pwwpwwpk', 'wwpwwpwk', 'wpwwpwwk', 'pwwpwwpk', 'kkkkkkkk'], pal: { p: '#f05090', w: '#fff0f8', k: '#a02860' } },
];
const GROUNDS = [
  { id: 'grass', stars: 0, fill: '#2a7a2a', dots: ['#38903a', '#246a24'], shadow: '#1a5a1a' },
  { id: 'stone', stars: 0, fill: '#6a6a72', dots: ['#7a7a84', '#5a5a62'], shadow: '#44444c', grid: '#56565e' },
  { id: 'sand', stars: 0, fill: '#c8a868', dots: ['#d8b878', '#b09050'], shadow: '#987840' },
  { id: 'snow', stars: 0, fill: '#d8e4f0', dots: ['#ffffff', '#b8c8dc'], shadow: '#98a8c0' },
  { id: 'night', stars: 0, fill: '#141830', dots: ['#202848', '#0c1020'], shadow: '#080a18' },
];
const LOOK_CATS = [
  { key: 'hero', items: HEROES },
  { key: 'blocks', items: BLOCKS },
  { key: 'ground', items: GROUNDS },
];
const LOOK_GROUPS = LOOK_CATS.map((c) => ({
  id: c.key,
  title: T('cat_' + c.key),
  items: c.items.map((it) => ({ id: it.id, name: T(c.key + '_' + it.id), stars: it.stars, shop: it.shop, tokens: it.tokens, draw: (g, size) => drawThumb(g, size, c.key, it.id) })),
}));
const look = {};
if (window.Looks) Object.assign(look, window.Looks.load(LOOK_KEY, LOOK_GROUPS));
for (const c of LOOK_CATS) if (!c.items.some((it) => it.id === look[c.key])) look[c.key] = c.items[0].id;
const lookItem = (key) => { const c = LOOK_CATS.find((x) => x.key === key); return c.items.find((it) => it.id === look[key]) || c.items[0]; };
const knownHero = (id) => HEROES.some((h) => h.id === id);
// The second player always looks different from the first.
const partnerHero = (id) => (id === 'blue' ? 'red' : 'blue');

// Heroes of player 1 and 2 in the current game (online each brings their own).
let heroes = [look.hero, partnerHero(look.hero)];

const heroCache = new Map();
function heroImg(id, dir, step) {
  const key = id + dir + (step & 1);
  let img = heroCache.get(key);
  if (!img) {
    const col = (HEROES.find((h) => h.id === id) || HEROES[0]).col;
    img = heroFrame(col, dir === LEFT ? RIGHT : dir, step);
    if (dir === LEFT) img = flip(img);
    heroCache.set(key, img);
  }
  return img;
}

const blockCache = new Map();
function blockTile() {
  const b = lookItem('blocks');
  let img = blockCache.get(b.id);
  if (!img) {
    const small = fromRows(b.rows, b.pal);
    img = sprite(16, 16, (R, g) => { for (const [x, y] of [[0, 0], [8, 0], [0, 8], [8, 8]]) g.drawImage(small, x, y); });
    blockCache.set(b.id, img);
  }
  return img;
}

const groundCache = new Map();
function groundImage() {
  const gr = lookItem('ground');
  let img = groundCache.get(gr.id);
  if (!img) {
    let seed = 4242;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    img = sprite(COLS * TILE, ROWS * TILE, (R) => {
      R(0, 0, COLS * TILE, ROWS * TILE, gr.fill);
      if (gr.grid) for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { R(x * 16, y * 16 + 15, 16, 1, gr.grid); R(x * 16 + 15, y * 16, 1, 16, gr.grid); }
      for (let i = 0; i < 1600; i++) R(Math.floor(rnd() * COLS * TILE), Math.floor(rnd() * ROWS * TILE), 1 + (i % 3 === 0), 1, gr.dots[i % 2]);
    });
    groundCache.set(gr.id, img);
  }
  return img;
}

// Small pictures for the «Внешний вид» panel, drawn by the game's own code.
function drawThumb(g, size, key, id) {
  const saved = look[key];
  look[key] = id;
  const tmp = document.createElement('canvas');
  tmp.width = 32;
  tmp.height = 32;
  const main = ctx;
  ctx = tmp.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  try {
    ctx.drawImage(groundImage(), 0, 0);
    if (key === 'blocks') for (const [x, y] of [[0, 0], [16, 0], [0, 16], [16, 16]]) ctx.drawImage(blockTile(), x, y);
    else if (key === 'ground') { ctx.drawImage(HARD_TILE, 16, 0); ctx.drawImage(blockTile(), 0, 16); }
    else ctx.drawImage(heroImg(id, DOWN, 0), 8, 8);
  } finally {
    ctx = main;
    look[key] = saved;
  }
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
    onChange: (sel) => {
      Object.assign(look, sel);
      if (mode === 'local') heroes = [look.hero, partnerHero(look.hero)];
    },
    onClose: () => showMenu(),
  });
}

// ---------- Drawing ----------
// Whose screen this is: online the guest plays the second hero.
const me = () => (mode === 'guest' ? 1 : 0);
let camX = 0;

function drawFlame(x, y, kind, t) {
  // Grows, burns, then shrinks.
  const life = S.FLAME - t;
  const k = life < 4 || t < 4 ? 0 : life < 8 || t < 8 ? 1 : 2;
  const layers = [[14, '#e83800'], [10, '#f8a800'], [5, '#fff8d0']];
  for (const [w0, col] of layers) {
    const w = Math.max(2, w0 - (2 - k) * 4);
    const o = (16 - w) >> 1;
    ctx.fillStyle = col;
    if (kind === 0) { ctx.fillRect(x, y + o, 16, w); ctx.fillRect(x + o, y, w, 16); continue; }
    if (kind === 1) { ctx.fillRect(x, y + o, 16, w); continue; }
    if (kind === 2) { ctx.fillRect(x + o, y, w, 16); continue; }
    const dir = kind - 3; // the flame's end: shorter and rounded
    if (dir === UP) { ctx.fillRect(x + o, y + 4, w, 12); ctx.fillRect(x + o + 1, y + 2, w - 2, 2); }
    if (dir === DOWN) { ctx.fillRect(x + o, y, w, 12); ctx.fillRect(x + o + 1, y + 12, w - 2, 2); }
    if (dir === LEFT) { ctx.fillRect(x + 4, y + o, 12, w); ctx.fillRect(x + 2, y + o + 1, 2, w - 2); }
    if (dir === RIGHT) { ctx.fillRect(x, y + o, 12, w); ctx.fillRect(x + 12, y + o + 1, 2, w - 2); }
  }
}

function render(s) {
  const p = s.players[me()] || s.players[0];
  const gr = lookItem('ground');
  const target = Math.round(p.x / S.SUB) + 8 - W / 2;
  camX = Math.max(0, Math.min(COLS * TILE - W, target));
  ctx.save();
  ctx.translate(-camX, 0);
  ctx.drawImage(groundImage(), 0, 0);
  const c0 = Math.max(0, Math.floor(camX / TILE)), c1 = Math.min(COLS - 1, c0 + VIEW_COLS);
  const block = blockTile();
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const k = cy * COLS + cx;
      const c = s.cells[k];
      const x = cx * TILE, y = cy * TILE;
      if (c === HARD) {
        ctx.drawImage(HARD_TILE, x, y);
      } else if (c === SOFT) {
        ctx.drawImage(block, x, y);
      } else if (c === BURN) {
        const t = s.burn[k];
        ctx.globalAlpha = Math.max(0.15, t / S.FLAME);
        ctx.drawImage(block, x, y);
        ctx.globalAlpha = 1;
        ctx.fillStyle = (s.frame & 4) ? '#f8a800' : '#e83800';
        for (let i = 0; i < 6; i++) ctx.fillRect(x + ((i * 5 + s.frame) % 14), y + 2 + ((i * 7) % 12), 2, 3);
      } else if (c === EMPTY && cy > 0 && s.cells[k - COLS] !== EMPTY) {
        ctx.fillStyle = gr.shadow; // shade under a block
        ctx.fillRect(x, y, 16, 3);
      }
    }
  }
  if (s.door && s.cells[s.door[1] * COLS + s.door[0]] === EMPTY) ctx.drawImage(DOOR, s.door[0] * TILE, s.door[1] * TILE);
  const it = s.item;
  if (it && !it.taken && s.cells[it.y * COLS + it.x] === EMPTY && (s.frame & 16 || s.frame & 8)) ctx.drawImage(ITEM[it.type], it.x * TILE, it.y * TILE);
  for (const b of s.bombs) ctx.drawImage(BOMB[(s.frame >> 4) & 1], b.x * TILE, b.y * TILE);
  for (const b of s.bombs) {
    ctx.fillStyle = (s.frame & 4) ? '#f8f040' : '#e83800';
    ctx.fillRect(b.x * TILE + 10, b.y * TILE + 1, 2, 2);
  }
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      const k = cy * COLS + cx;
      if (s.fire[k]) drawFlame(cx * TILE, cy * TILE, s.fireKind[k], s.fire[k]);
    }
  }
  for (const e of s.enemies) {
    const x = Math.round(e.x / S.SUB), y = Math.round(e.y / S.SUB);
    if (e.dead) { if (e.dead & 4) ctx.drawImage(ENEMY_DEAD, x, y); continue; }
    if (e.wait && (s.frame & 4)) continue;
    ctx.drawImage(ENEMY_IMG[e.type][(s.frame >> 3) & 1], x, y);
  }
  for (const pl of s.players) {
    if (pl.out) continue;
    const x = Math.round(pl.x / S.SUB), y = Math.round(pl.y / S.SUB);
    if (!pl.alive) {
      if (pl.dieT > 50) continue;
      ctx.globalAlpha = 1 - pl.dieT / 60;
      ctx.drawImage(heroImg(heroes[pl.pi], (pl.dieT >> 3) % 4, 0), x, y);
      ctx.globalAlpha = 1;
      continue;
    }
    if ((pl.shield || pl.mystery) && (s.frame & 4)) ctx.globalAlpha = 0.45;
    ctx.drawImage(heroImg(heroes[pl.pi], pl.dir, pl.anim >> 3), x, y);
    ctx.globalAlpha = 1;
    // In a duel a small arrow marks your own hero.
    if (s.players.length > 1 && pl.pi === me()) {
      ctx.fillStyle = '#f8d020';
      ctx.fillRect(x + 6, y - 5, 4, 1);
      ctx.fillRect(x + 7, y - 4, 2, 1);
    }
  }
  ctx.restore();
  if (s.phase === 'intro') {
    const k = s.phaseT < 20 ? 1 - s.phaseT / 20 : s.phaseT > 100 ? (s.phaseT - 100) / 20 : 0;
    ctx.fillStyle = '#000';
    ctx.globalAlpha = Math.min(1, 0.35 + (1 - k) * 0.65);
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

// ---------- HUD and screens ----------
function fitCanvas() {
  const box = $('game').getBoundingClientRect();
  let k = Math.min(box.width / W, box.height / H);
  if (k >= 1) k = Math.floor(k * 2) / 2 || k;
  canvas.style.width = Math.floor(W * k) + 'px';
  canvas.style.height = Math.floor(H * k) + 'px';
}
window.addEventListener('resize', fitCanvas);
if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe($('game'));

let lastHud = '';
function hud(s) {
  const p = s.players[me()] || s.players[0];
  const duel = s.players.length > 1;
  const first = duel ? p.wins + ':' + s.players[1 - me()].wins : String(p.score).padStart(6, '0');
  const time = Math.max(0, Math.ceil(s.time / 60));
  const line = [first, p.lives, time, s.stage, duel].join('|');
  if (line === lastHud) return;
  lastHud = line;
  $('hudFirst').textContent = T(duel ? 'hud_wins' : 'hud_score');
  $('score').textContent = first;
  $('lives').textContent = String(Math.max(0, p.lives));
  $('time').textContent = String(time);
  $('time').classList.toggle('low', time <= 30);
  $('stage').textContent = String(s.stage + 1);
}

let bannerText = '', toastUntil = 0, toastText = '', itemSeen = false;
function toast(text) { toastText = text; toastUntil = Date.now() + 1800; }
function banner(s) {
  let text = '', cls = '';
  // A found item is named for a moment, so the player knows what it does.
  if (s.item && s.item.taken && !itemSeen) {
    itemSeen = true;
    if (s.item.by === me()) toast(T('item_got', { item: T('item_' + s.item.type) }));
  }
  if (s.item && !s.item.taken) itemSeen = false;
  if (s.phase === 'intro') text = T('banner_stage', { n: s.stage + 1 });
  else if (s.phase === 'over' || s.phase === 'overDone') { text = s.won ? T('you_won') : T('game_over'); cls = s.won ? '' : 'over'; }
  else if (Date.now() < toastUntil) { text = toastText; cls = 'toast'; }
  if (text === bannerText) return;
  bannerText = text;
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

// The overlay shows either the main menu, the online panel or one button.
let overlayAction = null;
function showOverlay(title, html, button, action, panel) {
  panel = panel || (button ? 'button' : 'menu');
  $('ovTitle').textContent = title;
  $('ovText').innerHTML = html;
  $('menu').classList.toggle('hidden', panel !== 'menu');
  $('ovHint').classList.toggle('hidden', panel !== 'menu');
  $('back').classList.toggle('hidden', panel !== 'menu');
  $('online').classList.toggle('hidden', panel !== 'online');
  $('ovText').classList.toggle('hidden', !html);
  const btn = $('ovBtn');
  btn.classList.toggle('hidden', !button);
  btn.textContent = button || '';
  overlayAction = action;
  $('ovShare').classList.add('hidden');
  $('ovMenu').classList.add('hidden');
  $('overlay').classList.remove('hidden');
}

function showMenu() {
  running = false;
  mode = 'local';
  view = null;
  netClose();
  showOverlay(T('title'), T('intro') + '<br>' + T('best', { n: loadBest() }), null, null);
  fetchTicket();
}

$('btnLook').addEventListener('click', () => { audio(); openLook(); });

$('ovBtn').addEventListener('click', () => {
  audio();
  const act = overlayAction;
  overlayAction = null;
  if (act) act();
});

$('btn1p').addEventListener('click', () => { audio(); begin(1); });

function soloResult(s) {
  const p = s.players[0];
  return T('stage_line', { n: s.stage + 1 }) + '<br>' + T('kills_line', { n: p.kills }) + '<br>' + T('score_line', { n: p.score });
}

function duelResult(s) {
  const mine = s.players[me()], other = s.players[1 - me()];
  return T('duel_wins', { me: mine.wins, friend: other.wins }) + '<br>' + T('score_line', { n: mine.score });
}

// «Поделиться итогом»: the result goes to any Telegram chat with a link to the bot.
let shareText = '';
function showShare(s) {
  if (s.players.length > 1) {
    shareText = T('share_duo', { me: s.players[me()].wins, friend: s.players[1 - me()].wins });
  } else shareText = T('share_solo', { n: s.stage + 1, score: s.players[0].score });
  $('ovShare').textContent = T('btn_share');
  $('ovShare').classList.remove('hidden');
}
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

// ---------- Online duel: two phones, one room ----------
// The host runs the game and sends the world 30 times a second; the guest
// only sends its buttons and draws what arrives, around its own hero.
const API_KEY = 'prygskok_api';
let apiProblem = '';
function apiBase() {
  let url = new URLSearchParams(location.search).get('api');
  try {
    if (url) localStorage.setItem(API_KEY, url);
    else url = localStorage.getItem(API_KEY);
  } catch (e) { /* ignore */ }
  if (!url) { apiProblem = 'none'; return ''; }
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.origin;
  } catch (e) { /* bad address */ }
  apiProblem = 'http';
  return '';
}
const API = apiBase();
// The menu no longer waits for the server check before opening a game (it can take
// seconds through the tunnel), so ?api= may be an old address: once lib/server.js has
// found the one that answers, that one is used.
const apiNow = () => (window.Server && window.Server.online && window.Server.base) || API;
const whenChecked = (fn) => {
  const s = window.Server;
  if (s && s.online === null && s.ready) s.ready.then(fn, fn); else fn();
};
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
  try { host = new URL(apiNow()).hostname; } catch (e) { /* no server */ }
  const m = /^([a-z0-9-]{1,63})\.trycloudflare\.com$/.exec(host);
  return 'https://t.me/' + BOT_NAME + '?startapp=' + label + (m ? '__' + m[1] : '');
}

let mode = 'local'; // local | host | guest
let view = null;    // what the guest draws
const net = {
  ws: null, code: '', token: '', started: false, remote: { dir: -1, a: false, b: false }, lastDir: -1, cellsKey: '', events: [],
  retry: null, ping: null, peerAway: false, resume: false, rematch: { me: false, peer: false }, guestHero: '',
};
const REJOIN_MS = 20000;
const HOST_AWAY_MS = 120000;

function netSend(msg) {
  if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(msg));
}

function netClose() {
  connectSeq++;
  const ws = net.ws;
  net.ws = null;
  net.code = '';
  net.token = '';
  net.started = false;
  net.peerAway = false;
  stopRetry();
  clearInterval(net.ping);
  if (ws) { ws.onclose = null; try { ws.close(1000); } catch (e) { /* ignore */ } }
}

// A leave (netClose) while the server check is still running cancels the connection.
let connectSeq = 0;
function connect(onOpen, onFail) {
  const seq = ++connectSeq;
  whenChecked(() => { if (seq === connectSeq) openSocket(onOpen, onFail); });
}

function openSocket(onOpen, onFail) {
  let ws;
  const auth = tg && tg.initData ? '?auth=' + encodeURIComponent(tg.initData) : '';
  try { ws = new WebSocket(apiNow().replace(/^http/, 'ws') + '/ws/bombs' + auth); } catch (e) { onFail(false); return; }
  net.ws = ws;
  let opened = false;
  const timer = setTimeout(() => { if (!opened && net.ws === ws) ws.close(); }, 10000);
  ws.onopen = () => {
    opened = true;
    clearTimeout(timer);
    clearInterval(net.ping);
    net.ping = setInterval(() => netSend({ t: 'ping' }), 20000);
    onOpen();
  };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } onNet(m); };
  ws.onclose = () => {
    if (net.ws !== ws) return;
    net.ws = null;
    clearTimeout(timer);
    clearInterval(net.ping);
    onFail(opened);
  };
}

function onDrop(opened) {
  if (net.retry) {
    clearTimeout(net.retry.timer);
    net.retry.timer = setTimeout(tryRejoin, 2000);
  } else if (net.token) startRetry();
  else lostLink(opened ? T('link_broke') + '<br>' + REOPEN : serverAlive ? NO_SERVER.ws : NO_SERVER.down);
}

function connectFresh(onOpen) {
  netClose();
  connect(onOpen, onDrop);
}

// ---------- Coming back after the link drops ----------
function startRetry() {
  if (net.retry) return;
  const limit = net.started ? REJOIN_MS : HOST_AWAY_MS;
  net.retry = { until: Date.now() + limit, timer: 0 };
  pauseOnline(T('link_lost_title'), T('reconnecting'));
  tryRejoin();
}

function tryRejoin() {
  const r = net.retry;
  if (!r) return;
  if (Date.now() > r.until) {
    const inGame = net.started;
    stopRetry();
    netClose();
    mode = 'local';
    lostLink(T('rejoin_late') + '<br>' + REOPEN, inGame);
    return;
  }
  connect(() => netSend({ t: 'rejoin', code: net.code, token: net.token }), onDrop);
}

function stopRetry() {
  if (net.retry) clearTimeout(net.retry.timer);
  net.retry = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !net.retry || net.ws) return;
  clearTimeout(net.retry.timer);
  tryRejoin();
});

function pauseOnline(title, text) {
  if (running) { net.resume = true; running = false; }
  showOverlay(title, text, T('btn_exit'), showMenu);
}

function resumeOnline() {
  if (net.retry || net.peerAway) return;
  if (!net.started) {
    if (mode === 'host') roomScreen();
    else if (mode === 'guest') showOverlay(T('room_n', { code: net.code }), T('in_room'), null, null, 'online');
    return;
  }
  if (mode === 'host') {
    net.cellsKey = '';
    if (net.resume) { net.resume = false; running = true; $('overlay').classList.add('hidden'); }
    else if (state) afterStep(state);
  } else {
    guestShown = 'wait';
    running = true;
  }
}

function lostLink(text, wasInGame) {
  const inGame = wasInGame || mode !== 'local';
  running = false;
  mode = 'local';
  netClose();
  if (inGame) showOverlay(T('lost_title'), text, T('btn_menu'), showMenu);
  else onlineMenu(text);
}

function roomScreen() {
  showOverlay(T('room'), T('room_code', { code: '<b class="code">' + net.code + '</b>' }) + '<br><br>' + T('duel_intro'), null, null, 'online');
  $('onlineStart').classList.add('hidden');
  $('btnInvite').classList.remove('hidden');
}

function hostStarts() {
  haptic('success');
  mode = 'host';
  net.started = true;
  begin(2);
}

function onNet(m) {
  if (m.t === 'room') {
    net.code = m.code;
    net.token = m.token || '';
    mode = 'host';
    net.guestHero = '';
    roomScreen();
  } else if (m.t === 'peer') {
    hostStarts();
  } else if (m.t === 'joined') {
    mode = 'guest';
    net.code = m.code;
    net.token = m.token || '';
    net.started = true;
    net.rematch = { me: false, peer: false };
    netSend({ t: 'look', hero: look.hero });
    clearPads();
    view = null;
    guestShown = 'wait';
    net.lastDir = -1;
    showOverlay(T('room_n', { code: m.code }), T('in_room') + '<br><br>' + T('duel_intro'), null, null, 'online');
    $('onlineStart').classList.add('hidden');
  } else if (m.t === 'rejoined') {
    stopRetry();
    haptic('success');
    net.peerAway = !m.peer;
    if (mode === 'guest') netSend({ t: 'look', hero: look.hero });
    if (mode === 'host' && m.peer && !net.started) hostStarts();
    else if (net.peerAway) pauseOnline(T('peer_lost_title'), T('peer_wait'));
    else resumeOnline();
  } else if (m.t === 'wait') {
    net.peerAway = true;
    if (mode === 'guest' && !view) pauseOnline(T('room_n', { code: net.code }), T('host_away'));
    else pauseOnline(T('peer_lost_title'), T('peer_wait'));
  } else if (m.t === 'back') {
    haptic('success');
    net.peerAway = false;
    if (mode === 'host' && !net.started) hostStarts();
    else resumeOnline();
  } else if (m.t === 'error') {
    const why = m.code ? T('err_' + m.code) : String(m.msg || '');
    if (net.retry) { stopRetry(); netClose(); lostLink(T('rejoin_failed', { why: why.toLowerCase() }), true); return; }
    netClose();
    onlineMenu(why);
  } else if (m.t === 'left') {
    lostLink(T('friend_left'));
  } else if (m.t === 'rematch') {
    net.rematch.peer = true;
    rematchScreen();
  } else if (m.t === 'look' && mode === 'host') {
    // The guest's own hero; one the host does not know, or the same as the host's, gets another colour.
    net.guestHero = knownHero(m.hero) && m.hero !== look.hero ? m.hero : '';
    heroes[1] = net.guestHero || partnerHero(look.hero);
  } else if (m.t === 'i' && mode === 'host') {
    net.remote.dir = m.d;
    if (m.a) net.remote.a = true;
    if (m.b) net.remote.b = true;
  } else if (m.t === 's' && mode === 'guest') {
    applySnapshot(m);
  }
}

function pressRematch() {
  net.rematch.me = true;
  netSend({ t: 'rematch' });
  rematchScreen();
}

function rematchScreen() {
  const s = state;
  if (!s || s.phase !== 'overDone' || net.peerAway || net.retry) return;
  if (net.rematch.me && net.rematch.peer) {
    if (mode === 'host') begin(2);
    else showOverlay(T('rematch_title'), T('rematch_go'), null, null, 'online');
    return;
  }
  const note = net.rematch.me ? T('rematch_wait') : net.rematch.peer ? T('rematch_peer') : '';
  const title = s.winner === me() ? T('duel_won') : s.winner >= 0 ? T('duel_lost') : T('game_over');
  showOverlay(title, duelResult(s) + (note ? '<br><br>' + note : ''),
    net.rematch.me ? T('btn_exit') : T('btn_rematch'), net.rematch.me ? showMenu : pressRematch);
  showShare(s);
}

const REOPEN = T('reopen', { bot: BOT_NAME });
const NO_SERVER = {
  none: T('no_server_none') + '<br>' + REOPEN,
  http: T('no_server_http') + '<br>' + REOPEN,
  down: T('no_server_down') + '<br>' + REOPEN,
  ws: T('no_server_ws'),
};
let serverAlive = false;

function onlineMenu(text) {
  running = false;
  mode = 'local';
  const html = API
    ? (text ? text + '<br>' : '') + T('online_menu') + '<br><br>' + T('duel_intro')
    : NO_SERVER[apiProblem];
  showOverlay(T('online_title'), html, null, null, 'online');
  $('onlineStart').classList.toggle('hidden', !API);
  $('btnInvite').classList.add('hidden');
  if (API && !text) checkServer();
}

function checkServer() {
  const ctl = window.AbortController ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), 6000);
  fetch(apiNow() + '/api/health', { mode: 'no-cors', signal: ctl ? ctl.signal : undefined })
    .then(() => { serverAlive = true; })
    .catch(() => {
      serverAlive = false;
      if (mode !== 'local' || $('online').classList.contains('hidden') || net.ws) return;
      $('ovText').innerHTML = NO_SERVER.down;
    })
    .finally(() => clearTimeout(timer));
}

$('btnOnline').addEventListener('click', () => { audio(); onlineMenu(); });
$('btnCancel').addEventListener('click', () => { audio(); showMenu(); });
$('btnCreate').addEventListener('click', () => {
  audio();
  showOverlay(T('online_title'), T('creating'), null, null, 'online');
  $('onlineStart').classList.add('hidden');
  connectFresh(() => netSend({ t: 'create' }));
});
function joinRoom(code) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) { onlineMenu(T('code_6')); return; }
  showOverlay(T('online_title'), T('joining', { code }), null, null, 'online');
  $('onlineStart').classList.add('hidden');
  connectFresh(() => netSend({ t: 'join', code }));
}
$('btnJoin').addEventListener('click', () => { audio(); joinRoom($('code').value); });
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('code').value); });
$('btnInvite').addEventListener('click', () => {
  // bomb_<code> opens the collection, and the menu sends the friend straight into this room (../menu.js).
  const link = appLink('bomb_' + net.code);
  const text = T('invite_text', { code: net.code });
  track('invite_created', net.code);
  try {
    if (tg && tg.openTelegramLink) {
      tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text));
      return;
    }
  } catch (e) { /* fall through */ }
  if (navigator.share) navigator.share({ text, url: link }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(text + '\n' + link).then(() => { $('btnInvite').textContent = T('link_copied'); });
});

// ---------- Snapshots: the host's world for the guest ----------
const packPlayer = (p) => [p.x, p.y, p.dir, p.anim, p.alive ? 1 : 0, p.dieT, p.lives, p.score, p.wins, p.out ? 1 : 0, p.shield, p.mystery, p.kills];
const unpackPlayer = (a, pi) => ({
  pi, x: a[0], y: a[1], dir: a[2], anim: a[3], alive: !!a[4], dieT: a[5], lives: a[6], score: a[7], wins: a[8], out: !!a[9], shield: a[10], mystery: a[11], kills: a[12],
});

function sendSnapshot(s) {
  const key = String.fromCharCode.apply(null, s.cells);
  const fire = [];
  for (let k = 0; k < s.fire.length; k++) if (s.fire[k] || s.burn[k]) fire.push([k, s.fire[k], s.fireKind[k], s.burn[k]]);
  const it = s.item;
  const m = {
    t: 's', f: s.frame, ph: s.phase, pt: s.phaseT, st: s.stage, tm: s.time, w: s.winner, won: s.won ? 1 : 0,
    pl: s.players.map(packPlayer),
    en: s.enemies.map((e) => [e.x, e.y, e.type, e.dead, e.wait || 0]),
    bo: s.bombs.map((b) => [b.x, b.y]),
    fi: fire,
    // The door and the item only once they are in the open, so the guest cannot peek under blocks.
    dr: s.cells[s.door[1] * COLS + s.door[0]] === EMPTY ? s.door : 0,
    it: it && (it.taken || s.cells[it.y * COLS + it.x] === EMPTY) ? [it.x, it.y, it.type, it.taken ? 1 : 0, it.by] : 0,
    ev: net.events,
    hs: heroes,
  };
  if (key !== net.cellsKey || s.frame % 120 === 0) { m.c = btoa(key); net.cellsKey = key; }
  netSend(m);
  net.events = [];
}

function applySnapshot(m) {
  if (!view) {
    const n = COLS * ROWS;
    view = { cells: new Uint8Array(n), fire: new Uint8Array(n), fireKind: new Uint8Array(n), burn: new Uint8Array(n) };
  }
  const v = view;
  Object.assign(v, {
    frame: m.f, phase: m.ph, phaseT: m.pt, stage: m.st, time: m.tm, winner: m.w, won: !!m.won,
    players: m.pl.map(unpackPlayer),
    enemies: m.en.map(([x, y, type, dead, wait]) => ({ x, y, type: type & 7, dead, wait })),
    bombs: m.bo.map(([x, y]) => ({ x, y })),
    door: Array.isArray(m.dr) ? m.dr : null,
    item: Array.isArray(m.it) && S.ITEMS.includes(m.it[2]) ? { x: m.it[0], y: m.it[1], type: m.it[2], taken: !!m.it[3], by: m.it[4] } : null,
  });
  if (m.c) {
    const raw = atob(m.c);
    for (let i = 0; i < raw.length && i < v.cells.length; i++) v.cells[i] = raw.charCodeAt(i);
  }
  v.fire.fill(0);
  v.burn.fill(0);
  for (const [k, t, kind, burn] of m.fi) {
    if (!(k >= 0 && k < v.fire.length)) continue;
    v.fire[k] = t;
    v.fireKind[k] = kind;
    v.burn[k] = burn;
  }
  if (Array.isArray(m.hs)) heroes = m.hs.map((id, i) => (knownHero(id) ? id : i ? partnerHero(look.hero) : look.hero));
  for (const ev of m.ev) if (SFX[ev]) SFX[ev]();
  state = v;
  guestScreens(v);
}

// The guest follows the host between stages.
let guestShown = '';
function guestScreens(v) {
  const done = v.phase === 'clearDone' || v.phase === 'overDone' ? v.phase : '';
  if (done === guestShown) return;
  guestShown = done;
  if (!done) {
    net.rematch = { me: false, peer: false };
    $('overlay').classList.add('hidden');
    running = true;
    return;
  }
  if (done === 'overDone') { track('match_finished', net.code); rematchScreen(); return; }
  showOverlay(T('stage_clear', { n: v.stage + 1 }), (v.winner === me() ? T('duel_you') : T('duel_friend')) + '<br>' + duelResult(v) + '<br><br>' + T('wait_friend_next'), T('btn_exit'), showMenu);
}

function guestTick() {
  const inp = readPad(pads[0]);
  if (inp.dir !== net.lastDir || inp.a || inp.b) {
    net.lastDir = inp.dir;
    netSend({ t: 'i', d: inp.dir, a: inp.a ? 1 : 0, b: inp.b ? 1 : 0 });
  }
}

function remotePad() {
  const r = net.remote;
  const out = { dir: Number.isInteger(r.dir) && r.dir >= -1 && r.dir <= 3 ? r.dir : -1, a: !!r.a, b: !!r.b };
  r.a = false;
  r.b = false;
  return out;
}

// ---------- Checked results: жетоны ----------
// The server deals the game's seed (a ticket) and replays the recorded buttons
// itself (bot/bombs-replay.js), so only a game that really happened counts.
// Log: steps joined by «,»; a step is the buttons' code in base36, «codexN»
// when repeated N times (N in base36 too); «n» is the move to the next stage.
// Code: (direction + 1) × 4 + A × 2 + B; for two players code1 × 20 + code2.
const MAX_REC_FRAMES = 60 * 60 * 60;
const ticket = { next: null, asking: false };
const rec = { seed: 0, players: 1, out: [], prev: -1, n: 0, frames: 0 };
const canCheck = () => !!(window.Server && window.Server.hasServer && tg && tg.initData);

function fetchTicket() {
  if (ticket.next && Date.now() - ticket.next.at > 5 * 3600000) ticket.next = null;
  if (!canCheck() || ticket.next || ticket.asking) return;
  ticket.asking = true;
  window.Server.request('POST', '/api/bombs/ticket')
    .then((r) => { if (r && Number.isSafeInteger(r.seed) && r.seed > 0) ticket.next = { seed: r.seed, at: Date.now() }; })
    .catch(() => {})
    .then(() => { ticket.asking = false; });
}

function recFlush() {
  if (rec.prev < 0) return;
  rec.out.push(rec.n > 1 ? rec.prev.toString(36) + 'x' + rec.n.toString(36) : rec.prev.toString(36));
  rec.prev = -1;
  rec.n = 0;
}

function recStep(inputs) {
  if (!rec.seed) return;
  if (++rec.frames > MAX_REC_FRAMES) { rec.seed = 0; return; }
  const code = (i) => (i.dir + 1) * 4 + (i.a ? 2 : 0) + (i.b ? 1 : 0);
  const c = rec.players === 1 ? code(inputs[0]) : code(inputs[0]) * 20 + code(inputs[1]);
  if (c === rec.prev) { rec.n++; return; }
  recFlush();
  rec.prev = c;
  rec.n = 1;
}

function recNext() {
  if (!rec.seed) return;
  recFlush();
  rec.out.push('n');
}

function sendRun(s) {
  if (!rec.seed || mode === 'guest') return;
  recFlush();
  const body = { seed: rec.seed, players: s.players.length, log: rec.out.join(',') };
  if (mode === 'host' && /^\d{4,8}$/.test(net.code)) body.room = net.code;
  rec.seed = 0;
  rec.out = [];
  window.Server.request('POST', '/api/bombs/run', body)
    .then((r) => { if (window.Wallet && r) window.Wallet.grants(r.wallet); })
    .catch(() => {});
}

// ---------- Game flow ----------
let state = null;
let running = false;

function begin(players) {
  heroes = [look.hero, mode === 'host' && net.guestHero ? net.guestHero : partnerHero(look.hero)];
  net.remote = { dir: -1, a: false, b: false };
  net.rematch = { me: false, peer: false };
  net.resume = false;
  net.cellsKey = '';
  net.events = [];
  clearPads();
  const t = mode !== 'guest' && ticket.next;
  ticket.next = null;
  Object.assign(rec, { seed: t ? t.seed : 0, players, out: [], prev: -1, n: 0, frames: 0 });
  state = S.newGame(players, t ? t.seed : (Date.now() & 0x7fffffff) || 1);
  fetchTicket();
  track('game_start');
  lastHud = '';
  itemSeen = false;
  $('overlay').classList.add('hidden');
  running = true;
}

function afterStep(s) {
  if (s.phase === 'clearDone') {
    running = false;
    const duel = s.players.length > 1;
    const text = duel ? (s.winner === me() ? T('duel_you') : T('duel_friend')) + '<br>' + duelResult(s) : soloResult(s);
    showOverlay(T('stage_clear', { n: s.stage + 1 }), text, T('btn_next'), () => {
      recNext();
      S.startStage(s, s.stage + 1);
      clearPads();
      $('overlay').classList.add('hidden');
      running = true;
    });
  } else if (s.phase === 'overDone') {
    running = false;
    const best = saveBest(s.players[0].score);
    sendRun(s);
    if (mode === 'local') track('game_finish');
    if (mode === 'host') {
      track('match_finished', net.code);
      rematchScreen();
    } else {
      showOverlay(s.won ? T('you_won') : T('game_over'), soloResult(s) + '<br>' + T('best_line', { n: best }), T('btn_again'), () => begin(1));
      showShare(s);
    }
  }
  if (mode === 'host' && !running) sendSnapshot(s);
}

let last = 0, acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = last ? now - last : 0;
  last = now;
  if (mode === 'guest') {
    if (running) {
      acc += Math.min(dt, 100);
      while (acc >= STEP) { acc -= STEP; guestTick(); }
    }
  } else if (state && running && (!document.hidden || mode === 'host')) {
    acc += Math.min(dt, 100);
    while (acc >= STEP && running) {
      acc -= STEP;
      const inputs = mode === 'host' ? [readPad(pads[0]), remotePad()] : [readPad(pads[0])];
      recStep(inputs);
      S.step(state, inputs);
      for (const ev of state.events) if (SFX[ev]) SFX[ev]();
      if (mode === 'host') net.events.push(...state.events);
      state.events.length = 0;
      afterStep(state);
      if (mode === 'host' && running && state.frame % 2 === 0) sendSnapshot(state);
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

// «Назад» (../lib/back.js): in a game it pauses (a duel keeps going for the friend);
// in the online panel it returns to this game's menu; anywhere else to the list of games.
function leave() {
  netClose();
  if (window.Back) window.Back.toMenu(); else location.href = '../';
}
function back() {
  const looks = document.querySelector('.looks .looksDone');
  if (looks) { looks.click(); return; }
  const inGame = state && $('overlay').classList.contains('hidden') && (running || mode === 'guest');
  if (inGame) {
    const online = mode !== 'local';
    if (!online) running = false;
    showOverlay(T('pause_title'), online ? T('pause_online') : T('pause_text'), T('btn_continue'), () => {
      $('overlay').classList.add('hidden');
      if (!online) running = true;
    });
    $('ovMenu').classList.remove('hidden');
  } else if (!$('online').classList.contains('hidden') && mode === 'local' && !net.ws) showMenu();
  else leave();
}
if (window.Back) window.Back.attach(back, { menu: '../', label: T('back_label') });
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') back(); });
$('ovMenu').addEventListener('click', () => { audio(); leave(); });

track('game_open');
bindTouch();
fitCanvas();
// A stage behind the menu, so the screen is not empty.
state = S.newGame(1, 7);
state.phase = 'play';
render(state);
state = null;
showMenu();
const invited = new URLSearchParams(location.search).get('room');
if (invited && API) {
  $('code').value = invited;
  joinRoom(invited);
}
requestAnimationFrame(frame);
})();
