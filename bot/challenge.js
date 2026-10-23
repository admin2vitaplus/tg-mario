import { DAY_MS, dayUtc, langOf, seasonOf } from "./economy.js";

// Испытание дня — причина вернуться завтра. Каждый день (00:00 UTC, как задания) одна игра на всех
// по кругу из economy.json (challenge.games). В зачёт идёт лучший счёт дня в этой игре, начатой с первого
// уровня (этапа) и в одиночку: итог проверяет сам сервер, как и для таблиц недели.
//  • первая игра испытания за день — жетоны (задание под дневным потолком), и чем длиннее серия дней
//    с испытанием подряд, тем больше: base + perStreakDay за каждый прошлый день, не больше max;
//  • таблицы дня: все, «этот чат» (кто открывал игру из того же чата, chat_instance) и «друзья»
//    (кого игрок позвал по ссылке и кто позвал его);
//  • в конце дня призы за 1–3 места, если играли хотя бы minPlayers (иначе приз почти ничего не стоит),
//    и личное уведомление победителю; закрытие дня продолжается после перезапуска с того же места;
//  • напоминание ботом в remindHour:00 UTC тем, у кого серия входов от 2 дней прервётся в полночь —
//    раз в день, только с включёнными напоминаниями (кнопка «не напоминать» в самом сообщении).
// Таблицы — миграция 14 в db.js.

export const NAMES = {
  ru: { mario: "Прыг-Скок", tanks: "Танкодром", bombs: "Бомбодром", range: "Тир" },
  en: { mario: "Hop-Skip", tanks: "Tank Field", bombs: "Bomb Field", range: "Shooting Range" },
};
// Сколько строк таблицы получает игра (и место игрока, если он ниже).
export const TABLE_ROWS = 20;
// Таблица дня пересчитывается не чаще раза в TOP_TTL_MS, если в неё ничего не записали.
const TOP_TTL_MS = 15_000;
// Сколько напоминаний уходит за один проход (раз в 10 минут), чтобы не упереться в лимиты Telegram.
export const REMIND_BATCH = 200;

export const gameOfDay = (cfg, day) => cfg.challenge.games[((day % cfg.challenge.games.length) + cfg.challenge.games.length) % cfg.challenge.games.length];

const daysRu = (n) => {
  const a = n % 100;
  const b = n % 10;
  if (a > 10 && a < 20) return "дней";
  return b === 1 ? "день" : b >= 2 && b <= 4 ? "дня" : "дней";
};

const REMIND_TEXT = {
  ru: {
    text: ({ streak, amount, game }) => `🔥 Вы заходите ${streak} ${daysRu(streak)} подряд. Серия прервётся в полночь по UTC (03:00 по Москве).\n` +
      `Загляните сегодня — вход даст ${amount} жетонов.\n⚡ Испытание дня: «${game}».`,
    play: "🎮 Играть", off: "Не напоминать",
  },
  en: {
    text: ({ streak, amount, game }) => `🔥 You have come ${streak} days in a row. The streak ends at midnight UTC.\n` +
      `Drop in today for ${amount} tickets.\n⚡ Challenge of the day: ${game}.`,
    play: "🎮 Play", off: "No reminders",
  },
};

const PRIZE_TEXT = {
  title: (place) => `Испытание дня: ${place} место`,
  body: (game, place, prize) => `Вы заняли ${place} место в испытании «${NAMES.ru[game]}» и получили ${prize} жетонов. Новое испытание уже ждёт.`,
  titleEn: (place) => `Challenge of the day: place ${place}`,
  bodyEn: (game, place, prize) => `You took place ${place} in the ${NAMES.en[game]} challenge and got ${prize} tickets. A new challenge is waiting.`,
};

export function createChallenge(store, economy, { now = Date.now, remind = null, notices = null, logger = console.log } = {}) {
  const { db } = store;
  const cfg = economy.cfg;
  const rules = cfg.challenge;
  const q = {
    get: db.prepare("SELECT * FROM challenge_results WHERE day = ? AND player_id = ?"),
    put: db.prepare(`INSERT INTO challenge_results (day, player_id, game, score, at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day, player_id) DO UPDATE SET score = excluded.score, at = excluded.at
      WHERE excluded.score > challenge_results.score`),
    pastDays: db.prepare(`SELECT day FROM challenge_results WHERE player_id = ? AND day < ? AND day >= ?
      ORDER BY day DESC`),
    ranked: db.prepare(`SELECT r.player_id AS id, r.score AS value, COALESCE(p.name, 'Игрок') AS name,
        ROW_NUMBER() OVER (ORDER BY r.score DESC, r.at ASC) AS place
      FROM challenge_results r LEFT JOIN players p ON p.id = r.player_id LEFT JOIN wallets w ON w.player_id = r.player_id
      WHERE r.day = ? AND w.flagged IS NULL`),
    joinChat: db.prepare(`INSERT INTO chat_players (chat, game, player_id, at) VALUES (?, 'challenge', ?, ?)
      ON CONFLICT(chat, game, player_id) DO UPDATE SET at = excluded.at`),
    chatIds: db.prepare("SELECT player_id AS id FROM chat_players WHERE chat = ? AND game = 'challenge'"),
    friendIds: db.prepare(`SELECT user_id AS id FROM users_seen WHERE inviter = ?1
      UNION SELECT inviter FROM users_seen WHERE user_id = ?1 AND inviter IS NOT NULL`),
    setMeta: db.prepare("INSERT OR IGNORE INTO economy_meta (key, value) VALUES (?, ?)"),
    meta: db.prepare("SELECT value FROM economy_meta WHERE key = ?"),
    lastClosed: db.prepare("SELECT MAX(day) AS day FROM challenge_days"),
    closed: db.prepare("SELECT * FROM challenge_days WHERE day = ?"),
    close: db.prepare("INSERT OR IGNORE INTO challenge_days (day, players, at) VALUES (?, ?, ?)"),
    toRemind: db.prepare(`SELECT w.player_id AS id, w.streak, w.lang FROM wallets w
      WHERE w.remind = 1 AND w.flagged IS NULL AND w.streak >= 2 AND w.streak_day = ?
        AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.day = ? AND r.player_id = w.player_id)
      ORDER BY w.streak DESC LIMIT ?`),
    markReminded: db.prepare("INSERT OR IGNORE INTO reminders (day, player_id, at) VALUES (?, ?, ?)"),
    ensureWallet: db.prepare("INSERT OR IGNORE INTO wallets (player_id) VALUES (?)"),
    setRemind: db.prepare("UPDATE wallets SET remind = ? WHERE player_id = ?"),
  };

  // Серия: сколько дней подряд до day (не включая его) игрок играл испытание.
  const streakBefore = (playerId, day) => {
    const days = new Set(q.pastDays.all(playerId, day, day - 400).map((r) => r.day));
    let n = 0;
    while (days.has(day - 1 - n)) n++;
    return n;
  };
  const reward = (streak) => Math.min(rules.base + rules.perStreakDay * streak, rules.max);

  const cache = new Map(); // day -> { at, rows }
  const ranked = (day, fresh = false) => {
    const t = now();
    const hit = cache.get(day);
    if (!fresh && hit && t - hit.at < TOP_TTL_MS && t >= hit.at) return hit.rows;
    const rows = q.ranked.all(day);
    cache.set(day, { at: t, rows });
    for (const d of cache.keys()) if (d < day - 2) cache.delete(d);
    return rows;
  };
  const view = (rows, playerId) => {
    const out = rows.slice(0, TABLE_ROWS).map((r) => ({ place: r.place, name: r.name, value: r.value, me: r.id === playerId }));
    const mine = rows.find((r) => r.id === playerId);
    return { rows: out, me: mine ? { place: mine.place, value: mine.value } : null, players: rows.length };
  };
  const within = (rows, ids) => rows.filter((r) => ids.has(r.id)).map((r, i) => ({ ...r, place: i + 1 }));

  const challenge = {
    gameOf: (day) => gameOfDay(cfg, day),
    today: () => gameOfDay(cfg, dayUtc(now())),

    // Принятый сервером итог игры. В зачёт — только игра дня, начатая с первого уровня и в одиночку.
    // Первая за день даёт жетоны (out — список начислений ответа игре). Возвращает null, если не в зачёт.
    record(playerId, game, score, { fromStart = true, solo = true } = {}, out = []) {
      const at = now();
      const day = dayUtc(at);
      if (game !== gameOfDay(cfg, day) || !fromStart || !solo || !Number.isSafeInteger(score) || score < 0) return null;
      return economy.tx(() => {
        const prev = q.get.get(day, playerId);
        q.put.run(day, playerId, game, score, at);
        if (!prev) {
          const n = economy.post(playerId, reward(streakBefore(playerId, day)), "task", `challenge:${day}`, { at });
          if (n > 0) out.push({ reason: "challenge", amount: n });
        }
        if (!prev || score > prev.score) cache.delete(day);
        return { first: !prev, best: Math.max(prev?.score ?? 0, score), improved: !prev || score > prev.score };
      });
    },

    // Всё для панели испытания в игре: игра дня и завтрашняя, награда, серия, таблицы и вчерашние призёры.
    state(playerId, { chat = null } = {}) {
      const at = now();
      const day = dayUtc(at);
      if (chat) q.joinChat.run(chat, playerId, at);
      const mine = q.get.get(day, playerId);
      const before = streakBefore(playerId, day);
      const all = ranked(day);
      const friends = new Set([playerId, ...q.friendIds.all(playerId).map((r) => r.id)]);
      const yesterday = ranked(day - 1);
      return {
        day,
        game: gameOfDay(cfg, day),
        tomorrow: gameOfDay(cfg, day + 1),
        endsAt: (day + 1) * DAY_MS,
        played: !!mine,
        best: mine ? mine.score : null,
        streak: before + (mine ? 1 : 0),
        reward: reward(before),
        next: reward(before + (mine ? 1 : 0)),
        rules: { base: rules.base, perStreakDay: rules.perStreakDay, max: rules.max, prizes: rules.prizes, minPlayers: rules.minPlayers },
        all: view(all, playerId),
        chat: chat ? view(within(all, new Set(q.chatIds.all(chat).map((r) => r.id))), playerId) : null,
        friends: view(within(all, friends), playerId),
        yesterday: { game: gameOfDay(cfg, day - 1), players: yesterday.length, rows: view(yesterday, playerId).rows.slice(0, 3),
          prized: !!q.closed.get(day - 1) && yesterday.length >= rules.minPlayers },
      };
    },

    // Закрыть прошедшие дни: призы за места (если игроков достаточно) и уведомления победителям.
    // Приз — запись журнала «challenge:<день>:<место>», повтор после перезапуска ничего не добавит.
    closeDue() {
      const today = dayUtc(now());
      q.setMeta.run("challenge_first_day", today);
      const first = q.meta.get("challenge_first_day").value;
      const last = q.lastClosed.get().day;
      const closed = [];
      for (let d = Math.max(first, last == null ? first : last + 1); d < today; d++) {
        const won = economy.tx(() => {
          const rows = ranked(d, true);
          const out = [];
          if (rows.length >= rules.minPlayers) {
            rows.slice(0, rules.prizes.length).forEach((r, i) => {
              const prize = rules.prizes[i];
              if (prize > 0 && economy.post(r.id, prize, "prize", `challenge:${d}:${i + 1}`, { season: seasonOf(d * DAY_MS) }) > 0) {
                out.push({ id: r.id, place: i + 1, prize });
              }
            });
          }
          q.close.run(d, rows.length, now());
          return out;
        });
        const game = gameOfDay(cfg, d);
        for (const w of won) {
          try {
            notices?.add({ kind: "personal", playerId: w.id, title: PRIZE_TEXT.title(w.place), body: PRIZE_TEXT.body(game, w.place, w.prize),
              titleEn: PRIZE_TEXT.titleEn(w.place), bodyEn: PRIZE_TEXT.bodyEn(game, w.place, w.prize) });
          } catch (err) { logger(`Испытание дня: уведомление не записано: ${err.message}`); }
        }
        closed.push(d);
      }
      return closed;
    },

    // Напоминания о серии входов (раз в день, после remindHour:00 UTC). Отметка ставится до отправки:
    // после перезапуска игрок не получит второе сообщение за день. Заблокировавшему бота больше не пишем.
    async remindDue() {
      if (!remind || !rules.remind) return 0;
      const at = now();
      const day = dayUtc(at);
      if (at - day * DAY_MS < rules.remindHour * 3_600_000) return 0;
      const game = gameOfDay(cfg, day);
      let sent = 0;
      for (const r of q.toRemind.all(day - 1, day, REMIND_BATCH)) {
        q.markReminded.run(day, r.id, now());
        const t = REMIND_TEXT[r.lang ? langOf(r.lang) : "ru"];
        const amount = Math.min(cfg.daily.base + cfg.daily.perStreakDay * r.streak, cfg.daily.max);
        const lang = t === REMIND_TEXT.en ? "en" : "ru";
        try {
          await remind(r.id, t.text({ streak: r.streak, amount, game: NAMES[lang][game] }), { playText: t.play, offText: t.off });
          sent++;
        } catch (err) {
          if (err?.error_code === 403) challenge.setRemind(r.id, false);
        }
      }
      return sent;
    },

    setRemind(playerId, on) {
      q.ensureWallet.run(playerId);
      q.setRemind.run(on ? 1 : 0, playerId);
    },
  };
  return challenge;
}
