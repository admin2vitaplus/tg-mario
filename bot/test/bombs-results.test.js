import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { WebSocket } from "ws";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";
import { createEconomy, loadEconomy } from "../economy.js";
import { createBombsResults } from "../bombs-results.js";
import { encode, MIN_QUIT_FRAMES, replay } from "../bombs-replay.js";
import { startApp } from "../app.js";

// «Бомбодром» на сервере: повтор записи нажатий, билеты, онлайн-дуэль, жетоны и таблица.

const S = globalThis.BombSim;
const CFG = loadEconomy();

test("the server's copy of the game rules is the game's own file", () => {
  const web = readFileSync(new URL("../../web/bombs/sim.js", import.meta.url), "utf8");
  const bot = readFileSync(new URL("../bombs-sim.js", import.meta.url), "utf8");
  assert.equal(bot, web, "copy web/bombs/sim.js to bot/bombs-sim.js");
});

// Играет «как человек»: ходит, ставит бомбы, иногда жмёт «взорвать»; проходит этапы, если повезёт.
function play(seed, players = 1) {
  const s = S.newGame(players, seed);
  const steps = [];
  let x = seed, dir = 0, hold = 0;
  const rnd = () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const code = (i) => (i.dir + 1) * 4 + (i.a ? 2 : 0) + (i.b ? 1 : 0);
  while (s.phase !== "overDone" && steps.length < 200_000) {
    if (s.phase === "clearDone") {
      steps.push("n");
      S.startStage(s, s.stage + 1);
      continue;
    }
    if (--hold <= 0) { dir = Math.floor(rnd() * 5) - 1; hold = 10 + Math.floor(rnd() * 40); }
    const me = { dir, a: s.frame % 90 === 0, b: s.frame % 200 === 0 };
    const friend = { dir: (dir + 2) % 4, a: s.frame % 70 === 0, b: false };
    const inputs = players === 1 ? [me] : [me, friend];
    steps.push(players === 1 ? code(me) : code(me) * 20 + code(friend));
    S.step(s, inputs);
    s.events.length = 0;
  }
  return { log: encode(steps), state: s, frames: steps.filter((v) => v !== "n").length };
}

test("replay gives the same scores as the game, and a changed record is caught", () => {
  for (const [seed, players] of [[11, 1], [222, 1], [3333, 2], [44, 2]]) {
    const g = play(seed, players);
    const r = replay({ seed, players, log: g.log });
    assert.equal(r.ok, true, r.why);
    assert.deepEqual(r.scores, g.state.players.map((p) => p.score));
    assert.equal(r.frames, g.frames);
  }
  const g = play(11);
  assert.equal(replay({ seed: 11, players: 1, log: g.log + ",0x5" }).why, "steps after the end");
  // Вышел из игры: засчитывается, если играли хотя бы MIN_QUIT_FRAMES, иначе — нет.
  assert.equal(replay({ seed: 11, players: 1, log: "0x10" }).why, "game not finished");
  // Первые MIN_QUIT_FRAMES кадров записи длинной игры и ещё один — игра брошена посередине.
  const [qs, lg] = [11, 222, 3333, 44, 55, 66, 77, 88].map((sd) => [sd, play(sd)]).find(([, x]) => x.frames > MIN_QUIT_FRAMES + 300);
  let left = MIN_QUIT_FRAMES + 1;
  const cut = [];
  for (const part of lg.log.split(",")) {
    if (left <= 0) break;
    if (part === "n") { cut.push(part); continue; }
    const [, c, n = "1"] = /^(\w)(?:x(\w+))?$/.exec(part);
    const k = Math.min(left, parseInt(n, 36));
    cut.push(k > 1 ? `${c}x${k.toString(36)}` : c);
    left -= k;
  }
  const quit = replay({ seed: qs, players: 1, log: cut.join(",") });
  assert.equal(quit.ok, true, quit.why);
  assert.equal(quit.quit, true);
  assert.equal(replay({ seed: 11, players: 1, log: g.log }).quit, false);
  assert.equal(replay({ seed: 11, players: 1, log: "n," + g.log }).why, "next stage before clear");
  assert.equal(replay({ seed: 11, players: 1, log: "k" }).why, "bad step", "codes above 19 are not one player's");
  assert.equal(replay({ seed: 11, players: 2, log: "b4" }).why, "bad step", "codes above 399 are not two players'");
  assert.equal(replay({ seed: 11, players: 1, log: "0xzzzzzz" }).why, "too long");
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
  const clock = { t: Date.UTC(2026, 9, 7, 12) };
  const store = openDb(":memory:");
  const rooms = new Map();
  const results = createBombsResults(store, { now: () => clock.t, members: (code) => rooms.get(code) ?? null });
  const economy = createEconomy(store, CFG, { now: () => clock.t });
  const server = createApiServer({ store, botToken: TOKEN, allowedOrigins: ["*"], economy, bombs: results, now: () => clock.t });
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
    await fn({ call, clock, store, rooms, results, economy });
  } finally {
    server.close();
    store.close();
  }
}

test("HTTP: a checked game closes the game's tasks, goes to its table; a forged one pays nothing", () =>
  withServer(async ({ call, clock, economy, store }) => {
    let r = await call("POST", "/api/bombs/ticket");
    assert.equal(r.status, 200);
    const seed = r.json.seed;
    const g = play(seed);
    clock.t += g.frames * 17;
    r = await call("POST", "/api/bombs/run", { seed, players: 1, log: g.log });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.score, g.state.players[0].score);
    const me = (await call("GET", "/api/wallet/me")).json;
    assert.ok(me.tasks.bombs.find((t) => t.id === "play").done);
    if (g.state.players[0].score > 0) {
      const top = (await call("GET", "/api/wallet/top?board=bombs&period=week")).json;
      assert.equal(top.rows[0].value, g.state.players[0].score);
    }

    const t2 = (await call("POST", "/api/bombs/ticket")).json.seed;
    // Записи на пару секунд: игрой это не считается, жетонов не будет.
    const forged = "0x78";
    clock.t += 3600_000;
    const before = economy.me(5).history.length;
    r = await call("POST", "/api/bombs/run", { seed: t2, players: 1, log: forged });
    assert.equal(r.status, 422);
    assert.equal(economy.me(5).history.length, before);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM bombs_runs").get().n, 1);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM tanks_runs").get().n, 0, "tanks tables are not touched");
  }));

test("online duel: the host sends it, both players get their own score", () =>
  withServer(async ({ call, clock, rooms }) => {
    rooms.set("123456", { host: 5, guest: 6 });
    const seed = (await call("POST", "/api/bombs/ticket")).json.seed;
    const g = play(seed, 2);
    clock.t += g.frames * 17;
    const r = await call("POST", "/api/bombs/run", { seed, players: 2, log: g.log, room: "123456" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.score, g.state.players[0].score);
    const friend = (await call("GET", "/api/wallet/me", null, { id: 6, first_name: "Лев" })).json;
    assert.ok(friend.tasks.bombs.find((t) => t.id === "play").done, "the guest's game counts too");
  }));

test("the shop sells the game's looks for жетоны and for stars", () => {
  const items = CFG.shop.filter((i) => i.game === "bombs");
  assert.ok(items.length >= 2);
  for (const it of items) assert.ok(it.price > 0 && it.stars > 0, it.id);
  assert.ok(CFG.season.boards.bombs.length > 0, "a weekly prize table");
});

test("the app opens duel rooms on /ws/bombs next to the tanks rooms", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "bombs-"));
  const app = await startApp({
    env: { DB_FILE: join(dir, "scores.db"), WEBAPP_URL: "https://game.example/" },
    botToken: "1:x", port: 0, tanksLimits: { perIp: 1000, roomsPerIp: 1000 },
  });
  try {
    const open = (path) => new Promise((ok, fail) => {
      const ws = new WebSocket(`ws://127.0.0.1:${app.port}${path}`);
      ws.on("open", () => ok(ws));
      ws.on("error", fail);
    });
    const next = (ws) => new Promise((ok) => ws.once("message", (d) => ok(JSON.parse(d))));
    const host = await open("/ws/bombs");
    host.send(JSON.stringify({ t: "create" }));
    const room = await next(host);
    assert.equal(room.t, "room");
    assert.equal(app.bombs.rooms.size, 1);
    assert.equal(app.tanks.rooms.size, 0, "a duel room is not a tanks room");
    const guest = await open("/ws/bombs");
    const peer = next(host);
    guest.send(JSON.stringify({ t: "join", code: room.code }));
    assert.equal((await next(guest)).t, "joined");
    assert.equal((await peer).t, "peer");
    // Сообщения дуэли пересылаются второму игроку как есть.
    const got = next(guest);
    host.send(JSON.stringify({ t: "s", f: 1 }));
    assert.deepEqual(await got, { t: "s", f: 1 });
    host.close(1000);
    guest.close(1000);
  } finally {
    await app.close();
  }
});
