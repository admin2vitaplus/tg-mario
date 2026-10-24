import { LAST_LEVEL, MIN_LEVEL_TICKS, openLevels, timeOf } from "./plausibility.js";

// «На время» в «Прыг-Скоке»: открытый уровень на скорость, таблица лучшего времени по уровню.
// Перед попыткой игра говорит серверу, какой уровень начат (start); итог (finish) принимается,
// только если с начала прошло не меньше реального времени попытки, время не меньше самого быстрого
// возможного прохождения (MIN_LEVEL_TICKS тиков таймера) и не больше таймера уровня.
// Начатые попытки хранятся в памяти: после перезапуска сервера попытку нужно начать заново.

export const TOP = 10;
const TICK_MS = 400;
const REAL_TIME_SHARE = 0.9; // запас на неточность таймера телефона
const START_TTL_MS = 30 * 60_000;

export function createTimeAttack(store, { now = Date.now } = {}) {
  const { db } = store;
  const q = {
    best: db.prepare("SELECT ms FROM mario_times WHERE player_id = ? AND level = ?"),
    upsert: db.prepare(`INSERT INTO mario_times (player_id, level, ms, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(player_id, level) DO UPDATE SET ms = excluded.ms, at = excluded.at WHERE excluded.ms < mario_times.ms`),
    top: db.prepare(`SELECT t.player_id AS id, t.ms, COALESCE(p.name, 'Игрок') AS name FROM mario_times t
      LEFT JOIN players p ON p.id = t.player_id WHERE t.level = ? ORDER BY t.ms ASC, t.at ASC LIMIT ${TOP}`),
    rank: db.prepare("SELECT COUNT(*) + 1 AS n FROM mario_times WHERE level = ? AND ms < ?"),
  };
  const started = new Map(); // игрок -> { level, at }
  const valid = (level) => Number.isSafeInteger(level) && level >= 0 && level <= LAST_LEVEL;

  // Таблица уровня: лучшие TOP, своё время и место.
  function table(playerId, level) {
    if (!valid(level)) return { status: 400, error: "bad level" };
    const mine = q.best.get(playerId, level)?.ms ?? null;
    return {
      status: 200,
      body: {
        level,
        top: q.top.all(level).map((r) => ({ name: r.name, ms: r.ms, me: r.id === playerId })),
        mine,
        rank: mine === null ? null : q.rank.get(level, mine).n,
      },
    };
  }

  return {
    table,

    start(playerId, level) {
      if (!valid(level)) return { status: 400, error: "bad level" };
      if (!openLevels(store.passedLevels(playerId)).has(level)) return { status: 409, error: "level not open" };
      const at = now();
      for (const [id, s] of started) if (at - s.at > START_TTL_MS) started.delete(id);
      started.set(playerId, { level, at });
      return { status: 200, body: { ok: true } };
    },

    // → { status, body: таблица уровня и { best, newRecord } }
    finish(playerId, { level, ms }) {
      if (!valid(level) || !Number.isSafeInteger(ms)) return { status: 400, error: "bad data" };
      const s = started.get(playerId);
      if (!s || s.level !== level) return { status: 409, error: "not started" };
      started.delete(playerId);
      const at = now();
      if (ms < MIN_LEVEL_TICKS * TICK_MS || ms > timeOf(level) * TICK_MS) return { status: 422, error: "implausible" };
      if (at - s.at < ms * REAL_TIME_SHARE) return { status: 422, error: "implausible" };
      const before = q.best.get(playerId, level)?.ms ?? null;
      q.upsert.run(playerId, level, ms, at);
      const t = table(playerId, level);
      return { status: 200, body: { ...t.body, best: Math.min(before ?? ms, ms), newRecord: before === null || ms < before } };
    },
  };
}
