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
const SOLID = new Set(['#', 'B', '?', 'M', 'L', 'C', 'H', '[', ']', '{', '}', '(', '-', ')', '_', 'q', 'w', 'z', 'x', 'r', 'p']);
const at = (lvl, x, y) => lvl.grid[y]?.[x];
const areaOf = (lvl, x) => lvl.areas.findIndex((a) => x >= a.x0 && x < a.x1);

// Rough reachability on the tile grid for a small hero (one tile tall): walking, falling,
// jumps up to 4 tiles high (6 wide when 2 high or less), lifts along their whole track, springboards,
// pipes and swimming in water areas. Returns the set of reachable body cells "x,y".
function reach(lvl, from) {
  const solid = (x, y) => SOLID.has(at(lvl, x, y));
  const free = (x, y) => x >= 0 && x < lvl.W && y >= 0 && y < lvl.H && !solid(x, y) && !'~=f'.includes(at(lvl, x, y));
  const liftTop = new Set();
  for (const l of lvl.lifts) {
    const xs = l.axis === 'x' ? l.w + l.dist : l.w;
    const ys = l.axis === 'y' ? l.dist : 0;
    for (let dx = 0; dx < xs; dx++) for (let dy = 0; dy <= ys; dy++) liftTop.add(`${l.x + dx},${l.y + dy - 1}`);
  }
  const water = (x) => !!(lvl.areas[areaOf(lvl, x)] || {}).water;
  const stand = (x, y) => free(x, y) && (solid(x, y + 1) || liftTop.has(`${x},${y}`));
  const loopOk = (x, y, x2, y2) => (lvl.loops || []).every((lp) => {
    const crosses = (x < lp.x) !== (x2 < lp.x);
    return !crosses || (y >= lp.rows[0] && y <= lp.rows[1]);
  });
  const land = (x, y) => {
    while (y < lvl.H && free(x, y) && !stand(x, y)) y++;
    return y < lvl.H && stand(x, y) ? [x, y] : null;
  };
  const seen = new Set();
  const queue = [];
  const push = (c, x, y) => {
    if (!c) return;
    const k = `${c[0]},${c[1]}`;
    if (seen.has(k) || !loopOk(x, y, c[0], c[1])) return;
    seen.add(k);
    queue.push(c);
  };
  push(land(from[0], from[1] - 1), from[0], from[1] - 1);
  while (queue.length) {
    const [x, y] = queue.shift();
    if (water(x)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (free(x + dx, y + dy) && y + dy >= 2) push([x + dx, y + dy], x, y);
      }
    }
    const spring = at(lvl, x, y + 1) === 'p';
    const up = spring ? 12 : 4;
    for (let dy = -up; dy <= lvl.H; dy++) {
      const reachX = dy > 0 ? 6 + Math.floor(dy / 2) : spring || dy >= -2 ? 6 : dy === -3 ? 5 : 4;
      // Room to rise straight up before the jump.
      let clear = true;
      for (let yy = y - 1; yy >= y + dy - 1 && yy >= 0; yy--) if (!free(x, yy)) { clear = false; break; }
      if (dy < 0 && !clear) continue;
      for (let dx = -reachX; dx <= reachX; dx++) {
        const x2 = x + dx;
        const y2 = y + dy;
        if (stand(x2, y2)) push([x2, y2], x, y);
      }
    }
    for (const dx of [-1, 1]) if (free(x + dx, y)) push(land(x + dx, y), x, y);
    for (const p of lvl.pipes) {
      const on = p.type === 'down' ? (y === p.y - 1 && (x === p.x || x === p.x + 1)) : (y === p.y + 1 && x === p.x - 1);
      if (!on || p.to.world) continue;
      if (p.to.pipeX !== undefined) push([p.to.pipeX, p.to.pipeY - 1], p.to.pipeX, p.to.pipeY - 1);
      else push(land(p.to.x, p.to.y - 1), p.to.x, p.to.y - 1);
    }
  }
  return seen;
}

const finished = (lvl, cells) => [...cells].some((k) => Number(k.split(',')[0]) >= lvl.goalX);

test('four worlds of four levels, each a full grid ending in a flag or a castle', () => {
  assert.equal(WORLDS.length, 4);
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
  for (const lp of byId['4-4'].loops) {
    assert.ok(lp.back < lp.x);
    assert.ok(!SOLID.has(at(byId['4-4'], lp.back, lp.backY - 1)), 'maze sends the hero back to open space');
  }
});
