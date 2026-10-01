import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, openDb } from "../db.js";
import { startApp } from "../app.js";
import { redact, addSecret } from "../log.js";

// Контракт с сервером (ТЗ, P0-3): без сети и без настоящего токена, только во временной папке.

const tmp = () => mkdtempSync(join(tmpdir(), "bot-test-"));
const env = (dir, extra = {}) => ({
  WEBAPP_URL: "https://game.example/",
  DB_FILE: join(dir, "scores.db"),
  GIT_COMMIT: "0123456789abcdef0123456789abcdef01234567",
  ...extra,
});

test("health reports commit and uptime", async () => {
  const dir = tmp();
  const app = await startApp({ env: env(dir), botToken: "1:x", port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${app.port}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.commit, "0123456789abcdef0123456789abcdef01234567");
    assert.ok(Number.isInteger(body.uptime) && body.uptime >= 0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migrates a database made before migrations existed without losing data", () => {
  const dir = tmp();
  const file = join(dir, "old.db");
  try {
    // Схема и данные в том виде, в каком их создавала первая версия бота (user_version = 0).
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE players (id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT,
        games INTEGER NOT NULL DEFAULT 0, total_coins INTEGER NOT NULL DEFAULT 0,
        best_score INTEGER NOT NULL DEFAULT 0, best_at INTEGER, created_at INTEGER NOT NULL);
      CREATE TABLE runs (id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id),
        score INTEGER NOT NULL, coins INTEGER NOT NULL, levels INTEGER NOT NULL, deaths INTEGER NOT NULL,
        completed INTEGER NOT NULL, boss_fire INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE level_results (id INTEGER PRIMARY KEY, player_id INTEGER NOT NULL REFERENCES players(id),
        level INTEGER NOT NULL, score INTEGER NOT NULL, time_left INTEGER NOT NULL, deaths INTEGER NOT NULL,
        created_at INTEGER NOT NULL);
      CREATE TABLE achievements (player_id INTEGER NOT NULL REFERENCES players(id), code TEXT NOT NULL,
        earned_at INTEGER NOT NULL, PRIMARY KEY (player_id, code));
      CREATE INDEX players_best ON players(best_score DESC);
      INSERT INTO players VALUES (7, 'Старый игрок', NULL, 3, 120, 45000, 1000, 900);
      INSERT INTO runs VALUES (1, 7, 45000, 60, 4, 1, 1, 0, 1000);
      INSERT INTO achievements VALUES (7, 'first_level', 950);
    `);
    old.close();

    const store = openDb(file);
    assert.deepEqual(store.version, { from: 0, to: MIGRATIONS.length });
    assert.equal(store.getPlayer(7).best_score, 45000);
    assert.equal(store.top(10)[0].name, "Старый игрок");
    assert.deepEqual(store.earned(7).map((a) => a.code), ["first_level"]);
    // Миграция 3: игроки, бывшие до статистики, помечены как old и не считаются новыми.
    assert.equal(store.getSeen(7).source, "old");
    store.close();

    // Повторный запуск ничего не меняет.
    const again = openDb(file);
    assert.deepEqual(again.version, { from: MIGRATIONS.length, to: MIGRATIONS.length });
    again.close();

    // База из будущей версии кода не открывается молча.
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
    db.close();
    assert.throws(() => openDb(file), /новее кода/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("1000 created and abandoned rooms leave nothing behind", async () => {
  const dir = tmp();
  // Все соединения теста идут с одного адреса, поэтому лимиты на адрес подняты.
  const app = await startApp({ env: env(dir), botToken: "1:x", port: 0, tanksLimits: { perIp: 1000, roomsPerIp: 1000 } });
  const url = `ws://127.0.0.1:${app.port}/ws/tanks`;
  try {
    for (let batch = 0; batch < 10; batch++) {
      await Promise.all(Array.from({ length: 100 }, () => new Promise((done, fail) => {
        const ws = new WebSocket(url);
        ws.onopen = () => ws.send(JSON.stringify({ t: "create" }));
        ws.onmessage = (e) => {
          if (JSON.parse(e.data).t !== "room") return fail(new Error(e.data));
          ws.onclose = () => done();
          ws.close();
        };
        ws.onerror = () => fail(new Error("ws error"));
      })));
    }
    const deadline = Date.now() + 5000;
    while ((app.tanks.rooms.size || app.tanks.wss.clients.size) && Date.now() < deadline) {
      await new Promise((ok) => setTimeout(ok, 50));
    }
    assert.equal(app.tanks.rooms.size, 0);
    assert.equal(app.tanks.wss.clients.size, 0);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("close() stops HTTP, WebSocket and the database quickly", async () => {
  const dir = tmp();
  const app = await startApp({ env: env(dir), botToken: "1:x", port: 0 });
  const ws = new WebSocket(`ws://127.0.0.1:${app.port}/ws/tanks`);
  await new Promise((ok) => { ws.onopen = ok; });
  const closed = new Promise((ok) => { ws.onclose = ok; });
  await fetch(`http://127.0.0.1:${app.port}/api/health`, { keepalive: true });

  const t0 = Date.now();
  await app.close();
  await closed;
  assert.ok(Date.now() - t0 < 3000, "shutdown took too long");
  assert.equal(app.server.listening, false);
  assert.throws(() => app.store.db.prepare("SELECT 1"));
  rmSync(dir, { recursive: true, force: true });
});

test("logs never contain the token or Telegram signatures", () => {
  addSecret("123456789:AAFakeTokenForTestsOnly_xyz");
  const line = redact(
    "GET https://api.telegram.org/bot123456789:AAFakeTokenForTestsOnly_xyz/getMe " +
      "Authorization: tma query_id=q&user=%7B%22id%22%3A1%7D&hash=" + "ab".repeat(32) +
      " #tgWebAppData=auth_date%3D1 token 123456789:AAFakeTokenForTestsOnly_xyz",
  );
  assert.ok(!line.includes("AAFakeTokenForTestsOnly"), line);
  assert.ok(!line.includes("ab".repeat(32)), line);
  assert.ok(!line.includes("%7B%22id"), line);
  assert.ok(!line.includes("auth_date%3D1"), line);
});

test("rate limiter memory stays bounded and expires old keys", async () => {
  const { createRateLimiter } = await import("../ratelimit.js");
  const clock = { t: 0 };
  const rl = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 100, now: () => clock.t });
  for (let i = 0; i < 10_000; i++) rl.take(`ip${i}`);
  assert.ok(rl.size <= 100);
  clock.t += 1001;
  rl.take("fresh");
  assert.equal(rl.size, 1);
});
