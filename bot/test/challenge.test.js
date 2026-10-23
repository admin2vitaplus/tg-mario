import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";
import { createEconomy, DAY_MS, dayUtc, loadEconomy } from "../economy.js";
import { createNotices } from "../notices.js";
import { createChallenge, gameOfDay, REMIND_BATCH } from "../challenge.js";

// Испытание дня (challenge.js): игра дня, растущая награда за серию, таблицы, призы дня, напоминания.

const CFG = loadEconomy();
const R = CFG.challenge;
// День, когда испытание — «Прыг-Скок» (первая игра круга), 12:00 UTC.
const MARIO_DAY = Math.ceil(dayUtc(Date.UTC(2026, 9, 20)) / R.games.length) * R.games.length;
const T0 = MARIO_DAY * DAY_MS + 12 * 3_600_000;
const user = (id, name = `Игрок ${id}`) => ({ id, first_name: name });

function setup({ file = ":memory:", clock = { t: T0 }, remind = null } = {}) {
  const store = openDb(file);
  const economy = createEconomy(store, CFG, { now: () => clock.t });
  const notices = createNotices(store, { now: () => clock.t });
  const challenge = createChallenge(store, economy, { now: () => clock.t, remind, notices, logger: () => {} });
  return { store, economy, notices, challenge, clock };
}
const balance = (economy, id) => economy.wallet(id).balance;

test("one game a day for everyone, in turn; only that game, from the start and alone, counts", () => {
  const { store, economy, challenge, clock } = setup();
  assert.equal(gameOfDay(CFG, MARIO_DAY), "mario");
  assert.deepEqual(R.games.map((_, i) => gameOfDay(CFG, MARIO_DAY + i)), R.games);
  assert.equal(gameOfDay(CFG, MARIO_DAY + R.games.length), "mario");
  store.touchPlayer(user(1));
  assert.equal(challenge.record(1, "tanks", 500), null, "not today's game");
  assert.equal(challenge.record(1, "mario", 500, { fromStart: false }), null, "started from a chosen level");
  assert.equal(challenge.record(1, "mario", 500, { solo: false }), null, "two players");
  assert.equal(balance(economy, 1), 0);
  const out = [];
  assert.deepEqual(challenge.record(1, "mario", 500, {}, out), { first: true, best: 500, improved: true });
  assert.deepEqual(out, [{ reason: "challenge", amount: R.base }]);
  // A second game the same day: only the best score is kept, no second reward.
  const again = [];
  assert.deepEqual(challenge.record(1, "mario", 300, {}, again), { first: false, best: 500, improved: false });
  assert.deepEqual(challenge.record(1, "mario", 900, {}, again), { first: false, best: 900, improved: true });
  assert.deepEqual(again, []);
  assert.equal(balance(economy, 1), R.base);
  const s = challenge.state(1);
  assert.equal(s.game, "mario");
  assert.equal(s.tomorrow, gameOfDay(CFG, MARIO_DAY + 1));
  assert.equal(s.best, 900);
  assert.equal(s.played, true);
  assert.equal(s.streak, 1);
  assert.equal(s.endsAt, (MARIO_DAY + 1) * DAY_MS);
  // The next day the game changes.
  clock.t += DAY_MS;
  assert.equal(challenge.record(1, "mario", 900), null);
  assert.equal(challenge.state(1).played, false);
});

test("the reward grows with every day in a row and starts over after a missed day", () => {
  const { store, economy, challenge, clock } = setup();
  store.touchPlayer(user(1));
  const got = [];
  for (let i = 0; i < 8; i++) {
    const out = [];
    challenge.record(1, challenge.today(), 10, {}, out);
    got.push(out[0]?.amount);
    clock.t += DAY_MS;
  }
  assert.deepEqual(got, got.map((_, i) => Math.min(R.base + R.perStreakDay * i, R.max)));
  assert.equal(challenge.state(1).streak, 8, "yesterday's streak still counts until the day is over");
  assert.equal(challenge.state(1).reward, Math.min(R.base + R.perStreakDay * 8, R.max));
  clock.t += DAY_MS; // a missed day
  const out = [];
  challenge.record(1, challenge.today(), 10, {}, out);
  assert.deepEqual(out, [{ reason: "challenge", amount: R.base }]);
  assert.equal(balance(economy, 1), got.reduce((a, n) => a + n, 0) + R.base);
});

test("tables: everyone, this chat and friends; flagged players are left out", () => {
  const { store, economy, challenge } = setup();
  for (let id = 1; id <= 5; id++) store.touchPlayer(user(id));
  store.seen(1, { source: "direct" });
  store.seen(2, { source: "ref", inviter: 1 });
  [[1, 100], [2, 300], [3, 200], [4, 900], [5, 50]].forEach(([id, score]) => challenge.record(id, "mario", score));
  economy.flag(4, "test");
  challenge.state(3, { chat: "777" });
  challenge.state(5, { chat: "777" });
  const s = challenge.state(1, { chat: "777" });
  assert.deepEqual(s.all.rows.map((r) => [r.place, r.name, r.value, r.me]),
    [[1, "Игрок 2", 300, false], [2, "Игрок 3", 200, false], [3, "Игрок 1", 100, true], [4, "Игрок 5", 50, false]]);
  assert.deepEqual(s.all.me, { place: 3, value: 100 });
  assert.equal(s.all.players, 4);
  assert.deepEqual(s.chat.rows.map((r) => [r.place, r.value]), [[1, 200], [2, 100], [3, 50]]);
  assert.deepEqual(s.friends.rows.map((r) => [r.place, r.value]), [[1, 300], [2, 100]]);
  assert.deepEqual(challenge.state(2).friends.rows.map((r) => r.value), [300, 100], "the inviter is a friend too");
  assert.equal(challenge.state(2).chat, null, "opened not from a chat");
});

test("the day closes with prizes only when enough played; a restart pays nothing twice", () => {
  const dir = mkdtempSync(join(tmpdir(), "challenge-test-"));
  const file = join(dir, "s.db");
  try {
    let { store, economy, notices, challenge, clock } = setup({ file });
    assert.deepEqual(challenge.closeDue(), [], "the first day is where counting starts");
    // Day 1: too few players, no prizes.
    for (let id = 1; id < R.minPlayers; id++) { store.touchPlayer(user(id)); challenge.record(id, "mario", id * 10); }
    clock.t += DAY_MS;
    const before = balance(economy, 1);
    assert.deepEqual(challenge.closeDue(), [MARIO_DAY]);
    assert.equal(balance(economy, R.minPlayers - 1), R.base, "only the reward for playing");
    assert.equal(challenge.state(1).yesterday.prized, false);
    // Day 2: enough players.
    const game = challenge.today();
    for (let id = 1; id <= R.minPlayers + 1; id++) { store.touchPlayer(user(id)); challenge.record(id, game, id * 10); }
    const paid = (id) => store.db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE player_id = ? AND reason = 'prize'").get(id).n;
    clock.t += DAY_MS;
    store.close();
    // Restart before the day is closed: the new process closes it once.
    ({ store, economy, notices, challenge } = setup({ file, clock }));
    assert.deepEqual(challenge.closeDue(), [MARIO_DAY + 1]);
    assert.deepEqual(challenge.closeDue(), []);
    const top = R.minPlayers + 1;
    R.prizes.forEach((prize, i) => assert.equal(paid(top - i), prize, `place ${i + 1}`));
    assert.equal(paid(1), 0);
    assert.ok(balance(economy, 1) >= before);
    const s = challenge.state(top);
    assert.equal(s.yesterday.prized, true);
    assert.equal(s.yesterday.rows[0].me, true);
    // The winner gets a personal notice.
    const list = notices.list(top, "ru");
    assert.match(list.items[0].title, /1 место/);
    assert.equal(notices.list(1, "ru").items.length, 0);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a reminder goes once a day, in the evening, to whoever is about to lose a streak", async () => {
  const sent = [];
  let fail403 = new Set();
  const remind = async (id, text, opts) => {
    if (fail403.has(id)) throw Object.assign(new Error("blocked"), { error_code: 403 });
    sent.push({ id, text, opts });
  };
  const { store, economy, challenge, clock } = setup({ remind, clock: { t: MARIO_DAY * DAY_MS + 9 * 3_600_000 } });
  // Players 1–3 came two days in a row until yesterday; 4 came only yesterday; 5 is here today too.
  for (const id of [1, 2, 3, 4, 5]) store.touchPlayer(user(id));
  const setStreak = (id, streak, day) => store.db.prepare("INSERT INTO wallets (player_id, streak, streak_day, lang) VALUES (?, ?, ?, ?)")
    .run(id, streak, day, id === 2 ? "en" : "ru");
  setStreak(1, 3, MARIO_DAY - 1);
  setStreak(2, 2, MARIO_DAY - 1);
  setStreak(3, 5, MARIO_DAY - 1);
  setStreak(4, 1, MARIO_DAY - 1);
  setStreak(5, 4, MARIO_DAY);
  challenge.setRemind(3, false);
  assert.equal(await challenge.remindDue(), 0, "too early");
  clock.t = MARIO_DAY * DAY_MS + R.remindHour * 3_600_000;
  fail403 = new Set([2]);
  assert.equal(await challenge.remindDue(), 1);
  assert.deepEqual(sent.map((s) => s.id), [1]);
  assert.match(sent[0].text, /3 дня подряд/);
  assert.match(sent[0].text, new RegExp(`${Math.min(CFG.daily.base + CFG.daily.perStreakDay * 3, CFG.daily.max)} жетонов`));
  assert.match(sent[0].text, /Прыг-Скок/);
  assert.deepEqual(Object.keys(sent[0].opts).sort(), ["offText", "playText"]);
  assert.equal(economy.wallet(2).remind, 0, "blocked the bot: no more reminders");
  clock.t += 3_600_000;
  assert.equal(await challenge.remindDue(), 0, "once a day");
  assert.ok(REMIND_BATCH >= 100);
});

const TOKEN = "123456:TEST";
function initData(u, authDate, extra = {}) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(u), ...extra });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

test("HTTP: a Hop-Skip game from 1-1 counts for the challenge, the panel shows it", async () => {
  const { store, economy, challenge, clock } = setup();
  const tracker = { arrive() {}, event() {}, visit() {} };
  const server = createApiServer({ store, botToken: TOKEN, allowedOrigins: ["*"], economy, challenge, tracker, now: () => clock.t });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, extra) => {
    const res = await fetch(base + path, {
      method, body: body && JSON.stringify(body),
      headers: { "Content-Type": "application/json", Authorization: `tma ${initData({ id: 5, first_name: "Ева" }, Math.floor(clock.t / 1000), extra)}` },
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    assert.equal((await fetch(base + "/api/challenge")).status, 401);
    let r = await call("GET", "/api/challenge", null, { chat_instance: "-42" });
    assert.equal(r.status, 200);
    assert.equal(r.json.game, "mario");
    assert.equal(r.json.played, false);
    assert.equal(r.json.reward, R.base);
    assert.deepEqual(r.json.chat, { rows: [], me: null, players: 0 });
    r = await call("POST", "/api/mario/level", { level: 0, score: 3000, timeLeft: 250, deaths: 0, start: true });
    assert.equal(r.status, 200);
    clock.t += 90_000;
    r = await call("POST", "/api/mario/run", { score: 3000, coins: 0, levels: 1, deaths: 0 });
    assert.equal(r.status, 200);
    assert.ok(r.json.wallet.grants.some((g) => g.reason === "challenge" && g.amount === R.base));
    assert.deepEqual(r.json.challenge, { first: true, best: 3000, improved: true });
    r = await call("GET", "/api/challenge", null, { chat_instance: "-42" });
    assert.equal(r.json.played, true);
    assert.deepEqual(r.json.chat.me, { place: 1, value: 3000 });
  } finally {
    server.close();
    store.close();
  }
});
