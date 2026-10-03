// Игры прямо в чатах (ТЗ P1-3): инлайн-режим (в любом чате набрать @бот и выбрать игру) и /play
// в группах. Кнопки ведут на t.me/<бот>?startapp=<метка>: Telegram открывает сборник (Main Mini App)
// прямо из чата, с chat_instance этого чата — на нём держатся таблицы чата. Метка ref_<id>-<игра>
// засчитывает приглашение (stats.js) и открывает игру сразу из меню (web/menu.js, ключ start
// в web/config.js). Кнопки web_app в группах и инлайн-сообщениях Telegram не разрешает, поэтому ссылки.

export const GAME_LINKS = [
  {
    start: "word", icon: "🔤",
    ru: { title: "Слово дня", about: "Одно слово на всех, 6 попыток", text: "Сыграем в «Слово дня»? Одно слово из 5 букв на всех, 6 попыток. Побей мой результат!" },
    en: { title: "Word of the Day", about: "One word for everyone, 6 tries", text: "Let's play «Word of the Day»: one 5-letter word for everyone, 6 tries. Can you beat me?" },
  },
  {
    start: "tanks", icon: "🛡",
    ru: { title: "Танкодром", about: "Танки вдвоём: защити штаб", text: "Сыграем в «Танкодром»? Танковая дуэль на двоих прямо в Telegram." },
    en: { title: "Tank Field", about: "Tanks for two: guard the base", text: "Let's play «Tank Field»: a tank duel for two right in Telegram." },
  },
  {
    start: "mario", icon: "🏃",
    ru: { title: "Прыг-Скок", about: "Платформер: добеги до флага", text: "Сыграем в «Прыг-Скок»? Платформер прямо в Telegram — кто наберёт больше?" },
    en: { title: "Hop-Skip", about: "Platformer: run to the flag", text: "Let's play «Hop-Skip»: a platformer right in Telegram. Who scores more?" },
  },
];

const PLAY = { ru: "▶ Играть", en: "▶ Play" };
export const langOf = (code) => (/^(ru|uk|be|kk)\b/i.test(code || "") ? "ru" : "en");

// Имя туннеля после «__»: у ссылки startapp нет ?api=, игра найдёт сервер по нему (web/lib/server.js).
export function appLink(botName, label, apiUrl = "") {
  let tunnel = "";
  try { tunnel = /^([a-z0-9-]{1,63})\.trycloudflare\.com$/.exec(new URL(apiUrl).hostname)?.[1] || ""; } catch { /* нет адреса */ }
  const full = `${label}${tunnel ? `__${tunnel}` : ""}`;
  // Telegram принимает в startapp не больше 64 символов; без туннеля игра возьмёт запомненный адрес.
  return `https://t.me/${botName}?startapp=${full.length <= 64 ? full : label}`;
}

const label = (userId, start) => (Number.isSafeInteger(userId) ? `ref_${userId}-${start}` : start);

// Ответ на инлайн-запрос: по карточке на игру; текст запроса отбирает игры по названию.
export function inlineResults({ botName, apiUrl, userId, languageCode, query = "" }) {
  const lang = langOf(languageCode);
  const q = String(query).trim().toLowerCase();
  return GAME_LINKS
    .filter((g) => !q || g.ru.title.toLowerCase().includes(q) || g.en.title.toLowerCase().includes(q))
    .map((g) => ({
      type: "article",
      id: g.start,
      title: `${g.icon} ${g[lang].title}`,
      description: g[lang].about,
      input_message_content: { message_text: g[lang].text },
      reply_markup: { inline_keyboard: [[{ text: PLAY[lang], url: appLink(botName, label(userId, g.start), apiUrl) }]] },
    }));
}

// /play в группе: кнопки-ссылки на каждую игру (кто позвал — тот и пригласил).
export function groupPlay({ botName, apiUrl, userId, languageCode }) {
  const lang = langOf(languageCode);
  return {
    text: lang === "ru" ? "Во что играем? Нажмите игру — она откроется прямо здесь, а таблица будет общей для этого чата."
      : "What shall we play? Tap a game: it opens right here, with a table for this chat.",
    reply_markup: {
      inline_keyboard: GAME_LINKS.map((g) => [{ text: `${g.icon} ${g[lang].title}`, url: appLink(botName, label(userId, g.start), apiUrl) }]),
    },
  };
}
