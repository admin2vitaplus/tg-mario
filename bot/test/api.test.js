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

async function withServer(fn) {
  const store = openDb(":memory:");
  const notified = [];
  const server = createApiServer({
    store, botToken: TOKEN, allowedOrigins: ["https://game.example"],
    onAchievements: (id, list) => notified.push([id, list]),
  });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { user, body, auth } = {}) => {
    const headers = { "Content-Type": "application/json", Origin: "https://game.example" };
    if (user) headers.Authorization = `tma ${initData(user)}`;
    if (auth) headers.Authorization = auth;
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, cors: res.headers.get("access-control-allow-origin"), json: await res.json() };
  };
  try {
    await fn(call, notified);
  } finally {
    server.close();
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

test("records levels and runs, awards achievements once, ranks players", () =>
  withServer(async (call, notified) => {
    let r = await call("POST", "/api/mario/level", { user: alice, body: { level: 0, score: 3000, timeLeft: 250, deaths: 0 } });
    assert.equal(r.status, 200);
    assert.equal(r.cors, "https://game.example");
    assert.deepEqual(r.json.newAchievements.map((a) => a.code).sort(), ["first_level", "no_death_level", "speedrun"]);

    r = await call("POST", "/api/mario/level", { user: alice, body: { level: 0, score: 3000, timeLeft: 250, deaths: 0 } });
    assert.deepEqual(r.json.newAchievements, []);

    r = await call("POST", "/api/mario/run", {
      user: alice, body: { score: 60000, coins: 55, levels: 4, deaths: 0, completed: true, bossFire: true },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.best, 60000);
    assert.equal(r.json.rank, 1);
    assert.equal(r.json.newRecord, true);
    assert.deepEqual(r.json.newAchievements.map((a) => a.code).sort(),
      ["boss_fire", "coins_run_50", "no_death_world", "score_50k", "world_clear"]);
    assert.equal(notified.length, 2);

    await call("POST", "/api/mario/run", { user: bob, body: { score: 70000, coins: 3, levels: 2, deaths: 3, completed: false } });
    r = await call("POST", "/api/mario/run", { user: alice, body: { score: 100, coins: 1, levels: 0, deaths: 3 } });
    assert.equal(r.json.best, 60000);
    assert.equal(r.json.rank, 2);
    assert.equal(r.json.newRecord, false);

    const top = await call("GET", "/api/mario/top");
    assert.deepEqual(top.json.map((p) => [p.place, p.name, p.score]), [[1, "Боб", 70000], [2, "Алиса", 60000]]);

    const me = await call("GET", "/api/mario/me", { user: alice });
    assert.equal(me.json.games, 2);
    assert.equal(me.json.achievements.length, 8);
  }));

test("rejects out-of-range or inconsistent results", () =>
  withServer(async (call) => {
    assert.equal((await call("POST", "/api/mario/run", { user: alice, body: { score: 9e9, coins: 0, levels: 0, deaths: 0 } })).status, 400);
    assert.equal((await call("POST", "/api/mario/run", { user: alice, body: { score: 1, coins: 0, levels: 1, deaths: 0, completed: true } })).status, 400);
    assert.equal((await call("POST", "/api/mario/level", { user: alice, body: { level: 7, score: 1, timeLeft: 1, deaths: 0 } })).status, 400);
    assert.equal((await call("GET", "/api/nope")).status, 404);
  }));
