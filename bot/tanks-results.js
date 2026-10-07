import { randomInt } from "node:crypto";
import { replay as tanksReplay } from "./tanks-replay.js";

// Итоги игр, которые сервер проверил сам повтором записи («Танкодром», «Бомбодром»; ТЗ P0-4):
//  1. перед игрой игра берёт у сервера зерно (билет) — подобрать удобную раскладку нельзя;
//  2. после игры присылает запись нажатий; сервер проигрывает её (tanks-replay.js) и сам
//     считает очки; игра не может закончиться быстрее, чем прошло реального времени с выдачи билета;
//  3. онлайн-матч присылает хозяин: очки гостя засчитываются гостю, если сервер видел его в комнате.
// У каждой игры свои таблицы билетов и игр (tickets, runs) и свой повтор (replay).

export const TICKET_TTL_MS = 6 * 3600_000;
const OPEN_TICKETS = 5; // неиспользованных билетов на игрока
const REAL_TIME_SHARE = 0.9; // запас на неточность таймера

export const createTanksResults = (store, opts = {}) =>
  createReplayResults(store, { ...opts, tickets: "tanks_tickets", runs: "tanks_runs", replay: tanksReplay });

export function createReplayResults(store, { now = Date.now, members = () => null, tickets, runs, replay }) {
  const { db } = store;
  const q = {
    ticket: db.prepare(`SELECT * FROM ${tickets} WHERE seed = ?`),
    open: db.prepare(`SELECT COUNT(*) AS n FROM ${tickets} WHERE player_id = ? AND used_at IS NULL AND issued_at > ?`),
    addTicket: db.prepare(`INSERT OR IGNORE INTO ${tickets} (seed, player_id, issued_at) VALUES (?, ?, ?)`),
    use: db.prepare(`UPDATE ${tickets} SET used_at = ? WHERE seed = ? AND used_at IS NULL`),
    best: db.prepare(`SELECT COALESCE(MAX(score), 0) AS best FROM ${runs} WHERE player_id = ?`),
    addRun: db.prepare(`INSERT OR IGNORE INTO ${runs} (player_id, seed, score, stages, frames, players, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    prune: db.prepare(`DELETE FROM ${tickets} WHERE used_at IS NULL AND issued_at < ?`),
  };

  return {
    // → { seed } или { error: "too many" }
    ticket(playerId) {
      const at = now();
      q.prune.run(at - TICKET_TTL_MS);
      if (q.open.get(playerId, at - TICKET_TTL_MS).n >= OPEN_TICKETS) return { error: "too many" };
      for (let i = 0; i < 10; i++) {
        const seed = randomInt(1, 2 ** 31 - 1);
        if (q.addTicket.run(seed, playerId, at).changes) return { seed };
      }
      return { error: "busy" };
    },

    // → { status, error?, why?, results: [{ playerId, score, best, newRecord, stages }] }
    submit(playerId, { seed, players, log, room }) {
      const at = now();
      const t = Number.isSafeInteger(seed) ? q.ticket.get(seed) : null;
      if (!t || t.player_id !== playerId) return { status: 403, error: "no ticket" };
      if (t.used_at) return { status: 409, error: "already sent" };
      if (at - t.issued_at > TICKET_TTL_MS) return { status: 410, error: "ticket expired" };
      const r = replay({ seed, players, log });
      if (!r.ok) return { status: 422, error: "implausible", why: r.why };
      if (at - t.issued_at < (r.frames / 60) * 1000 * REAL_TIME_SHARE) return { status: 422, error: "implausible", why: "faster than real time" };

      let credit;
      if (players === 1) credit = [[playerId, r.scores[0]]];
      else if (room != null) {
        const m = members(room);
        if (!m || m.host !== playerId) return { status: 403, error: "not the host of this room" };
        credit = [[playerId, r.scores[0]]];
        if (m.guest && m.guest !== playerId) credit.push([m.guest, r.scores[1]]);
      } else credit = [[playerId, r.scores[0] + r.scores[1]]]; // вдвоём за одной клавиатурой

      const results = [];
      db.exec("BEGIN");
      try {
        if (!q.use.run(at, seed).changes) throw Object.assign(new Error("already sent"), { status: 409 });
        for (const [id, score] of credit) {
          const before = q.best.get(id).best;
          if (!q.addRun.run(id, seed, score, r.stages, r.frames, players, at).changes) continue;
          results.push({ playerId: id, score, best: Math.max(before, score), newRecord: score > before, stages: r.stages });
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        if (err.status) return { status: err.status, error: err.message };
        throw err;
      }
      return { status: 200, results };
    },

    best: (playerId) => q.best.get(playerId).best,
  };
}
