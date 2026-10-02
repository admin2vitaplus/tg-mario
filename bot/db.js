import { DatabaseSync } from "node:sqlite";
import { dayOf } from "./days.js";

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
  // 3: статистика (ТЗ P0-5). events — сырые события за последние 90 дней, day — номер дня по Москве.
  // users_seen — когда и откуда игрок пришёл впервые (хранится всегда, нужен для «новый/вернувшийся»).
  // stats_daily — суммы по дням для событий старше 90 дней, после чего сами события удаляются.
  // Игроки, появившиеся до статистики, переносятся с источником old и в когорты не попадают.
  `
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      at INTEGER NOT NULL,
      day INTEGER NOT NULL,
      user_id INTEGER,
      type TEXT NOT NULL,
      game TEXT NOT NULL DEFAULT '',
      source TEXT,
      ref TEXT,
      detail TEXT
    );
    CREATE INDEX events_day ON events(day, type);
    CREATE INDEX events_user ON events(user_id, day);
    CREATE TABLE users_seen (
      user_id INTEGER PRIMARY KEY,
      at INTEGER NOT NULL,
      day INTEGER NOT NULL,
      source TEXT NOT NULL,
      inviter INTEGER
    );
    CREATE INDEX users_seen_day ON users_seen(day);
    CREATE TABLE stats_daily (
      day INTEGER NOT NULL,
      game TEXT NOT NULL,
      type TEXT NOT NULL,
      events INTEGER NOT NULL,
      users INTEGER NOT NULL,
      PRIMARY KEY (day, game, type)
    );
    INSERT OR IGNORE INTO users_seen (user_id, at, day, source)
      SELECT id, created_at, (created_at + 10800000) / 86400000, 'old' FROM players;
  `,
  // 4: жетоны (ТЗ P1-7), см. economy.js. ledger — журнал операций, только добавление (триггеры
  // запрещают UPDATE и DELETE); одно событие начисляет один раз — UNIQUE (игрок, причина, событие).
  // wallets — кэш баланса (обновляется в той же транзакции), серия дней, пометка и настройки игрока.
  // seasons/season_* — закрытие недели по шагам: снимок → призы → сообщения → готово.
  `
    CREATE TABLE ledger (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      event TEXT NOT NULL,
      season INTEGER NOT NULL,
      day INTEGER NOT NULL,
      at INTEGER NOT NULL,
      UNIQUE (player_id, reason, event)
    );
    CREATE INDEX ledger_player_day ON ledger(player_id, day);
    CREATE INDEX ledger_season ON ledger(season, reason);
    CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
    CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
    CREATE TABLE wallets (
      player_id INTEGER PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      streak_day INTEGER,
      flagged TEXT,
      flagged_at INTEGER,
      strikes INTEGER NOT NULL DEFAULT 0,
      strike_day INTEGER,
      notify INTEGER NOT NULL DEFAULT 1,
      lang TEXT
    );
    CREATE TABLE seasons (
      season INTEGER PRIMARY KEY,
      state TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE season_balances (
      season INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      balance INTEGER NOT NULL,
      gained INTEGER NOT NULL,
      PRIMARY KEY (season, player_id)
    );
    CREATE TABLE season_places (
      season INTEGER NOT NULL,
      board TEXT NOT NULL,
      place INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      value INTEGER NOT NULL,
      prize INTEGER NOT NULL,
      PRIMARY KEY (season, board, place)
    );
    CREATE TABLE season_notified (
      season INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      PRIMARY KEY (season, player_id)
    );
    CREATE TABLE economy_meta (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `,
  // 5: «Танкодром» с проверкой повтором (tanks-replay.js) и покупки за Telegram Stars.
  // tanks_tickets — зерно игры, выданное сервером (нельзя подобрать удобное и нельзя сыграть
  // быстрее реального времени); tanks_runs — принятые игры; purchases — оплаты звёздами,
  // одна оплата — одна запись (UNIQUE charge_id), возврат отмечается refunded_at.
  `
    CREATE TABLE tanks_tickets (
      seed INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      issued_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE INDEX tanks_tickets_player ON tanks_tickets(player_id, issued_at);
    CREATE TABLE tanks_runs (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      seed INTEGER NOT NULL,
      score INTEGER NOT NULL,
      stages INTEGER NOT NULL,
      frames INTEGER NOT NULL,
      players INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (player_id, seed)
    );
    CREATE INDEX tanks_runs_time ON tanks_runs(created_at);
    CREATE TABLE purchases (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL,
      item TEXT NOT NULL,
      stars INTEGER NOT NULL,
      charge_id TEXT NOT NULL UNIQUE,
      at INTEGER NOT NULL,
      refunded_at INTEGER
    );
    CREATE INDEX purchases_player ON purchases(player_id);
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
    addEvent: db.prepare(`INSERT INTO events (at, day, user_id, type, game, source, ref, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    lastEvent: db.prepare(`SELECT * FROM events WHERE user_id = ? AND type = ? AND at >= ?
      ORDER BY id DESC LIMIT 1`),
    lastEventByRef: db.prepare(`SELECT * FROM events WHERE type = ? AND ref = ? AND at >= ?
      ORDER BY id DESC LIMIT 1`),
    seen: db.prepare(`INSERT OR IGNORE INTO users_seen (user_id, at, day, source, inviter) VALUES (?, ?, ?, ?, ?)`),
    getSeen: db.prepare("SELECT * FROM users_seen WHERE user_id = ?"),
    archive: db.prepare(`INSERT INTO stats_daily (day, game, type, events, users)
      SELECT day, game, type, COUNT(*), COUNT(DISTINCT user_id) FROM events WHERE day < ? GROUP BY day, game, type
      ON CONFLICT(day, game, type) DO UPDATE SET events = events + excluded.events, users = users + excluded.users`),
    pruneEvents: db.prepare("DELETE FROM events WHERE day < ?"),
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
    // ---------- Статистика ----------
    addEvent({ userId = null, type, game = "", source = null, ref = null, detail = null }, at = Date.now()) {
      q.addEvent.run(at, dayOf(at), userId, type, game, source, ref == null ? null : String(ref), detail);
    },
    lastEvent: (userId, type, since) => q.lastEvent.get(userId, type, since),
    lastEventByRef: (type, ref, since) => q.lastEventByRef.get(type, String(ref), since),
    // true, если игрок появился впервые (тогда же пишется событие user_first_seen).
    seen(userId, { source, inviter = null, ref = null }, at = Date.now()) {
      if (q.seen.run(userId, at, dayOf(at), source, inviter).changes === 0) return false;
      this.addEvent({ userId, type: "user_first_seen", source, ref }, at);
      return true;
    },
    getSeen: (userId) => q.getSeen.get(userId),
    // Сырые события старше keepDays дней сворачиваются в суммы по дням и удаляются.
    pruneEvents(at = Date.now(), keepDays = 90) {
      const before = dayOf(at) - keepDays;
      db.exec("BEGIN");
      try {
        q.archive.run(before);
        const removed = q.pruneEvents.run(before).changes;
        db.exec("COMMIT");
        return removed;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
    rank(p) {
      if (!p || p.best_score <= 0) return null;
      return q.rank.get(p.best_score, p.best_score, p.best_at).rank;
    },
  };
}
