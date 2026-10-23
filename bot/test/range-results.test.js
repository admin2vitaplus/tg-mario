import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";
import { createEconomy, loadEconomy } from "../economy.js";
import { createRangeResults } from "../range-results.js";
import { encode, MAX_FAST_HITS, MIN_QUIT_FRAMES, replay } from "../range-replay.js";
import { RANGE_ACHIEVEMENTS } from "../achievements.js";

// «Тир» на сервере: повтор записи выстрелов, билеты, жетоны, таблица и достижения.

const S = globalThis.RangeSim;
const CFG = loadEconomy();

test("the server's copy of the game rules is the game's own file", () => {
  const web = readFileSync(new URL("../../web/range/sim.js", import.meta.url), "utf8");
  const bot = readFileSync(new URL("../range-sim.js", import.meta.url), "utf8");
  assert.equal(bot, web, "copy web/range/sim.js to bot/range-sim.js");
});

// Стреляет «как человек»: ждёт, пока мишень взлетит, целится с ошибкой, иногда мажет.
// rounds — после стольких раундов бросает игру (выходит в меню).
function play(seed, { skill = 0.75, rounds = Infinity, react = 30, start = 0, rules = 1, mode = "" } = {}) {
  const s = S.newGame(seed, { rules, mode });
  if (start) S.startRound(s, start); // игра с выбранного раунда (как в range.js)
  const shots = [];
  let x = seed, wait = 0;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  while (s.phase !== "overDone" && s.round < rounds && s.frame < 60 * 60 * 50) {
    wait++;
    let shot = null;
    const t = s.targets.find((v) => v.state === "fly" && v.age > react);
    if (t && s.cool === 0 && rnd() < 0.06) {
      const miss = rnd() > skill ? 24 : 0;
      shot = { x: Math.min(S.W - 1, Math.floor(t.x / S.SUB) + 8 + miss), y: Math.floor(t.y / S.SUB) + 8 };
    }
    if (shot && s.phase !== "fly") shot = null;
    S.step(s, shot);
    s.events.length = 0;
    if (shot) { shots.push({ wait, ...shot }); wait = 0; }
  }
  return { log: encode(shots, wait), state: s, frames: s.frame };
}

test("a game under rules 2 (and «Без промаха») replays with them; unknown rules are refused", () => {
  for (const [seed, mode] of [[31, ""], [32, ""], [33, "sudden"]]) {
    const g = play(seed, { rules: 2, mode, rounds: 8 });
    const r = replay({ seed, players: 1, log: g.log, rules: 2, mode });
    assert.equal(r.ok, true, r.why);
    assert.equal(r.scores[0], g.state.score);
    assert.equal(r.stages, S.cleared(g.state));
  }
  const g = play(34, { rules: 2, rounds: 8 });
  assert.equal(replay({ seed: 34, players: 1, log: g.log, rules: S.RULES + 1 }).why, "bad rules");
  assert.equal(replay({ seed: 34, players: 1, log: g.log, rules: 2, mode: "god" }).why, "bad mode");
  assert.equal(replay({ seed: 34, players: 1, log: g.log, mode: "sudden" }).why, "bad mode", "the mode needs rules 2");
});

test("replay gives the same score as the game, and a changed record is caught", () => {
  for (const seed of [11, 222, 3333]) {
    const g = play(seed, { rounds: 6 });
    const r = replay({ seed, players: 1, log: g.log });
    assert.equal(r.ok, true, r.why);
    assert.equal(r.scores[0], g.state.score);
    assert.equal(r.frames, g.frames);
    assert.equal(r.stages, S.cleared(g.state));
    assert.ok(r.stages >= 1, "a decent shot clears a round");
    assert.equal(r.quit, true, "left in the middle");
    assert.equal(r.stats[0].hits, g.state.stats.hits);
  }
  // Сыграна до конца: не брошена.
  const full = play(5, { skill: 0.3 });
  assert.equal(full.state.phase, "overDone");
  const r = replay({ seed: 5, players: 1, log: full.log });
  assert.equal(r.ok, true, r.why);
  assert.equal(r.quit, false);
  assert.equal(replay({ seed: 5, players: 1, log: full.log + ",1.10.10" }).why, "bad step", "the end comes last");
  const longer = full.log.replace(/e(\w+)$/, (_m, n) => "e" + (parseInt(n, 36) + 10).toString(36));
  assert.equal(replay({ seed: 5, players: 1, log: longer }).why, "steps after the end");
  // Другое зерно — другие мишени: те же выстрелы дают другой счёт.
  const g = play(11, { rounds: 4 });
  const other = replay({ seed: 12, players: 1, log: g.log });
  assert.ok(!other.ok || other.scores[0] !== g.state.score);
  assert.equal(replay({ seed: 11, players: 1, log: "e10" }).why, "game not finished");
  assert.equal(replay({ seed: 11, players: 2, log: g.log }).why, "bad players");
  assert.equal(replay({ seed: 11, players: 1, log: "1.zz.10" }).why, "bad step", "outside the field");
  assert.equal(replay({ seed: 11, players: 1, log: "0.10.10" }).why, "bad step");
  assert.equal(replay({ seed: 11, players: 1, log: "e" + (60 * 60 * 61).toString(36) }).why, "too long");
  // Брошенная игра засчитывается, если в неё играли MIN_QUIT_FRAMES.
  assert.equal(replay({ seed: 11, players: 1, log: "e" + MIN_QUIT_FRAMES.toString(36) }).ok, true);
});

test("a game from a chosen round is replayed from it; rounds count from it", () => {
  const g = play(11, { start: 4, rounds: 7 });
  const r = replay({ seed: 11, players: 1, log: g.log, start: 4 });
  assert.equal(r.ok, true, r.why);
  assert.equal(r.scores[0], g.state.score);
  assert.equal(r.stages, S.cleared(g.state) - 4);
  assert.equal(replay({ seed: 11, players: 1, log: g.log, start: S.ROUNDS }).why, "bad start");
});

test("hits faster than a person can react are not accepted", () => {
  const quick = play(77, { skill: 1, react: 1, rounds: 3 });
  assert.ok(quick.state.stats.fast > MAX_FAST_HITS, "the bot shot at once");
  assert.equal(replay({ seed: 77, players: 1, log: quick.log }).why, "too fast");
});

test("achievements read the replay's numbers", () => {
  const g = play(9, { skill: 0.95, rounds: 12 });
  const r = replay({ seed: 9, players: 1, log: g.log });
  const e = { type: "run", ...r.stats[0], score: r.scores[0], stages: r.stages, won: r.won };
  const got = RANGE_ACHIEVEMENTS.filter((a) => a.check(e, { games: 1 })).map((a) => a.code);
  assert.ok(got.includes("range_round1"));
  assert.ok(got.includes("range_rounds10"));
  assert.ok(!got.includes("range_all"));
  assert.ok(!got.includes("range_games25"));
});

const TOKEN = "123456:TEST";
function initData(u, authDate) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(u) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

async function withServer(fn) {
  const clock = { t: Date.UTC(2026, 9, 22, 12) };
  const store = openDb(":memory:");
  const results = createRangeResults(store, { now: () => clock.t });
  const economy = createEconomy(store, CFG, { now: () => clock.t });
  const server = createApiServer({ store, botToken: TOKEN, allowedOrigins: ["*"], economy, range: results, now: () => clock.t });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, u = { id: 5, first_name: "Ева" }) => {
    const res = await fetch(base + path, {
      method, body: body && JSON.stringify(body),
      headers: { "Content-Type": "application/json", Authorization: `tma ${initData(u, Math.floor(clock.t / 1000))}` },
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    await fn({ call, clock, store, economy });
  } finally {
    server.close();
    store.close();
  }
}

test("HTTP: a checked game closes the game's tasks, goes to its table and gives achievements", () =>
  withServer(async ({ call, clock, economy, store }) => {
    let r = await call("POST", "/api/range/ticket");
    assert.equal(r.status, 200);
    const seed = r.json.seed;
    const g = play(seed, { rounds: 3 });
    // Раньше, чем прошло столько времени, игра не принимается.
    r = await call("POST", "/api/range/run", { seed, players: 1, log: g.log });
    assert.equal(r.status, 422);
    const t1 = (await call("POST", "/api/range/ticket")).json.seed;
    const g1 = play(t1, { rounds: 3 });
    clock.t += g1.frames * 17;
    r = await call("POST", "/api/range/run", { seed: t1, players: 1, log: g1.log });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.score, g1.state.score);
    assert.ok(r.json.newAchievements.some((a) => a.code === "range_round1"));
    const me = (await call("GET", "/api/wallet/me")).json;
    assert.ok(me.tasks.range.find((t) => t.id === "play").done);
    assert.ok(me.tasks.range.find((t) => t.id === "level").done, "a round cleared is the game's «level»");
    assert.ok(me.tasks.range.some((t) => t.id === "ach:range_round1" && t.done));
    const top = (await call("GET", "/api/wallet/top?board=range&period=week")).json;
    assert.equal(top.rows[0].value, g1.state.score);
    // Повтор того же билета ничего не добавит.
    r = await call("POST", "/api/range/run", { seed: t1, players: 1, log: g1.log });
    assert.equal(r.status, 409);
    const before = economy.me(5).history.length;
    const t2 = (await call("POST", "/api/range/ticket")).json.seed;
    clock.t += 3600_000;
    r = await call("POST", "/api/range/run", { seed: t2, players: 1, log: "e5" });
    assert.equal(r.status, 422);
    assert.equal(economy.me(5).history.length, before);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM range_runs").get().n, 1);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM bombs_runs").get().n, 0, "other games' tables are not touched");
  }));

test("the shop sells the game's looks for жетоны and for stars, and the week has a prize table", () => {
  const items = CFG.shop.filter((i) => i.game === "range");
  assert.ok(items.length >= 2);
  for (const it of items) assert.ok(it.price > 0 && it.stars > 0, it.id);
  assert.ok(CFG.season.boards.range.length > 0);
});
