// Уведомления в меню сборника: обновления и новости для всех и личные сообщения игроку.
// Пишет их владелец в панели (admin.js), игра показывает в «🔔 Уведомления» (web/lib/notices.js).
// Таблицы — миграция 12 в db.js. Текст хранится как есть и на странице вставляется только как текст.

export const KINDS = ["update", "news", "personal"];
export const LIMITS = { title: 80, body: 2000 };
// Сколько последних уведомлений получает игрок: старые и так никто не листает.
export const PLAYER_LIST = 50;

const clean = (v, max) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");

export function createNotices(store, { now = Date.now } = {}) {
  const { db } = store;
  const q = {
    add: db.prepare(`INSERT INTO notices (kind, player_id, title, body, title_en, body_en, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    get: db.prepare("SELECT * FROM notices WHERE id = ?"),
    hide: db.prepare("UPDATE notices SET hidden_at = ? WHERE id = ? AND hidden_at IS NULL"),
    forPlayer: db.prepare(`SELECT id, kind, player_id, title, body, title_en, body_en, created_at FROM notices
      WHERE hidden_at IS NULL AND (player_id IS NULL OR player_id = ?) ORDER BY id DESC LIMIT ?`),
    unread: db.prepare(`SELECT COUNT(*) AS n FROM notices
      WHERE hidden_at IS NULL AND (player_id IS NULL OR player_id = ?) AND id > ?`),
    seen: db.prepare("SELECT last_id FROM notice_seen WHERE player_id = ?"),
    setSeen: db.prepare(`INSERT INTO notice_seen (player_id, last_id) VALUES (?, ?)
      ON CONFLICT(player_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`),
    maxId: db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM notices"),
    admin: db.prepare(`SELECT n.*, p.name, p.username, s.last_id AS seen FROM notices n
      LEFT JOIN players p ON p.id = n.player_id LEFT JOIN notice_seen s ON s.player_id = n.player_id
      ORDER BY n.id DESC LIMIT ?`),
  };

  const lastSeen = (playerId) => q.seen.get(playerId)?.last_id ?? 0;

  // Для игрока: текст на его языке (английский — если владелец его написал).
  const publicOf = (n, en) => ({
    id: n.id,
    kind: n.kind,
    title: (en && n.title_en) || n.title,
    body: (en && n.body_en) || n.body,
    at: n.created_at,
  });

  return {
    // { kind, playerId?, title, body, titleEn?, bodyEn? } → { ok, notice } или { ok: false, error }.
    add(input) {
      const playerId = input.playerId == null ? null : Number(input.playerId);
      if (playerId !== null && !(Number.isSafeInteger(playerId) && playerId > 0)) return { ok: false, error: "bad player" };
      // Личное — всегда одному игроку, обновления и новости — всем.
      const kind = playerId ? "personal" : input.kind;
      if (!KINDS.includes(kind) || (kind === "personal" && !playerId)) return { ok: false, error: "bad kind" };
      const title = clean(input.title, LIMITS.title);
      const body = clean(input.body, LIMITS.body);
      if (!title && !body) return { ok: false, error: "empty" };
      const titleEn = clean(input.titleEn, LIMITS.title) || null;
      const bodyEn = clean(input.bodyEn, LIMITS.body) || null;
      const id = Number(q.add.run(kind, playerId, title, body, titleEn, bodyEn, now()).lastInsertRowid);
      return { ok: true, notice: q.get.get(id) };
    },
    // Убрать у игроков (в базе остаётся с пометкой hidden_at).
    hide: (id) => q.hide.run(now(), id).changes > 0,
    // Последние уведомления игрока, сколько из них не прочитано и номер последнего прочитанного.
    list(playerId, lang = "ru") {
      const en = lang === "en";
      const seen = lastSeen(playerId);
      const items = q.forPlayer.all(playerId, PLAYER_LIST).map((n) => publicOf(n, en));
      return { items, seen, unread: q.unread.get(playerId, seen).n };
    },
    // Игрок открыл список: прочитано всё до upTo (не дальше последнего существующего).
    read(playerId, upTo) {
      const id = Math.min(Number(upTo) || 0, q.maxId.get().id);
      if (id > 0) q.setSeen.run(playerId, id);
      const seen = lastSeen(playerId);
      return { seen, unread: q.unread.get(playerId, seen).n };
    },
    // Для панели: последние уведомления, у личных — кому и прочитал ли игрок.
    adminList: (limit = 100) => q.admin.all(limit).map((n) => ({
      id: n.id, kind: n.kind, playerId: n.player_id, name: n.name ?? null, username: n.username ?? null,
      title: n.title, body: n.body, titleEn: n.title_en, bodyEn: n.body_en, at: n.created_at, hiddenAt: n.hidden_at,
      read: n.player_id ? (n.seen ?? 0) >= n.id : null,
    })),
  };
}

// Текст личного уведомления сообщением бота (если владелец отметил «и в Telegram»).
export function telegramText(n, en = false) {
  const title = (en && n.title_en) || n.title;
  const body = (en && n.body_en) || n.body;
  return ["🔔 " + (title || (en ? "Notification" : "Уведомление")), body].filter(Boolean).join("\n\n").slice(0, 4000);
}
