// Rules tests for Танкодром: node --test web/tanks/sim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './sim.js';

const S = globalThis.TankSim;
const { N, WATER, STEEL, BASE, UP } = S;

function playing(players = 1, seed = 7, stage = 0) {
  const s = S.newGame(players, seed);
  if (stage) S.startStage(s, stage);
  while (s.phase === 'intro') S.step(s, []);
  return s;
}

// Puts a flashing enemy right above the player's shell and lets the shell fly.
function shootFlashingTank(s, x) {
  s.queue = [];
  s.spawns = [];
  s.enemies = [{
    id: 900 + x, x, y: 40, dir: 2, side: 'e', type: 0, pi: -1, hp: 1, speed: 0, anim: 0,
    shield: 0, stun: 0, slide: 0, flash: true, aiT: 1e9, want: 2, dead: false,
  }];
  s.cells.fill(0);
  s.bullets.push({ owner: -5, side: 'p', pi: 0, dir: UP, speed: 4, power: false, dead: false, x: x + 8, y: 70 });
  for (let i = 0; i < 20 && s.enemies.length; i++) S.step(s, []);
}

test('every flashing tank leaves a bonus, even two in a row', () => {
  const s = playing();
  shootFlashingTank(s, 40);
  assert.equal(s.bonuses.length, 1);
  shootFlashingTank(s, 120);
  assert.equal(s.bonuses.length, 2, 'the second bonus must not replace the first');
});

test('a bonus never lies more than half on water or steel', () => {
  for (let seed = 1; seed < 40; seed++) {
    for (let stage = 0; stage < S.MAPS.length; stage++) {
      const s = playing(1, seed, stage);
      for (let i = 0; i < 3; i++) S.spawnBonus(s);
      for (const b of s.bonuses) {
        let blocked = 0;
        for (let cy = b.y / 8; cy < b.y / 8 + 2; cy++) {
          for (let cx = b.x / 8; cx < b.x / 8 + 2; cx++) {
            const c = s.cells[cy * N + cx];
            if (c === WATER || c === STEEL || c === BASE) blocked++;
          }
        }
        assert.ok(blocked <= 2, `seed ${seed} stage ${stage}: bonus at ${b.x},${b.y} is on ${blocked} blocked cells`);
      }
    }
  }
});

test('enemies come faster and in bigger groups on later stages', () => {
  const early = playing(1, 3, 0);
  const late = playing(1, 3, 5);
  early.spawnStarts = late.spawnStarts = 5;
  assert.ok(S.spawnDelay(late) < S.spawnDelay(early));
  assert.ok(S.fieldCap(late) > S.fieldCap(early));
  assert.ok(S.spawnDelay(early) <= 100);
});

test('the first three enemies are on the field within two seconds', () => {
  const s = playing(1, 11);
  let frames = 0;
  while (s.enemies.length < 3 && frames < 600) { S.step(s, []); frames++; }
  assert.ok(frames <= 120, `took ${frames} frames`);
});

test('random play never breaks the rules', () => {
  for (let g = 0; g < 10; g++) {
    const s = S.newGame(g % 2 + 1, g * 7919 + 1);
    let seed = g + 1;
    const r = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const dirs = [-1, -1];
    for (let f = 0; f < 6000 && s.phase !== 'overDone'; f++) {
      const ins = dirs.map((d, i) => { if (r() < 0.03) dirs[i] = Math.floor(r() * 5) - 1; return { dir: dirs[i], fire: r() < 0.05 }; });
      S.step(s, ins);
      s.events.length = 0;
      if (s.phase === 'clearDone') S.startStage(s, s.stage + 1);
      for (const t of s.enemies) assert.ok(t.x >= 0 && t.y >= 0 && t.x <= 192 && t.y <= 192);
      assert.ok(s.bonuses.length <= 3);
    }
  }
});
