// Checks of the «Прыг-Скок» level maps in web/levels.js: pipes, plants, checkpoints
// and the 1-2 warp zone. Run: npm test (from the repo root).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'web', 'levels.js'), 'utf8');
const window = {};
vm.runInNewContext(src, { window });
const { LEVELS } = window.PrygLevels;
const built = LEVELS.map((l) => l.build());

const EMPTY = new Set(['.', 'o', 'e']);
const SOLID = new Set(['#', 'B', '?', 'M', 'L', 'C', 'H', '[', ']', '{', '}', '(', '-', ')', '_']);
const at = (lvl, x, y) => lvl.grid[y]?.[x];
const areaOf = (lvl, x) => lvl.areas.findIndex((a) => x >= a.x0 && x < a.x1);

test('four levels, each a full grid', () => {
  assert.equal(LEVELS.length, 4);
  for (const lvl of built) {
    assert.equal(lvl.grid.length, lvl.H);
    for (const r of lvl.grid) assert.equal(r.length, lvl.W);
    assert.ok(lvl.areas.length >= 1);
  }
});

test('hero starts and respawns on solid ground with room above', () => {
  for (const [i, lvl] of built.entries()) {
    const spots = [lvl.start || [3, 13]];
    if (lvl.checkpoint) spots.push(lvl.checkpoint.start);
    for (const [x, y] of spots) {
      assert.ok(EMPTY.has(at(lvl, x, y - 1)), `level ${i + 1}: (${x},${y - 1}) is not free`);
      assert.ok(EMPTY.has(at(lvl, x, y - 2)), `level ${i + 1}: (${x},${y - 2}) is not free`);
      assert.ok(SOLID.has(at(lvl, x, y)), `level ${i + 1}: no ground at (${x},${y})`);
      assert.notEqual(areaOf(lvl, x), -1);
    }
  }
});

test('checkpoints sit in the main course before the goal', () => {
  for (const lvl of built.slice(0, 3)) {
    assert.ok(lvl.checkpoint, 'first three levels have a midpoint');
    assert.ok(lvl.checkpoint.x > 10 && lvl.checkpoint.x < lvl.goalX);
    assert.equal(areaOf(lvl, lvl.checkpoint.start[0]), 0);
  }
});

test('every pipe is drawn in the grid and leads somewhere real', () => {
  for (const [i, lvl] of built.entries()) {
    for (const p of lvl.pipes) {
      if (p.type === 'down') assert.equal(at(lvl, p.x, p.y), '[', `level ${i + 1}: pipe lip at ${p.x}`);
      else assert.equal(at(lvl, p.x, p.y), 'q', `level ${i + 1}: side pipe mouth at ${p.x}`);
      const to = p.to;
      if (to.world) { assert.ok(to.world >= 2 && to.world <= 4); continue; }
      assert.ok(lvl.areas[to.area], `level ${i + 1}: pipe ${p.x} leads to a missing area`);
      if (to.pipeX !== undefined) assert.equal(at(lvl, to.pipeX, to.pipeY), '[', `level ${i + 1}: exit pipe at ${to.pipeX}`);
      if (to.x !== undefined) assert.equal(areaOf(lvl, to.x), to.area);
    }
  }
});

test('plants grow out of pipe lips', () => {
  for (const lvl of built) {
    for (const pl of lvl.plants) {
      assert.equal(at(lvl, pl.x, pl.y), '[');
      assert.equal(at(lvl, pl.x + 1, pl.y), ']');
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
  assert.ok(gapLifts.some((l) => l.y - l.dist <= ceiling - 1 + 3), 'a lift rises near the ceiling');

  // Row 0 above the ceiling is free all the way to the warp zone.
  const warpArea = lvl.areas[areaOf(lvl, lvl.pipes.find((p) => p.to.world).x)];
  for (let x = open[open.length - 1] + 1; x < warpArea.x0; x++) {
    assert.ok(SOLID.has(at(lvl, x, ceiling)), `ceiling to walk on at ${x}`);
    assert.equal(at(lvl, x, 0), '.', `free above the ceiling at ${x}`);
  }
  // The warp zone ceiling leaves a hole to drop in.
  assert.equal(at(lvl, warpArea.x0, ceiling), '.');
});
