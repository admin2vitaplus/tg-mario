import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { DAY_MS, dayUtc } from "./economy.js";

// «Слово дня» (ТЗ, игра 1): одно слово из 5 букв на всех в день, 6 попыток, подсказки цветом.
// Слово выбирает сервер и сам проверяет каждую попытку, поэтому ответ не попадает в игру,
// пока она не закончена, а результат нельзя подделать.
//
//  • день — по UTC, как у ежедневных заданий жетонов (новое слово в 00:00 UTC);
//  • слово дня выбирается случайно при первом запросе дня и запоминается в word_days: обновление
//    списка слов не меняет уже выбранное; повторов нет, пока не пройден весь список;
//  • своё слово у каждого языка (ru, en); в таблицы идёт лучший из двух результатов дня;
//  • очки за день: 7 − число попыток при победе (6 за первую попытку … 1 за шестую), 0 при проигрыше;
//  • таблица чата — по chat_instance из initData: кто открывал игру из этого чата.

export const LANGS = ["ru", "en"];
export const LENGTH = 5;
export const TRIES = 6;
// День «Слова дня» № 1 — 3 октября 2026 года.
export const FIRST_DAY = dayUtc(Date.UTC(2026, 9, 3));
const LETTERS = { ru: /^[а-я]{5}$/, en: /^[a-z]{5}$/ };

export const normalize = (s) => String(s ?? "").trim().toLowerCase().replace(/ё/g, "е");
export const scoreOf = (won, tries) => (won ? TRIES + 1 - tries : 0);

function readList(file) {
  return readFileSync(file, "utf8").split("\n").map((l) => normalize(l)).filter((l) => l && !l.startsWith("#"));
}

// Слова дня (своя подборка) и допустимые попытки (словари Hunspell, см. word/ и ASSETS.md).
export function loadDictionaries(dir = new URL("./word/", import.meta.url)) {
  const out = {};
  for (const lang of LANGS) {
    const answers = [...new Set(readList(new URL(`${lang}-answers.txt`, dir)))];
    const allowed = new Set(readList(new URL(`${lang}-allowed.txt`, dir)));
    for (const w of answers) {
      if (!LETTERS[lang].test(w)) throw new Error(`word/${lang}-answers.txt: «${w}» — не ${LENGTH} букв`);
      allowed.add(w);
    }
    out[lang] = { answers, allowed };
  }
  return out;
}

// Подсказки к попытке: 2 — буква на своём месте, 1 — есть в слове в другом месте, 0 — нет.
// Повторы букв считаются честно: «лишняя» повторная буква получает 0.
export function marks(answer, guess) {
  const a = [...answer];
  const g = [...guess];
  const out = Array(g.length).fill(0);
  const left = new Map();
  a.forEach((ch, i) => {
    if (g[i] === ch) out[i] = 2;
    else left.set(ch, (left.get(ch) || 0) + 1);
  });
  g.forEach((ch, i) => {
    if (out[i] === 2 || !left.get(ch)) return;
    out[i] = 1;
    left.set(ch, left.get(ch) - 1);
  });
  return out.join("");
}

// Серия: сколько дней подряд слово отгадано, заканчивая сегодня (или вчера, если сегодня ещё
// не отгадано), и самая длинная серия. days — отгаданные дни по убыванию.
export function streaks(days, today) {
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    run = prev !== null && d === prev - 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  let current = 0;
  if (days.length && days[0] >= today - 1) {
    current = 1;
    while (current < days.length && days[current] === days[current - 1] - 1) current++;
  }
  return { current, best };
}

export function createWord(store, { dict = loadDictionaries(), now = Date.now, economy = null, tracker = null } = {}) {
  const { db } = store;
  const q = {
    day: db.prepare("SELECT answer FROM word_days WHERE day = ? AND lang = ?"),
    setDay: db.prepare("INSERT OR IGNORE INTO word_days (day, lang, answer) VALUES (?, ?, ?)"),
    // Слова, которые уже были в текущем круге по списку (последние «длина списка − 1» дней).
    recent: db.prepare("SELECT answer FROM word_days WHERE lang = ? AND day > ? AND day < ?"),
    play: db.prepare("SELECT * FROM word_plays WHERE player_id = ? AND day = ? AND lang = ?"),
    start: db.prepare(`INSERT OR IGNORE INTO word_plays (player_id, day, lang, started_at) VALUES (?, ?, ?, ?)`),
    guess: db.prepare("UPDATE word_plays SET guesses = ? WHERE player_id = ? AND day = ? AND lang = ? AND state = 'play'"),
    finish: db.prepare(`UPDATE word_plays SET guesses = ?, state = ?, score = ?, finished_at = ?
      WHERE player_id = ? AND day = ? AND lang = ? AND state = 'play'`),
    wonDays: db.prepare("SELECT DISTINCT day FROM word_plays WHERE player_id = ? AND state = 'won' ORDER BY day DESC"),
    dayStats: db.prepare(`SELECT COUNT(*) AS players, COALESCE(SUM(state = 'won'), 0) AS solved
      FROM word_plays WHERE day = ? AND lang = ? AND state != 'play'`),
    joinChat: db.prepare(`INSERT INTO chat_players (chat, game, player_id, at) VALUES (?, 'word', ?, ?)
      ON CONFLICT(chat, game, player_id) DO UPDATE SET at = excluded.at`),
    chatToday: db.prepare(`SELECT c.player_id AS id, COALESCE(p.name, 'Игрок') AS name, w.lang, w.state, w.guesses, w.score
      FROM chat_players c LEFT JOIN players p ON p.id = c.player_id
      JOIN word_plays w ON w.player_id = c.player_id AND w.day = ? AND w.state != 'play'
      WHERE c.chat = ? AND c.game = 'word'
      ORDER BY w.score DESC, w.finished_at ASC LIMIT 200`),
    chatWeek: db.prepare(`SELECT c.player_id AS id, COALESCE(p.name, 'Игрок') AS name, SUM(d.best) AS value, MAX(d.at) AS tie
      FROM chat_players c LEFT JOIN players p ON p.id = c.player_id
      JOIN (SELECT player_id, day, MAX(score) AS best, MIN(finished_at) AS at FROM word_plays
        WHERE day >= ? AND state != 'play' GROUP BY player_id, day) d ON d.player_id = c.player_id
      WHERE c.chat = ? AND c.game = 'word'
      GROUP BY c.player_id HAVING value > 0 ORDER BY value DESC, tie ASC LIMIT 100`),
  };

  const today = () => dayUtc(now());
  const number = (day) => day - FIRST_DAY + 1;

  // Слово дня: уже выбранное или новое случайное из тех, что не встречались в этом круге.
  function answerOf(lang, day) {
    const got = q.day.get(day, lang);
    if (got) return got.answer;
    const { answers } = dict[lang];
    const used = new Set(q.recent.all(lang, day - answers.length, day).map((r) => r.answer));
    const fresh = answers.filter((w) => !used.has(w));
    const pool = fresh.length ? fresh : answers;
    q.setDay.run(day, lang, pool[randomInt(pool.length)]);
    return q.day.get(day, lang).answer;
  }

  // Состояние игры дня для игрока (ответ — только после конца игры).
  function view(playerId, lang, day, row = q.play.get(playerId, day, lang)) {
    const answer = answerOf(lang, day);
    const guesses = row?.guesses ? row.guesses.split(",") : [];
    const state = row?.state ?? "play";
    const s = streaks(q.wonDays.all(playerId).map((r) => r.day), day);
    const st = q.dayStats.get(day, lang);
    return {
      day, number: number(day), lang, length: LENGTH, tries: TRIES,
      guesses: guesses.map((w) => ({ word: w, marks: marks(answer, w) })),
      state,
      score: row?.score ?? 0,
      answer: state === "play" ? null : answer,
      streak: s.current,
      bestStreak: s.best,
      nextAt: (day + 1) * DAY_MS,
      today: { players: st.players, solved: st.solved },
    };
  }

  const joinChat = (playerId, chat) => { if (chat) q.joinChat.run(chat, playerId, now()); };

  return {
    dict,
    answerOf,
    today,

    state(playerId, lang, { chat = null } = {}) {
      joinChat(playerId, chat);
      return view(playerId, lang, today());
    },

    // Попытка. Ответ: { status, body }; 422 — такого слова нет в словаре (попытка не тратится).
    guess(playerId, lang, raw, { day: clientDay = null, chat = null } = {}) {
      const day = today();
      if (clientDay !== null && clientDay !== day) return { status: 409, body: { error: "new day", day } };
      const word = normalize(raw);
      if (!LETTERS[lang].test(word)) return { status: 400, body: { error: "bad data" } };
      if (!dict[lang].allowed.has(word)) return { status: 422, body: { error: "not a word" } };
      joinChat(playerId, chat);
      const answer = answerOf(lang, day);
      q.start.run(playerId, day, lang, now());
      const row = q.play.get(playerId, day, lang);
      if (row.state !== "play") return { status: 409, body: { error: "finished", ...view(playerId, lang, day, row) } };
      const list = row.guesses ? row.guesses.split(",") : [];
      if (list.includes(word)) return { status: 422, body: { error: "repeat" } };
      list.push(word);
      const won = word === answer;
      const over = won || list.length >= TRIES;
      const grants = [];
      if (!over) {
        q.guess.run(list.join(","), playerId, day, lang);
      } else {
        const before = streaks(q.wonDays.all(playerId).map((r) => r.day), day);
        q.finish.run(list.join(","), won ? "won" : "lost", scoreOf(won, list.length), now(), playerId, day, lang);
        const after = streaks(q.wonDays.all(playerId).map((r) => r.day), day);
        // Рекорд игры — самая длинная серия дней (раз в день, как у других игр).
        const newRecord = won && after.best > before.best && after.best >= 2;
        economy?.run(playerId, { newRecord, game: "word", levels: won ? 1 : 0 }, grants);
        tracker?.event(playerId, "game_finish", "word");
      }
      return { status: 200, body: { ...view(playerId, lang, day), grants } };
    },

    // Таблица чата: результаты сегодня и очки за неделю у тех, кто открывал игру из этого чата.
    chat(playerId, chat, weekFrom) {
      if (!chat) return { chat: false, today: [], week: [] };
      joinChat(playerId, chat);
      const day = today();
      // Сыгравший на двух языках — одной строкой, с лучшим результатом.
      const seen = new Set();
      const rows = q.chatToday.all(day, chat).filter((r) => !seen.has(r.id) && seen.add(r.id));
      return {
        chat: true,
        today: rows.map((r) => ({
          name: r.name, lang: r.lang, won: r.state === "won", tries: r.guesses.split(",").length, score: r.score, me: r.id === playerId,
        })),
        week: q.chatWeek.all(dayUtc(weekFrom), chat).map((r, i) => ({ place: i + 1, name: r.name, value: r.value, me: r.id === playerId })),
      };
    },
  };
}
