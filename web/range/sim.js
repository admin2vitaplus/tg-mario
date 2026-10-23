// Тир: game rules without any drawing or input.
// step(state, shot) is deterministic (seeded random, whole numbers only), so the
// server can replay a recorded game (bot/range-replay.js) and count the score itself.
// A shot is { x, y } in field pixels; how the sight got there (tilting the phone,
// a finger, a mouse) does not matter to the rules.
(function (root) {
'use strict';

const W = 256, H = 224;         // the screen
const GROUND = 168;             // top of the bushes: targets rise from behind them
const SUB = 16;                 // positions are kept in 1/16 pixel
const BOX = 16;                 // a target's picture is 16x16
const MARGIN = 5;               // pixels around a target that still count as a hit
const ROUNDS = 50;
const PER_ROUND = 10;           // targets in a round
const SHOTS = 3;                // shots per wave
const COOL = 8;                 // frames between two shots
const INTRO = 90, AFTER = 40, TALLY = 120, OVER = 150, HIT_HANG = 24;
const FAST = 10;                // a hit this soon after a target appeared is faster than a person
const KINDS = ['bird', 'gold', 'disc'];
const BASE = { bird: 500, gold: 1500, disc: 1000 };
// Directions of flight, each of length 5 so speed stays the same whichever is picked.
const DIRS = [[3, 4], [4, 3], [5, 0], [0, 5]];

// ---------- Helpers ----------
function rnd(s) {
  s.seed = (s.seed + 0x6D2B79F5) | 0;
  let t = s.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (s, n) => Math.floor(rnd(s) * n);
const range = (s, a, b) => a + pick(s, b - a + 1);

// Round settings, r from 0.
const discRound = (r) => r % 4 === 3;
const pairs = (r) => r >= 2;
const speedOf = (r) => 18 + Math.min(r, 30);             // 1/16 px a frame
const flyOf = (r) => Math.max(150, 330 - r * 6);         // frames before a target flies away
const needOf = (r) => (r < 10 ? 6 : r < 20 ? 7 : r < 35 ? 8 : 9);
const mult = (r) => 1 + Math.floor(r / 5);
const perfectBonus = (r) => 5000 * (1 + Math.floor(r / 10));

// ---------- Game setup ----------
function newGame(seed) {
  const s = {
    seed: seed | 0, frame: 0, events: [], phase: 'intro', phaseT: 0, round: 0, score: 0, won: false, lost: false,
    marks: [], wave: 0, shots: 0, cool: 0, targets: [],
    stats: { shots: 0, hits: 0, streak: 0, bestStreak: 0, perfect: 0, gold: 0, discs: 0, doubles: 0, fast: 0 },
  };
  startRound(s, 0);
  return s;
}

function startRound(s, r) {
  s.round = r;
  s.phase = 'intro';
  s.phaseT = 0;
  s.marks = Array(PER_ROUND).fill(0); // 0 not yet, 1 hit, 2 missed
  s.next = 0;                         // the next target of the round
  s.targets = [];
  s.shots = 0;
}

function spawnBird(s, slot) {
  const r = s.round;
  const gold = r >= 1 && pick(s, 8) === 0;
  const speed = Math.floor(speedOf(r) * (gold ? 3 : 2) / 2);
  const t = { kind: gold ? 'gold' : 'bird', slot, x: range(s, 24, W - 40) * SUB, y: (GROUND - 8) * SUB, vx: 0, vy: 0, speed, state: 'fly', age: 0, turn: 0 };
  turn(s, t, true);
  return t;
}

function turn(s, t, up) {
  const [dx, dy] = DIRS[pick(s, 3)]; // never straight down
  t.vx = Math.trunc(dx * t.speed / 5) * (pick(s, 2) ? 1 : -1);
  t.vy = Math.trunc(dy * t.speed / 5) * (up || pick(s, 2) ? -1 : 1);
  if (t.vx === 0 && t.vy === 0) t.vy = -t.speed;
  t.turn = range(s, 40, 100);
}

function spawnDisc(s, slot) {
  const r = s.round;
  const left = pick(s, 2) === 0;
  const vx = range(s, 10, 22) + Math.floor(Math.min(r, 30) / 3);
  return {
    kind: 'disc', slot, x: (left ? -8 : W - 8) * SUB, y: (GROUND - 4) * SUB,
    vx: left ? vx : -vx, vy: -range(s, 56, 64), speed: 0, state: 'fly', age: 0, turn: 0,
  };
}

function startWave(s) {
  const n = pairs(s.round) ? 2 : 1;
  s.targets = [];
  for (let i = 0; i < n && s.next < PER_ROUND; i++) {
    const slot = s.next++;
    s.targets.push(discRound(s.round) ? spawnDisc(s, slot) : spawnBird(s, slot));
  }
  s.shots = SHOTS;
  s.cool = 0;
  s.phase = 'fly';
  s.phaseT = 0;
  s.events.push('wave');
}

// ---------- Shooting ----------
const hitBox = (t) => {
  const x = Math.floor(t.x / SUB), y = Math.floor(t.y / SUB);
  return t.kind === 'disc' ? [x - MARGIN, y + 4 - MARGIN, x + BOX + MARGIN, y + 12 + MARGIN] : [x - MARGIN, y - MARGIN, x + BOX + MARGIN, y + BOX + MARGIN];
};

function shoot(s, shot) {
  if (s.phase !== 'fly' || s.shots <= 0 || s.cool > 0) return;
  if (!s.targets.some((t) => t.state === 'fly')) return;
  const x = shot.x | 0, y = shot.y | 0;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  s.shots--;
  s.cool = COOL;
  s.stats.shots++;
  s.events.push('shot');
  let got = 0;
  for (const t of s.targets) {
    if (t.state !== 'fly') continue;
    const [x0, y0, x1, y1] = hitBox(t);
    if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
    got++;
    t.state = 'hit';
    t.hang = HIT_HANG;
    s.marks[t.slot] = 1;
    s.score += BASE[t.kind] * mult(s.round);
    s.stats.hits++;
    if (t.kind === 'gold') s.stats.gold++;
    if (t.kind === 'disc') s.stats.discs++;
    if (t.age < FAST) s.stats.fast++;
  }
  if (got) {
    s.stats.streak++;
    s.stats.bestStreak = Math.max(s.stats.bestStreak, s.stats.streak);
    if (got > 1) s.stats.doubles++;
    s.events.push(got > 1 ? 'double' : 'hit');
  } else {
    s.stats.streak = 0;
    s.events.push('miss');
  }
  // Out of shots: whatever still flies gets away.
  if (s.shots === 0) for (const t of s.targets) if (t.state === 'fly') flyAway(s, t);
}

function flyAway(s, t) {
  t.state = 'away';
  s.marks[t.slot] = 2;
  if (t.kind !== 'disc') { t.vx = 0; t.vy = -3 * SUB; }
  s.events.push('away');
}

// ---------- Movement ----------
function moveTarget(s, t) {
  t.age++;
  if (t.state === 'hit') {
    if (--t.hang <= 0) { t.state = 'fall'; t.vx = 0; t.vy = 3 * SUB; s.events.push('fall'); }
    return;
  }
  if (t.state === 'fall') {
    t.y += t.vy;
    if (t.y > GROUND * SUB) t.state = 'gone';
    return;
  }
  if (t.kind === 'disc') {
    t.x += t.vx;
    t.y += t.vy;
    t.vy += 1;
    const out = t.y > GROUND * SUB || t.x < -BOX * 2 * SUB || t.x > (W + BOX) * SUB;
    if (out) {
      if (t.state === 'fly') { s.marks[t.slot] = 2; s.events.push('away'); }
      t.state = 'gone';
    } else if (t.state === 'fly' && t.age >= flyOf(s.round)) flyAway(s, t);
    return;
  }
  if (t.state === 'away') {
    t.y += t.vy;
    if (t.y < -BOX * SUB) t.state = 'gone';
    return;
  }
  // A flying bird: bounces off the edges, now and then turns.
  t.x += t.vx;
  t.y += t.vy;
  if (t.x < 0) { t.x = 0; t.vx = Math.abs(t.vx); }
  if (t.x > (W - BOX) * SUB) { t.x = (W - BOX) * SUB; t.vx = -Math.abs(t.vx); }
  if (t.y < 8 * SUB) { t.y = 8 * SUB; t.vy = Math.abs(t.vy); }
  if (t.y > (GROUND - BOX) * SUB && t.age > 30) { t.y = (GROUND - BOX) * SUB; t.vy = -Math.abs(t.vy); }
  if (--t.turn <= 0) turn(s, t, t.y > (GROUND - 48) * SUB);
  if (t.age >= flyOf(s.round)) flyAway(s, t);
}

// ---------- One frame ----------
function step(s, shot) {
  s.frame++;
  if (s.phase === 'overDone') return;
  if (s.phase === 'over') { if (++s.phaseT >= OVER) s.phase = 'overDone'; return; }
  if (s.phase === 'intro') {
    if (++s.phaseT >= INTRO) startWave(s);
    return;
  }
  if (s.phase === 'after') {
    if (++s.phaseT >= AFTER) {
      if (s.next < PER_ROUND) startWave(s);
      else tally(s);
    }
    return;
  }
  if (s.phase === 'tally') {
    if (++s.phaseT >= TALLY) {
      if (s.lost || s.round === ROUNDS - 1) {
        s.won = !s.lost;
        s.phase = 'over';
        s.phaseT = 0;
        s.events.push(s.won ? 'win' : 'over');
      } else startRound(s, s.round + 1);
    }
    return;
  }
  // 'fly': the wave is in the air.
  s.phaseT++;
  if (s.cool > 0) s.cool--;
  if (shot) shoot(s, shot);
  for (const t of s.targets) moveTarget(s, t);
  if (s.targets.every((t) => t.state === 'gone')) {
    s.phase = 'after';
    s.phaseT = 0;
  }
}

function tally(s) {
  const hits = s.marks.filter((m) => m === 1).length;
  s.phase = 'tally';
  s.phaseT = 0;
  s.roundHits = hits;
  s.lost = hits < needOf(s.round);
  if (hits === PER_ROUND) {
    s.score += perfectBonus(s.round);
    s.stats.perfect++;
    s.events.push('perfect');
  } else s.events.push(s.lost ? 'short' : 'pass');
}

// Rounds cleared so far: the current one counts once its tally has shown a pass.
const cleared = (s) => s.round + ((s.phase === 'tally' || s.phase === 'over' || s.phase === 'overDone') && !s.lost ? 1 : 0);

root.RangeSim = {
  W, H, GROUND, SUB, BOX, MARGIN, ROUNDS, PER_ROUND, SHOTS, COOL, FAST, KINDS, BASE,
  discRound, pairs, speedOf, flyOf, needOf, mult, perfectBonus,
  newGame, startRound, step, cleared, hitBox,
};
})(typeof window !== 'undefined' ? window : globalThis);
