import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";
import { createEconomy, loadEconomy } from "../economy.js";
import { createTracker } from "../stats.js";
import { createAdmin } from "../admin.js";

const TOKEN = "123456:TEST";
const OWNER = { id: 777, first_name: "Владелец", language_code: "ru" };
const alice = { id: 1, first_name: "Алиса", username: "alice" };

function initData(user, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: "q", user: JSON.stringify(user) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

async function withPanel(fn) {
  const store = openDb(":memory:");
  const economy = createEconomy(store, loadEconomy());
  const tracker = createTracker(store);
  const refunds = [];
  const admin = createAdmin({
    store, economy, admins: new Set([OWNER.id]), commit: "abc123", logger: () => {},
    refundStars: async (userId, charge) => { refunds.push([userId, charge]); },
  });
  const server = createApiServer({
    store, botToken: TOKEN, allowedOrigins: ["https://game.example"], tracker, economy, admin,
  });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { user, body, origin } = {}) => {
    const headers = { "Content-Type": "application/json" };
    if (origin) headers.Origin = origin;
    if (user) headers.Authorization = `tma ${initData(user)}`;
    const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch { /* страница */ }
    return { status: res.status, json, raw, headers: res.headers };
  };
  try {
    await fn({ call, store, economy, tracker, refunds });
  } finally {
    server.close();
    store.close();
  }
}

test("the panel API is closed to everyone but ADMIN_ID", () =>
  withPanel(async ({ call }) => {
    assert.equal((await call("GET", "/api/admin/overview")).status, 401);
    assert.equal((await call("GET", "/api/admin/overview", { user: alice })).status, 403);
    assert.equal((await call("POST", "/api/admin/adjust", { user: alice, body: { id: 1, amount: 500, key: "abcdefgh12" } })).status, 403);
    assert.equal((await call("GET", "/api/admin/players", { user: alice })).status, 403);
    const me = await call("GET", "/api/admin/me", { user: OWNER });
    assert.equal(me.status, 200);
    assert.equal(me.json.id, OWNER.id);
  }));

test("serves the page from the server itself with a strict CSP", () =>
  withPanel(async ({ call }) => {
    const page = await call("GET", "/admin");
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(page.raw, /admin\/admin\.js/);
    assert.doesNotMatch(page.raw, /https?:\/\//, "no outside hosts on the page");
    for (const p of ["/admin/admin.js", "/admin/admin.css", "/admin/admin/admin.js"]) {
      assert.equal((await call("GET", p)).status, 200, p);
    }
    const js = (await call("GET", "/admin/admin.js")).raw;
    assert.doesNotMatch(js, /https?:\/\//, "no outside hosts in the script");
    assert.doesNotMatch(js, /innerHTML/, "player names go in as text only");
    assert.equal((await call("GET", "/admin/../db.js")).status, 404);
    assert.equal((await call("GET", "/admin/index.html")).status, 404);
  }));

test("the panel's own origin works, other sites get no CORS", () =>
  withPanel(async ({ call }) => {
    // Свой адрес (туннель) не в ALLOWED_ORIGINS, но панели CORS не нужен.
    const own = await call("GET", "/api/admin/me", { user: OWNER, origin: "https://abc.trycloudflare.com" });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get("access-control-allow-origin"), null);
    // Остальное API для чужих сайтов закрыто, как и было.
    assert.equal((await call("GET", "/api/mario/top", { origin: "https://evil.example" })).status, 403);
    assert.equal((await call("GET", "/api/mario/top", { origin: "https://game.example" })).headers
      .get("access-control-allow-origin"), "https://game.example");
  }));

test("overview, search and player card", () =>
  withPanel(async ({ call, store, tracker, economy }) => {
    store.touchPlayer(alice);
    tracker.arrive(alice.id, "src_channel");
    tracker.event(alice.id, "game_start", "mario");
    economy.checkin(alice.id);
    store.db.prepare("INSERT INTO purchases (player_id, item, stars, charge_id, at) VALUES (?, ?, ?, ?, ?)")
      .run(alice.id, "pryg-pipe-neon", 10, "ch1", Date.now());

    const o = await call("GET", "/api/admin/overview", { user: OWNER });
    assert.equal(o.status, 200);
    assert.equal(o.json.players.today, 1);
    assert.equal(o.json.days.length, 30);
    assert.equal(o.json.days.at(-1).newPlayers, 1);
    assert.equal(o.json.stars.sum, 10);
    assert.equal(o.json.economy.week.issued, 10);
    assert.equal(o.json.server.commit, "abc123");
    assert.ok(o.json.server.rss > 0);

    const byName = await call("GET", `/api/admin/players?q=${encodeURIComponent("али")}`, { user: OWNER });
    assert.deepEqual(byName.json.map((p) => p.id), [1], "case-insensitive for Cyrillic names");
    const byUser = await call("GET", "/api/admin/players?q=%40ali", { user: OWNER });
    assert.deepEqual(byUser.json.map((p) => p.id), [1]);
    const byId = await call("GET", "/api/admin/players?q=1", { user: OWNER });
    assert.deepEqual(byId.json.map((p) => p.id), [1]);
    const recent = await call("GET", "/api/admin/players", { user: OWNER });
    assert.deepEqual(recent.json.map((p) => p.id), [1]);

    const card = await call("GET", "/api/admin/player?id=1", { user: OWNER });
    assert.equal(card.status, 200);
    assert.equal(card.json.seen.source, "src_channel");
    assert.equal(card.json.wallet.balance, 10);
    assert.equal(card.json.purchases.length, 1);
    assert.equal((await call("GET", "/api/admin/player?id=999", { user: OWNER })).status, 404);
    assert.equal((await call("GET", "/api/admin/player?id=abc", { user: OWNER })).status, 400);
  }));

test("manual tickets: once per key, never below zero, not in the weekly overall table", () =>
  withPanel(async ({ call, economy }) => {
    const adjust = (amount, key) => call("POST", "/api/admin/adjust", { user: OWNER, body: { id: alice.id, amount, key, note: "тест" } });
    let r = await adjust(500, "key0000001");
    assert.equal(r.status, 200);
    assert.equal(r.json.balance, 500);
    r = await adjust(500, "key0000001"); // повтор той же формы
    assert.equal(r.json.balance, 500);
    r = await adjust(-600, "key0000002");
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "not enough");
    r = await adjust(-200, "key0000003");
    assert.equal(r.json.balance, 300);
    assert.equal(economy.checkBalance(alice.id).ledger, 300);
    assert.equal((await adjust(0, "key0000004")).status, 400);
    assert.equal((await adjust(1.5, "key0000005")).status, 400);
    assert.equal((await adjust(10, "bad key!")).status, 400);
    assert.equal((await adjust(10_000_000, "key0000006")).status, 400);
    assert.deepEqual(economy.top("overall", "week").rows, []);
  }));

test("flag, annul and refund from the panel", () =>
  withPanel(async ({ call, economy, store, refunds }) => {
    economy.checkin(alice.id);
    let r = await call("POST", "/api/admin/flag", { user: OWNER, body: { id: alice.id, why: "подозрительно" } });
    assert.equal(r.status, 200);
    assert.equal(economy.wallet(alice.id).flagged, "подозрительно");
    await call("POST", "/api/admin/flag", { user: OWNER, body: { id: alice.id, on: false } });
    assert.equal(economy.wallet(alice.id).flagged, null);

    r = await call("POST", "/api/admin/annul", { user: OWNER, body: { id: alice.id } });
    assert.equal(r.json.annulled, 10);
    assert.equal(r.json.balance, 0);

    store.db.prepare("INSERT INTO purchases (player_id, item, stars, charge_id, at) VALUES (?, ?, ?, ?, ?)")
      .run(alice.id, "pryg-pipe-neon", 10, "ch1", Date.now());
    r = await call("POST", "/api/admin/refund", { user: OWNER, body: { id: 2, charge: "ch1" } });
    assert.equal(r.status, 400, "charge of another player");
    r = await call("POST", "/api/admin/refund", { user: OWNER, body: { id: alice.id, charge: "ch1" } });
    assert.equal(r.status, 200);
    assert.deepEqual(refunds, [[alice.id, "ch1"]]);
    assert.ok(economy.purchase("ch1").refunded_at);
    r = await call("POST", "/api/admin/refund", { user: OWNER, body: { id: alice.id, charge: "ch1" } });
    assert.equal(r.status, 409);
  }));
