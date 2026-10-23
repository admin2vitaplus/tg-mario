import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../db.js";
import { DAY_MS, dayOf } from "../days.js";
import { createEconomy, dayUtc, loadEconomy } from "../economy.js";
import { collectAnalytics, RETENTION_DAYS } from "../analytics.js";
import { gameOfDay } from "../challenge.js";

// Аналитика панели (analytics.js): активность, удержание, воронка, игры, уровни, покупки, серии.

const CFG = loadEconomy();
const NOW = Date.UTC(2026, 9, 23, 12); // 15:00 по Москве
const TODAY = dayOf(NOW);
const at = (day, h = 12) => day * DAY_MS - 3 * 3_600_000 + h * 3_600_000; // время дня по Москве

function world() {
  const store = openDb(":memory:");
  const { db } = store;
  // Игроки 1–4 пришли 10 дней назад, 5 — сегодня; 9 — старый (до статистики).
  for (const id of [1, 2, 3, 4]) store.seen(id, { source: id === 4 ? "ref" : "direct", inviter: id === 4 ? 1 : null }, at(TODAY - 10));
  store.seen(5, { source: "src_ads" }, at(TODAY));
  db.prepare("INSERT INTO users_seen (user_id, at, day, source) VALUES (9, 0, 0, 'old')").run();
  for (const id of [1, 2, 3, 4, 5]) store.touchPlayer({ id, first_name: `Игрок ${id}` });
  const ev = (id, type, game, day) => store.addEvent({ userId: id, type, game }, at(day));
  for (const id of [1, 2, 3, 4]) { ev(id, "game_open", "tanks", TODAY - 10); ev(id, "game_start", "tanks", TODAY - 10); }
  ev(1, "game_finish", "tanks", TODAY - 10);
  ev(2, "game_finish", "tanks", TODAY - 10);
  ev(1, "app_open", "", TODAY - 9); // вернулся на день 1
  ev(2, "app_open", "", TODAY - 9);
  ev(1, "game_open", "mario", TODAY - 3); // день 7
  ev(1, "game_open", "mario", TODAY - 2);
  ev(5, "game_open", "range", TODAY);
  ev(9, "app_open", "", TODAY);
  // Принятые игры и уровни.
  const run = db.prepare(`INSERT INTO tanks_runs (player_id, seed, score, stages, frames, players, start, created_at)
    VALUES (?, ?, ?, ?, 600, 1, ?, ?)`);
  run.run(1, 1, 100, 3, 0, at(TODAY - 10));
  run.run(1, 2, 100, 1, 3, at(TODAY - 9)); // с 4-го этапа: дошёл до 4
  run.run(2, 3, 100, 0, 0, at(TODAY - 10));
  db.prepare(`INSERT INTO level_results (player_id, level, score, time_left, deaths, created_at) VALUES (?, ?, 0, 0, 0, ?)`)
    .run(1, 0, at(TODAY - 3));
  db.prepare(`INSERT INTO level_results (player_id, level, score, time_left, deaths, created_at) VALUES (?, ?, 0, 0, 0, ?)`)
    .run(1, 1, at(TODAY - 3));
  // Покупки: за жетоны у 1-го и за звёзды у 2-го.
  const economy = createEconomy(store, CFG, { now: () => NOW });
  economy.post(1, 100_000, "admin", "seed");
  economy.buy(1, CFG.shop.find((it) => !it.legacy).id);
  economy.starsPaid(2, CFG.shop[0].id, CFG.shop[0].stars, "ch-1");
  // Серии входов.
  db.prepare("UPDATE wallets SET streak = 5, streak_day = ? WHERE player_id = 1").run(dayUtc(NOW));
  db.prepare("INSERT INTO wallets (player_id, streak, streak_day) VALUES (3, 20, ?)").run(dayUtc(NOW) - 1);
  db.prepare("INSERT INTO wallets (player_id, streak, streak_day) VALUES (4, 3, ?)").run(dayUtc(NOW) - 5); // прервалась
  // Напоминание вчера, после которого игрок 3 зашёл.
  db.prepare("INSERT INTO reminders (day, player_id, at) VALUES (?, 3, ?)").run(dayUtc(NOW) - 1, NOW - DAY_MS);
  db.prepare("INSERT INTO ledger (player_id, amount, reason, event, season, day, at) VALUES (3, 10, 'daily', ?, 0, ?, ?)")
    .run(`day:${dayUtc(NOW) - 1}`, dayUtc(NOW) - 1, NOW - DAY_MS + 60_000);
  db.prepare("INSERT INTO challenge_results (day, player_id, game, score, at) VALUES (?, 1, 'mario', 10, ?)").run(dayUtc(NOW), NOW);
  return store;
}

test("analytics: activity, retention, funnel, games, levels, purchases, streaks", () => {
  const store = world();
  const a = collectAnalytics(store.db, CFG, NOW);
  const { activity } = a;
  assert.equal(activity.days.length, 30);
  const today = activity.days.at(-1);
  assert.deepEqual([today.dau, today.newPlayers, today.returning], [2, 1, 1]);
  assert.equal(activity.days.find((d) => d.day === TODAY - 10).dau, 4);
  assert.equal(activity.mau, 6);
  assert.equal(activity.wau, 3);

  // Удержание: из 4 пришедших 10 дней назад на день 1 вернулись двое, на день 7 — один.
  assert.deepEqual(a.retention.overall.d1, { cohort: 4, returned: 2, rate: 0.5 });
  assert.deepEqual(a.retention.overall.d7, { cohort: 4, returned: 1, rate: 0.25 });
  assert.equal(a.retention.overall.d14.cohort, 0, "day 14 has not come for anyone yet");
  const week2 = a.retention.cohorts[1];
  assert.equal(week2.players, 4);
  assert.equal(week2.d1.rate, 0.5);
  assert.equal(week2.d30, null);
  assert.deepEqual(Object.keys(a.retention.overall), RETENTION_DAYS.map((n) => `d${n}`));
  assert.deepEqual(a.retention.bySource.map((s) => s.source).sort(), ["direct", "ref", "src_ads"]);
  assert.equal(a.retention.bySource.find((s) => s.source === "src_ads").d1, null, "too early to say");

  const f = Object.fromEntries(a.funnel.map((s) => [s.step, s.n]));
  assert.deepEqual(f, { arrived: 5, opened: 5, started: 4, finished: 2, returned: 2, days3: 1, bought: 1, paid: 1 });

  const tanks = a.games.month.find((g) => g.game === "tanks");
  assert.deepEqual([tanks.players, tanks.opens, tanks.starts, tanks.games, tanks.gamers], [4, 4, 4, 3, 2]);
  assert.equal(a.games.week.find((g) => g.game === "mario").opens, 2);

  assert.equal(a.levels.mario.levels.length, 32);
  assert.deepEqual(a.levels.mario.levels.slice(0, 3).map((l) => [l.label, l.passed]), [["1-1", 1], ["1-2", 1], ["1-3", 0]]);
  assert.equal(a.levels.tanks.players, 2);
  assert.deepEqual(a.levels.tanks.levels.map((l) => l.passed), [1, 1, 1, 1]);
  assert.deepEqual(a.levels.tanks.ends.map((e) => [e.stage, e.n]), [[1, 1], [4, 1]]);

  assert.equal(a.purchases.tokensTotal.buyers, 1);
  assert.equal(a.purchases.starsTotal.sum, CFG.shop[0].stars);
  assert.equal(a.purchases.payersAll, 1);
  assert.equal(a.purchases.payingShare, 1 / 6);

  assert.deepEqual(a.streaks.map((s) => s.n), [0, 0, 1, 0, 1]);
  const yesterday = a.challenge.days[1];
  assert.deepEqual([yesterday.reminded, yesterday.back], [1, 1]);
  assert.equal(a.challenge.days[0].players, 1);
  assert.equal(a.challenge.days[0].game, gameOfDay(CFG, dayUtc(NOW)));

  // Ни имён, ни id игроков в ответе нет.
  const json = JSON.stringify(a);
  assert.doesNotMatch(json, /Игрок|"id"|player_id|user_id/);
  store.close();
});

test("analytics on an empty database", () => {
  const store = openDb(":memory:");
  const a = collectAnalytics(store.db, CFG, NOW);
  assert.equal(a.activity.mau, 0);
  assert.equal(a.activity.stickiness, null);
  assert.equal(a.funnel[0].n, 0);
  assert.deepEqual(a.levels.tanks.levels, []);
  store.close();
});
