import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db.js";
import { createRangeResults } from "../range-results.js";
import { createBeat } from "../beat.js";
import { encode } from "../range-replay.js";

// «Побей мой счёт»: вызов по принятой игре, та же партия у друга, таблица вызова.

const S = globalThis.RangeSim;

// Стреляет по первой взлетевшей мишени (skill — доля метких выстрелов).
function play(seed, { rounds = 3, skill = 0.8, rules = 2 } = {}) {
  const s = S.newGame(seed, { rules });
  const shots = [];
  let wait = 0, x = seed;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  while (s.phase !== "overDone" && s.round < rounds) {
    wait++;
    const t = s.targets.find((v) => v.state === "fly" && v.age > 30);
    let shot = null;
    if (t && s.cool === 0 && s.phase === "fly" && rnd() < 0.06) {
      shot = { x: Math.min(S.W - 1, Math.floor(t.x / S.SUB) + 8 + (rnd() > skill ? 24 : 0)), y: Math.floor(t.y / S.SUB) + 8 };
    }
    S.step(s, shot);
    s.events.length = 0;
    if (shot) { shots.push({ wait, ...shot }); wait = 0; }
  }
  return { log: encode(shots, wait), score: s.score, frames: s.frame };
}

function setup() {
  const store = openDb(":memory:");
  for (const [id, name] of [[1, "Аня"], [2, "Боря"], [3, "Вера"]]) store.touchPlayer({ id, first_name: name });
  let clock = 1_000_000;
  const results = createRangeResults(store, { now: () => clock });
  const beat = createBeat(store, { now: () => clock });
  // Игра Ани, принятая сервером.
  const { seed } = results.ticket(1);
  const g = play(seed);
  clock += g.frames * 20;
  const r = results.submit(1, { seed, players: 1, log: g.log, rules: 2 });
  assert.equal(r.status, 200, r.error);
  return { store, beat, seed, g };
}

test("a challenge is made only from one's own accepted game, with its checked score", () => {
  const { beat, seed, g } = setup();
  assert.equal(beat.create(2, "range", { seed, log: g.log, rules: 2 }).status, 404, "not Боря's game");
  assert.equal(beat.create(1, "range", { seed, log: g.log + ",1.10.10", rules: 2 }).status, 422);
  assert.equal(beat.create(1, "range", { seed, log: g.log, rules: 1 }).status, 422, "other rules, other score");
  const c = beat.create(1, "range", { seed, log: g.log, rules: 2 });
  assert.equal(c.status, 200);
  assert.match(c.body.id, /^[a-z0-9]{8}$/);
  assert.deepEqual(c.body.owner, { name: "Аня", score: g.score, me: true });
  assert.equal(c.body.seed, seed);
  assert.equal(c.body.rules, 2);
  // Второй раз — тот же вызов.
  assert.equal(beat.create(1, "range", { seed, log: g.log, rules: 2 }).body.id, c.body.id);
  assert.equal(beat.create(1, "word", { seed, log: g.log }).status, 400);
});

test("a friend plays the same game; the best score of each counts", () => {
  const { beat, seed, g } = setup();
  const { id } = beat.create(1, "range", { seed, log: g.log, rules: 2 }).body;
  const seen = beat.get(2, id);
  assert.equal(seen.status, 200);
  assert.equal(seen.body.owner.me, false);
  assert.equal(seen.body.mine, null);
  // Боря стреляет по тем же мишеням: та же партия (то же зерно).
  const good = play(seed, { skill: 1 });
  const bad = play(seed, { skill: 0.3 });
  const r1 = beat.play(2, { id, log: good.log });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.score, good.score);
  assert.equal(beat.play(2, { id, log: bad.log }).body.mine, good.score, "a worse game keeps the best");
  beat.play(3, { id, log: bad.log });
  const top = beat.get(1, id).body.top;
  assert.deepEqual(top.map((t) => t.name), good.score >= bad.score ? ["Боря", "Вера"] : ["Вера", "Боря"]);
  assert.equal(beat.play(2, { id, log: "zz" }).status, 422);
  assert.equal(beat.play(2, { id: "nope", log: good.log }).status, 404);
  assert.equal(beat.get(2, "../../x").status, 404);
  // Сама Аня может переиграть, но в таблицу вызова не попадает.
  beat.play(1, { id, log: good.log });
  assert.ok(!beat.get(1, id).body.top.some((t) => t.me));
});
