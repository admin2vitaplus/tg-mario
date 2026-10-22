// Rules tests for Тир: node --test web/range/sim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './sim.js';

const S = globalThis.RangeSim;
const idle = (s, n) => { for (let i = 0; i < n; i++) S.step(s, null); };
const flying = (s) => { while (s.phase !== 'fly') S.step(s, null); return s; };
const centre = (t) => ({ x: Math.floor(t.x / S.SUB) + 8, y: Math.floor(t.y / S.SUB) + 8 });
const fly = (s) => s.targets.filter((t) => t.state === 'fly');

test('a round starts with its banner, then one target rises from the bushes', () => {
  const s = S.newGame(3);
  assert.equal(s.phase, 'intro');
  flying(s);
  assert.equal(s.targets.length, 1, 'round 1: one at a time');
  assert.equal(s.shots, S.SHOTS);
  const t = s.targets[0];
  assert.ok(t.y / S.SUB > S.GROUND - S.BOX, 'starts behind the bushes');
  idle(s, 20);
  assert.ok(t.y / S.SUB < S.GROUND - S.BOX, 'and flies up');
});

test('a shot at the target hits it and scores, a shot beside it misses', () => {
  const s = flying(S.newGame(4));
  idle(s, 30);
  const t = s.targets[0];
  const p = centre(t);
  S.step(s, { x: p.x > 128 ? 5 : 250, y: 5 });
  assert.equal(s.shots, 2);
  assert.equal(t.state, 'fly');
  assert.ok(s.events.includes('miss'));
  idle(s, S.COOL);
  S.step(s, centre(t));
  assert.equal(t.state, 'hit');
  assert.equal(s.marks[0], 1);
  assert.equal(s.score, S.BASE[t.kind] * S.mult(0));
  assert.deepEqual([s.stats.shots, s.stats.hits], [2, 1]);
});

test('the gun needs a moment between shots, and three misses let the target go', () => {
  const s = flying(S.newGame(5));
  idle(s, 30);
  S.step(s, { x: 1, y: 1 });
  S.step(s, { x: 1, y: 1 });
  assert.equal(s.shots, 2, 'the second shot came too soon');
  idle(s, S.COOL);
  S.step(s, { x: 1, y: 1 });
  idle(s, S.COOL);
  S.step(s, { x: 1, y: 1 });
  assert.equal(s.shots, 0);
  assert.equal(s.targets[0].state, 'away');
  assert.equal(s.marks[0], 2);
});

test('a target nobody shoots flies away in time', () => {
  const s = flying(S.newGame(6));
  idle(s, S.flyOf(0) + 2);
  assert.notEqual(s.targets[0].state, 'fly');
  assert.equal(s.marks[0], 2);
});

test('the same seed and shots give the same game', () => {
  const run = (seed) => {
    const s = S.newGame(seed);
    while (s.phase !== 'overDone' && s.frame < 60 * 60 * 20) {
      const t = fly(s)[0];
      S.step(s, t && t.age > 40 && s.cool === 0 && s.frame % 7 === 0 ? centre(t) : null);
    }
    return s;
  };
  const a = run(42), b = run(42), c = run(43);
  assert.equal(a.score, b.score);
  assert.equal(a.frame, b.frame);
  assert.deepEqual(a.stats, b.stats);
  assert.ok(a.score !== c.score || a.frame !== c.frame);
});

test('missing too many ends the game; enough hits go on to the next round', () => {
  const lose = S.newGame(8);
  while (lose.phase !== 'overDone') S.step(lose, null);
  assert.equal(lose.round, 0);
  assert.equal(lose.won, false);
  assert.equal(S.cleared(lose), 0);

  const win = S.newGame(8);
  while (win.round === 0 && win.phase !== 'overDone') {
    const t = fly(win).find((x) => x.age > 20);
    S.step(win, t && win.cool === 0 ? centre(t) : null);
  }
  assert.equal(win.round, 1, 'all ten hit');
  assert.equal(win.stats.perfect, 1);
  assert.equal(win.score, 10 * S.BASE.bird * S.mult(0) + (win.stats.gold * (S.BASE.gold - S.BASE.bird)) + S.perfectBonus(0));
});

test('rounds get harder: two at a time, discs, faster, more to hit', () => {
  assert.equal(S.pairs(0), false);
  assert.equal(S.pairs(5), true);
  assert.ok(S.discRound(3));
  assert.ok(S.speedOf(20) > S.speedOf(0));
  assert.ok(S.flyOf(30) < S.flyOf(0));
  assert.ok(S.needOf(40) > S.needOf(0));
  const s = S.newGame(9);
  S.startRound(s, 3);
  flying(s);
  assert.deepEqual(s.targets.map((t) => t.kind), ['disc', 'disc']);
});
