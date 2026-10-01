import { DAY_MS, dayOf, dayLabel } from "./days.js";

// Статистика по ТЗ, P0-5: события игроков, источники, K-фактор и удержание.
// Хранится только Telegram id и то, что нужно для подсчёта; имена и тексты сюда не попадают.

export const GAMES = ["mario", "tanks"];
// События, которые присылает сама игра. Остальные (первое появление, переход по приглашению,
// вход по приглашению, конец игры в «Прыг-Скок») сервер записывает сам.
export const CLIENT_EVENTS = new Set([
  "game_open", "game_start", "game_finish", "invite_created", "match_finished", "share_clicked",
]);
const INVITE_SOURCES = new Set(["ref", "room"]);
const INVITE_TTL_MS = DAY_MS;
const MATCH_DEDUP_MS = 60_000;

// Метка источника из ?start= бота или startapp= Mini App:
// src_<метка> — реклама/площадка, ref_<id> — личное приглашение, room_<код> (и старое tanks_<код>) — комната.
export function parseStart(payload) {
  const p = String(payload || "").trim();
  let m;
  if ((m = /^src_([A-Za-z0-9-]{1,32})$/.exec(p))) return { source: `src_${m[1].toLowerCase()}`, ref: null };
  if ((m = /^ref_(\d{1,15})$/.exec(p))) return { source: "ref", ref: m[1] };
  if ((m = /^(?:room|tanks)_(\d{4,8})$/.exec(p))) return { source: "room", ref: m[1] };
  return { source: "direct", ref: null };
}

export function createTracker(store, now = Date.now) {
  return {
    // Игрок пришёл: команда /start в боте или запуск Mini App (start_param из initData).
    // Возвращает { isNew, source, ref }.
    arrive(userId, payload) {
      const at = now();
      let { source, ref } = parseStart(payload);
      // По своей же ссылке приглашения — не приглашение.
      if (source === "ref" && Number(ref) === userId) ({ source, ref } = { source: "direct", ref: null });
      const inviter = source === "ref" ? Number(ref) : null;
      const isNew = store.seen(userId, { source, inviter, ref }, at);
      if (INVITE_SOURCES.has(source)) {
        // Один и тот же переход (например, повторный запуск с тем же start_param) считаем один раз в сутки.
        const prev = store.lastEvent(userId, "invite_opened", at - INVITE_TTL_MS);
        if (!prev || prev.ref !== ref) {
          store.addEvent({ userId, type: "invite_opened", source, ref, detail: isNew ? "new" : "returning" }, at);
        }
      }
      return { isNew, source, ref };
    },

    // Событие от игры (или от сервера). Невалидные тихо отбрасываются: это статистика, не игра.
    event(userId, type, game = "", ref = null) {
      const at = now();
      let detail = null;
      if (type === "match_finished" && ref != null) {
        // Конец матча вдвоём присылают оба игрока; второй отчёт о той же комнате помечается.
        const prev = store.lastEventByRef("match_finished", ref, at - MATCH_DEDUP_MS);
        if (prev && prev.user_id !== userId && prev.detail !== "second") detail = "second";
      }
      store.addEvent({ userId, type, game, ref, detail }, at);
      if (type === "game_start") {
        // Первая игра в течение суток после перехода по приглашению — «вошёл по приглашению».
        const opened = store.lastEvent(userId, "invite_opened", at - INVITE_TTL_MS);
        const joined = opened && store.lastEvent(userId, "invite_joined", opened.at);
        if (opened && !joined) {
          store.addEvent({ userId, type: "invite_joined", game, source: opened.source, ref: opened.ref, detail: opened.detail }, at);
        }
      }
    },
  };
}

// ---------- Подсчёт ----------

// Отношение для K-фактора: новые игроки, пришедшие по приглашениям, ÷ игроки, отправившие приглашение.
export function kFactor(db, fromDay, toDay) {
  const invited = db.prepare(`SELECT COUNT(*) AS n FROM users_seen
    WHERE day BETWEEN ? AND ? AND source IN ('ref', 'room')`).get(fromDay, toDay).n;
  const inviters = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM events
    WHERE type = 'invite_created' AND day BETWEEN ? AND ?`).get(fromDay, toDay).n;
  return { invited, inviters, k: inviters ? invited / inviters : null };
}

// Удержание дня N: из игроков, впервые пришедших в fromDay..toDay, доля тех, кто был активен ровно
// через N дней. Берутся только когорты, у которых день N уже закончился. Игроки до статистики (old) не считаются.
export function retention(db, n, fromDay, today) {
  const lastCohort = today - n - 1;
  if (lastCohort < fromDay) return { cohort: 0, returned: 0, rate: null };
  const row = db.prepare(`SELECT COUNT(*) AS cohort,
      SUM(EXISTS (SELECT 1 FROM events e WHERE e.user_id = s.user_id AND e.day = s.day + ?)) AS returned
    FROM users_seen s WHERE s.day BETWEEN ? AND ? AND s.source != 'old'`).get(n, fromDay, lastCohort);
  const returned = row.returned ?? 0;
  return { cohort: row.cohort, returned, rate: row.cohort ? returned / row.cohort : null };
}

const activePlayers = (db, fromDay, toDay) =>
  db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE day BETWEEN ? AND ? AND user_id IS NOT NULL")
    .get(fromDay, toDay).n;

export function collectStats(db, at = Date.now()) {
  const today = dayOf(at);
  const days = [];
  for (let d = today - 6; d <= today; d++) {
    days.push({
      day: d,
      players: activePlayers(db, d, d),
      newPlayers: db.prepare("SELECT COUNT(*) AS n FROM users_seen WHERE day = ? AND source != 'old'").get(d).n,
      matches: db.prepare(`SELECT COUNT(*) AS n FROM events WHERE day = ? AND type = 'match_finished'
        AND (detail IS NULL OR detail != 'second')`).get(d).n,
    });
  }
  const bySource = (fromDay) => db.prepare(`SELECT source, COUNT(*) AS n FROM users_seen
    WHERE day BETWEEN ? AND ? AND source != 'old' GROUP BY source ORDER BY n DESC, source`).all(fromDay, today);
  const games = GAMES.map((game) => {
    const count = (type) => db.prepare(`SELECT COUNT(*) AS n FROM events WHERE game = ? AND type = ? AND day >= ?
      AND (detail IS NULL OR detail != 'second')`).get(game, type, today - 6).n;
    return {
      game,
      players: db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE game = ? AND day >= ?").get(game, today - 6).n,
      opens: count("game_open"),
      starts: count("game_start"),
      finishes: count("game_finish"),
      matches: count("match_finished"),
      invites: count("invite_created"),
      joined: count("invite_joined"),
    };
  });
  return {
    today,
    players: {
      today: activePlayers(db, today, today),
      yesterday: activePlayers(db, today - 1, today - 1),
      week: activePlayers(db, today - 6, today),
      month: activePlayers(db, today - 29, today),
      total: db.prepare("SELECT COUNT(*) AS n FROM users_seen").get().n,
    },
    days,
    newBySource: { week: bySource(today - 6), month: bySource(today - 29) },
    k: { week: kFactor(db, today - 6, today), month: kFactor(db, today - 29, today) },
    retention: { d1: retention(db, 1, today - 30, today), d7: retention(db, 7, today - 30, today) },
    games,
  };
}

const SOURCE_NAMES = { direct: "сами", ref: "по ссылке друга", room: "в комнату" };
const GAME_NAMES = { mario: "Прыг-Скок", tanks: "Танкодром" };
const pct = (r) => (r.rate == null ? "—" : `${Math.round(r.rate * 100)}% (${r.returned} из ${r.cohort})`);
const kText = (k) => (k.k == null ? `— (новых по приглашениям ${k.invited}, пригласивших 0)`
  : `${k.k.toFixed(2)} (${k.invited} новых ÷ ${k.inviters} пригласивших)`);
const sources = (list) => (list.length ? list.map((s) => `${SOURCE_NAMES[s.source] || s.source} ${s.n}`).join(", ") : "нет");

export function statsReport(db, at = Date.now()) {
  const s = collectStats(db, at);
  const lines = [
    "📊 Статистика (дни по Москве)",
    "",
    `Игроки: сегодня ${s.players.today}, вчера ${s.players.yesterday}, за 7 дней ${s.players.week}, ` +
      `за 30 дней ${s.players.month}, всего ${s.players.total}`,
    "",
    "По дням — игроки / новые / матчи:",
    ...s.days.map((d) => `${dayLabel(d.day)}: ${d.players} / ${d.newPlayers} / ${d.matches}`),
    "",
    `Новые по источникам за 7 дней: ${sources(s.newBySource.week)}`,
    `за 30 дней: ${sources(s.newBySource.month)}`,
    "",
    `K-фактор за 7 дней: ${kText(s.k.week)}`,
    `за 30 дней: ${kText(s.k.month)}`,
    "",
    `Удержание (пришли за 30 дней): день 1 — ${pct(s.retention.d1)}, день 7 — ${pct(s.retention.d7)}`,
    "",
    "По играм за 7 дней:",
    ...s.games.map((g) => `${GAME_NAMES[g.game]}: игроков ${g.players}, открыли ${g.opens}, начали ${g.starts}, ` +
      `доиграли ${g.finishes}, матчей ${g.matches}, приглашений ${g.invites}, вошли по приглашению ${g.joined}`),
  ];
  return lines.join("\n");
}
