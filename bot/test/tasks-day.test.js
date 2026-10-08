import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";
import { createEconomy, DAY_MS, loadEconomy } from "../economy.js";
import { createTanksResults } from "../tanks-results.js";
import { createBombsResults } from "../bombs-results.js";
import { encode as encodeTanks } from "../tanks-replay.js";
import { encode as encodeBombs } from "../bombs-replay.js";

// Задания целиком, как их видит игрок: день во всех трёх играх через HTTP, отметки «выполнено»,
// сброс в 00:00 UTC, серия входов и дневной потолок.

const CFG = loadEconomy();
const TOKEN = "123456:TEST";
const ME = { id: 5, first_name: "Ева" };

function initData(u, authDate) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(u) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

// Игра «как человек» до конца: держит направление, жмёт кнопки; проходит уровни, если повезёт.
function playTanks(seed) {
  const S = globalThis.TankSim;
  const s = S.newGame(1, seed);
  const steps = [];
  let x = seed, dir = 0, hold = 0;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  while (s.phase !== "overDone" && steps.length < 100_000) {
    if (s.phase === "clearDone") { steps.push("n"); S.startStage(s, s.stage + 1); continue; }
    if (--hold <= 0) { dir = Math.floor(rnd() * 5) - 1; hold = 20 + Math.floor(rnd() * 60); }
    const fire = s.frame % 8 === 0;
    steps.push((dir + 1) * 2 + (fire ? 1 : 0));
    S.step(s, [{ dir, fire }]);
    s.events.length = 0;
  }
  return { log: encodeTanks(steps), state: s, frames: steps.filter((v) => v !== "n").length };
}
function playBombs(seed) {
  const S = globalThis.BombSim;
  const s = S.newGame(1, seed);
  const steps = [];
  let x = seed, dir = 0, hold = 0;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  while (s.phase !== "overDone" && steps.length < 200_000) {
    if (s.phase === "clearDone") { steps.push("n"); S.startStage(s, s.stage + 1); continue; }
    if (--hold <= 0) { dir = Math.floor(rnd() * 5) - 1; hold = 10 + Math.floor(rnd() * 40); }
    const inp = { dir, a: s.frame % 90 === 0, b: s.frame % 200 === 0 };
    steps.push((inp.dir + 1) * 4 + (inp.a ? 2 : 0) + (inp.b ? 1 : 0));
    S.step(s, [inp]);
    s.events.length = 0;
  }
  return { log: encodeBombs(steps), state: s, frames: steps.filter((v) => v !== "n").length };
}

async function withServer(clock, fn) {
  const store = openDb(":memory:");
  const now = () => clock.t;
  const economy = createEconomy(store, CFG, { now });
  const server = createApiServer({
    store, botToken: TOKEN, allowedOrigins: ["*"], economy, now,
    tanks: createTanksResults(store, { now }), bombs: createBombsResults(store, { now }),
  });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, u = ME) => {
    const res = await fetch(base + path, {
      method, body: body && JSON.stringify(body),
      headers: { "Content-Type": "application/json", Authorization: `tma ${initData(u, Math.floor(clock.t / 1000))}` },
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    await fn({ call, store, economy });
  } finally {
    server.close();
    store.close();
  }
}

const pick = ({ done, count, max }) => ({ done, count, max });
const day = (me, game) => Object.fromEntries(me.tasks[game].filter((t) => t.period === "day").map((t) => [t.id, t.done]));

test("a day in all three games: every task is crossed off, and all open again at 00:00 UTC", async () => {
  const clock = { t: Date.UTC(2026, 9, 7, 23, 40) };
  await withServer(clock, async ({ call }) => {
    let r = await call("POST", "/api/wallet/checkin");
    assert.equal(r.json.me.tasks.main.find((t) => t.id === "login").done, true);

    // «Прыг-Скок»: уровень 1-1 и итог игры.
    r = await call("POST", "/api/mario/level", { world: 1, level: 0, score: 4000, timeLeft: 300, deaths: 1 });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    clock.t += 60_000;
    r = await call("POST", "/api/mario/run", { score: 4500, coins: 3, levels: 1, deaths: 3, completed: false });
    assert.equal(r.status, 200, JSON.stringify(r.json));

    // «Танкодром» и «Бомбодром»: билет, игра, запись.
    const stages = {};
    for (const [game, play] of [["tanks", playTanks], ["bombs", playBombs]]) {
      const { seed } = (await call("POST", `/api/${game}/ticket`)).json;
      const g = play(seed);
      clock.t += Math.ceil((g.frames / 60) * 1000);
      r = await call("POST", `/api/${game}/run`, { seed, players: 1, log: g.log });
      assert.equal(r.status, 200, `${game}: ${JSON.stringify(r.json)}`);
      stages[game] = { stages: g.state.stage + (g.state.won ? 1 : 0), score: r.json.score };
    }
    assert.ok(clock.t < Date.UTC(2026, 9, 8), "still the same day");

    const me = (await call("GET", "/api/wallet/me")).json;
    assert.deepEqual(day(me, "mario"), { play: true, level: true, record: true });
    for (const game of ["tanks", "bombs"]) {
      assert.deepEqual(day(me, game), { play: true, level: stages[game].stages > 0, record: stages[game].score > 0 }, game);
    }
    assert.equal(me.dayEndsAt, Date.UTC(2026, 9, 8));
    // Общее задание: сыграно во все три игры.
    assert.deepEqual(pick(me.tasks.main.find((t) => t.id === "all")), { done: true, count: 3, max: 3 });
    assert.ok(me.history.some((h) => h.reason === "task" && h.event.startsWith("all:") && h.amount === CFG.tasks.all));
    for (const game of ["mario", "tanks", "bombs"]) {
      assert.deepEqual(pick(me.tasks[game].find((t) => t.id === "week")), { done: false, count: 1, max: CFG.tasks.weekGames }, game);
    }

    // Полночь по UTC: ежедневные задания снова открыты, достижения остаются.
    clock.t = Date.UTC(2026, 9, 8, 0, 0, 30);
    const next = (await call("GET", "/api/wallet/me")).json;
    assert.equal(next.tasks.main.find((t) => t.id === "login").done, false);
    assert.equal(next.tasks.main.find((t) => t.id === "login").amount, CFG.daily.base + CFG.daily.perStreakDay);
    for (const game of ["mario", "tanks", "bombs"]) {
      assert.deepEqual(day(next, game), { play: false, level: false, record: false }, game);
    }
    assert.deepEqual(pick(next.tasks.main.find((t) => t.id === "all")), { done: false, count: 0, max: 3 });
    assert.equal(next.tasks.tanks.find((t) => t.id === "week").count, 1, "the week goes on past midnight");
    assert.ok(next.tasks.mario.some((t) => t.period === "once" && t.done), "achievements stay done");
    const c = (await call("POST", "/api/wallet/checkin")).json;
    assert.deepEqual(c.grants, [{ reason: "daily", amount: CFG.daily.base + CFG.daily.perStreakDay }]);
    assert.equal(c.me.streak, 2);
  });
});

test("the daily cap: a task done after it is still crossed off, and the visit streak goes on", async () => {
  const clock = { t: Date.UTC(2026, 9, 7, 12) };
  await withServer(clock, async ({ call, economy, store }) => {
    store.touchPlayer(ME);
    economy.post(ME.id, CFG.dailyCap, "invite", "friend:test");
    // Сегодня потолок уже выбран: вход за день и задания засчитываются без жетонов.
    let r = await call("POST", "/api/wallet/checkin");
    assert.deepEqual(r.json.grants, []);
    assert.equal(r.json.me.tasks.main.find((t) => t.id === "login").done, true);
    assert.equal(r.json.me.streak, 1);
    r = await call("POST", "/api/mario/level", { world: 1, level: 0, score: 4000, timeLeft: 300, deaths: 1 });
    clock.t += 60_000;
    r = await call("POST", "/api/mario/run", { score: 4500, coins: 3, levels: 1, deaths: 3, completed: false });
    const me = (await call("GET", "/api/wallet/me")).json;
    assert.deepEqual(day(me, "mario"), { play: true, level: true, record: true });
    const paid = store.db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE player_id = ? AND reason != 'achievement'").get(ME.id).n;
    assert.equal(paid, CFG.dailyCap, "no жетоны beyond the cap");
    assert.ok(me.history.every((h) => h.amount !== 0), "no empty rows in the history");
    // Завтра серия продолжается.
    clock.t += DAY_MS;
    r = await call("POST", "/api/wallet/checkin");
    assert.equal(r.json.me.streak, 2);
    assert.deepEqual(r.json.grants, [{ reason: "daily", amount: CFG.daily.base + CFG.daily.perStreakDay }]);
  });
});

test("a flagged player is told so, and achievements held back are paid once the flag is lifted", async () => {
  const clock = { t: Date.UTC(2026, 9, 7, 12) };
  await withServer(clock, async ({ call, economy, store }) => {
    store.touchPlayer(ME);
    economy.flag(ME.id, "test");
    const r = await call("POST", "/api/mario/level", { world: 1, level: 0, score: 4000, timeLeft: 300, deaths: 1 });
    assert.ok(r.json.newAchievements.length > 0);
    let me = (await call("GET", "/api/wallet/me")).json;
    assert.equal(me.flagged, true);
    assert.equal(me.balance, 0);
    economy.unflag(ME.id);
    // Вход за день уже был сегодня: панель сама доплачивает при открытии.
    me = (await call("GET", "/api/wallet/me")).json;
    assert.equal(me.flagged, false);
    assert.equal(me.balance, r.json.newAchievements.length * CFG.achievement);
  });
});

test("the weekly task: the 10th game of a game this week is paid once, and a new week starts it over", () => {
  const clock = { t: Date.UTC(2026, 9, 7, 12) }; // среда
  const store = openDb(":memory:");
  const economy = createEconomy(store, CFG, { now: () => clock.t });
  store.touchPlayer(ME);
  const addGame = (seed) => store.db.prepare(`INSERT INTO bombs_runs (player_id, seed, score, stages, frames, players, created_at)
    VALUES (?, ?, 100, 0, 3000, 1, ?)`).run(ME.id, seed, clock.t);
  const week = () => economy.tasks(ME.id, clock.t).bombs.find((t) => t.id === "week");
  const paidWeek = (out) => out.filter((g) => g.reason === "task" && g.amount === CFG.tasks.week).length;
  let seed = 1;
  for (let i = 1; i < CFG.tasks.weekGames; i++) {
    clock.t += 3_600_000; // по разным дням, чтобы не упереться в дневной потолок
    addGame(seed++);
    assert.equal(paidWeek(economy.run(ME.id, { game: "bombs" })), 0);
  }
  assert.deepEqual(pick(week()), { done: false, count: CFG.tasks.weekGames - 1, max: CFG.tasks.weekGames });
  addGame(seed++);
  assert.equal(paidWeek(economy.run(ME.id, { game: "bombs" })), 1);
  addGame(seed++);
  assert.equal(paidWeek(economy.run(ME.id, { game: "bombs" })), 0, "once a week");
  assert.equal(week().done, true);
  assert.equal(economy.tasks(ME.id, clock.t).tanks.find((t) => t.id === "week").count, 0, "each game counts its own games");
  // Понедельник 00:00 UTC — новая неделя.
  clock.t = Date.UTC(2026, 9, 12, 0, 0, 1);
  assert.deepEqual(pick(week()), { done: false, count: 0, max: CFG.tasks.weekGames });
  store.close();
});
