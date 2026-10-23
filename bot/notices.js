import { readFileSync } from "node:fs";

// Уведомления в меню сборника: обновления и новости для всех и личные сообщения игроку.
// Пишет их владелец в панели (admin.js), игра показывает в «🔔 Уведомления» (web/lib/notices.js).
// Обновления приходят и сами: из журнала изменений bot/changelog.json при каждом запуске бота
// (syncChangelog). Таблицы — миграции 12 и 13 в db.js. Текст хранится как есть и на странице
// вставляется только как текст.

// update — крупное обновление, minor — небольшое (в журнале изменений size: major | minor).
export const KINDS = ["update", "minor", "news", "personal"];
const KIND_OF_SIZE = { major: "update", minor: "minor" };
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
    // По дате: записи журнала изменений добавляются позже, но со своими прошлыми датами.
    forPlayer: db.prepare(`SELECT id, kind, player_id, title, body, title_en, body_en, created_at FROM notices
      WHERE hidden_at IS NULL AND (player_id IS NULL OR player_id = ?) ORDER BY created_at DESC, id DESC LIMIT ?`),
    byRef: db.prepare("SELECT * FROM notices WHERE ref = ?"),
    addRef: db.prepare(`INSERT INTO notices (kind, player_id, title, body, title_en, body_en, created_at, ref)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`),
    editRef: db.prepare("UPDATE notices SET kind = ?, title = ?, body = ?, title_en = ?, body_en = ? WHERE ref = ?"),
    unread: db.prepare(`SELECT COUNT(*) AS n FROM notices
      WHERE hidden_at IS NULL AND (player_id IS NULL OR player_id = ?) AND id > ?`),
    seen: db.prepare("SELECT last_id FROM notice_seen WHERE player_id = ?"),
    setSeen: db.prepare(`INSERT INTO notice_seen (player_id, last_id) VALUES (?, ?)
      ON CONFLICT(player_id) DO UPDATE SET last_id = MAX(last_id, excluded.last_id)`),
    maxId: db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM notices"),
    admin: db.prepare(`SELECT n.*, p.name, p.username, s.last_id AS seen FROM notices n
      LEFT JOIN players p ON p.id = n.player_id LEFT JOIN notice_seen s ON s.player_id = n.player_id
      ORDER BY n.created_at DESC, n.id DESC LIMIT ?`),
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
    // Журнал изменений (readChangelog) → уведомления «Обновление» (крупное или небольшое) для всех. Новая запись добавляется
    // один раз (по id записи) с датой из журнала, а без даты — с моментом, когда её увидел сервер, то есть
    // когда обновление вышло. Исправленный в журнале текст исправляется и у игроков; убранное в панели
    // остаётся убранным. Возвращает, сколько записей добавлено.
    syncChangelog(entries) {
      let added = 0;
      db.exec("BEGIN");
      try {
        entries.forEach((e, i) => {
          const title = clean(e.title, LIMITS.title);
          const body = clean(e.body, LIMITS.body);
          const titleEn = clean(e.titleEn, LIMITS.title) || null;
          const bodyEn = clean(e.bodyEn, LIMITS.body) || null;
          const kind = KIND_OF_SIZE[e.size] || "update";
          const old = q.byRef.get(e.id);
          if (!old) {
            // Записи одного дня идут по порядку журнала: следующая — на секунду позже.
            const at = e.date ? Date.parse(`${e.date}T09:00:00Z`) + i * 1000 : now();
            q.addRef.run(kind, title, body, titleEn, bodyEn, at, e.id);
            added++;
          } else if (old.kind !== kind || old.title !== title || old.body !== body || old.title_en !== titleEn || old.body_en !== bodyEn) {
            q.editRef.run(kind, title, body, titleEn, bodyEn, e.id);
          }
        });
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return added;
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

// Журнал изменений: [{ id, date?, size, title, body, titleEn, bodyEn }], см. bot/changelog.json.
// size: major — крупное обновление (новая игра, мир, режим, заметная возможность), minor — небольшое
// (улучшение, ускорение, исправление); у игроков крупные выделены, небольшие — короткой строкой.
// Ошибка в файле не останавливает бота: тест (notices.test.js) ловит её раньше, чем она попадёт на сервер.
export const CHANGELOG_FILE = new URL("./changelog.json", import.meta.url);
export function readChangelog(file = CHANGELOG_FILE) {
  const list = JSON.parse(readFileSync(file, "utf8"));
  const problems = changelogProblems(list);
  if (problems.length) throw new Error(`changelog.json: ${problems[0]}`);
  return list;
}

export function changelogProblems(list) {
  if (!Array.isArray(list)) return ["не массив"];
  const out = [];
  const ids = new Set();
  let last = "";
  for (const e of list) {
    const where = e && e.id ? `«${e.id}»` : JSON.stringify(e).slice(0, 60);
    if (!e || typeof e.id !== "string" || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(e.id)) out.push(`${where}: id — латиница, цифры и дефисы`);
    else if (ids.has(e.id)) out.push(`${where}: такой id уже есть`);
    else ids.add(e.id);
    if (e?.date !== undefined) {
      if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || Number.isNaN(Date.parse(e.date))) out.push(`${where}: дата ГГГГ-ММ-ДД`);
      else if (e.date < last) out.push(`${where}: записи идут по датам, новые — в конец`);
      else last = e.date;
    }
    if (!KIND_OF_SIZE[e?.size]) out.push(`${where}: size — major (крупное) или minor (небольшое)`);
    if (typeof e?.title !== "string" || !e.title.trim() || e.title.length > LIMITS.title) out.push(`${where}: заголовок до ${LIMITS.title} знаков`);
    if (typeof e?.body !== "string" || e.body.length > LIMITS.body) out.push(`${where}: текст до ${LIMITS.body} знаков`);
    if (typeof e?.titleEn !== "string" || !e.titleEn.trim() || e.titleEn.length > LIMITS.title) out.push(`${where}: titleEn до ${LIMITS.title} знаков`);
    if (typeof e?.bodyEn !== "string" || e.bodyEn.length > LIMITS.body) out.push(`${where}: bodyEn до ${LIMITS.body} знаков`);
  }
  return out;
}

// Текст личного уведомления сообщением бота (если владелец отметил «и в Telegram»).
export function telegramText(n, en = false) {
  const title = (en && n.title_en) || n.title;
  const body = (en && n.body_en) || n.body;
  return ["🔔 " + (title || (en ? "Notification" : "Уведомление")), body].filter(Boolean).join("\n\n").slice(0, 4000);
}
