import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";
import { ACHIEVEMENTS_TOTAL, BY_GAME, publicList } from "../achievements.js";
import {
  createEconomy, DAY_MS, economyReport, exportSeason, loadEconomy, maxWeeklyEmission,
  seasonOf, seasonStart, validateEconomy,
} from "../economy.js";

// Жетоны (ТЗ P1-7): идемпотентность, потолки, смена сезона с перезапуском посередине, экспорт.

const CFG = loadEconomy();
// Вторник 29.09.2026 12:00 UTC — середина сезона.
const T0 = Date.UTC(2026, 8, 29, 12);
const S0 = seasonOf(T0);

const tmp = () => mkdtempSync(join(tmpdir(), "econ-test-"));
const user = (id, name = `Игрок ${id}`) => ({ id, first_name: name });

function setup({ file = ":memory:", cfg = CFG, clock = { t: T0 }, notify = null, hooks } = {}) {
  const store = openDb(file);
  const economy = createEconomy(store, cfg, { now: () => clock.t, notify, hooks });
  return { store, economy, clock };
}

// Принятый сервером итог игры, как его записывает маршрут /api/mario/run.
function run(store, economy, clock, id, score) {
  store.touchPlayer(user(id));
  const before = store.getPlayer(id).best_score;
  store.addRun(id, { score, coins: 0, levels: 1, deaths: 0, completed: false, bossFire: false }, clock.t);
  return economy.run(id, { newRecord: score > before });
}

const ledgerRows = (store, id) => store.db.prepare("SELECT * FROM ledger WHERE player_id = ? ORDER BY id").all(id);

test("economy.json is valid and the weekly emission has a fixed ceiling", () => {
  assert.equal(CFG.season.pool, Object.values(CFG.season.boards).flat().reduce((a, n) => a + n, 0));
  assert.equal(maxWeeklyEmission(CFG, 100), 7 * CFG.dailyCap * 100 + CFG.season.pool);
  assert.throws(() => validateEconomy({ ...CFG, dailyCap: 1.5 }), /dailyCap/);
  assert.throws(() => validateEconomy({ ...CFG, season: { ...CFG.season, pool: 1 } }), /season.pool/);
  assert.throws(() => validateEconomy({ ...CFG, shop: [CFG.shop[0], CFG.shop[0]] }), /повтор/);
});

test("one event pays once: repeats and restarts add nothing, balance equals the ledger", () => {
  const dir = tmp();
  const file = join(dir, "s.db");
  try {
    let { store, economy, clock } = setup({ file });
    store.touchPlayer(user(1));
    assert.equal(economy.achievements(1, [{ code: "first_level" }]).length, 1);
    assert.equal(economy.achievements(1, [{ code: "first_level" }]).length, 0);
    run(store, economy, clock, 1, 1000);
    run(store, economy, clock, 1, 2000); // тот же день: ни бонуса, ни второго рекорда
    store.close();

    ({ store, economy } = setup({ file, clock }));
    economy.achievements(1, [{ code: "first_level" }]);
    run(store, economy, clock, 1, 3000);
    const rows = ledgerRows(store, 1);
    assert.deepEqual(rows.map((r) => r.reason).sort(), ["achievement", "record", "task"]);
    assert.deepEqual(economy.checkBalance(1), { cached: 20 + 10 + 10, ledger: 40 });
    assert.ok(rows.every((r) => Number.isInteger(r.amount)));
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the ledger is append-only", () => {
  const { store, economy } = setup();
  economy.post(1, 5, "achievement", "x");
  assert.throws(() => store.db.exec("UPDATE ledger SET amount = 1000"), /append-only/);
  assert.throws(() => store.db.exec("DELETE FROM ledger"), /append-only/);
  assert.equal(economy.checkBalance(1).ledger, 5);
  store.close();
});

test("daily cap per player, with the next day open again", () => {
  const { store, economy, clock } = setup();
  economy.post(1, CFG.dailyCap - 5, "daily", "fill");
  run(store, economy, clock, 1, 500);
  assert.equal(economy.me(1).today, CFG.dailyCap);
  assert.equal(economy.me(1).balance, CFG.dailyCap, "tasks and record are capped");
  clock.t += DAY_MS;
  run(store, economy, clock, 1, 600);
  assert.equal(economy.me(1).balance, CFG.dailyCap + CFG.tasks.play + CFG.record);
  store.close();
});

test("achievements are one-off: the daily cap neither cuts them nor is used up by them", () => {
  const { store, economy, clock } = setup();
  const codes = Array.from({ length: 12 }, (_, i) => ({ code: `a${i}` }));
  const got = economy.achievements(1, codes, [], "tanks").reduce((a, g) => a + g.amount, 0);
  assert.equal(got, 12 * CFG.achievement);
  assert.equal(economy.me(1).today, 0);
  run(store, economy, clock, 1, 500);
  assert.equal(economy.me(1).balance, got + CFG.tasks.play + CFG.record, "the game's tasks still count that day");
  assert.ok(economy.achievementsDone(1).has("a0"));
  economy.flag(1);
  assert.equal(economy.achievements(1, [{ code: "z" }]).length, 0, "a flagged player gets none");
  assert.equal(maxWeeklyEmission(CFG, 10, ACHIEVEMENTS_TOTAL), 7 * CFG.dailyCap * 10 + CFG.season.pool + ACHIEVEMENTS_TOTAL * CFG.achievement * 10);
  store.close();
});

test("daily login grows with the streak up to its maximum and resets after a gap", () => {
  const { store, economy, clock } = setup();
  const bonus = () => ledgerRows(store, 1).filter((r) => r.reason === "daily").at(-1).amount;
  const seen = [];
  for (let d = 0; d < 9; d++) {
    // Задание показывает, сколько даст вход сегодня, и закрывается после него.
    const before = economy.me(1).tasks.main.find((t) => t.id === "login");
    assert.equal(before.done, false);
    economy.checkin(1);
    assert.equal(economy.checkin(1).length, 0, "once a day");
    seen.push(bonus());
    const after = economy.me(1).tasks.main.find((t) => t.id === "login");
    assert.deepEqual([after.done, after.amount, before.amount], [true, bonus(), bonus()]);
    clock.t += DAY_MS;
  }
  const { base, perStreakDay, max } = CFG.daily;
  assert.deepEqual(seen, seen.map((_, i) => Math.min(base + perStreakDay * i, max)));
  clock.t += DAY_MS; // пропущен день
  economy.checkin(1);
  assert.equal(bonus(), base);
  store.close();
});

test("game tasks: play, clear a level and a record close once a day per game and open again at 00:00 UTC", () => {
  const { store, economy, clock } = setup();
  clock.t = Math.floor(clock.t / DAY_MS) * DAY_MS + DAY_MS - 60_000; // 23:59 UTC
  const done = (game) => economy.me(1).tasks[game].filter((t) => t.done).map((t) => t.id);
  economy.run(1, { newRecord: true, game: "tanks", levels: 2 });
  assert.deepEqual(done("tanks"), ["play", "level", "record"]);
  assert.deepEqual(done("mario"), []);
  assert.equal(economy.run(1, { newRecord: true, game: "tanks", levels: 2 }).length, 0);
  economy.run(1, { newRecord: false, game: "mario", levels: 0 });
  assert.deepEqual(done("mario"), ["play"]);
  clock.t += 120_000; // новый день по UTC
  assert.deepEqual(done("tanks"), []);
  assert.equal(economy.me(1).dayEndsAt, (Math.floor(clock.t / DAY_MS) + 1) * DAY_MS);
  store.close();
});

test("tables are kept in memory until a result that can change them, or a minute", () => {
  const { store, economy, clock } = setup();
  run(store, economy, clock, 1, 5000);
  assert.deepEqual(economy.top("mario", "all", 1).rows.map((r) => r.value), [5000]);
  // Written past the economy (not a real path): the kept table does not see it...
  store.touchPlayer(user(2));
  store.addRun(2, { score: 7000, coins: 0, levels: 1, deaths: 0, completed: false, bossFire: false }, clock.t);
  assert.deepEqual(economy.top("mario", "all", 1).rows.map((r) => r.value), [5000]);
  // ...another game's result does not drop it either...
  economy.run(3, { newRecord: false, game: "tanks" });
  assert.deepEqual(economy.top("mario", "all", 1).rows.map((r) => r.value), [5000]);
  // ...a result of this game does, and the player's place moves with it.
  run(store, economy, clock, 1, 6000);
  const t = economy.top("mario", "all", 1);
  assert.deepEqual(t.rows.map((r) => r.value), [7000, 6000]);
  assert.deepEqual(t.me, { place: 2, value: 6000 });
  // The overall table follows every new ledger entry.
  const before = economy.top("overall", "week", 1).me.value;
  economy.achievements(1, [{ code: "z" }]);
  assert.equal(economy.top("overall", "week", 1).me.value, before + CFG.achievement);
  // Names and the like catch up within a minute.
  store.addRun(2, { score: 9000, coins: 0, levels: 1, deaths: 0, completed: false, bossFire: false }, clock.t);
  clock.t += 61_000;
  assert.equal(economy.top("mario", "all", 1).rows[0].value, 9000);
  store.close();
});

test("tables: top-100 of the week and of all time, with the player's own place", () => {
  const { store, economy, clock } = setup();
  run(store, economy, clock, 1, 5000);
  run(store, economy, clock, 2, 9000);
  economy.achievements(3, [{ code: "x" }, { code: "y" }]);
  const mario = economy.top("mario", "week", 1);
  assert.deepEqual(mario.rows.map((r) => [r.place, r.value, r.me]), [[1, 9000, false], [2, 5000, true]]);
  assert.deepEqual(mario.me, { place: 2, value: 5000 });
  const overall = economy.top("overall", "week", 3);
  assert.equal(overall.rows[0].value, 2 * CFG.achievement);
  assert.deepEqual(overall.me, { place: 1, value: 2 * CFG.achievement });
  clock.t += 8 * DAY_MS;
  assert.deepEqual(economy.top("mario", "week", 1).rows, []);
  assert.equal(economy.top("mario", "all", 1).rows.length, 2);
  economy.flag(2, "test");
  assert.deepEqual(economy.top("mario", "all").rows.map((r) => r.value), [5000]);
  store.close();
});

test("invite pays both only after the newcomer's own games, once, within the weekly limit", () => {
  const cfg = { ...CFG, invite: { ...CFG.invite, perWeek: 1 } };
  const { store, economy, clock } = setup({ cfg });
  const invite = (id) => store.db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE player_id = ? AND reason = 'invite'").get(id).n;
  run(store, economy, clock, 10, 100); // пригласивший — настоящий игрок
  store.seen(11, { source: "ref", inviter: 10 }, clock.t);
  store.seen(12, { source: "ref", inviter: 10 }, clock.t);
  store.seen(13, { source: "ref", inviter: 999 }, clock.t); // такого игрока нет
  for (let i = 1; i < cfg.invite.gamesNeeded; i++) run(store, economy, clock, 11, 100);
  assert.equal(invite(10), 0);
  assert.equal(invite(11), 0);
  run(store, economy, clock, 11, 100);
  run(store, economy, clock, 11, 100);
  assert.equal(invite(10), cfg.invite.inviter);
  assert.equal(invite(11), cfg.invite.newcomer);
  for (let i = 0; i < cfg.invite.gamesNeeded; i++) run(store, economy, clock, 12, 100);
  assert.equal(invite(10), cfg.invite.inviter, "inviter limit per week");
  assert.equal(invite(12), cfg.invite.newcomer);
  for (let i = 0; i < cfg.invite.gamesNeeded; i++) run(store, economy, clock, 13, 100);
  assert.equal(invite(13), 0);
  store.close();
});

test("flagged players get nothing; annul is a separate negative entry", () => {
  const { store, economy, clock } = setup();
  run(store, economy, clock, 1, 100);
  economy.achievements(1, [{ code: "a" }]);
  const before = economy.me(1).balance;
  economy.flag(1, "test");
  economy.achievements(1, [{ code: "b" }]);
  assert.equal(economy.me(1).balance, before);
  assert.equal(economy.annul(1, S0), -before);
  assert.equal(economy.annul(1, S0), 0, "nothing left to annul");
  assert.equal(economy.me(1).balance, 0);
  assert.equal(ledgerRows(store, 1).filter((r) => r.reason === "annul").length, 1);
  economy.unflag(1);
  economy.achievements(1, [{ code: "c" }]);
  assert.equal(economy.annul(1, S0), -CFG.achievement, "a second annul takes only what came after");
  assert.deepEqual(economy.checkBalance(1), { cached: 0, ledger: 0 });
  store.close();
});

test("shop: not enough, buy, no double charge, unknown item", () => {
  const { store, economy } = setup();
  const item = CFG.shop[0];
  assert.equal(economy.buy(1, item.id).error, "not enough");
  economy.post(1, item.price + 5, "prize", "gift");
  assert.deepEqual(economy.buy(1, item.id), { ok: true, balance: 5 });
  assert.equal(economy.buy(1, item.id).already, true);
  assert.equal(economy.me(1).balance, 5);
  assert.deepEqual(economy.me(1).owned, [item.id]);
  assert.equal(economy.buy(1, "nope").error, "unknown item");
  store.close();
});

test("one more life: price by level in the world, once per offer, not an owned item", () => {
  const { store, economy } = setup();
  assert.deepEqual(CFG.life.price, [100, 300, 500, 700]);
  assert.deepEqual(CFG.life.stars, [10, 30, 50, 70]);
  assert.equal(economy.buyLife(1, "abcd1234", 0).error, "not enough");
  economy.post(1, 1000, "prize", "gift");
  assert.deepEqual(economy.buyLife(1, "abcd1234", 2), { ok: true, balance: 500 });
  assert.equal(economy.buyLife(1, "abcd1234", 2).already, true, "a repeat with the same offer");
  assert.equal(economy.me(1).balance, 500);
  assert.deepEqual(economy.buyLife(1, "efgh5678", 1), { ok: true, balance: 200 });
  assert.equal(economy.buyLife(1, "ijkl9012", 1).error, "not enough");
  for (const [offer, level] of [["short", 0], ["ABCD1234", 0], ["abcd1234", 4], ["abcd1234", -1], ["abcd1234", "1"], [5, 0]]) {
    assert.equal(economy.buyLife(1, offer, level).error, "bad offer", `${offer} ${level}`);
  }
  assert.deepEqual(economy.me(1).owned, []);
  assert.equal(economy.checkBalance(1).ledger, 200);

  assert.equal(economy.lifeCheck(2, "mnop3456", 3, 70).item.payload, "life:3:mnop3456");
  assert.equal(economy.lifeCheck(2, "mnop3456", 3, 50).error, "price changed");
  assert.equal(economy.starsPaid(2, "life:mnop3456", 70, "ch_life"), true);
  assert.equal(economy.lifeCheck(2, "mnop3456", 3, 70).error, "already");
  assert.equal(economy.lifeCheck(1, "abcd1234", 2).error, "already", "paid with жетоны already");
  assert.deepEqual(economy.me(2).owned, []);
  assert.throws(() => validateEconomy({ ...CFG, life: { ...CFG.life, stars: [10, 30] } }), /life/);
  store.close();
});

// Неделя: двое в «Прыг-Скоке», третий только с достижениями, четвёртый помечен.
function playWeek(store, economy, clock) {
  run(store, economy, clock, 1, 5000);
  run(store, economy, clock, 2, 9000);
  economy.achievements(3, [{ code: "x" }, { code: "y" }]);
  run(store, economy, clock, 4, 99000);
  economy.flag(4, "test");
}

test("season change: snapshot, prizes and messages survive a restart in the middle", async () => {
  const dir = tmp();
  const file = join(dir, "s.db");
  const sent = [];
  const notify = async (id, text) => { sent.push([id, text]); };
  try {
    let { store, economy, clock } = setup({ file, notify });
    await economy.closeDue(); // первый запуск запоминает начало учёта
    playWeek(store, economy, clock);
    clock.t = seasonStart(S0 + 1) + 60_000;
    run(store, economy, clock, 1, 100); // уже новая неделя: в сезон S0 не входит
    store.close();

    // Перезапуск сразу после снимка, до призов.
    ({ store, economy } = setup({ file, clock, notify, hooks: { after: (step) => { if (step === "snapshot") throw new Error("crash"); } } }));
    await assert.rejects(economy.closeDue(), /crash/);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM ledger WHERE reason = 'prize'").get().n, 0);
    store.close();

    // Перезапуск после призов, до сообщений; и одно сообщение «упало» на полпути.
    ({ store, economy } = setup({ file, clock, notify, hooks: { after: (step) => { if (step === "paid") throw new Error("crash"); } } }));
    await assert.rejects(economy.closeDue(), /crash/);
    store.close();

    ({ store, economy } = setup({ file, clock, notify }));
    assert.deepEqual(await economy.closeDue(), [S0]);
    assert.deepEqual(await economy.closeDue(), []);
    await economy.closeSeason(S0);

    const places = economy.places(S0);
    const mario = places.filter((p) => p.board === "mario").map((p) => [p.player_id, p.prize]);
    assert.deepEqual(mario, [[2, CFG.season.boards.mario[0]], [1, CFG.season.boards.mario[1]]]);
    assert.ok(!places.some((p) => p.player_id === 4), "flagged player has no place");
    const prizes = store.db.prepare("SELECT player_id, SUM(amount) AS n, COUNT(*) AS c FROM ledger WHERE reason = 'prize' GROUP BY player_id").all();
    assert.equal(prizes.reduce((a, r) => a + r.c, 0), places.length, "each prize paid once");
    assert.ok(prizes.reduce((a, r) => a + r.n, 0) <= CFG.season.pool);
    for (const r of prizes) {
      assert.equal(store.db.prepare("SELECT season FROM ledger WHERE player_id = ? AND reason = 'prize' LIMIT 1").get(r.player_id).season, S0);
    }
    const snap = store.db.prepare("SELECT * FROM season_balances WHERE season = ? AND player_id = 1").get(S0);
    assert.equal(snap.balance, snap.gained, "the new week's game is not in the snapshot");
    assert.deepEqual(sent.map(([id]) => id).sort(), [1, 2, 3], "one message each, none to the flagged one");
    assert.match(sent.find(([id]) => id === 2)[1], /1 место/);
    for (const id of [1, 2, 3, 4]) {
      const c = economy.checkBalance(id);
      assert.equal(c.cached, c.ledger);
    }
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a player who turned results off gets no message; seasons with no one still close", async () => {
  const sent = [];
  const { store, economy, clock } = setup({ notify: async (id) => sent.push(id) });
  await economy.closeDue();
  playWeek(store, economy, clock);
  economy.setNotify(2, false);
  clock.t = seasonStart(S0 + 3) + 1;
  assert.deepEqual(await economy.closeDue(), [S0, S0 + 1, S0 + 2]);
  assert.deepEqual(sent.sort(), [1, 3]);
  store.close();
});

test("season export: file total equals ledger total, prizes included", async () => {
  const dir = tmp();
  try {
    const { store, economy, clock } = setup({ file: join(dir, "s.db") });
    await economy.closeDue();
    playWeek(store, economy, clock);
    economy.post(1, 999, "prize", "gift");
    economy.buy(1, CFG.shop[0].id);
    economy.annul(3, S0);
    clock.t = seasonStart(S0 + 1) + 1;
    await economy.closeDue();
    run(store, economy, clock, 1, 100); // следующий сезон

    const r = exportSeason(store.db, S0);
    assert.equal(r.state, "done");
    assert.equal(r.total, r.ledgerTotal);
    const lines = r.csv.trim().split("\n");
    assert.equal(lines[0], "player_id,amount,balance");
    const fileTotal = lines.slice(1).reduce((a, l) => a + Number(l.split(",")[1]), 0);
    assert.equal(fileTotal, store.db.prepare("SELECT SUM(amount) AS n FROM ledger WHERE season = ?").get(S0).n);
    const p2 = lines.find((l) => l.startsWith("2,")).split(",").map(Number);
    assert.equal(p2[1], p2[2]);
    assert.ok(p2[1] > CFG.season.boards.mario[0], "prize is in the season's amount");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("/stats part: emission, top receivers and shares by reason", () => {
  const { store, economy, clock } = setup();
  playWeek(store, economy, clock);
  const text = economyReport(store.db, CFG, clock.t);
  assert.match(text, /Выдано: \d+ у 4 игроков/);
  assert.match(text, /задания в играх \d+%/);
  assert.match(text, /Топ получателей: .*\(\d+\) \d+/);
  assert.match(text, /Помечены как подозрительные: 1/);
  assert.match(text, new RegExp(`фонд ${CFG.season.pool}`));
  store.close();
});

// ---------- Через HTTP ----------

const TOKEN = "123456:TEST";
function initData(u, authDate) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(u) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

test("HTTP: only verified results pay; the client can look and buy, not credit", async () => {
  const clock = { t: Date.now() };
  const { store, economy } = setup({ clock });
  const server = createApiServer({ store, botToken: TOKEN, allowedOrigins: ["*"], economy, now: () => clock.t });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, u = { id: 5, first_name: "Ева", language_code: "en" }) => {
    const res = await fetch(base + path, {
      method, body: body && JSON.stringify(body),
      headers: { "Content-Type": "application/json", Authorization: `tma ${initData(u, Math.floor(clock.t / 1000))}` },
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    let r = await call("POST", "/api/mario/level", { level: 0, score: 3000, timeLeft: 250, deaths: 0 });
    assert.equal(r.status, 200);
    assert.equal(r.json.wallet.grants.filter((g) => g.reason === "achievement").length, 4);
    assert.equal(r.json.wallet.grants.filter((g) => g.reason === "task").length, 1, "a level cleared today");
    clock.t += 90_000;
    r = await call("POST", "/api/mario/run", { score: 3000, coins: 0, levels: 1, deaths: 0 });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.wallet.grants.map((g) => g.reason).sort(), ["record", "task"]);
    assert.equal(r.json.wallet.balance, 4 * CFG.achievement + CFG.tasks.level + CFG.tasks.play + CFG.record);
    // Вход за день: один раз.
    r = await call("POST", "/api/wallet/checkin");
    assert.deepEqual(r.json.grants, [{ reason: "daily", amount: CFG.daily.base }]);
    // The whole panel comes with it, the visit already crossed off: no second request for /me.
    assert.equal(r.json.me.balance, r.json.balance);
    assert.equal(r.json.me.tasks.main.find((t) => t.id === "login").done, true);
    assert.ok(r.json.me.tasks.mario.some((t) => t.period === "once"), "Hop-Skip achievements included");
    assert.deepEqual((await call("POST", "/api/wallet/checkin")).json.grants, []);

    // Невозможный итог: ничего не начисляется, после нескольких — пометка.
    for (let i = 0; i < CFG.suspicious.rejectedPerDay; i++) {
      r = await call("POST", "/api/mario/run", { score: 400000, coins: 0, levels: 0, deaths: 0 });
      assert.equal(r.status, 422);
    }
    assert.ok(economy.wallet(5).flagged);

    assert.equal((await call("POST", "/api/wallet/credit", { amount: 100 })).status, 404);
    r = await call("GET", "/api/wallet/me");
    assert.equal(r.status, 200);
    assert.equal(r.json.balance, 4 * CFG.achievement + CFG.tasks.level + CFG.tasks.play + CFG.record + CFG.daily.base);
    // Задания: вход и задания игры закрыты, достижения «Прыг-Скока» — разовые задания.
    assert.deepEqual(r.json.tasks.main.map((t) => [t.id, t.done]), [["login", true], ["all", false], ["invite", false]]);
    assert.deepEqual(r.json.tasks.mario.filter((t) => t.period === "day").map((t) => [t.id, t.done]),
      [["play", true], ["level", true], ["record", true]]);
    assert.equal(r.json.tasks.mario.filter((t) => t.period === "once" && t.done).length, 4);
    r = await call("GET", "/api/wallet/top?board=mario&period=all");
    assert.equal(r.status, 200);
    assert.equal(r.json.me, null, "a flagged player is not in the tables");
    assert.equal((await call("GET", "/api/wallet/top?board=nope")).status, 400);
    assert.equal(economy.wallet(5).lang, "en");
    assert.equal((await call("POST", "/api/wallet/buy", { item: CFG.shop[0].id })).status, 409);
    assert.equal((await call("POST", "/api/wallet/buy", { item: "nope" })).status, 404);
    economy.post(5, 1000, "prize", "test");
    r = await call("POST", "/api/wallet/buy", { item: CFG.shop[0].id });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.owned, [CFG.shop[0].id]);
    r = await call("GET", "/api/wallet/info");
    assert.equal(r.json.shop.length, CFG.shop.length);
    assert.equal(r.json.dailyCap, CFG.dailyCap);
  } finally {
    server.close();
    store.close();
  }
});

test("interface texts avoid the words the spec forbids", () => {
  const banned = /крипт|монет[аыу]? |токен|заработ|вывод|обмен на деньги|\bcrypto|\bcoin|\btoken|\bearn|withdraw/i;
  const texts = [
    JSON.stringify(CFG.shop),
    readFileSync(new URL("../wallet-bot.js", import.meta.url), "utf8").match(/"[^"]*"|`[^`]*`/g).join("\n"),
    economyReport(openDb(":memory:").db, CFG),
    // Hop-Skip's achievements are tasks in its «◆» panel.
    Object.keys(BY_GAME).flatMap((g) => publicList(g)).map((a) => [a.title, a.text, a.titleEn, a.textEn].join("\n")).join("\n"),
    // The page's own words (its dictionary).
    readFileSync(new URL("../../web/lib/wallet.js", import.meta.url), "utf8").split("const STR = {")[1].split("\n};")[0],
  ];
  for (const t of texts) assert.doesNotMatch(t, banned);
});

test("migration 6 lifts the automatic flags caused by the unknown worlds 2-4, and only those", () => {
  const dir = mkdtempSync(join(tmpdir(), "flags-"));
  const file = join(dir, "db.sqlite");
  try {
    let store = openDb(file);
    const { db } = store;
    const add = (id, flagged, at) => db.prepare(
      "INSERT INTO wallets (player_id, balance, flagged, flagged_at, strikes, strike_day) VALUES (?, 0, ?, ?, 3, 1)",
    ).run(id, flagged, at);
    add(1, "auto: отклонённые отчёты", Date.UTC(2026, 9, 2, 21));
    add(2, "auto: отклонённые отчёты", Date.UTC(2026, 8, 30));
    add(3, "admin", Date.UTC(2026, 9, 2, 21));
    db.exec("PRAGMA user_version = 5");
    store.close();
    store = openDb(file);
    const flags = store.db.prepare("SELECT player_id, flagged FROM wallets ORDER BY player_id").all()
      .map((r) => [r.player_id, r.flagged]);
    assert.deepEqual(flags, [[1, null], [2, "auto: отклонённые отчёты"], [3, "admin"]]);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
