import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";
import { createEconomy, loadEconomy } from "../economy.js";
import { createTanksResults } from "../tanks-results.js";
import { encode, replay } from "../tanks-replay.js";

// «Танкодром» на сервере: повтор записи нажатий (P0-4), билеты, онлайн-матч, жетоны (P1-7).

const S = globalThis.TankSim;
const CFG = loadEconomy();

test("the server's copy of the game rules is the game's own file", () => {
  const web = readFileSync(new URL("../../web/tanks/sim.js", import.meta.url), "utf8");
  const bot = readFileSync(new URL("../tanks-sim.js", import.meta.url), "utf8");
  assert.equal(bot, web, "copy web/tanks/sim.js to bot/tanks-sim.js");
});

// Играет «как человек»: держит направление, стреляет очередями, проходит уровни.
function play(seed, players = 1, { stopAtClear = false } = {}) {
  const s = S.newGame(players, seed);
  const steps = [];
  let x = seed, dir = 0, hold = 0;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  while (s.phase !== "overDone" && steps.length < 100_000) {
    if (s.phase === "clearDone") {
      if (stopAtClear) break;
      steps.push("n");
      S.startStage(s, s.stage + 1);
      continue;
    }
    if (--hold <= 0) { dir = Math.floor(rnd() * 5) - 1; hold = 20 + Math.floor(rnd() * 60); }
    const fire = s.frame % 8 === 0;
    const code = (dir + 1) * 2 + (fire ? 1 : 0);
    const inputs = players === 1 ? [{ dir, fire }] : [{ dir, fire }, { dir: -1, fire }];
    steps.push(players === 1 ? code : code * 10 + (fire ? 1 : 0));
    S.step(s, inputs);
    s.events.length = 0;
  }
  return { log: encode(steps), state: s, frames: steps.filter((v) => v !== "n").length };
}

test("replay gives the same score as the game, and a changed record is caught", () => {
  for (const seed of [11, 222, 3333]) {
    const g = play(seed);
    const r = replay({ seed, players: 1, log: g.log });
    assert.equal(r.ok, true, r.why);
    assert.deepEqual(r.scores, g.state.players.map((p) => p.score));
    assert.equal(r.frames, g.frames);
  }
  const g = play(11);
  assert.equal(replay({ seed: 11, players: 1, log: g.log + ",0x5" }).why, "steps after the end");
  assert.equal(replay({ seed: 11, players: 1, log: g.log.split(",").slice(0, -3).join(",") }).why, "game not finished");
  assert.equal(replay({ seed: 11, players: 1, log: "n," + g.log }).why, "next stage before clear");
  assert.equal(replay({ seed: 11, players: 1, log: "zz" }).why, "bad step");
  assert.equal(replay({ seed: 11, players: 1, log: "0xzzzzzz" }).why, "too long");
});

function setup() {
  const clock = { t: Date.UTC(2026, 9, 2, 12) };
  const store = openDb(":memory:");
  const rooms = new Map();
  const results = createTanksResults(store, { now: () => clock.t, members: (code) => rooms.get(code) ?? null });
  const economy = createEconomy(store, CFG, { now: () => clock.t });
  return { clock, store, rooms, results, economy };
}

// Билет выдаётся на зерно сервера, поэтому игра записывается под него.
function playTicket(results, clock, playerId, players = 1) {
  const { seed } = results.ticket(playerId);
  const g = play(seed, players);
  clock.t += Math.ceil((g.frames / 60) * 1000);
  return { seed, ...g };
}

test("tickets: own seed only, once, not faster than real time, limited", () => {
  const { clock, results, store } = setup();
  const { seed } = results.ticket(1);
  const g = play(seed);
  assert.equal(results.submit(2, { seed, players: 1, log: g.log }).status, 403, "someone else's ticket");
  clock.t += 1000;
  const fast = results.submit(1, { seed, players: 1, log: g.log });
  assert.equal(fast.status, 422);
  clock.t += g.frames * 17;
  const ok = results.submit(1, { seed, players: 1, log: g.log });
  assert.equal(ok.status, 200);
  assert.equal(ok.results[0].score, g.state.players[0].score);
  assert.equal(results.submit(1, { seed, players: 1, log: g.log }).status, 409, "the same game twice");
  for (let i = 0; i < 5; i++) results.ticket(1);
  assert.equal(results.ticket(1).error, "too many");
  clock.t += 7 * 3600_000;
  assert.ok(results.ticket(1).seed, "old unused tickets expire");
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM tanks_runs").get().n, 1);
});

test("online match: the host sends it, both players get their own score", () => {
  const { clock, results, rooms } = setup();
  rooms.set("123456", { host: 1, guest: 2 });
  const g = playTicket(results, clock, 1, 2);
  assert.equal(results.submit(2, { seed: g.seed, players: 2, log: g.log, room: "123456" }).status, 403);
  const r = results.submit(1, { seed: g.seed, players: 2, log: g.log, room: "123456" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.results.map((x) => [x.playerId, x.score]), [[1, g.state.players[0].score], [2, g.state.players[1].score]]);
  const other = playTicket(results, clock, 1, 2);
  assert.equal(results.submit(1, { seed: other.seed, players: 2, log: other.log, room: "999999" }).status, 403);
});

// ---------- Через HTTP: жетоны за танки и покупка за звёзды ----------

const TOKEN = "123456:TEST";
function initData(u, authDate) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(u) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

async function withServer(fn) {
  const { clock, store, rooms, results, economy } = setup();
  const invoices = [];
  const server = createApiServer({
    store, botToken: TOKEN, allowedOrigins: ["*"], economy, tanks: results, now: () => clock.t,
    createInvoice: async (item, user) => { invoices.push([item.id, user.id]); return `https://t.me/$invoice-${item.id}`; },
  });
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
    await fn({ call, clock, store, rooms, results, economy, invoices });
  } finally {
    server.close();
    store.close();
  }
}

test("HTTP: a checked tanks game closes the game's tasks and a record; a forged one pays nothing", () =>
  withServer(async ({ call, clock, economy }) => {
    let r = await call("POST", "/api/tanks/ticket");
    assert.equal(r.status, 200);
    const seed = r.json.seed;
    const g = play(seed);
    clock.t += g.frames * 17;
    r = await call("POST", "/api/tanks/run", { seed, players: 1, log: g.log });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.score, g.state.players[0].score);
    const reasons = r.json.wallet.grants.map((x) => x.reason);
    // «Сыграть», «пройти уровень» (если пройден) и рекорд (если очки есть).
    const expect = ["task"];
    if (g.state.stage > 0 || g.state.phase === "clearDone") expect.push("task");
    if (g.state.players[0].score > 0) expect.push("record");
    assert.deepEqual(reasons.sort(), expect.sort());

    const t2 = (await call("POST", "/api/tanks/ticket")).json.seed;
    // Обрезанная запись: игра в ней не закончена, очков не будет.
    const forged = play(t2).log.split(",").slice(0, -2).join(",");
    clock.t += 3600_000;
    r = await call("POST", "/api/tanks/run", { seed: t2, players: 1, log: forged });
    assert.equal(r.status, 422);
    assert.equal(economy.me(5).history.length, reasons.length);
    assert.equal((await call("POST", "/api/tanks/run", { seed: t2, players: 1, log: "x".repeat(600_000) })).status, 413);
  }));

test("Stars: invoice only for items not owned; payment once per charge; refund takes it back", () =>
  withServer(async ({ call, economy, invoices }) => {
    const item = CFG.shop[0];
    let r = await call("POST", "/api/wallet/invoice", { item: item.id });
    assert.equal(r.status, 200);
    assert.match(r.json.link, /invoice/);
    assert.deepEqual(invoices, [[item.id, 5]]);
    assert.equal((await call("POST", "/api/wallet/invoice", { item: "nope" })).status, 404);

    assert.equal(economy.starsCheck(5, item.id, item.stars + 1).error, "price changed");
    assert.equal(economy.starsCheck(5, item.id, item.stars).ok, true);
    assert.equal(economy.starsPaid(5, item.id, item.stars, "ch_1"), true);
    assert.equal(economy.starsPaid(5, item.id, item.stars, "ch_1"), false, "the same payment twice");
    assert.equal(economy.starsCheck(5, item.id, item.stars).error, "already");
    assert.equal((await call("POST", "/api/wallet/invoice", { item: item.id })).status, 409);
    assert.deepEqual((await call("GET", "/api/wallet/me")).json.owned, [item.id]);
    // Купленное за звёзды не продаётся второй раз за жетоны.
    economy.post(5, 1000, "prize", "gift");
    assert.equal(economy.buy(5, item.id).already, true);
    assert.equal(economy.me(5).balance, 1000);

    assert.equal(economy.refunded("ch_1"), true);
    assert.deepEqual(economy.me(5).owned, []);
    const info = (await call("GET", "/api/wallet/info")).json;
    assert.ok(info.shop.every((it) => it.stars > 0 && it.price > 0));
    assert.deepEqual(info.life.stars, CFG.life.stars);
  }));

test("One more life: жетоны once per offer, Stars invoice by level", () =>
  withServer(async ({ call, economy, invoices }) => {
    assert.equal((await call("POST", "/api/wallet/life", { offer: "run12345", level: 0 })).status, 409);
    economy.post(5, 150, "prize", "gift");
    let r = await call("POST", "/api/wallet/life", { offer: "run12345", level: 0 });
    assert.deepEqual([r.status, r.json.balance], [200, 50]);
    r = await call("POST", "/api/wallet/life", { offer: "run12345", level: 0 });
    assert.deepEqual([r.status, r.json.already, r.json.balance], [200, true, 50]);
    assert.equal((await call("POST", "/api/wallet/life", { offer: "x", level: 0 })).status, 400);

    r = await call("POST", "/api/wallet/life-invoice", { offer: "run67890", level: 1 });
    assert.equal(r.status, 200);
    assert.deepEqual(invoices.at(-1), ["life:run67890", 5]);
    assert.equal((await call("POST", "/api/wallet/life-invoice", { offer: "run12345", level: 0 })).status, 409);
    assert.equal((await call("POST", "/api/wallet/life-invoice", { offer: "run67890", level: 9 })).status, 400);
  }));
