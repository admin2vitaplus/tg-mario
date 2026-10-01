import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { openDb } from "../db.js";
import { createApiServer } from "../server.js";
import { DAY_MS, dayOf } from "../days.js";
import { collectStats, createTracker, kFactor, parseStart, retention, statsReport } from "../stats.js";

const TOKEN = "123456:TEST";
// Полдень по Москве, чтобы «+ N дней» не перескакивал через полночь.
const T0 = Date.UTC(2026, 8, 1, 9, 0, 0);

function setup(at = T0) {
  const store = openDb(":memory:");
  const clock = { t: at };
  const tracker = createTracker(store, () => clock.t);
  const on = (day, fn) => { clock.t = at + day * DAY_MS; fn(); };
  return { store, clock, tracker, on };
}

test("start labels: src_, ref_, room_ and old tanks_ links", () => {
  assert.deepEqual(parseStart("src_TikTok"), { source: "src_tiktok", ref: null });
  assert.deepEqual(parseStart("ref_42"), { source: "ref", ref: "42" });
  assert.deepEqual(parseStart("room_1234"), { source: "room", ref: "1234" });
  assert.deepEqual(parseStart("tanks_1234"), { source: "room", ref: "1234" });
  for (const p of ["", "play", undefined, "src_", "ref_abc", "src_" + "x".repeat(40), "room_12"]) {
    assert.deepEqual(parseStart(p), { source: "direct", ref: null }, String(p));
  }
});

test("K-factor: new players via invites divided by players who sent an invite", () => {
  const { store, tracker, on } = setup();
  on(0, () => {
    tracker.arrive(1, "src_ads");
    tracker.arrive(2, "");
    tracker.event(1, "invite_created", "tanks", "1111");
    tracker.event(1, "invite_created", "tanks", "1111"); // один и тот же игрок считается один раз
    tracker.event(2, "invite_created");
  });
  on(1, () => {
    assert.equal(tracker.arrive(10, "ref_2").isNew, true);
    tracker.arrive(11, "room_1111");
    tracker.arrive(12, "tanks_1111");
    tracker.arrive(13, "src_ads");
    // Свой же ref — не приглашение; старый игрок по приглашению — не новый.
    tracker.arrive(14, "ref_14");
    assert.equal(tracker.arrive(1, "ref_2").isNew, false);
  });
  const today = dayOf(T0) + 1;
  assert.deepEqual(kFactor(store.db, today - 6, today), { invited: 3, inviters: 2, k: 1.5 });
  assert.equal(store.getSeen(14).source, "direct");
  assert.deepEqual(kFactor(store.db, today + 1, today + 1), { invited: 0, inviters: 0, k: null });
});

test("invite opened and joined: new or returning, once per invite", () => {
  const { store, tracker, on } = setup();
  on(0, () => tracker.arrive(1, ""));
  on(2, () => {
    tracker.arrive(5, "room_4321");
    tracker.arrive(5, "room_4321"); // повторный запуск с тем же start_param
    tracker.arrive(1, "ref_7");
    tracker.event(5, "game_start", "tanks");
    tracker.event(5, "game_start", "tanks");
    tracker.event(1, "game_start", "mario");
  });
  const rows = (type) => store.db.prepare("SELECT user_id, ref, detail, game FROM events WHERE type = ? ORDER BY id").all(type)
    .map((r) => ({ ...r }));
  assert.deepEqual(rows("invite_opened"), [
    { user_id: 5, ref: "4321", detail: "new", game: "" },
    { user_id: 1, ref: "7", detail: "returning", game: "" },
  ]);
  assert.deepEqual(rows("invite_joined"), [
    { user_id: 5, ref: "4321", detail: "new", game: "tanks" },
    { user_id: 1, ref: "7", detail: "returning", game: "mario" },
  ]);
  assert.equal(rows("user_first_seen").length, 2);
});

test("day-1 and day-7 retention count only finished days", () => {
  const { store, tracker, on } = setup();
  // Когорта дня 0: четыре игрока. На следующий день вернулись двое, через неделю — один.
  on(0, () => { for (const id of [1, 2, 3, 4]) tracker.arrive(id, ""); });
  on(1, () => { tracker.event(1, "game_open", "mario"); tracker.event(2, "game_open", "tanks"); });
  on(3, () => tracker.event(3, "game_open", "mario")); // не день 1 и не день 7
  on(7, () => tracker.event(2, "game_start", "tanks"));
  // Когорта дня 7: один игрок, его день 1 — сегодня, ещё не закончился.
  on(7, () => tracker.arrive(9, ""));
  on(8, () => tracker.event(9, "game_open", "mario"));
  const today = dayOf(T0) + 8;
  const d1 = retention(store.db, 1, today - 30, today);
  assert.deepEqual(d1, { cohort: 4, returned: 2, rate: 0.5 });
  const d7 = retention(store.db, 7, today - 30, today);
  assert.deepEqual(d7, { cohort: 4, returned: 1, rate: 0.25 });
  // Игроки, бывшие до статистики, в когорты не входят.
  assert.deepEqual(retention(store.db, 1, today - 30, dayOf(T0) + 1), { cohort: 0, returned: 0, rate: null });
});

test("/stats report shows every metric on test data", () => {
  const { store, clock, tracker, on } = setup();
  store.seen(100, { source: "old" }, T0 - 400 * DAY_MS); // был до статистики (так помечает миграция 3)
  on(0, () => {
    tracker.arrive(1, "src_ads");
    tracker.event(1, "game_open", "tanks");
    tracker.event(1, "game_start", "tanks");
    tracker.event(1, "invite_created", "tanks", "5555");
  });
  on(1, () => {
    tracker.arrive(2, "tanks_5555");
    tracker.event(2, "game_start", "tanks");
    tracker.event(1, "match_finished", "tanks", "5555");
    tracker.event(2, "match_finished", "tanks", "5555"); // тот же матч от второго игрока
    tracker.event(1, "game_open", "mario");
    tracker.event(1, "game_finish", "mario");
  });
  const s = collectStats(store.db, clock.t);
  assert.deepEqual(s.players, { today: 2, yesterday: 1, week: 2, month: 2, total: 3 });
  assert.deepEqual(s.days.slice(-2).map(({ players, newPlayers, matches }) => [players, newPlayers, matches]), [[1, 1, 0], [2, 1, 1]]);
  assert.deepEqual(s.newBySource.week.map((r) => [r.source, r.n]), [["room", 1], ["src_ads", 1]]);
  assert.equal(s.k.week.k, 1);
  // День 1 для пришедших вчера ещё идёт, поэтому удержания пока нет.
  assert.deepEqual(s.retention.d1, { cohort: 0, returned: 0, rate: null });
  assert.deepEqual(collectStats(store.db, clock.t + DAY_MS).retention.d1, { cohort: 1, returned: 1, rate: 1 });
  const tanks = s.games.find((g) => g.game === "tanks");
  assert.deepEqual({ ...tanks }, { game: "tanks", players: 2, opens: 1, starts: 2, finishes: 0, matches: 1, invites: 1, joined: 1 });

  const text = statsReport(store.db, clock.t);
  for (const part of ["Игроки: сегодня 2, вчера 1, за 7 дней 2, за 30 дней 2, всего 3",
    "в комнату 1", "src_ads 1", "K-фактор за 7 дней: 1.00 (1 новых ÷ 1 пригласивших)",
    "день 1 — —, день 7 — —", "Танкодром: игроков 2", "Прыг-Скок: игроков 1"]) {
    assert.ok(text.includes(part), `нет «${part}» в:\n${text}`);
  }
  assert.ok(statsReport(store.db, clock.t + DAY_MS).includes("день 1 — 100% (1 из 1)"));
});

test("raw events older than 90 days are aggregated and deleted", () => {
  const { store, clock, tracker, on } = setup();
  on(0, () => { tracker.arrive(1, ""); tracker.event(1, "game_open", "mario"); tracker.event(1, "game_open", "mario"); });
  on(0, () => tracker.event(2, "game_open", "mario"));
  on(95, () => tracker.event(1, "game_open", "mario"));
  assert.equal(store.pruneEvents(clock.t), 4);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM events").get().n, 1);
  const day = dayOf(T0);
  assert.deepEqual(store.db.prepare("SELECT type, game, events, users FROM stats_daily WHERE day = ? ORDER BY type").all(day)
    .map((r) => ({ ...r })), [
    { type: "game_open", game: "mario", events: 3, users: 2 },
    { type: "user_first_seen", game: "", events: 1, users: 1 },
  ]);
  // Кто когда пришёл, хранится дальше: вернувшийся игрок не станет «новым».
  assert.equal(tracker.arrive(1, "ref_5").isNew, false);
  assert.equal(store.pruneEvents(clock.t), 0);
});

// ---------- HTTP: /api/events ----------

function initData(user, authDate, startParam) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user) });
  if (startParam) params.set("start_param", startParam);
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

test("game events arrive over HTTP with the startapp label", async () => {
  const store = openDb(":memory:");
  const tracker = createTracker(store);
  const server = createApiServer({ store, botToken: TOKEN, allowedOrigins: ["*"], tracker });
  await new Promise((ok) => server.listen(0, ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, user, startParam) => fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json",
      ...(user ? { Authorization: `tma ${initData(user, Math.floor(Date.now() / 1000), startParam)}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.status);
  try {
    const ann = { id: 77, first_name: "Аня" };
    assert.equal(await post("/api/events", { type: "game_open", game: "tanks" }), 401);
    assert.equal(await post("/api/events", { type: "user_first_seen", game: "tanks" }, ann), 400);
    assert.equal(await post("/api/events", { type: "game_open", game: "chess" }, ann), 400);
    assert.equal(await post("/api/events", { type: "match_finished", game: "tanks", ref: "x".repeat(40) }, ann), 400);
    assert.equal(await post("/api/events", { type: "game_open", game: "tanks" }, ann, "room_2468"), 204);
    assert.equal(await post("/api/events", { type: "game_start", game: "tanks" }, ann, "room_2468"), 204);
    assert.equal(await post("/api/mario/run", { score: 0, coins: 0, levels: 0, deaths: 3 }, ann), 200);
    const types = store.db.prepare("SELECT type, game, source, ref FROM events ORDER BY id").all().map((r) => ({ ...r }));
    assert.deepEqual(types, [
      { type: "user_first_seen", game: "", source: "room", ref: "2468" },
      { type: "invite_opened", game: "", source: "room", ref: "2468" },
      { type: "game_open", game: "tanks", source: null, ref: null },
      { type: "game_start", game: "tanks", source: null, ref: null },
      { type: "invite_joined", game: "tanks", source: "room", ref: "2468" },
      { type: "game_finish", game: "mario", source: null, ref: null },
    ]);
    // Имя игрока в статистику не попадает.
    assert.ok(!JSON.stringify(store.db.prepare("SELECT * FROM events").all()).includes("Аня"));
  } finally {
    server.close();
    store.close();
  }
});
