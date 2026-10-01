import { DatabaseSync } from "node:sqlite";

// Миграции только вперёд: каждая выполняется один раз, номер последней хранится
// в PRAGMA user_version. Старые миграции не меняются, новые добавляются в конец.
// Версия 1 — исходная схема; базы, созданные до появления миграций, имеют user_version 0
// и те же таблицы, поэтому версия 1 написана через IF NOT EXISTS.
export const MIGRATIONS = [
  `
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
  `,
  // 2: быстрый поиск отчётов текущей игры для проверки правдоподобия.
  `
    CREATE INDEX IF NOT EXISTS level_results_player ON level_results(player_id, created_at);
    CREATE INDEX IF NOT EXISTS runs_player ON runs(player_id, created_at);
  `,
];

export function migrate(db) {
  const from = db.prepare("PRAGMA user_version").get().user_version;
  if (from > MIGRATIONS.length) {
    throw new Error(`База новее кода (версия ${from}, код знает ${MIGRATIONS.length}). Обновите бота.`);
  }
  for (let v = from; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return { from, to: MIGRATIONS.length };
}

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  const version = migrate(db);

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
    lastRunAt: db.prepare("SELECT MAX(created_at) AS at FROM runs WHERE player_id = ?"),
    levelsSince: db.prepare(`SELECT level, score, time_left AS timeLeft, created_at AS at FROM level_results
      WHERE player_id = ? AND created_at > ? ORDER BY id`),
    rank: db.prepare(`SELECT COUNT(*) + 1 AS rank FROM players
      WHERE best_score > ? OR (best_score = ? AND best_at < ?)`),
  };

  return {
    db,
    version,
    close: () => db.close(),
    touchPlayer(user) {
      const name = [user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 64) || "Игрок";
      q.upsertPlayer.run(user.id, name, user.username ?? null, Date.now());
      return q.getPlayer.get(user.id);
    },
    getPlayer: (id) => q.getPlayer.get(id),
    addRun(id, r, now = Date.now()) {
      q.addRun.run(id, r.score, r.coins, r.levels, r.deaths, r.completed ? 1 : 0, r.bossFire ? 1 : 0, now);
      q.bumpPlayer.run(r.coins, r.score, now, r.score, id);
    },
    addLevel: (id, l, at = Date.now()) => q.addLevel.run(id, l.level, l.score, l.timeLeft, l.deaths, at),
    lastRunAt: (id) => q.lastRunAt.get(id).at ?? 0,
    levelsSince: (id, since) => q.levelsSince.all(id, since),
    earned: (id) => q.earned.all(id),
    earn: (id, code) => q.earn.run(id, code, Date.now()).changes > 0,
    top: (limit = 20) => q.top.all(limit),
    rank(p) {
      if (!p || p.best_score <= 0) return null;
      return q.rank.get(p.best_score, p.best_score, p.best_at).rank;
    },
  };
}
