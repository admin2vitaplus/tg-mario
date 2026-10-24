// Checks of the «Прыг-Скок» level maps in web/levels.js and web/worlds.js: every level
// can be finished, pipes, plants, checkpoints, the 1-2 warp zone and the world 2-4 features.
// Run: npm test (from the repo root).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const WEB = path.join(import.meta.dirname, '..', 'web');
const window = {};
const ctx = vm.createContext({ window });
for (const f of ['levels.js', 'worlds.js']) vm.runInContext(fs.readFileSync(path.join(WEB, f), 'utf8'), ctx);
const { WORLDS } = window.PrygLevels;
const all = WORLDS.flatMap((w, wi) => w.map((def, li) => ({ id: `${wi + 1}-${li + 1}`, def, lvl: def.build() })));
const byId = Object.fromEntries(all.map((l) => [l.id, l.lvl]));
const built = WORLDS[0].map((_, i) => all[i].lvl);

const EMPTY = new Set(['.', 'o', 'e', 's', 't', 'n', 'v', 'y']);
const SOLID = new Set(['#', 'B', '?', 'M', 'L', 'C', 'H', '[', ']', '{', '}', '(', '-', ')', '_', 'q', 'w', 'z', 'x', 'r', 'p', 'V', 'c', 'u', 'j']);
const at = (lvl, x, y) => lvl.grid[y]?.[x];
const areaOf = (lvl, x) => lvl.areas.findIndex((a) => x >= a.x0 && x < a.x1);

// Rough reachability on the tile grid (web/levels.js, PrygLevels.reach): the set of cells
// "x,y" where a small hero can stand.
const reach = (lvl, from) => window.PrygLevels.reach(lvl, from);

const finished = (lvl, cells) => [...cells].some((k) => Number(k.split(',')[0]) >= lvl.goalX);

test('worlds of four levels, each a full grid ending in a flag or a castle', () => {
  assert.equal(WORLDS.length, 8);
  for (const w of WORLDS) assert.equal(w.length, 4);
  for (const { id, lvl, def } of all) {
    assert.ok(def.name && def.time > 0, id);
    assert.equal(lvl.grid.length, lvl.H, id);
    for (const r of lvl.grid) assert.equal(r.length, lvl.W, id);
    assert.ok(lvl.areas.length >= 1, id);
    assert.ok(lvl.goalX > 0 && lvl.goalX < lvl.W, id);
  }
  for (const w of WORLDS) assert.ok(w[3].build().boss, 'every fourth level is a castle with the beetle');
});

test('every level can be finished from the start and from its checkpoint', () => {
  for (const { id, lvl } of all) {
    assert.ok(finished(lvl, reach(lvl, lvl.start || [3, 13])), `${id}: goal not reachable from the start`);
    if (lvl.checkpoint) assert.ok(finished(lvl, reach(lvl, lvl.checkpoint.start)), `${id}: goal not reachable from the checkpoint`);
  }
});

test('hero starts and respawns on solid ground with room above', () => {
  for (const { id, lvl } of all) {
    const spots = [lvl.start || [3, 13]];
    if (lvl.checkpoint) spots.push(lvl.checkpoint.start);
    for (const [x, y] of spots) {
      assert.ok(EMPTY.has(at(lvl, x, y - 1)), `${id}: (${x},${y - 1}) is not free`);
      assert.ok(EMPTY.has(at(lvl, x, y - 2)), `${id}: (${x},${y - 2}) is not free`);
      assert.ok(SOLID.has(at(lvl, x, y)), `${id}: no ground at (${x},${y})`);
      assert.notEqual(areaOf(lvl, x), -1);
    }
  }
});

test('checkpoints sit in the main course before the goal', () => {
  for (const { id, lvl } of all) {
    if (id.endsWith('-4')) continue;
    assert.ok(lvl.checkpoint, `${id} has a midpoint`);
    assert.ok(lvl.checkpoint.x > 10 && lvl.checkpoint.x < lvl.goalX, id);
    assert.equal(areaOf(lvl, lvl.checkpoint.start[0]), 0, id);
  }
});

test('every pipe is drawn in the grid and leads somewhere real', () => {
  for (const { id, lvl } of all) {
    for (const p of lvl.pipes) {
      if (p.type === 'down') assert.equal(at(lvl, p.x, p.y), '[', `${id}: pipe lip at ${p.x}`);
      else assert.equal(at(lvl, p.x, p.y), 'q', `${id}: side pipe mouth at ${p.x}`);
      const to = p.to;
      if (to.world) { assert.ok(to.world >= 2 && to.world <= WORLDS.length); continue; }
      assert.ok(lvl.areas[to.area], `${id}: pipe ${p.x} leads to a missing area`);
      if (to.pipeX !== undefined) assert.equal(at(lvl, to.pipeX, to.pipeY), '[', `${id}: exit pipe at ${to.pipeX}`);
      if (to.x !== undefined) assert.equal(areaOf(lvl, to.x), to.area, id);
    }
  }
});

test('plants grow out of pipe lips', () => {
  for (const { id, lvl } of all) {
    for (const pl of lvl.plants) {
      assert.equal(at(lvl, pl.x, pl.y), '[', id);
      assert.equal(at(lvl, pl.x + 1, pl.y), ']', id);
    }
  }
  assert.ok(built[1].plants.length >= 2, '1-2 has biting plants');
});

test('1-2: bonus room under a pipe and a warp zone over the ceiling', () => {
  const lvl = built[1];
  const down = lvl.pipes.filter((p) => p.type === 'down' && p.to.area !== undefined);
  assert.ok(down.some((p) => lvl.areas[p.to.area].sky === '#000000' && p.to.area !== 0), 'pipe down to a bonus room');

  const warps = lvl.pipes.filter((p) => p.to.world).map((p) => p.to.world).sort();
  assert.deepEqual([...warps], [2, 3, 4]);

  // A stretch of open sky over the pit lets a lift carry the hero above the ceiling row.
  const ceiling = 1;
  const open = [];
  for (let x = 6; x < 178; x++) if (at(lvl, x, ceiling) === '.') open.push(x);
  assert.ok(open.length >= 3, 'a gap in the ceiling');
  const gapLifts = lvl.lifts.filter((l) => l.x >= open[0] && l.x <= open[open.length - 1]);
  assert.ok(gapLifts.some((l) => l.axis === 'y' && l.y <= ceiling + 2), 'a lift rises near the ceiling');

  // Row 0 above the ceiling is free all the way to the warp zone.
  const warpArea = lvl.areas[areaOf(lvl, lvl.pipes.find((p) => p.to.world).x)];
  for (let x = open[open.length - 1] + 1; x < warpArea.x0; x++) {
    assert.ok(SOLID.has(at(lvl, x, ceiling)), `ceiling to walk on at ${x}`);
    assert.equal(at(lvl, x, 0), '.', `free above the ceiling at ${x}`);
  }
  // The warp zone ceiling leaves a hole to drop in, and the warp pipes can be reached.
  assert.equal(at(lvl, warpArea.x0, ceiling), '.');
  const cells = reach(lvl, lvl.start || [3, 13]);
  for (const p of lvl.pipes.filter((pp) => pp.to.world)) assert.ok(cells.has(`${p.x},${p.y - 1}`), `warp pipe ${p.to.world} reachable`);
});

test('worlds 2-4 bring their own features', () => {
  const lvl22 = byId['2-2'];
  assert.ok(lvl22.areas[0].water, '2-2 is under water');
  assert.ok(lvl22.grid.some((r) => r.includes('s')), '2-2 has fish');
  assert.ok(byId['2-3'].leapFish, '2-3 has leaping fish');
  for (const id of ['3-1', '3-2', '3-3']) assert.ok(byId[id].areas[0].night, `${id} is at night`);
  assert.ok(byId['3-1'].grid.some((r) => r.includes('t')), '3-1 has bolt throwers');
  assert.ok(byId['2-1'].grid.some((r) => r.includes('p')), '2-1 has a springboard');
  assert.ok(byId['4-1'].rider, '4-1 has the cloud rider');
  assert.equal(byId['4-3'].areas[0].tiles, 'tilesMush', '4-3 is on mushrooms');
  assert.equal(byId['4-4'].loops.length, 2, '4-4 is a maze with two forks');
  assert.equal(byId['7-4'].loops.length, 3, '7-4 is a maze with three forks');
  for (const { id, lvl } of all) {
    for (const lp of lvl.loops || []) {
      assert.ok(lp.back < lp.x, id);
      assert.ok(!SOLID.has(at(lvl, lp.back, lp.backY - 1)), `${id}: maze sends the hero back to open space`);
      assert.ok(SOLID.has(at(lvl, lp.back, lp.backY)), `${id}: and onto solid ground`);
    }
  }
});

test('vines grow to bonus clouds that drop the hero back onto the course', () => {
  const withVines = all.filter(({ lvl }) => lvl.vines.length);
  assert.deepEqual([...withVines.map(({ id }) => id)], ['2-1', '3-1', '4-2', '5-2', '6-2']);
  for (const { id, lvl } of withVines) {
    const cells = reach(lvl, lvl.start || [3, 13]);
    for (const v of lvl.vines) {
      assert.equal(at(lvl, v.x, v.y), 'V', `${id}: vine brick at ${v.x}`);
      for (let y = 0; y < v.y; y++) assert.ok(!SOLID.has(at(lvl, v.x, y)), `${id}: room for the vine at ${v.x},${y}`);
      const ar = lvl.areas[v.to.area];
      assert.ok(ar && v.to.area !== 0, `${id}: the vine leads to its own area`);
      assert.equal(areaOf(lvl, v.to.x), v.to.area, id);
      assert.ok(SOLID.has(at(lvl, v.to.x + 1, v.to.y)), `${id}: a cloud to step onto`);
      assert.ok(cells.has(`${v.to.x + 1},${v.to.y - 1}`), `${id}: the vine at ${v.x} can be reached and climbed`);
      if (ar.drop !== undefined) {
        assert.equal(areaOf(lvl, ar.drop), 0, `${id}: the clouds drop onto the main course`);
        assert.ok(finished(lvl, reach(lvl, [v.to.x + 1, v.to.y])), `${id}: the goal can still be reached after the clouds`);
      }
    }
  }
});

test('cannons stand where the original has bullets, with room to fire', () => {
  const has = (lvl) => lvl.grid.some((r) => r.includes('u'));
  for (const id of ['5-1', '7-1', '8-2', '8-3']) assert.ok(has(byId[id]), `${id} has cannons`);
  for (const { id, lvl } of all) {
    lvl.grid.forEach((r, y) => r.forEach((ch, x) => {
      if (ch !== 'u') return;
      assert.ok(!SOLID.has(at(lvl, x - 1, y)) || !SOLID.has(at(lvl, x + 1, y)), `${id}: cannon at ${x} is walled in`);
      for (let yy = y + 1; yy < 13; yy++) assert.equal(at(lvl, x, yy), 'j', `${id}: cannon at ${x} stands on its stand`);
    }));
  }
});

test('4-2: warp pipes to worlds 5-8, over the ceiling and up the vine', () => {
  const lvl = byId['4-2'];
  const warps = lvl.pipes.filter((p) => p.to.world);
  assert.deepEqual([...warps.map((p) => p.to.world)].sort(), [5, 6, 7, 8]);
  const cells = reach(lvl, lvl.start || [3, 13]);
  for (const p of warps) assert.ok(cells.has(`${p.x},${p.y - 1}`), `warp pipe ${p.to.world} reachable`);
});

test('three medals on every level, each on a coin the hero can reach', () => {
  const { medalSpots } = window.PrygLevels;
  for (const { id, lvl } of all) {
    const spots = medalSpots(lvl);
    assert.equal(spots.length, 3, id);
    assert.equal(new Set(spots.map(String)).size, 3, id + ': two medals in one place');
    const cells = reach(lvl, lvl.start || [3, 13]);
    for (const [x, y] of spots) {
      assert.equal(at(lvl, x, y), 'o', `${id}: medal at ${x},${y} is not on a coin`);
      assert.ok(window.PrygLevels.touches(lvl, cells, x, y), `${id}: medal at ${x},${y} cannot be reached`);
    }
  }
});
