import { DatabaseSync } from "node:sqlite";

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      games INTEGER NOT NULL DEFAULT 0,
      total_coins INTEGER NOT NULL DEFAULT 0,
      best_score INTEGER NOT NULL DEFAULT 0,
      best_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id),
      score INTEGER NOT NULL,
      coins INTEGER NOT NULL,
      levels INTEGER NOT NULL,
      deaths INTEGER NOT NULL,
      completed INTEGER NOT NULL,
      boss_fire INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS level_results (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id),
      level INTEGER NOT NULL,
      score INTEGER NOT NULL,
      time_left INTEGER NOT NULL,
      deaths INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS achievements (
      player_id INTEGER NOT NULL REFERENCES players(id),
      code TEXT NOT NULL,
      earned_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, code)
    );
    CREATE INDEX IF NOT EXISTS players_best ON players(best_score DESC);
  `);

  const q = {
    upsertPlayer: db.prepare(`
      INSERT INTO players (id, name, username, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, username = excluded.username`),
    getPlayer: db.prepare("SELECT * FROM players WHERE id = ?"),
    addRun: db.prepare(`INSERT INTO runs (player_id, score, coins, levels, deaths, completed, boss_fire, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    bumpPlayer: db.prepare(`
      UPDATE players SET games = games + 1, total_coins = total_coins + ?,
        best_at = CASE WHEN ? > best_score THEN ? ELSE best_at END,
        best_score = MAX(best_score, ?)
      WHERE id = ?`),
    addLevel: db.prepare(`INSERT INTO level_results (player_id, level, score, time_left, deaths, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`),
    earned: db.prepare("SELECT code, earned_at FROM achievements WHERE player_id = ?"),
    earn: db.prepare("INSERT OR IGNORE INTO achievements (player_id, code, earned_at) VALUES (?, ?, ?)"),
    top: db.prepare(`SELECT id, name, username, best_score FROM players WHERE best_score > 0
      ORDER BY best_score DESC, best_at ASC LIMIT ?`),
    rank: db.prepare(`SELECT COUNT(*) + 1 AS rank FROM players
      WHERE best_score > ? OR (best_score = ? AND best_at < ?)`),
  };

  return {
    db,
    touchPlayer(user) {
      const name = [user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 64) || "Игрок";
      q.upsertPlayer.run(user.id, name, user.username ?? null, Date.now());
      return q.getPlayer.get(user.id);
    },
    getPlayer: (id) => q.getPlayer.get(id),
    addRun(id, r) {
      const now = Date.now();
      q.addRun.run(id, r.score, r.coins, r.levels, r.deaths, r.completed ? 1 : 0, r.bossFire ? 1 : 0, now);
      q.bumpPlayer.run(r.coins, r.score, now, r.score, id);
    },
    addLevel: (id, l) => q.addLevel.run(id, l.level, l.score, l.timeLeft, l.deaths, Date.now()),
    earned: (id) => q.earned.all(id),
    earn: (id, code) => q.earn.run(id, code, Date.now()).changes > 0,
    top: (limit = 20) => q.top.all(limit),
    rank(p) {
      if (!p || p.best_score <= 0) return null;
      return q.rank.get(p.best_score, p.best_score, p.best_at).rank;
    },
  };
}
