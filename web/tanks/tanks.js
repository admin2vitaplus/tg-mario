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
window.addEventListener('keydown', (e) => { audio(); onKey(e, true); });
window.addEventListener('keyup', (e) => onKey(e, false));
window.addEventListener('blur', clearPads);

function bindTouch() {
  const pad = pads[0];
  const dpad = document.getElementById('dpad');
  const btn = {};
  const names = ['up', 'right', 'down', 'left'];
  names.forEach((n) => { btn[n] = dpad.querySelector('.' + n); });
  const pointers = new Map();
  const refresh = () => {
    const r = dpad.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const on = [false, false, false, false];
    for (const [x, y] of pointers.values()) {
      const dx = x - cx;
      const dy = y - cy;
      if (Math.hypot(dx, dy) < r.width * 0.12) continue;
      // A tank moves along one axis only, so the thumb picks the dominant one.
      if (Math.abs(dx) > Math.abs(dy)) on[dx < 0 ? LEFT : RIGHT] = true;
      else on[dy < 0 ? UP : DOWN] = true;
    }
    on.forEach((v, d) => { setDir(pad, d, v); btn[names[d]].classList.toggle('on', v); });
  };
  dpad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    audio();
    try { dpad.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    refresh();
  });
  dpad.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    refresh();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    dpad.addEventListener(name, (e) => { pointers.delete(e.pointerId); refresh(); });
  }

  // Dendy pad: A and B both fire; the turbo buttons keep firing while held.
  const hold = (id, onDown, onUp) => {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio();
      onDown();
      el.classList.add('on');
    });
    for (const name of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(name, () => { if (onUp) onUp(); el.classList.remove('on'); });
    }
  };
  hold('btnA', () => { pad.fire = true; });
  hold('btnB', () => { pad.fire = true; });
  hold('btnTA', () => pad.turbo.add('ta'), () => pad.turbo.delete('ta'));
  hold('btnTB', () => pad.turbo.add('tb'), () => pad.turbo.delete('tb'));
}

// ---------- Pixel art (all drawn in code) ----------
const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const ctx = canvas.getContext('2d');
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
  [BRICK]: fromRows([
    'hrrmhrrr',
    'rrrmrrrr',
    'rrrmrrrr',
    'mmmmmmmm',
    'rhrrrmhr',
    'rrrrrmrr',
    'rrrrrmrr',
    'mmmmmmmm',
  ], { r: '#a84818', h: '#e07840', m: '#3c1c0a' }),
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

const COLORS = {
  p0: { body: '#d8a818', light: '#f8e070', dark: '#6c4800' },
  p1: { body: '#28a048', light: '#88e890', dark: '#0c4818' },
  e: { body: '#a0a0b0', light: '#f0f0f8', dark: '#44445a' },
  red: { body: '#c82818', light: '#ff9070', dark: '#581008' },
  armor4: { body: '#5a7a4a', light: '#b8d0a0', dark: '#223018' },
  armor3: { body: '#b08830', light: '#f0d890', dark: '#503808' },
};
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
    if (variant === 'player') R(7, 8, 2, 2, col.light);
  });
}

const tankCache = new Map();
function tankSprite(colKey, variant, dir, frame) {
  const key = colKey + variant + dir + (frame & 1);
  let c = tankCache.get(key);
  if (!c) {
    const up = drawTankUp(COLORS[colKey], variant, frame);
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

// ---------- Drawing ----------
function drawCells(s, layer) {
  const water = WATER_FRAMES[(s.frame >> 5) & 1];
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      const c = s.cells[cy * N + cx];
      if ((c === FOREST) !== layer) continue;
      let img = TILE[c];
      if (c === WATER) img = water;
      // A few seconds before the shovel runs out the wall blinks back to brick.
      if (c === STEEL && s.shovel > 0 && s.shovel < 180 && (s.frame & 16) && isBaseWall(cx, cy)) img = TILE[BRICK];
      if (img) ctx.drawImage(img, cx * CELL, cy * CELL);
    }
  }
}

const isBaseWall = (cx, cy) => cy >= 23 && cx >= 11 && cx <= 14 && !(cx >= 12 && cx <= 13 && cy >= 24);

function tankColor(t, s) {
  if (t.side === 'p') return 'p' + t.pi;
  if (t.flash && (s.frame & 8)) return 'red';
  if (t.type === 3) return t.hp >= 4 ? 'armor4' : t.hp === 3 ? 'armor3' : 'e';
  return 'e';
}

function drawTank(s, t) {
  if (t.stun && (s.frame & 8)) return;
  const variant = t.side === 'p' ? 'player' : VARIANT[t.type];
  const img = tankSprite(tankColor(t, s), variant, t.dir, t.anim >> 2);
  ctx.drawImage(img, Math.round(t.x), Math.round(t.y));
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
  ctx.fillStyle = '#707070';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(OX, OY, FIELD, FIELD);
  ctx.save();
  ctx.translate(OX, OY);
  drawCells(s, false);
  ctx.drawImage(s.baseAlive ? BASE_OK : BASE_DEAD, 96, 192);
  for (const sp of s.spawns) drawSpawn(sp);
  for (const p of s.players) if (p.tank) drawTank(s, p.tank);
  for (const e of s.enemies) drawTank(s, e);
  ctx.fillStyle = '#e8e8e8';
  for (const b of s.bullets) ctx.fillRect(Math.round(b.x) - 2, Math.round(b.y) - 2, 4, 4);
  drawCells(s, true);
  for (const b of s.booms) drawBoom(b);
  if (s.bonus && (s.frame % 32) < 24) ctx.drawImage(BONUS[s.bonus.type], s.bonus.x, s.bonus.y);
  // Stage curtain
  if (s.phase === 'intro') {
    const k = s.phaseT < 25 ? 1 - s.phaseT / 25 : s.phaseT > 75 ? (s.phaseT - 75) / 25 : 0;
    const h = Math.round((FIELD / 2) * (1 - k));
    ctx.fillStyle = '#707070';
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

let bannerText = '';
function banner(s) {
  let text = '', cls = '';
  if (s.phase === 'intro') text = 'УРОВЕНЬ ' + (s.stage + 1) + ' · ' + s.mapName.toUpperCase();
  else if (s.phase === 'over' || s.phase === 'overDone') { text = 'ИГРА ОКОНЧЕНА'; cls = 'over'; }
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

let overlayAction = null;
function showOverlay(title, html, button, action) {
  $('ovTitle').textContent = title;
  $('ovText').innerHTML = html;
  $('menu').classList.toggle('hidden', !!button);
  $('ovHint').classList.toggle('hidden', !!button);
  const btn = $('ovBtn');
  btn.classList.toggle('hidden', !button);
  btn.textContent = button || '';
  overlayAction = action;
  $('overlay').classList.remove('hidden');
}

function showMenu() {
  running = false;
  showOverlay('ТАНКОДРОМ', 'Защити штаб от вражеских танков.<br>Кирпич пробивается, сталь держит.<br>Рекорд: ' + loadBest(), null, null);
}

$('ovBtn').addEventListener('click', () => {
  audio();
  const act = overlayAction;
  overlayAction = null;
  if (act) act();
});

for (const b of document.querySelectorAll('#menu button[data-players]')) {
  b.addEventListener('click', () => { audio(); begin(Number(b.dataset.players)); });
}

function killsTable(s) {
  const names = ['обычные', 'быстрые', 'скорострелы', 'броневики'];
  return names.map((n, i) => {
    const counts = s.players.map((p) => p.kills[i]).join(' / ');
    return n + ': ' + counts;
  }).join('<br>');
}

// ---------- Game flow ----------
let state = null;
let running = false;

function begin(players) {
  keyMap = players === 2 ? KEYS_2P : KEYS_1P;
  clearPads();
  state = S.newGame(players, (Date.now() & 0x7fffffff) || 1);
  lastHud = '';
  $('overlay').classList.add('hidden');
  running = true;
}

function afterStep(s) {
  if (s.phase === 'clearDone') {
    running = false;
    const score = s.players.reduce((a, p) => a + p.score, 0);
    haptic('success');
    showOverlay('УРОВЕНЬ ' + (s.stage + 1) + ' ПРОЙДЕН', 'Подбито:<br>' + killsTable(s) + '<br><br>Счёт: ' + score, 'Дальше', () => {
      S.startStage(s, s.stage + 1);
      clearPads();
      $('overlay').classList.add('hidden');
      running = true;
    });
  } else if (s.phase === 'overDone') {
    running = false;
    const score = s.players.reduce((a, p) => a + p.score, 0);
    const best = saveBest(score);
    const why = s.baseAlive ? 'Все танки подбиты.' : 'Штаб разрушен.';
    showOverlay('ИГРА ОКОНЧЕНА', why + '<br>Уровень: ' + (s.stage + 1) + '<br>Счёт: ' + score + '<br>Рекорд: ' + best, 'Ещё раз', () => begin(s.players.length));
  }
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
      S.step(state, [readPad(pads[0]), readPad(pads[1])]);
      for (const ev of state.events) if (SFX[ev]) SFX[ev]();
      state.events.length = 0;
      afterStep(state);
    }
  } else acc = 0;
  if (state) {
    render(state);
    hud(state);
    banner(state);
  }
}

bindTouch();
fitCanvas();
state = S.newGame(1, 1);
state.phase = 'play';
render(state);
state = null;
showMenu();
requestAnimationFrame(frame);
})();
