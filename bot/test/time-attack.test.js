import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db.js";
import { createTimeAttack } from "../time-attack.js";

// «На время» в «Прыг-Скоке»: попытка начинается на сервере, время правдоподобно, хранится лучшее.

function setup() {
  const store = openDb(":memory:");
  for (const [id, name] of [[1, "Аня"], [2, "Боря"], [3, "Вера"]]) store.touchPlayer({ id, first_name: name });
  const clock = { t: 1_000_000 };
  const ta = createTimeAttack(store, { now: () => clock.t });
  // Пробег уровня: start, прошло realMs, затем finish с ms.
  const run = (id, level, ms, realMs = ms) => {
    const s = ta.start(id, level);
    if (s.status !== 200) return s;
    clock.t += realMs;
    return ta.finish(id, { level, ms });
  };
  return { store, ta, clock, run };
}

test("only open levels can be started, and a finish needs a start", () => {
  const { store, ta, run } = setup();
  assert.equal(ta.start(1, 5).status, 409);
  assert.equal(ta.start(1, 99).status, 400);
  assert.equal(ta.finish(1, { level: 0, ms: 30_000 }).status, 409, "no start");
  store.addLevel(1, { level: 4, score: 100, timeLeft: 100, deaths: 0 });
  assert.equal(ta.start(1, 5).status, 200, "the level after a passed one is open");
  assert.equal(ta.finish(1, { level: 4, ms: 30_000 }).status, 409, "other level than started");
  assert.equal(run(1, 0, 30_000).status, 200);
});

test("too fast or slower than the clock is refused", () => {
  const { ta, run } = setup();
  assert.equal(run(1, 0, 5_000).status, 422, "faster than any run of the level");
  assert.equal(run(1, 0, 400 * 400 + 1).status, 422, "slower than the level timer");
  assert.equal(run(1, 0, 30_000, 10_000).status, 422, "less real time passed than claimed");
  // Отклонённая попытка закончена: снова finish без start нельзя.
  assert.equal(ta.finish(1, { level: 0, ms: 30_000 }).status, 409);
});

test("the best time is kept and the table is sorted with own rank", () => {
  const { ta, run } = setup();
  let r = run(1, 0, 40_000);
  assert.equal(r.body.newRecord, true);
  assert.equal(r.body.best, 40_000);
  r = run(1, 0, 50_000);
  assert.equal(r.body.newRecord, false);
  assert.equal(r.body.best, 40_000);
  assert.equal(r.body.mine, 40_000);
  run(2, 0, 35_000);
  run(3, 0, 45_000);
  const t = ta.table(1, 0).body;
  assert.deepEqual(t.top.map((x) => [x.name, x.ms, x.me]), [["Боря", 35_000, false], ["Аня", 40_000, true], ["Вера", 45_000, false]]);
  assert.equal(t.rank, 2);
  assert.equal(ta.table(1, 1).body.mine, null);
  assert.equal(ta.table(1, 1).body.top.length, 0);
});
