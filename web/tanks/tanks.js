// Танкодром: drawing, sound, controls and screens. Rules live in sim.js.
(() => {
'use strict';

const S = window.TankSim;
const { CELL, N, FIELD, BRICK, STEEL, WATER, FOREST, ICE, UP, RIGHT, DOWN, LEFT } = S;
const W = 256, H = 224, OX = 16, OY = 8;
const STEP = 1000 / 60;
const BEST_KEY = 'tankodrom_best';

// ---------- Telegram ----------
const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  try {
    tg.ready();
    tg.expand();
    if (tg.isVersionAtLeast('6.1')) {
      tg.setHeaderColor('#000000');
      tg.setBackgroundColor('#000000');
      tg.BackButton.show();
      tg.BackButton.onClick(() => { location.href = '../'; });
    }
    if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes();
  } catch (e) { /* not inside Telegram */ }
}

// ---------- Language ----------
const LANG = window.TankStrings.pickLang(
  (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code) || navigator.language);
const T = window.TankStrings.make(LANG);
document.documentElement.lang = LANG;
// Static page text: elements carry data-t (text) or data-th (with line breaks).
for (const el of document.querySelectorAll('[data-t]')) el.textContent = T(el.dataset.t);
for (const el of document.querySelectorAll('[data-th]')) el.innerHTML = T(el.dataset.th);
for (const el of document.querySelectorAll('[data-tp]')) el.placeholder = T(el.dataset.tp);
document.title = T('title');

// Usage statistics for the bot (../lib/events.js); silently off without a server.
const track = (type, ref) => { try { if (window.GameEvents) window.GameEvents.send(type, 'tanks', ref); } catch (e) { /* ignore */ } };

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
  fire: () => tone(520, 180, 0.08, 'square', 0.05),
  brick: () => noise(0.12, 0.25, 1200),
  steel: () => tone(1400, 1100, 0.05, 'square', 0.04),
  armor: () => tone(900, 700, 0.06, 'triangle', 0.12),
  kill: () => noise(0.35, 0.4, 700),
  pdie: () => { noise(0.6, 0.5, 500); haptic('error'); },
  base: () => { noise(1.0, 0.6, 400); haptic('error'); },
  stun: () => tone(300, 200, 0.2, 'triangle', 0.1),
  bonus: () => notes([784, 988, 784, 988], 0.06, 0.06),
  pick: () => { notes([523, 784, 1047], 0.06, 0.08); haptic('light'); },
  life: () => notes([659, 784, 1047, 1319], 0.08, 0.1),
  start: () => notes([392, 523, 659, 784, 659, 784], 0.1, 0.12),
  over: () => notes([523, 440, 349, 262], 0.2, 0.25),
};

// ---------- Input ----------
// A pad per player; the direction is the most recently pressed one still held.
const makePad = () => ({ held: [false, false, false, false], stack: [], fire: false, turbo: new Set(), turboT: 0 });
const pads = [makePad(), makePad()];

function setDir(pad, d, on) {
  if (on && !pad.held[d]) { pad.held[d] = true; pad.stack.push(d); }
  if (!on && pad.held[d]) { pad.held[d] = false; pad.stack = pad.stack.filter((x) => x !== d); }
}

function readPad(pad) {
  let fire = pad.fire;
  pad.fire = false;
  if (pad.turbo.size) {
    if (--pad.turboT <= 0) { fire = true; pad.turboT = 8; }
  } else pad.turboT = 0;
  return { dir: pad.stack.length ? pad.stack[pad.stack.length - 1] : -1, fire };
}

function clearPads() {
  for (const p of pads) {
    p.held.fill(false);
    p.stack = [];
    p.fire = false;
    p.turbo.clear();
  }
}

// Keyboard layouts: one player may use arrows or WASD; two players split them.
const KEYS_1P = [{
  dir: { ArrowUp: UP, ArrowRight: RIGHT, ArrowDown: DOWN, ArrowLeft: LEFT, KeyW: UP, KeyD: RIGHT, KeyS: DOWN, KeyA: LEFT },
  fire: ['Space', 'KeyZ', 'KeyX', 'KeyJ', 'Enter'],
  turbo: ['KeyC', 'KeyK'],
}];
const KEYS_2P = [
  { dir: { KeyW: UP, KeyD: RIGHT, KeyS: DOWN, KeyA: LEFT }, fire: ['Space', 'KeyF'], turbo: ['KeyG'] },
  { dir: { ArrowUp: UP, ArrowRight: RIGHT, ArrowDown: DOWN, ArrowLeft: LEFT }, fire: ['Enter', 'KeyL', 'Numpad0'], turbo: ['KeyK', 'Numpad1'] },
];
let keyMap = KEYS_1P;

function onKey(e, down) {
  keyMap.forEach((m, pi) => {
    const pad = pads[pi];
    if (e.code in m.dir) { setDir(pad, m.dir[e.code], down); e.preventDefault(); }
    if (m.fire.includes(e.code)) { if (down && !e.repeat) pad.fire = true; e.preventDefault(); }
    if (m.turbo.includes(e.code)) { if (down) pad.turbo.add(e.code); else pad.turbo.delete(e.code); e.preventDefault(); }
  });
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

// Both pads track every finger by pointerId and work out the pressed buttons
// from where the fingers are, so a thumb can slide between buttons without
// losing a press, and any number of fingers can be down at once.
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
      // A tank moves along one axis only, so the thumb picks the dominant one.
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

  // Two-button retro pad: A and B both fire; the turbo buttons keep firing while held.
  // A finger presses every button within reach (the button plus a margin).
  const actions = document.getElementById('actions');
  const keys = [['btnA', 'a'], ['btnB', 'b'], ['btnTA', 'ta'], ['btnTB', 'tb']]
    .map(([id, key]) => ({ el: document.getElementById(id), key, on: false }));
  trackPointers(actions, (points) => {
    for (const k of keys) {
      const r = k.rect;
      const m = r.width * 0.22;
      const on = points.some(([x, y]) => x > r.left - m && x < r.right + m && y > r.top - m && y < r.bottom + m);
      if (on === k.on) continue;
      k.on = on;
      k.el.classList.toggle('on', on);
      if (k.key === 'ta' || k.key === 'tb') {
        if (on) pad.turbo.add(k.key); else pad.turbo.delete(k.key);
      } else if (on) pad.fire = true;
    }
  }, () => { for (const k of keys) k.rect = k.el.getBoundingClientRect(); });
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

// ---------- Pixel art (all drawn in code) ----------
const $ = (id) => document.getElementById(id);
const canvas = $('screen');
let ctx = canvas.getContext('2d'); // swapped for the preview canvas while it draws
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

const TILE = {
  [STEEL]: sprite(8, 8, (R) => {
    R(0, 0, 8, 8, '#8c8ca0');
    R(0, 0, 8, 1, '#e8e8f8');
    R(0, 0, 1, 8, '#e8e8f8');
    R(0, 7, 8, 1, '#4a4a5c');
    R(7, 0, 1, 8, '#4a4a5c');
    R(2, 2, 4, 4, '#f8f8ff');
    R(3, 3, 3, 3, '#b8b8c8');
  }),
  [FOREST]: fromRows([
    '.gGg.gG.',
    'gGGggGGg',
    'gGgGgGgG',
    '.gggGgg.',
    'gGg.gGGg',
    'GGggGgGg',
    'gGgGggG.',
    '.gg.gGg.',
  ], { g: '#1c6c1c', G: '#58b830' }),
  [ICE]: sprite(8, 8, (R) => {
    R(0, 0, 8, 8, '#b0c0d0');
    for (let i = 0; i < 8; i++) { R(i, (i * 2) % 8, 1, 1, '#ffffff'); R(i, (i * 2 + 5) % 8, 1, 1, '#8090a8'); }
  }),
};
const WATER_FRAMES = [0, 1].map((f) => sprite(8, 8, (R) => {
  R(0, 0, 8, 8, '#1838b8');
  for (const [x, y] of [[1, 1], [2, 1], [5, 5], [6, 5], [4, 2], [0, 6]]) R((x + f * 3) % 8, y, 1, 1, '#78a8ff');
}));

const BASE_OK = sprite(16, 16, (R) => {
  R(2, 12, 12, 4, '#7a7a86');
  R(2, 12, 12, 1, '#c8c8d0');
  R(3, 14, 2, 1, '#50505a');
  R(9, 13, 3, 1, '#50505a');
  R(4, 1, 1, 11, '#e0e0e0');
  R(5, 2, 8, 6, '#d82020');
  R(5, 7, 8, 1, '#901010');
  R(8, 3, 2, 4, '#f8d020');
  R(7, 4, 4, 2, '#f8d020');
});
const BASE_DEAD = sprite(16, 16, (R) => {
  R(1, 11, 14, 5, '#5a5a62');
  R(3, 9, 4, 3, '#7a7a86');
  R(9, 10, 5, 2, '#404048');
  for (let i = 0; i < 8; i++) R(2 + i, 9 - i, 1, 1, '#a0a0a0');
  R(10, 12, 5, 3, '#901010');
  R(2, 14, 3, 1, '#202028');
});

const VARIANT = ['basic', 'fast', 'power', 'armor'];

function drawTankUp(col, variant, frame) {
  return sprite(16, 16, (R) => {
    const tw = variant === 'fast' ? 3 : 4;
    R(0, 1, tw, 15, col.dark);
    R(16 - tw, 1, tw, 15, col.dark);
    for (let y = 2 + (frame & 1) * 2; y < 16; y += 4) {
      R(0, y, tw, 1, col.body);
      R(16 - tw, y, tw, 1, col.body);
    }
    R(tw, 4, 16 - 2 * tw, 11, col.body);
    R(tw, 4, 1, 11, col.light);
    R(15 - tw, 4, 1, 11, col.dark);
    R(tw, 14, 16 - 2 * tw, 1, col.dark);
    if (variant === 'armor') {
      R(tw + 1, 12, 16 - 2 * tw - 2, 2, col.dark);
      R(tw + 1, 5, 16 - 2 * tw - 2, 1, col.light);
    }
    R(5, 6, 6, 6, col.light);
    R(6, 7, 4, 4, col.body);
    R(6, 11, 5, 1, col.dark);
    if (variant === 'power') {
      R(6, 0, 1, 7, col.light);
      R(9, 0, 1, 7, col.light);
    } else {
      R(7, 0, 2, 7, col.light);
      R(8, 1, 1, 6, col.body);
    }
    if (col.spot) {
      R(tw + 1, 6, 2, 2, col.spot);
      R(11 - tw + 2, 9, 2, 2, col.spot);
      R(tw + 2, 12, 3, 1, col.spot);
      R(9, 4, 2, 1, col.spot);
    }
    if (variant === 'player') R(7, 8, 2, 2, col.light);
  });
}

const tankCache = new Map();
function tankSprite(colKey, variant, dir, frame) {
  const key = colKey + variant + dir + (frame & 1);
  let c = tankCache.get(key);
  if (!c) {
    const up = drawTankUp(colorOf(colKey), variant, frame);
    c = sprite(16, 16, (R, g) => {
      g.translate(8, 8);
      g.rotate((dir * Math.PI) / 2);
      g.drawImage(up, -8, -8);
    });
    tankCache.set(key, c);
  }
  return c;
}

function bonusSprite(type) {
  return sprite(16, 16, (R) => {
    R(0, 0, 16, 16, '#f8f8f8');
    R(1, 1, 14, 14, '#283078');
    switch (type) {
      case 'helmet':
        R(4, 5, 8, 2, '#f8d020'); R(3, 7, 10, 3, '#f8d020'); R(2, 10, 12, 2, '#c09010'); R(5, 5, 2, 2, '#fff8b0');
        break;
      case 'clock':
        R(4, 3, 8, 10, '#f0f0f0'); R(3, 4, 10, 8, '#f0f0f0'); R(7, 5, 2, 4, '#202020'); R(8, 8, 3, 1, '#202020'); R(7, 1, 2, 2, '#c0c0c0');
        break;
      case 'shovel':
        R(7, 2, 2, 7, '#a06020'); R(5, 2, 6, 1, '#a06020'); R(5, 9, 6, 4, '#c0c0d0'); R(6, 13, 4, 1, '#c0c0d0');
        break;
      case 'star':
        R(7, 2, 2, 12, '#f8d020'); R(2, 6, 12, 2, '#f8d020'); R(4, 4, 8, 6, '#f8d020'); R(4, 10, 2, 3, '#f8d020'); R(10, 10, 2, 3, '#f8d020');
        break;
      case 'grenade':
        R(5, 5, 6, 8, '#3a7a2a'); R(4, 6, 8, 6, '#3a7a2a'); R(6, 3, 4, 2, '#909090'); R(10, 2, 2, 2, '#d0d0d0'); R(6, 7, 1, 1, '#90d070');
        break;
      case 'tank':
        R(3, 6, 10, 7, '#d8a818'); R(3, 6, 2, 7, '#6c4800'); R(11, 6, 2, 7, '#6c4800'); R(6, 8, 4, 3, '#f8e070'); R(7, 2, 2, 6, '#f8e070');
        break;
    }
  });
}
const BONUS = {};
for (const t of ['helmet', 'clock', 'shovel', 'star', 'grenade', 'tank']) BONUS[t] = bonusSprite(t);

const ICON = sprite(7, 7, (R) => {
  R(0, 0, 2, 7, '#222');
  R(5, 0, 2, 7, '#222');
  R(2, 2, 3, 4, '#222');
  R(3, 0, 1, 3, '#222');
});

function circle(cx, cy, r, col) {
  ctx.fillStyle = col;
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.floor(Math.sqrt(r * r - dy * dy));
    ctx.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2, 1);
  }
}

// ---------- Appearance («Внешний вид») ----------
// Every item carries a star price so items can later be unlocked with stars.
// For now all prices are 0, so everything is open.
const LOOK_KEY = 'tankodrom_look';

const TANK_SKINS = [
  { id: 'gold', name: 'Золотой', stars: 0, col: { body: '#d8a818', light: '#f8e070', dark: '#6c4800' } },
  { id: 'green', name: 'Зелёный', stars: 0, col: { body: '#28a048', light: '#88e890', dark: '#0c4818' } },
  { id: 'camo', name: 'Камуфляж', stars: 0, col: { body: '#5a7a30', light: '#a8c060', dark: '#26340e', spot: '#3c2c12' } },
  { id: 'desert', name: 'Пустынный', stars: 0, col: { body: '#c8a060', light: '#f0d8a0', dark: '#64441c', spot: '#9a7038' } },
  { id: 'arctic', name: 'Арктика', stars: 0, col: { body: '#d0dae6', light: '#ffffff', dark: '#5a6a90', spot: '#98a8c8' } },
  { id: 'crimson', name: 'Багровый', stars: 0, col: { body: '#b82838', light: '#f07080', dark: '#4c0c16' } },
  { id: 'cobalt', name: 'Кобальт', stars: 0, col: { body: '#3060d0', light: '#90b8ff', dark: '#10205c' } },
  // Sold for жетоны in the shop (../lib/wallet.js); `tokens` is only the price shown offline.
  { id: 'emerald', name: 'Изумруд', stars: 0, shop: 'tanks-tank-emerald', tokens: 300, col: { body: '#10a080', light: '#70f0c8', dark: '#04402c' } },
];

const WEATHERS = [
  { id: 'day', name: 'День', stars: 0 },
  { id: 'dusk', name: 'Закат', stars: 0 },
  { id: 'night', name: 'Ночь', stars: 0 },
  { id: 'rain', name: 'Дождь', stars: 0 },
  { id: 'snow', name: 'Снегопад', stars: 0 },
];

const ENEMY_SKINS = [
  { id: 'steel', name: 'Стальные', stars: 0,
    e: { body: '#a0a0b0', light: '#f0f0f8', dark: '#44445a' },
    a4: { body: '#5a7a4a', light: '#b8d0a0', dark: '#223018' },
    a3: { body: '#b08830', light: '#f0d890', dark: '#503808' } },
  { id: 'rust', name: 'Ржавые', stars: 0,
    e: { body: '#9a5a30', light: '#e0a070', dark: '#42200c' },
    a4: { body: '#6a4a30', light: '#b08860', dark: '#2a1808' },
    a3: { body: '#b87828', light: '#f0c060', dark: '#503008' } },
  { id: 'sand', name: 'Песчаные', stars: 0,
    e: { body: '#b8a070', light: '#f0e0b0', dark: '#54442a' },
    a4: { body: '#8a7040', light: '#c8b080', dark: '#3a2c10' },
    a3: { body: '#c08848', light: '#f8d090', dark: '#5a3410' } },
  { id: 'black', name: 'Чёрные', stars: 0,
    e: { body: '#484852', light: '#a0a0b0', dark: '#121216' },
    a4: { body: '#34403a', light: '#78907e', dark: '#0a100c' },
    a3: { body: '#605030', light: '#a89868', dark: '#201808' } },
  { id: 'ghost', name: 'Призраки', stars: 0, alpha: 0.7,
    e: { body: '#7090c0', light: '#d8ecff', dark: '#203050' },
    a4: { body: '#5060a0', light: '#a8b8f0', dark: '#182040' },
    a3: { body: '#9080d0', light: '#e8d8ff', dark: '#302060' } },
];

// Breakable walls: the tanks' counterpart of the platformer's pipes.
const WALL_SKINS = [
  { id: 'brick', name: 'Кирпич', stars: 0, rows: [
    'hrrmhrrr', 'rrrmrrrr', 'rrrmrrrr', 'mmmmmmmm', 'rhrrrmhr', 'rrrrrmrr', 'rrrrrmrr', 'mmmmmmmm',
  ], pal: { r: '#a84818', h: '#e07840', m: '#3c1c0a' } },
  { id: 'stone', name: 'Камень', stars: 0, rows: [
    'hsssmhss', 'ssssmsss', 'sssdmssd', 'mmmmmmmm', 'shsmhsss', 'sssmssss', 'sdsmsssd', 'mmmmmmmm',
  ], pal: { s: '#80808c', h: '#c0c0cc', d: '#5a5a66', m: '#2c2c34' } },
  { id: 'crates', name: 'Ящики', stars: 0, rows: [
    'kkkkkkkk', 'kwhwwwwk', 'kwkwwkwk', 'kwwkkwwk', 'kwwkkwwk', 'kwkwwkwk', 'kwwwwwhk', 'kkkkkkkk',
  ], pal: { w: '#a8702c', h: '#e0a860', k: '#5a3410' } },
  { id: 'concrete', name: 'Бетон', stars: 0, rows: [
    'cccccccd', 'clcccccd', 'ccccxccd', 'cccxcccd', 'ccxcclcd', 'cccccccd', 'clccccc d', 'dddddddd',
  ], pal: { c: '#a8a89c', l: '#d8d8cc', x: '#6c6c62', d: '#5c5c54' } },
  { id: 'bags', name: 'Мешки', stars: 0, rows: [
    'obbbobbb', 'bhbbbhbb', 'bbbbbbbb', 'oooooooo', 'bbobbbob', 'bbbhbbbb', 'bbbbbbbb', 'oooooooo',
  ], pal: { b: '#c8b078', h: '#f0dca8', o: '#7a6438' } },
];

const GROUNDS = [
  { id: 'asphalt', name: 'Асфальт', stars: 0, fill: '#000000', frame: '#707070' },
  { id: 'grass', name: 'Трава', stars: 0, fill: '#1e3a16', dots: ['#2a4c1e', '#36602a'], frame: '#4c5c3c' },
  { id: 'sand', name: 'Песок', stars: 0, fill: '#5c4c2c', dots: ['#6c5a36', '#4c3e22'], frame: '#8a7a5a' },
  { id: 'snowfield', name: 'Снег', stars: 0, fill: '#aebccc', dots: ['#c8d4e0', '#98a8bc'], frame: '#6c7c90' },
  { id: 'space', name: 'Космос', stars: 0, fill: '#05050e', stars_: ['#ffffff', '#8090ff', '#ffe0a0'], frame: '#2c2c48' },
];

const LOOK_CATS = [
  { key: 'tank', name: 'Танк', items: TANK_SKINS },
  { key: 'weather', name: 'Погода', items: WEATHERS },
  { key: 'enemies', name: 'Враги', items: ENEMY_SKINS },
  { key: 'walls', name: 'Стены', items: WALL_SKINS },
  { key: 'ground', name: 'Фон', items: GROUNDS },
];

// Saving, star prices and unlocking are handled by the shared panel in ../lib/looks.js.
const LOOK_GROUPS = LOOK_CATS.map((c) => ({
  id: c.key,
  title: T('cat_' + c.key),
  items: c.items.map((it) => ({ id: it.id, name: T(c.key + '_' + it.id), stars: it.stars, shop: it.shop, tokens: it.tokens, draw: (g, size) => drawThumb(g, size, c.key, it.id) })),
}));
const look = {};
if (window.Looks) Object.assign(look, window.Looks.load(LOOK_KEY, LOOK_GROUPS));
for (const c of LOOK_CATS) if (!c.items.some((it) => it.id === look[c.key])) look[c.key] = c.items[0].id;

const findItem = (cat, id) => cat.items.find((it) => it.id === id);
const lookItem = (key) => findItem(LOOK_CATS.find((c) => c.key === key), look[key]);
const tankSkin = (id) => TANK_SKINS.find((t) => t.id === id) || TANK_SKINS[0];
const partnerSkin = (id) => (id === 'green' ? 'gold' : 'green');

// Skins of player 1 and 2 in the current game (online each player brings their own).
let skins = [look.tank, partnerSkin(look.tank)];

function colorOf(key) {
  const [kind, a, b] = key.split(':');
  if (kind === 'p') return tankSkin(a).col;
  if (kind === 'red') return { body: '#c82818', light: '#ff9070', dark: '#581008' };
  return (ENEMY_SKINS.find((e) => e.id === a) || ENEMY_SKINS[0])[b];
}

const wallCache = new Map();
function wallTile() {
  const w = lookItem('walls');
  let img = wallCache.get(w.id);
  if (!img) {
    img = fromRows(w.rows.map((r) => r.replace(/ /g, '').padEnd(8, r[0]).slice(0, 8)), w.pal);
    wallCache.set(w.id, img);
  }
  return img;
}

const groundCache = new Map();
function groundImage() {
  const g = lookItem('ground');
  let img = groundCache.get(g.id);
  if (!img) {
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    img = sprite(FIELD, FIELD, (R) => {
      R(0, 0, FIELD, FIELD, g.fill);
      if (g.dots) for (let i = 0; i < 900; i++) R(Math.floor(rnd() * FIELD), Math.floor(rnd() * FIELD), 1 + (i % 3 === 0), 1, g.dots[i % 2]);
      if (g.stars_) for (let i = 0; i < 90; i++) R(Math.floor(rnd() * FIELD), Math.floor(rnd() * FIELD), 1, 1, g.stars_[i % 3]);
    });
    groundCache.set(g.id, img);
  }
  return img;
}

// Night: a dark layer with holes of light around tanks, shots and blasts.
const nightLayer = document.createElement('canvas');
function drawWeather(s, w, h) {
  const f = s.frame;
  switch (look.weather) {
    case 'dusk':
      ctx.fillStyle = 'rgba(255, 110, 40, 0.18)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(70, 0, 90, 0.14)';
      ctx.fillRect(0, 0, w, h);
      break;
    case 'night': {
      nightLayer.width = w;
      nightLayer.height = h;
      const g = nightLayer.getContext('2d');
      g.fillStyle = 'rgba(4, 6, 22, 0.88)';
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'destination-out';
      const k = w < FIELD ? 0.3 : 1; // small pictures get small lights so the dark shows
      const light = (x, y, r) => {
        r *= k;
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(0,0,0,1)');
        gr.addColorStop(0.6, 'rgba(0,0,0,0.8)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      };
      for (const p of s.players) if (p.tank) light(p.tank.x + 8 + [0, 10, 0, -10][p.tank.dir], p.tank.y + 8 + [-10, 0, 10, 0][p.tank.dir], 46);
      for (const b of s.bullets) light(b.x, b.y, 12);
      for (const b of s.booms) light(b.x, b.y, b.big ? 34 : 14);
      for (const sp of s.spawns) light(sp.x + 8, sp.y + 8, 16);
      if (s.baseCenter) light(s.baseCenter[0], s.baseCenter[1], 22);
      ctx.drawImage(nightLayer, 0, 0);
      break;
    }
    case 'rain':
      ctx.fillStyle = 'rgba(30, 50, 110, 0.2)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(180, 205, 255, 0.55)';
      for (let i = 0; i < 70; i++) {
        const x = ((i * 53 + f * 2) % (w + 20)) - 10;
        const y = (i * 97 + f * 6) % h;
        ctx.fillRect(Math.floor(x), Math.floor(y), 1, 3);
        ctx.fillRect(Math.floor(x) - 1, Math.floor(y) + 3, 1, 2);
      }
      break;
    case 'snow':
      ctx.fillStyle = 'rgba(220, 230, 255, 0.1)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 60; i++) {
        const x = (i * 71 + Math.sin((f + i * 13) / 25) * 5 + w) % w;
        const y = (i * 41 + f * (0.4 + (i % 3) * 0.25)) % h;
        const sz = i % 4 === 0 ? 2 : 1;
        ctx.fillRect(Math.floor(x), Math.floor(y), sz, sz);
      }
      break;
  }
}

// Small pictures for the «Внешний вид» panel: a scene is drawn at game
// resolution and scaled up, using the same drawing code as the game itself.
function drawThumb(g, size, key, id) {
  const saved = look[key];
  look[key] = id;
  const px = key === 'walls' ? 16 : 24;
  const tmp = document.createElement('canvas');
  tmp.width = px;
  tmp.height = px;
  const main = ctx;
  ctx = tmp.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  try {
    if (key === 'walls') {
      const w = wallTile();
      for (const [x, y] of [[0, 0], [8, 0], [0, 8], [8, 8]]) ctx.drawImage(w, x, y);
    } else {
      ctx.drawImage(groundImage(), 0, 0);
      const fake = { frame: 40, players: [], enemies: [], bullets: [], booms: [], spawns: [] };
      if (key === 'enemies') {
        fake.enemies.push({ x: 4, y: 4, dir: DOWN, side: 'e', type: 3, hp: 4, anim: 0, flash: false });
      } else {
        fake.players.push({ tank: { x: 4, y: 6, dir: UP, side: 'p', pi: 0, anim: 0, shield: 0, stun: 0 } });
      }
      const was = skins[0];
      if (key === 'tank') skins[0] = id;
      for (const p of fake.players) drawTank(fake, p.tank);
      for (const e of fake.enemies) drawTank(fake, e);
      skins[0] = was;
      if (key === 'weather' || key === 'ground') drawWeather(fake, px, px);
    }
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
    groups: LOOK_GROUPS,
    onChange: (sel) => {
      Object.assign(look, sel);
      if (mode === 'local') skins = [look.tank, partnerSkin(look.tank)];
    },
    onClose: () => showMenu(),
  });
}

// ---------- Drawing ----------
function drawCells(s, layer) {
  const water = WATER_FRAMES[(s.frame >> 5) & 1];
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      const c = s.cells[cy * N + cx];
      if ((c === FOREST) !== layer) continue;
      let img = c === BRICK ? wallTile() : TILE[c];
      if (c === WATER) img = water;
      // A few seconds before the shovel runs out the wall blinks back to brick.
      if (c === STEEL && s.shovel > 0 && s.shovel < 180 && (s.frame & 16) && isBaseWall(cx, cy)) img = wallTile();
      if (img) ctx.drawImage(img, cx * CELL, cy * CELL);
    }
  }
}

const isBaseWall = (cx, cy) => cy >= 23 && cx >= 11 && cx <= 14 && !(cx >= 12 && cx <= 13 && cy >= 24);

function tankColor(t, s) {
  if (t.side === 'p') return 'p:' + skins[t.pi];
  if (t.flash && (s.frame & 8)) return 'red';
  const part = t.type === 3 ? (t.hp >= 4 ? 'a4' : t.hp === 3 ? 'a3' : 'e') : 'e';
  return 'e:' + look.enemies + ':' + part;
}

function drawTank(s, t) {
  if (t.stun && (s.frame & 8)) return;
  const variant = t.side === 'p' ? 'player' : VARIANT[t.type];
  const img = tankSprite(tankColor(t, s), variant, t.dir, t.anim >> 2);
  const alpha = t.side === 'e' ? lookItem('enemies').alpha : 0;
  if (alpha) ctx.globalAlpha = alpha;
  ctx.drawImage(img, Math.round(t.x), Math.round(t.y));
  ctx.globalAlpha = 1;
  if (t.shield && (s.frame & 4)) {
    const x = Math.round(t.x) - 1, y = Math.round(t.y) - 1;
    ctx.fillStyle = (s.frame & 8) ? '#ffffff' : '#60d0ff';
    for (const [ax, ay] of [[0, 0], [14, 0], [0, 14], [14, 14]]) {
      ctx.fillRect(x + ax, y + ay, 4, 1);
      ctx.fillRect(x + ax + (ax ? 3 : 0), y + ay + (ay ? -3 : 0), 1, 4);
    }
  }
}

function drawSpawn(sp) {
  const size = [1, 3, 5, 7, 5, 3][(sp.t >> 2) % 6];
  const cx = sp.x + 8, cy = sp.y + 8;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(cx - size, cy - 1, size * 2, 2);
  ctx.fillRect(cx - 1, cy - size, 2, size * 2);
  ctx.fillStyle = '#60d0ff';
  const d = Math.max(1, size >> 1);
  for (const [dx, dy] of [[-d, -d], [d, -d], [-d, d], [d, d]]) ctx.fillRect(cx + dx - 1, cy + dy - 1, 2, 2);
}

// Dark rim keeps shells visible on light ground such as snow.
function drawBullet(b) {
  const x = Math.round(b.x) - 2, y = Math.round(b.y) - 2;
  ctx.fillStyle = '#202020';
  ctx.fillRect(x, y, 4, 4);
  ctx.fillStyle = '#f8f8f8';
  ctx.fillRect(x + 1, y + 1, 2, 2);
}

function drawBoom(b) {
  if (b.big) {
    const r = b.t < 14 ? 3 + b.t : 3 + (28 - b.t);
    circle(b.x, b.y, r, '#d82800');
    circle(b.x, b.y, Math.max(1, r - 3), '#f89020');
    circle(b.x, b.y, Math.max(1, r - 6), '#fff8c0');
  } else {
    const r = [2, 4, 6, 5, 3, 2][Math.min(5, b.t >> 1)];
    circle(b.x, b.y, r, '#f89020');
    circle(b.x, b.y, Math.max(1, r - 2), '#fff8c0');
  }
}

function render(s) {
  const ground = lookItem('ground');
  ctx.fillStyle = ground.frame;
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(groundImage(), OX, OY);
  ctx.save();
  ctx.translate(OX, OY);
  drawCells(s, false);
  ctx.drawImage(s.baseAlive ? BASE_OK : BASE_DEAD, 96, 192);
  for (const sp of s.spawns) drawSpawn(sp);
  for (const p of s.players) if (p.tank) drawTank(s, p.tank);
  for (const e of s.enemies) drawTank(s, e);
  for (const b of s.bullets) drawBullet(b);
  drawCells(s, true);
  for (const b of s.booms) drawBoom(b);
  s.baseCenter = [104, 200];
  drawWeather(s, FIELD, FIELD);
  if ((s.frame % 32) < 24) for (const b of s.bonuses) ctx.drawImage(BONUS[b.type], b.x, b.y);
  // Stage curtain
  if (s.phase === 'intro') {
    const k = s.phaseT < 25 ? 1 - s.phaseT / 25 : s.phaseT > 75 ? (s.phaseT - 75) / 25 : 0;
    const h = Math.round((FIELD / 2) * (1 - k));
    ctx.fillStyle = ground.frame;
    ctx.fillRect(0, 0, FIELD, h);
    ctx.fillRect(0, FIELD - h, FIELD, h);
  }
  ctx.restore();
  // Side panel: one icon per enemy still to come.
  const left = s.queue.length;
  for (let i = 0; i < left; i++) ctx.drawImage(ICON, 230 + (i % 2) * 9, 12 + Math.floor(i / 2) * 9);
  if (s.freeze > 0 && (s.frame & 16)) {
    ctx.fillStyle = '#60d0ff';
    ctx.fillRect(230, 110, 16, 2);
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
// Rotating the phone or showing the Telegram header changes the space without a window resize.
if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe($('game'));

let lastHud = '';
function hud(s) {
  const score = s.players.reduce((a, p) => a + p.score, 0);
  const lives = s.players.map((p) => Math.max(0, p.lives)).join(' · ');
  const foes = s.queue.length + s.spawns.length + s.enemies.length;
  const line = [score, lives, foes, s.stage].join('|');
  if (line === lastHud) return;
  lastHud = line;
  $('score').textContent = String(score).padStart(6, '0');
  $('lives').textContent = lives;
  $('foes').textContent = String(foes);
  $('stage').textContent = String(s.stage + 1);
}

// Map names live in sim.js in Russian; the dictionary has them by map number.
function mapTitle(name) {
  const i = S.MAPS.findIndex((m) => m.name === name);
  return i < 0 ? String(name || '') : T('map_' + i);
}

let bannerText = '';
function banner(s) {
  let text = '', cls = '';
  if (s.phase === 'intro') text = T('banner_stage', { n: s.stage + 1, map: mapTitle(s.mapName).toUpperCase() });
  else if (s.phase === 'over' || s.phase === 'overDone') { text = T('game_over'); cls = 'over'; }
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
  $('overlay').classList.remove('hidden');
}

function showMenu() {
  running = false;
  mode = 'local';
  view = null;
  netClose();
  showOverlay(T('title'), T('intro') + '<br>' + T('best', { n: loadBest() }), null, null);
}

$('btnLook').addEventListener('click', () => { audio(); openLook(); });

$('ovBtn').addEventListener('click', () => {
  audio();
  const act = overlayAction;
  overlayAction = null;
  if (act) act();
});

for (const b of document.querySelectorAll('#menu button[data-players]')) {
  b.addEventListener('click', () => { audio(); begin(Number(b.dataset.players)); });
}

function resultText(s) {
  const score = s.players.reduce((a, p) => a + p.score, 0);
  return (s.baseAlive ? T('all_killed') : T('base_lost')) + '<br>' + T('stage_line', { n: s.stage + 1 }) + '<br>' + T('score_line', { n: score });
}

// «Поделиться итогом»: the result goes to any Telegram chat with a link to the bot.
let shareText = '';
function showShare(s) {
  const score = s.players.reduce((a, p) => a + p.score, 0);
  shareText = T(s.players.length > 1 ? 'share_duo' : 'share_solo', { n: s.stage + 1, score });
  $('ovShare').textContent = T('btn_share');
  $('ovShare').classList.remove('hidden');
}
$('ovShare').addEventListener('click', () => {
  audio();
  track('share_clicked');
  // ref_<id> lets the bot count who came by this player's link.
  const me = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  const link = 'https://t.me/' + BOT_NAME + '?start=' + (me && me.id ? 'ref_' + me.id : 'src_tanks');
  try {
    if (tg && tg.openTelegramLink) {
      tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(shareText));
      return;
    }
  } catch (e) { /* fall through */ }
  if (navigator.share) navigator.share({ text: shareText, url: link }).catch(() => {});
  else if (navigator.clipboard) navigator.clipboard.writeText(shareText + '\n' + link).then(() => { $('ovShare').textContent = T('link_copied'); });
});

function killsTable(s) {
  const names = T('kinds').split('|');
  return names.map((n, i) => {
    const counts = s.players.map((p) => p.kills[i]).join(' / ');
    return n + ': ' + counts;
  }).join('<br>');
}

// ---------- Online: two phones, one room ----------
// The host runs the game and sends the world 30 times a second; the guest
// only sends its buttons and draws what arrives.
const API_KEY = 'prygskok_api';
// Why online may be unavailable: '' (fine), 'none' (the bot passed no server
// address) or 'http' (the address is not https, which Telegram blocks).
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
// Имя бота приходит в ссылке от бота (?bot=) и запоминается; запасное — из настроек сборника.
const BOT_NAME = (() => {
  let name = new URLSearchParams(location.search).get('bot');
  try {
    if (name) localStorage.setItem('prygskok_bot', name);
    else name = localStorage.getItem('prygskok_bot');
  } catch (e) { /* ignore */ }
  name = (name || '').replace(/[^A-Za-z0-9_]/g, '');
  return name || (window.CARTRIDGE && window.CARTRIDGE.bot) || 'yellow_cartridge_bot';
})();

let mode = 'local'; // local | host | guest
let view = null;    // what the guest draws
// code/token: our seat in the room, kept to come back after the link drops.
// started: the game began (the host met the guest). rematch: who pressed «Реванш».
const net = {
  ws: null, code: '', token: '', started: false, remote: { dir: -1, fire: false }, lastDir: -1, cellsKey: '', events: [],
  retry: null, ping: null, peerAway: false, resume: false, rematch: { me: false, peer: false },
};
const REJOIN_MS = 20000; // the server keeps a dropped player's seat this long
const HOST_AWAY_MS = 120000; // and the host's seat this long before the guest arrives

function netSend(msg) {
  if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(msg));
}

// Leaving on purpose: the server closes the room and tells the other player.
function netClose() {
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

function connect(onOpen, onFail) {
  let ws;
  // The signed Telegram data lets the server count connections per player.
  const auth = tg && tg.initData ? '?auth=' + encodeURIComponent(tg.initData) : '';
  try { ws = new WebSocket(API.replace(/^http/, 'ws') + '/ws/tanks' + auth); } catch (e) { onFail(false); return; }
  net.ws = ws;
  let opened = false;
  // A tunnel that swallows the upgrade can leave the socket hanging forever.
  const timer = setTimeout(() => { if (!opened && net.ws === ws) ws.close(); }, 10000);
  ws.onopen = () => {
    opened = true;
    clearTimeout(timer);
    // The tunnel drops quiet connections, and the server drops ones silent for 90 s.
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

// The link dropped: with a seat in a room we try to come back, otherwise back to the menu.
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
// The seat is held on the server, so we reconnect and ask for it by token.
// Meanwhile the host's game stands still and both players see why.
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

// Back from the background: try at once instead of waiting for a slowed-down timer.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !net.retry || net.ws) return;
  clearTimeout(net.retry.timer);
  tryRejoin();
});

// Stops the game while one of us is away; remembers whether it was running.
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
    net.cellsKey = ''; // the guest may have missed changes: send the whole field
    if (net.resume) { net.resume = false; running = true; $('overlay').classList.add('hidden'); }
    else if (state) afterStep(state); // a result screen was open: show it again
  } else {
    guestShown = 'wait'; // the next picture from the host decides what to show
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
  showOverlay(T('room'), T('room_code', { code: '<b class="code">' + net.code + '</b>' }), null, null, 'online');
  $('onlineStart').classList.add('hidden');
  $('btnInvite').classList.remove('hidden');
}

function onNet(m) {
  if (m.t === 'room') {
    net.code = m.code;
    net.token = m.token || '';
    mode = 'host';
    roomScreen();
  } else if (m.t === 'peer') {
    haptic('success');
    net.guestSkin = '';
    mode = 'host';
    net.started = true;
    begin(2);
  } else if (m.t === 'joined') {
    mode = 'guest';
    net.code = m.code;
    net.token = m.token || '';
    net.started = true;
    net.rematch = { me: false, peer: false };
    netSend({ t: 'look', tank: look.tank });
    keyMap = KEYS_1P;
    clearPads();
    view = null;
    guestShown = 'wait';
    net.lastDir = -1;
    showOverlay(T('room_n', { code: m.code }), T('in_room'), null, null, 'online');
    $('onlineStart').classList.add('hidden');
  } else if (m.t === 'rejoined') {
    stopRetry();
    haptic('success');
    net.peerAway = !m.peer;
    if (mode === 'guest') netSend({ t: 'look', tank: look.tank });
    if (mode === 'host' && m.peer && !net.started) {
      // The friend came in while we were away inviting them.
      net.guestSkin = '';
      net.started = true;
      begin(2);
    } else if (net.peerAway) pauseOnline(T('peer_lost_title'), T('peer_wait'));
    else resumeOnline();
  } else if (m.t === 'wait') {
    net.peerAway = true;
    if (mode === 'guest' && !view) pauseOnline(T('room_n', { code: net.code }), T('host_away'));
    else pauseOnline(T('peer_lost_title'), T('peer_wait'));
  } else if (m.t === 'back') {
    haptic('success');
    net.peerAway = false;
    if (mode === 'host' && !net.started) {
      net.guestSkin = '';
      net.started = true;
      begin(2);
    } else resumeOnline();
  } else if (m.t === 'error') {
    // The server names the error by code; its own Russian text is the fallback.
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
    // The guest's own tank colour; one the host does not know falls back to the default.
    net.guestSkin = TANK_SKINS.some((t) => t.id === m.tank) ? m.tank : '';
    skins[1] = net.guestSkin || partnerSkin(look.tank);
  } else if (m.t === 'i' && mode === 'host') {
    net.remote.dir = m.d;
    if (m.f) net.remote.fire = true;
  } else if (m.t === 's' && mode === 'guest') {
    applySnapshot(m);
  }
}

// «Реванш»: the new game starts when both players have pressed it.
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
  const score = s.players.reduce((a, p) => a + p.score, 0);
  const note = net.rematch.me ? T('rematch_wait') : net.rematch.peer ? T('rematch_peer') : '';
  showOverlay(T('game_over'), resultText(s) + (note ? '<br><br>' + note : ''),
    net.rematch.me ? T('btn_exit') : T('btn_rematch'), net.rematch.me ? showMenu : pressRematch);
  showShare(s);
}

// The bot's tunnel address changes on every restart, so buttons in old
// messages lead to a dead server; the menu button always has the fresh one.
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
    ? (text ? text + '<br>' : '') + T('online_menu')
    : NO_SERVER[apiProblem];
  showOverlay(T('online_title'), html, null, null, 'online');
  $('onlineStart').classList.toggle('hidden', !API);
  $('btnInvite').classList.add('hidden');
  if (API && !text) checkServer();
}

// Ask the server whether it is alive, so a dead tunnel is reported up front.
function checkServer() {
  const ctl = window.AbortController ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), 6000);
  // no-cors: only whether the server answers matters, not what it says.
  fetch(API + '/api/health', { mode: 'no-cors', signal: ctl ? ctl.signal : undefined })
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
  // The bot answers /start tanks_<code> with a button that opens the game inside Telegram.
  const link = 'https://t.me/' + BOT_NAME + '?start=room_' + net.code;
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

const packTank = (t) => [t.x, t.y, t.dir, t.side === 'p' ? 1 : 0, t.type, t.pi, t.hp, t.anim, t.shield, t.stun, t.flash ? 1 : 0];
const unpackTank = (a) => ({
  x: a[0], y: a[1], dir: a[2], side: a[3] ? 'p' : 'e', type: a[4], pi: a[5], hp: a[6], anim: a[7], shield: a[8], stun: a[9], flash: !!a[10],
});

function sendSnapshot(s) {
  const key = String.fromCharCode.apply(null, s.cells);
  const m = {
    t: 's', f: s.frame, ph: s.phase, pt: s.phaseT, st: s.stage, mn: s.mapName, ba: s.baseAlive ? 1 : 0,
    q: s.queue.length, fr: s.freeze, sh: s.shovel,
    pl: s.players.map((p) => [p.lives, p.level, p.score, p.kills, p.tank ? packTank(p.tank) : 0]),
    en: s.enemies.map(packTank),
    bu: s.bullets.map((b) => [b.x, b.y]),
    bo: s.booms.map((b) => [b.x, b.y, b.big ? 1 : 0, b.t]),
    sp: s.spawns.map((x) => [x.x, x.y, x.t]),
    bn: s.bonuses.map((b) => [b.x, b.y, b.type, b.t]),
    ev: net.events,
    sk: skins,
  };
  if (key !== net.cellsKey || s.frame % 120 === 0) { m.c = btoa(key); net.cellsKey = key; }
  netSend(m);
  net.events = [];
}

function applySnapshot(m) {
  if (!view) view = { cells: new Uint8Array(N * N) };
  const v = view;
  Object.assign(v, {
    frame: m.f, phase: m.ph, phaseT: m.pt, stage: m.st, mapName: m.mn, baseAlive: !!m.ba,
    queue: { length: m.q }, freeze: m.fr, shovel: m.sh,
    players: m.pl.map((a) => ({ lives: a[0], level: a[1], score: a[2], kills: a[3], tank: a[4] ? unpackTank(a[4]) : null })),
    enemies: m.en.map(unpackTank),
    bullets: m.bu.map(([x, y]) => ({ x, y })),
    booms: m.bo.map(([x, y, big, t]) => ({ x, y, big: !!big, t })),
    spawns: m.sp.map(([x, y, t]) => ({ x, y, t })),
    bonuses: (Array.isArray(m.bn) ? m.bn : []).map(([x, y, type, t]) => ({ x, y, type, t })),
  });
  if (m.c) {
    const raw = atob(m.c);
    for (let i = 0; i < raw.length; i++) v.cells[i] = raw.charCodeAt(i);
  }
  if (Array.isArray(m.sk)) skins = m.sk.map((id, i) => (TANK_SKINS.some((t) => t.id === id) ? id : partnerSkin(look.tank)));
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
  const score = v.players.reduce((a, p) => a + p.score, 0);
  showOverlay(T('stage_clear', { n: v.stage + 1 }), T('kills') + '<br>' + killsTable(v) + '<br><br>' + T('score_line', { n: score }) + '<br>' + T('wait_friend_next'), T('btn_exit'), showMenu);
}

function guestTick() {
  const inp = readPad(pads[0]);
  if (inp.dir !== net.lastDir || inp.fire) {
    net.lastDir = inp.dir;
    netSend({ t: 'i', d: inp.dir, f: inp.fire ? 1 : 0 });
  }
}

function remotePad() {
  const r = net.remote;
  const out = { dir: r.dir, fire: r.fire };
  r.fire = false;
  return out;
}

// ---------- Game flow ----------
let state = null;
let running = false;

function begin(players) {
  keyMap = players === 2 && mode === 'local' ? KEYS_2P : KEYS_1P;
  skins = [look.tank, mode === 'host' && net.guestSkin ? net.guestSkin : partnerSkin(look.tank)];
  net.remote = { dir: -1, fire: false };
  net.rematch = { me: false, peer: false };
  net.resume = false;
  net.cellsKey = '';
  net.events = [];
  clearPads();
  state = S.newGame(players, (Date.now() & 0x7fffffff) || 1);
  track('game_start');
  lastHud = '';
  $('overlay').classList.add('hidden');
  running = true;
}

function afterStep(s) {
  if (s.phase === 'clearDone') {
    running = false;
    const score = s.players.reduce((a, p) => a + p.score, 0);
    haptic('success');
    showOverlay(T('stage_clear', { n: s.stage + 1 }), T('kills') + '<br>' + killsTable(s) + '<br><br>' + T('score_line', { n: score }), T('btn_next'), () => {
      S.startStage(s, s.stage + 1);
      clearPads();
      $('overlay').classList.add('hidden');
      running = true;
    });
  } else if (s.phase === 'overDone') {
    running = false;
    const score = s.players.reduce((a, p) => a + p.score, 0);
    const best = saveBest(score);
    if (mode === 'local') track('game_finish');
    if (mode === 'host') {
      track('match_finished', net.code);
      rematchScreen();
    } else {
      showOverlay(T('game_over'), resultText(s) + '<br>' + T('best_line', { n: best }), T('btn_again'), () => begin(s.players.length));
      showShare(s);
    }
  }
  // The guest sees the result screen too, so send the final frame.
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
      S.step(state, [readPad(pads[0]), mode === 'host' ? remotePad() : readPad(pads[1])]);
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
if (window.CARTRIDGE && !window.CARTRIDGE.isEnabled('tanks')) {
  showOverlay(T('title'), T('disabled'), null, null);
  $('menu').classList.add('hidden');
  $('ovHint').classList.add('hidden');
  $('back').classList.remove('hidden');
  return;
}

track('game_open');
bindTouch();
fitCanvas();
state = S.newGame(1, 1);
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
