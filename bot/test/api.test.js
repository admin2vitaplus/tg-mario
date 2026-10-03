import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";

const TOKEN = "123456:TEST";

function initData(user, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: "q", user: JSON.stringify(user) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

// Часы сервера подменяются, чтобы проверять «слишком быстро» и окна лимитов без ожидания.
async function withServer(fn, { limits } = {}) {
  const store = openDb(":memory:");
  const notified = [];
  const clock = { t: Date.now() };
  const server = createApiServer({
    store, botToken: TOKEN, allowedOrigins: ["https://game.example"],
    onAchievements: (id, list) => notified.push([id, list]),
    now: () => clock.t, ...(limits ? { limits } : {}),
  });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { user, body, auth, origin = "https://game.example", headers: extra, raw } = {}) => {
    const headers = { "Content-Type": "application/json", ...extra };
    if (origin) headers.Origin = origin;
    if (user) headers.Authorization = `tma ${initData(user, Math.floor(clock.t / 1000))}`;
    if (auth) headers.Authorization = auth;
    const res = await fetch(base + path, { method, headers, body: raw ?? (body && JSON.stringify(body)) });
    return {
      status: res.status,
      cors: res.headers.get("access-control-allow-origin"),
      retryAfter: res.headers.get("retry-after"),
      json: await res.json(),
    };
  };
  const wait = (sec) => { clock.t += sec * 1000; };
  try {
    await fn(call, notified, wait, clock);
  } finally {
    server.close();
    store.close();
  }
}

const alice = { id: 1, first_name: "Алиса" };
const bob = { id: 2, first_name: "Боб", username: "bob" };

test("rejects missing or forged signatures", () =>
  withServer(async (call) => {
    assert.equal((await call("GET", "/api/mario/me")).status, 401);
    const forged = initData(alice).replace("%D0%90", "%D0%91");
    assert.equal((await call("GET", "/api/mario/me", { auth: `tma ${forged}` })).status, 401);
    const old = `tma ${initData(alice, 1000)}`;
    assert.equal((await call("GET", "/api/mario/me", { auth: old })).status, 401);
  }));

// Честная игра: отчёты об уровнях по порядку, с реальным временем между ними.
// Уровень в мире и мир считаются по порядку, начиная с from (сквозной номер).
async function playLevels(call, wait, user, levels, from = 0) {
  for (const [k, [score, timeLeft, deaths = 0]] of levels.entries()) {
    const i = from + k;
    const r = await call("POST", "/api/mario/level", { user, body: { world: Math.floor(i / 4) + 1, level: i % 4, score, timeLeft, deaths } });
    assert.equal(r.status, 200, `level ${i}: ${JSON.stringify(r.json)}`);
    wait(90);
  }
}

test("records levels and runs, awards achievements once, ranks players", () =>
  withServer(async (call, notified, wait) => {
    let r = await call("POST", "/api/mario/level", { user: alice, body: { level: 0, score: 3000, timeLeft: 250, deaths: 0 } });
    assert.equal(r.status, 200);
    assert.equal(r.cors, "https://game.example");
    assert.deepEqual(r.json.newAchievements.map((a) => a.code).sort(), ["first_level", "no_death_level", "speedrun"]);
    wait(90);

    // Новая игра с начала: те же достижения второй раз не выдаются.
    // Все четыре мира без потерь.
    const all = Array.from({ length: 16 }, (_, i) => [3000 + i * 3500, i === 8 ? 150 : 100]);
    await playLevels(call, wait, alice, all);

    r = await call("POST", "/api/mario/run", {
      user: alice, body: { score: 60000, coins: 55, levels: 16, deaths: 0, completed: true, bossFire: true },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.best, 60000);
    assert.equal(r.json.rank, 1);
    assert.equal(r.json.newRecord, true);
    assert.deepEqual(r.json.newAchievements.map((a) => a.code).sort(),
      ["boss_fire", "coins_run_50", "no_death_world", "score_50k"]);
    assert.deepEqual(notified.flatMap(([, list]) => list.map((a) => a.code)).sort(), [
      "boss_fire", "coins_run_50", "first_level", "no_death_level", "no_death_world",
      "score_50k", "speedrun", "treetops", "underground", "world_clear",
    ]);

    await playLevels(call, wait, bob, [[20000, 300], [45000, 300]]);
    r = await call("POST", "/api/mario/run", { user: bob, body: { score: 70000, coins: 3, levels: 2, deaths: 3, completed: false } });
    assert.equal(r.status, 200);
    r = await call("POST", "/api/mario/run", { user: alice, body: { score: 100, coins: 0, levels: 0, deaths: 3 } });
    assert.equal(r.json.best, 60000);
    assert.equal(r.json.rank, 2);
    assert.equal(r.json.newRecord, false);

    const top = await call("GET", "/api/mario/top");
    assert.deepEqual(top.json.map((p) => [p.place, p.name, p.score]), [[1, "Боб", 70000], [2, "Алиса", 60000]]);

    const me = await call("GET", "/api/mario/me", { user: alice });
    assert.equal(me.json.games, 2);
    assert.equal(me.json.achievements.length, 10);
  }));

test("rejects out-of-range or inconsistent results", () =>
  withServer(async (call) => {
    assert.equal((await call("POST", "/api/mario/run", { user: alice, body: { score: 9e9, coins: 0, levels: 0, deaths: 0 } })).status, 400);
    assert.equal((await call("POST", "/api/mario/run", { user: alice, body: { score: 1, coins: 0, levels: 1, deaths: 0, completed: true } })).status, 422);
    assert.equal((await call("POST", "/api/mario/level", { user: alice, body: { level: 7, score: 1, timeLeft: 1, deaths: 0 } })).status, 400);
    assert.equal((await call("POST", "/api/mario/level", { user: alice, body: { world: 5, level: 0, score: 1, timeLeft: 1, deaths: 0 } })).status, 400);
    assert.equal((await call("GET", "/api/nope")).status, 404);
  }));

// ---------- ТЗ, P0-4: безопасность API ----------

test("auth_date older than 24 hours or from the future is rejected", () =>
  withServer(async (call, _n, _w, clock) => {
    const at = (hoursAgo) => `tma ${initData(alice, Math.floor(clock.t / 1000 - hoursAgo * 3600))}`;
    assert.equal((await call("GET", "/api/mario/me", { auth: at(23) })).status, 200);
    assert.equal((await call("GET", "/api/mario/me", { auth: at(25) })).status, 401);
    assert.equal((await call("GET", "/api/mario/me", { auth: at(-1) })).status, 401);
  }));

test("requests per IP are limited, separately for each player behind the tunnel", () =>
  withServer(async (call, _n, wait) => {
    for (let i = 0; i < 5; i++) assert.equal((await call("GET", "/api/mario/top")).status, 200);
    const r = await call("GET", "/api/mario/top");
    assert.equal(r.status, 429);
    assert.ok(Number(r.retryAfter) >= 1);
    // Другой игрок за тем же туннелем (свой CF-Connecting-IP) не страдает.
    assert.equal((await call("GET", "/api/mario/top", { headers: { "CF-Connecting-IP": "203.0.113.9" } })).status, 200);
    // Мониторинг не ограничивается.
    assert.equal((await call("GET", "/api/health")).status, 200);
    wait(61);
    assert.equal((await call("GET", "/api/mario/top")).status, 200);
  }, { limits: { ipPerMinute: 5, userWritesPerMinute: 100 } }));

test("writes per player are limited", () =>
  withServer(async (call) => {
    const run = { score: 0, coins: 0, levels: 0, deaths: 3 };
    for (let i = 0; i < 3; i++) assert.equal((await call("POST", "/api/mario/run", { user: alice, body: run })).status, 200);
    assert.equal((await call("POST", "/api/mario/run", { user: alice, body: run })).status, 429);
    assert.equal((await call("POST", "/api/mario/run", { user: bob, body: run })).status, 200);
  }, { limits: { ipPerMinute: 100, userWritesPerMinute: 3 } }));

test("request body is limited in size and must be a JSON object", () =>
  withServer(async (call) => {
    const big = JSON.stringify({ score: 1, pad: "x".repeat(5000) });
    assert.equal((await call("POST", "/api/mario/run", { user: alice, raw: big })).status, 413);
    assert.equal((await call("POST", "/api/mario/run", { user: alice, raw: "[1,2]" })).status, 400);
    assert.equal((await call("POST", "/api/mario/run", { user: alice, raw: "{oops" })).status, 400);
  }));

test("CORS is allowed only for the game site", () =>
  withServer(async (call) => {
    const ok = await call("GET", "/api/mario/top");
    assert.equal(ok.cors, "https://game.example");
    const evil = await call("GET", "/api/mario/top", { origin: "https://evil.example" });
    assert.equal(evil.status, 403);
    assert.equal(evil.cors, null);
    const noOrigin = await call("GET", "/api/mario/top", { origin: null });
    assert.equal(noOrigin.status, 200);
    assert.equal(noOrigin.cors, null);
  }));

test("impossible scores never reach the leaderboard", () =>
  withServer(async (call, _n, wait) => {
    const level = (body) => call("POST", "/api/mario/level", { user: alice, body: { deaths: 0, ...body } });
    const run = (body) => call("POST", "/api/mario/run", { user: alice, body: { deaths: 0, coins: 0, ...body } });

    // Уровень пройден быстрее, чем возможно, или с невозможным счётом.
    assert.equal((await level({ level: 0, score: 1000, timeLeft: 395 })).status, 422);
    assert.equal((await level({ level: 0, score: 90000, timeLeft: 200 })).status, 422);
    // Уровень 2 без уровней 0 и 1.
    assert.equal((await level({ level: 2, score: 1000, timeLeft: 100 })).status, 422);

    assert.equal((await level({ level: 0, score: 5000, timeLeft: 300 })).status, 200);
    // Следующий уровень через 5 секунд после предыдущего, хотя на таймере ушло 300 тиков (2 минуты).
    wait(5);
    assert.equal((await level({ level: 1, score: 9000, timeLeft: 100 })).status, 422);
    wait(120);
    assert.equal((await level({ level: 1, score: 9000, timeLeft: 100 })).status, 200);

    // Итог не сходится с отчётами об уровнях.
    assert.equal((await run({ score: 400000, levels: 2 })).status, 422);       // слишком много очков
    assert.equal((await run({ score: 20000, levels: 4, completed: true })).status, 422); // уровни не пройдены
    assert.equal((await run({ score: 20000, levels: 2, coins: 500 })).status, 422);      // монет больше, чем очков
    assert.equal((await run({ score: 20000, levels: 3 })).status, 422);       // отчётов только два

    const top = await call("GET", "/api/mario/top");
    assert.deepEqual(top.json, []);

    assert.equal((await run({ score: 20000, levels: 2, coins: 30 })).status, 200);
    assert.deepEqual((await call("GET", "/api/mario/top")).json.map((p) => p.score), [20000]);
  }));

// Четыре мира (PR с мирами 2–4): продолжение по мирам, труба-переход, «Продолжить с мира N».
test("worlds 2-4: a game goes on across worlds, through the warp pipe and from a later world", () =>
  withServer(async (call, _n, wait) => {
    const level = (body) => call("POST", "/api/mario/level", { user: alice, body: { deaths: 0, ...body } });
    const run = (body) => call("POST", "/api/mario/run", { user: alice, body: { deaths: 0, coins: 0, ...body } });

    // Весь первый мир и первый уровень второго: счёт идёт дальше, это та же игра.
    await playLevels(call, wait, alice, [[4000, 200], [9000, 200], [15000, 150], [22000, 150], [30000, 200]]);
    assert.equal((await run({ score: 32000, levels: 5 })).status, 200);
    wait(60);

    // 1-1, затем труба в 1-2 ведёт сразу в 4-1.
    assert.equal((await level({ world: 1, level: 0, score: 5000, timeLeft: 200 })).status, 200);
    wait(120);
    assert.equal((await level({ world: 4, level: 0, score: 26000, timeLeft: 200 })).status, 200);
    wait(120);
    // Но не прыжок в середину мира.
    assert.equal((await level({ world: 4, level: 2, score: 30000, timeLeft: 100 })).status, 422);
    assert.equal((await run({ score: 30000, levels: 2 })).status, 200);

    // «Продолжить с мира 3»: новая игра с нуля с первого уровня третьего мира.
    wait(600);
    assert.equal((await level({ world: 3, level: 0, score: 4000, timeLeft: 200 })).status, 200);
    wait(120);
    assert.equal((await level({ world: 3, level: 1, score: 8000, timeLeft: 200 })).status, 200);
    assert.equal((await run({ score: 9000, levels: 2 })).status, 200);
    // Начать с середины мира нельзя.
    assert.equal((await level({ world: 3, level: 2, score: 4000, timeLeft: 200 })).status, 422);
  }));

test("level times on the server are the game's own", async () => {
  const { WORLD_TIMES } = await import("../plausibility.js");
  const { readFileSync } = await import("node:fs");
  const times = (f) => [...readFileSync(new URL(`../../web/${f}`, import.meta.url), "utf8")
    .matchAll(/\btime: (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual([...times("levels.js"), ...times("worlds.js")], WORLD_TIMES.flat());
});
