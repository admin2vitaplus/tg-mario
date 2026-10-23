import { DAY_MS, dayOf } from "./days.js";
import { dayUtc } from "./economy.js";
import { gameOfDay } from "./challenge.js";
import { LAST_LEVEL, PER_WORLD } from "./plausibility.js";
import { retention } from "./stats.js";

// Аналитика для панели владельца («Аналитика» в admin.js): что делают игроки. Только суммы и доли —
// ни имён, ни id игроков в ответе нет. Новых записей почти не нужно: всё считается из того, что уже
// хранится (события статистики за 90 дней, принятые игры, журнал жетонов, оплаты звёздами, испытание дня).
// Дни активности — по Москве, как в /stats; дни жетонов и испытания — по UTC, как у самих заданий.
// Считается по запросу панели и хранится в памяти несколько минут (admin.js), поэтому серверу не тяжело.

export const ANALYTICS_DAYS = 30;
export const RETENTION_DAYS = [1, 3, 7, 14, 30];
export const COHORT_WEEKS = 8;
const MSK_MS = 3 * 3_600_000;
const RUN_TABLES = { tanks: "tanks_runs", bombs: "bombs_runs", range: "range_runs" };
export const ANALYTICS_GAMES = ["mario", "tanks", "bombs", "range"];
const STREAK_BUCKETS = [[1, 1], [2, 3], [4, 6], [7, 13], [14, Infinity]];

// Начало дня по Москве в миллисекундах.
const dayStart = (day) => day * DAY_MS - MSK_MS;
const rate = (part, whole) => (whole ? part / whole : null);

// Активные по дням: все, новые, вернувшиеся; активные за 7 дней скользящим окном; липкость (DAU/MAU).
function activity(db, today) {
  const from = today - ANALYTICS_DAYS + 1;
  const map = (rows) => new Map(rows.map((r) => [r.day, r.n]));
  const dau = map(db.prepare(`SELECT day, COUNT(DISTINCT user_id) AS n FROM events
    WHERE day BETWEEN ? AND ? AND user_id IS NOT NULL GROUP BY day`).all(from, today));
  const fresh = map(db.prepare(`SELECT day, COUNT(*) AS n FROM users_seen
    WHERE day BETWEEN ? AND ? AND source != 'old' GROUP BY day`).all(from, today));
  const wauQ = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE day BETWEEN ? AND ? AND user_id IS NOT NULL`);
  const days = [];
  for (let d = from; d <= today; d++) {
    const all = dau.get(d) ?? 0;
    const newPlayers = Math.min(fresh.get(d) ?? 0, all);
    days.push({ day: d, dau: all, newPlayers, returning: all - newPlayers, wau: wauQ.get(d - 6, d).n });
  }
  const mau = wauQ.get(today - 29, today).n;
  const week = days.slice(-7);
  const avgDau = week.reduce((a, d) => a + d.dau, 0) / week.length;
  return { days, mau, wau: wauQ.get(today - 6, today).n, avgDau: Math.round(avgDau * 10) / 10, stickiness: rate(avgDau, mau) };
}

// Удержание: общее по дням N (когорты за 90 дней, пока хранятся события), по неделям прихода и по источникам.
function retentionBlock(db, today) {
  const overall = Object.fromEntries(RETENTION_DAYS.map((n) => [`d${n}`, retention(db, n, today - 89, today)]));
  const cohortQ = (n) => db.prepare(`SELECT COUNT(*) AS cohort,
      SUM(EXISTS (SELECT 1 FROM events e WHERE e.user_id = s.user_id AND e.day = s.day + ?1)) AS returned
    FROM users_seen s WHERE s.day BETWEEN ?2 AND ?3 AND s.day + ?1 < ?4 AND s.source != 'old'`);
  const qs = Object.fromEntries(RETENTION_DAYS.map((n) => [n, cohortQ(n)]));
  const size = db.prepare("SELECT COUNT(*) AS n FROM users_seen WHERE day BETWEEN ? AND ? AND source != 'old'");
  const cohorts = [];
  for (let w = 0; w < COHORT_WEEKS; w++) {
    const to = today - 7 * w;
    const from = to - 6;
    const row = { from, to, players: size.get(from, to).n };
    for (const n of RETENTION_DAYS) {
      const r = qs[n].get(n, from, to, today);
      // Пусто, пока у когорты не закончился день N ни у одного игрока.
      row[`d${n}`] = r.cohort ? { cohort: r.cohort, returned: r.returned ?? 0, rate: (r.returned ?? 0) / r.cohort } : null;
    }
    cohorts.push(row);
  }
  const bySource = db.prepare(`SELECT source, COUNT(*) AS players,
      SUM(day + 1 < ?1) AS c1, SUM(day + 1 < ?1 AND EXISTS (SELECT 1 FROM events e WHERE e.user_id = s.user_id AND e.day = s.day + 1)) AS r1,
      SUM(day + 7 < ?1) AS c7, SUM(day + 7 < ?1 AND EXISTS (SELECT 1 FROM events e WHERE e.user_id = s.user_id AND e.day = s.day + 7)) AS r7
    FROM users_seen s WHERE day >= ?2 AND source != 'old' GROUP BY source ORDER BY players DESC LIMIT 12`).all(today, today - 89)
    .map((r) => ({ source: r.source, players: r.players, d1: rate(r.r1 ?? 0, r.c1 ?? 0), d7: rate(r.r7 ?? 0, r.c7 ?? 0) }));
  return { overall, cohorts, bySource };
}

// Воронка новичков за 30 дней: пришёл → открыл игру → начал → доиграл → вернулся в другой день →
// был активен 3 дня и больше → купил за жетоны → заплатил звёздами.
function funnel(db, today) {
  const from = today - ANALYTICS_DAYS + 1;
  const r = db.prepare(`SELECT COUNT(*) AS arrived,
      SUM(EXISTS (SELECT 1 FROM events e WHERE e.user_id = s.user_id AND e.type = 'game_open')) AS opened,
      SUM(EXISTS (SELECT 1 FROM events e WHERE e.user_id = s.user_id AND e.type = 'game_start')) AS started,
      SUM(EXISTS (SELECT 1 FROM events e WHERE e.user_id = s.user_id AND e.type IN ('game_finish', 'match_finished'))) AS finished,
      SUM(EXISTS (SELECT 1 FROM events e WHERE e.user_id = s.user_id AND e.day > s.day)) AS returned,
      SUM((SELECT COUNT(DISTINCT e.day) FROM events e WHERE e.user_id = s.user_id) >= 3) AS days3,
      SUM(EXISTS (SELECT 1 FROM ledger l WHERE l.player_id = s.user_id AND l.reason = 'shop')) AS bought,
      SUM(EXISTS (SELECT 1 FROM purchases p WHERE p.player_id = s.user_id AND p.refunded_at IS NULL)) AS paid
    FROM users_seen s WHERE s.day BETWEEN ? AND ? AND s.source != 'old'`).get(from, today);
  return ["arrived", "opened", "started", "finished", "returned", "days3", "bought", "paid"].map((step) => ({ step, n: r[step] ?? 0 }));
}

// По играм за 7 и 30 дней: игроки, заходы (открыли игру), начатые и принятые сервером игры.
function games(db, today) {
  const window = (days) => {
    const fromDay = today - days + 1;
    const since = dayStart(fromDay);
    const ev = db.prepare(`SELECT game, COUNT(DISTINCT user_id) AS players, SUM(type = 'game_open') AS opens,
        SUM(type = 'game_start') AS starts FROM events WHERE day >= ? AND game != '' GROUP BY game`).all(fromDay);
    const runs = {
      mario: db.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT player_id) AS p FROM runs WHERE created_at >= ?").get(since),
      ...Object.fromEntries(Object.entries(RUN_TABLES).map(([g, t]) =>
        [g, db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT player_id) AS p FROM ${t} WHERE created_at >= ?`).get(since)])),
    };
    return ANALYTICS_GAMES.map((game) => {
      const e = ev.find((x) => x.game === game) || { players: 0, opens: 0, starts: 0 };
      const r = runs[game];
      return {
        game, players: e.players, opens: e.opens ?? 0, starts: e.starts ?? 0, games: r.n, gamers: r.p,
        opensPerPlayer: rate(e.opens ?? 0, e.players), gamesPerGamer: rate(r.n, r.p),
      };
    });
  };
  return { week: window(7), month: window(30) };
}

// Где бросают: сколько игроков прошли каждый уровень (этап) за всё время и на каком этапе чаще всего
// кончаются одиночные игры с первого этапа за 30 дней.
function levels(db, today) {
  const since = dayStart(today - ANALYTICS_DAYS + 1);
  const passed = new Map(db.prepare("SELECT level, COUNT(DISTINCT player_id) AS n FROM level_results GROUP BY level").all()
    .map((r) => [r.level, r.n]));
  const marioPlayers = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT player_id FROM runs UNION SELECT player_id FROM level_results)`).get().n;
  const out = {
    mario: {
      players: marioPlayers,
      levels: Array.from({ length: LAST_LEVEL + 1 }, (_, i) => ({
        label: `${Math.floor(i / PER_WORLD) + 1}-${(i % PER_WORLD) + 1}`, passed: passed.get(i) ?? 0,
      })),
    },
  };
  for (const [game, table] of Object.entries(RUN_TABLES)) {
    const reach = db.prepare(`SELECT MAX(start + stages) AS reached FROM ${table} GROUP BY player_id`).all().map((r) => r.reached);
    const max = Math.min(Math.max(0, ...reach), 100);
    const ends = db.prepare(`SELECT stages + 1 AS stage, COUNT(*) AS n FROM ${table}
      WHERE created_at >= ? AND start = 0 AND players = 1 GROUP BY stages ORDER BY n DESC, stage LIMIT 5`).all(since);
    out[game] = {
      players: reach.length,
      levels: Array.from({ length: max }, (_, i) => ({ label: String(i + 1), passed: reach.filter((n) => n >= i + 1).length })),
      ends,
    };
  }
  return out;
}

// Покупки за 30 дней: за жетоны (оформление и жизни) и за звёзды, плюс платящие за всё время.
function purchases(db, at) {
  const since = at - ANALYTICS_DAYS * DAY_MS;
  const tokens = db.prepare(`SELECT CASE WHEN event LIKE 'life:%' THEN 'life' ELSE event END AS item, COUNT(*) AS n,
      -SUM(amount) AS spent, COUNT(DISTINCT player_id) AS buyers FROM ledger
    WHERE reason = 'shop' AND amount < 0 AND at >= ? GROUP BY 1 ORDER BY n DESC, item LIMIT 15`).all(since);
  const tokensTotal = db.prepare(`SELECT COUNT(*) AS n, COALESCE(-SUM(amount), 0) AS spent, COUNT(DISTINCT player_id) AS buyers
    FROM ledger WHERE reason = 'shop' AND amount < 0 AND at >= ?`).get(since);
  const stars = db.prepare(`SELECT CASE WHEN item LIKE 'life:%' THEN 'life' ELSE item END AS item, COUNT(*) AS n,
      SUM(stars) AS sum, COUNT(DISTINCT player_id) AS buyers FROM purchases
    WHERE refunded_at IS NULL AND at >= ? GROUP BY 1 ORDER BY sum DESC, item LIMIT 15`).all(since);
  const starsTotal = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(stars), 0) AS sum, COUNT(DISTINCT player_id) AS buyers
    FROM purchases WHERE refunded_at IS NULL AND at >= ?`).get(since);
  const payersAll = db.prepare("SELECT COUNT(DISTINCT player_id) AS n FROM purchases WHERE refunded_at IS NULL").get().n;
  const usersAll = db.prepare("SELECT COUNT(*) AS n FROM users_seen").get().n;
  return {
    tokens, tokensTotal, stars, starsTotal,
    arppu: rate(starsTotal.sum, starsTotal.buyers),
    payersAll, payingShare: rate(payersAll, usersAll),
  };
}

// Серии входов сейчас (у кого серия не прервалась): сколько игроков в каждой группе дней.
function streaks(db, at) {
  const day = dayUtc(at);
  const rows = db.prepare("SELECT streak FROM wallets WHERE streak_day >= ? AND streak > 0 AND flagged IS NULL").all(day - 1);
  return STREAK_BUCKETS.map(([a, b]) => ({ from: a, to: b === Infinity ? null : b, n: rows.filter((r) => r.streak >= a && r.streak <= b).length }));
}

// Испытание дня за 14 дней (UTC) и напоминания: сколько ушло и сколько игроков пришло после них в тот же день.
function challengeBlock(db, cfg, at) {
  const today = dayUtc(at);
  const played = new Map(db.prepare(`SELECT day, COUNT(*) AS n FROM challenge_results WHERE day > ? GROUP BY day`).all(today - 14)
    .map((r) => [r.day, r.n]));
  const closed = new Set(db.prepare("SELECT day FROM challenge_days WHERE day > ?").all(today - 14).map((r) => r.day));
  const reminders = new Map(db.prepare(`SELECT r.day, COUNT(*) AS sent,
      SUM(EXISTS (SELECT 1 FROM ledger l WHERE l.player_id = r.player_id AND l.reason = 'daily'
        AND l.event = 'day:' || r.day AND l.at > r.at)) AS back
    FROM reminders r WHERE r.day > ? GROUP BY r.day`).all(today - 14).map((r) => [r.day, r]));
  const days = [];
  for (let d = today; d > today - 14; d--) {
    const r = reminders.get(d);
    days.push({
      day: d, game: cfg ? gameOfDay(cfg, d) : null, players: played.get(d) ?? 0,
      prized: closed.has(d) && (played.get(d) ?? 0) >= (cfg?.challenge.minPlayers ?? Infinity),
      reminded: r?.sent ?? 0, back: r?.back ?? 0,
    });
  }
  return { days, remindOff: db.prepare("SELECT COUNT(*) AS n FROM wallets WHERE remind = 0").get().n };
}

// Товары — с названиями из магазина (economy.json), чтобы панель не показывала одни id.
function named(p, cfg) {
  const name = (item) => cfg?.shop.find((it) => it.id === item)?.ru ?? null;
  for (const list of [p.tokens, p.stars]) for (const r of list) r.name = name(r.item);
  return p;
}

export function collectAnalytics(db, cfg = null, at = Date.now()) {
  const today = dayOf(at);
  return {
    at,
    today,
    activity: activity(db, today),
    retention: retentionBlock(db, today),
    funnel: funnel(db, today),
    games: games(db, today),
    levels: levels(db, today),
    purchases: named(purchases(db, at), cfg),
    streaks: streaks(db, at),
    challenge: challengeBlock(db, cfg, at),
  };
}
