import { randomBytes } from "node:crypto";
import { replay as tanksReplay } from "./tanks-replay.js";
import { replay as bombsReplay } from "./bombs-replay.js";
import { replay as rangeReplay } from "./range-replay.js";

// «Побей мой счёт»: после своей игры игрок зовёт друга сыграть ту же партию — то же зерно, правила,
// режим и этап начала, то есть те же враги и мишени в том же порядке. Вызов создаётся только по
// игре, которую сервер уже принял (строка в <game>_runs с этим зерном), и её запись проигрывается
// ещё раз: счёт вызова — проверенный. Игры по вызову тоже проигрываются сервером, но жетонов,
// рекордов и заданий не дают: это игра на интерес, без билета.

export const GAMES = { tanks: tanksReplay, bombs: bombsReplay, range: rangeReplay };
export const TOP = 10;
const ID = /^[a-z0-9]{8}$/;

export function createBeat(store, { now = Date.now } = {}) {
  const { db } = store;
  const runOf = {};
  for (const game of Object.keys(GAMES)) {
    runOf[game] = db.prepare(`SELECT score FROM ${game}_runs WHERE player_id = ? AND seed = ?`);
  }
  const q = {
    byId: db.prepare("SELECT * FROM beat_challenges WHERE id = ?"),
    bySeed: db.prepare("SELECT * FROM beat_challenges WHERE game = ? AND seed = ?"),
    add: db.prepare(`INSERT OR IGNORE INTO beat_challenges (id, game, seed, rules, mode, start, owner_id, owner_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    result: db.prepare("SELECT score FROM beat_results WHERE challenge_id = ? AND player_id = ?"),
    upsert: db.prepare(`INSERT INTO beat_results (challenge_id, player_id, score, at) VALUES (?, ?, ?, ?)
      ON CONFLICT(challenge_id, player_id) DO UPDATE SET score = excluded.score, at = excluded.at WHERE excluded.score > beat_results.score`),
    top: db.prepare(`SELECT r.player_id AS id, r.score, COALESCE(p.name, 'Игрок') AS name FROM beat_results r
      LEFT JOIN players p ON p.id = r.player_id WHERE r.challenge_id = ? ORDER BY r.score DESC, r.at ASC LIMIT ${TOP}`),
  };
  const nameOf = (id) => store.getPlayer(id)?.name || "Игрок";

  function view(c, playerId) {
    const mine = q.result.get(c.id, playerId);
    return {
      id: c.id, game: c.game, seed: c.seed, rules: c.rules, mode: c.mode, start: c.start,
      owner: { name: nameOf(c.owner_id), score: c.owner_score, me: c.owner_id === playerId },
      top: q.top.all(c.id).map((r) => ({ name: r.name, score: r.score, me: r.id === playerId })),
      mine: mine ? mine.score : null,
    };
  }

  return {
    // Вызов по своей принятой игре: { seed, log, rules, mode, start } → { status, body }.
    create(playerId, game, { seed, log, rules = 1, mode = "", start = 0 }) {
      if (!GAMES[game] || !Number.isSafeInteger(seed)) return { status: 400, body: { error: "bad data" } };
      const old = q.bySeed.get(game, seed);
      if (old) return old.owner_id === playerId ? { status: 200, body: view(old, playerId) } : { status: 409, body: { error: "not yours" } };
      const run = runOf[game].get(playerId, seed);
      if (!run) return { status: 404, body: { error: "no such game" } };
      const r = GAMES[game]({ seed, players: 1, log, start, rules, mode });
      if (!r.ok || r.scores[0] !== run.score) return { status: 422, body: { error: "implausible" } };
      let id;
      do id = randomBytes(6).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(8, "x").slice(0, 8);
      while (q.byId.get(id));
      q.add.run(id, game, seed, rules, mode, start, playerId, run.score, now());
      return { status: 200, body: view(q.byId.get(id), playerId) };
    },

    get(playerId, id) {
      const c = ID.test(String(id)) ? q.byId.get(id) : null;
      return c ? { status: 200, body: view(c, playerId) } : { status: 404, body: { error: "no such challenge" } };
    },

    // Игра по вызову: { id, log } → тот же вид, что get, плюс score этой игры.
    play(playerId, { id, log }) {
      const c = ID.test(String(id)) ? q.byId.get(id) : null;
      if (!c) return { status: 404, body: { error: "no such challenge" } };
      const r = GAMES[c.game]({ seed: c.seed, players: 1, log, start: c.start, rules: c.rules, mode: c.mode });
      if (!r.ok) return { status: 422, body: { error: "implausible" } };
      if (c.owner_id !== playerId) q.upsert.run(c.id, playerId, r.scores[0], now());
      return { status: 200, body: { ...view(c, playerId), score: r.scores[0] } };
    },
  };
}
