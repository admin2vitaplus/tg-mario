// The sight's maths: node --test web/range/aim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const A = require('./aim.js');
const close = (a, b) => Math.abs(a - b) < 1e-9;

test('turning about the vertical line is «left/right» however the phone is held', () => {
  // Upright (gravity along the phone's height): the turn is about the phone's y.
  assert.ok(close(A.turn([0, 1, 0], [0, 9.8, 0]).yaw, 1));
  // Lying flat on the back (screen up): about z.
  assert.ok(close(A.turn([0, 0, 1], [0, 0, 9.8]).yaw, 1));
  // Phones that report gravity the other way round give the same answer.
  assert.ok(close(A.turn([0, 1, 0], [0, -9.8, 0]).yaw, 1));
  assert.ok(close(A.turn([0, 0, 1], [0, 0, -1]).yaw, 1), 'in g as well as m/s²');
  // Tilted half way: both axes count.
  const h = Math.SQRT1_2;
  assert.ok(close(A.turn([0, h, h], [0, 5, 5]).yaw, 1));
  // No gravity in the data: taken as upright.
  assert.ok(close(A.turn([0, 1, 0], [0, 0, 0]).yaw, 1));
});

test('tilting towards and away is «up/down»', () => {
  assert.equal(A.turn([0.5, 0, 0], [0, 9.8, 0]).pitch, 0.5);
  assert.ok(close(A.turn([0.5, 0, 0], [0, 9.8, 0]).yaw, 0));
});

test('the sight moves with the turns, ignores sensor noise, stays on the field and recentres', () => {
  const aim = A.create({ width: 256, height: 192 });
  assert.deepEqual([aim.x, aim.y], [128, 96]);
  aim.feedGravity([0, 9.8, 0]);
  // Turning left at 1 rad/s for 0.2 s (10 readings): the sight goes left, about 0.2 × PX_PER_RAD.
  for (let i = 0; i <= 10; i++) aim.feed([0, 1, 0], i * 20);
  assert.ok(aim.x < 128 - A.PX_PER_RAD * 0.15 && aim.x > 128 - A.PX_PER_RAD * 0.2, String(aim.x));
  assert.equal(aim.y, 96);
  // Top of the phone tilting back: up.
  const x = aim.x;
  for (let i = 11; i <= 20; i++) aim.feed([0.5, 0, 0], i * 20);
  assert.ok(aim.y < 96 - 20, String(aim.y));
  assert.ok(Math.abs(aim.x - x) < 6, "only the smoothing tail of the turn");
  // Reversed and twice as fast.
  aim.recenter();
  aim.invertX = true;
  aim.speed = 2;
  for (let i = 21; i <= 31; i++) aim.feed([0, 1, 0], i * 20);
  assert.ok(aim.x > 128 + A.PX_PER_RAD * 0.3, String(aim.x));
  // A phone lying still: a tiny drift does not move the sight.
  aim.recenter();
  for (let i = 32; i <= 200; i++) aim.feed([0.005, 0.008, 0], i * 20);
  assert.deepEqual([aim.x, aim.y], [128, 96]);
  // Far past the edge: stops at it.
  aim.invertX = false;
  for (let i = 201; i <= 300; i++) aim.feed([0, -5, 0], i * 20);
  assert.equal(aim.x, 255);
});
